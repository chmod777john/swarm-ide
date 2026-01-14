export const runtime = "nodejs";

import { GLMStreamAssembler, parseSSEJsonLines } from "@/lib/glm-stream";

export async function POST(req: Request) {
  const apiKey = process.env.GLM_API_KEY ?? process.env.ZHIPUAI_API_KEY ?? "";
  if (!apiKey) {
    return Response.json(
      { error: "Missing GLM API key (set GLM_API_KEY or ZHIPUAI_API_KEY)" },
      { status: 500 }
    );
  }

  const body = (await req.json()) as {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    tools?: unknown[];
    thinking?: unknown;
  };

  const model = body.model ?? "glm-4.7";
  const glmUrl =
    process.env.GLM_BASE_URL ??
    "https://open.bigmodel.cn/api/paas/v4/chat/completions";

  const upstream = await fetch(glmUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: body.messages,
      tools: body.tools,
      thinking: body.thinking,
      stream: true,
      tool_stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      { error: "Upstream GLM error", status: upstream.status, body: text },
      { status: 502 }
    );
  }

  const encoder = new TextEncoder();
  const assembler = new GLMStreamAssembler();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of parseSSEJsonLines(upstream.body!)) {
          const state = assembler.push(evt as any);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event: "glm.stream", data: state })}\n\n`)
          );
        }
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ event: "glm.done", data: assembler.snapshot() })}\n\n`
          )
        );
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

