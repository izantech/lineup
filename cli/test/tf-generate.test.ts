import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, it, expect } from "vitest";

import { runTfGenerateCommand } from "../src/commands/tf.js";
import type { TfGenerateOptions } from "../src/lib/types.js";

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

const MINIMAL_WORKFLOW = `
apiVersion: lineup/v1
kind: Workflow
name: test-pipeline
stages:
  - id: plan
    type: agent
    agent: architect
  - id: implement
    type: agent
    agent: developer
    depends_on: [plan]
  - id: verify
    type: agent
    agent: reviewer
    depends_on: [implement]
`;

let tempDir: string;
let projectRoot: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lineup-tf-generate-test-"));

  // Set up fake project root with required dirs
  projectRoot = join(tempDir, "project");
  mkdirSync(join(projectRoot, ".lineup-core", "adapters"), { recursive: true });
  mkdirSync(join(projectRoot, ".lineup-core", "prompts"), { recursive: true });
  mkdirSync(join(projectRoot, ".lineup-core", "workflows"), { recursive: true });
  mkdirSync(join(projectRoot, "agents"), { recursive: true });

  // Write adapter templates
  for (const role of ["planner", "worker", "validator"]) {
    writeFileSync(join(projectRoot, ".lineup-core", "adapters", `${role}.sh.template`), ADAPTER_TEMPLATE);
    writeFileSync(join(projectRoot, ".lineup-core", "prompts", `${role}-system.txt.template`), PROMPT_TEMPLATE);
  }
  writeFileSync(join(projectRoot, ".lineup-core", "adapters", "passthrough-planner.sh.template"), PASSTHROUGH_TEMPLATE);

  // Write agent files
  for (const agent of ["architect", "developer", "reviewer"]) {
    writeFileSync(join(projectRoot, "agents", `${agent}.md`), AGENT_CONTENT);
  }

  // Write a default workflow
  writeFileSync(
    join(projectRoot, ".lineup-core", "workflows", "full-pipeline.yaml"),
    MINIMAL_WORKFLOW
  );
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("runTfGenerateCommand", () => {
  it("generates adapters and config to output directory", async () => {
    const outputDir = join(tempDir, "out");
    const workflowPath = join(projectRoot, ".lineup-core", "workflows", "full-pipeline.yaml");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const options: TfGenerateOptions = {
        host: "claude",
        output: outputDir,
        workflow: workflowPath,
      };
      await runTfGenerateCommand(options);
    } finally {
      process.chdir(origCwd);
    }

    const adaptersDir = join(outputDir, "adapters");

    // 3 adapter .sh files
    expect(existsSync(join(adaptersDir, "planner.sh"))).toBe(true);
    expect(existsSync(join(adaptersDir, "worker.sh"))).toBe(true);
    expect(existsSync(join(adaptersDir, "validator.sh"))).toBe(true);

    // 3 system prompt .txt files
    expect(existsSync(join(adaptersDir, "planner-system.txt"))).toBe(true);
    expect(existsSync(join(adaptersDir, "worker-system.txt"))).toBe(true);
    expect(existsSync(join(adaptersDir, "validator-system.txt"))).toBe(true);

    // 1 tf-config.yaml
    expect(existsSync(join(outputDir, "tf-config.yaml"))).toBe(true);
  });

  it("generates passthrough config when manifest-path is provided", async () => {
    const outputDir = join(tempDir, "out");
    const workflowPath = join(projectRoot, ".lineup-core", "workflows", "full-pipeline.yaml");
    const manifestPath = join(tempDir, "planner-output.yaml");
    writeFileSync(manifestPath, "tasks: []");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const options: TfGenerateOptions = {
        host: "claude",
        output: outputDir,
        workflow: workflowPath,
        manifestPath,
      };
      await runTfGenerateCommand(options);
    } finally {
      process.chdir(origCwd);
    }

    const configContent = readFileSync(join(outputDir, "tf-config.yaml"), "utf-8");
    expect(configContent).toContain("passthrough-planner.sh");
    expect(configContent).toContain(manifestPath);
  });

  it("auto-detects default workflow when none specified", async () => {
    const outputDir = join(tempDir, "out");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const options: TfGenerateOptions = {
        host: "claude",
        output: outputDir,
      };
      await runTfGenerateCommand(options);
    } finally {
      process.chdir(origCwd);
    }

    expect(existsSync(join(outputDir, "tf-config.yaml"))).toBe(true);
  });

  it("creates output directory if it does not exist", async () => {
    const outputDir = join(tempDir, "nested", "output", "dir");
    const workflowPath = join(projectRoot, ".lineup-core", "workflows", "full-pipeline.yaml");

    expect(existsSync(outputDir)).toBe(false);

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      await runTfGenerateCommand({ host: "claude", output: outputDir, workflow: workflowPath });
    } finally {
      process.chdir(origCwd);
    }

    expect(existsSync(outputDir)).toBe(true);
  });

  it("output is valid JSON", async () => {
    const outputDir = join(tempDir, "out");
    const workflowPath = join(projectRoot, ".lineup-core", "workflows", "full-pipeline.yaml");

    const lines: string[] = [];
    const origConsoleLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      await runTfGenerateCommand({ host: "claude", output: outputDir, workflow: workflowPath });
    } finally {
      process.chdir(origCwd);
      console.log = origConsoleLog;
    }

    const jsonOutput = lines.join("\n");
    expect(() => JSON.parse(jsonOutput)).not.toThrow();
    const parsed = JSON.parse(jsonOutput);
    expect(parsed).toHaveProperty("configPath");
    expect(parsed).toHaveProperty("adapters");
  });
});
