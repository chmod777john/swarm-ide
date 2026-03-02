import type { CanonicalChunkUpdate, CanonicalLlmState } from "../core/types";

export interface LlmStreamAdapter {
  push(chunk: unknown): CanonicalChunkUpdate;
  snapshot(): CanonicalLlmState;
}
