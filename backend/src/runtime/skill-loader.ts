import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

export type SkillFrontmatter = {
  name?: string;
  description?: string;
  license?: string;
  "allowed-tools"?: string[];
  "auto-load"?: string | boolean;
  auto_load?: string | boolean;
  metadata?: Record<string, string>;
};

export type Skill = {
  name: string;
  description: string;
  content: string;
  skillPath: string;
  skillDir: string;
  license?: string;
  allowedTools?: string[];
  autoLoad?: boolean;
  metadata?: Record<string, string>;
};

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
}

function parseInlineList(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((item) => parseScalar(item))
    .filter((item) => item.length > 0);
}

function parseFrontmatter(text: string): SkillFrontmatter | null {
  const result: SkillFrontmatter = {};
  let currentListKey: string | null = null;
  let inMetadata = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const listMatch = line.match(/^\s*-\s*(.+)$/);
    if (listMatch && currentListKey) {
      const item = parseScalar(listMatch[1]);
      const existing = (result as Record<string, unknown>)[currentListKey];
      const list = Array.isArray(existing) ? existing : [];
      list.push(item);
      (result as Record<string, unknown>)[currentListKey] = list;
      continue;
    }

    if (inMetadata && /^\s+/.test(rawLine)) {
      const metaMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (metaMatch) {
        result.metadata = result.metadata ?? {};
        result.metadata[metaMatch[1]] = parseScalar(metaMatch[2]);
      }
      continue;
    }

    const kvMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const value = kvMatch[2] ?? "";

    currentListKey = null;
    inMetadata = false;

    if (!value) {
      if (key === "metadata") {
        result.metadata = result.metadata ?? {};
        inMetadata = true;
        continue;
      }
      currentListKey = key;
      continue;
    }

    if (key === "allowed-tools") {
      const inlineList = parseInlineList(value);
      result["allowed-tools"] = inlineList ?? [parseScalar(value)];
      continue;
    }

    if (key === "metadata") {
      result.metadata = result.metadata ?? {};
      continue;
    }

    (result as Record<string, unknown>)[key] = parseScalar(value);
  }

  if (!result.name || !result.description) return null;
  return result;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function findSkillFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findSkillFiles(fullPath);
        results.push(...nested);
        return;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    })
  );

  return results;
}

function processSkillPaths(content: string, skillDir: string): string {
  const patternDirs =
    /(python\s+|`)((?:scripts|examples|templates|reference|references|assets)\/[^\s`\)]+)/g;
  content = content.replace(patternDirs, (match, prefix, relPath) => {
    const absPath = path.join(skillDir, relPath);
    if (existsSync(absPath)) return `${prefix}${absPath}`;
    return match;
  });

  const patternDocs =
    /(see|read|refer to|check)\s+([a-zA-Z0-9_-]+\.(?:md|txt|json|yaml))([.,;\s])/gi;
  content = content.replace(patternDocs, (match, prefix, filename, suffix) => {
    const absPath = path.join(skillDir, filename);
    if (existsSync(absPath)) {
      return `${prefix} \`${absPath}\` (use read_file to access)${suffix}`;
    }
    return match;
  });

  const patternMarkdown =
    /(?:(Read|See|Check|Refer to|Load|View)\s+)?\[(`?[^`\]]+`?)\]\(((?:\.\/*)?[^)]+\.(?:md|txt|json|yaml|js|ts|py|html))\)/gi;
  content = content.replace(patternMarkdown, (match, prefix, linkText, filepath) => {
    const cleanPath = filepath.startsWith("./") ? filepath.slice(2) : filepath;
    const absPath = path.join(skillDir, cleanPath);
    const lead = prefix ? `${prefix} ` : "";
    if (existsSync(absPath)) {
      return `${lead}[${linkText}](\`${absPath}\`) (use read_file to access)`;
    }
    return match;
  });

  return content;
}

export class SkillLoader {
  private loaded = false;
  private skills = new Map<string, Skill>();
  private loading: Promise<void> | null = null;

  constructor(private readonly skillsDir: string) {}

  async discoverSkills() {
    if (this.loaded) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      if (!(await fileExists(this.skillsDir))) {
        this.loaded = true;
        return;
      }

      const skillFiles = await findSkillFiles(this.skillsDir);
      await Promise.all(
        skillFiles.map(async (skillFile) => {
          const raw = await fs.readFile(skillFile, "utf-8");
          const match = raw.match(FRONTMATTER_RE);
          if (!match) return;

          const frontmatter = parseFrontmatter(match[1]);
          if (!frontmatter || !frontmatter.name || !frontmatter.description) return;

          const skillDir = path.dirname(skillFile);
          const content = processSkillPaths(match[2].trim(), skillDir);
          const autoLoad = parseBoolean(
            (frontmatter as Record<string, unknown>)["auto-load"] ??
              (frontmatter as Record<string, unknown>)["auto_load"]
          );

          const skill: Skill = {
            name: frontmatter.name,
            description: frontmatter.description,
            content,
            skillPath: skillFile,
            skillDir,
            license: frontmatter.license,
            allowedTools: frontmatter["allowed-tools"],
            autoLoad,
            metadata: frontmatter.metadata,
          };

          this.skills.set(skill.name, skill);
        })
      );
      this.loaded = true;
    })();

    return this.loading;
  }

  async getSkillsMetadataPrompt(): Promise<string> {
    await this.discoverSkills();
    if (this.skills.size === 0) return "";

    const lines: string[] = [];
    lines.push("## Available Skills");
    lines.push(
      "You have access to specialized skills. Each skill provides expert guidance for specific tasks."
    );
    lines.push("Load a skill's full content using the get_skill tool when needed.");
    lines.push("");

    for (const skill of this.skills.values()) {
      lines.push(`- \`${skill.name}\`: ${skill.description}`);
    }

    return lines.join("\n");
  }

  async listSkills(): Promise<string[]> {
    await this.discoverSkills();
    return Array.from(this.skills.keys());
  }

  async listAutoLoadSkills(): Promise<Skill[]> {
    await this.discoverSkills();
    return Array.from(this.skills.values()).filter((skill) => skill.autoLoad);
  }

  async getSkill(name: string): Promise<Skill | null> {
    await this.discoverSkills();
    return this.skills.get(name) ?? null;
  }
}

export function formatSkillPrompt(skill: Skill): string {
  const rootInfo = [
    "## Skill Root Directory",
    `This skill is located at: \`${skill.skillDir}\``,
    "",
    "All relative paths in this skill should be resolved from this directory.",
    "You can use tools like ls/find to locate files if needed.",
    "",
    "---",
    "",
  ].join("\n");

  return [
    `# Skill: ${skill.name}`,
    "",
    skill.description,
    "",
    "---",
    "",
    rootInfo,
    skill.content,
  ].join("\n");
}

let cachedLoader: SkillLoader | null = null;
let cachedPromise: Promise<SkillLoader> | null = null;

export async function getSkillLoader(): Promise<SkillLoader> {
  if (cachedLoader) return cachedLoader;
  if (cachedPromise) return cachedPromise;

  const envDir = process.env.AGENT_SKILLS_DIR;
  const candidates = [
    envDir ? path.resolve(envDir) : null,
    path.resolve(process.cwd(), "skills"),
    path.resolve(process.cwd(), "backend", "skills"),
  ].filter((value): value is string => Boolean(value));
  const skillsDir = candidates.find((dir) => existsSync(dir)) ?? candidates[0];

  cachedPromise = (async () => {
    const loader = new SkillLoader(skillsDir);
    await loader.discoverSkills();
    cachedLoader = loader;
    return loader;
  })();

  return cachedPromise;
}
