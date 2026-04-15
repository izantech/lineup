import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createArtifactStore } from "../src/lib/artifact-store.js";
import { applyWorkspacePatch, executeNativeExecutor, normalizeReviewArtifact, type NativeExecutionDriver } from "../src/lib/executor.js";
import { CliError } from "../src/lib/errors.js";

const APPROVED_PLAN = `apiVersion: lineup/v3
kind: Plan
status: approved
summary: Implement native execution
approaches:
  - name: Native
    strategy: Execute compiled tasks directly
recommendation:
  approach: Native
  rationale: Keep execution inside the CLI
changes:
  - file: cli/src/lib/executor.ts
    change: Add native executor
    rationale: Replace TF execution
  - file: cli/src/lib/run-pipeline.ts
    change: Integrate native executor
    rationale: Route implement and verify through native runtime
dependencies:
  - from_change: 2
    to_change: 1
    description: run-pipeline must call executor after executor exists
acceptance_criteria:
  - criterion: Native executor completes compiled tasks
risks:
  - risk: Worktree cleanup could remove run files
    mitigation: Persist artifacts outside run root
`;

const PASS_REVIEW = `apiVersion: lineup/v3
kind: Review
status: PASS
summary: Native executor passed verification.
issues: []
test_results:
  test_suite:
    status: pass
`;

const QUIRKY_REVIEW = `lineup: v3
kind: Review
status: PASS
summary: >
  The implementation correctly appends a blank line and the descriptive sentence
  after the heading.
issues: []
test_results:
  - name: "Visual inspection of README.md"
    outcome: pass
    detail: File contains heading, blank line, and descriptive sentence.
  - name: "Git diff verification"
    outcome: pass
    detail: Only README.md was modified.
tasks:
  - id: CHANGE-001
    status: verified
    notes: "README.md updated correctly."
`;

function initGitRepo(projectRoot: string): void {
  execSync("git init", { cwd: projectRoot, stdio: "ignore" });
  execSync("git config user.email 'lineup@example.com'", { cwd: projectRoot, stdio: "ignore" });
  execSync("git config user.name 'Lineup Tests'", { cwd: projectRoot, stdio: "ignore" });
  writeFileSync(join(projectRoot, "README.md"), "# test\n", "utf8");
  execSync("git add README.md", { cwd: projectRoot, stdio: "ignore" });
  execSync("git commit -m 'init'", { cwd: projectRoot, stdio: "ignore" });
}

function writeAgentFiles(projectRoot: string): void {
  mkdirSync(join(projectRoot, "agents"), { recursive: true });
  writeFileSync(
    join(projectRoot, "agents", "developer.md"),
    `---
name: developer
inputs:
  - name: plan
    schema: Plan
    required: true
outputs:
  schema: ImplementationState
timeout: 10m
retry:
  max: 2
  on: [build_failure]
---

Implement the assigned task.
`,
    "utf8"
  );
  writeFileSync(
    join(projectRoot, "agents", "reviewer.md"),
    `---
name: reviewer
inputs:
  - name: implementation_state
    schema: ImplementationState
    required: true
outputs:
  schema: Review
timeout: 5m
---

Review the implementation.
`,
    "utf8"
  );
}

