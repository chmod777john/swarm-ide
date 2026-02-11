import fs from "node:fs/promises"; // Node.js 提供的 Promise 版文件系统模块，用于异步读取/写入文件
import path from "node:path"; // Node.js 路径处理模块，提供跨平台路径拼接、解析等工具
import { Client } from "@modelcontextprotocol/sdk/client/index.js"; // MCP SDK 的核心客户端类
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"; // 用于通过 Server-Sent Events (SSE) 与服务器通信的传输层
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"; // 通过子进程 stdio 与服务器交互的传输层
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"; // 使用 HTTP 流式接口与服务器通信的传输层

/**
 * MCP（Model Context Protocol）服务器配置类型。
 *
 * - type: 连接方式，可选 "stdio"、"http" 或 "sse"
 * - command, args, env: 用于 stdio 模式下启动子进程
 * - url / httpUrl / sseUrl: HTTP/SSE 服务器的 URL
 * - headers: 请求头（仅在 HTTP/SSE 模式下使用）
 * - disabled: 是否禁用此服务器，禁用后不会连接和加载工具
 * - timeoutMs: 单独为该服务器设置的超时时间，单位毫秒
 */
type McpServerConfig = {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  httpUrl?: string;
  sseUrl?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
  timeoutMs?: number;
};

/**
 * MCP 配置文件的结构。
 *
 * - mcpServers: 一个以服务器名称为键、McpServerConfig 为值的对象
 */
type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfig>;
};

/**
 * MCP 工具（function）的定义，来自服务端返回的工具列表。
 *
 * - name: 工具内部使用的唯一标识符
 * - description: 可选描述文字
 * - inputSchema: 参数的 JSON Schema，若没有则默认为空对象
 */
type McpToolDef = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

/**
 * 注册到本地 registry 的工具条目。
 *
 * - exposedName: 对外公开的名字（可能经过去重或命名空间前缀）
 * - serverName: 所属服务器名称
 * - toolName: 原始工具内部名称
 * - description: 工具描述，可用作提示语
 * - inputSchema: 参数模式，保证为合法对象
 */
type McpToolEntry = {
  exposedName: string;
  serverName: string;
  toolName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

/**
 * 调用工具后返回的结果结构。
 *
 * - ok: 是否成功（如果 isError 为 true 或捕获异常则为 false）
 * - content: 工具输出文本
 * - error: 出错时的错误信息字符串
 * - raw: 原始来自服务端的响应对象，供调试或进一步处理使用
 */
type McpToolCallResult = {
  ok: boolean;
  content?: string;
  error?: string;
  raw?: unknown;
};

/**
 * 默认超时时间（毫秒），可通过环境变量 MCP_TIMEOUT_MS 覆盖。
 *
 * 如果环境变量存在且大于0，则使用该值；否则使用 30_000ms (30 秒)。
 */
const DEFAULT_TIMEOUT_MS =
  Number(process.env.MCP_TIMEOUT_MS) > 0 ? Number(process.env.MCP_TIMEOUT_MS) : 30_000;

/**
 * 清理 Node.js 环境变量，返回仅包含字符串值的对象
 *
 * @param env 原始 process.env 对象
 * @returns {Record<string, string>} 只保留键值为字符串的环境变量集合
 */
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * 根据优先级规则定位 MCP 配置文件的位置。
 *
 * 1. 首先检查环境变量 MCP_CONFIG_PATH 指定的路径
 * 2. 如果没有或者无效，则在当前工作目录下按顺序查找：
 *    - mcp.json
 *    - backend/mcp.json
 *    - .mcp.json
 *    - backend/.mcp.json
 *
 * @returns {Promise<string | null>} 配置文件绝对路径，若不存在则返回 null
 */
async function resolveMcpConfigPath(): Promise<string | null> {
  const envPath = process.env.MCP_CONFIG_PATH;
  if (envPath) {
    const abs = path.resolve(envPath);
    try {
      await fs.access(abs);
      return abs; // 环境变量指定的文件存在
    } catch {
      return null; // 文件不存在或不可访问
    }
  }

  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "mcp.json"),
    path.join(cwd, "backend", "mcp.json"),
    path.join(cwd, ".mcp.json"),
    path.join(cwd, "backend", ".mcp.json"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate; // 找到第一个可访问的文件
    } catch {
      // ignore: 文件不存在，继续尝试下一个候选路径
    }
  }
  return null; // 所有候选路径均无效
}

/**
 * 对工具参数 Schema 做一次简单校验和默认值填充。
 *
 * @param inputSchema 原始输入模式（可能为 undefined）
 * @returns {Record<string, unknown>} 合法的 JSON Schema 对象；若原始为空则返回 `{ type: "object", properties: {} }`
 */
function normalizeToolSchema(inputSchema?: Record<string, unknown>) {
  if (inputSchema && typeof inputSchema === "object") return inputSchema;
  return { type: "object", properties: {} };
}

