import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { GENERATED_BANNER, HOST_TEMPLATE_SPECS, LINEUP_AGENT_ROLES, type HostName } from "./constants";
import { CliError } from "./errors";
import type { GeneratedFile } from "./types";
import { type HostAdapter, validateHostAdapter } from "./validation";

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

export function loadHostAdapter(sourceRoot: string, host: HostName): HostAdapter {
  const adapterPath = path.join(sourceRoot, ".lineup-core", "hosts", `${host}.json`);
  const payload = readJson(adapterPath);
  return validateHostAdapter(payload, adapterPath);
}

function renderTemplate(rawTemplate: string, vars: Record<string, string>, source: string, host: HostName): string {
  return rawTemplate.replace(/\{\{([A-Z0-9_]+)\}\}/g, (full, token) => {
    if (!(token in vars)) {
      throw new CliError(`Missing template variable '${token}' while rendering ${source} for ${host}.`, {
        code: "missing_template_variable"
      });
    }

    return String(vars[token]);
  });
}

function renderPathTemplate(pathTemplate: string, vars: Record<string, string>): string {
  return pathTemplate.replace(/\{\{([A-Z0-9_]+)\}\}/g, (full, token) => {
    return vars[token] ?? full;
  });
}

function injectBanner(content: string, target: string): string {
  const normalized = content.replace(/\r\n?/gu, "\n");
  const trimmed = normalized.replace(/\s+$/u, "");

  if (path.basename(target) === "SKILL.md" && trimmed.startsWith("---\n")) {
    const closing = trimmed.indexOf("\n---\n", 4);
    if (closing !== -1) {
      const frontmatterEnd = closing + "\n---\n".length;
      const frontmatter = trimmed.slice(0, frontmatterEnd);
      const body = trimmed.slice(frontmatterEnd).replace(/^\n+/u, "");
      return `${frontmatter}\n${GENERATED_BANNER}\n\n${body}\n`;
    }
  }

  return `${GENERATED_BANNER}\n\n${trimmed}\n`;
}

export function generateHostFiles(sourceRoot: string, host: HostName): GeneratedFile[] {
  const adapter = loadHostAdapter(sourceRoot, host);
  const vars = adapter.vars;

  return HOST_TEMPLATE_SPECS.map((spec) => {
    const source = spec.source;
    const template = readText(path.join(sourceRoot, source));
    const rendered = renderTemplate(template, vars, source, host);
    const pathTemplate = spec.targetFor[host];

    return {
      host,
      source,
      target: renderPathTemplate(pathTemplate, vars),
      content: injectBanner(rendered, renderPathTemplate(pathTemplate, vars))
    };
  });
}

export function writeGeneratedFiles(files: GeneratedFile[], outputRoot: string): void {
  for (const file of files) {
    const absolute = path.join(outputRoot, file.target);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.content, "utf8");
  }
}

export interface ParsedAgent {
  role: string;
  name: string;
  color?: string;
  description: string;
  tools: string[];
  model: "haiku" | "sonnet" | "opus" | string;
  memory?: string;
  body: string;
}

function parseAgent(filePath: string): ParsedAgent {
  const content = readFileSync(filePath, "utf8");
  const normalized = content.replace(/\r\n?/gu, "\n");

  if (!normalized.startsWith("---\n")) {
    throw new CliError(`Agent file ${filePath} does not start with YAML frontmatter.`, {
      code: "agent_parse_failed"
    });
  }

  const closing = normalized.indexOf("\n---\n", 4);
  if (closing === -1) {
    throw new CliError(`Agent file ${filePath} has unclosed YAML frontmatter.`, {
      code: "agent_parse_failed"
    });
  }

  const frontmatterText = normalized.slice(4, closing);
  const body = normalized.slice(closing + "\n---\n".length);
  const role = path.basename(filePath, ".md");

  const parsed: Record<string, string> = {};
  for (const line of frontmatterText.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    parsed[key] = value;
  }

  const { name, description, tools: toolsRaw, model, color, memory } = parsed;

  if (!name || !description || !toolsRaw || !model) {
    throw new CliError(`Agent file ${filePath} is missing required frontmatter fields (name, description, tools, model).`, {
      code: "agent_parse_failed"
    });
  }

  const tools = toolsRaw.split(",").map((t) => t.trim()).filter(Boolean);

  return {
    role,
    name,
    color,
    description,
    tools,
    model,
    memory,
    body: body.replace(/^\n+/u, "").replace(/\s+$/u, "")
  };
}

