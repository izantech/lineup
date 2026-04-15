import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseDocument } from "yaml";

import { AGENT_NAMES, readOllamaConfig, requireOllamaModel, shouldAppendOllamaAppendix, type AgentName, type ResolveConfigOptions } from "./config.js";
import { CliError } from "./errors.js";
import { packageRoot } from "./paths.js";

export type AgentContractInput = {
  name: string;
  schema: string;
  required?: boolean;
};

export type AgentContractOutput = {
  schema?: string;
};

export type AgentPromptFrontmatter = {
  name?: string;
  color?: string;
  description?: string;
  tools?: string;
  model?: string;
  memory?: string;
  inputs?: AgentContractInput[];
  outputs?: AgentContractOutput;
  timeout?: string;
  retry?: {
    max?: number;
    on?: string[];
  };
  ollama?: Record<string, unknown>;
};

export type ParsedAgentPrompt = {
  source: string;
  frontmatter: AgentPromptFrontmatter;
  body: string;
  raw: string;
};

function parseFrontmatter(rawFrontmatter: string, source: string): AgentPromptFrontmatter {
  const doc = parseDocument(rawFrontmatter, {
    uniqueKeys: true,
    merge: false
  });

  if (doc.errors.length > 0) {
    const message = doc.errors.map((entry) => entry.message).join("\n");
    throw new CliError(`${source}: agent frontmatter YAML parse failed:\n${message}`, {
      code: "yaml_parse_failed"
    });
  }

  const parsed = doc.toJSON();
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(`${source}: agent frontmatter must be a YAML object.`, {
      code: "yaml_parse_failed"
    });
  }

  return parsed as AgentPromptFrontmatter;
}

export function parseAgentPrompt(raw: string, source: string): ParsedAgentPrompt {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      source,
      frontmatter: {},
      body: raw.trimStart(),
      raw
    };
  }

  return {
    source,
    frontmatter: parseFrontmatter(match[1], source),
    body: raw.slice(match[0].length).trimStart(),
    raw
  };
}

export function loadAgentPrompt(filePath: string): ParsedAgentPrompt {
  return parseAgentPrompt(readFileSync(filePath, "utf8"), filePath);
}

function resolveAgentPromptPath(filePath: string): string {
  if (existsSync(filePath)) {
    return filePath;
  }

  const bundledPath = path.join(packageRoot(), "agents", path.basename(filePath));
  if (existsSync(bundledPath)) {
    return bundledPath;
  }

  throw new CliError(`Agent prompt not found: ${filePath}`, {
    code: "invalid_path"
  });
}

function parseAgentName(filePath: string): AgentName | null {
  const candidate = path.basename(filePath, path.extname(filePath));
  return (AGENT_NAMES as readonly string[]).includes(candidate) ? (candidate as AgentName) : null;
}

function resolveOllamaAppendixPath(agentName: AgentName, resolvedPromptPath: string): string | null {
  const localCandidate = path.join(path.dirname(resolvedPromptPath), `${agentName}-ollama.md`);
  if (existsSync(localCandidate)) {
    return localCandidate;
  }

  const bundledCandidate = path.join(packageRoot(), "agents", `${agentName}-ollama.md`);
  if (existsSync(bundledCandidate)) {
    return bundledCandidate;
  }

  return null;
}

function resolveOllamaCompactPromptPath(agentName: AgentName, resolvedPromptPath: string): string | null {
  const localCandidate = path.join(path.dirname(resolvedPromptPath), `${agentName}-ollama-compact.md`);
  if (existsSync(localCandidate)) {
    return localCandidate;
  }

  const bundledCandidate = path.join(packageRoot(), "agents", `${agentName}-ollama-compact.md`);
  if (existsSync(bundledCandidate)) {
    return bundledCandidate;
  }

  return null;
}

