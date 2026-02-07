import { store } from "@/lib/storage";
import { GLMStreamAssembler, parseSSEJsonLines } from "@/lib/glm-stream";
import { OpenAIStreamAssembler } from "@/lib/openai-stream";

import { AgentEventBus } from "./event-bus";
import { createDeferred, safeJsonParse } from "./utils";
import { getWorkspaceUIBus } from "./ui-bus";
import { getMcpRegistry } from "./mcp";
import { appendAgentHistorySnapshot, appendAgentLlmRequestRaw, appendAgentStreamEvent } from "./agent-logger";
import { formatSkillPrompt, getSkillLoader } from "./skill-loader";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

// ------------------------------------
// 基本类型定义
// ------------------------------------
/** 代表 UUID 的字符串 */
type UUID = string;

/**
 * 历史消息的结构。
 *
 * - role 表示角色：system、user、assistant 或 tool
 * - content 是实际文本内容
 * - 对于工具调用，可能携带 tool_calls 和 reasoning_content 等字段
 */
type HistoryMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
      // 调用的工具列表（如果有）
      tool_calls?: unknown;
      // GPT 在思考过程中的文字（若支持）
      reasoning_content?: string;
    }
  | { role: "tool"; content: string; tool_call_id?: string; name?: string };

/**
 * 表示一次工具调用的信息。
 *
 * - index：在 LLM 输出中的索引
 * - id：工具调用的唯一标识
 * - name：工具名称
 * - argumentsText：传递给工具的参数字符串（JSON 格式）
 */
type ToolCall = {
  index: number;
  id?: string;
  name?: string;
  argumentsText: string;
};

// ------------------------------------
// 一些常量
// ------------------------------------
/** 当技能块已加载时在 system 消息中插入的标记符号 */
const SKILLS_MARKER = "[skills:loaded]";

/** 以下工具名称需要发送消息（不做其他处理） */
const SEND_TOOL_NAMES = new Set(["send", "send_group_message", "send_direct_message"]);

// ------------------------------------
// 工具相关函数
// ------------------------------------
/**
 * 构建技能块字符串。
 *
 * 读取所有已加载的技能，格式化为可直接放入 system 消息的内容。
 */
async function buildSkillsBlock(): Promise<string> {
  try {
    const loader = await getSkillLoader();
    const skillsMetadata = await loader.getSkillsMetadataPrompt();
    const autoSkills = await loader.listAutoLoadSkills();
    // 将每个技能转换为提示字符串，并用两个换行符分隔
    const autoBlocks = autoSkills.map((skill) => formatSkillPrompt(skill)).join("\n\n");
    // 只保留非空的块
    const skillsParts = [skillsMetadata, autoBlocks].filter((part) => part && part.trim());
    if (skillsParts.length === 0) return "";
    return `${SKILLS_MARKER}\n\n${skillsParts.join("\n\n")}`;
  } catch {
    // 若任何错误，返回空字符串
    return "";
  }
}

/**
 * 判断历史消息中是否已包含技能块标记。
 */
function historyHasSkills(history: HistoryMessage[]) {
  return history.some(
    (msg) =>
      msg.role === "system" &&
      typeof msg.content === "string" &&
      msg.content.includes(SKILLS_MARKER)
  );
}

/**
 * 把内部使用的历史消息转换为 OpenRouter 所期望的结构。
 *
 * - tool 消息保持不变
 * - assistant 的 reasoning_content 转成 reasoning 字段
 */
function mapOpenRouterMessages(history: HistoryMessage[]): Array<Record<string, unknown>> {
  return history.map((msg) => {
    if (msg.role === "tool") return msg;

    const { reasoning_content, ...rest } = msg as Exclude<HistoryMessage, { role: "tool" }>;
    const mapped: Record<string, unknown> = { ...rest };

    if (msg.role === "assistant" && reasoning_content) {
      mapped.reasoning = reasoning_content;
    }

    return mapped;
  });
}

