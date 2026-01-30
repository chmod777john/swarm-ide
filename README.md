# Swarm-IDE: 自组织的Agent蜂群

[English README](./README_EN.md)

[![Demo](assets/image.jpg)](https://www.bilibili.com/video/BV1X163BQE5c/?share_source=copy_web&vd_source=e0705640ea2f51669a392fb07684e286)

## 🎬 视频【开源版 Kimi-K2.5 蜂群多 Agent】
- Demo：
<video src="https://github.com/user-attachments/assets/4ebd88c6-bbdb-4714-87a5-54d1fed08db8" width="100%" controls></video>
- 详情视频： https://www.bilibili.com/video/BV1X163BQE5c/?share_source=copy_web&vd_source=e0705640ea2f51669a392fb07684e286

## 加入微信群
<img src="./assets/qrcode.png" alt="WeChat QR" width="240" />

## 知乎文章
https://zhuanlan.zhihu.com/p/2000736341479138182

## 优势
- 任意动态创建 sub-agent
- 可以向任意 agent 发送消息
- 微信式聊天界面，随时介入任何子代理
- 流式 graph 动态展现协作状态

## 界面设计
- Graph 直接展示蜂群拓扑与实时通信链路
- 树状多级对话列表：可以像微信一样选择任意 agent 对话（即使是深层次）
- LLM history 面板：实时展示该 agent 的上下文，agent 不再是黑箱
- 实时流式输出 tool-call 参数

## 哲学
- 极简原语：系统只依赖少量通信原语即可表达多 Agent 行为（核心是 create + send，复杂协作由此组合而来）。
- 液态拓扑：拓扑不预设、在运行中自演化；遇到复杂任务时由 Agent 主动“雇佣”下属。
- 扁平协作：人类可以像聊天一样介入任意层级，使复杂拓扑可观察、可调试、可介入。

## 概念
没有 nodes 和 edges 的复杂抽象，只需把系统理解为“很多个人”：

每个人都能生孩子、也能和任意一个人说话。

只要有这两种能力，就能实现任意结构

## 运行方式
```
cd agent-wechat
cd backend

cp .env.example .env.local
# 在 .env.local 填写你的 KEY 和模型

docker compose up -d
curl -X POST http://127.0.0.1:3017/api/admin/init-db
bun install
bun dev
```

访问 http://localhost:3017

点击 init-db ，然后创建 workspace 即可开始对话。

直接跟他说"创建 3 个儿子，给他们分别发消息，让他们再次自己创建 3 个孙子"

## 环境变量说明
后端读取 `backend/.env.local`，你需要填写：
- `GLM_API_KEY` / `GLM_MODEL`（我使用的是 **GLM CodingPlan**）
- `OPENROUTER_API_KEY` / `OPENROUTER_MODEL`（我使用的是 **OpenRouter Kimi 2.5**）
- 其它连接项请参考 `backend/.env.example`
