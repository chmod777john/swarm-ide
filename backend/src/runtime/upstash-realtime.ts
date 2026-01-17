import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

type RealtimeSubscribeOptions = {
  events: string[];
  history?: { start?: string; end?: string; limit?: number };
  onData: (evt: { id?: string; event: string; data: unknown }) => void;
};

type ChannelHandle = {
  emit: (event: string, payload: unknown) => Promise<void>;
  subscribe: (opts: RealtimeSubscribeOptions) => Promise<() => void>;
};

type RealtimeClient = {
  channel: (name: string) => ChannelHandle;
};

type StreamReadGroupResponse = Array<[string, Array<[string, Array<string>]>]>;

let cachedClient: RedisClient | null = null;

function getRedisUrl() {
  return process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
}

export function isUpstashRealtimeConfigured() {
  return !!getRedisUrl();
}

async function getRedisClient(): Promise<RedisClient> {
  if (cachedClient) return cachedClient;
  const client = createClient({ url: getRedisUrl() });
  client.on("error", () => undefined);
  await client.connect();
  cachedClient = client;
  return client;
}

async function createSubscriber(): Promise<RedisClient> {
  const client = createClient({ url: getRedisUrl() });
  client.on("error", () => undefined);
  await client.connect();
  return client;
}

function parseStreamEntries(
  entries: Array<[string, Array<string>]> | undefined,
  events: string[],
  onData: (evt: { id?: string; event: string; data: unknown }) => void
) {
  if (!entries) return;
  for (const [id, fields] of entries) {
    const dataFieldIdx = fields.indexOf("data");
    const eventFieldIdx = fields.indexOf("event");
    if (dataFieldIdx === -1 || eventFieldIdx === -1) continue;
    const event = fields[eventFieldIdx + 1] ?? "";
    if (events.length > 0 && !events.includes(event)) continue;
    const raw = fields[dataFieldIdx + 1];
    let payload: unknown = raw;
    try {
      payload = raw ? JSON.parse(raw) : raw;
    } catch {
      // ignore non-json payloads
    }
    onData({ id, event, data: payload });
  }
}

async function readGroup(
  client: RedisClient,
  streamKey: string,
  group: string,
  consumer: string,
  events: string[],
  onData: (evt: { id?: string; event: string; data: unknown }) => void
) {
  const res = (await client.sendCommand([
    "XREADGROUP",
    "GROUP",
    group,
    consumer,
    "COUNT",
    "2000",
    "STREAMS",
    streamKey,
    ">",
  ])) as StreamReadGroupResponse | null;

  if (!res || res.length === 0) return;
  const [, entries] = res[0] ?? [];
  parseStreamEntries(entries, events, onData);
}

export function getUpstashRealtime(): RealtimeClient {
  return {
    channel(name: string): ChannelHandle {
      const streamKey = name;
      return {
        async emit(event: string, payload: unknown) {
          const client = await getRedisClient();
          await client.sendCommand([
            "XADD",
            streamKey,
            "*",
            "event",
            event,
            "data",
            JSON.stringify(payload ?? null),
          ]);
          await client.publish(streamKey, "1");
        },
        async subscribe(opts: RealtimeSubscribeOptions) {
          const client = await getRedisClient();
          const subscriber = await createSubscriber();
          const group = `sse-${crypto.randomUUID()}`;
          const consumer = `c-${crypto.randomUUID()}`;
          const startId = opts.history?.start === "-" ? "0" : "$";

          try {
            await client.sendCommand([
              "XGROUP",
              "CREATE",
              streamKey,
              group,
              startId,
              "MKSTREAM",
            ]);
          } catch {
            // ignore if group already exists
          }

          if (opts.history?.start === "-") {
            await readGroup(client, streamKey, group, consumer, opts.events, opts.onData);
          }

          const handle = async () => {
            await readGroup(client, streamKey, group, consumer, opts.events, opts.onData);
          };

          await subscriber.subscribe(streamKey, () => void handle());

          return async () => {
            try {
              await subscriber.unsubscribe(streamKey);
            } catch {
              // ignore
            }
            await subscriber.quit().catch(() => undefined);
            await client
              .sendCommand(["XGROUP", "DESTROY", streamKey, group])
              .catch(() => undefined);
          };
        },
      };
    },
  };
}

export async function getUpstashRedis(): Promise<RedisClient> {
  return await getRedisClient();
}
