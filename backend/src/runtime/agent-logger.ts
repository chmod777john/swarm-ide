import { promises as fs } from "node:fs";
import path from "node:path";

type HistoryMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
      tool_calls?: unknown;
      reasoning_content?: string;
    }
  | { role: "tool"; content: string; tool_call_id?: string; name?: string };

type HistorySnapshot = {
  at: string;
  agentId: string;
  workspaceId: string;
  groupId: string;
  historyLength: number;
  history: HistoryMessage[];
};

const DEFAULT_LOG_DIR = path.join(process.cwd(), ".agent_logs");
const DEFAULT_STREAM_LOG_DIR = path.join(process.cwd(), ".agent_stream_logs");
const DEFAULT_REQUEST_LOG_DIR = path.join(process.cwd(), ".agent_llm_requests");
const streamQueues = new Map<string, Promise<void>>();
const requestQueues = new Map<string, Promise<void>>();
const orderedBuffers = new Map<
  string,
  {
    startedAt?: string;
    round?: number;
    writtenKinds: Set<"reasoning" | "content" | "tool_calls" | "tool_result">;
    events: Array<{
      kind: "reasoning" | "content" | "tool_calls" | "tool_result";
      delta: string;
      tool_call_id?: string;
      tool_call_name?: string;
    }>;
  }
>();

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function getLogDir() {
  return process.env.AGENT_LOG_DIR ?? DEFAULT_LOG_DIR;
}

function getStreamLogDir() {
  return process.env.AGENT_STREAM_LOG_DIR ?? DEFAULT_STREAM_LOG_DIR;
}

function getRequestLogDir() {
  return process.env.AGENT_LLM_REQUEST_LOG_DIR ?? DEFAULT_REQUEST_LOG_DIR;
}

