# PRD 

agent 系统： create + send + wakeup 机制

前端分三个区

IM界面：

人类是特殊的 agent 

首次进入（或新建 workspace）时：自动创建 1 个“人类 agent”与 1 个“初始助手 agent”，并自动建立二者的 P2P 对话（默认会话）。

左侧边栏是对话列表。右侧是对话区。跟微信一样

未读消息小红点。，

## 会话可见性（MVP 约定）

左侧边栏只展示“当前人类（human agent）所在的群组（group_members 含该 human）”的会话与消息。

Agent-Graph 界面：展示 Agent 间的事件和数据流动

Agent 详情区：

展示 agent 的 LLM 历史（`llm_history`），非流式；通过 UI 事件或 `agent.done` 触发刷新。
`llm_history` 为单 Agent 全局记忆，与 IM group 无关。

## 用户操作路径（MVP）

1) 首次进入/新建 workspace：系统自动创建人类 agent、初始助手 agent，并建立两者的 P2P 会话，落到默认对话。
2) 进入页面加载列表：拉取对话列表（含每个会话的最近一条消息摘要与未读数），按时间排序显示。[并且建立监听后端的连接，当后端有类似发消息等等的事件发生时，触发拉取]   [LLM history 不用流式，收到 UI 事件或 `agent.done` 后按需拉取]
3) 发送消息：人在当前会话输入文本，消息写入后触发助手唤醒。
4) 助手响应：助手拉取未读 → 推理输出 → 完整输出写入 `llm_history`；前端通过 UI 事件触发后拉取 `llm_history` 展示。
   **注意**：推理产出不会自动写回当前会话；若要对人类或其他 agent 发送消息，必须显式调用 IM 工具（如 `send_group_message` / `send_direct_message`）。

5) 拉取分为拉侧边栏和拉当前group
6) 刷新页面时，直接拉取最新 `llm_history` 展示

7) 用户让 assistant 创建 coder。创建事件触发监听拉取。此时拉取结果没有变化
8) 用户点击搜索栏，会列出 agents 和所有 groups 。用户点击单个 agent ，会自动拉群（若没有则新建）
9) 创建群聊又会触发一次拉取，此时侧边栏就有变化了（因为侧边栏的语义是显示所有当前角色所在的群）这样就会看到一个 coder
10) 用户给 coder 发消息，让他给 assistant 发消息。
11) coder 的消息 wake assistant 。assistant 拉取未读消息，知晓了 coder 发送的数字
12) 人类切换回 assistant 的界面，并且问他刚刚收到的数字是什么




## 界面草图（MVP 布局，ASCII）

```
┌───────────────────────────────────────────────────────────────┐
│ 左侧栏（导航/搜索/Workspace）                                 │
│ ┌───────────────────────────┐ ┌───────────────┐              │
│ │ Workspace 切换 ▼          │ │ 全局搜索框    │              │
│ └───────────────────────────┘ └───────────────┘              │
│ [按钮] Agent-Graph  |  设置                                   │
│                                                           │
│ ┌───────────────────────────┐                              │
│ │ 对话列表（按 workspace）   │                              │
│ │ • 群A   [摘要]   ●未读      │                              │
│ │ • 群B   [摘要]             │                              │
│ │ • P2P 人类↔助手  ●         │                              │
│ └───────────────────────────┘                              │
└───────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│ 主区：聊天 + 详情                                             │
│ ┌───────────────────────────────┬───────────────────────────┐ │
│ │ 聊天窗口（当前会话）          │ │ Agent 详情（可折叠/抽屉） │ │
│ │ ┌─────────────────────────┐   │ │ LLM history（非流式）    │ │
│ │ │ 消息气泡区               │   │ │ JSON 预格式化展示        │ │
│ │ │ [时间分割线]             │   │ │                         │ │
│ │ │ 人: 你好                 │   │ │                         │ │
│ │ │ 助手: ... (流式中)       │   │ │                         │ │
│ │ └─────────────────────────┘   │ └─────────────────────────┘ │
│ │ 输入区: [ 文本框 .... ][发送] │                               │
│ └───────────────────────────────┴───────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│ Agent-Graph 页面（独立 Tab/路由）                             │
│  圆点=Agent（含人类），箭头=消息/事件流，可点节点开详情      │
└───────────────────────────────────────────────────────────────┘
```

## 前后端通信（MVP 操作路径对应接口）

### 1) 首页创建 Workspace
- 首页提供“创建 Workspace”入口；用户点击后触发  
  `POST /api/workspaces`（或 `/api/workspaces/default`），在创建 workspace 的同时**自动创建 human + assistant + 默认 P2P 群**，返回  
  `{ workspaceId, humanAgentId, assistantAgentId, defaultGroupId }`。
