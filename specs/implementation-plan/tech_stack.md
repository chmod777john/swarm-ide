# 技术方案: Agent Wechat 架构设计

## 1. 技术栈
*   **Runtime**: Bun
*   **Backend**: Next.js Route Handlers / API Routes
*   **ORM**: Drizzle ORM (PostgreSQL)
*   **Streaming**: Redis Streams (local) + SSE
*   **Background Jobs**: Upstash Workflow (或 Bun 后台任务)
*   **Frontend**: Next.js + Tailwind + Framer Motion

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
    *   `llm_history`: TEXT - 单 Agent 的全局 LLM 对话历史（JSON: [{role, content, tool_calls, ...}]），与 IM group 无关
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
