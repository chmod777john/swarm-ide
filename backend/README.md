# agent-wechat backend (MVP)

独立 Next.js 后端（Route Handlers），用 Bun 运行。

## 环境变量
- `DATABASE_URL`：PostgreSQL 连接串（例如 `postgres://user:pass@localhost:5432/agent_wechat`）
- `REDIS_URL`：Redis 连接串（例如 `redis://localhost:6379`）
- `OPENROUTER_API_KEY`：OpenRouter API Key（必填）
- `OPENROUTER_BASE_URL`（可选）：默认 `https://openrouter.ai/api/v1/responses`（若配置为 `/chat/completions` 会自动改写到 `/responses`）
- `OPENROUTER_MODEL`（可选）：OpenRouter 模型名（留空则使用服务端默认）
- `OPENROUTER_HTTP_REFERER`（可选）：OpenRouter 建议的 `HTTP-Referer`
- `OPENROUTER_APP_TITLE`（可选）：OpenRouter 建议的 `X-Title`
- `OPENROUTER_REASONING_EFFORT`（可选）：`low` / `medium` / `high`，为空则不强制附带 reasoning 参数

## 启动 PostgreSQL + Redis（Docker）
```bash
cd backend
docker compose up -d
```

## 本地启动
```bash
cd backend
bun install
OPENROUTER_API_KEY=xxx bun run dev
```

## 初始化数据库（MVP）
启动后先执行一次：
```bash
curl -X POST http://localhost:3017/api/admin/init-db
```

## 已实现接口（当前骨架）
- `GET /api/health`
- `GET/POST /api/workspaces`
- `GET/POST /api/groups?workspaceId&agentId`
- `GET/POST /api/groups/:groupId/messages?markRead=true&readerId=...`
- `GET /api/agents/:agentId/context-stream`（SSE：agent 推理/上下文流；连接时会尝试唤醒 agent 处理未读）
- `POST /api/llm/stream`（SSE：转发 OpenRouter `/responses` 并聚合流式响应，支持 `reasoning` 请求参数）