describe("executeNativeExecutor", () => {
  let tempDir = "";
  let projectRoot = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-native-executor-"));
    projectRoot = join(tempDir, "project");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, ".lineup", ".runs", "testrun", "artifacts"), { recursive: true });
    mkdirSync(join(projectRoot, ".lineup", ".artifacts"), { recursive: true });
    initGitRepo(projectRoot);
    writeAgentFiles(projectRoot);
    writeFileSync(join(projectRoot, ".lineup", ".runs", "testrun", "artifacts", "plan.yaml"), APPROVED_PLAN, "utf8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("normalizes markdown review artifacts when the label and colon are split", () => {
    const normalized = normalizeReviewArtifact(
      `**Status**: PASS WITH WARNINGS

**Summary**: Native executor completed with a warning.

**Issues**:
- Warning: README.md line 2 needs a follow-up check.

**Test results**: No tests were run.
`,
      "inline-review"
    );

    expect(normalized).toContain("kind: Review");
    expect(normalized).toContain("status: PASS_WITH_WARNINGS");
    expect(normalized).toContain("summary: Native executor completed with a warning.");
  });

  it("normalizes review artifacts after repairing colon-heavy scalar YAML", () => {
    const normalized = normalizeReviewArtifact(
      `status: PASS
summary: The change looks correct.
issues: []
test_results: No specific tests were run as this was a simple text replacement operation. The implementation was verified through direct file inspection and git diff checking, confirming that: 1. The placeholder text has been removed from README.md 2. The new text has been correctly added to README.md 3. The change matches exactly what was planned 4. No other files were modified
`,
      "codex-inline-review"
    );

    expect(normalized).toContain("kind: Review");
    expect(normalized).toContain("status: PASS");
    expect(normalized).toContain("summary: The change looks correct.");
    expect(normalized).toContain("test_results:");
    expect(normalized).toContain("status: pass");
  });

  it("compiles plan tasks, retries retryable failures, and persists review output", async () => {
    const attempts = new Map<string, number>();
    const emittedMethods: string[] = [];

    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        const currentAttempt = (attempts.get(input.task.id) ?? 0) + 1;
        attempts.set(input.task.id, currentAttempt);

        if (input.task.id === "CHANGE-001" && currentAttempt === 1) {
          throw new CliError("build failed", { code: "build_failure" });
        }

        return {
          status: "complete",
          summary: `completed ${input.task.id}`,
          changes_made: [
            {
              file: input.task.write_scope?.[0] ?? "unknown",
              description: `updated ${input.task.id}`,
              task_id: input.task.id
            }
          ]
        };
      },
      async executeReview() {
        return { reviewYaml: QUIRKY_REVIEW };
      }
    };

    const result = await executeNativeExecutor({
      runId: "testrun",
      projectRoot,
      runRoot: join(projectRoot, ".lineup", ".runs", "testrun"),
      artifactDir: join(projectRoot, ".lineup", ".runs", "testrun", "artifacts"),
      planPath: join(projectRoot, ".lineup", ".runs", "testrun", "artifacts", "plan.yaml"),
      gitTreeSha: "abc123",
      artifactStore: createArtifactStore(join(projectRoot, ".lineup", ".artifacts")),
      nextProtocolRequestId: (() => {
        let id = 1;
        return () => id++;
      })(),
      emitProtocol(message) {
        if ("method" in message) {
          emittedMethods.push(message.method);
        }
      },
      emitStatus() {},
      implementStage: {
        id: "implement",
        type: "agent",
        agent: "developer",
        retry: {
          max_attempts: 2,
          on: ["build_failure"]
        }
      },
      verifyStage: {
        id: "verify",
        type: "agent",
        agent: "reviewer"
      },
      driver
    });

    expect(result.implementResult.outputs.task_results).toHaveLength(2);
    expect(result.implementResult.outputs.task_results[0]?.attempts).toBe(2);
    expect(result.implementResult.outputs.changes_made).toHaveLength(2);
    expect(result.verifyResult.outputs.status).toBe("PASS");
    expect(existsSync(result.planRecord.path)).toBe(true);
    expect(existsSync(result.tasksRecord.path)).toBe(true);
    expect(existsSync(result.reviewRecord.path)).toBe(true);
    expect(readFileSync(result.reviewRecord.path, "utf8")).toContain("kind: Review");
    expect(emittedMethods.filter((method) => method === "agent/spawn")).toHaveLength(4);
  });

  it("waits for response files and repairs fenced outputs in the default driver", async () => {
    const artifactDir = join(projectRoot, ".lineup", ".runs", "testrun", "artifacts");
    const responseDir = join(artifactDir, "native", "responses");

    setTimeout(() => {
      mkdirSync(responseDir, { recursive: true });
      writeFileSync(
        join(responseDir, "CHANGE-001.json"),
        [
          "```json",
          JSON.stringify({
            status: "done",
            summary: "completed CHANGE-001",
            changes_made: [
              {
                file: "cli/src/lib/executor.ts",
                description: "updated executor"
              }
            ],
            issues_encountered: []
          }, null, 2),
          "```"
        ].join("\n"),
        "utf8"
      );

      writeFileSync(
        join(responseDir, "CHANGE-002.json"),
        JSON.stringify({
          status: "complete",
          summary: "completed CHANGE-002",
          changes_made: [
            {
              file: "cli/src/lib/run-pipeline.ts",
              description: "updated pipeline",
              task_id: "CHANGE-002"
            }
          ],
          issues_encountered: []
        }, null, 2),
        "utf8"
      );

      writeFileSync(
        join(responseDir, "review.yaml"),
        `**Status: PASS**

**Summary:** Native executor passed verification.

**Issues:** None.

**Test results:**
- Diff verification: **pass** — expected files changed only.
`,
        "utf8"
      );
    }, 50);

    const result = await executeNativeExecutor({
      runId: "testrun",
      projectRoot,
      runRoot: join(projectRoot, ".lineup", ".runs", "testrun"),
      artifactDir,
      planPath: join(artifactDir, "plan.yaml"),
      gitTreeSha: "abc123",
      artifactStore: createArtifactStore(join(projectRoot, ".lineup", ".artifacts")),
      nextProtocolRequestId: (() => {
        let id = 1;
        return () => id++;
      })(),
      emitProtocol() {},
      emitStatus() {},
      implementStage: {
        id: "implement",
        type: "agent",
        agent: "developer"
      },
      verifyStage: {
        id: "verify",
        type: "agent",
        agent: "reviewer"
      }
    });

    expect(result.implementResult.outputs.task_results).toHaveLength(2);
    expect(result.verifyResult.outputs.status).toBe("PASS");
    expect(readFileSync(result.reviewRecord.path, "utf8")).toContain("kind: Review");
  });

  it("normalizes near-schema plan drafts produced by local hosts", async () => {
    const nearSchemaPlan = `apiVersion: lineup/v3
kind: Plan
stage_id: plan
run_id: 3a10b0
summary: |
  Add a second sentence to README.md describing the app's purpose.
approaches:
  - id: minimal-smoke-test
    strategy: Add a concise sentence describing the app.
    pros:
      - Smallest possible change
    cons:
      - Assumes the project intent from current files
    estimated_scope: 1 file, 1 line added
recommendation:
  approach: minimal-smoke-test
  rationale: The project is intentionally minimal and needs one sentence only.
changes:
  - id: add-readme-description
    file: ${join(projectRoot, "README.md")}
    action: append_line
    description: Add a second sentence after the heading describing the app's purpose
parallelization_strategy:
  batches:
    - batch: 1
      changes: [add-readme-description]
      parallel: false
      notes: Single change; no parallelization needed
  recommendation: sequential
  rationale: Only one file changes.
dependencies: []
acceptance_criteria:
  - README.md contains a second descriptive sentence about the app's purpose
risks:
  - risk: The inferred purpose may not match maintainer intent
    likelihood: low
    impact: low
    mitigation: Review during plan approval
`;

    writeFileSync(join(projectRoot, ".lineup", ".runs", "testrun", "artifacts", "plan.yaml"), nearSchemaPlan, "utf8");

    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        return {
          status: "complete",
          summary: `completed ${input.task.id}`,
          changes_made: [
            {
              file: input.task.write_scope?.[0] ?? "README.md",
              description: "updated file",
              task_id: input.task.id
            }
          ]
        };
      },
      async executeReview() {
        return { reviewYaml: QUIRKY_REVIEW };
      }
    };

    const result = await executeNativeExecutor({
      runId: "testrun",
      projectRoot,
      runRoot: join(projectRoot, ".lineup", ".runs", "testrun"),
      artifactDir: join(projectRoot, ".lineup", ".runs", "testrun", "artifacts"),
      planPath: join(projectRoot, ".lineup", ".runs", "testrun", "artifacts", "plan.yaml"),
      gitTreeSha: "abc123",
      artifactStore: createArtifactStore(join(projectRoot, ".lineup", ".artifacts")),
      nextProtocolRequestId: (() => {
        let id = 1;
        return () => id++;
      })(),
      emitProtocol() {},
      emitStatus() {},
      implementStage: {
        id: "implement",
        type: "agent",
        agent: "developer"
      },
      verifyStage: {
        id: "verify",
        type: "agent",
        agent: "reviewer"
      },
      driver
    });

    const normalizedPlan = readFileSync(result.planRecord.path, "utf8");
    expect(normalizedPlan).toContain("status: approved");
    expect(normalizedPlan).toContain("change: Add a second sentence after the heading describing the app's purpose");
    expect(normalizedPlan).toContain("batch_number: 1");
    expect(result.implementResult.outputs.task_results).toHaveLength(1);
    expect(result.verifyResult.outputs.status).toBe("PASS");
    expect(readFileSync(result.reviewRecord.path, "utf8")).toContain("apiVersion: lineup/v3");
    expect(readFileSync(result.reviewRecord.path, "utf8")).toContain("tests_run: 2");
  });

  it("applies captured workspace patches back to the source repository", async () => {
    const patchPath = join(projectRoot, ".lineup", ".runs", "testrun", "artifacts", "native", "workspace.patch");
    mkdirSync(join(projectRoot, ".lineup", ".runs", "testrun", "artifacts", "native"), { recursive: true });
    writeFileSync(
      patchPath,
      `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1,3 @@
 # test
+
+Applied from patch
`,
      "utf8"
    );

    await applyWorkspacePatch(projectRoot, patchPath);

    expect(readFileSync(join(projectRoot, "README.md"), "utf8")).toContain("Applied from patch");
  });
});