function buildOllamaSections(agentName: AgentName | null, resolvedPromptPath: string, options?: ResolveConfigOptions): string[] {
  if (!options) {
    return [];
  }

  const ollama = readOllamaConfig(options);
  if (!ollama) {
    return [];
  }
  requireOllamaModel(options);

  const sections: string[] = [];
  if (ollama.scope === "full") {
    sections.push(
      [
        "## Ollama Full-Pipeline Mode",
        `- configured model: ${ollama.model}`,
        `- configured base URL: ${ollama.baseUrl}`,
        "- This run is configured to route all Lineup agent stages through the selected host using the Ollama-backed model target.",
        "- Keep outputs compact, deterministic, and strictly structured. Prefer one more targeted inspection over guessing."
      ].join("\n")
    );
  }

  if (agentName && shouldAppendOllamaAppendix(agentName, options)) {
    const appendixPath = resolveOllamaAppendixPath(agentName, resolvedPromptPath);
    if (appendixPath) {
      sections.push(readFileSync(appendixPath, "utf8").trim());
    }
  }

  return sections;
}

function resolveAgentBody(
  parsed: ParsedAgentPrompt,
  agentName: AgentName | null,
  resolvedPromptPath: string,
  options?: ResolveConfigOptions
): { body: string; usedCompactPrompt: boolean } {
  if (!agentName || !options) {
    return { body: parsed.body.trimEnd(), usedCompactPrompt: false };
  }

  const ollama = readOllamaConfig(options);
  if (!ollama?.hostIntegration?.enabled) {
    return { body: parsed.body.trimEnd(), usedCompactPrompt: false };
  }
  requireOllamaModel(options);

  const compactPromptPath = resolveOllamaCompactPromptPath(agentName, resolvedPromptPath);
  if (!compactPromptPath) {
    return { body: parsed.body.trimEnd(), usedCompactPrompt: false };
  }

  return {
    body: readFileSync(compactPromptPath, "utf8").trim(),
    usedCompactPrompt: true
  };
}

function renderContractSection(frontmatter: AgentPromptFrontmatter): string {
  const lines: string[] = [];

  if (frontmatter.inputs && frontmatter.inputs.length > 0) {
    lines.push("## Input Contract");
    for (const input of frontmatter.inputs) {
      lines.push(`- ${input.name}: ${input.schema}${input.required ? " (required)" : ""}`);
    }
  }

  if (frontmatter.outputs?.schema) {
    lines.push("## Output Contract");
    lines.push(`- schema: ${frontmatter.outputs.schema}`);
  }

  if (frontmatter.timeout || frontmatter.retry) {
    lines.push("## Runtime Contract");
    if (frontmatter.timeout) {
      lines.push(`- timeout: ${frontmatter.timeout}`);
    }
    if (frontmatter.retry) {
      const retryParts = [`max=${frontmatter.retry.max ?? 0}`];
      if (frontmatter.retry.on && frontmatter.retry.on.length > 0) {
        retryParts.push(`on=${frontmatter.retry.on.join(", ")}`);
      }
      lines.push(`- retry: ${retryParts.join("; ")}`);
    }
  }

  return lines.join("\n");
}

export function buildAgentSystemPrompt(input: {
  agentFilePath: string;
  promptTemplate: string;
  extraInstructions?: string;
  configOptions?: ResolveConfigOptions;
}): { prompt: string; parsed: ParsedAgentPrompt } {
  const resolvedPath = resolveAgentPromptPath(input.agentFilePath);
  const parsed = loadAgentPrompt(resolvedPath);
  const contractSection = renderContractSection(parsed.frontmatter);
  const agentName = parseAgentName(resolvedPath);
  const resolvedBody = resolveAgentBody(parsed, agentName, resolvedPath, input.configOptions);
  const ollamaSections = resolvedBody.usedCompactPrompt
    ? []
    : buildOllamaSections(agentName, resolvedPath, input.configOptions);
  const bodySections = [resolvedBody.body];
  if (contractSection) {
    bodySections.push(contractSection);
  }
  bodySections.push(...ollamaSections.filter((section) => section.trim().length > 0));
  const body = `${bodySections.filter((section) => section.trim().length > 0).join("\n\n")}\n`;

  let prompt = input.promptTemplate.replace("{{AGENT_BODY}}", body);
  if (input.extraInstructions?.trim()) {
    prompt = `${prompt.trimEnd()}\n\n---\n${input.extraInstructions.trim()}\n`;
  }

  return {
    prompt,
    parsed
  };
}
