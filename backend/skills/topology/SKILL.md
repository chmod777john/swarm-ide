---
name: topology
description: Explain the IM+Agent framework: create+send as minimal primitives, IM system vs agent loop separation, message vs llmHistory, and the recursive property.
auto-load: true
---

# 框架哲学（两原语生成一切拓扑）

这个框架的最小抽象是两件事：

- **create**：生成新节点（agent）。
- **send**：在节点之间传递信息。

**任何协作拓扑都可以由 create + send 组合出来。**
系统提供 `create_group` / `send_group_message` 只是“多播容器”的便利工具，不改变最小原语的本质。

## 1) IM 系统与 Agent Loop 是两套系统

- **IM 系统**：管理 `group` 与 `message`，只关心“谁发给谁”。
- **Agent Loop**：管理 `llmHistory`、调用 LLM、执行工具、生成回应。

两者**相互独立**，唯一的桥接点是：

- Agent 从 IM 系统**拉取未读消息**，作为本轮 LLM 输入；
- 只有显式 `send_*` 才会在 IM 系统**产生消息**。

## 2) Agent Loop 的运作原理（内部视角）

每个 agent 都重复相同循环：

1. 拉取它在各 group 的未读消息；
2. 将消息拼成 user 内容，追加到 `llmHistory`；
3. 调用 LLM（可多轮工具调用）；
4. 工具结果写回 `llmHistory`；
5. 最终 assistant 输出写回 `llmHistory`；
6. 需要对外可见时，再显式 `send_*`。

**注意**：`llmHistory` 是 agent 内部记忆，不等于可见消息。

## 3) 消息与可见性的关键规则

- LLM 产生的内容**不会自动进入 messages**。
- 只有 `send_direct_message` / `send_group_message` 才会真正让他人“收到”。
- 因此协作的关键是：**谁需要知道，就必须 send。**

## 4) 递归属性（系统核心）

- 任何 agent 都可以 `create` 新 agent，并 `send` 给任意节点/群。
- 新 agent 运行**同一套 loop 逻辑**，再继续 `create` 与 `send`。
- 拓扑因此是**递归生成的**：没有中心控制器，只有不断扩展的节点网络。

## 5) 工作收敛：共同维护轻量状态文件

为避免发散，所有参与的 agent 都应**共同维护**一套轻量状态文件；每个 agent 在工作时更新自己的条目（低频即可），内容至少包含：

- `agent_id`
- 当前正在做的事情（当前任务）
- 当前进展 / 已完成的小结
- 上次更新时间

更新频率不必高，建议在**阶段性推进**或**任务完成**时写一次即可。

你总是同时有两个角色：parent 和 child

作为 parent ，你要思考可以如何分解任务，委派 childs，随后给他们发送什么消息。创建 child 之后，要告诉他全局当前状态文件在哪里
作为 child，你要思考有什么消息是你尚未明确的，你在团队中的位置，你要给谁发消息。
作为两种角色，你应该理解别人的消息并回复


## 8) 拓扑构建口径（最小心智模型）

- 你是一个能 **create** 新节点、并向任意节点 **send** 的执行体；
- group 只是消息路由的容器；
- 想让拓扑改变，就 create；想让信息流动，就 send。


## 典型协作模式
assistant 收到人类消息之后。当他需要创建多代理的时候，就先创建出一个全局状态文件.txt，然后向里面 append 他自己的身份+他的任务。
create 后要 send 告诉自己 create 出来的那个人，要去看这个 txt