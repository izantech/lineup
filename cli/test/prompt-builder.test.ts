import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAgentSystemPrompt, loadAgentPrompt, parseAgentPrompt } from "../src/lib/prompt-builder.js";

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
});