// ------------------------------------
// Agent 工具列表
// ------------------------------------
/** 内置的工具定义（会被 LLM 调用）。 */
const AGENT_TOOLS = [
  // 工具：创建子代理
  {
    type: "function",
    function: {
      name: "create",
      description:
        "Create a sub-agent with the given role for delegation. Returns {agentId}.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: {
            type: "string",
            description: "Role name for the new agent, e.g. coder/researcher/reviewer",
          },
          guidance: {
            type: "string",
            description: "Extra system guidance to seed the new agent.",
          },
        },
        required: ["role"],
      },
    },
  },
  // 工具：返回当前代理身份
  {
    type: "function",
    function: {
      name: "self",
      description: "Return the current agent's identity (agent_id, workspace_id, role).",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  // 工具：获取技能内容
  {
    type: "function",
    function: {
      name: "get_skill",
      description:
        "Load the full content of a specific skill by name (use when the skill metadata indicates relevance).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          skill_name: { type: "string", description: "Skill name to retrieve" },
        },
        required: ["skill_name"],
      },
    },
  },
  // 工具：列出所有代理
  {
    type: "function",
    function: {
      name: "list_agents",
      description: "List all agents in the current workspace (ids + roles).",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  // 工具：发送直接消息
  {
    type: "function",
    function: {
      name: "send",
      description:
        "Send a direct message to another agent_id. The IM storage (group) is created/selected automatically.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          to: { type: "string", description: "Target agent_id" },
          content: { type: "string", description: "Message content" },
        },
        required: ["to", "content"],
      },
    },
  },
  // 工具：列出可见的群组
  {
    type: "function",
    function: {
      name: "list_groups",
      description: "List visible groups for this agent.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  // 工具：列出群组成员
  {
    type: "function",
    function: {
      name: "list_group_members",
      description: "List member ids for a group.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "string", description: "Target group id" },
        },
        required: ["groupId"],
      },
    },
  },
  // 工具：创建群组
  {
    type: "function",
    function: {
      name: "create_group",
      description: "Create a group with the given member ids.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          memberIds: { type: "array", items: { type: "string" } },
          name: { type: "string" },
        },
        required: ["memberIds"],
      },
    },
  },
  // 工具：向群组发送消息
  {
    type: "function",
    function: {
      name: "send_group_message",
      description: "Send a message to a group.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "string" },
          content: { type: "string" },
          contentType: { type: "string" },
        },
        required: ["groupId", "content"],
      },
    },
  },
  // 工具：向单个代理发送直接消息
  {
    type: "function",
    function: {
      name: "send_direct_message",
      description:
        "Send a direct message to another agent. Creates or reuses a P2P group and returns the channel type.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          toAgentId: { type: "string" },
          content: { type: "string" },
          contentType: { type: "string" },
        },
        required: ["toAgentId", "content"],
      },
    },
  },
  // 工具：获取群组消息
  {
    type: "function",
    function: {
      name: "get_group_messages",
      description: "Fetch full message history for a group.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "string" },
        },
        required: ["groupId"],
      },
    },
  },
  // 工具：执行 shell 命令
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a shell command on the server. Returns stdout/stderr/exitCode. Use for debugging or file operations.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          cwd: { type: "string", description: "Working directory (relative to workspace root or absolute)" },
          timeoutMs: { type: "number", description: "Timeout in milliseconds (default 120000)" },
          maxOutputKB: { type: "number", description: "Maximum combined output size in KB (default 1024)" },
        },
        required: ["command"],
      },
    },
  },
  // 工具：删除代理
  {
    type: "function",
    function: {
      name: "delete_agent",
      description: "Delete a specified sub-agent. Returns success status.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          agentId: {
            type: "string",
            description: "ID of the agent to delete",
          },
          force: {
            type: "boolean",
            description: "Force deletion without confirmation (default: false)",
          },
        },
        required: ["agentId"],
      },
    },
  },
] as const;

// ------------------------------------
// 工具相关
// ------------------------------------
/** 所有内置工具名称的集合，方便快速判断 */
const BUILTIN_TOOL_NAMES = new Set(AGENT_TOOLS.map((tool) => tool.function.name));

/**
 * 加载所有可用工具（包括内部工具和外部插件）。
 *
 * @param loadTimeoutMs 超时毫秒
 */
async function getAgentTools() {
  const loadTimeoutMs =
    Number(process.env.MCP_LOAD_TIMEOUT_MS) > 0 ? Number(process.env.MCP_LOAD_TIMEOUT_MS) : 2000;
  // 获取插件管理器实例，并注册所有工具
  const mcp = await getMcpRegistry(BUILTIN_TOOL_NAMES, { loadTimeoutMs });
  const mcpTools = mcp.getToolDefinitions();
  return [...AGENT_TOOLS, ...mcpTools];
}

/**
 * GLM（大模型）API 的配置。
 *
 * @throws 当缺少 API Key 时抛错
 */
function getGlmConfig() {
  const apiKey = process.env.GLM_API_KEY ?? process.env.ZHIPUAI_API_KEY ?? "";
  const baseUrl =
    process.env.GLM_BASE_URL ??
    "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const model = process.env.GLM_MODEL ?? "glm-4.7";

  if (!apiKey) {
    throw new Error("Missing GLM API key (set GLM_API_KEY or ZHIPUAI_API_KEY)");
  }

  return { apiKey, baseUrl, model };
}

/** 可用的 LLM 提供商 */
type LlmProvider = "glm" | "openrouter";

/**
 * 根据环境变量判断使用哪个 LLM 提供商。
 *
 * 默认使用 "glm"，支持 openrouter、open-router 或 or 的缩写。
 */
function getLlmProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? "glm").toLowerCase();
  if (raw === "openrouter" || raw === "open-router" || raw === "or") return "openrouter";
  return "glm";
}

/** 标准化 OpenRouter 的 baseUrl */
function normalizeOpenRouterUrl(value: string) {
  if (!value) return "https://openrouter.ai/api/v1/chat/completions";
  if (value.endsWith("/chat/completions")) return value;
  if (value.endsWith("/api/v1")) return `${value}/chat/completions`;
  if (value.endsWith("/v1")) return `${value}/chat/completions`;
  return value;
}

/** OpenRouter 的配置 */
function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const baseUrl = normalizeOpenRouterUrl(
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions"
  );
  const model = process.env.OPENROUTER_MODEL ?? "";
  const httpReferer = process.env.OPENROUTER_HTTP_REFERER ?? "";
  const appTitle = process.env.OPENROUTER_APP_TITLE ?? "";

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  return { apiKey, baseUrl, model, httpReferer, appTitle };
}

// ------------------------------------
// AgentRunner：负责单个代理的工作循环
// ------------------------------------
class AgentRunner {
  private wake = createDeferred<void>();
  private started = false;
  private running = false;
  private interruptRequested = false;

  constructor(
    private readonly agentId: UUID,
    private readonly bus: AgentEventBus,
    private readonly ensureRunner: (agentId: UUID) => void,
    private readonly wakeAgent: (agentId: UUID) => void
  ) {}

  /** 启动代理的主循环 */
  start() {
    if (this.started) return;
    this.started = true;
    // 先确保技能块已加载到历史记录中
    void this.ensureSkillsLoaded();
    // 开始轮询
    void this.loop();
  }