function translateAgentToCodex(parsed: ParsedAgent, codexModels: { regular: string; mini: string }): string {
  // haiku → mini; sonnet and opus → regular; unknown aliases pass through raw
  const resolvedModel = parsed.model === "haiku" ? codexModels.mini : parsed.model === "sonnet" || parsed.model === "opus" ? codexModels.regular : parsed.model;
  if (parsed.body.includes('"""')) {
    throw new CliError(
      `Agent ${parsed.role}.md body contains '"""' which cannot be safely embedded in a TOML multiline string. Rewrite the canonical agent file to avoid triple double-quotes.`,
      { code: "agent_translation_failed" }
    );
  }

  return [
    `# AUTO-GENERATED. Edit canonical source in agents/${parsed.role}.md.`,
    `name = "lineup-${parsed.role}"`,
    `description = "${parsed.description.replace(/"/g, '\\"')}"`,
    `model = "${resolvedModel}"`,
    `developer_instructions = """`,
    parsed.body,
    `"""`
  ].join("\n") + "\n";
}

function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const OPENCODE_COLOR_HEX: Record<string, string> = {
  red: "#ef4444",
  yellow: "#eab308",
  green: "#22c55e",
  cyan: "#06b6d4",
  blue: "#3b82f6",
  magenta: "#ec4899",
  purple: "#a855f7",
  orange: "#f97316",
  pink: "#ec4899",
  white: "#ffffff",
  black: "#000000",
  gray: "#6b7280",
  grey: "#6b7280"
};

function toOpencodeColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  return OPENCODE_COLOR_HEX[trimmed.toLowerCase()];
}

function translateAgentToOpencode(parsed: ParsedAgent, models: { regular: string; mini: string } | undefined): string {
  if (!models) {
    throw new CliError("OpenCode model config missing — run `lineup install opencode` first.", {
      code: "opencode_model_config_missing"
    });
  }

  const model = parsed.model === "haiku" ? models.mini : models.regular;

  const knownTools: Record<string, string> = {
    Read: "read",
    Grep: "grep",
    Glob: "glob",
    LS: "list",
    Write: "write",
    Edit: "edit",
    Bash: "bash",
    WebFetch: "webfetch"
  };

  const toolEntries = Object.entries(knownTools)
    .map(([canonical, ocName]) => `  ${ocName}: ${parsed.tools.includes(canonical)}`)
    .join("\n");

  const unknownTools = parsed.tools.filter((t) => !(t in knownTools));
  const dropComment = unknownTools.length > 0
    ? `<!-- Dropped tools (no OpenCode equivalent): ${unknownTools.join(", ")} -->\n\n`
    : "";

  const opencodeColor = toOpencodeColor(parsed.color);
  const colorLine = opencodeColor ? `color: ${yamlQuote(opencodeColor)}\n` : "";

  const frontmatter = [
    "---",
    `description: ${yamlQuote(parsed.description)}`,
    `mode: subagent`,
    `model: ${model}`,
    colorLine.trimEnd(),
    `tools:`,
    toolEntries,
    "---"
  ].filter((line) => line !== "").join("\n");

  return `${frontmatter}\n<!-- AUTO-GENERATED. Edit canonical source in agents/${parsed.role}.md. -->\n\n${dropComment}${parsed.body}\n`;
}

export interface HostModelsConfig {
  claude?: { opus: string; sonnet: string; haiku: string };
  codex?: { regular: string; mini: string };
  opencode?: { regular: string; mini: string };
}

export function generateHostAgents(
  sourceRoot: string,
  host: HostName,
  models?: HostModelsConfig
): GeneratedFile[] {
  if (host === "claude") {
    return [];
  }

  const files: GeneratedFile[] = [];

  for (const role of LINEUP_AGENT_ROLES) {
    const agentPath = path.join(sourceRoot, "agents", `${role}.md`);
    const parsed = parseAgent(agentPath);

    if (host === "codex") {
      if (!models?.codex) {
        throw new CliError("Codex model config missing — run 'lineup install codex' first.", {
          code: "codex_model_config_missing"
        });
      }
      const content = translateAgentToCodex(parsed, models.codex);
      files.push({
        host,
        source: `agents/${role}.md`,
        target: `.codex/agents/lineup-${role}.toml`,
        content
      });
    } else if (host === "opencode") {
      if (!models?.opencode) {
        throw new CliError("OpenCode model config missing — run 'lineup install opencode' first.", {
          code: "opencode_model_config_missing"
        });
      }
      const content = translateAgentToOpencode(parsed, models.opencode);
      files.push({
        host,
        source: `agents/${role}.md`,
        target: `.opencode/agents/lineup-${role}.md`,
        content
      });
    }
  }

  return files;
}

export function prepareClaudePluginSkeleton(sourceRoot: string, outputRoot: string): void {
  const copyPaths = [".claude-plugin", "agents", "tactics", "templates"];

  for (const entry of copyPaths) {
    const from = path.join(sourceRoot, entry);
    const to = path.join(outputRoot, entry);
    cpSync(from, to, { recursive: true });
  }
}
