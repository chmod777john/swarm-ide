import { store } from "@/lib/storage";
import { GLMStreamAssembler, parseSSEJsonLines } from "@/lib/glm-stream";

import { AgentEventBus } from "./event-bus";
import { createDeferred, safeJsonParse } from "./utils";
import { getWorkspaceUIBus } from "./ui-bus";

type UUID = string;

type HistoryMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
      tool_calls?: unknown;
      reasoning_content?: string;
    }
  | { role: "tool"; content: string; tool_call_id?: string; name?: string };

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
  {
    type: "function",
    function: {
      name: "list_groups",
      description: "List visible groups for this agent.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
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

  wakeup(reason: "manual" | "group_message" | "direct_message" | "context_stream" = "manual") {
    this.wake.resolve();
    this.wake = createDeferred<void>();
    this.bus.emit(this.agentId, {
      event: "agent.wakeup",
      data: { agentId: this.agentId, reason },
    });
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
    const role = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
    if (role === "human" || role === null) return;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batches = await store.listUnreadByGroup({ agentId: this.agentId });
      if (batches.length === 0) return;

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
    const workspaceId = await store.getGroupWorkspaceId({ groupId });
    const agent = await store.getAgent({ agentId: this.agentId });
    const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
    const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];

    if (history.length === 0) {
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
          `If you need to coordinate with other agents, you may use tools like self, list_agents, create, send, list_groups, list_group_members, create_group, send_group_message, send_direct_message, and get_group_messages.`,
      });
    }

    const userContent = unreadMessages
      .map((m) => `[group:${groupId}] ${m.senderId}: ${m.content}`)
      .join("\n");
    history.push({ role: "user", content: userContent });

    const lastId = unreadMessages[unreadMessages.length - 1]?.id;
    if (lastId) {
      await store.markGroupReadToMessage({ groupId, readerId: this.agentId, messageId: lastId });
    }

    const { assistantText, assistantThinking } = await this.runWithTools({
      groupId,
      workspaceId,
      history,
    });

    history.push({
      role: "assistant",
      content: assistantText,
      reasoning_content: assistantThinking || undefined,
    });
    await store.setAgentHistory({
      agentId: this.agentId,
      llmHistory: JSON.stringify(history),
      workspaceId,
    });
    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.agent.history.persisted",
      data: { workspaceId, agentId: this.agentId, groupId, historyLength: history.length },
    });
  }

  private async runWithTools(input: {
    groupId: UUID;
    workspaceId: UUID;
    history: HistoryMessage[];
  }) {
    const maxToolRounds = 3;
    let assistantText = "";
    let assistantThinking = "";

    for (let round = 0; round < maxToolRounds; round++) {
      const res = await this.callGlmStreaming(input.history, {
        workspaceId: input.workspaceId,
        groupId: input.groupId,
        round,
      });
      assistantText = res.assistantText;
      assistantThinking = res.assistantThinking;

      if (res.toolCalls.length === 0) {
        return { assistantText, assistantThinking };
      }

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

      for (const call of res.toolCalls) {
        const result = await this.executeToolCall({
          groupId: input.groupId,
          call,
        });
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: {
            kind: "tool_result",
            delta: JSON.stringify(result),
            tool_call_id: call.id,
            tool_call_name: call.name,
          },
        });
        input.history.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: call.id,
          name: call.name,
        });
      }

    }

    return { assistantText, assistantThinking };
  }

  private async executeToolCall(input: { groupId: UUID; call: ToolCall }) {
    const name = input.call.name ?? "";
    const workspaceId = await store.getGroupWorkspaceId({ groupId: input.groupId });
    const toolMeta = { toolCallId: input.call.id, toolName: input.call.name };

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

    if (name === "self") {
      const role = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
      emitToolDone(true);
      return { ok: true, agentId: this.agentId, workspaceId, role };
    }

    if (name === "create") {
      const args = safeJsonParse<{ role?: string }>(input.call.argumentsText, {});
      const role = (args.role ?? "").trim();
      if (!role) {
        emitToolDone(false);
        return { ok: false, error: "Missing role" };
      }

      const created = await store.createSubAgentWithP2P({
        workspaceId,
        creatorId: this.agentId,
        role,
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
        // Do not auto-add the human into agent↔agent threads; sidebar only shows human-participant chats.
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
      const created = await store.createGroup({ workspaceId, memberIds, name: args.name ?? undefined });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.group.created",
        data: { workspaceId, group: { id: created.id, name: created.name, memberIds } },
      });
      emitToolDone(true);
      return { ok: true, groupId: created.id, name: created.name };
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

      const existing = await store.findLatestExactP2PGroupId({
        workspaceId,
        memberA: this.agentId,
        memberB: toAgentId,
        preferredName: null,
      });
      const groupId =
        existing ??
        (
          await store.createGroup({
            workspaceId,
            memberIds: [this.agentId, toAgentId],
          })
        ).id;
      const channel = existing ? "reuse_existing_group" : "new_group";

      const result = await store.sendMessage({
        groupId,
        senderId: this.agentId,
        content,
        contentType: args.contentType ?? "text",
      });

      const directMembers = await store.listGroupMemberIds({ groupId });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId,
          memberIds: directMembers,
          message: { id: result.id, senderId: this.agentId, sendTime: result.sendTime },
        },
      });

      this.ensureRunner(toAgentId);
      this.wakeAgent(toAgentId);

      emitToolDone(true);
      return { ok: true, channel, groupId, messageId: result.id, sendTime: result.sendTime };
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

    emitToolDone(false);
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  private async callGlmStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model } = getGlmConfig();

    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });

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
      }

      if (contentDelta) {
        assistantText += contentDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "content", delta: contentDelta },
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
      }

      prev = state;
    }

    this.bus.emit(this.agentId, {
      event: "agent.done",
      data: { finishReason: prev.finishReason ?? undefined },
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
    return {
      assistantText,
      assistantThinking,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason,
    };
  }
}

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

    if (name && name !== prev?.name) {
      deltas.push({ delta: "", tool_call_id: id, tool_call_name: name });
    }
  }

  return deltas;
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
        this.ensureRunner(id).wakeup("manual");
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
      this.ensureRunner(memberId).wakeup("group_message");
    }
  }

  async wakeAgent(agentId: UUID, reason: "direct_message" | "context_stream" = "direct_message") {
    await this.bootstrap();
    const role = await store.getAgentRole({ agentId }).catch(() => null);
    if (role === "human" || role === null) return;
    this.ensureRunner(agentId).wakeup(reason);
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
