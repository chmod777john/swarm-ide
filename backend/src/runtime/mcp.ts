import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfig>;
};

type McpToolDef = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpToolEntry = {
  exposedName: string;
  serverName: string;
  toolName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

type McpToolCallResult = {
  ok: boolean;
  content?: string;
  error?: string;
  raw?: unknown;
};

const DEFAULT_TIMEOUT_MS =
  Number(process.env.MCP_TIMEOUT_MS) > 0 ? Number(process.env.MCP_TIMEOUT_MS) : 30_000;

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

async function resolveMcpConfigPath(): Promise<string | null> {
  const envPath = process.env.MCP_CONFIG_PATH;
  if (envPath) {
    const abs = path.resolve(envPath);
    try {
      await fs.access(abs);
      return abs;
    } catch {
      return null;
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
      return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function normalizeToolSchema(inputSchema?: Record<string, unknown>) {
  if (inputSchema && typeof inputSchema === "object") return inputSchema;
  return { type: "object", properties: {} };
}

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

type McpRegistryOptions = {
  loadTimeoutMs?: number;
};

class McpRegistry {
  private loaded = false;
  private loading: Promise<void> | null = null;
  private readonly clients = new Map<string, Client>();
  private readonly tools = new Map<string, McpToolEntry>();
  private readonly reservedNames = new Set<string>();

  async ensureLoaded(reserved?: Set<string>, opts?: McpRegistryOptions) {
    if (reserved) {
      for (const name of reserved) this.reservedNames.add(name);
    }
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = this.load();
    if (opts?.loadTimeoutMs && opts.loadTimeoutMs > 0) {
      console.info(`[mcp] loading with timeout ${opts.loadTimeoutMs}ms`);
      await Promise.race([
        this.loading,
        new Promise<void>((resolve) => setTimeout(resolve, opts.loadTimeoutMs)),
      ]);
      return;
    }
    await this.loading;
  }

  hasTool(name: string) {
    return this.tools.has(name);
  }

  getToolDefinitions() {
    return Array.from(this.tools.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.exposedName,
        description: tool.description ?? "",
        parameters: tool.inputSchema,
      },
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const entry = this.tools.get(name);
    if (!entry) return { ok: false, error: `Unknown MCP tool: ${name}` };
    const client = this.clients.get(entry.serverName);
    if (!client) return { ok: false, error: `MCP server not connected: ${entry.serverName}` };

    try {
      const result = await client.callTool({ name: entry.toolName, arguments: args });
      const formatted = formatToolOutput(result);
      return {
        ok: !formatted.isError,
        content: formatted.content,
        raw: result,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

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
      config = JSON.parse(raw) as McpConfigFile;
    } catch {
      this.loaded = true;
      return;
    }

    const servers = config?.mcpServers ?? {};
    const entries = Object.entries(servers);
    for (const [name, server] of entries) {
      if (server?.disabled) continue;
      try {
        console.info(`[mcp] connecting ${name}...`);
        const client = await this.connectServer(name, server);
        this.clients.set(name, client);
        const tools = await this.listTools(client);
        console.info(`[mcp] ${name} tools: ${tools.length}`);
        for (const tool of tools) {
          this.registerTool(name, tool);
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

  private async listTools(client: Client): Promise<McpToolDef[]> {
    try {
      const response = await client.listTools({});
      return Array.isArray(response?.tools) ? (response.tools as McpToolDef[]) : [];
    } catch {
      return [];
    }
  }

  private registerTool(serverName: string, tool: McpToolDef) {
    const baseName = tool.name;
    const schema = normalizeToolSchema(tool.inputSchema);
    let exposedName = baseName;

    if (this.reservedNames.has(exposedName) || this.tools.has(exposedName)) {
      let next = `mcp.${serverName}.${baseName}`;
      let counter = 2;
      while (this.reservedNames.has(next) || this.tools.has(next)) {
        next = `mcp.${serverName}.${baseName}.${counter++}`;
      }
      exposedName = next;
    }

    this.tools.set(exposedName, {
      exposedName,
      serverName,
      toolName: baseName,
      description: tool.description ?? `[mcp:${serverName}] ${baseName}`,
      inputSchema: schema,
    });
  }

  private async connectServer(name: string, server: McpServerConfig) {
    const client = new Client({ name: "agent-wechat", version: "0.0.1" });
    const timeout = server.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (server.command || server.type === "stdio") {
      if (!server.command) throw new Error(`Missing MCP command for server: ${name}`);
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        env: { ...cleanEnv(process.env), ...(server.env ?? {}) },
      });
      await client.connect(transport, { timeout });
      return client;
    }

    const url =
      server.httpUrl ??
      server.sseUrl ??
      server.url ??
      (() => {
        throw new Error(`Missing MCP url for server: ${name}`);
      })();

    const requestInit = server.headers ? { headers: server.headers } : undefined;

    if (server.type === "sse" || server.sseUrl) {
      const transport = new SSEClientTransport(new URL(url), { requestInit });
      await client.connect(transport, { timeout });
      return client;
    }

    const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit });
    await client.connect(transport, { timeout });
    return client;
  }
}

let registry: McpRegistry | null = null;

export async function getMcpRegistry(reserved?: Set<string>, opts?: McpRegistryOptions) {
  if (!registry) registry = new McpRegistry();
  await registry.ensureLoaded(reserved, opts);
  return registry;
}
