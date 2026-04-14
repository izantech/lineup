import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CliError } from "./errors.js";

export const LINEUP_OPENCODE_OLLAMA_PROVIDER = "lineup-ollama";
const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json";
const LINEUP_PROVIDER_NPM = "@ai-sdk/openai-compatible";
const LINEUP_PROVIDER_DISPLAY_NAME = "Ollama";

export type LineupOpencodeOllamaConfig = {
  providerName: string;
  model: string;
  baseUrl: string;
};

export type UpsertLineupOpencodeConfigResult = {
  content: string;
  changed: boolean;
};

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeBaseUrl(raw: string): string {
  let normalized = raw.trim().replace(/\/$/, "");
  if (!normalized.endsWith("/v1")) {
    normalized = `${normalized}/v1`;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(content: string, source: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      throw new CliError(`${source}: JSON must be an object.`, {
        code: "opencode_config_invalid"
      });
    }
    return parsed;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    throw new CliError(`${source}: JSON parse failed: ${error instanceof Error ? error.message : String(error)}`, {
      code: "opencode_config_invalid"
    });
  }
}

function ensureObject(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new CliError(`${label} must be a JSON object.`, {
      code: "opencode_config_invalid"
    });
  }

  return { ...value };
}

export function mergeLineupOpencodeConfig(content: string, config: LineupOpencodeOllamaConfig): UpsertLineupOpencodeConfigResult {
  const normalizedInput = normalizeLineEndings(content).trim();
  const parsed = normalizedInput.length > 0 ? parseJsonObject(normalizedInput, "opencode.json") : {};
  const next: Record<string, unknown> = { ...parsed };

  if (normalizedInput.length === 0 && next.$schema === undefined) {
    next.$schema = OPENCODE_CONFIG_SCHEMA;
  }

  const provider = ensureObject(next.provider, "opencode.json provider");
  const lineupProvider = ensureObject(provider[config.providerName], `opencode.json provider.${config.providerName}`);
  const existingModels = ensureObject(lineupProvider.models, `opencode.json provider.${config.providerName}.models`);
  const existingModel = ensureObject(existingModels[config.model], `opencode.json provider.${config.providerName}.models.${config.model}`);

  existingModels[config.model] = {
    ...existingModel,
    name: config.model
  };

  lineupProvider.npm = LINEUP_PROVIDER_NPM;
  lineupProvider.name = LINEUP_PROVIDER_DISPLAY_NAME;
  lineupProvider.options = {
    ...ensureObject(lineupProvider.options, `opencode.json provider.${config.providerName}.options`),
    baseURL: normalizeBaseUrl(config.baseUrl)
  };
  lineupProvider.models = existingModels;
  provider[config.providerName] = lineupProvider;
  next.provider = provider;

  const rendered = `${JSON.stringify(next, null, 2)}\n`;
  return {
    content: rendered,
    changed: rendered !== `${normalizedInput}\n`
  };
}

export function buildLineupOpencodeConfig(config: LineupOpencodeOllamaConfig): string {
  return mergeLineupOpencodeConfig("", config).content;
}

export function opencodeConfigPath(homeDir: string): string {
  return path.join(homeDir, ".config", "opencode", "opencode.json");
}

export function upsertLineupOpencodeConfig(filePath: string, config: LineupOpencodeOllamaConfig): UpsertLineupOpencodeConfigResult {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const result = mergeLineupOpencodeConfig(existing, config);
  if (result.changed || !existsSync(filePath)) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, result.content, "utf8");
  }
  return result;
}
