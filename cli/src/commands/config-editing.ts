import { stringify } from "yaml";

import {
  AGENT_NAMES,
  MEMORY_SCOPES,
  MODEL_ALIASES,
  OLLAMA_HOST_INTEGRATION_STRATEGIES,
  OLLAMA_SCOPES,
  type AgentName,
  type LineupConfigFile,
  type ModelAlias
} from "../lib/config.js";
import { CliError } from "../lib/errors.js";

export type ConfigSectionId = "models" | "agents" | "ollama" | "review";
export type ConfigPaneId = "nav" | "fields" | "preview";
export type ConfigFieldKind = "toggle" | "select" | "text";
export type EditableConfigValue = string | boolean | undefined;

export type ConfigFieldOption = {
  label: string;
  value: EditableConfigValue;
  description?: string;
};

export type ConfigFieldDefinition = {
  id: string;
  path: string;
  section: Exclude<ConfigSectionId, "review">;
  kind: ConfigFieldKind;
  label: string;
  description: string;
  placeholder?: string;
  options?: ConfigFieldOption[];
};

export type ConfigSectionDefinition = {
  id: ConfigSectionId;
  label: string;
  description: string;
};

const MODEL_ALIAS_SET = new Set<ModelAlias>(MODEL_ALIASES);
const AGENT_NAME_SET = new Set<string>(AGENT_NAMES);
const MEMORY_SCOPE_SET = new Set<string>(MEMORY_SCOPES);
const OLLAMA_SCOPE_SET = new Set<string>(OLLAMA_SCOPES);
const OLLAMA_STRATEGY_SET = new Set<string>(OLLAMA_HOST_INTEGRATION_STRATEGIES);

export const CONFIG_SECTION_DEFINITIONS: readonly ConfigSectionDefinition[] = [
  {
    id: "models",
    label: "Models",
    description: "Route model aliases to concrete targets."
  },
  {
    id: "agents",
    label: "Agents",
    description: "Adjust per-agent model alias, tools, and memory."
  },
  {
    id: "ollama",
    label: "Ollama",
    description: "Configure local Ollama usage and host integration."
  },
  {
    id: "review",
    label: "Review",
    description: "Inspect the draft config, effective runtime view, and warnings."
  }
] as const;

function selectOptions(values: readonly string[]): ConfigFieldOption[] {
  return [
    {
      label: "Inherited",
      value: undefined,
      description: "Remove this key from `.lineup/config.yaml`."
    },
    ...values.map((value) => ({
      label: value,
      value
    }))
  ];
}

export const CONFIG_FIELD_DEFINITIONS: readonly ConfigFieldDefinition[] = [
  ...MODEL_ALIASES.map((alias) => ({
    id: `models.${alias}`,
    path: `models.${alias}`,
    section: "models" as const,
    kind: "text" as const,
    label: `${alias} target`,
    description: `Resolved runtime target for the \`${alias}\` alias.`,
    placeholder: "gpt-5-mini"
  })),
  ...AGENT_NAMES.flatMap((agent) => {
    const label = agent[0].toUpperCase() + agent.slice(1);
    return [
      {
        id: `agents.${agent}.model`,
        path: `agents.${agent}.model`,
        section: "agents" as const,
        kind: "select" as const,
        label: `${label} model`,
        description: `Model alias used by the ${agent} agent.`,
        options: selectOptions(MODEL_ALIASES)
      },
      {
        id: `agents.${agent}.memory`,
        path: `agents.${agent}.memory`,
        section: "agents" as const,
        kind: "select" as const,
        label: `${label} memory`,
        description: `Memory scope used by the ${agent} agent.`,
        options: selectOptions(MEMORY_SCOPES)
      },
      {
        id: `agents.${agent}.tools`,
        path: `agents.${agent}.tools`,
        section: "agents" as const,
        kind: "text" as const,
        label: `${label} tools`,
        description: `Tool allowlist string for the ${agent} agent.`,
        placeholder: "Read, Grep, Glob, LS, Edit"
      }
    ];
  }),
  {
    id: "ollama.enabled",
    path: "ollama.enabled",
    section: "ollama",
    kind: "toggle",
    label: "Enabled",
    description: "Enable the Ollama integration layer for Lineup."
  },
  {
    id: "ollama.model",
    path: "ollama.model",
    section: "ollama",
    kind: "text",
    label: "Model",
    description: "Model name for the local Ollama backend.",
    placeholder: "qwen3-coder:30b"
  },
  {
    id: "ollama.scope",
    path: "ollama.scope",
    section: "ollama",
    kind: "select",
    label: "Scope",
    description: "Whether Ollama is used for research only or the full pipeline.",
    options: selectOptions(OLLAMA_SCOPES)
  },
  {
    id: "ollama.baseUrl",
    path: "ollama.baseUrl",
    section: "ollama",
    kind: "text",
    label: "Base URL",
    description: "Base URL for the Ollama OpenAI-compatible API.",
    placeholder: "http://127.0.0.1:11434/v1"
  },
  {
    id: "ollama.host_integration.enabled",
    path: "ollama.host_integration.enabled",
    section: "ollama",
    kind: "toggle",
    label: "Host integration enabled",
    description: "Allow Claude, Codex, or OpenCode to route through Ollama."
  },
  {
    id: "ollama.host_integration.strategy",
    path: "ollama.host_integration.strategy",
    section: "ollama",
    kind: "select",
    label: "Host integration strategy",
    description: "Host-specific launch strategy for Ollama-backed execution.",
    options: selectOptions(OLLAMA_HOST_INTEGRATION_STRATEGIES)
  }
] as const;

