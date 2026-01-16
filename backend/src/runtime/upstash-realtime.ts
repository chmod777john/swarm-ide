import { Redis } from "@upstash/redis";
import { Realtime } from "@upstash/realtime";
import z from "zod/v4";

const schema = {
  agent: {
    stream: z.any(),
    wakeup: z.any(),
    unread: z.any(),
    done: z.any(),
    error: z.any(),
  },
  ui: {
    agent: { created: z.any() },
    group: { created: z.any() },
    message: { created: z.any() },
  },
} as const;

type AgentWechatRealtimeOpts = {
  redis: Redis;
  schema: typeof schema;
  history: { maxLength: number };
};

type RealtimeClient = Realtime<AgentWechatRealtimeOpts>;

let cached: RealtimeClient | null = null;
let cachedRedis: Redis | null = null;

export function isUpstashRealtimeConfigured() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return !!(url && token);
}

export function getUpstashRealtime(): RealtimeClient {
  if (cached) return cached;

  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Missing Upstash REST credentials (set KV_REST_API_URL + KV_REST_API_TOKEN)"
    );
  }

  const redis = new Redis({ url, token });
  cachedRedis = redis;
  cached = new Realtime({ redis, schema, history: { maxLength: 2000 } });
  return cached;
}

export function getUpstashRedis(): Redis {
  if (cachedRedis) return cachedRedis;

  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Missing Upstash REST credentials (set KV_REST_API_URL + KV_REST_API_TOKEN)"
    );
  }

  cachedRedis = new Redis({ url, token });
  return cachedRedis;
}