function enqueueStreamWrite(agentId: string, task: () => Promise<void>) {
  const prev = streamQueues.get(agentId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  streamQueues.set(agentId, next);
  return next;
}

function enqueueRequestWrite(agentId: string, task: () => Promise<void>) {
  const prev = requestQueues.get(agentId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  requestQueues.set(agentId, next);
  return next;
}

export async function appendAgentHistorySnapshot(input: {
  agentId: string;
  workspaceId: string;
  groupId: string;
  history: HistoryMessage[];
}) {
  const logDir = getLogDir();
  await ensureDir(logDir);

  const snapshot: HistorySnapshot = {
    at: new Date().toISOString(),
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    groupId: input.groupId,
    historyLength: input.history.length,
    history: input.history,
  };

  const filename = path.join(logDir, `agent-${input.agentId}.jsonl`);
  await fs.appendFile(filename, `${JSON.stringify(snapshot)}\n`, "utf-8");
}

export async function appendAgentStreamEvent(input: {
  agentId: string;
  round?: number;
  kind: "start" | "reasoning" | "content" | "tool_calls" | "tool_result" | "done" | "error";
  delta?: string;
  finishReason?: string | null;
  tool_call_id?: string;
  tool_call_name?: string;
  error?: string;
}) {
  const logDir = getStreamLogDir();
  await ensureDir(logDir);

  const now = new Date().toISOString();

  if (input.kind === "start") {
    orderedBuffers.set(input.agentId, {
      startedAt: now,
      round: input.round,
      writtenKinds: new Set(),
      events: [],
    });
    const header = `\n\n=== LLM start @ ${now}${input.round != null ? ` (round ${input.round})` : ""} ===\n`;
    await writeStreamHeader(input.agentId, logDir, header);
    return;
  }

  if (input.kind === "done") {
    await flushOrderedStream({
      agentId: input.agentId,
      logDir,
      finishedAt: now,
      finishReason: input.finishReason ?? null,
    });
    const footer = `\n\n=== LLM done @ ${now}${input.finishReason ? ` (finishReason: ${input.finishReason})` : ""} ===\n`;
    await writeStreamHeader(input.agentId, logDir, footer);
    return;
  }

  if (input.kind === "error") {
    const message = input.error ?? "Unknown error";
    const header = `\n\n=== LLM error @ ${now} ===\n${message}\n`;
    await writeStreamHeader(input.agentId, logDir, header);
    await flushOrderedStream({
      agentId: input.agentId,
      logDir,
      finishedAt: now,
      finishReason: "error",
    });
    return;
  }

  if (!input.delta) return;

  const buffers =
    orderedBuffers.get(input.agentId) ??
    {
      startedAt: now,
      round: input.round,
      writtenKinds: new Set(),
      events: [],
    };
  buffers.events.push({
    kind: input.kind,
    delta: input.delta,
    tool_call_id: input.tool_call_id,
    tool_call_name: input.tool_call_name,
  });
  orderedBuffers.set(input.agentId, buffers);

  try {
    await appendKindDelta({
      agentId: input.agentId,
      logDir,
      kind: input.kind,
      delta: input.delta,
      tool_call_id: input.tool_call_id,
      tool_call_name: input.tool_call_name,
    });
    buffers.writtenKinds.add(input.kind);
  } catch {
    // keep buffer for fallback flush
  }
}

export async function appendAgentLlmRequestRaw(input: { agentId: string; body: string }) {
  const logDir = getRequestLogDir();
  await ensureDir(logDir);
  const filename = path.join(logDir, `agent-${input.agentId}.jsonl`);
  await enqueueRequestWrite(input.agentId, () => fs.appendFile(filename, `${input.body}\n`, "utf-8"));
}

async function writeStreamHeader(agentId: string, logDir: string, text: string) {
  const files = ["content", "reasoning", "tool_calls", "tool_result"].map((suffix) =>
    path.join(logDir, `agent-${agentId}.${suffix}.log`)
  );

  await enqueueStreamWrite(agentId, async () => {
    await Promise.all(files.map((file) => fs.appendFile(file, text, "utf-8")));
  });
}

async function appendKindDelta(input: {
  agentId: string;
  logDir: string;
  kind: "reasoning" | "content" | "tool_calls" | "tool_result";
  delta: string;
  tool_call_id?: string;
  tool_call_name?: string;
}) {
  const filename = path.join(input.logDir, `agent-${input.agentId}.${input.kind}.log`);
  let text = input.delta;

  if (input.kind === "tool_calls" || input.kind === "tool_result") {
    const meta = input.tool_call_name ?? input.tool_call_id;
    if (meta) text = `(${meta}) ${text}`;
  }

  await enqueueStreamWrite(input.agentId, () => fs.appendFile(filename, text, "utf-8"));
}

async function flushOrderedStream(input: {
  agentId: string;
  logDir: string;
  finishedAt: string;
  finishReason: string | null;
}) {
  const buffer = orderedBuffers.get(input.agentId);
  if (!buffer) return;

  const lines: string[] = [];
  const header = `\n\n=== LLM ordered @ ${input.finishedAt}${
    buffer.round != null ? ` (round ${buffer.round})` : ""
  }${input.finishReason ? ` (finishReason: ${input.finishReason})` : ""} ===\n`;
  lines.push(header);

  let lastKind: string | null = null;
  for (const evt of buffer.events) {
    if (evt.kind !== lastKind) {
      lastKind = evt.kind;
      const label =
        evt.kind === "reasoning"
          ? "REASONING"
          : evt.kind === "content"
            ? "CONTENT"
            : evt.kind === "tool_calls"
              ? "TOOL_CALLS"
              : "TOOL_RESULT";
      lines.push(`\n\n[${label}]\n`);
    }
    if (evt.kind === "tool_calls" || evt.kind === "tool_result") {
      const meta = evt.tool_call_name ?? evt.tool_call_id;
      if (meta) lines.push(`(${meta}) `);
    }
    lines.push(evt.delta);
  }

  const orderedFile = path.join(input.logDir, `agent-${input.agentId}.ordered.log`);
  const text = lines.join("");
  if (!text) return;

  const fallbackKinds = ["reasoning", "content", "tool_calls", "tool_result"] as const;
  for (const kind of fallbackKinds) {
    if (buffer.writtenKinds.has(kind)) continue;
    const fallbackText = buffer.events
      .filter((evt) => evt.kind === kind)
      .map((evt) => {
        if (kind === "tool_calls" || kind === "tool_result") {
          const meta = evt.tool_call_name ?? evt.tool_call_id;
          if (meta) return `(${meta}) ${evt.delta}`;
        }
        return evt.delta;
      })
      .join("");
    if (fallbackText) {
      const fallbackFile = path.join(input.logDir, `agent-${input.agentId}.${kind}.log`);
      await enqueueStreamWrite(input.agentId, () =>
        fs.appendFile(fallbackFile, fallbackText, "utf-8")
      );
    }
  }

  orderedBuffers.set(input.agentId, {
    startedAt: buffer.startedAt,
    round: buffer.round,
    writtenKinds: new Set(),
    events: [],
  });

  await enqueueStreamWrite(input.agentId, () => fs.appendFile(orderedFile, text, "utf-8"));
}