const CONFIG_FIELD_MAP = new Map(CONFIG_FIELD_DEFINITIONS.map((field) => [field.id, field]));

export function getConfigFieldsForSection(section: ConfigSectionId): ConfigFieldDefinition[] {
  if (section === "review") {
    return [];
  }

  return CONFIG_FIELD_DEFINITIONS.filter((field) => field.section === section);
}

export function getConfigFieldDefinition(fieldId: string): ConfigFieldDefinition {
  const field = CONFIG_FIELD_MAP.get(fieldId);
  if (!field) {
    throw new CliError(`Unsupported config field '${fieldId}'.`, {
      code: "invalid_args"
    });
  }

  return field;
}

function validateConfigPath(configPath: string): void {
  const parts = configPath.split(".");
  if (parts.length < 2) {
    throw new CliError(`Unsupported config key '${configPath}'.`, {
      code: "invalid_args"
    });
  }

  if (parts[0] === "models") {
    if (parts.length === 2 && MODEL_ALIAS_SET.has(parts[1] as ModelAlias)) {
      return;
    }

    throw new CliError(`Unsupported model key '${configPath}'. Use models.haiku|sonnet|opus.`, {
      code: "invalid_args"
    });
  }

  if (parts[0] === "agents") {
    if (parts.length === 3 && AGENT_NAME_SET.has(parts[1]) && ["model", "tools", "memory"].includes(parts[2])) {
      return;
    }

    throw new CliError(`Unsupported agent key '${configPath}'. Use agents.<agent>.model|tools|memory.`, {
      code: "invalid_args"
    });
  }

  const supportedOllamaPaths = new Set([
    "ollama.enabled",
    "ollama.model",
    "ollama.scope",
    "ollama.baseUrl",
    "ollama.host_integration.enabled",
    "ollama.host_integration.strategy"
  ]);
  if (supportedOllamaPaths.has(configPath)) {
    return;
  }

  throw new CliError(`Unsupported config key '${configPath}'.`, {
    code: "invalid_args"
  });
}

function parseBoolean(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  throw new CliError(`Invalid boolean '${raw}'. Use true|false.`, {
    code: "invalid_args"
  });
}

function normalizeConfigValue(configPath: string, rawValue: string): string | boolean {
  validateConfigPath(configPath);

  if (configPath === "ollama.enabled" || configPath === "ollama.host_integration.enabled") {
    return parseBoolean(rawValue);
  }

  if (configPath.endsWith(".model") && configPath.startsWith("agents.")) {
    const value = rawValue.trim();
    if (!MODEL_ALIAS_SET.has(value as ModelAlias)) {
      throw new CliError(`Invalid model alias '${rawValue}'. Use haiku|sonnet|opus.`, {
        code: "invalid_args"
      });
    }

    return value;
  }

  if (configPath.endsWith(".memory")) {
    const value = rawValue.trim();
    if (!MEMORY_SCOPE_SET.has(value)) {
      throw new CliError(`Invalid memory scope '${rawValue}'. Use user|project|local.`, {
        code: "invalid_args"
      });
    }

    return value;
  }

  if (configPath === "ollama.scope") {
    const value = rawValue.trim();
    if (!OLLAMA_SCOPE_SET.has(value)) {
      throw new CliError(`Invalid Ollama scope '${rawValue}'. Use research|full.`, {
        code: "invalid_args"
      });
    }

    return value;
  }

  if (configPath === "ollama.host_integration.strategy") {
    const value = rawValue.trim();
    if (!OLLAMA_STRATEGY_SET.has(value)) {
      throw new CliError(`Invalid Ollama strategy '${rawValue}'. Use auto|launch|managed.`, {
        code: "invalid_args"
      });
    }

    return value;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new CliError(`Value for '${configPath}' cannot be empty.`, {
      code: "invalid_args"
    });
  }

  return trimmed;
}

