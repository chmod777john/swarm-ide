# 技术方案: Agent Wechat 架构设计

## 1. 技术栈
*   **Runtime**: Bun
*   **Backend**: Next.js Route Handlers / API Routes
*   **ORM**: Drizzle ORM (PostgreSQL)
*   **Streaming**: Upstash Realtime (Redis Streams) + SSE
*   **Background Jobs**: Upstash Workflow (或 Bun 后台任务)
*   **Frontend**: Next.js + Tailwind + Framer Motion

## 2. 核心架构设计

### 2.1 配置系统 (Config Manager)
完全镜像 `../Mini-Agent` 的配置逻辑与多 Client 架构：
*   **config.json**: 存放 API Key、模型选择、Token 限制等。
*   **LLM Factory**: 实现动态供应模式。虽然首发仅提供 Zhipu 实现，但在接口设计上与 OpenAI/Anthropic 保持一致。
*   **Zhipu Client**: 采用 SSE 流式消费 Zhipu 接口，适配 Agent Runtime 的 Chunk 处理逻辑。

## 2. 核心设计理念

> **去中心化**：用户和 agent 完全等价。用户只是一种特殊的 agent。所有视角可切换。

## 3. 数据库 Schema

### 3.1 Workspace

*   **`workspaces`**:
    *   `id`: UUID PRIMARY KEY
    *   `name`: TEXT - 工作空间名称
    *   `created_at`: TIMESTAMP

### 3.2 Agent 体系

*   **`agents`**:
    *   `id`: UUID PRIMARY KEY
    *   `workspace_id`: UUID → workspaces.id
    *   `role`: TEXT - Agent 角色 ('writer', 'reviewer', 'coder'...)
    *   `parent_id`: UUID → agents.id - 可选，用于追踪组织树
    *   `llm_history`: TEXT - LLM 对话历史（JSON: [{role, content, tool_calls, ...}]）
    *   `created_at`: TIMESTAMP

### 3.3 IM 系统

> 所有对话都是群，P2P = 2 人群

*   **`groups`**:
    *   `id`: UUID PRIMARY KEY
    *   `workspace_id`: UUID → workspaces.id
    *   `name`: TEXT - 可选，P2P 可为空
    *   `created_at`: TIMESTAMP

*   **`group_members`**:
    *   `group_id`: UUID → groups.id
    *   `user_id`: UUID - 用户或 agent
    *   `last_read_message_id`: UUID - 最后读到的消息 ID
    *   `joined_at`: TIMESTAMP
    *   PRIMARY KEY (group_id, user_id)

*   **`messages`**:
    *   `id`: UUID v7 PRIMARY KEY - 可排序
    *   `workspace_id`: UUID → workspaces.id
    *   `group_id`: UUID → groups.id
    *   `sender_id`: UUID - 发送者（用户/agent）
    *   `content_type`: TEXT - 'text' | 'image' | ...
    *   `content`: TEXT
    *   `send_time`: TIMESTAMP

## 4. Agent Runtime 极简逻辑

### 4.1 启动加载

项目启动时：
1. 从数据库加载所有 agent 的 `llm_history`
2. 恢复到运行实例的 `context` 属性（内存）
3. 将历史 push 到 Upstash channel（供新订阅者 history 重放）

### 4.2 生命周期

*   **LLM 响应**: 收到消息后，进入内部 `while(true)`：
    1.  **LLM 推理**: 调用 LLM（流式输出）。
    2.  **流式推送**: 每个 chunk emit 到 Upstash channel `agent:${agentId}`。
        - 支持 content、thinking、tool_calls 三种流式
        - tool_calls 用 `__index__` 和 `__streaming_chunk__` 增量构建
    3.  **状态判断**:
        - `finish_reason = "continue"` → 继续
        - `finish_reason = "tool_calls"` → 执行工具 → 结果存上下文 → `continue`
        - `finish_reason = "stop"` → 完整 context 落库 → `break`

*   **检查未读**: Tool 执行完毕后，调用 `getAllUnread`
    *   若有未读 → 触发 LLM 响应
    *   若无未读 → 进入阻塞等待

*   **阻塞等待**: Agent 阻塞，处于 IDLE 状态。

*   **被唤醒**: 收到 wake 信号 → 立即 `getAllUnread`
    *   若有未读 → 触发 LLM 响应
    *   若无未读 → 继续等待

> **说明**：messages 表存 IM 可见消息，llm_history 存完整 LLM 对话（含 tool-call）。

*   **Agent → Agent 消息**：任意 agent 往包含目标 agent 的 group 调用 `sendMessage` 即可，消息写入后目标 agent 在下一次 `getAllUnread` 或被显式 wake 时拉取并处理，与人类消息流程一致。