  /** 确保当前代理的历史消息里已经包含了技能块 */
  private async ensureSkillsLoaded() {
    try {
      const agent = await store.getAgent({ agentId: this.agentId });
      const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
      const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];
      if (historyHasSkills(history)) return;
      const skillsBlock = await buildSkillsBlock();
      if (!skillsBlock) return;
      history.push({ role: "system", content: skillsBlock });
      await store.setAgentHistory({
        agentId: this.agentId,
        llmHistory: JSON.stringify(history),
      });
    } catch {
      // 最好努力不抛错误
    }
  }

  /** 手动唤醒代理，触发一次处理 */
  wakeup(reason: "manual" | "group_message" | "direct_message" | "context_stream" = "manual") {
    this.wake.resolve();
    this.wake = createDeferred<void>();
    this.bus.emit(this.agentId, {
      event: "agent.wakeup",
      data: { agentId: this.agentId, reason },
    });
  }

  requestInterrupt() {
    this.interruptRequested = true;
    this.wake.resolve();
    this.wake = createDeferred<void>();
  }

  private consumeInterruptRequest() {
    if (!this.interruptRequested) return false;
    this.interruptRequested = false;
    return true;
  }

  /** 主循环：等待唤醒后开始处理未读消息 */
  private async loop() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.wake.promise;
      if (this.running) continue; // 已在运行时忽略新唤醒
      this.running = true;
      try {
        await this.processUntilIdle();
      } catch (err) {
        // 记录错误事件到 bus 和日志
        this.bus.emit(this.agentId, {
          event: "agent.error",
          data: { message: err instanceof Error ? err.message : String(err) },
        });
        const message = err instanceof Error ? err.message : String(err);
        void appendAgentStreamEvent({
          agentId: this.agentId,
          kind: "error",
          error: message,
        });
      } finally {
        this.running = false;
      }
    }
  }

  /** 循环处理直到所有未读消息都被消费 */
  private async processUntilIdle() {
    // 若代理是 human 类型则直接返回
    const role = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
    if (role === "human" || role === null) return;
    if (this.consumeInterruptRequest()) return;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // 查询未读消息批次（按群组拆分）
      if (this.consumeInterruptRequest()) return;
      const batches = await store.listUnreadByGroup({ agentId: this.agentId });
      if (batches.length === 0) return; // 无更多未读

      // 通知 UI 层有未读
      this.bus.emit(this.agentId, {
        event: "agent.unread",
        data: {
          agentId: this.agentId,
          batches: batches.map((batch) => ({
            groupId: batch.groupId,
            messageIds: batch.messages.map((m) => m.id),
          })),
        },
      });

      // 逐批处理
      for (const batch of batches) {
        if (this.consumeInterruptRequest()) return;
        await this.processGroupUnread(batch.groupId, batch.messages);
        if (this.consumeInterruptRequest()) return;
      }
    }
  }

  /** 对单个群组的未读消息进行处理 */
  private async processGroupUnread(
    groupId: UUID,
    unreadMessages: Array<{
      id: UUID;
      senderId: UUID;
      content: string;
      contentType: string;
      sendTime: string;
    }>
  ) {
    const workspaceId = await store.getGroupWorkspaceId({ groupId });
    const agent = await store.getAgent({ agentId: this.agentId });
    const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
    const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];
    // 确保技能块已加载
    const skillsBlock = await buildSkillsBlock();
    const hasSkills = historyHasSkills(history);

    if (history.length === 0) {
      // 第一次消息，构建初始 system 消息
      const role = agent.role;
      history.push({
        role: "system",
        content:
          `You are an agent in an IM system.\n` +
          `Your agent_id is: ${this.agentId}.\n` +
          `Your workspace_id is: ${workspaceId}.\n` +
          `Your role is: ${role}.\n` +
          `Act strictly as this role when replying. Be concise and helpful.\n` +
          `Your replies are NOT automatically delivered to humans.\n` +
          `To send messages, you MUST call tools like send_group_message or send_direct_message.\n` +
          `If you need to coordinate with other agents, you may use tools like self, list_agents, create, send, list_groups, list_group_members, create_group, send_group_message, send_direct_message, and get_group_messages.\n` +
          `If you need to run shell commands, use the bash tool.` +
          (skillsBlock ? `\n\n${skillsBlock}` : ""),
      });
    } else if (skillsBlock && !hasSkills) {
      // 之后若无技能块则插入
      history.push({ role: "system", content: skillsBlock });
    }

    // 将未读消息拼接成一条 user 消息，按群组和发送者格式化
    const userContent = unreadMessages
      .map((m) => `[group:${groupId}] ${m.senderId}: ${m.content}`)
      .join("\n");
    history.push({ role: "user", content: userContent });

    // 标记该群组已读到最后一条消息
    const lastId = unreadMessages[unreadMessages.length - 1]?.id;
    if (lastId) {
      await store.markGroupReadToMessage({ groupId, readerId: this.agentId, messageId: lastId });
    }

    // 进入工具调用循环，获得代理回复
    const { assistantText, assistantThinking, didSend } = await this.runWithTools({
      groupId,
      workspaceId,
      history,
    });

    // 将 LLM 输出追加到历史
    history.push({
      role: "assistant",
      content: assistantText,
      reasoning_content: assistantThinking || undefined,
    });

    if (!didSend && !this.interruptRequested) {
      history.push({
        role: "user",
        content:
          "Reminder: 本轮未调用 send_*。先判断是否需要对外可见；需要时使用 send_group_message 或 send_direct_message，无需时可不发送。",
      });

      // 再次运行一次工具循环，强制让代理做出决定
      const followup = await this.runWithTools({
        groupId,
        workspaceId,
        history,
      });

      history.push({
        role: "assistant",
        content: followup.assistantText,
        reasoning_content: followup.assistantThinking || undefined,
      });
    }
    // 保存最终历史到持久化存储
    await store.setAgentHistory({
      agentId: this.agentId,
      llmHistory: JSON.stringify(history),
      workspaceId,
    });

    // 记录快照日志（仅限调试）
    try {
      await appendAgentHistorySnapshot({
        agentId: this.agentId,
        workspaceId,
        groupId,
        history,
      });
    } catch {
      // best-effort logging
    }
    // 通知 UI 层历史已保存
    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.agent.history.persisted",
      data: { workspaceId, agentId: this.agentId, groupId, historyLength: history.length },
    });
  }

  /** 与 LLM 交互，支持工具调用并返回最终文本 */
  private async runWithTools(input: {
    groupId: UUID;
    workspaceId: UUID;
    history: HistoryMessage[];
  }) {
    const maxToolRounds = 3; // 限制最多三轮工具调用
    let assistantText = "";
    let assistantThinking = "";
    let didSend = false;

    for (let round = 0; round < maxToolRounds; round++) {
      const res = await this.callLlmStreaming(input.history, {
        workspaceId: input.workspaceId,
        groupId: input.groupId,
        round,
      });
      assistantText = res.assistantText;
      assistantThinking = res.assistantThinking;

      if (res.toolCalls.length === 0) {
        // 若本轮无工具调用，直接返回
        return { assistantText, assistantThinking, didSend };
      }

      // 将工具调用记录为 assistant 消息（方便后续追踪）
      input.history.push({
        role: "assistant",
        content: res.assistantText,
        tool_calls: res.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.argumentsText },
        })),
        reasoning_content: res.assistantThinking || undefined,
      });

      // 遍历每个工具调用，执行并把结果回写到历史
      for (const call of res.toolCalls) {
        if (call.name && SEND_TOOL_NAMES.has(call.name)) {
          didSend = true; // 记录已发送
        }
        const result = await this.executeToolCall({
          groupId: input.groupId,
          call,
        });
        // 向 bus 和 UI 发送工具调用结果事件
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: {
            kind: "tool_result",
            delta: JSON.stringify(result),
            tool_call_id: call.id,
            tool_call_name: call.name,
          },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round,
          kind: "tool_result",
          delta: JSON.stringify(result),
          tool_call_id: call.id,
          tool_call_name: call.name,
        });

        // 记录工具结果到历史
        input.history.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: call.id,
          name: call.name,
        });
      }
    }

    return { assistantText, assistantThinking, didSend };
  }

  /** 根据具体 LLM 提供商调用流式接口并解析结果 */
  private async executeToolCall(input: { groupId: UUID; call: ToolCall }) {
    const name = input.call.name ?? "";
    const workspaceId = await store.getGroupWorkspaceId({ groupId: input.groupId });
    const toolMeta = { toolCallId: input.call.id, toolName: input.call.name };

    // 通知 UI 层工具调用开始
    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.agent.tool_call.start",
      data: {
        workspaceId,
        agentId: this.agentId,
        groupId: input.groupId,
        toolCallId: toolMeta.toolCallId,
        toolName: toolMeta.toolName,
      },
    });

    // 结束标记工具调用
    const emitToolDone = (ok: boolean) => {
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.agent.tool_call.done",
        data: {
          workspaceId,
          agentId: this.agentId,
          groupId: input.groupId,
          toolCallId: toolMeta.toolCallId,
          toolName: toolMeta.toolName,
          ok,
        },
      });
    };

    // 下面是对每个工具名称的实现
    if (name === "self") {
      const role = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
      emitToolDone(true);
      return { ok: true, agentId: this.agentId, workspaceId, role };
    }

    if (name === "get_skill") {
      const args = safeJsonParse<{ skill_name?: string; name?: string }>(
        input.call.argumentsText,
        {}
      );
      const skillName = (args.skill_name ?? args.name ?? "").trim();
      if (!skillName) {
        emitToolDone(false);
        return { ok: false, error: "Missing skill_name" };
      }

      const loader = await getSkillLoader();
      const skill = await loader.getSkill(skillName);
      if (!skill) {
        emitToolDone(false);
        return { ok: false, error: `Unknown skill: ${skillName}`, available: await loader.listSkills() };
      }

      emitToolDone(true);
      return { ok: true, content: formatSkillPrompt(skill) };
    }

    if (name === "bash") {
      const args = safeJsonParse<{
        command?: string;
        cwd?: string;
        timeoutMs?: number;
        maxOutputKB?: number;
      }>(input.call.argumentsText, {});
      const command = (args.command ?? "").trim();
      if (!command) {
        emitToolDone(false);
        return { ok: false, error: "Missing command" };
      }

      // 确定工作目录
      const workspaceRoot = process.env.AGENT_WORKDIR ?? process.cwd();
      const requestedCwd = (args.cwd ?? "").trim();
      let finalCwd = workspaceRoot;
      if (requestedCwd) {
        const resolved = path.isAbsolute(requestedCwd)
          ? requestedCwd
          : path.resolve(workspaceRoot, requestedCwd);
        const rootResolved = path.resolve(workspaceRoot);
        if (!resolved.startsWith(rootResolved)) {
          emitToolDone(false);
          return { ok: false, error: "cwd must be within workspace root", workspaceRoot };
        }
        finalCwd = resolved;
      }

      const timeoutMs = Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : 120000;
      const maxOutputKB = Number(args.maxOutputKB) > 0 ? Number(args.maxOutputKB) : 1024;
      const maxBuffer = Math.max(64 * 1024, Math.floor(maxOutputKB * 1024));
      const execAsync = promisify(exec);

      // 根据平台构建 shell 执行方案
      let shellPath: string;
      let shellArgs: string[] = [];
      let fallbackShells: Array<{path: string, args: string[]}> = [];

      if (process.platform === "win32") {
        fallbackShells = [];

        if (typeof process.env.ComSpec === "string" && process.env.ComSpec.includes("powershell")) {
          fallbackShells.push({ path: process.env.ComSpec, args: ["-Command"] });
        }

        fallbackShells.push({ path: "powershell.exe", args: ["-Command"] });

        fallbackShells.push({ path: "pwsh.exe", args: ["-Command"] });

        if (typeof process.env.ComSpec === "string" && !process.env.ComSpec.includes("powershell")) {
          fallbackShells.push({ path: process.env.ComSpec, args: ["/C"] });
        }
        fallbackShells.push({ path: "cmd.exe", args: ["/C"] });

        fallbackShells.push({ path: "wsl.exe", args: ["bash", "-c"] });
      } else {
        fallbackShells = [];

        if (typeof process.env.SHELL === "string") {
          fallbackShells.push({ path: process.env.SHELL, args: ["-c"] });
        }

        if (process.platform === "darwin") {
          fallbackShells.push({ path: "/bin/zsh", args: ["-c"] });
        }

        fallbackShells.push({ path: "/bin/bash", args: ["-c"] });
        fallbackShells.push({ path: "/bin/zsh", args: ["-c"] });
        fallbackShells.push({ path: "/bin/sh", args: ["-c"] });
        fallbackShells.push({ path: "/bin/fish", args: ["-c"] });
      }

      // 按优先级尝试每个 shell，直到成功
      let lastError: any = null;
      for (const shell of fallbackShells) {
        try {
          shellPath = shell.path;
          shellArgs = shell.args;

          let finalCommand = command;

          if (shellPath.includes("wsl.exe") || shellPath.includes("wsl")) {
            const escapedCommand = command.replace(/"/g, '\\"').replace(/\$/g, '\\$');
            finalCommand = `bash -c "${escapedCommand}"`;
          }

          const { stdout, stderr } = await execAsync(finalCommand, {
            cwd: finalCwd,
            timeout: timeoutMs,
            maxBuffer,
            shell: shellPath,
          });

          emitToolDone(true);
          return { 
            ok: true, 
            stdout, 
            stderr, 
            exitCode: 0, 
            cwd: finalCwd,
            shellInfo: {
              shell: shellPath,
              platform: process.platform,
              args: shellArgs
            }
          };
        } catch (err: any) {
          lastError = err;
          continue;
        }
      }

      // 全部尝试失败
      emitToolDone(false);

      let errorSuggestion = "All shell attempts failed";
      if (lastError?.code === 127 || lastError?.code === 1) {
        errorSuggestion = "Command not found or permission denied. Check if the command exists and is executable.";
      } else if (lastError?.code === "ETIMEDOUT" || lastError?.code === 124) {
        errorSuggestion = "Command timed out. Consider simplifying the command or increasing timeout.";
      } else if (lastError?.signal === "SIGKILL") {
        errorSuggestion = "Command was killed due to resource limits. Check memory or output size limits.";
      }

      return {
        ok: false,
        stdout: lastError?.stdout ?? "",
        stderr: lastError?.stderr ?? "",
        exitCode: typeof lastError?.code === "number" ? lastError.code : null,
        signal: typeof lastError?.signal === "string" ? lastError.signal : null,
        cwd: finalCwd,
        error: `${errorSuggestion}: ${String(lastError?.message ?? lastError)}`,
        details: {
          platform: process.platform,
          testedShells: fallbackShells.map(s => s.path),
          suggestion: errorSuggestion,
          rawError: String(lastError?.message ?? lastError)
        }
      };
    }

    if (name === "create") {
      const args = safeJsonParse<{ role?: string; guidance?: string }>(input.call.argumentsText, {});
      const role = (args.role ?? "").trim();
      const guidance = (args.guidance ?? "").trim();
      if (!role) {
        emitToolDone(false);
        return { ok: false, error: "Missing role" };
      }

      const created = await store.createSubAgentWithP2P({
        workspaceId,
        creatorId: this.agentId,
        role,
        guidance,
      });
      this.ensureRunner(created.agentId);
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.agent.created",
        data: { workspaceId, agent: { id: created.agentId, role, parentId: this.agentId } },
      });
      emitToolDone(true);
      return { ok: true, agentId: created.agentId, role, groupId: created.groupId };
    }

    if (name === "list_agents") {
      const agents = await store.listAgentsMeta({ workspaceId });
      emitToolDone(true);
      return { ok: true, agents };
    }

    if (name === "send") {
      const args = safeJsonParse<{ to?: string; content?: string }>(input.call.argumentsText, {});
      const to = (args.to ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!to) {
        emitToolDone(false);
        return { ok: false, error: "Missing to" };
      }
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      const delivered = await store.sendDirectMessage({
        workspaceId,
        fromId: this.agentId,
        toId: to,
        content,
        contentType: "text",
        groupName: null,
      });

      const directMembers = await store.listGroupMemberIds({ groupId: delivered.groupId });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId: delivered.groupId,
          memberIds: directMembers,
          message: { id: delivered.messageId, senderId: this.agentId, sendTime: delivered.sendTime },
        },
      });

      const toRole = await store.getAgentRole({ agentId: to }).catch(() => null);
      if (toRole && toRole !== "human") {
        this.ensureRunner(to);
        this.wakeAgent(to);
      }

      emitToolDone(true);
      return { ok: true, ...delivered };
    }

    if (name === "list_groups") {
      const groups = await store.listGroups({ workspaceId, agentId: this.agentId });
      emitToolDone(true);
      return { ok: true, groups };
    }

    if (name === "list_group_members") {
      const args = safeJsonParse<{ groupId?: string }>(input.call.argumentsText, {});
      const groupId = (args.groupId ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      const members = await store.listGroupMemberIds({ groupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }
      emitToolDone(true);
      return { ok: true, members };
    }

    if (name === "create_group") {
      const args = safeJsonParse<{ memberIds?: string[]; name?: string }>(input.call.argumentsText, {});
      const memberIds = (args.memberIds ?? []).map((id) => id.trim()).filter(Boolean);
      if (memberIds.length < 2) {
        emitToolDone(false);
        return { ok: false, error: "memberIds must have >= 2 members" };
      }
      if (!memberIds.includes(this.agentId)) {
        memberIds.push(this.agentId);
      }
      let groupId = "";
      let groupName: string | null = args.name ?? null;
      if (memberIds.length === 2) {
        const existing = await store.findLatestExactP2PGroupId({
          workspaceId,
          memberA: memberIds[0]!,
          memberB: memberIds[1]!,
          preferredName: args.name ?? null,
        });
        groupId =
          (await store.mergeDuplicateExactP2PGroups({
            workspaceId,
            memberA: memberIds[0]!,
            memberB: memberIds[1]!,
            preferredName: args.name ?? null,
          })) ??
          (
            await store.createGroup({
              workspaceId,
              memberIds,
              name: args.name ?? undefined,
            })
          ).id;
        if (!existing) {
          getWorkspaceUIBus().emit(workspaceId, {
            event: "ui.group.created",
            data: { workspaceId, group: { id: groupId, name: groupName, memberIds } },
          });
        }
      } else {
        const created = await store.createGroup({ workspaceId, memberIds, name: args.name ?? undefined });
        groupId = created.id;
        groupName = created.name;
        getWorkspaceUIBus().emit(workspaceId, {
          event: "ui.group.created",
          data: { workspaceId, group: { id: groupId, name: groupName, memberIds } },
        });
      }
      emitToolDone(true);
      return { ok: true, groupId, name: groupName };
    }

    if (name === "send_group_message") {
      const args = safeJsonParse<{ groupId?: string; content?: string; contentType?: string }>(
        input.call.argumentsText,
        {}
      );
      const groupId = (args.groupId ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      const members = await store.listGroupMemberIds({ groupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }

      const result = await store.sendMessage({
        groupId,
        senderId: this.agentId,
        content,
        contentType: args.contentType ?? "text",
      });

      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId,
          memberIds: members,
          message: { id: result.id, senderId: this.agentId, sendTime: result.sendTime },
        },
      });

      for (const memberId of members) {
        if (memberId === this.agentId) continue;
        const role = await store.getAgentRole({ agentId: memberId }).catch(() => null);
        if (role === "human" || role === null) continue;
        this.ensureRunner(memberId);
        this.wakeAgent(memberId);
      }

      emitToolDone(true);
      return { ok: true, ...result };
    }

    if (name === "send_direct_message") {
      const args = safeJsonParse<{ toAgentId?: string; content?: string; contentType?: string }>(
        input.call.argumentsText,
        {}
      );
      const toAgentId = (args.toAgentId ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!toAgentId) {
        emitToolDone(false);
        return { ok: false, error: "Missing toAgentId" };
      }
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      const delivered = await store.sendDirectMessage({
        workspaceId,
        fromId: this.agentId,
        toId: toAgentId,
        content,
        contentType: args.contentType ?? "text",
        groupName: null,
      });
      const groupId = delivered.groupId;
      const channel = delivered.channel;
      const directMembers = await store.listGroupMemberIds({ groupId });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId,
          memberIds: directMembers,
          message: { id: delivered.messageId, senderId: this.agentId, sendTime: delivered.sendTime },
        },
      });

      this.ensureRunner(toAgentId);
      this.wakeAgent(toAgentId);

      emitToolDone(true);
      return {
        ok: true,
        channel,
        groupId,
        messageId: delivered.messageId,
        sendTime: delivered.sendTime,
      };
    }

    if (name === "get_group_messages") {
      const args = safeJsonParse<{ groupId?: string }>(input.call.argumentsText, {});
      const groupId = (args.groupId ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      const members = await store.listGroupMemberIds({ groupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }
      const messages = await store.listMessages({ groupId });
      emitToolDone(true);
      return { ok: true, messages };
    }

    if (name === "delete_agent") {
      const args = safeJsonParse<{ agentId?: string; force?: boolean }>(input.call.argumentsText, {});
      const targetAgentId = (args.agentId ?? "").trim();
      const force = args.force ?? false;

      if (!targetAgentId) {
        emitToolDone(false);
        return { ok: false, error: "Missing agentId" };
      }

      // 检查目标代理是否存在
      const targetRole = await store.getAgentRole({ agentId: targetAgentId }).catch(() => null);
      if (!targetRole) {
        emitToolDone(false);
        return { ok: false, error: `Agent not found: ${targetAgentId}` };
      }

      // 权限检查：仅允许删除子代理或使用 force 删除
      const agents = await store.listAgentsMeta({ workspaceId });
      const targetAgent = agents.find(a => a.id === targetAgentId);

      if (!force) {
        if (!targetAgent || targetAgent.parentId !== this.agentId) {
          emitToolDone(false);
          return { ok: false, error: `Permission denied: cannot delete agent ${targetAgentId}. Use force=true to override.` };
        }
      }

      // 删除代理（假设存储层已实现）
      await store.deleteAgent({ agentId: targetAgentId, workspaceId });

      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.agent.deleted",
        data: { workspaceId, agent: { id: targetAgentId, role: targetRole, parentId: targetAgent?.parentId ?? null } },
      });

      emitToolDone(true);
      return { ok: true, agentId: targetAgentId, deleted: true };
    }

    // 若为插件工具，直接委托给 MCP
    const mcp = await getMcpRegistry(BUILTIN_TOOL_NAMES);
    if (mcp.hasTool(name)) {
      const args = safeJsonParse<Record<string, unknown>>(input.call.argumentsText, {});
      const result = await mcp.callTool(name, args);
      emitToolDone(result.ok);
      return result;
    }

    // 未识别工具
    emitToolDone(false);
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  /** 根据 LLM 提供商调用流式接口 */
  private async callLlmStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const provider = getLlmProvider();
    if (provider === "openrouter") {
      return this.callOpenRouterStreaming(history, ctx);
    }
    return this.callGlmStreaming(history, ctx);
  }

  /** OpenRouter 的流式调用实现 */
  private async callOpenRouterStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model, httpReferer, appTitle } = getOpenRouterConfig();

    // 通知 UI 开始
    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

    const tools = await getAgentTools();
    const payload: Record<string, unknown> = {
      messages: mapOpenRouterMessages(history),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (model) payload.model = model;
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (httpReferer) headers["HTTP-Referer"] = httpReferer;
    if (appTitle) headers["X-Title"] = appTitle;

    const requestBody = JSON.stringify(payload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    // 发送请求到 OpenRouter
    const upstream = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: requestBody,
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`OpenRouter upstream error: ${upstream.status} ${text}`);
    }

    // 解析 SSE 流
    const assembler = new OpenAIStreamAssembler();
    let prev = assembler.snapshot();
    let assistantText = "";
    let assistantThinking = "";

    for await (const evt of parseSSEJsonLines(upstream.body)) {
      const state = assembler.push(evt as any);

      // 计算差量
      const reasoningDelta = state.reasoningContent.slice(prev.reasoningContent.length);
      const contentDelta = state.content.slice(prev.content.length);
      const toolCallDeltas = extractToolCallDeltas(evt as any, prev, state);

      // 推送 reasoning 变化
      if (reasoningDelta) {
        assistantThinking += reasoningDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "reasoning", delta: reasoningDelta },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "reasoning",
          delta: reasoningDelta,
        });
      }

      // 推送 content 变化
      if (contentDelta) {
        assistantText += contentDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "content", delta: contentDelta },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "content",
          delta: contentDelta,
        });
      }

      // 推送工具调用变化
      for (const delta of toolCallDeltas) {
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: {
            kind: "tool_calls",
            delta: delta.delta,
            tool_call_id: delta.tool_call_id,
            tool_call_name: delta.tool_call_name,
          },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "tool_calls",
          delta: delta.delta,
          tool_call_id: delta.tool_call_id,
          tool_call_name: delta.tool_call_name,
        });
      }

      prev = state;
    }

    // 完成事件
    this.bus.emit(this.agentId, {
      event: "agent.done",
      data: { finishReason: prev.finishReason ?? undefined },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "done",
      finishReason: prev.finishReason ?? null,
    });
    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.done",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
        finishReason: prev.finishReason ?? undefined,
      },
    });

    const finalState = assembler.snapshot();

    // 保存 token 计数
    if (finalState.usage && finalState.usage.totalTokens > 0) {
      try {
        await store.setGroupContextTokens({
          groupId: ctx.groupId,
          tokens: finalState.usage.totalTokens,
        });
      } catch {
        // Best effort - don't fail if token tracking fails
      }
    }

    return {
      assistantText,
      assistantThinking,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason,
    };
  }

  /** GLM 的流式调用实现 */
  private async callGlmStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model } = getGlmConfig();

    // UI 开始事件
    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

    // 发送请求 payload
    const glmPayload: Record<string, unknown> = {
      model,
      messages: history,
      tools: await getAgentTools(),
      tool_choice: "auto",
      stream: true,
      tool_stream: true,
    };
    const requestBody = JSON.stringify(glmPayload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    // 发送请求
    const upstream = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`GLM upstream error: ${upstream.status} ${text}`);
    }

    // SSE 解析
    const assembler = new GLMStreamAssembler();
    let prev = assembler.snapshot();
    let assistantText = "";
    let assistantThinking = "";

    for await (const evt of parseSSEJsonLines(upstream.body)) {
      const state = assembler.push(evt as any);

      const reasoningDelta = state.reasoningContent.slice(prev.reasoningContent.length);
      const contentDelta = state.content.slice(prev.content.length);
      const toolCallDeltas = extractToolCallDeltas(evt as any, prev, state);

      if (reasoningDelta) {
        assistantThinking += reasoningDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "reasoning", delta: reasoningDelta },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "reasoning",
          delta: reasoningDelta,
        });
      }

      if (contentDelta) {
        assistantText += contentDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "content", delta: contentDelta },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "content",
          delta: contentDelta,
        });
      }

      for (const delta of toolCallDeltas) {
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: {
            kind: "tool_calls",
            delta: delta.delta,
            tool_call_id: delta.tool_call_id,
            tool_call_name: delta.tool_call_name,
          },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "tool_calls",
          delta: delta.delta,
          tool_call_id: delta.tool_call_id,
          tool_call_name: delta.tool_call_name,
        });
      }

      prev = state;
    }

    // 完成事件
    this.bus.emit(this.agentId, {
      event: "agent.done",
      data: { finishReason: prev.finishReason ?? undefined },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "done",
      finishReason: prev.finishReason ?? null,
    });
    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.done",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
        finishReason: prev.finishReason ?? undefined,
      },
    });

    const finalState = assembler.snapshot();

    // 保存 token 计数
    if (finalState.usage && finalState.usage.totalTokens > 0) {
      try {
        await store.setGroupContextTokens({
          groupId: ctx.groupId,
          tokens: finalState.usage.totalTokens,
        });
      } catch {
        // Best effort - don't fail if token tracking fails
      }
    }

    return {
      assistantText,
      assistantThinking,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason,
    };
  }
}

