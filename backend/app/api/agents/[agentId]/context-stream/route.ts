export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getAgentRuntime } from "@/runtime/agent-runtime";

function sse(data: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const runtime = getAgentRuntime();
  await runtime.bootstrap();

  const lastEventId = Number(req.headers.get("Last-Event-ID") ?? "0");
  const agent = await store.getAgent({ agentId });
  if (agent.role !== "human") {
    void runtime.wakeAgent(agentId);
  }
  const history = (() => {
    try {
      const parsed = JSON.parse(agent.llmHistory) as Array<{ role: string; content: string }>;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => controller.enqueue(sse(payload));
      const sendKeepalive = () => controller.enqueue(new TextEncoder().encode(`: ping\n\n`));

      send({ event: "agent.history", data: { history } });

      for (const evt of runtime.bus.getSince(agentId, lastEventId)) {
        send(evt);
      }

      const unsubscribe = runtime.bus.subscribe(agentId, (evt) => {
        send(evt);
      });

      const keepalive = setInterval(sendKeepalive, 15_000);

      const abortHandler = () => {
        clearInterval(keepalive);
        unsubscribe();
        controller.close();
      };

      if (req.signal.aborted) abortHandler();
      req.signal.addEventListener("abort", abortHandler, { once: true });
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