**Agent 体系与 IM 体系的交汇（Agent→Agent 场景）**

- IM 层（群/消息）：发送方 agent 通过 `sendMessage(groupId, senderId=agentA)` 写入 `messages`；`group_members` 已含接收方 agentB。
- Agent 层（处理）：agentB 的唤醒器/轮询调用 `getAllUnread(agentB)` 读出该消息，附加到其内存 context，进入 LLM 循环；回复再通过 `sendMessage` 写回同一 group。两层彼此独立，通过 IM 接口对接。

**多 Agent 并发模型（语义保持“每个 Agent 自己跑 while”）**

- 启动时为每个 agent 启一个长驻 runner（协程/worker），内部就是 4.2 的循环：阻塞等待 → 有未读则推理 → 落库 → 继续阻塞（全异步，避免 CPU 阻塞）。
- 唤醒信号来自：消息写入触发的 wake 队列、定时/手动 wake；runner 监听自己的队列，保持“每个 agent 自己 while”的语义。
- 并发控制：同一个 agent 串行（单 runner），不同 agent 可并行（多个 runner）。无需中央轮询全量未读。
### 4.3 初始化与重启/重连约定（MVP）

本节从“写代码/封装边界”的角度，明确初始化与重启/重连时系统应做的事情。

#### 4.3.1 Workspace 创建 vs Workspace 初始化（两个过程）

在代码结构上建议拆成两个独立 use-case/service（即使其中一个会调用另一个）：

1) **createWorkspace**：只负责创建 workspace 记录。
2) **bootstrapWorkspace / ensureWorkspaceInitialized**：负责在某个 workspace 内补齐“可用的默认实体”。

默认实体（MVP）建议包含：
- 1 个“人类” agent（当前用户的代表，role 可用 `human` 或 `user`）
- 1 个初始助手 agent（role 可用 `assistant` 或更具体的角色名）
- 1 个两人 P2P 群（包含上述两个 agent 的 `group_members`）

组合入口（产品常用）：
- **createWorkspaceWithDefaults**：内部先 `createWorkspace`，再 `bootstrapWorkspace`（推荐同事务；失败则回滚）。

#### 4.3.2 “重新进入”的几种语境与行为

这里的“重新进入”可能发生在不同层面，行为应分别定义：

- **用户首次使用软件**：检测无 workspace → 执行 `createWorkspaceWithDefaults` → 进入默认 P2P 群。
- **用户已创建过 workspace，重启再次打开**：不创建新数据；加载已有 workspace/agent/group，并恢复可用状态（见 4.3.3）。
- **后端进程重启**：跑迁移/连 DB → 从 `agents.llm_history` 恢复 agent 内存 context → 重放历史到 Realtime channel → 启动唤醒/未读检测逻辑。
- **前端刷新/重新进入页面**：先拉 history（或 SSE 初始 payload）再订阅增量事件（chunk/done），同时刷新群列表与未读数。

#### 4.3.3 后端启动时的最小步骤（有数据场景）

1. 加载 config（模型/Key 等）。
2. 连接数据库（必要时迁移）。
3. 读取所有 agent 的 `llm_history`，恢复到运行时内存 `context`。
4. 将历史推送到对应 Realtime channel（供前端 history 重放）。
5. 启动“唤醒/未读”驱动机制（轮询或工作流均可），确保 agent 能被新消息触发执行。

## 5. 前端实时同步方案 (Upstash Realtime)

### 5.1 架构

```
后端任务 → realtime.emit() → Redis Streams/Realtime （支持 history 自动重放）
                                         ↓
后端订阅（history + subscribe，内部有缓冲防丢事件）→ SSE (GET /api/agents/:id/context-stream) → 前端 EventSource
```

说明：
- Upstash 仍作为实时源，但只被后端消费；前端不直接连 Upstash。
- Realtime SDK 的 `subscribe({ history })` 实现细节：先建立 pubsub 订阅并将期间收到的消息缓存在 buffer，随后执行 `xrange` 回放历史、记录最后历史 ID，最后把 buffer 中 ID 大于历史末尾的事件补发给回调，避免“history 与 subscribe 之间的间隙”丢失；下游无需区分“历史/实时”。

### 5.2 Agent Context 流式展示

Agent context 的流由 Upstash 提供“历史重放 + 实时订阅”，后端只做转发；事件统一用一个类型 `agent.stream`，包含 `text` 片段，必要时带 `done` 标志。