/**
 * 对服务端工具执行结果进行格式化。
 *
 * - `isError`: 若返回对象包含 `isError` 字段且为真，则认为是错误
 * - `content`: 支持三种情况：
 *   1. `result.content` 是数组：遍历每个元素，若有 `.text` 字符串则取之，否则尝试 JSON.stringify 或 fallback to String。
 *   2. `result.content` 是字符串：直接使用。
 *   3. 其它类型：先尝试 JSON.stringify，然后转为字符串。
 *
 * @param result 调用工具后原始返回对象
 * @returns 包含 `content` 与 `isError` 标识的结构，用于统一处理
 */
function formatToolOutput(result: any): { content: string; isError: boolean } {
  const isError = !!result?.isError;
  const content = Array.isArray(result?.content)
    ? result.content
        .map((item: any) => {
          if (typeof item?.text === "string") return item.text;
          try {
            return JSON.stringify(item);
          } catch {
            return String(item);
          }
        })
        .join("\n")
    : typeof result?.content === "string"
      ? result.content
      : (() => {
          try {
            return JSON.stringify(result);
          } catch {
            return String(result);
          }
        })();
  return { content, isError };
}

/**
 * McpRegistryOptions 用于在加载时指定额外参数。
 *
 * - loadTimeoutMs: 若指定则在尝试加载时设置全局超时时间
 */
type McpRegistryOptions = {
  loadTimeoutMs?: number;
};

/**
 * MCP Registry 类负责：
 * 1. 按需加载并连接所有服务器
 * 2. 收集、注册工具到本地映射中
 * 3. 提供查询和调用工具的 API
 */
class McpRegistry {
  private loaded = false; // 标记是否已完成一次完整加载
  private loading: Promise<void> | null = null; // 当前正在进行中的加载 Promise（若有）
  private readonly clients = new Map<string, Client>(); // serverName -> Client 对象
  private readonly tools = new Map<string, McpToolEntry>(); // exposedName -> 工具条目
  private readonly reservedNames = new Set<string>(); // 预留名称集合，避免冲突

  /**
   * 确保注册表已被加载。
   *
   * @param reserved 可选的预留名称集合（例如全局占用的名字）
   * @param opts    可选加载配置
   */
  async ensureLoaded(reserved?: Set<string>, opts?: McpRegistryOptions) {
    if (reserved) {
      // 把外部传入的预留名称加入到内部集合，防止后续注册冲突
      for (const name of reserved) this.reservedNames.add(name);
    }
    if (this.loaded) return; // 已经完成加载，无需重复执行
    if (this.loading) return this.loading; // 还在进行中的加载任务直接返回
    this.loading = this.load(); // 开始异步加载

    if (opts?.loadTimeoutMs && opts.loadTimeoutMs > 0) {
      console.info(`[mcp] loading with timeout ${opts.loadTimeoutMs}ms`);
      await Promise.race([
        this.loading, // 正常完成
        new Promise<void>((resolve) => setTimeout(resolve, opts.loadTimeoutMs)), // 超时后 resolve
      ]);
      return;
    }
    await this.loading; // 等待完整加载结束
  }

  /**
   * 判断是否已经注册了指定名称的工具。
   *
   * @param name 要检查的工具公开名称
   * @returns {boolean} 是否存在
   */
  hasTool(name: string) {
    return this.tools.has(name);
  }

