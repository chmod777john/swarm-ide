import type {
  CanonicalChunkUpdate,
  CanonicalLlmState,
  CanonicalReasoningDetail,
  CanonicalToolCall,
} from "../core/types";
import type { LlmStreamAdapter } from "./types";

type ItemRecord =
  | { type: "message"; id: string; text: string }
  | { type: "reasoning"; id: string; text: string }
  | { type: "function_call"; id: string; callId: string; name: string; argumentsText: string; index: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toCamelOrSnakeString(record: Record<string, unknown>, camel: string, snake: string): string | undefined {
  return readString(record[camel]) ?? readString(record[snake]);
}

function toCamelOrSnakeNumber(record: Record<string, unknown>, camel: string, snake: string): number | undefined {
  return readNumber(record[camel]) ?? readNumber(record[snake]);
}

function cloneReasoningDetail(detail: CanonicalReasoningDetail): CanonicalReasoningDetail {
  if (typeof structuredClone === "function") return structuredClone(detail);
  return JSON.parse(JSON.stringify(detail)) as CanonicalReasoningDetail;
}

function cloneState(state: CanonicalLlmState): CanonicalLlmState {
  return {
    reasoningContent: state.reasoningContent,
    reasoningDetails: state.reasoningDetails?.map((detail) => cloneReasoningDetail(detail)),
    content: state.content,
    toolCalls: state.toolCalls.map((call) => ({ ...call })),
    finishReason: state.finishReason,
    usage: state.usage ? { ...state.usage } : undefined,
  };
}

export class OpenRouterItemsAdapter implements LlmStreamAdapter {
  private state: CanonicalLlmState = {
    reasoningContent: "",
    reasoningDetails: [],
    content: "",
    toolCalls: [],
    finishReason: undefined,
    usage: undefined,
  };
  private itemsById = new Map<string, ItemRecord>();
  private toolCallsByIndex = new Map<number, CanonicalToolCall>();
  private reasoningDetailsById = new Map<string, CanonicalReasoningDetail>();

  private upsertToolCall(index: number, patch: Partial<CanonicalToolCall>) {
    const existing = this.toolCallsByIndex.get(index) ?? {
      index,
      argumentsText: "",
    };
    const next: CanonicalToolCall = {
      ...existing,
      ...patch,
      index,
      argumentsText: patch.argumentsText ?? existing.argumentsText,
    };
    this.toolCallsByIndex.set(index, next);
    this.state.toolCalls = [...this.toolCallsByIndex.values()].sort((a, b) => a.index - b.index);
    return next;
  }

  private upsertReasoningDetail(raw: Record<string, unknown>, fallbackId: string) {
    const normalized: CanonicalReasoningDetail = { ...raw, type: "reasoning" };
    const id = readString(raw.id) ?? fallbackId;
    normalized.id = id;
    this.reasoningDetailsById.set(id, normalized);
    this.state.reasoningDetails = [...this.reasoningDetailsById.values()].map((detail) =>
      cloneReasoningDetail(detail)
    );
  }

  private upsertReasoningDetailsFromOutput(rawOutput: unknown) {
    if (!Array.isArray(rawOutput)) return;
    for (let i = 0; i < rawOutput.length; i++) {
      const item = asRecord(rawOutput[i]);
      if (!item || readString(item.type) !== "reasoning") continue;
      this.upsertReasoningDetail(item, `reasoning_${i}`);
    }
  }

  push(chunk: unknown): CanonicalChunkUpdate {
    const event = asRecord(chunk) ?? {};
    const eventType = readString(event.type) ?? "";
    let reasoningDelta = "";
    let contentDelta = "";
    const toolCallDeltas: CanonicalChunkUpdate["toolCallDeltas"] = [];

    if (eventType === "response.output_item.added") {
      const item = asRecord(event.item);
      const outputIndex =
        toCamelOrSnakeNumber(event, "outputIndex", "output_index") ?? this.toolCallsByIndex.size;

      if (item) {
        const itemType = readString(item.type) ?? "";
        if (itemType === "message") {
          const id = readString(item.id) ?? `msg_${outputIndex}`;
          this.itemsById.set(id, { type: "message", id, text: "" });
        } else if (itemType === "reasoning") {
          const id = readString(item.id) ?? `reasoning_${outputIndex}`;
          this.itemsById.set(id, { type: "reasoning", id, text: "" });
          this.upsertReasoningDetail(item, id);
        } else if (itemType === "function_call") {
          const id =
            readString(item.id) ??
            toCamelOrSnakeString(item, "callId", "call_id") ??
            `call_${outputIndex}`;
          const callId = toCamelOrSnakeString(item, "callId", "call_id") ?? id;
          const name = readString(item.name) ?? "";
          const argumentsText = readString(item.arguments) ?? "";
          this.itemsById.set(id, {
            type: "function_call",
            id,
            callId,
            name,
            argumentsText,
            index: outputIndex,
          });
          this.upsertToolCall(outputIndex, {
            id: callId,
            name,
            argumentsText,
          });
          if (argumentsText) {
            toolCallDeltas.push({
              index: outputIndex,
              delta: argumentsText,
              toolCallId: callId,
              toolCallName: name,
            });
          }
        }
      }
    }

    if (eventType === "response.output_text.delta") {
      const itemId = toCamelOrSnakeString(event, "itemId", "item_id");
      const delta = readString(event.delta) ?? "";
      if (itemId && delta) {
        const existing = this.itemsById.get(itemId);
        if (existing?.type === "message") {
          existing.text += delta;
          this.itemsById.set(itemId, existing);
        }
        this.state.content += delta;
        contentDelta = delta;
      }
    }

    if (eventType === "response.function_call_arguments.delta") {
      const itemId = toCamelOrSnakeString(event, "itemId", "item_id");
      const outputIndex =
        toCamelOrSnakeNumber(event, "outputIndex", "output_index") ?? this.toolCallsByIndex.size;
      const delta = readString(event.delta) ?? "";
      if (itemId && delta) {
        const existing = this.itemsById.get(itemId);
        if (existing?.type === "function_call") {
          existing.argumentsText += delta;
          this.itemsById.set(itemId, existing);
          this.upsertToolCall(existing.index, {
            id: existing.callId,
            name: existing.name,
            argumentsText: existing.argumentsText,
          });
          toolCallDeltas.push({
            index: existing.index,
            delta,
            toolCallId: existing.callId,
            toolCallName: existing.name,
          });
        } else {
          const fallbackCallId = itemId;
          const fallbackName = "";
          const call = this.upsertToolCall(outputIndex, {
            id: fallbackCallId,
            name: fallbackName,
            argumentsText: (this.toolCallsByIndex.get(outputIndex)?.argumentsText ?? "") + delta,
          });
          toolCallDeltas.push({
            index: outputIndex,
            delta,
            toolCallId: call.id,
            toolCallName: call.name,
          });
        }
      }
    }

    if (
      eventType === "response.reasoning.delta" ||
      eventType === "response.reasoning_text.delta" ||
      eventType === "response.reasoning_summary.delta" ||
      eventType === "response.reasoning_summary_text.delta"
    ) {
      const delta = readString(event.delta) ?? "";
      if (delta) {
        this.state.reasoningContent += delta;
        reasoningDelta = delta;
      }
    }

    if (eventType === "response.output_item.done") {
      const item = asRecord(event.item);
      const outputIndex =
        toCamelOrSnakeNumber(event, "outputIndex", "output_index") ?? this.toolCallsByIndex.size;
      if (item && readString(item.type) === "reasoning") {
        const id = readString(item.id) ?? `reasoning_${outputIndex}`;
        this.itemsById.set(id, { type: "reasoning", id, text: this.state.reasoningContent });
        this.upsertReasoningDetail(item, id);
      }
      if (item && readString(item.type) === "function_call") {
        const id =
          readString(item.id) ?? toCamelOrSnakeString(item, "callId", "call_id") ?? `call_${outputIndex}`;
        const callId = toCamelOrSnakeString(item, "callId", "call_id") ?? id;
        const name = readString(item.name) ?? "";
        const argumentsText = readString(item.arguments) ?? "";
        this.itemsById.set(id, {
          type: "function_call",
          id,
          callId,
          name,
          argumentsText,
          index: outputIndex,
        });
        this.upsertToolCall(outputIndex, {
          id: callId,
          name,
          argumentsText,
        });
      }
    }

    if (eventType === "response.completed" || eventType === "response.incomplete" || eventType === "response.failed") {
      const response = asRecord(event.response);
      if (response) {
        this.upsertReasoningDetailsFromOutput(response.output);
        const status = readString(response.status);
        if (status === "completed" || status === "incomplete" || status === "failed") {
          this.state.finishReason = status;
        }
        const usage = asRecord(response.usage);
        if (usage) {
          const promptTokens =
            readNumber(usage.prompt_tokens) ??
            readNumber(usage.input_tokens) ??
            0;
          const completionTokens =
            readNumber(usage.completion_tokens) ??
            readNumber(usage.output_tokens) ??
            0;
          const totalTokens =
            readNumber(usage.total_tokens) ??
            promptTokens + completionTokens;
          this.state.usage = {
            promptTokens,
            completionTokens,
            totalTokens,
          };
        }
      }
    }

    return {
      state: cloneState(this.state),
      reasoningDelta,
      contentDelta,
      toolCallDeltas,
    };
  }

  snapshot(): CanonicalLlmState {
    return cloneState(this.state);
  }
}
