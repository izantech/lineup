import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAgentSystemPrompt, loadAgentPrompt, parseAgentPrompt } from "../src/lib/prompt-builder.js";

function writeProjectConfig(root: string, content: string): void {
  const dir = join(root, ".lineup");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.yaml"), content, "utf8");
}

describe("prompt builder", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-prompt-builder-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses frontmatter and body from an agent file", () => {
    const raw = `---
name: architect
model: opus
inputs:
  - name: spec
    schema: Spec
    required: true
outputs:
  schema: Plan
timeout: 5m
retry:
  max: 1
  on: [timeout]
---

You are the architect body.
`;

    const parsed = parseAgentPrompt(raw, "fixture/architect.md");
    expect(parsed.frontmatter.name).toBe("architect");
    expect(parsed.frontmatter.outputs?.schema).toBe("Plan");
    expect(parsed.body).toContain("You are the architect body.");
  });

  it("builds a system prompt with contract sections", () => {
    const agentDir = join(tempDir, "agents");
    mkdirSync(agentDir, { recursive: true });
    const agentFilePath = join(agentDir, "architect.md");
    writeFileSync(
      agentFilePath,
      `---
name: architect
model: opus
inputs:
  - name: spec
    schema: Spec
    required: true
outputs:
  schema: Plan
timeout: 5m
retry:
  max: 1
  on: [timeout, rate_limit]
---

You are the architect body.
`,
      "utf8"
    );

    const built = buildAgentSystemPrompt({
      agentFilePath,
      promptTemplate: "You are an agent.\n\n{{AGENT_BODY}}\n\n## Contract",
      extraInstructions: "Only emit Plan YAML."
    });

    expect(built.prompt).toContain("## Input Contract");
    expect(built.prompt).toContain("- spec: Spec (required)");
    expect(built.prompt).toContain("## Output Contract");
    expect(built.prompt).toContain("- schema: Plan");
    expect(built.prompt).toContain("## Runtime Contract");
    expect(built.prompt).toContain("Only emit Plan YAML.");
  });

  it("loads agent prompt files from disk", () => {
    const agentFilePath = join(tempDir, "developer.md");
    writeFileSync(agentFilePath, "---\nname: developer\n---\n\nImplement the plan.\n", "utf8");

    const parsed = loadAgentPrompt(agentFilePath);
    expect(parsed.frontmatter.name).toBe("developer");
    expect(parsed.body).toContain("Implement the plan.");
  });

  it("falls back to bundled agent prompts when the project file is missing", () => {
    const built = buildAgentSystemPrompt({
      agentFilePath: join(tempDir, "agents", "developer.md"),
      promptTemplate: "{{AGENT_BODY}}"
    });

    expect(built.parsed.frontmatter.name).toBe("developer");
    expect(built.prompt).toContain("You are a developer agent.");
  });

  it("appends the Ollama appendix for supported agents when enabled", () => {
    writeProjectConfig(
      tempDir,
      `ollama:\n  enabled: true\n  model: local-qwen\n  scope: research\n`
    );

    const built = buildAgentSystemPrompt({
      agentFilePath: join(tempDir, "agents", "researcher.md"),
      promptTemplate: "{{AGENT_BODY}}",
      configOptions: {
        projectRoot: tempDir,
        host: "codex"
      }
    });

    expect(built.prompt).toContain("## Ollama-Assisted Research");
    expect(built.prompt).toContain("This run may be using a smaller local Ollama-backed model");
  });

  it("uses the compact researcher body for Ollama host integration runs", () => {
    writeProjectConfig(
      tempDir,
      `ollama:
  enabled: true
  model: local-qwen
  scope: full
  host_integration:
    enabled: true
    strategy: auto
`
    );

    const built = buildAgentSystemPrompt({
      agentFilePath: join(tempDir, "agents", "researcher.md"),
      promptTemplate: "{{AGENT_BODY}}",
      configOptions: {
        projectRoot: tempDir,
        host: "claude"
      }
    });

    expect(built.prompt).toContain("Inspect only the minimum code and config needed to answer the task");
    expect(built.prompt).toContain("This stage is read-only. Do not edit files, do not call write/edit tools, and do not run mutating shell commands.");
    expect(built.prompt).toContain("Treat the task as a tiny smoke run, not a workspace-wide investigation.");
    expect(built.prompt).toContain("Prefer direct inspection of the likely source files over repeated search loops or broad workspace globbing.");
    expect(built.prompt).not.toContain("## Context-Efficient Research Protocol");
  });

  it("adds full-pipeline Ollama runtime guidance for agents without appendices", () => {
    writeProjectConfig(
      tempDir,
      `ollama:\n  enabled: true\n  model: local-qwen\n  scope: full\n  baseUrl: http://127.0.0.1:11434/v1\n`
    );

    const built = buildAgentSystemPrompt({
      agentFilePath: join(tempDir, "agents", "developer.md"),
      promptTemplate: "{{AGENT_BODY}}",
      configOptions: {
        projectRoot: tempDir,
        host: "opencode"
      }
    });

    expect(built.prompt).toContain("## Ollama Full-Pipeline Mode");
    expect(built.prompt).toContain("configured model: local-qwen");
    expect(built.prompt).toContain("route all Lineup agent stages through the selected host");
  });
});
