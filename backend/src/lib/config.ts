import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedConfig: AppConfig | null = null;

export type AppConfig = {
  tokenLimit: number;
};

const DEFAULT_CONFIG: AppConfig = {
  tokenLimit: 100000,
};

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  try {
    const configPath = join(process.cwd(), "config", "app.json");
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<AppConfig>;

    cachedConfig = {
      tokenLimit: parsed.tokenLimit ?? DEFAULT_CONFIG.tokenLimit,
    };
    return cachedConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function resetConfigCache() {
  cachedConfig = null;
}
