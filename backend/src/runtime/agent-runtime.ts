import { store } from "@/lib/storage";
import { GLMStreamAssembler, parseSSEJsonLines } from "@/lib/glm-stream";

import { AgentEventBus } from "./event-bus";
import { createDeferred, safeJsonParse } from "./utils";
import { getWorkspaceUIBus } from "./ui-bus";

type UUID = string;

type HistoryMessage =
  | { role: "system" | "user" | "assistant"; content: string; tool_calls?: unknown }
  | { role: "tool"; content: string; tool_call_id?: string; name?: string };

type HistoryByGroup = Record<string, HistoryMessage[]>;

type ToolCall = {
  index: number;
  id?: string;
  name?: string;
  argumentsText: string;
};

const AGENT_TOOLS = [
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
        },
        required: ["role"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "self",
      description: "Return the current agent's identity (agent_id, workspace_id, role).",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_agents",
      description: "List all agents in the current workspace (ids + roles).",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
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
] as const;

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

class AgentRunner {
  private wake = createDeferred<void>();
  private started = false;
  private running = false;

  constructor(
    private readonly agentId: UUID,
    private readonly bus: AgentEventBus,
    private readonly ensureRunner: (agentId: UUID) => void,
    private readonly wakeAgent: (agentId: UUID) => void
  ) {}

  start() {
    if (this.started) return;
    this.started = true;
    void this.loop();
  }

  wakeup() {
    this.wake.resolve();
    this.wake = createDeferred<void>();
  }

