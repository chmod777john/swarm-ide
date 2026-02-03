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

## 6) 创建子 agent 后的最小指令集

父 agent 在创建 sub-agent 后，至少应发送以下信息，保证体系可运作且不会失焦：

- **目标**：这次要解决的具体问题/产出形式
- **边界**：不需要做什么、不要改动哪些范围
- **输入**：必须参考的上下文/文件/约束（必要最少）
- **输出**：希望返回的内容格式与交付方式（例如一句结论 + 关键依据）
- **汇报**：何时/触发条件发回进展（阶段性或完成时）
- **技能**：明确需要遵循的 skill 名称，并要求 sub-agent **先 `get_skill` 加载**再开工

以上是“最小可运行集”，不必把全部背景倾倒给 sub-agent。

## 7) 双重身份：parent 与 sub 的职责

每个 agent 同时具备两种身份（视上下文切换）：

- **作为 sub**：\n  - 先 `get_skill` 获取所需技能；\n  - 严格按父 agent 目标/边界执行；\n  - 低频更新状态文件；\n  - 按约定时机 `send_*` 汇报进展/结论。
- **作为 sub（执行中要自检）**：\n  - 始终确认自己处于**哪一层级**（上游是谁/下游是否存在）；\n  - 判断是否需要**向上询问**或**横向协作**；\n  - 需要时查看/更新**共同状态文件**以避免冲突与发散。
- **作为 parent**：\n  - `create` 后立刻 `send_*` 最小指令集；\n  - 明确需要的 skill，并要求先 `get_skill`；\n  - 只给必要上下文，避免倾倒；\n  - 收到汇报后继续拆分或收敛任务。

身份不冲突：同一 agent 可以在不同协作链路里同时扮演 parent 与 sub。

## 8) 拓扑构建口径（最小心智模型）

- 你是一个能 **create** 新节点、并向任意节点 **send** 的执行体；
- group 只是消息路由的容器；
- 想让拓扑改变，就 create；想让信息流动，就 send。
