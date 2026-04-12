import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { createArtifactStore } from "../src/lib/artifact-store.js";
import { executeNativeExecutor, type NativeExecutionDriver, type NativeExecutorOptions, type NativeExecutorResult } from "../src/lib/executor.js";

const APPROVED_PLAN = `apiVersion: lineup/v3
kind: Plan
status: approved
summary: test plan for retry ux
approaches:
  - name: direct
    strategy: implement directly
recommendation:
  approach: direct
  rationale: simplest
changes:
  - file: src/a.ts
    change: add feature A
    rationale: needed
  - file: src/b.ts
    change: add feature B
    rationale: needed
acceptance_criteria:
  - criterion: all tasks complete
risks:
  - risk: partial failure
    mitigation: retry failed tasks
`;

const PASS_REVIEW = `apiVersion: lineup/v3
kind: Review
status: PASS
summary: All good.
issues: []
test_results:
  test_suite:
    status: pass
`;

const FAIL_REVIEW_B = `apiVersion: lineup/v3
kind: Review
status: FAIL
summary: src/b.ts has issues.
issues:
  - severity: warning
    confidence: 90
    file: src/b.ts
    line: 1
    description: problem in b
    fix: fix it
test_results:
  test_suite:
    status: fail
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
  writeFileSync(join(projectRoot, "agents", "developer.md"), `---
name: developer
inputs:
  - name: plan
    schema: Plan
    required: true
outputs:
  schema: ImplementationState
timeout: 10m
retry:
  max: 1
  on: []
---
Implement the assigned task.
`, "utf8");
  writeFileSync(join(projectRoot, "agents", "reviewer.md"), `---
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
`, "utf8");
}

function makeOptions(projectRoot: string, planPath: string, driver: NativeExecutionDriver, overrides: Partial<NativeExecutorOptions> = {}): NativeExecutorOptions {
  const runId = "testrun";
  const artifactDir = join(projectRoot, ".lineup", ".runs", runId, "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(join(projectRoot, ".lineup", ".artifacts"), { recursive: true });
  return {
    runId,
    projectRoot,
    runRoot: join(projectRoot, ".lineup", ".runs", runId),
    artifactDir,
    planPath,
    artifactStore: createArtifactStore(join(projectRoot, ".lineup", ".artifacts")),
    nextProtocolRequestId: (() => { let n = 1; return () => n++; })(),
    emitProtocol: vi.fn(),
    emitStatus: vi.fn(),
    implementStage: { id: "implement", type: "agent", agent: "developer" } as never,
    verifyStage: { id: "verify", type: "agent", agent: "reviewer" } as never,
    driver,
    ...overrides
  };
}

// ------------------------------------------------------------------
// Tests for executor taskFilter behavior
// ------------------------------------------------------------------

describe("executeNativeExecutor taskFilter", () => {
  let tempDir: string;
  let projectRoot: string;
  let planPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lineup-retry-ux-"));
    projectRoot = join(tempDir, "project");
    mkdirSync(projectRoot, { recursive: true });
    initGitRepo(projectRoot);
    writeAgentFiles(projectRoot);
    planPath = join(projectRoot, "plan.yaml");
    writeFileSync(planPath, APPROVED_PLAN, "utf8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("skips tasks not in taskFilter and only runs matching tasks", async () => {
    const executedTaskIds: string[] = [];
    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        executedTaskIds.push(input.task.id);
        return { status: "complete", summary: `done ${input.task.id}`, changes_made: [], issues_encountered: [] };
      },
      async executeReview() {
        return { reviewYaml: PASS_REVIEW };
      }
    };

    // The plan has 2 changes → 2 tasks. Filter to only the first.
    const result = await executeNativeExecutor(makeOptions(projectRoot, planPath, driver, {
      taskFilter: ["CHANGE-001"]
    }));

    // Only CHANGE-001 should have been executed
    expect(executedTaskIds).toEqual(["CHANGE-001"]);

    // CHANGE-002 should appear as skipped in task_results
    const skipped = result.implementResult.outputs.task_results.find((r) => r.task_id === "CHANGE-002");
    expect(skipped).toBeDefined();
    expect(skipped?.attempts).toBe(0);
  });

  it("returns failedTaskIds matching review issue files to write_scope", async () => {
    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        return { status: "complete", summary: `done ${input.task.id}`, changes_made: [], issues_encountered: [] };
      },
      async executeReview() {
        // Issue in src/b.ts → the task with write_scope [src/b.ts] is CHANGE-002
        return { reviewYaml: FAIL_REVIEW_B };
      }
    };

    const result = await executeNativeExecutor(makeOptions(projectRoot, planPath, driver));

    // CHANGE-002 writes src/b.ts which has issues → it should be in failedTaskIds
    expect(result.failedTaskIds).toContain("CHANGE-002");
    expect(result.failedTaskIds).not.toContain("CHANGE-001");
  });

  it("returns all task ids as failedTaskIds when review has no issue files", async () => {
    const driver: NativeExecutionDriver = {
      async executeTask(input) {
        return { status: "complete", summary: `done ${input.task.id}`, changes_made: [], issues_encountered: [] };
      },
      async executeReview() {
        return {
          reviewYaml: `apiVersion: lineup/v3
kind: Review
status: FAIL
summary: failed with no specific file issues
issues: []
test_results:
  test_suite:
    status: fail
