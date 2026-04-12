import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { execSync } from "node:child_process";

import type { NativeExecutionDriver } from "../src/lib/executor.js";

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

function initGitRepo(projectRoot: string): void {
  execSync("git init", { cwd: projectRoot, stdio: "ignore" });
  execSync("git config user.email 'lineup@example.com'", { cwd: projectRoot, stdio: "ignore" });
  execSync("git config user.name 'Lineup Tests'", { cwd: projectRoot, stdio: "ignore" });
  writeFileSync(join(projectRoot, "README.md"), "# test\n", "utf8");
  execSync("git add README.md", { cwd: projectRoot, stdio: "ignore" });
  execSync("git commit -m 'init'", { cwd: projectRoot, stdio: "ignore" });
}

const APPROVED_PLAN = `apiVersion: lineup/v3
kind: Plan
status: approved
summary: Integrate native executor
approaches:
  - name: Native
    strategy: Execute inside Lineup
recommendation:
  approach: Native
  rationale: Avoid the TF bridge
changes:
  - file: cli/src/lib/executor.ts
    change: Add executor
    rationale: Run tasks natively
acceptance_criteria:
  - criterion: Pipeline reaches verify
risks:
  - risk: Tests could depend on external host tooling
    mitigation: Seed native driver in tests
`;

const REVIEW_YAML = `apiVersion: lineup/v3
kind: Review
status: PASS
summary: Pipeline completed through native executor.
issues: []
test_results:
  test_suite:
    status: pass
`;

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
apiVersion: lineup/v3
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


  it("executes implement and verify through the native executor path", async () => {
    const projectRoot = join(tempDir, "project-native");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: test-pipeline
stages:
  - id: triage
    type: builtin
  - id: plan
    type: agent
    agent: architect
    depends_on: [triage]
  - id: plan-approval
    type: approval
    depends_on: [plan]
  - id: implement
    type: agent
    agent: developer
    depends_on: [plan-approval]
    retry:
      max_attempts: 2
      on: [build_failure]
  - id: verify
    type: agent
    agent: reviewer
    depends_on: [implement]
`);

    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        return {
          status: "complete",
          summary: `completed ${input.task.id}`,
          changes_made: [
            {
              file: input.task.write_scope?.[0] ?? "unknown",
              description: "updated file",
              task_id: input.task.id
            }
          ]
        };
      },
      async executeReview() {
        return {
          reviewYaml: REVIEW_YAML
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const origCwd = process.cwd();
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      return true;
    }) as typeof process.stdout.write;

    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          approvePlan: true
        },
        {
          runId: "native1",
          native: {
            planContent: APPROVED_PLAN,
            driver
          }
        }
      );

      expect(result.status).toBe("success");
      expect(result.stageResults.get("implement")?.outputs).toHaveProperty("tasks_path");
      expect(result.stageResults.get("verify")?.outputs).toHaveProperty("status", "PASS");
    } finally {
      process.chdir(origCwd);
      process.stdout.write = origWrite;
    }
  });

  it("writes a debug bundle when native execution fails", async () => {
    const projectRoot = join(tempDir, "project-failure");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: test-pipeline
stages:
  - id: triage
    type: builtin
  - id: plan
    type: agent
    agent: architect
    depends_on: [triage]
  - id: plan-approval
    type: approval
    depends_on: [plan]
  - id: implement
    type: agent
    agent: developer
    depends_on: [plan-approval]
  - id: verify
    type: agent
    agent: reviewer
    depends_on: [implement]
`);

    const driver: NativeExecutionDriver = {
      async executeTask() {
        throw new Error("simulated native failure");
      },
      async executeReview() {
        return { reviewYaml: REVIEW_YAML };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      await expect(
        runPipeline(
          { workflow: workflowPath, approvePlan: true },
          {
            runId: "failrun",
            native: {
              planContent: APPROVED_PLAN,
              driver
            }
          }
        )
      ).rejects.toThrow(/simulated native failure/);

      const debugBundle = join(projectRoot, ".lineup", ".runs", "failrun", "debug-bundle.json");
      expect(existsSync(debugBundle)).toBe(true);
      expect(readFileSync(debugBundle, "utf8")).toContain("simulated native failure");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("rejects a new run when an active runtime lock is present", async () => {
    const projectRoot = join(tempDir, "project-lock");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: test-pipeline
stages:
  - id: triage
    type: builtin
`);

    mkdirSync(join(projectRoot, ".lineup", ".runs", "other"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".lineup", ".runs", "other", "pipeline-state.json"),
      `${JSON.stringify({
        apiVersion: "lineup/v3",
        kind: "PipelineState",
        run_id: "other",
        status: "running",
        workflow: workflowPath,
        artifact_hashes: {},
        updated_at: "2026-04-12T00:00:00.000Z"
      }, null, 2)}\n`,
      "utf8"
    );
    mkdirSync(join(projectRoot, ".lineup"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".lineup", "runtime.lock"),
      `${JSON.stringify({ runId: "other", created_at: "2026-04-12T00:00:00.000Z" }, null, 2)}\n`,
      "utf8"
    );

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      await expect(runPipeline({ workflow: workflowPath })).rejects.toThrow(/already active/i);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("rejects workflow with cycle", async () => {
    const workflowDir = join(tempDir, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, "cyclic.yaml"), `
apiVersion: lineup/v3
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
