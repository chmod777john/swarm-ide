import type { AssembledToolCall, TokenUsage } from "./glm-stream";

type OpenAIChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string;
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

export type OpenAIAssembledState = {
  reasoningContent: string;
  content: string;
  toolCalls: AssembledToolCall[];
  finishReason?: string | null;
  usage?: TokenUsage;
};

export class OpenAIStreamAssembler {
  private reasoningContent = "";
  private content = "";
  private toolCalls = new Map<number, AssembledToolCall>();
  private finishReason: string | null | undefined = undefined;
  private usage?: TokenUsage;

  push(chunk: OpenAIChunk): OpenAIAssembledState {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;

    const reasoning = delta?.reasoning ?? delta?.reasoning_content;
    if (typeof reasoning === "string") this.reasoningContent += reasoning;
    if (typeof delta?.content === "string") this.content += delta.content;

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

    if (chunk.usage) {
      this.usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
        totalTokens: chunk.usage.total_tokens ?? 0,
      };
    }

    return this.snapshot();
  }

  snapshot(): OpenAIAssembledState {
    return {
      reasoningContent: this.reasoningContent,
      content: this.content,
      toolCalls: [...this.toolCalls.values()].sort((a, b) => a.index - b.index),
      finishReason: this.finishReason,
      usage: this.usage,
    };
  }
}