  /**
   * 获取所有已注册工具的定义列表，格式符合 OpenAI Function Calling 的 schema。
   *
   * @returns 数组，每项包含 name、description 和 JSON Schema 参数
   */
  getToolDefinitions() {
    return Array.from(this.tools.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.exposedName, // 对外公开的工具名
        description: tool.description ?? "", // 若无描述则使用空字符串
        parameters: tool.inputSchema, // 参数 JSON Schema
      },
    }));
  }

  /**
   * 调用已注册工具。
   *
   * @param name 工具公开名称
   * @param args 传递给工具的参数对象
   * @returns {Promise<McpToolCallResult>} 调用结果包装
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const entry = this.tools.get(name);
    if (!entry) return { ok: false, error: `Unknown MCP tool: ${name}` };
    const client = this.clients.get(entry.serverName);
    if (!client) return { ok: false, error: `MCP server not connected: ${entry.serverName}` };

    try {
      // 通过 MCP SDK 的 callTool 方法请求服务器执行
      const result = await client.callTool({ name: entry.toolName, arguments: args });
      const formatted = formatToolOutput(result);
      return {
        ok: !formatted.isError,
        content: formatted.content,
        raw: result,
      };
    } catch (err) {
      // 捕获网络/解析等错误，统一返回失败状态
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 主加载流程：读取配置文件、连接所有服务器、收集工具。
   *
   * 步骤：
   * 1. 定位配置文件路径
   * 2. 解析 JSON 并提取服务器列表
   * 3. 对每个服务器执行：
   *    - 如果被禁用则跳过
   *    - 建立连接
   *    - 列出其工具并注册
   *
   * @private
   */
  private async load() {
    const configPath = await resolveMcpConfigPath();
    if (!configPath) {
      console.info("[mcp] config not found; skipping MCP load");
      this.loaded = true;
      return;
    }
    console.info(`[mcp] loading config from ${configPath}`);

    let config: McpConfigFile | null = null;
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(raw) as McpConfigFile; // 解析 JSON
    } catch {
      this.loaded = true;
      return;
    }

    const servers = config?.mcpServers ?? {};
    const entries = Object.entries(servers);
    for (const [name, server] of entries) {
      if (server?.disabled) continue; // 跳过已禁用的服务器
      try {
        console.info(`[mcp] connecting ${name}...`);
        const client = await this.connectServer(name, server); // 建立与该服务器的连接
        this.clients.set(name, client); // 记录客户端实例
        const tools = await this.listTools(client); // 获取工具列表
        console.info(`[mcp] ${name} tools: ${tools.length}`);
        for (const tool of tools) {
          this.registerTool(name, tool); // 注册每个工具
        }
      } catch (err) {
        console.warn(
          `[mcp] ${name} failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    console.info(`[mcp] total tools loaded: ${this.tools.size}`);
    this.loaded = true;
  }

  /**
   * 调用服务器的 `listTools` 接口获取可调用工具列表。
   *
   * @param client 已连接的 Client 实例
   * @returns Promise<Array<McpToolDef>>，若出错则返回空数组
   */
  private async listTools(client: Client): Promise<McpToolDef[]> {
    try {
      const response = await client.listTools({});
      return Array.isArray(response?.tools) ? (response.tools as McpToolDef[]) : [];
    } catch {
      return []; // 网络或解析错误时返回空数组
    }
  }

  /**
   * 将服务器工具注册到本地 registry。
   *
   * 为避免名称冲突，先尝试使用原始 tool.name，
   * 若已被保留或已有同名条目，则按 `mcp.{serverName}.{baseName}` 的形式生成
   * 并在需要时继续追加计数后缀，直到获得唯一名称。
   *
   * @param serverName MCP 服务器的注册名称
   * @param tool      待注册的工具定义
   */
  private registerTool(serverName: string, tool: McpToolDef) {
    const baseName = tool.name;
    const schema = normalizeToolSchema(tool.inputSchema);
    let exposedName = baseName;

    // 检查名称是否冲突
    if (this.reservedNames.has(exposedName) || this.tools.has(exposedName)) {
      let next = `mcp.${serverName}.${baseName}`;
      let counter = 2;
      while (this.reservedNames.has(next) || this.tools.has(next)) {
        next = `mcp.${serverName}.${baseName}.${counter++}`;
      }
      exposedName = next; // 用唯一的命名空间前缀
    }

    this.tools.set(exposedName, {
      exposedName,
      serverName,
      toolName: baseName,
      description: tool.description ?? `[mcp:${serverName}] ${baseName}`,
      inputSchema: schema,
    });
  }

  /**
   * 根据服务器配置创建并返回已连接的 Client 实例。
   *
   * 支持三种传输方式：
   * - stdio: 启动子进程，使用 StdioClientTransport
   * - sse / http: 使用 SSE 或 StreamableHTTPClientTransport
   *
   * @param name   服务器名称（用于日志）
   * @param server 配置对象
   * @returns Promise<Client> 已连接的客户端
   */
  private async connectServer(name: string, server: McpServerConfig) {
    // 初始化一个新的 Client，client 名称仅做标识（可随意更改）
    const client = new Client({ name: "agent-wechat", version: "0.0.1" });
    const timeout = server.timeoutMs ?? DEFAULT_TIMEOUT_MS; // 单独的超时设置

    // stdio 模式
    if (server.command || server.type === "stdio") {
      if (!server.command) throw new Error(`Missing MCP command for server: ${name}`);
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        env: { ...cleanEnv(process.env), ...(server.env ?? {}) },
      });
      await client.connect(transport, { timeout }); // 建立连接
      return client;
    }

    // 确定 HTTP/SSE URL
    const url =
      server.httpUrl ??
      server.sseUrl ??
      server.url ??
      (() => {
        throw new Error(`Missing MCP url for server: ${name}`);
      })();

    const requestInit = server.headers ? { headers: server.headers } : undefined;

    // SSE 模式（或显式指定 sseUrl）
    if (server.type === "sse" || server.sseUrl) {
      const transport = new SSEClientTransport(new URL(url), { requestInit });
      await client.connect(transport, { timeout }); // 建立连接
      return client;
    }

    // 默认使用 HTTP 流式传输
    const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit });
    await client.connect(transport, { timeout }); // 建立连接
    return client;
  }
}

// 单例模式：整个进程只维护一个 Registry 实例
let registry: McpRegistry | null = null;

/**
 * 获取全局 MCP Registry。
 *
 * 第一次调用会创建实例并触发加载；后续调用直接返回已创建的实例。
 *
 * @param reserved 可选预留名称集合，防止与内部或外部工具冲突
 * @param opts    加载时可选参数，例如超时时间
 * @returns {Promise<McpRegistry>} 注册表实例
 */
export async function getMcpRegistry(reserved?: Set<string>, opts?: McpRegistryOptions) {
  if (!registry) registry = new McpRegistry();
  await registry.ensureLoaded(reserved, opts);
  return registry;
}