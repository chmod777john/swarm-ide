---
name: topology
description: Explain how the IM+Agent framework runs, including the minimal primitives (create/send/create_group), message vs llmHistory separation, and the event/stream flow. Use when an agent needs to understand system operation or coordination logic.
---

# 框架运行逻辑（极简原语）

理解以下运行机制与原语，才能正确组织任意拓扑协作。

## 1) 核心对象与流转

- **Group 是会话容器**：所有消息都在 group 内流转（P2P 或多人群）。
- **Agent 以“读未读 → 调 LLM → 执行工具 → 写回历史”循环运行**：
  - 拉取该 agent 在各 group 的未读消息；
  - 把消息拼成 user 内容，追加到 `llmHistory`；
  - 调用 LLM（可多轮工具）；
  - 工具执行结果写回 `llmHistory`；
  - 最终把 assistant 输出写回 `llmHistory`。

## 2) 消息与 LLM 历史是两条线

- **LLM 输出不会自动进入 messages**。
- **只有显式 `send_*` 工具才会产生 messages**（让人类或其他 agent 真正“收到”）。
- 因此：**想让别人看到，就必须 `send_*`**。

## 3) 极简原语 = create + send（外加 create_group）

用于组织任意拓扑的最小原语集合：

- `create(role, guidance?)`：创建子 agent。
- `send_direct_message(toAgentId, content, contentType?)`：向某个 agent 发送；内部自动创建/复用 P2P group。
- `create_group(memberIds, name?)`：创建多人 group。
- `send_group_message(groupId, content, contentType?)`：向多人群发送。

> 口径上可以说“create + send 组织拓扑”，但多人结构需要 `create_group` 作为群原语。

## 4) 流式输出与事件通道

- **context-stream（按 agent）**：`agent.stream` 分三类输出：
  - `reasoning` / `content` / `tool_calls`；
  - 工具执行结果会再发 `tool_result`；
  - `agent.done` 表示一次 LLM 推理轮结束。
- **ui-stream（按 workspace）**：只做“通知”，不承载完整消息：
  - `ui.agent.llm.start/done`、`ui.agent.tool_call.start/done`、`ui.message.created` 等。

## 5) 运行定位（拓扑视角）

当你在构建或协作时，只需把自己视为：

- 一个能 **create** 新节点并 **send** 到任意节点/群的执行体；
- 每个节点都通过 group 连接，拓扑由 group 结构与消息路由决定；
- 任何协作都应以“谁需要收到消息”为核心，主动 `send_*`。
