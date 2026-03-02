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
