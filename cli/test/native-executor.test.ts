import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createArtifactStore } from "../src/lib/artifact-store.js";
import { executeNativeExecutor, type NativeExecutionDriver } from "../src/lib/executor.js";
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
            status: "complete",
            summary: "completed CHANGE-001",
            changes_made: [
              {
                file: "cli/src/lib/executor.ts",
                description: "updated executor",
                task_id: "CHANGE-001"
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
        [
          "```json",
          JSON.stringify({
            apiVersion: "lineup/v3",
            kind: "Review",
            status: "PASS",
            summary: "Native executor passed verification.",
            issues: [],
            test_results: {
              test_suite: {
                status: "pass"
              }
            }
          }, null, 2),
          "```"
        ].join("\n"),
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
});