**后端**（Next.js Route Handler 示意）：
```typescript
// app/api/agents/[id]/context-stream/route.ts
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const agentId = params.id;
  const channel = realtime.channel(`agent:${agentId}`);

  const stream = new ReadableStream({
    async start(controller) {
      await channel.subscribe({
        events: ['agent.stream'],
        history: { start: '-', end: '+', limit: 1000 },
        onData: (payload) => {
          controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);
        },
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

**前端**：
```typescript
// EventSource 监听 SSE
const es = new EventSource(`/api/agents/${agentId}/context-stream`);

es.onmessage = (event) => {
  const payload = JSON.parse(event.data); // { event: 'agent.stream', data: { text: string, done?: boolean } }
  // 根据 payload 更新 UI：追加 text；若 done=true 做收尾
  handleAgentStream(payload);
};

// 所有“触发类”动作（发消息/唤醒/工具执行）仍通过各自的 POST API 完成；
// SSE 仅负责下行的流式 context。
```

### 5.3 关键特性

| 特性 | 实现 |
|------|------|
| 断点续传 | Realtime `subscribe({ history })`（xrange 回放 + 内置缓冲防漏）或按 cursor 重放 |
| 多端同步 | 多个客户端订阅同一 channel |
| 刷新恢复 | 重新连接时自动读历史 |
| 类型安全 | zod schema 前后端共享 |

### 5.4 UI 事件流（对话列表 + Graph）

目标：前端无需命令式控制，靠事件/状态流驱动界面。默认用 SSE，必要时可换 WebSocket。

- 传输：后端汇聚 Upstash/Redis 事件，暴露 `GET /api/ui-stream`（SSE）；前端 EventSource 订阅。
- 事件类型（示例，命名可调整为统一前缀）：
  - `ui.group.message`：{ groupId, message: { id, senderId, content, contentType, sendTime } } → 用于当前会话和列表未读（也可仅作“有更新”提示，再用 API 拉具体增量）。
  - `ui.group.summary`：{ groupId, lastMessage, unreadCount, updatedAt } → 左侧对话列表更新。
  - `ui.graph.edge`：{ fromAgentId, toAgentId, messageId, groupId, sendTime } → Graph 动画/连线。
- 重连：事件携带递增 id/cursor，前端断线重连时带上 Last-Event-ID；后端按 cursor 重放缺口（与消息流同语义），无需额外 snapshot。
- 回退：若 SSE 不可用，消息侧短轮询 summary/messages；Graph 可定期拉 snapshot 或按需重建。

## 6. API 接口设计（与 PRD 对应）

```typescript
// Workspace
GET  /api/workspaces
  -> { workspaces: Array<{ id, name, createdAt }> }
POST /api/workspaces             // 或 /api/workspaces/default
  -> { workspaceId, humanAgentId, assistantAgentId, defaultGroupId }

// 群组与消息
GET  /api/groups?workspaceId&agentId
  -> { groups: Array<{ id, name, unreadCount, lastMessage?: { content, contentType, sendTime, senderId }, updatedAt, createdAt }> }
POST /api/groups
  body: { workspaceId: UUID, memberIds: UUID[], name?: TEXT }
  -> { id, name, createdAt }
GET  /api/groups/:groupId/messages
  -> { messages: Array<{ id, senderId, content, contentType, sendTime }> } // 可分页，可全量
POST /api/groups/:groupId/messages
  body: { senderId: UUID, content: TEXT, contentType: TEXT }
  -> { id, sendTime }

// 未读（Agent 用）
GET /api/groups/:groupId/unread?agentId=...
  -> { messages: Array<{ id, senderId, content, sendTime }> } // 并更新 last_read_message_id
GET /api/unread/all?agentId=...
  -> Array<{ groupId: UUID, messages: Array<{ id, senderId, content, sendTime }> }>

// Agent
POST /api/agents
  body: { workspaceId: UUID, role: TEXT, parentId?: UUID }
  -> { id, role, createdAt }
GET  /api/agents?workspaceId=...
  -> { agents: Array<{ id, role, context, createdAt }> }
GET  /api/agents/:id
  -> { id, role, context, parentId, createdAt }

// Agent 上下文流（SSE，下行 agent.stream）
GET /api/agents/:id/context-stream

// 搜索建群
GET  /api/search?workspaceId=...&q=...
  -> { results: Array<{ id, type: 'human' | 'agent', name }> }

// Agent-Graph（数据源 + 流）
GET /api/agent-graph?workspaceId=...      // 只读数据
GET /api/graph-stream?workspaceId=...     // SSE/WebSocket，事件有序可断线重放
```

**说明**：Agent 发/收消息均通过群组接口（`sendMessage`/`getUnread`）；前端事件流用于提示/增量，实际消息可用全量接口拉取。
