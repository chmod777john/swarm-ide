# Swarm-IDE: 自组织的Agent蜂群

[English README](./README_EN.md)

<p align="center">
  <a href="https://star-history.com/#chmod777john/agent-wechat&Date">
    <img src="https://api.star-history.com/svg?repos=chmod777john/agent-wechat&type=Date" alt="Star History Chart" width="520" />
  </a>
</p>

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

## 对比
| 对比项 | Kimi-Swarm | Claude Agent Team | Swarm-IDE |
| --- | --- | --- | --- |
| 支持嵌套 Agent | ❌ | ❌ | ✅ |
| 支持 Agent 间通信 | ❌ | ✅ | ✅ |
| 支持人给 sub-agent 通信 | ❌ | ✅ | ✅ |
| 支持群聊模式 | ❌ | ❌ | ✅ |
| 支持可视化 | ❌ | ❌ | ✅ |
| 是否开源 | ❌ | ❌ | ✅ |

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
提供两种方式：

### 方式一：一键打开 Codespaces

本系统要运行在 Linux 上，如果你没有 Linux 系统的话或者装环境遇到问题的话，可以尝试使用 GitHub 提供的免费虚拟机。点击链接创建虚拟机后，就可以执行后面的指令了

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?hide_repo_select=true&repo=chmod777john/swarm-ide)

### 方式二：本地运行
```
cd swarm-ide
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

### MCP 配置
后端会自动加载 MCP 配置文件，支持以下位置（按优先级）：  
1) `MCP_CONFIG_PATH` 指定的文件  
2) 项目根目录：`mcp.json` / `.mcp.json`  
3) `backend/`：`backend/mcp.json` / `backend/.mcp.json`

最小示例（stdio/http/sse 任选其一）：  
```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "python",
      "args": ["-m", "your_mcp_server_module"],
      "env": { "TOKEN": "xxx" },
      "timeoutMs": 30000
    }
  }
}
```

字段说明（常用）：`type`、`command`/`args`、`url`/`httpUrl`/`sseUrl`、`headers`、`env`、`disabled`、`timeoutMs`。

### Skill 支持
后端会自动扫描技能目录并注入到新 agent 的系统提示中：
- 默认扫描路径：`skills/` 或 `backend/skills/`
- 可通过 `AGENT_SKILLS_DIR` 指定自定义路径
- 在 `SKILL.md` 的 frontmatter 里设置 `auto-load: true` 可让该技能**自动注入**到新 agent

技能使用方式：
- 对应技能会出现在 “Available Skills” 列表
- 需要时调用 `get_skill` 获取完整内容

## 环境变量说明
后端读取 `backend/.env.local`，你需要填写：
- `GLM_API_KEY` / `GLM_MODEL`（我使用的是 **GLM CodingPlan**）
- `OPENROUTER_API_KEY` / `OPENROUTER_MODEL`（我使用的是 **OpenRouter Kimi 2.5**）
- 其它连接项请参考 `backend/.env.example`
