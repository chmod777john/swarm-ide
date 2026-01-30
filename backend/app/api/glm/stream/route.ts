export const runtime = "nodejs";

import { GLMStreamAssembler, parseSSEJsonLines } from "@/lib/glm-stream";
import { OpenAIStreamAssembler } from "@/lib/openai-stream";

type LlmProvider = "glm" | "openrouter";

function getProvider(bodyProvider?: string): LlmProvider {
  const raw = (bodyProvider ?? process.env.LLM_PROVIDER ?? "glm").toLowerCase();
  if (raw === "openrouter" || raw === "open-router" || raw === "or") return "openrouter";
  return "glm";
}

function normalizeOpenRouterUrl(value: string) {
  if (!value) return "https://openrouter.ai/api/v1/chat/completions";
  if (value.endsWith("/chat/completions")) return value;
  if (value.endsWith("/api/v1")) return `${value}/chat/completions`;
  if (value.endsWith("/v1")) return `${value}/chat/completions`;
  return value;
}

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const baseUrl = normalizeOpenRouterUrl(
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions"
  );
  const model = process.env.OPENROUTER_MODEL ?? "";
  const httpReferer = process.env.OPENROUTER_HTTP_REFERER ?? "";
  const appTitle = process.env.OPENROUTER_APP_TITLE ?? "";
  return { apiKey, baseUrl, model, httpReferer, appTitle };
}

function stripReasoningFromMessages(
  messages: Array<{ role: string; content: string; tool_calls?: unknown; reasoning_content?: string }>
) {
  return messages.map((msg) => {
    if (msg.role === "tool") return msg;
    const { reasoning_content: _omit, ...rest } = msg;
    return rest;
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    provider?: string;
    model?: string;
    messages: Array<{ role: string; content: string; tool_calls?: unknown; reasoning_content?: string }>;
    tools?: unknown[];
    thinking?: unknown;
  };

  const provider = getProvider(body.provider);
  const encoder = new TextEncoder();

  if (provider === "openrouter") {
    const { apiKey, baseUrl, model, httpReferer, appTitle } = getOpenRouterConfig();
    if (!apiKey) {
      return Response.json(
        { error: "Missing OpenRouter API key (set OPENROUTER_API_KEY)" },
        { status: 500 }
      );
    }

    const payload: Record<string, unknown> = {
      messages: stripReasoningFromMessages(body.messages),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (body.tools) {
      payload.tools = body.tools;
      payload.tool_choice = "auto";
    }
    if (body.model ?? model) {
      payload.model = body.model ?? model;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (httpReferer) headers["HTTP-Referer"] = httpReferer;
    if (appTitle) headers["X-Title"] = appTitle;

    const upstream = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      return Response.json(
        { error: "Upstream OpenRouter error", status: upstream.status, body: text },
        { status: 502 }
      );
    }

    const assembler = new OpenAIStreamAssembler();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const evt of parseSSEJsonLines(upstream.body!)) {
            const state = assembler.push(evt as any);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ event: "llm.stream", data: state })}\n\n`
              )
            );
          }
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ event: "llm.done", data: assembler.snapshot() })}\n\n`
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

  const apiKey = process.env.GLM_API_KEY ?? process.env.ZHIPUAI_API_KEY ?? "";
  if (!apiKey) {
    return Response.json(
      { error: "Missing GLM API key (set GLM_API_KEY or ZHIPUAI_API_KEY)" },
      { status: 500 }
    );
  }

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

  const assembler = new GLMStreamAssembler();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of parseSSEJsonLines(upstream.body!)) {
          const state = assembler.push(evt as any);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event: "llm.stream", data: state })}\n\n`)
          );
        }
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ event: "llm.done", data: assembler.snapshot() })}\n\n`
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
