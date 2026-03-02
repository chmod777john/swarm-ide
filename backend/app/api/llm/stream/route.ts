export const runtime = "nodejs";

import { parseSSEJsonLines } from "@/llm/core/sse";
import { createLlmStreamAdapter } from "@/llm/providers";
import {
  mapToOpenRouterResponsesTools,
  normalizeOpenRouterResponsesUrl,
} from "@/llm/providers/openrouter-responses";

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const baseUrl = normalizeOpenRouterResponsesUrl(
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/responses"
  );
  const model = process.env.OPENROUTER_MODEL ?? "";
  const httpReferer = process.env.OPENROUTER_HTTP_REFERER ?? "";
  const appTitle = process.env.OPENROUTER_APP_TITLE ?? "";
  const effortRaw = (process.env.OPENROUTER_REASONING_EFFORT ?? "").trim().toLowerCase();
  const reasoningEffort =
    effortRaw === "low" || effortRaw === "medium" || effortRaw === "high" ? effortRaw : "";
  return { apiKey, baseUrl, model, httpReferer, appTitle, reasoningEffort };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createDownstreamSseStream(
  upstreamBody: ReadableStream<Uint8Array>,
  encoder: TextEncoder
) {
  const adapter = createLlmStreamAdapter("openrouter");
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of parseSSEJsonLines(upstreamBody)) {
          const { state } = adapter.push(evt);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event: "llm.stream", data: state })}\n\n`)
          );
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ event: "llm.done", data: adapter.snapshot() })}\n\n`)
        );
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

function createSseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    model?: string;
    input?: unknown;
    tools?: unknown[];
    reasoning?: unknown;
  };

  const encoder = new TextEncoder();
  const { apiKey, baseUrl, model, httpReferer, appTitle, reasoningEffort } = getOpenRouterConfig();
  if (!apiKey) {
    return Response.json(
      { error: "Missing OpenRouter API key (set OPENROUTER_API_KEY)" },
      { status: 500 }
    );
  }

  if (body.input === undefined) {
    return Response.json(
      { error: "Missing input (OpenRouter /responses request body requires input)" },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    input: body.input,
    stream: true,
  };
  if (body.tools) {
    payload.tools = mapToOpenRouterResponsesTools(body.tools);
    payload.tool_choice = "auto";
  }
  if (body.model ?? model) {
    payload.model = body.model ?? model;
  }
  if (body.reasoning === true) {
    payload.reasoning = { effort: "medium" };
  } else if (isRecord(body.reasoning)) {
    payload.reasoning = body.reasoning;
  } else if (body.reasoning === undefined && reasoningEffort) {
    payload.reasoning = { effort: reasoningEffort };
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

  const stream = createDownstreamSseStream(upstream.body, encoder);
  return createSseResponse(stream);
}
