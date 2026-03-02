export type LlmProvider = "openrouter";

export type CanonicalToolCall = {
  index: number;
  id?: string;
  name?: string;
  argumentsText: string;
};

export type CanonicalTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type CanonicalReasoningDetail = Record<string, unknown>;

export type CanonicalLlmState = {
  reasoningContent: string;
  reasoningDetails?: CanonicalReasoningDetail[];
  content: string;
  toolCalls: CanonicalToolCall[];
  finishReason?: string | null;
  usage?: CanonicalTokenUsage;
};

export type CanonicalToolCallDelta = {
  index: number;
  delta: string;
  toolCallId?: string;
  toolCallName?: string;
};

export type CanonicalChunkUpdate = {
  state: CanonicalLlmState;
  reasoningDelta: string;
  contentDelta: string;
  toolCallDeltas: CanonicalToolCallDelta[];
};
