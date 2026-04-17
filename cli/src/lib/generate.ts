import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { GENERATED_BANNER, HOST_TEMPLATE_SPECS, type HostName } from "./constants";
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

export function prepareClaudePluginSkeleton(sourceRoot: string, outputRoot: string): void {
  const copyPaths = [".claude-plugin", "agents", "tactics", "templates"];

  for (const entry of copyPaths) {
    const from = path.join(sourceRoot, entry);
    const to = path.join(outputRoot, entry);
    cpSync(from, to, { recursive: true });
  }
}