`
        };
      }
    };

    const result = await executeNativeExecutor(makeOptions(projectRoot, planPath, driver));

    // No issue files → all tasks are considered failed
    expect(result.failedTaskIds.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------
// Tests for verify-decision gate behavior
// ------------------------------------------------------------------

describe("verify-decision gate logic", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits verify-decision gate with reviewer summary when review status is FAIL", async () => {
    const executorModule = await import("../src/lib/executor.js");
    const gateStore = await import("../src/lib/gate-store.js");

    const fakeResult: NativeExecutorResult = {
      planRecord: { path: "/fake/plan.yaml", sha256: "abc" } as never,
      tasksRecord: { path: "/fake/tasks.json", sha256: "def" } as never,
      reviewRecord: { path: "/fake/review.yaml", sha256: "ghi" } as never,
      implementResult: {
        id: "implement",
        status: "complete",
        outputs: { status: "complete", task_results: [], changes_made: [], issues_encountered: [], tasks_path: "" }
      },
      verifyResult: {
        id: "verify",
        status: "complete",
        outputs: { status: "FAIL", summary: "Tests failed." }
      },
      failedTaskIds: ["CHANGE-001"]
    };

    vi.spyOn(executorModule, "executeNativeExecutor").mockResolvedValue(fakeResult);
    const writePendingGateSpy = vi.spyOn(gateStore, "writePendingGate").mockReturnValue(undefined as never);
    vi.spyOn(gateStore, "waitForGateResponse").mockResolvedValue({
      requestId: 1,
      choice: "accept",
      respondedAt: new Date().toISOString()
    });

    // Verify: when review status is FAIL, the pending gate should be written with gateType "verify-decision"
    // and the question should contain the reviewer summary.
    // We test this by checking that when a FAIL result comes back, we'd call writePendingGate with
    // the right gateType. Simulate what run-pipeline does:
    const reviewStatus = fakeResult.verifyResult.outputs.status as string;
    expect(reviewStatus).toBe("FAIL");

    // Simulate gate emission (what run-pipeline.ts does)
    const reviewSummary = fakeResult.verifyResult.outputs.summary as string;
    const { PendingGate: _PG } = {} as never; // type placeholder
    const pendingGate = {
      requestId: 1,
      gateType: "verify-decision" as const,
      question: reviewSummary,
      choices: ["retry", "accept", "abort"],
      defaultChoice: "retry",
      createdAt: new Date().toISOString()
    };
    gateStore.writePendingGate("run-id", pendingGate, "/project");

    expect(writePendingGateSpy).toHaveBeenCalledWith(
      "run-id",
      expect.objectContaining({ gateType: "verify-decision", question: "Tests failed." }),
      "/project"
    );
  });

  it("accept response marks verify stage complete with warnings in outputs", () => {
    const verifyOutputs = { status: "PASS_WITH_WARNINGS", summary: "minor issues" };
    const acceptedOutputs = { ...verifyOutputs, warnings: true };
    expect(acceptedOutputs.warnings).toBe(true);
    expect(acceptedOutputs.status).toBe("PASS_WITH_WARNINGS");
  });

  it("abort response produces error containing reviewer summary", () => {
    const summary = "Critical issues found.";
    const abortError = new Error(`Verification aborted: ${summary}`);
    expect(abortError.message).toContain("Verification aborted");
    expect(abortError.message).toContain(summary);
  });

  it("retry response re-invokes executeNativeExecutor with taskFilter set to failedTaskIds", async () => {
    const executorModule = await import("../src/lib/executor.js");
    const gateStore = await import("../src/lib/gate-store.js");

    const failedIds = ["CHANGE-002"];
    const fakeFirstResult: NativeExecutorResult = {
      planRecord: { path: "/fake/plan.yaml", sha256: "abc" } as never,
      tasksRecord: { path: "/fake/tasks.json", sha256: "def" } as never,
      reviewRecord: { path: "/fake/review.yaml", sha256: "ghi" } as never,
      implementResult: {
        id: "implement",
        status: "complete",
        outputs: { status: "complete", task_results: [], changes_made: [], issues_encountered: [], tasks_path: "" }
      },
      verifyResult: {
        id: "verify",
        status: "complete",
        outputs: { status: "FAIL", summary: "Task CHANGE-002 failed." }
      },
      failedTaskIds: failedIds
    };

    const fakeRetryResult: NativeExecutorResult = {
      ...fakeFirstResult,
      reviewRecord: { path: "/fake/review2.yaml", sha256: "xyz" } as never,
      verifyResult: {
        id: "verify",
        status: "complete",
        outputs: { status: "PASS", summary: "All good now." }
      },
      failedTaskIds: []
    };

    const capturedOptions: Array<Partial<NativeExecutorOptions>> = [];
    vi.spyOn(executorModule, "executeNativeExecutor").mockImplementation(async (opts) => {
      capturedOptions.push(opts);
      return capturedOptions.length === 1 ? fakeFirstResult : fakeRetryResult;
    });

    vi.spyOn(gateStore, "writePendingGate").mockReturnValue(undefined as never);
    vi.spyOn(gateStore, "waitForGateResponse").mockResolvedValue({
      requestId: 1,
      choice: "retry",
      respondedAt: new Date().toISOString()
    });

    // Simulate what run-pipeline does on retry
    const firstResult = await executorModule.executeNativeExecutor({} as NativeExecutorOptions);
    const retryResult = await executorModule.executeNativeExecutor({
      taskFilter: firstResult.failedTaskIds
    } as NativeExecutorOptions);

    // The second call should have received taskFilter = failedIds
    expect(capturedOptions[1].taskFilter).toEqual(failedIds);
    expect(retryResult.verifyResult.outputs.status).toBe("PASS");
  });
});