// ------------------------------------
// 工具调用差量提取函数
// ------------------------------------
/**
 * 根据 SSE 分片和前后状态，计算工具调用的增量。
 *
 * 这在 LLM 的 streaming 输出中非常重要，因为每一帧都可能只包含部分信息。
 */
function extractToolCallDeltas(
  chunk: {
    choices?: Array<{
      delta?: {
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  },
  prevState: { toolCalls: Array<{ index: number; id?: string; name?: string; argumentsText: string }> },
  nextState: { toolCalls: Array<{ index: number; id?: string; name?: string; argumentsText: string }> }
): Array<{ delta: string; tool_call_id?: string; tool_call_name?: string }> {
  const deltas: Array<{ delta: string; tool_call_id?: string; tool_call_name?: string }> = [];
  const toolCalls = chunk.choices?.[0]?.delta?.tool_calls ?? [];
  if (toolCalls.length === 0) return deltas;

  // 通过索引建立前后状态映射，方便比较
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
      deltas.push({ delta: argsChunk, tool_call_id: id, tool_call_name: name });
      continue;
    }

    // 若函数名变化（例如从 null 变为 "send"），也需要记录
    if (name && name !== prev?.name) {
      deltas.push({ delta: "", tool_call_id: id, tool_call_name: name });
    }
  }

  return deltas;
}

