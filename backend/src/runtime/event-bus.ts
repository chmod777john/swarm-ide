type AgentEvent =
  | {
      id: number; // 事件唯一标识符，递增
      at: number; // 事件发生的时间戳（毫秒）
      event: "agent.wakeup"; // 事件类型：代理唤醒
      data: { agentId: string; reason?: string | null }; // 关联代理ID以及可选原因
    }
  | {
      id: number;
      at: number;
      event: "agent.unread";
      data: {
        agentId: string; // 相关代理ID
        batches: Array<{
          groupId: string; // 消息组的标识
          messageIds: string[]; // 属于该组的消息ID列表
        }>;
      };
    }
  | {
      id: number;
      at: number;
      event: "agent.stream";
      data: {
        kind: "reasoning" | "content" | "tool_calls" | "tool_result"; // 流式事件子类型
        delta: string; // 当前增量数据（如文本片段）
        tool_call_id?: string; // 若是工具调用，记录ID
        tool_call_name?: string; // 工具名称
      };
    }
  | {
      id: number;
      at: number;
      event: "agent.done";
      data: { finishReason?: string | null }; // 可选完成原因，如“success”
    }
  | {
      id: number;
      at: number;
      event: "agent.error";
      data: { message: string }; // 错误信息
    };

type Listener = (evt: AgentEvent) => void; // 事件监听函数类型

// 每个代理通道的状态，包括缓存、监听器等
type ChannelState = {
  nextId: number; // 下一个即将分配给事件的id
  buffer: AgentEvent[]; // 当前缓存区，最多保留maxBuffer条记录
  listeners: Set<Listener>; // 注册到该通道的所有回调函数集合
  persistQueue: Promise<void>; // 用于串行化持久化写入的Promise链
};

const DEFAULT_MAX_BUFFER = 2000; // 默认最大缓存长度，防止内存溢出

export class AgentEventBus {
  // 存储所有代理ID对应的ChannelState实例
  private readonly channels = new Map<string, ChannelState>();
  
  constructor(private readonly maxBuffer = DEFAULT_MAX_BUFFER) {}

  /** 根据agentId获取或创建对应的通道状态 */
  private getChannel(agentId: string): ChannelState {
    const existing = this.channels.get(agentId);
    if (existing) return existing; // 已存在直接返回

    // 没有时新建一个状态对象
    const created: ChannelState = {
      nextId: 1,
      buffer: [],
      listeners: new Set(),
      persistQueue: Promise.resolve(), // 初始为已完成的Promise
    };
    this.channels.set(agentId, created);
    return created;
  }

  /** 向指定代理通道发布事件 */
  emit(agentId: string, event: Omit<AgentEvent, "id" | "at">) {
    const channel = this.getChannel(agentId);
    // 为事件生成唯一 id 与时间戳
    const evt = { ...event, id: channel.nextId++, at: Date.now() } as AgentEvent;

    // 把新事件加入缓冲区
    channel.buffer.push(evt);
    // 如果超过最大缓存长度，丢弃最旧的部分
    if (channel.buffer.length > this.maxBuffer) {
      channel.buffer.splice(0, channel.buffer.length - this.maxBuffer);
    }

    // 异步持久化到跨进程存储（如 Upstash）：
    // 通过串行化队列确保事件顺序不被打乱
    channel.persistQueue = channel.persistQueue
      .catch(() => undefined) // 捕获前一次错误，继续执行
      .then(() => persistAgentEvent(agentId, evt));

    // 通知所有订阅者
    for (const listener of channel.listeners) {
      listener(evt);
    }
  }

  /** 为代理注册事件监听器，返回取消函数 */
  subscribe(agentId: string, listener: Listener): () => void {
    const channel = this.getChannel(agentId);
    channel.listeners.add(listener);
    return () => {
      channel.listeners.delete(listener); // 卸载回调
    };
  }

  /** 根据代理ID获取自afterId之后的所有事件 */
  getSince(agentId: string, afterId: number): AgentEvent[] {
    const channel = this.getChannel(agentId);
    return channel.buffer.filter((e) => e.id > afterId);
  }

  /** 获取该代理已发布过的最新事件id（nextId-1） */
  getLatestId(agentId: string): number {
    const channel = this.getChannel(agentId);
    return channel.nextId - 1;
  }
}

export type { AgentEvent };

/** 将事件写入持久化存储（如 Upstash Realtime） */
async function persistAgentEvent(agentId: string, evt: AgentEvent) {
  // 动态加载配置，避免未使用时无必要的依赖
  const { isUpstashRealtimeConfigured, getUpstashRealtime } = await import("./upstash-realtime");
  
  // 若未启用实时服务则直接返回
  if (!isUpstashRealtimeConfigured()) return;
  
  try {
    // 将事件写入对应通道，按event名称广播
    await getUpstashRealtime().channel(`agent:${agentId}`).emit(evt.event, {
      id: evt.id,
      at: evt.at,
      data: evt.data,
    });
  } catch {
    // 对于持久化失败的情况忽略，保证应用继续运行
  }
}