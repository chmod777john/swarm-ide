import { store } from "@/lib/storage";
import { GLMStreamAssembler, parseSSEJsonLines } from "@/lib/glm-stream";

import { AgentEventBus } from "./event-bus";
import { createDeferred, safeJsonParse } from "./utils";

type UUID = string;

type HistoryMessage = { role: string; content: string };

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
    private readonly bus: AgentEventBus
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
    const history = safeJsonParse<HistoryMessage[]>(agent.llmHistory, []);

    if (history.length === 0) {
      history.push({
        role: "system",
        content:
          "You are an assistant agent in an IM system. Reply concisely and helpfully.",
      });
    }

    const userContent = unreadMessages
      .map((m) => `[group:${groupId}] ${m.senderId}: ${m.content}`)
      .join("\n");
    history.push({ role: "user", content: userContent });

    this.bus.emit(this.agentId, { event: "agent.history", data: { history } });

    const assistantText = await this.callGlmStreaming(history);

    if (assistantText.trim()) {
      await store.sendMessage({
        groupId,
        senderId: this.agentId,
        content: assistantText,
        contentType: "text",
      });
    }

    history.push({ role: "assistant", content: assistantText });
    await store.setAgentHistory({ agentId: this.agentId, llmHistory: JSON.stringify(history) });

    const lastId = unreadMessages[unreadMessages.length - 1]?.id;
    if (lastId) {
      await store.markGroupReadToMessage({ groupId, readerId: this.agentId, messageId: lastId });
    }
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

    return assistantText;
  }
}

export class AgentRuntime {
  private readonly runners = new Map<UUID, AgentRunner>();
  public readonly bus = new AgentEventBus();
  private bootstrapped = false;

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
    const runner = new AgentRunner(agentId, this.bus);
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
}

export function getAgentRuntime() {
  if (globalThis.__agentWechatRuntime) return globalThis.__agentWechatRuntime;
  globalThis.__agentWechatRuntime = new AgentRuntime();
  return globalThis.__agentWechatRuntime;
}