// ------------------------------------
// AgentRuntime：管理所有代理实例的全局入口
// ------------------------------------
export class AgentRuntime {
  private readonly runners = new Map<UUID, AgentRunner>();
  public readonly bus = new AgentEventBus();
  private bootstrapped = false;
  static readonly VERSION = 2;

  /** 初始化时加载所有已注册的代理，并创建对应 Runner */
  async bootstrap() {
    if (this.bootstrapped) return;
    this.bootstrapped = true;

    const agents = await store.listAgents();
    for (const a of agents) {
      if (a.role === "human") continue; // 人类用户不需要后台跑
      this.ensureRunner(a.id);
    }
  }

  /** 获取或创建指定 ID 的 AgentRunner */
  ensureRunner(agentId: UUID) {
    const existing = this.runners.get(agentId);
    if (existing) return existing;
    const runner = new AgentRunner(
      agentId,
      this.bus,
      (id) => {
        this.ensureRunner(id);
      },
      (id) => {
        this.ensureRunner(id).wakeup("manual");
      }
    );
    this.runners.set(agentId, runner);
    runner.start();
    return runner;
  }

  /** 当群组有新消息时唤醒所有相关代理 */
  async wakeAgentsForGroup(groupId: UUID, senderId: UUID) {
    await this.bootstrap();
    const memberIds = await store.listGroupMemberIds({ groupId });

    for (const memberId of memberIds) {
      if (memberId === senderId) continue;
      const role = await store.getAgentRole({ agentId: memberId }).catch(() => null);
      if (role === "human" || role === null) continue;
      this.ensureRunner(memberId).wakeup("group_message");
    }
  }

