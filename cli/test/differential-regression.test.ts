import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NativeExecutionDriver } from "../src/lib/executor.js";
import { observeRuntimeStatus } from "../src/lib/observer.js";
import { buildTaskWaves, compilePlanToTasks } from "../src/lib/dag.js";
import { parseRestrictedYaml } from "../src/lib/validation.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures/differential/", import.meta.url));

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

You are the agent body.
`;

const REVIEW_YAML = `apiVersion: lineup/v3
kind: Review
status: PASS
summary: Differential harness native run passed.
issues: []
test_results:
  test_suite:
    status: pass
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
  writeFileSync(join(projectRoot, "README.md"), "# differential\n", "utf8");
  execSync("git add README.md", { cwd: projectRoot, stdio: "ignore" });
  execSync("git commit -m 'init'", { cwd: projectRoot, stdio: "ignore" });
}

function writeWorkspaceChange(workspaceRoot: string, relativePath: string, marker: string): void {
  const targetPath = join(workspaceRoot, relativePath)
  mkdirSync(dirname(targetPath), { recursive: true })
  const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : ""
  const prefix = existing.length > 0 ? `${existing.replace(/\n*$/, "\n")}` : ""
  writeFileSync(targetPath, `${prefix}${marker}\n`, "utf8")
}

function writeWorkflow(projectRoot: string): string {
  const workflowDir = join(projectRoot, ".lineup-core", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  const workflowPath = join(workflowDir, "full-pipeline.yaml");
  writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: differential
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
  return workflowPath;
}

describe("differential regression harness", () => {
  let tempDir = "";
  let projectRoot = "";
  let workflowPath = "";
  let planContent = "";
  let goldenTasks = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-differential-"));
    projectRoot = join(tempDir, "project");
    mkdirSync(projectRoot, { recursive: true });
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);
    workflowPath = writeWorkflow(projectRoot);
    planContent = readFileSync(join(fixtureRoot, "cases", "basic", "plan.yaml"), "utf8");
    goldenTasks = readFileSync(join(fixtureRoot, "golden", "basic.tasks.json"), "utf8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("validates native execution against fixture corpus", async () => {
    const nativeDriver: NativeExecutionDriver = {
      async executeTask(input) {
        const changedFile = input.task.write_scope?.[0] ?? "README.md"
        writeWorkspaceChange(input.workspaceRoot, changedFile, `updated ${input.task.id}`)
        return {
          status: "complete",
          summary: `completed ${input.task.id}`,
          changes_made: [
            {
              file: changedFile,
              description: "updated fixture file",
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
    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const nativeResult = await runPipeline(
        { workflow: workflowPath, approvePlan: true },
        { runId: "diffnative", native: { planContent, driver: nativeDriver } }
      );

      const nativeRuntime = observeRuntimeStatus(projectRoot);
      const nativeTasksPath = nativeRuntime.latest_run?.artifacts.find((artifact) => artifact.kind === "tasks")?.path;
      expect(nativeTasksPath).toBeDefined();
      const nativeTasksArtifact = JSON.parse(readFileSync(nativeTasksPath!, "utf8"));
      const goldenTasksArtifact = JSON.parse(goldenTasks);
      expect(nativeTasksArtifact.tasks).toEqual(goldenTasksArtifact.tasks);

      const parsedPlan = parseRestrictedYaml(planContent, "fixture-plan") as Parameters<typeof compilePlanToTasks>[0];
      const compiled = compilePlanToTasks(parsedPlan, {
        compiledAt: "2026-04-12T00:00:00.000Z",
        gitTreeSha: nativeTasksArtifact.git_tree_sha
      });

      expect(compiled.artifact.plan_hash).toBe(nativeTasksArtifact.plan_hash);
      expect(compiled.artifact.tasks).toEqual(goldenTasksArtifact.tasks);
      expect(buildTaskWaves(compiled.artifact.tasks)).toEqual([["CHANGE-001"], ["CHANGE-002"]]);
      expect(nativeResult.stageResults.get("verify")?.outputs).toHaveProperty("status", "PASS");
    } finally {
      process.chdir(origCwd);
    }
  });
});
