import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createArtifactStore } from "../src/lib/artifact-store.js";
import { applyWorkspacePatch, executeNativeExecutor, normalizeReviewArtifact, normalizeTaskExecutionResult, type NativeExecutionDriver } from "../src/lib/executor.js";
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

function writeOllamaHostConfig(projectRoot: string): void {
  mkdirSync(join(projectRoot, ".lineup"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".lineup", "config.yaml"),
    `ollama:
  enabled: true
  model: qwen3-coder:30b
  scope: full
  host_integration:
    enabled: true
    strategy: auto
`,
    "utf8"
  );
}

function writeScopedWorkspaceChange(workspaceRoot: string, relativePath: string, marker: string): void {
  const targetPath = join(workspaceRoot, relativePath)
  mkdirSync(dirname(targetPath), { recursive: true })
  const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : ""
  const prefix = existing.length > 0 ? `${existing.replace(/\n*$/, "\n")}` : ""
  writeFileSync(targetPath, `${prefix}${marker}\n`, "utf8")
}

function writeTaskScopedChange(workspaceRoot: string, taskPath: string | undefined, taskId: string): string {
  const relativePath = taskPath ?? "README.md"
  writeScopedWorkspaceChange(workspaceRoot, relativePath, `updated ${taskId}`)
  return relativePath
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

        const changedFile = writeTaskScopedChange(input.workspaceRoot, input.task.write_scope?.[0], input.task.id)

        return {
          status: "complete",
          summary: `completed ${input.task.id}`,
          changes_made: [
            {
              file: changedFile,
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
    const requestDir = join(artifactDir, "native", "requests");
    const responseDir = join(artifactDir, "native", "responses");
    const worktreeRoot = join(projectRoot, ".lineup", ".runs", "testrun", "native-isolation", "worktree");
    writeFileSync(
      join(artifactDir, "plan.yaml"),
      `apiVersion: lineup/v3
kind: Plan
status: approved
summary: Update the README in two small steps
approaches:
  - name: Minimal
    strategy: Keep both changes in README.md
recommendation:
  approach: Minimal
  rationale: The default driver test only needs a tracked file for diff validation
changes:
  - file: README.md
    change: Add the validation sentence
    rationale: Exercise fenced output repair for the first task
  - file: README.md
    change: Add a second confirmation sentence
    rationale: Exercise plain JSON output repair for the second task
acceptance_criteria:
  - criterion: README.md includes both smoke sentences
risks:
  - risk: The README fixture may already contain the expected text
    mitigation: Overwrite the file deterministically in the worktree
`,
      "utf8"
    )

    const writeResponses = () => {
      if (!existsSync(join(requestDir, "CHANGE-001.json")) || !existsSync(join(worktreeRoot, "README.md"))) {
        setTimeout(writeResponses, 20)
        return
      }

      mkdirSync(responseDir, { recursive: true });
      writeScopedWorkspaceChange(worktreeRoot, "README.md", "This repo validates Ollama host execution.")
      writeScopedWorkspaceChange(worktreeRoot, "README.md", "The default driver repaired both response formats.")
      writeFileSync(
        join(responseDir, "CHANGE-001.json"),
        [
          "```json",
          JSON.stringify({
            status: "done",
            summary: "completed CHANGE-001",
            changes_made: [
              {
                file: "README.md",
                description: "updated README heading section"
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
              file: "README.md",
              description: "updated README body",
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
    };

    setTimeout(writeResponses, 50);

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

  it("normalizes string-only implementation change entries onto the task write scope", () => {
    const result = normalizeTaskExecutionResult(
      JSON.stringify({
        status: "completed",
        summary: "updated README",
        changes_made: [
          "Replaced the placeholder text with the validation sentence."
        ],
        issues_encountered: []
      }),
      {
        id: "CHANGE-001",
        title: "Update README",
        wave: 1,
        status: "todo",
        write_scope: ["README.md"],
        deliverables: ["README.md"]
      },
      "inline"
    );

    expect(result.changes_made).toEqual([
      {
        file: "README.md",
        description: "Replaced the placeholder text with the validation sentence.",
        task_id: "CHANGE-001"
      }
    ]);
  });

  it("builds compact native developer and reviewer prompts for Ollama host integration", async () => {
    writeOllamaHostConfig(projectRoot);
    writeFileSync(
      join(projectRoot, ".lineup", ".runs", "testrun", "artifacts", "plan.yaml"),
      `apiVersion: lineup/v3
kind: Plan
status: approved
summary: Update the README for Ollama prompt coverage
approaches:
  - name: Minimal
    strategy: Update the README only
recommendation:
  approach: Minimal
  rationale: Keep the prompt fixture focused on one tracked file
changes:
  - file: README.md
    change: Add one sentence covering Ollama prompt execution
    rationale: Reviewer prompt assertions need a tracked diff
acceptance_criteria:
  - criterion: README.md includes the Ollama validation sentence
risks:
  - risk: README.md might already contain the sentence
    mitigation: Overwrite the file deterministically in the fixture
`,
      "utf8"
    )
    const capturedPrompts: string[] = [];

    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        capturedPrompts.push(input.prompt);
        const changedFile = writeTaskScopedChange(input.workspaceRoot, input.task.write_scope?.[0], input.task.id)
        return {
          status: "complete",
          summary: `completed ${input.task.id}`,
          changes_made: [
            {
              file: changedFile,
              description: "updated file",
              task_id: input.task.id
            }
          ],
          issues_encountered: []
        };
      },
      async executeReview(input) {
        capturedPrompts.push(input.prompt);
        return { reviewYaml: PASS_REVIEW };
      }
    };

    await executeNativeExecutor({
      runId: "testrun",
      projectRoot,
      host: "claude",
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

    const developerPrompt = capturedPrompts.find((prompt) => prompt.includes("Native Lineup task:"));
    const reviewerPrompt = capturedPrompts.find((prompt) => prompt.includes("Native Lineup review:"));

    expect(developerPrompt).toBeDefined();
    expect(developerPrompt).toContain("Apply only the approved task in the provided worktree, then stop.");
    expect(developerPrompt).not.toContain("## Tool Usage Priorities");
    expect(developerPrompt).not.toContain("Task payload:");

    expect(reviewerPrompt).toBeDefined();
    expect(reviewerPrompt).toContain("Verify the implemented change against the approved plan, then stop.");
    expect(reviewerPrompt).toContain("Native Lineup review:");
    expect(reviewerPrompt).not.toContain("Compiled tasks:");
    expect(reviewerPrompt).toContain("Workspace diff:");
    expect(reviewerPrompt).toContain("+++ b/README.md");
  });

  it("infers task changes from the workspace diff when the model reports no changes", async () => {
    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        mkdirSync(join(input.workspaceRoot, "cli", "src", "lib"), { recursive: true });
        writeFileSync(
          join(input.workspaceRoot, "cli", "src", "lib", "executor.ts"),
          "export const inferred = true;\n",
          "utf8"
        );

        return {
          status: "complete",
          summary: "updated README",
          changes_made: [],
          issues_encountered: []
        };
      },
      async executeReview() {
        return { reviewYaml: PASS_REVIEW };
      }
    };

    const result = await executeNativeExecutor({
      runId: "testrun",
      projectRoot,
      host: "claude",
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

    expect(result.implementResult.outputs.changes_made).toContainEqual({
      file: "cli/src/lib/executor.ts",
      description: "Updated cli/src/lib/executor.ts",
      task_id: "CHANGE-001"
    });
  });

  it("fails when a model reports changes but leaves no workspace diff", async () => {
    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        return {
          status: "complete",
          summary: `completed ${input.task.id}`,
          changes_made: [
            {
              file: "cli/src/lib/executor.ts",
              description: "claimed update",
              task_id: input.task.id
            }
          ],
          issues_encountered: []
        };
      },
      async executeReview() {
        return { reviewYaml: PASS_REVIEW };
      }
    };

    await expect(
      executeNativeExecutor({
        runId: "testrun",
        projectRoot,
        host: "claude",
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
          agent: "developer",
          retry: {
            max_attempts: 1,
            on: ["build_failure"]
          }
        },
        verifyStage: {
          id: "verify",
          type: "agent",
          agent: "reviewer"
        },
        driver
      })
    ).rejects.toThrow("reported file changes but produced no workspace diff");
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
        const changedFile = writeTaskScopedChange(input.workspaceRoot, input.task.write_scope?.[0], input.task.id)
        return {
          status: "complete",
          summary: `completed ${input.task.id}`,
          changes_made: [
            {
              file: changedFile,
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

  it("normalizes plan changes that use Claude-style field names", async () => {
    const claudeStylePlan = `summary: Replace the README placeholder with the validation sentence.
approaches:
  - strategy: Direct replacement
    pros: Minimal change
    cons: None for this smoke task
    estimated_scope: 1 file
recommendation: Use the direct replacement approach because the task is isolated.
changes:
  - file_path: ${join(projectRoot, "README.md")}
    what_to_change: Replace REPLACE_ME_VALIDATE_OLLAMA_HOST_EXECUTION with "This repo validates Ollama host execution."
    why_this_change_is_needed: The smoke task requires the README placeholder replacement.
acceptance_criteria:
  - README.md contains the validation sentence exactly once
risks:
  - risk: The placeholder text may already be absent
    mitigation: Verify the current README contents before editing
`;

    writeFileSync(join(projectRoot, ".lineup", ".runs", "testrun", "artifacts", "plan.yaml"), claudeStylePlan, "utf8");

    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        const changedFile = writeTaskScopedChange(input.workspaceRoot, input.task.write_scope?.[0], input.task.id)
        return {
          status: "complete",
          summary: `completed ${input.task.id}`,
          changes_made: [
            {
              file: changedFile,
              description: "updated file",
              task_id: input.task.id
            }
          ]
        };
      },
      async executeReview() {
        return { reviewYaml: PASS_REVIEW };
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
    expect(normalizedPlan).toContain("file: README.md");
    expect(normalizedPlan).toContain("change: Replace REPLACE_ME_VALIDATE_OLLAMA_HOST_EXECUTION");
    expect(normalizedPlan).toContain('validates Ollama host execution."');
    expect(normalizedPlan).toContain("rationale: The smoke task requires the README placeholder replacement.");
    expect(result.implementResult.outputs.task_results).toHaveLength(1);
    expect(result.verifyResult.outputs.status).toBe("PASS");
  });

  it("captures committed isolated-worktree changes relative to the baseline head", async () => {
    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        const changedFile = writeTaskScopedChange(input.workspaceRoot, input.task.write_scope?.[0], "committed");
        execSync(`git -C "${input.workspaceRoot}" add "${changedFile}"`, { stdio: "ignore" });
        execSync(`git -C "${input.workspaceRoot}" commit -m "apply ${input.task.id}"`, { stdio: "ignore" });

        return {
          status: "complete",
          summary: `completed ${input.task.id}`,
          changes_made: [
            {
              file: changedFile,
              description: "committed change",
              task_id: input.task.id
            }
          ],
          issues_encountered: []
        };
      },
      async executeReview(input) {
        expect(input.prompt).toContain("Workspace diff:");
        expect(input.prompt).toContain("updated committed");
        return { reviewYaml: PASS_REVIEW };
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

    expect(result.workspacePatchPath).toBeTruthy();
    await applyWorkspacePatch(projectRoot, result.workspacePatchPath);
    expect(readFileSync(join(projectRoot, "cli", "src", "lib", "executor.ts"), "utf8")).toContain("updated committed");
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

  it("treats already-applied workspace patches as a no-op", async () => {
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

    writeFileSync(join(projectRoot, "README.md"), "# test\n\nApplied from patch\n", "utf8");

    await applyWorkspacePatch(projectRoot, patchPath);

    expect(readFileSync(join(projectRoot, "README.md"), "utf8")).toBe("# test\n\nApplied from patch\n");
  });
});