  /** 唤醒单个代理（直接或上下文流） */
  async wakeAgent(agentId: UUID, reason: "direct_message" | "context_stream" = "direct_message") {
    await this.bootstrap();
    const role = await store.getAgentRole({ agentId }).catch(() => null);
    if (role === "human" || role === null) return;
    this.ensureRunner(agentId).wakeup(reason);
  }

  async interruptAll(input?: { workspaceId?: UUID }) {
    await this.bootstrap();
    const workspaceId = input?.workspaceId?.trim();
    const agents = await store.listAgents(workspaceId ? { workspaceId } : undefined);
    const agentIds = agents.filter((agent) => agent.role !== "human").map((agent) => agent.id);

    for (const agentId of agentIds) {
      this.ensureRunner(agentId).requestInterrupt();
    }

    return { interrupted: agentIds.length, agentIds };
  }
}

// ------------------------------------
// 全局单例
// ------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __agentWechatRuntime: AgentRuntime | undefined;
  // eslint-disable-next-line no-var
  var __agentWechatRuntimeVersion: number | undefined;
}

export function getAgentRuntime() {
  if (
    globalThis.__agentWechatRuntime &&
    globalThis.__agentWechatRuntimeVersion === AgentRuntime.VERSION
  ) {
    return globalThis.__agentWechatRuntime;
  }

  globalThis.__agentWechatRuntime = new AgentRuntime();
  globalThis.__agentWechatRuntimeVersion = AgentRuntime.VERSION;
  return globalThis.__agentWechatRuntime;
}