import type { LlmProvider } from "../core/types";
import { OpenRouterItemsAdapter } from "./openrouter-items-adapter";
import type { LlmStreamAdapter } from "./types";

export function createLlmStreamAdapter(_provider: LlmProvider): LlmStreamAdapter {
  return new OpenRouterItemsAdapter();
}
