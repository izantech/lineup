import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

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

function writeTemplatesTo(projectRoot: string): void {
  mkdirSync(join(projectRoot, ".lineup-core", "adapters"), { recursive: true });
  mkdirSync(join(projectRoot, ".lineup-core", "prompts"), { recursive: true });
  mkdirSync(join(projectRoot, "agents"), { recursive: true });
  for (const role of ["planner", "worker", "validator"]) {
    writeFileSync(join(projectRoot, ".lineup-core", "adapters", `${role}.sh.template`), ADAPTER_TEMPLATE);
    writeFileSync(join(projectRoot, ".lineup-core", "prompts", `${role}-system.txt.template`), PROMPT_TEMPLATE);
  }
  writeFileSync(join(projectRoot, ".lineup-core", "adapters", "passthrough-planner.sh.template"), PASSTHROUGH_TEMPLATE);
  for (const agent of ["architect", "developer", "reviewer"]) {
    writeFileSync(join(projectRoot, "agents", `${agent}.md`), AGENT_CONTENT);
  }
}

describe("runPipeline", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("dry-run parses workflow and prints execution plan without invoking TF", async () => {
    // Create a minimal workflow file
    const workflowDir = join(tempDir, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, "full-pipeline.yaml"), `
apiVersion: lineup/v1
kind: Workflow
name: test-pipeline
stages:
  - id: triage
    type: builtin
    description: "Classify task"
  - id: plan
    type: agent
    agent: architect
    depends_on: [triage]
  - id: implement
    type: agent
    agent: developer
    depends_on: [plan]
`);

    // Import dynamically to avoid module-level side effects
    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const result = await runPipeline({
      workflow: join(workflowDir, "full-pipeline.yaml"),
      dryRun: true,
    });

    expect(result.status).toBe("success");
    expect(result.runId).toMatch(/^[a-f0-9]{6}$/);
  });

  it("--generate-only produces artifacts without executing", async () => {
    const projectRoot = join(tempDir, "project");
    writeTemplatesTo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v1
kind: Workflow
name: test-pipeline
stages:
  - id: triage
    type: builtin
    description: "Classify task"
  - id: plan
    type: agent
    agent: architect
    depends_on: [triage]
  - id: implement
    type: agent
    agent: developer
    depends_on: [plan]
`);

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    let result;
    try {
      result = await runPipeline({
        workflow: workflowPath,
        generateOnly: true,
      });
    } finally {
      process.chdir(origCwd);
    }

    expect(result.status).toBe("success");
    expect(result.tfOutputDir).toBeDefined();
    // No stage execution — stageResults map is empty
    expect(result.stageResults.size).toBe(0);
    // Verify artifacts were written to disk
    expect(existsSync(join(result.tfOutputDir!, "tf-config.yaml"))).toBe(true);
    expect(existsSync(join(result.tfOutputDir!, "adapters", "planner.sh"))).toBe(true);
  });

  it("rejects workflow with cycle", async () => {
    const workflowDir = join(tempDir, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, "cyclic.yaml"), `
apiVersion: lineup/v1
kind: Workflow
name: cyclic
stages:
  - id: a
    type: builtin
    depends_on: [b]
  - id: b
    type: builtin
    depends_on: [a]
`);

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    await expect(
      runPipeline({ workflow: join(workflowDir, "cyclic.yaml"), dryRun: true })
    ).rejects.toThrow(/cycle/i);
  });
});
