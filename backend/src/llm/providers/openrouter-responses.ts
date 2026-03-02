type OpenAiStyleFunctionTool = {
  type: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
};

export function mapToOpenRouterResponsesTools(tools: unknown[]): Array<Record<string, unknown>> {
  const mapped: Array<Record<string, unknown>> = [];

  for (const raw of tools) {
    const tool = raw as OpenAiStyleFunctionTool | null;
    if (!tool || tool.type !== "function" || !tool.function?.name) continue;
    mapped.push({
      type: "function",
      name: tool.function.name,
      description: tool.function.description ?? undefined,
      parameters: tool.function.parameters ?? { type: "object", properties: {} },
    });
  }

  return mapped;
}

export function normalizeOpenRouterResponsesUrl(value: string) {
  if (!value) return "https://openrouter.ai/api/v1/responses";
  if (value.endsWith("/responses")) return value;
  if (value.endsWith("/chat/completions")) {
    return `${value.slice(0, -"/chat/completions".length)}/responses`;
  }
  if (value.endsWith("/api/v1")) return `${value}/responses`;
  if (value.endsWith("/v1")) return `${value}/responses`;
  return value;
}
