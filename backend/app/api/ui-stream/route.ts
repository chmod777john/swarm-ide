export const runtime = "nodejs";

import { getWorkspaceUIBus } from "@/runtime/ui-bus";
import { getUpstashRealtime, isUpstashRealtimeConfigured } from "@/runtime/upstash-realtime";

function sse(data: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function sseWithId(id: string | number | null | undefined, data: unknown) {
  const prefix =
    typeof id === "string"
      ? `id: ${id}\n`
      : typeof id === "number"
        ? `id: ${id}\n`
        : "";
  return new TextEncoder().encode(`${prefix}data: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const bus = getWorkspaceUIBus();
  const lastEventIdHeader = (req.headers.get("Last-Event-ID") ?? "").trim();
  const lastEventNumericId = Number(lastEventIdHeader || "0");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: any) => {
        if (payload && typeof payload === "object" && typeof payload.id === "number") {
          controller.enqueue(sseWithId(payload.id, payload));
          return;
        }
        controller.enqueue(sse(payload));
      };
      const sendKeepalive = () => controller.enqueue(new TextEncoder().encode(`: ping\n\n`));

      let unsubscribe: (() => void) | null = null;
      let upstashUnsubscribe: (() => void) | null = null;

      if (isUpstashRealtimeConfigured()) {
        const channel = getUpstashRealtime().channel(`ui:${workspaceId}`);
        const start = lastEventIdHeader ? `(${lastEventIdHeader}` : "-";
        upstashUnsubscribe = await channel.subscribe({
          events: ["ui.agent.created", "ui.group.created", "ui.message.created"],
          history: { start: start as any, end: "+" as any, limit: 2000 },
          onData: (evt) => {
            const payload = {
              event: evt.event,
              data: (evt.data as any)?.data ?? evt.data,
            };
            controller.enqueue(sseWithId((evt as any).id, payload));
          },
        });
      } else {
        for (const evt of bus.getSince(workspaceId, lastEventNumericId)) {
          send(evt);
        }
        unsubscribe = bus.subscribe(workspaceId, (evt) => send(evt));
      }

      const keepalive = setInterval(sendKeepalive, 15_000);

      const abortHandler = async () => {
        clearInterval(keepalive);
        unsubscribe?.();
        upstashUnsubscribe?.();
        controller.close();
      };

      if (req.signal.aborted) void abortHandler();
      req.signal.addEventListener("abort", () => void abortHandler(), { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Encoding": "none",
    },
  });
}
