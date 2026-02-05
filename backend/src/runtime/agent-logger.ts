import { promises as fs } from "node:fs"; // 引入 Node.js 的文件系统模块的 Promise 版本，便于使用 async/await
import path from "node:path"; // 引入 Node.js 的路径处理模块，用来构造跨平台的文件路径

// 定义历史消息类型，描述 LLM 与工具之间交互的不同角色与内容格式
type HistoryMessage =
  | {
      role: "system" | "user" | "assistant"; // 系统、用户或助手的角色
      content: string; // 消息主体文本
      tool_calls?: unknown; // 可选：调用工具的信息（未定义具体结构）
      reasoning_content?: string; // 可选：推理内容
    }
  | { role: "tool"; content: string; tool_call_id?: string; name?: string }; // 工具角色的消息，包含工具 ID 与名称

// 定义历史快照的数据结构，用于保存一次完整交互记录
type HistorySnapshot = {
  at: string; // 生成时间戳（ISO 字符串）
  agentId: string; // 代理/模型的唯一标识
  workspaceId: string; // 工作空间 ID
  groupId: string; // 组 ID
  historyLength: number; // 消息数量
  history: HistoryMessage[]; // 消息数组
};

// 默认日志目录（可通过环境变量覆盖）
const DEFAULT_LOG_DIR = path.join(process.cwd(), ".agent_logs");
const DEFAULT_STREAM_LOG_DIR = path.join(process.cwd(), ".agent_stream_logs");
const DEFAULT_REQUEST_LOG_DIR = path.join(process.cwd(), ".agent_llm_requests");

// 用于序列化写入文件的队列，确保同一代理的日志顺序一致
const streamQueues = new Map<string, Promise<void>>(); // key: agentId, value: 上一个写操作的 promise
const requestQueues = new Map<string, Promise<void>>();

// 存储每个代理流事件的有序缓冲区，用于最终按时间顺序输出
const orderedBuffers = new Map<
  string,
  {
    startedAt?: string; // 流开始时间
    round?: number; // 当前轮次
    writtenKinds: Set<"reasoning" | "content" | "tool_calls" | "tool_result">; // 已写入的种类集合，防止重复
    events: Array<{
      kind: "reasoning" | "content" | "tool_calls" | "tool_result";
      delta: string;
      tool_call_id?: string;
      tool_call_name?: string;
    }>;
  }
>();

// 确保指定目录存在，若不存在则递归创建
async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

// 根据环境变量或默认值返回日志根目录
function getLogDir() {
  return process.env.AGENT_LOG_DIR ?? DEFAULT_LOG_DIR;
}
function getStreamLogDir() {
  return process.env.AGENT_STREAM_LOG_DIR ?? DEFAULT_STREAM_LOG_DIR;
}
function getRequestLogDir() {
  return process.env.AGENT_LLM_REQUEST_LOG_DIR ?? DEFAULT_REQUEST_LOG_DIR;
}

// 将写入任务按代理 ID 排队，保证顺序执行
function enqueueStreamWrite(agentId: string, task: () => Promise<void>) {
  const prev = streamQueues.get(agentId) ?? Promise.resolve(); // 上一个任务，若无则用已完成的 Promise
  const next = prev.catch(() => undefined).then(task); // 捕获错误后继续执行新任务
  streamQueues.set(agentId, next); // 更新队列
  return next;
}
function enqueueRequestWrite(agentId: string, task: () => Promise<void>) {
  const prev = requestQueues.get(agentId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  requestQueues.set(agentId, next);
  return next;
}

// 保存代理历史快照到 JSONL 文件
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

// 处理代理流事件（开始、推理、内容、工具调用等）
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

  // ---------- 处理 "start" 事件 ----------
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

  // ---------- 处理 "done" 事件 ----------
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

  // ---------- 处理 "error" 事件 ----------
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

  // ---------- 处理其他事件（需要 delta） ----------
  if (!input.delta) return; // 若无增量内容则不记录

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
    // 写入失败时保留缓冲区，待 flushOrderedStream 再处理
  }
}

// 保存原始 LLM 请求体到文件（不做解析）
export async function appendAgentLlmRequestRaw(input: { agentId: string; body: string }) {
  const logDir = getRequestLogDir();
  await ensureDir(logDir);
  const filename = path.join(logDir, `agent-${input.agentId}.jsonl`);
  await enqueueRequestWrite(input.agentId, () => fs.appendFile(filename, `${input.body}\n`, "utf-8"));
}

// 写入流事件的统一头部信息（用于标记开始/结束等）
async function writeStreamHeader(agentId: string, logDir: string, text: string) {
  const files = ["content", "reasoning", "tool_calls", "tool_result"].map((suffix) =>
    path.join(logDir, `agent-${agentId}.${suffix}.log`)
  );

  await enqueueStreamWrite(agentId, async () => {
    await Promise.all(files.map((file) => fs.appendFile(file, text, "utf-8")));
  });
}

// 写入具体种类的增量内容
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

// 将有序缓冲区中的事件写入文件，并在必要时生成 fallback 文件
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

  // 对未写入过的种类生成 fallback 文件，确保日志完整性
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

  // 清空缓冲区，准备下一轮
  orderedBuffers.set(input.agentId, {
    startedAt: buffer.startedAt,
    round: buffer.round,
    writtenKinds: new Set(),
    events: [],
  });

  await enqueueStreamWrite(input.agentId, () => fs.appendFile(orderedFile, text, "utf-8"));
}