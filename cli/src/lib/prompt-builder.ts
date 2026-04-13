import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseDocument } from "yaml";

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
}): { prompt: string; parsed: ParsedAgentPrompt } {
  const resolvedPath = resolveAgentPromptPath(input.agentFilePath);
  const parsed = loadAgentPrompt(resolvedPath);
  const contractSection = renderContractSection(parsed.frontmatter);
  const body = contractSection ? `${parsed.body.trimEnd()}\n\n${contractSection}\n` : parsed.body;

  let prompt = input.promptTemplate.replace("{{AGENT_BODY}}", body);
  if (input.extraInstructions?.trim()) {
    prompt = `${prompt.trimEnd()}\n\n---\n${input.extraInstructions.trim()}\n`;
  }

  return {
    prompt,
    parsed
  };
}
