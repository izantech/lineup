import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseDocument } from "yaml";

import { CliError } from "./errors.js";
import { projectRoot } from "./paths.js";

export const MODEL_ALIASES = ["haiku", "sonnet", "opus"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const MEMORY_SCOPES = ["user", "project", "local"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const AGENT_NAMES = ["researcher", "architect", "developer", "reviewer", "documenter", "teacher"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export type AgentConfig = {
  model: ModelAlias;
  tools: string;
  memory: MemoryScope;
};

export type ResolvedAgentConfig = AgentConfig & {
  modelTarget: string;
  source: {
    model: "default" | "user" | "project" | "env" | "cli";
    tools: "default" | "user" | "project" | "env" | "cli";
    memory: "default" | "user" | "project" | "env" | "cli";
  };
  warnings: string[];
};

export type OllamaConfig = {
  enabled: boolean;
  model: string;
  scope: "research";
  baseUrl: string;
};

export type LineupConfigFile = {
  models?: Partial<Record<ModelAlias, string>>;
  agents?: Partial<Record<AgentName, Partial<AgentConfig>>>;
  ollama?: Partial<Pick<OllamaConfig, "enabled" | "model" | "scope" | "baseUrl">>;
};

export type ResolveConfigOptions = {
  projectRoot?: string;
  homeDir?: string;
  host?: "claude" | "codex" | "opencode";
  env?: NodeJS.ProcessEnv;
  cli?: {
    models?: Partial<Record<ModelAlias, string>>;
    agents?: Partial<Record<AgentName, Partial<AgentConfig>>>;
    ollama?: Partial<Pick<OllamaConfig, "enabled" | "model" | "scope" | "baseUrl">>;
  };
};

export type ResolvedLineupConfig = {
  modelRouting: Record<ModelAlias, string>;
  agents: Partial<Record<AgentName, Partial<AgentConfig>>>;
  ollama: OllamaConfig | null;
  warnings: string[];
};

const DEFAULT_MODEL_ROUTING: Record<ModelAlias, string> = {
  haiku: "haiku",
  sonnet: "sonnet",
  opus: "opus"
};

const DEFAULT_AGENT_CONFIGS: Record<AgentName, AgentConfig> = {
  researcher: { model: "haiku", memory: "project", tools: "Read, Grep, Glob, LS, WebFetch, WebSearch" },
  architect: { model: "opus", memory: "project", tools: "Read, Grep, Glob, LS, Write" },
  developer: { model: "opus", memory: "project", tools: "Read, Grep, Glob, LS, Edit, Write, Bash, NotebookEdit" },
  reviewer: { model: "opus", memory: "project", tools: "Read, Grep, Glob, LS, Bash" },
  documenter: { model: "opus", memory: "project", tools: "Read, Grep, Glob, LS, Write, WebFetch" },
  teacher: { model: "opus", memory: "project", tools: "Read, Grep, Glob, LS, WebFetch, WebSearch" }
};

const DEFAULT_OLLAMA: OllamaConfig = {
  enabled: false,
  model: "llama3.1:8b",
  scope: "research",
  baseUrl: "http://127.0.0.1:11434/v1"
};

function isModelAlias(value: unknown): value is ModelAlias {
  return typeof value === "string" && (MODEL_ALIASES as readonly string[]).includes(value);
}

function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === "string" && (MEMORY_SCOPES as readonly string[]).includes(value);
}

function parseYamlObject(raw: string, source: string): Record<string, unknown> | null {
  const doc = parseDocument(raw, {
    uniqueKeys: true,
    merge: false
  });

  if (doc.errors.length > 0) {
    throw new CliError(`${source}: YAML parse failed:\n${doc.errors.map((entry) => entry.message).join("\n")}`, {
      code: "yaml_parse_failed"
    });
  }

  const value = doc.toJSON();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function firstExisting(paths: string[]): string | null {
  for (const candidate of paths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function hostOverrideDir(host: ResolveConfigOptions["host"], homeDir: string): string {
  switch (host ?? "claude") {
    case "claude":
      return path.join(homeDir, ".claude", "lineup", "agents");
    case "codex":
      return path.join(homeDir, ".codex", "lineup", "agents");
    case "opencode":
      return path.join(homeDir, ".config", "opencode", "lineup", "agents");
  }
}

function hostOllamaPath(host: ResolveConfigOptions["host"], homeDir: string): string {
  switch (host ?? "claude") {
    case "claude":
      return path.join(homeDir, ".claude", "lineup", "ollama.yaml");
    case "codex":
      return path.join(homeDir, ".codex", "lineup", "ollama.yaml");
    case "opencode":
      return path.join(homeDir, ".config", "opencode", "lineup", "ollama.yaml");
  }
}

function normalizeBaseUrl(raw: string): string {
  let normalized = raw.trim().replace(/\/$/, "");
  if (!normalized.endsWith("/v1")) {
    normalized = `${normalized}/v1`;
  }
  return normalized;
}

function readProjectConfig(filePath: string): { config: LineupConfigFile; warnings: string[] } {
  if (!existsSync(filePath)) {
    return { config: {}, warnings: [] };
  }

  try {
    const parsed = parseYamlObject(readFileSync(filePath, "utf8"), filePath);
    if (!parsed) {
      return { config: {}, warnings: [] };
    }
    return { config: parsed as LineupConfigFile, warnings: [] };
  } catch (error) {
    return {
      config: {},
      warnings: [`Warning: ${filePath} is malformed. Ignoring project config. ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

function readOllamaLayer(
  filePath: string,
  fromProjectConfig: boolean
): { override: Partial<Pick<OllamaConfig, "enabled" | "model" | "scope" | "baseUrl">>; warnings: string[] } {
  if (!existsSync(filePath)) {
    return { override: {}, warnings: [] };
  }

  try {
    const parsed = parseYamlObject(readFileSync(filePath, "utf8"), filePath);
    if (!parsed) {
      return { override: {}, warnings: [] };
    }

    const raw = fromProjectConfig ? (parsed.ollama as Record<string, unknown> | undefined) ?? {} : parsed;
    const override: Partial<Pick<OllamaConfig, "enabled" | "model" | "scope" | "baseUrl">> = {};

    if (typeof raw.enabled === "boolean") {
      override.enabled = raw.enabled;
    }

    if (typeof raw.model === "string" && raw.model.trim().length > 0) {
      override.model = raw.model.trim();
    }

    if (raw.scope === "research") {
      override.scope = "research";
    }

    if (typeof raw.baseUrl === "string" && raw.baseUrl.trim().length > 0) {
      override.baseUrl = normalizeBaseUrl(raw.baseUrl);
    }

    return { override, warnings: [] };
  } catch {
    return {
      override: {},
      warnings: [`Warning: ${filePath} is malformed. Ignoring Ollama config.`]
    };
  }
}

function readUserAgentOverride(filePath: string, agent: AgentName): { override: Partial<AgentConfig>; warnings: string[] } {
  if (!existsSync(filePath)) {
    return { override: {}, warnings: [] };
  }

  try {
    const parsed = parseYamlObject(readFileSync(filePath, "utf8"), filePath);
    if (!parsed) {
      return { override: {}, warnings: [] };
    }

    const warnings: string[] = [];
    const override: Partial<AgentConfig> = {};

    if (parsed.model !== undefined) {
      if (isModelAlias(parsed.model)) {
        override.model = parsed.model;
      } else {
        warnings.push(`Warning: ${agent} override has model '${String(parsed.model)}' (invalid). Using default '${DEFAULT_AGENT_CONFIGS[agent].model}'.`);
      }
    }

    if (parsed.tools !== undefined) {
      if (typeof parsed.tools === "string" && parsed.tools.trim().length > 0) {
        override.tools = parsed.tools;
      } else {
        warnings.push(`Warning: ${agent} override has invalid tools. Using default '${DEFAULT_AGENT_CONFIGS[agent].tools}'.`);
      }
    }

    if (parsed.memory !== undefined) {
      if (isMemoryScope(parsed.memory)) {
        override.memory = parsed.memory;
      } else {
        warnings.push(`Warning: ${agent} override has memory '${String(parsed.memory)}' (invalid). Using default '${DEFAULT_AGENT_CONFIGS[agent].memory}'.`);
      }
    }

    return { override, warnings };
  } catch {
    return {
      override: {},
      warnings: [`Warning: ${filePath} is malformed. Using defaults for ${agent}.`]
    };
  }
}

function readGlobalEnvConfig(env: NodeJS.ProcessEnv): {
  routing: Partial<Record<ModelAlias, string>>;
  ollama: Partial<Pick<OllamaConfig, "enabled" | "model" | "scope" | "baseUrl">>;
  warnings: string[];
} {
  const routing: Partial<Record<ModelAlias, string>> = {};
  const ollama: Partial<Pick<OllamaConfig, "enabled" | "model" | "scope" | "baseUrl">> = {};
  const warnings: string[] = [];

  for (const alias of MODEL_ALIASES) {
    const envKey = `LINEUP_MODEL_${alias.toUpperCase()}`;
    const value = env[envKey];
    if (value?.trim()) {
      routing[alias] = value.trim();
    }
  }

  const ollamaEnabled = env.LINEUP_OLLAMA_ENABLED;
  if (ollamaEnabled !== undefined) {
    ollama.enabled = /^(1|true|yes|on)$/i.test(ollamaEnabled);
  }

  const ollamaModel = env.LINEUP_OLLAMA_MODEL;
  if (ollamaModel?.trim()) {
    ollama.model = ollamaModel.trim();
  }

  const ollamaScope = env.LINEUP_OLLAMA_SCOPE;
  if (ollamaScope?.trim() === "research") {
    ollama.scope = "research";
  }

  const ollamaBaseUrl = env.LINEUP_OLLAMA_BASE_URL ?? env.OLLAMA_HOST;
  if (ollamaBaseUrl?.trim()) {
    ollama.baseUrl = normalizeBaseUrl(ollamaBaseUrl);
  }

  return { routing, ollama, warnings };
}

function readEnvAgentOverride(agent: AgentName, env: NodeJS.ProcessEnv): { override: Partial<AgentConfig>; warnings: string[] } {
  const prefix = `LINEUP_AGENT_${agent.toUpperCase()}_`;
  const warnings: string[] = [];
  const override: Partial<AgentConfig> = {};

  const modelValue = env[`${prefix}MODEL`] ?? env.LINEUP_MODEL;
  if (modelValue?.trim()) {
    const normalized = modelValue.trim();
    if (isModelAlias(normalized)) {
      override.model = normalized;
    } else {
      warnings.push(`Warning: ${prefix}MODEL value '${modelValue}' is invalid. Using defaults.`);
    }
  }

  const toolsValue = env[`${prefix}TOOLS`] ?? env.LINEUP_TOOLS;
  if (toolsValue?.trim()) {
    override.tools = toolsValue.trim();
  }

  const memoryValue = env[`${prefix}MEMORY`] ?? env.LINEUP_MEMORY;
  if (memoryValue?.trim()) {
    const normalized = memoryValue.trim();
    if (isMemoryScope(normalized)) {
      override.memory = normalized;
    } else {
      warnings.push(`Warning: ${prefix}MEMORY value '${memoryValue}' is invalid. Using defaults.`);
    }
  }

  return { override, warnings };
}

function mergePartialAgentConfig(base: Partial<AgentConfig>, override: Partial<AgentConfig>): Partial<AgentConfig> {
  return {
    model: override.model ?? base.model,
    tools: override.tools ?? base.tools,
    memory: override.memory ?? base.memory
  };
}

function mergeModelRouting(...layers: Array<Partial<Record<ModelAlias, string>> | undefined>): Record<ModelAlias, string> {
  const routing: Record<ModelAlias, string> = { ...DEFAULT_MODEL_ROUTING };
  for (const layer of layers) {
    if (!layer) {
      continue;
    }

    for (const alias of MODEL_ALIASES) {
      const value = layer[alias];
      if (typeof value === "string" && value.trim().length > 0) {
        routing[alias] = value.trim();
      }
    }
  }

  return routing;
}

function projectConfigPath(root = projectRoot()): string {
  return path.join(root, ".lineup", "config.yaml");
}

export function loadAgentDefaults(agent: AgentName, root = projectRoot()): AgentConfig {
  const filePath = path.join(root, "agents", `${agent}.md`);
  if (!existsSync(filePath)) {
    return DEFAULT_AGENT_CONFIGS[agent];
  }

  const raw = readFileSync(filePath, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return DEFAULT_AGENT_CONFIGS[agent];
  }

  const doc = parseDocument(match[1], {
    uniqueKeys: true,
    merge: false
  });

  if (doc.errors.length > 0) {
    return DEFAULT_AGENT_CONFIGS[agent];
  }

  const parsed = doc.toJSON();
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return DEFAULT_AGENT_CONFIGS[agent];
  }

  const frontmatter = parsed as Record<string, unknown>;
  const defaultConfig = DEFAULT_AGENT_CONFIGS[agent];
  const model = isModelAlias(frontmatter.model) ? frontmatter.model : defaultConfig.model;
  const memory = isMemoryScope(frontmatter.memory) ? frontmatter.memory : defaultConfig.memory;
  const tools = typeof frontmatter.tools === "string" && frontmatter.tools.trim().length > 0 ? frontmatter.tools : defaultConfig.tools;

  return { model, memory, tools };
}

export function resolveLineupConfig(options: ResolveConfigOptions = {}): ResolvedLineupConfig {
  const root = options.projectRoot ?? projectRoot();
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const warnings: string[] = [];

  const projectConfigResult = readProjectConfig(projectConfigPath(root));
  warnings.push(...projectConfigResult.warnings);

  const globalEnv = readGlobalEnvConfig(env);
  warnings.push(...globalEnv.warnings);

  const routing = mergeModelRouting(projectConfigResult.config.models, globalEnv.routing, options.cli?.models);

  const agents: Partial<Record<AgentName, Partial<AgentConfig>>> = {};
  for (const agent of AGENT_NAMES) {
    const projectAgent = projectConfigResult.config.agents?.[agent];
    const cliAgent = options.cli?.agents?.[agent];
    const merged = mergePartialAgentConfig({}, projectAgent ?? {});
    const mergedWithCli = mergePartialAgentConfig(merged, cliAgent ?? {});
    if (mergedWithCli.model || mergedWithCli.tools || mergedWithCli.memory) {
      agents[agent] = mergedWithCli;
    }
  }

  const userOllamaLayer = readOllamaLayer(hostOllamaPath(options.host, homeDir), false);
  const projectOllamaLayer = readOllamaLayer(projectConfigPath(root), true);
  warnings.push(...projectOllamaLayer.warnings, ...userOllamaLayer.warnings);

  const ollamaCandidate = {
    ...DEFAULT_OLLAMA,
    ...userOllamaLayer.override,
    ...projectOllamaLayer.override,
    ...globalEnv.ollama,
    ...options.cli?.ollama
  };

  const ollama = ollamaCandidate.enabled
    ? {
        enabled: true,
        model: typeof ollamaCandidate.model === "string" && ollamaCandidate.model.trim().length > 0 ? ollamaCandidate.model.trim() : DEFAULT_OLLAMA.model,
        scope: ollamaCandidate.scope === "research" ? "research" : DEFAULT_OLLAMA.scope,
        baseUrl: typeof ollamaCandidate.baseUrl === "string" && ollamaCandidate.baseUrl.trim().length > 0 ? normalizeBaseUrl(ollamaCandidate.baseUrl) : DEFAULT_OLLAMA.baseUrl
      }
    : null;

  return { modelRouting: routing, agents, ollama, warnings };
}

export function resolveModelAlias(alias: ModelAlias, options: ResolveConfigOptions = {}): string {
  const config = resolveLineupConfig(options);
  return config.modelRouting[alias] ?? alias;
}

export function resolveAgentConfig(agent: AgentName, options: ResolveConfigOptions = {}): ResolvedAgentConfig {
  const root = options.projectRoot ?? projectRoot();
  const homeDir = options.homeDir ?? os.homedir();
  const defaults = loadAgentDefaults(agent, root);
  const resolved = resolveLineupConfig(options);
  const userOverridePath = path.join(hostOverrideDir(options.host, homeDir), `${agent}.yaml`);
  const projectOverridePath = firstExisting([
    path.join(root, ".lineup", "agents", `${agent}.yaml`),
    path.join(root, ".lineup", "agents", `${agent}.yml`)
  ]);

  const userOverride = readUserAgentOverride(userOverridePath, agent);
  const projectOverride = projectOverridePath ? readUserAgentOverride(projectOverridePath, agent) : { override: {}, warnings: [] as string[] };
  const cliOverride = options.cli?.agents?.[agent] ?? {};
  const envOverride = readEnvAgentOverride(agent, options.env ?? process.env).override;

  const merged = {
    ...defaults,
    ...userOverride.override,
    ...projectOverride.override,
    ...envOverride,
    ...cliOverride
  };

  const model = merged.model ?? defaults.model;
  const modelTarget = resolved.modelRouting[model] ?? model;

  return {
    model,
    modelTarget,
    tools: merged.tools ?? defaults.tools,
    memory: merged.memory ?? defaults.memory,
    source: {
      model: cliOverride.model ? "cli" : envOverride.model ? "env" : projectOverride.override.model ? "project" : userOverride.override.model ? "user" : "default",
      tools: cliOverride.tools ? "cli" : envOverride.tools ? "env" : projectOverride.override.tools ? "project" : userOverride.override.tools ? "user" : "default",
      memory: cliOverride.memory ? "cli" : envOverride.memory ? "env" : projectOverride.override.memory ? "project" : userOverride.override.memory ? "user" : "default"
    },
    warnings: [...resolved.warnings, ...userOverride.warnings, ...projectOverride.warnings]
  };
}

export function readOllamaConfig(options: ResolveConfigOptions = {}): OllamaConfig | null {
  const root = options.projectRoot ?? projectRoot();
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;

  const userLayer = readOllamaLayer(hostOllamaPath(options.host, homeDir), false);
  const projectLayer = readOllamaLayer(projectConfigPath(root), true);
  const globalEnv = readGlobalEnvConfig(env);

  const merged = {
    ...DEFAULT_OLLAMA,
    ...userLayer.override,
    ...projectLayer.override,
    ...globalEnv.ollama,
    ...options.cli?.ollama
  };

  if (!merged.enabled) {
    return null;
  }

  return {
    enabled: true,
    model: typeof merged.model === "string" && merged.model.trim().length > 0 ? merged.model.trim() : DEFAULT_OLLAMA.model,
    scope: merged.scope === "research" ? "research" : DEFAULT_OLLAMA.scope,
    baseUrl: typeof merged.baseUrl === "string" && merged.baseUrl.trim().length > 0 ? normalizeBaseUrl(merged.baseUrl) : DEFAULT_OLLAMA.baseUrl
  };
}
