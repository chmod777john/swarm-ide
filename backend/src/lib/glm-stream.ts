type GLMChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type AssembledToolCall = {
  index: number;
  id?: string;
  name?: string;
  argumentsText: string;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type GLMAssembledState = {
  reasoningContent: string;
  content: string;
  toolCalls: AssembledToolCall[];
  finishReason?: string | null;
  usage?: TokenUsage;
};

export class GLMStreamAssembler {
  private reasoningContent = "";
  private content = "";
  private toolCalls = new Map<number, AssembledToolCall>();
  private finishReason: string | null | undefined = undefined;
  private usage?: TokenUsage;

  push(chunk: GLMChunk): GLMAssembledState {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;

    if (delta?.reasoning_content) this.reasoningContent += delta.reasoning_content;
    if (delta?.content) this.content += delta.content;

    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? 0;
      const existing =
        this.toolCalls.get(index) ??
        ({
          index,
          argumentsText: "",
        } satisfies AssembledToolCall);

      if (call.id) existing.id = call.id;
      if (call.function?.name) existing.name = call.function.name;
      if (typeof call.function?.arguments === "string") {
        existing.argumentsText += call.function.arguments;
      }

      this.toolCalls.set(index, existing);
    }

    if (typeof choice?.finish_reason !== "undefined") {
      this.finishReason = choice.finish_reason;
    }

    // Extract usage when available (usually on the final chunk)
    if (chunk.usage) {
      this.usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        totalTokens: chunk.usage.total_tokens ?? 0,
      };
    }

    return this.snapshot();
  }

  snapshot(): GLMAssembledState {
    return {
      reasoningContent: this.reasoningContent,
      content: this.content,
      toolCalls: [...this.toolCalls.values()].sort((a, b) => a.index - b.index),
      finishReason: this.finishReason,
      usage: this.usage,
    };
  }
}

export async function* parseSSEJsonLines(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) break;
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const lines = rawEvent.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice("data:".length).trim();
        if (!data) continue;
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data);
        } catch {
          // ignore non-json frames
        }
      }
    }
  }
}

