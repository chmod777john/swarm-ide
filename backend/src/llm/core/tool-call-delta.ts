import type { CanonicalLlmState, CanonicalToolCallDelta } from "./types";

type ToolCallChunk = {
  choices?: Array<{
    delta?: {
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

export function extractToolCallDeltas(
  chunk: ToolCallChunk,
  prevState: Pick<CanonicalLlmState, "toolCalls">,
  nextState: Pick<CanonicalLlmState, "toolCalls">
): CanonicalToolCallDelta[] {
  const deltas: CanonicalToolCallDelta[] = [];
  const toolCalls = chunk.choices?.[0]?.delta?.tool_calls ?? [];
  if (toolCalls.length === 0) return deltas;

  const prevByIndex = new Map(prevState.toolCalls.map((call) => [call.index, call]));
  const nextByIndex = new Map(nextState.toolCalls.map((call) => [call.index, call]));

  for (const call of toolCalls) {
    const index = call.index ?? 0;
    const prev = prevByIndex.get(index);
    const next = nextByIndex.get(index);
    const name = call.function?.name ?? next?.name;
    const id = call.id ?? next?.id;
    const argsChunk = call.function?.arguments ?? "";

    if (argsChunk) {
      deltas.push({
        index,
        delta: argsChunk,
        toolCallId: id,
        toolCallName: name,
      });
      continue;
    }

    if (name && name !== prev?.name) {
      deltas.push({
        index,
        delta: "",
        toolCallId: id,
        toolCallName: name,
      });
    }
  }

  return deltas;
}
