# 为 Multi-Agent 设计的蜂群系统

![Demo](assets/image.png)

视频【开源版 Kimi-K2.5 蜂群多 Agent】  
https://www.bilibili.com/video/BV1X163BQE5c/?share_source=copy_web&vd_source=e0705640ea2f51669a392fb07684e286

## 优势
- 任意动态创建 sub-agent
- 可以向任意 agent 发送消息
- 微信式聊天界面，随时介入任何子代理
- 流式 graph 动态展现协作状态

## 哲学
Agent Swarm 只需要非常简单的原语即可驱动协作（如 create / send-message / tool-call 等）。  
具体理念与系统设计详见 `whitepaper-site/`。

## 运行方式
```
cd agent-wechat
cd backend

docker compose up -d
curl -X POST http://127.0.0.1:3017/api/admin/init-db
bun install
bun dev
```

访问 http://localhost:3017

点击 init-db ，然后创建 workspace 即可开始对话。

对话中，你可以询问他都有哪些能力，然后用自然语言就能让它开始运作
