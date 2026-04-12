import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generatePassthroughAdapter, generateTfAdapters } from "../src/lib/tf-adapters.js";
import type { AdapterGenerationContext } from "../src/lib/tf-adapters.js";

let tempDir: string;

const ADAPTER_TEMPLATE = `#!/usr/bin/env bash
SYSTEM_PROMPT=$(cat "{{SYSTEM_PROMPT_PATH}}")
PAYLOAD="$(cat)"
{{HOST_INVOKE_COMMAND}}
`;

const PASSTHROUGH_TEMPLATE = `#!/usr/bin/env bash
cat "{{APPROVED_MANIFEST_PATH}}"
`;

const PROMPT_TEMPLATE = `You are an agent.

{{AGENT_BODY}}

## Contract`;

const AGENT_CONTENT = `---
name: architect
description: Test agent
---

You are the architect agent body content here.
`;

function writeTemplates(adaptersDir: string, promptsDir: string, agentsDir: string): void {
  for (const role of ["planner", "worker", "validator"]) {
    writeFileSync(join(adaptersDir, `${role}.sh.template`), ADAPTER_TEMPLATE);
    writeFileSync(join(promptsDir, `${role}-system.txt.template`), PROMPT_TEMPLATE);
  }
  writeFileSync(join(adaptersDir, "passthrough-planner.sh.template"), PASSTHROUGH_TEMPLATE);

  for (const agent of ["architect", "developer", "reviewer"]) {
    writeFileSync(join(agentsDir, `${agent}.md`), AGENT_CONTENT);
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-test-"));
  mkdirSync(join(tempDir, "adapters"));
  mkdirSync(join(tempDir, "prompts"));
  mkdirSync(join(tempDir, "agents"));
  mkdirSync(join(tempDir, "output"));
  writeTemplates(
    join(tempDir, "adapters"),
    join(tempDir, "prompts"),
    join(tempDir, "agents")
  );
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeCtx(): AdapterGenerationContext {
  return {
    host: "claude",
    adaptersSourceDir: join(tempDir, "adapters"),
    promptsSourceDir: join(tempDir, "prompts"),
    outputDir: join(tempDir, "output"),
    agentsDir: join(tempDir, "agents"),
    modelMap: {
      scope_selector: "claude-sonnet-4-6",
      planner: "claude-sonnet-4-6",
      worker: "claude-sonnet-4-6",
      validator: "claude-sonnet-4-6"
    }
  };
}

describe("generateTfAdapters", () => {
  it("creates adapter scripts for all 3 roles", () => {
    const result = generateTfAdapters(makeCtx());
    expect(result.planner.adapterPath).toBeDefined();
    expect(result.worker.adapterPath).toBeDefined();
    expect(result.validator.adapterPath).toBeDefined();
    for (const role of ["planner", "worker", "validator"] as const) {
      const content = readFileSync(result[role].adapterPath, "utf8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("adapter scripts are executable", () => {
    const result = generateTfAdapters(makeCtx());
    for (const role of ["planner", "worker", "validator"] as const) {
      const mode = statSync(result[role].adapterPath).mode;
      // Check owner execute bit (0o100)
      expect(mode & 0o100).toBeTruthy();
    }
  });

  it("system prompts contain the agent body content", () => {
    const result = generateTfAdapters(makeCtx());
    for (const role of ["planner", "worker", "validator"] as const) {
      const promptContent = readFileSync(result[role].promptPath, "utf8");
      expect(promptContent).toContain("You are the architect agent body content here.");
    }
  });

  it("system prompts do not contain raw {{AGENT_BODY}} placeholder", () => {
    const result = generateTfAdapters(makeCtx());
    for (const role of ["planner", "worker", "validator"] as const) {
      const promptContent = readFileSync(result[role].promptPath, "utf8");
      expect(promptContent).not.toContain("{{AGENT_BODY}}");
    }
  });
});

describe("generatePassthroughAdapter", () => {
  it("creates a passthrough-planner.sh script", () => {
    const ctx = makeCtx();
    const adapterPath = generatePassthroughAdapter(ctx, "/tmp/approved.yaml");
    expect(adapterPath).toContain("passthrough-planner.sh");
    const content = readFileSync(adapterPath, "utf8");
    expect(content).toContain("/tmp/approved.yaml");
  });

  it("passthrough adapter is executable", () => {
    const ctx = makeCtx();
    const adapterPath = generatePassthroughAdapter(ctx, "/tmp/approved.yaml");
    const mode = statSync(adapterPath).mode;
    expect(mode & 0o100).toBeTruthy();
  });
});
