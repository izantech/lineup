import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const LINEUP_CODEX_OLLAMA_PROVIDER = "lineup-ollama";
export const LINEUP_CODEX_OLLAMA_PROFILE = "lineup-ollama";
export const LINEUP_CODEX_OLLAMA_PROVIDER_NAME = "Ollama";

export type LineupCodexOllamaConfig = {
  providerName: string;
  profileName: string;
  baseUrl: string;
  model: string;
};

export type UpsertLineupCodexConfigResult = {
  content: string;
  changed: boolean;
};

const TOP_LEVEL_SECTION = /^\s*\[([A-Za-z0-9_.-]+)\]\s*$/;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function sectionBody(sectionName: string, config: LineupCodexOllamaConfig): string[] {
  if (sectionName === `model_providers.${config.providerName}`) {
    return [
      `[${sectionName}]`,
      `name = "${LINEUP_CODEX_OLLAMA_PROVIDER_NAME}"`,
      `base_url = "${config.baseUrl}"`
    ];
  }

  if (sectionName === `profiles.${config.profileName}`) {
    return [
      `[${sectionName}]`,
      `model = "${config.model}"`,
      `model_provider = "${config.providerName}"`
    ];
  }

  return [];
}

function splitIntoSections(content: string): Array<{ header: string | null; lines: string[] }> {
  const lines = normalizeLineEndings(content).split("\n");
  const sections: Array<{ header: string | null; lines: string[] }> = [];
  let current: { header: string | null; lines: string[] } = { header: null, lines: [] };

  for (const line of lines) {
    const match = line.match(TOP_LEVEL_SECTION);
    if (match) {
      sections.push(current);
      current = { header: match[1], lines: [line] };
      continue;
    }

    current.lines.push(line);
  }

  sections.push(current);
  return sections;
}

function renderSections(sections: Array<{ header: string | null; lines: string[] }>): string {
  return sections
    .map((section) => section.lines.join("\n"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "");
}

export function mergeLineupCodexConfig(content: string, config: LineupCodexOllamaConfig): UpsertLineupCodexConfigResult {
  const normalized = normalizeLineEndings(content).trim().length > 0 ? normalizeLineEndings(content).trimEnd() : "";
  const desiredSections = new Map<string, string[]>([
    [`model_providers.${config.providerName}`, sectionBody(`model_providers.${config.providerName}`, config)],
    [`profiles.${config.profileName}`, sectionBody(`profiles.${config.profileName}`, config)]
  ]);

  const sections = splitIntoSections(normalized);
  const output: Array<{ header: string | null; lines: string[] }> = [];
  const seen = new Set<string>();
  let changed = false;

  for (const section of sections) {
    if (!section.header) {
      if (section.lines.length > 0 && section.lines.some((line) => line.trim().length > 0)) {
        output.push(section);
      }
      continue;
    }

    const replacement = desiredSections.get(section.header);
    if (replacement) {
      output.push({ header: section.header, lines: replacement });
      seen.add(section.header);
      if (section.lines.join("\n").trimEnd() !== replacement.join("\n").trimEnd()) {
        changed = true;
      }
      continue;
    }

    output.push(section);
  }

  for (const [sectionName, lines] of desiredSections) {
    if (seen.has(sectionName)) {
      continue;
    }

    if (output.length > 0 && output[output.length - 1].lines.some((line) => line.trim().length > 0)) {
      output.push({ header: null, lines: [""] });
    }

    output.push({ header: sectionName, lines });
    changed = true;
  }

  const rendered = renderSections(output);
  return {
    content: rendered.length > 0 ? `${rendered}\n` : rendered,
    changed: changed || rendered !== normalized
  };
}

export function buildLineupCodexConfig(config: LineupCodexOllamaConfig): string {
  return mergeLineupCodexConfig("", config).content;
}

export function codexConfigPath(homeDir: string): string {
  return path.join(homeDir, ".codex", "config.toml");
}

export function upsertLineupCodexConfig(filePath: string, config: LineupCodexOllamaConfig): UpsertLineupCodexConfigResult {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const result = mergeLineupCodexConfig(existing, config);
  if (result.changed || !existsSync(filePath)) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, result.content, "utf8");
  }
  return result;
}