  private async loop() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.wake.promise;
      if (this.running) continue;
      this.running = true;
      try {
        await this.processUntilIdle();
      } catch (err) {
        this.bus.emit(this.agentId, {
          event: "agent.error",
          data: { message: err instanceof Error ? err.message : String(err) },
        });
      } finally {
        this.running = false;
      }
    }
  }

  private async processUntilIdle() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batches = await store.listUnreadByGroup({ agentId: this.agentId });
      if (batches.length === 0) return;

      for (const batch of batches) {
        await this.processGroupUnread(batch.groupId, batch.messages);
      }
    }
  }

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
    const agent = await store.getAgent({ agentId: this.agentId });
    const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
    const historyByGroup: HistoryByGroup = Array.isArray(parsed)
      ? { [groupId]: parsed as HistoryMessage[] }
      : (parsed as HistoryByGroup);
    const history = historyByGroup[groupId] ?? [];

    if (history.length === 0) {
      const role = agent.role;
      const workspaceId = await store.getGroupWorkspaceId({ groupId });
      history.push({
        role: "system",
        content:
          `You are an agent in an IM system.\n` +
          `Your agent_id is: ${this.agentId}.\n` +
          `Your workspace_id is: ${workspaceId}.\n` +
          `Your role is: ${role}.\n` +
          `Act strictly as this role when replying. Be concise and helpful.\n` +
          `If you need to coordinate with other agents, you may use tools like self, list_agents, create, and send.`,
      });
    }

    const userContent = unreadMessages
      .map((m) => `[group:${groupId}] ${m.senderId}: ${m.content}`)
      .join("\n");
    history.push({ role: "user", content: userContent });

    this.bus.emit(this.agentId, { event: "agent.history", data: { history } });

    const { assistantText } = await this.runWithTools({ groupId, history });

    if (assistantText.trim()) {
      await store.sendMessage({
        groupId,
        senderId: this.agentId,
        content: assistantText,
        contentType: "text",
      });
    }

    history.push({ role: "assistant", content: assistantText });
    historyByGroup[groupId] = history;
    await store.setAgentHistory({
      agentId: this.agentId,
      llmHistory: JSON.stringify(historyByGroup),
    });

    const lastId = unreadMessages[unreadMessages.length - 1]?.id;
    if (lastId) {
      await store.markGroupReadToMessage({ groupId, readerId: this.agentId, messageId: lastId });
    }
  }

  private async runWithTools(input: { groupId: UUID; history: HistoryMessage[] }) {
    const maxToolRounds = 3;
    let assistantText = "";

    for (let round = 0; round < maxToolRounds; round++) {
      const res = await this.callGlmStreaming(input.history);
      assistantText = res.assistantText;

      if (res.toolCalls.length === 0) {
        return { assistantText };
      }

      input.history.push({
        role: "assistant",
        content: res.assistantText,
        tool_calls: res.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.argumentsText },
        })),
      });

      for (const call of res.toolCalls) {
        const result = await this.executeToolCall({
          groupId: input.groupId,
          call,
        });
        input.history.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: call.id,
          name: call.name,
        });
      }

      this.bus.emit(this.agentId, { event: "agent.history", data: { history: input.history } });
    }

    return { assistantText };
  }

  private async executeToolCall(input: { groupId: UUID; call: ToolCall }) {
    const name = input.call.name ?? "";
    const workspaceId = await store.getGroupWorkspaceId({ groupId: input.groupId });
    const memberIds = await store.listGroupMemberIds({ groupId: input.groupId });

    let humanId: UUID | null = null;
    for (const id of memberIds) {
      const r = await store.getAgentRole({ agentId: id }).catch(() => null);
      if (r === "human") {
        humanId = id;
        break;
      }
    }

    if (name === "self") {
      const role = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
      return { ok: true, agentId: this.agentId, workspaceId, role };
    }

    if (name === "create") {
      const args = safeJsonParse<{ role?: string }>(input.call.argumentsText, {});
      const role = (args.role ?? "").trim();
      if (!role) return { ok: false, error: "Missing role" };

      const created = await store.createAgent({
        workspaceId,
        role,
        parentId: this.agentId,
        llmHistory: "[]",
      });
      this.ensureRunner(created.id);
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.agent.created",
        data: { workspaceId, agent: { id: created.id, role, parentId: this.agentId } },
      });
      return { ok: true, agentId: created.id, role };
    }

    if (name === "list_agents") {
      const agents = await store.listAgentsMeta({ workspaceId });
      return { ok: true, agents };
    }

    if (name === "send") {
      const args = safeJsonParse<{ to?: string; content?: string }>(input.call.argumentsText, {});
      const to = (args.to ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!to) return { ok: false, error: "Missing to" };
      if (!content) return { ok: false, error: "Missing content" };

      const delivered = await store.sendDirectMessage({
        workspaceId,
        fromId: this.agentId,
        toId: to,
        observerHumanId: humanId,
        content,
        contentType: "text",
        groupName: null,
      });

      this.ensureRunner(to);
      this.wakeAgent(to);

      return { ok: true, ...delivered };
    }

    return { ok: false, error: `Unknown tool: ${name}` };
  }

  private async callGlmStreaming(history: HistoryMessage[]) {
    const { apiKey, baseUrl, model } = getGlmConfig();

    const upstream = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: history,
        tools: AGENT_TOOLS,
        tool_choice: "auto",
        stream: true,
        tool_stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`GLM upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new GLMStreamAssembler();
    let prev = assembler.snapshot();
    let assistantText = "";

    for await (const evt of parseSSEJsonLines(upstream.body)) {
      const state = assembler.push(evt as any);

      const reasoningDelta = state.reasoningContent.slice(prev.reasoningContent.length);
      const contentDelta = state.content.slice(prev.content.length);
      prev = state;

      if (reasoningDelta) {
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "reasoning", delta: reasoningDelta },
        });
      }

      if (contentDelta) {
        assistantText += contentDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "content", delta: contentDelta },
        });
      }
    }

    this.bus.emit(this.agentId, {
      event: "agent.done",
      data: { finishReason: prev.finishReason ?? undefined },
    });

    const finalState = assembler.snapshot();
    return {
      assistantText,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason,
    };
  }
}

export class AgentRuntime {
  private readonly runners = new Map<UUID, AgentRunner>();
  public readonly bus = new AgentEventBus();
  private bootstrapped = false;
  static readonly VERSION = 2;

  async bootstrap() {
    if (this.bootstrapped) return;
    this.bootstrapped = true;

    const agents = await store.listAgents();
    for (const a of agents) {
      if (a.role === "human") continue;
      this.ensureRunner(a.id);
    }
  }

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
        this.ensureRunner(id).wakeup();
      }
    );
    this.runners.set(agentId, runner);
    runner.start();
    return runner;
  }

  async wakeAgentsForGroup(groupId: UUID, senderId: UUID) {
    await this.bootstrap();
    const memberIds = await store.listGroupMemberIds({ groupId });

    for (const memberId of memberIds) {
      if (memberId === senderId) continue;
      const role = await store.getAgentRole({ agentId: memberId }).catch(() => null);
      if (role === "human" || role === null) continue;
      this.ensureRunner(memberId).wakeup();
    }
  }

  async wakeAgent(agentId: UUID) {
    await this.bootstrap();
    this.ensureRunner(agentId).wakeup();
  }
}

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