function setNestedValue(target: Record<string, unknown>, configPath: string, value: string | boolean): void {
  const parts = configPath.split(".");
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }

    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]] = value;
}

function unsetNestedValue(target: Record<string, unknown>, configPath: string): void {
  const parts = configPath.split(".");
  const stack: Array<{ parent: Record<string, unknown>; key: string }> = [];
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }

    stack.push({ parent: cursor, key });
    cursor = next as Record<string, unknown>;
  }

  delete cursor[parts[parts.length - 1]];
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const { parent, key } = stack[index];
    const value = parent[key];
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0) {
      delete parent[key];
      continue;
    }

    break;
  }
}

export function getDraftValue(config: LineupConfigFile, configPath: string): EditableConfigValue {
  const parts = configPath.split(".");
  let cursor: unknown = config;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[part];
  }

  if (typeof cursor === "string" || typeof cursor === "boolean") {
    return cursor;
  }

  return undefined;
}

export function normalizeExplicitFieldValue(field: ConfigFieldDefinition, rawValue: EditableConfigValue): string | boolean | undefined {
  if (rawValue === undefined) {
    return undefined;
  }

  if (field.kind === "toggle") {
    if (typeof rawValue !== "boolean") {
      throw new CliError(`Invalid value for '${field.path}'. Expected a boolean.`, {
        code: "invalid_args"
      });
    }

    return rawValue;
  }

  if (typeof rawValue !== "string") {
    throw new CliError(`Invalid value for '${field.path}'. Expected text input.`, {
      code: "invalid_args"
    });
  }

  if (field.kind === "select") {
    const selectedOption = field.options?.find((option) => option.value === rawValue);
    if (!selectedOption) {
      throw new CliError(`Invalid option '${rawValue}' for '${field.path}'.`, {
        code: "invalid_args"
      });
    }
  }

  return normalizeConfigValue(field.path, rawValue);
}

export function applyFieldValue(config: LineupConfigFile, field: ConfigFieldDefinition, rawValue: EditableConfigValue): LineupConfigFile {
  const nextConfig = structuredClone(config);
  const normalized = normalizeExplicitFieldValue(field, rawValue);
  if (normalized === undefined) {
    unsetNestedValue(nextConfig as Record<string, unknown>, field.path);
    return nextConfig;
  }

  setNestedValue(nextConfig as Record<string, unknown>, field.path, normalized);
  return nextConfig;
}

export function getFieldValidationError(field: ConfigFieldDefinition, rawValue: EditableConfigValue): string | null {
  try {
    normalizeExplicitFieldValue(field, rawValue);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function getDraftValidationErrors(config: LineupConfigFile): Array<{ fieldId: string; message: string }> {
  const errors: Array<{ fieldId: string; message: string }> = [];
  for (const field of CONFIG_FIELD_DEFINITIONS) {
    const error = getFieldValidationError(field, getDraftValue(config, field.path));
    if (error) {
      errors.push({
        fieldId: field.id,
        message: error
      });
    }
  }

  return errors;
}

export function cycleBooleanValue(value: EditableConfigValue): boolean {
  return value === true ? false : true;
}

export function formatDraftYaml(config: LineupConfigFile): string {
  if (Object.keys(config).length === 0) {
    return "{}";
  }

  return stringify(config).trimEnd();
}

export function humanizeFieldValue(value: EditableConfigValue): string {
  if (value === undefined) {
    return "Inherited";
  }

  return String(value);
}

export function getAgentLabel(agent: AgentName): string {
  return agent[0].toUpperCase() + agent.slice(1);
}
