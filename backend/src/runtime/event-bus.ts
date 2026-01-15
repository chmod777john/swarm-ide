type AgentEvent =
  | {
      id: number;
      at: number;
      event: "agent.history";
      data: { history: Array<{ role: string; content: string }> };
    }
  | {
      id: number;
      at: number;
      event: "agent.stream";
      data: { kind: "reasoning" | "content"; delta: string };
    }
  | {
      id: number;
      at: number;
      event: "agent.done";
      data: { finishReason?: string | null };
    }
  | {
      id: number;
      at: number;
      event: "agent.error";
      data: { message: string };
    };

type Listener = (evt: AgentEvent) => void;

type ChannelState = {
  nextId: number;
  buffer: AgentEvent[];
  listeners: Set<Listener>;
};

const DEFAULT_MAX_BUFFER = 2000;

export class AgentEventBus {
  private readonly channels = new Map<string, ChannelState>();
  constructor(private readonly maxBuffer = DEFAULT_MAX_BUFFER) {}

  private getChannel(agentId: string): ChannelState {
    const existing = this.channels.get(agentId);
    if (existing) return existing;

    const created: ChannelState = {
      nextId: 1,
      buffer: [],
      listeners: new Set(),
    };
    this.channels.set(agentId, created);
    return created;
  }

  emit(agentId: string, event: Omit<AgentEvent, "id" | "at">) {
    const channel = this.getChannel(agentId);
    const evt = { ...event, id: channel.nextId++, at: Date.now() } as AgentEvent;

    channel.buffer.push(evt);
    if (channel.buffer.length > this.maxBuffer) {
      channel.buffer.splice(0, channel.buffer.length - this.maxBuffer);
    }

    // Best-effort persistence for cross-process/history replay (optional).
    // This keeps the existing in-memory bus semantics while enabling Redis Streams.
    void persistAgentEvent(agentId, evt);

    for (const listener of channel.listeners) {
      listener(evt);
    }
  }

  subscribe(agentId: string, listener: Listener): () => void {
    const channel = this.getChannel(agentId);
    channel.listeners.add(listener);
    return () => {
      channel.listeners.delete(listener);
    };
  }

  getSince(agentId: string, afterId: number): AgentEvent[] {
    const channel = this.getChannel(agentId);
    return channel.buffer.filter((e) => e.id > afterId);
  }

  getLatestId(agentId: string): number {
    const channel = this.getChannel(agentId);
    return channel.nextId - 1;
  }
}

export type { AgentEvent };

async function persistAgentEvent(agentId: string, evt: AgentEvent) {
  const { isUpstashRealtimeConfigured, getUpstashRealtime } = await import("./upstash-realtime");
  if (!isUpstashRealtimeConfigured()) return;
  try {
    await getUpstashRealtime().channel(`agent:${agentId}`).emit(evt.event, {
      id: evt.id,
      at: evt.at,
      data: evt.data,
    });
  } catch {
    // ignore
  }
}