- 创建成功后进入 IM 页面，默认进入 P2P 会话（human ↔ assistant）。

### 2) 非首次进入 / 已有 Workspace
- 首页通过 `GET /api/workspaces` 拉取列表；用户选择后进入 IM 页面。

### 2) 页面初始化 / 刷新加载
- **会话列表**：`GET /api/groups?workspaceId=...&agentId=...`  
  返回群列表 + `unreadCount` + `lastMessage` + `updatedAt`，按时间排序。
- **当前会话历史**：`GET /api/groups/:id/messages`  
  拉取全量消息用于恢复消息区。
- **Agent LLM history**：`GET /api/agents/:id`  
  返回 `{ agentId, role, llmHistory }`；前端在 UI 事件或 `agent.done` 后按需拉取并展示。
- 推理完成后将完整输出写入持久化 context（`llm_history`）；**不会自动写入 `messages`**。消息写入仅由显式 `send_*` 工具触发。
- **UI 事件流（可选）**：`GET /api/ui-stream?workspaceId=...`（SSE）  
  仅订阅当前 workspace 的更新提示，不承载完整消息数据，也不要求可恢复。
  触发场景：
  - 新消息写入（human/agent）：`ui.message.created`
  - 新群创建：`ui.group.created`
  - 新 agent 创建：`ui.agent.created`
  - LLM 调用开始：`ui.agent.llm.start`
  - LLM 调用结束：`ui.agent.llm.done`
  - LLM 历史持久化：`ui.agent.history.persisted`
  - Tool call 开始：`ui.agent.tool_call.start`
  - Tool call 结束：`ui.agent.tool_call.done`
  - 数据库写入完成：`ui.db.write`
  UI 事件到达后的前端动作：
  - 拉取侧边栏会话列表：`GET /api/groups?workspaceId=...&agentId=...`
  - 拉取当前打开的会话：`GET /api/groups/:id/messages`

### 3) 发送消息
- `POST /api/groups/:groupId/messages`  
  `body: { senderId, content, contentType }`
- 成功后后端唤醒目标 agent；流式推理通过 SSE 下行。

### 4) 创建 Agent（含 P2P 自动建立）
- `POST /api/agents` 创建新 agent 后，**自动创建该 agent ↔ human 的 P2P 群**（与创建者无关）。
- 如需加入现有群，可在创建时传 `groupId` 让新 agent 进入该群。

### 5) SSE 断线重连
- `context-stream` 为幂等 GET：断线后直接重新连接即可，服务端继续推送实时事件。
- `ui-stream` 仅通知实时事件，无需历史重放，断线后直接重连即可。

## IM 工具接口（Agent 可用）

为避免模型触达系统内部核心对象，仅提供必要的 IM 工具：
- `list_groups()`：返回该 agent 可见群。
- `list_group_members(groupId)`：返回群成员列表。
- `create_group(memberIds, name?)`：创建群（agent 固定隶属单一 workspace，工具默认在该 workspace 内操作）。
- `send_group_message(groupId, content, contentType?)`：向群发消息并触发唤醒。
- `send_direct_message(toAgentId, content, contentType?)`：向某人发消息。实现细节：先定位/创建包含该 agent 的 P2P 群，再向该群发送；返回结果需标明使用了哪种通道（复用已有群 / 新建群）。
- `get_group_messages(groupId)`：拉取历史消息（全量）。

## IM 系统 × Agent 系统：关键交互节点（非纯请求）

- **消息写入 → 唤醒机制**
- 任意 `send_message` 成功写入后，触发目标 agent 的 wake。
  - 被唤醒的 agent 进入 `getAllUnread` → LLM 推理 → 产出流式 chunk → 落库。
  - `getAllUnread` 约定：
    - 输入：`agentId`（隐式为当前 agent）。
    - 输出：按 group 聚合的未读批次 `[{ groupId, messages: [...] }]`。
    - 规则：每个 group 仅返回 `last_read_message_id` 之后的新消息；同一 group 内按 `send_time` 升序。
    - 处理：agent 读取到未读 batch 后即更新 `last_read_message_id` 到该 batch 最后一条（先标记已读再进入推理）。
    - 空结果：若无未读返回空数组，runner 进入阻塞等待。
- **未读拉取与已读回写**
  - agent 处理未读时，读取 `group_members.last_read_message_id` 作为边界。
  - 处理完成后更新 `last_read_message_id`，保证后续只处理增量。
- **流式上下文与消息入库的解耦**
- LLM 推理过程中，chunk 实时推送到 `agent.stream`。
- 推理完成后只写入持久化 context；对外消息必须通过显式 `send_*` 工具触发。
- **Agent → Agent 的消息路径**
  - agentA 使用 `send_message` 发往包含 agentB 的群。
  - agentB 的 runner 被唤醒，读取未读并进入推理。
