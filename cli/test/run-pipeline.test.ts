import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { execSync } from "node:child_process";

import type { NativeExecutionDriver } from "../src/lib/executor.js";
import type { LocalAgentRunner } from "../src/lib/agent-runner.js";

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

function writeWorkspaceChange(workspaceRoot: string, relativePath: string, marker: string): void {
  const targetPath = join(workspaceRoot, relativePath)
  mkdirSync(dirname(targetPath), { recursive: true })
  const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : ""
  const prefix = existing.length > 0 ? `${existing.replace(/\n*$/, "\n")}` : ""
  writeFileSync(targetPath, `${prefix}${marker}\n`, "utf8")
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

  it("collects triage stats in a non-git project without failing", async () => {
    const projectRoot = join(tempDir, "project-no-git");
    mkdirSync(projectRoot, { recursive: true });

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: triage-only
stages:
  - id: triage
    type: builtin
`);

    const { runPipeline } = await import("../src/lib/run-pipeline.js");
    const origCwd = process.cwd();
    process.chdir(projectRoot);

    try {
      const result = await runPipeline({
        workflow: workflowPath,
      });

      expect(result.status).toBe("success");
      expect(result.stageResults.get("triage")?.outputs).toMatchObject({
        changedFiles: 0,
        insertions: 0,
        deletions: 0,
        diffSummary: "Not a git repository."
      });
    } finally {
      process.chdir(origCwd);
    }
  });

  it("auto-classifies triage in human mode instead of prompting the user", async () => {
    const projectRoot = join(tempDir, "project-human-triage");
    mkdirSync(projectRoot, { recursive: true });

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: human-triage
stages:
  - id: triage
    type: builtin
    outputs:
      complexity:
        type: enum
        values: [simple, moderate, complex]
      affected_areas:
        type: list
        items:
          type: object
          properties:
            name: { type: string }
            coupled: { type: boolean }
      search_targets:
        type: list
        items:
          type: object
          properties:
            area: { type: string }
            targets: { type: list, items: { type: string } }
      independent_areas:
        type: list
        items:
          type: list
          items: { type: string }
`);

    const { runPipeline } = await import("../src/lib/run-pipeline.js");
    const origCwd = process.cwd();
    process.chdir(projectRoot);

    try {
      const result = await runPipeline({
        workflow: workflowPath,
        mode: "human",
      });

      expect(result.status).toBe("success");
      expect(result.stageResults.get("triage")?.outputs).toMatchObject({
        complexity: "moderate",
        affected_areas: [],
        search_targets: [],
        independent_areas: []
      });
    } finally {
      process.chdir(origCwd);
    }
  });

  it("emits structured human stage headers to stderr in human mode", async () => {
    const projectRoot = join(tempDir, "project-human-render");
    mkdirSync(projectRoot, { recursive: true });

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: human-render
stages:
  - id: triage
    type: builtin
    description: "Classify the task before planning."
`);

    const stderr: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });

    const { runPipeline } = await import("../src/lib/run-pipeline.js");
    const origCwd = process.cwd();
    process.chdir(projectRoot);

    try {
      const result = await runPipeline({
        workflow: workflowPath,
        mode: "human",
      });

      expect(result.status).toBe("success");
      const output = stderr.join("");
      expect(output).toContain("Stage 1/1 | Triage | Classify the task before planning.");
      expect(output).toContain("Pipeline completed successfully.");
    } finally {
      stderrSpy.mockRestore();
      process.chdir(origCwd);
    }
  });

  it("pauses and resumes the human TUI around interactive gates", async () => {
    const projectRoot = join(tempDir, "project-human-gate");
    mkdirSync(projectRoot, { recursive: true });

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: human-gate
stages:
  - id: clarify
    type: builtin
    description: "Ask for clarification before continuing."
`);

    const gateModule = await import("../src/lib/interactive-gate.js");
    const runtimeUiModule = await import("../src/lib/ui/runtime-screen.js");
    const handleGateSpy = vi.spyOn(gateModule, "handleInteractiveGate").mockImplementation(async (_gate, hooks = {}) => {
      await hooks.onPromptStart?.();
      await hooks.onPromptEnd?.();
      return {
        requestId: 1,
        choice: "No clarification needed",
        respondedAt: new Date().toISOString()
      };
    });
    const pauseSpy = vi.spyOn(runtimeUiModule.HumanRunRenderer.prototype, "pause").mockResolvedValue();
    const resumeSpy = vi.spyOn(runtimeUiModule.HumanRunRenderer.prototype, "resume").mockResolvedValue();

    const { runPipeline } = await import("../src/lib/run-pipeline.js");
    const origCwd = process.cwd();
    process.chdir(projectRoot);

    try {
      const result = await runPipeline({
        workflow: workflowPath,
        mode: "human",
      });

      expect(result.status).toBe("success");
      expect(handleGateSpy).toHaveBeenCalledTimes(1);
      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(resumeSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("fails fast with a clear message when native execution is launched outside git", async () => {
    const projectRoot = join(tempDir, "project-requires-git");
    mkdirSync(projectRoot, { recursive: true });

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: native-pipeline
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

    const { runPipeline } = await import("../src/lib/run-pipeline.js");
    const origCwd = process.cwd();
    process.chdir(projectRoot);

    try {
      await expect(
        runPipeline({
          workflow: workflowPath,
          approvePlan: true
        })
      ).rejects.toThrow("Native Lineup execution requires a git repository");
    } finally {
      process.chdir(origCwd);
    }
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
        const changedFile = input.task.write_scope?.[0] ?? "README.md"
        writeWorkspaceChange(input.workspaceRoot, changedFile, `updated ${input.task.id}`)
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
      ).rejects.toThrow(/lineup logs failrun/);

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
      await expect(runPipeline({ workflow: workflowPath })).rejects.toThrow(
        /lineup show other[\s\S]*lineup cancel other/
      );
    } finally {
      process.chdir(origCwd);
    }
  });

  it("waits for a host-written plan artifact in host mode", async () => {
    const projectRoot = join(tempDir, "project-host-plan");
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
`);

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      setTimeout(() => {
        writeFileSync(
          join(projectRoot, ".lineup", ".runs", "host01", "artifacts", "plan.yaml"),
          [
            "```json",
            JSON.stringify({
              apiVersion: "lineup/v3",
              kind: "Plan",
              status: "approved",
              summary: "Add a host-written plan",
              approaches: [
                { name: "Native", strategy: "Write the plan artifact directly" }
              ],
              recommendation: {
                approach: "Native",
                rationale: "Matches the host protocol contract"
              },
              changes: [
                {
                  file: "README.md",
                  change: "Document the host flow",
                  rationale: "Exercise the planner handoff"
                }
              ],
              acceptance_criteria: [
                { criterion: "Planner artifact is persisted" }
              ],
              risks: [
                {
                  risk: "Hosts may emit fenced JSON",
                  mitigation: "Repair and normalize before validation"
                }
              ]
            }, null, 2),
            "```"
          ].join("\n"),
          "utf8"
        );
      }, 50);

      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "host"
        },
        {
          runId: "host01"
        }
      );

      expect(result.status).toBe("success");
      expect(readFileSync(join(projectRoot, ".lineup", ".runs", "host01", "artifacts", "plan.yaml"), "utf8")).toContain("kind: Plan");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("includes the generated plan content in the plan-approval gate context", async () => {
    const projectRoot = join(tempDir, "project-host-plan-approval-context");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: host-plan-approval-context
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
`);

    const { runPipeline } = await import("../src/lib/run-pipeline.js");
    const { waitForPendingGate, writeGateResponse } = await import("../src/lib/gate-store.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      setTimeout(() => {
        writeFileSync(
          join(projectRoot, ".lineup", ".runs", "hpactx", "artifacts", "plan.yaml"),
          APPROVED_PLAN,
          "utf8"
        );
      }, 50);

      const gateResponseTask = (async () => {
        const gate = await waitForPendingGate(
          "hpactx",
          projectRoot,
          2_000,
          (entry) => entry.stageId === "plan-approval" && entry.gateType === "approval"
        );
        expect(gate).not.toBeNull();
        expect(gate.question).toBe("Approve the generated plan?");
        expect(gate.context).toContain("Plan artifact:");
        expect(gate.context).toContain("kind: Plan");
        expect(gate.context).toContain("summary: Integrate native executor");
        writeGateResponse(
          "hpactx",
          {
            requestId: gate.requestId,
            choice: "approve",
            respondedAt: new Date().toISOString()
          },
          projectRoot
        );
      })();

      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "host"
        },
        {
          runId: "hpactx"
        }
      );

      await gateResponseTask;
      expect(result.status).toBe("success");
      expect(result.stageResults.get("plan-approval")?.outputs).toMatchObject({ approved: true });
    } finally {
      process.chdir(origCwd);
    }
  });

  it("uses default researcher outputs when the workflow omits an explicit output schema", async () => {
    const projectRoot = join(tempDir, "project-host-research");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: research-only
stages:
  - id: research
    type: agent
    agent: researcher
`);

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      setTimeout(() => {
        writeFileSync(
          join(projectRoot, ".lineup", ".runs", "hostrs", "artifacts", "research.yaml"),
          `type: research
agent: researcher
date: 2026-04-13
topic: host research handoff
status: complete
pipeline_stage: research
what_found:
  modules:
    - src/app.ts
how_it_works: Reads the generated artifact.
constraints:
  git: required
gaps:
  follow_up: []
`,
          "utf8"
        );
      }, 50);

      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "host"
        },
        {
          runId: "hostrs"
        }
      );

      expect(result.status).toBe("success");
      expect(result.stageResults.get("research")?.outputs).toMatchObject({
        how_it_works: "Reads the generated artifact."
      });
      expect(String(result.stageResults.get("research")?.outputs.artifactPath)).toContain("/.lineup/.runs/hostrs/artifacts/research.yaml");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("retries planner output when the draft plan uses string changes instead of change objects", async () => {
    const projectRoot = join(tempDir, "project-plan-retry-invalid-changes");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: plan-retry-invalid-changes
stages:
  - id: triage
    type: builtin
  - id: plan
    type: agent
    agent: architect
    depends_on: [triage]
`);

    const prompts: string[] = [];
    let attempt = 0;
    const localAgentRunner: LocalAgentRunner = {
      host: "claude",
      async invoke(input) {
        if (input.agent !== "architect") {
          throw new Error(`Unexpected agent ${input.agent}`);
        }

        prompts.push(input.prompt);
        attempt += 1;
        if (attempt === 1) {
          return {
            host: "claude",
            stderr: "",
            content: `summary: Update README.md for the smoke run
approaches:
  - name: Direct update
    description: Replace the placeholder once in README.md
changes:
  - Update README.md to replace REPLACE_ME_VALIDATE_OLLAMA_HOST_EXECUTION with This repo validates Ollama host execution.
acceptance_criteria:
  - README.md contains the validation sentence exactly once
risks:
  - risk: Minimal repo context may lead to shorthand output
    mitigation: Retry with stricter schema instructions
`
          };
        }

        return {
          host: "claude",
          stderr: "",
          content: APPROVED_PLAN
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Replace the README placeholder once."
        },
        {
          runId: "plnrt1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("The payload must be a valid lineup/v3 Plan.");
      expect(prompts[1]).toContain("Include a non-empty `changes` array of objects. Each change object must include `file`, `change`, and `rationale`.");
      expect(prompts[1]).toContain("Every `changes[].file` value must be a repo-relative path");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("normalizes planner drafts that use string risks into a schema-valid plan", async () => {
    const projectRoot = join(tempDir, "project-plan-normalize-string-risks");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: plan-normalize-string-risks
stages:
  - id: triage
    type: builtin
  - id: plan
    type: agent
    agent: architect
    depends_on: [triage]
`);

    const localAgentRunner: LocalAgentRunner = {
      host: "claude",
      async invoke() {
        return {
          host: "claude",
          stderr: "",
          content: `summary: Update the smoke repo files
approaches:
  - name: Minimal
    description: Update the README and keep the repo tiny
recommendation: Use the minimal approach
changes:
  - file: README.md
    change: Replace the smoke placeholder with the validation sentence
    rationale: README.md is the only file that must change for the smoke task
acceptance_criteria:
  - README.md contains the validation sentence exactly once
risks:
  - The placeholder text might not match exactly
  - The smoke repo might already contain the replacement
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Replace the README placeholder once."
        },
        {
          runId: "plnrk1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      const planPath = String(result.stageResults.get("plan")?.outputs.planPath);
      const planArtifact = readFileSync(planPath, "utf8");
      expect(planArtifact).toContain("risk: The placeholder text might not match exactly");
      expect(planArtifact).toContain("mitigation: Address during implementation review.");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("normalizes planner drafts that use absolute temp paths into repo-relative changes", async () => {
    const projectRoot = join(tempDir, "project-plan-normalize-absolute-paths");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);
    mkdirSync(join(projectRoot, ".lineup-core", "workflows"), { recursive: true });
    writeFileSync(join(projectRoot, ".lineup-core", "workflows", "full-pipeline.yaml"), "name: noop\n", "utf8");
    mkdirSync(join(projectRoot, ".lineup", "tactics"), { recursive: true });
    writeFileSync(join(projectRoot, ".lineup", "tactics", "example.yaml"), "name: example\n", "utf8");

    const { normalizePlanForStage } = await import("../src/lib/executor.js");

    const normalized = normalizePlanForStage(
      `summary: Update the smoke repo files
approaches:
  - name: Minimal
    strategy: Update the existing smoke inputs directly
recommendation:
  approach: Minimal
  rationale: Keep the change surface tiny
changes:
  - file: /private/var/folders/test/lineup-claude-cwd-123/README.md
    change: Replace the smoke placeholder with the validation sentence
    rationale: README.md is the only file that must change for the smoke task
  - file: /private/var/folders/test/lineup-claude-cwd-123/.lineup/tactics/example.yaml
    change: Keep the tactic aligned with the smoke behavior
    rationale: The tactic file already exists in the repo inputs
acceptance_criteria:
  - criterion: README.md contains the validation sentence exactly once
risks:
  - risk: The placeholder text might not match exactly
    mitigation: Inspect README.md before editing
`,
      join(projectRoot, ".lineup", ".runs", "plan.yaml"),
      projectRoot
    );

    expect(normalized).toContain("file: README.md");
    expect(normalized).toContain("file: .lineup/tactics/example.yaml");
    expect(normalized).not.toContain("/private/var/folders/test/lineup-claude-cwd-123");
  });

  it("normalizes planner drafts that use humanized change keys into schema-valid changes", async () => {
    const projectRoot = join(tempDir, "project-plan-normalize-humanized-keys");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const { normalizePlanForStage } = await import("../src/lib/executor.js");

    const normalized = normalizePlanForStage(
      `summary: Replace the README placeholder for direct-host validation
approaches:
  - Approach 1 (Minimal Changes): Direct replacement of the placeholder text with no additional modifications
recommendation: Approach 1 is recommended as it's the simplest and most direct implementation.
changes:
  - File path: README.md
    What to change: Replace 'REPLACE_ME_VALIDATE_DIRECT_HOST_EXECUTION' with 'This repo validates direct host execution.'
    Why this change is needed: This is the explicit requirement for the direct-host certification validation task
acceptance_criteria:
  - README.md contains 'This repo validates direct host execution.'
risks:
  - Content accidentally truncated during edit
`,
      join(projectRoot, ".lineup", ".runs", "plan.yaml"),
      projectRoot
    );

    expect(normalized).toContain("file: README.md");
    expect(normalized).toContain("change: Replace 'REPLACE_ME_VALIDATE_DIRECT_HOST_EXECUTION'");
    expect(normalized).toMatch(
      /rationale: This is the explicit requirement for the direct-host certification[\s\S]*validation task/
    );
  });

  it("normalizes planner drafts that use plain scalars with embedded colons", async () => {
    const projectRoot = join(tempDir, "project-plan-normalize-colon-scalars");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const { normalizePlanForStage } = await import("../src/lib/executor.js");

    const normalized = normalizePlanForStage(
      `summary: Replace the README placeholder for direct-host validation
approaches:
  - strategy: Minimal replacement: update the placeholder in place
recommendation: I recommend Approach 1: direct replacement because the repo is tiny and the task is bounded.
changes:
  - File path: README.md
    What to change: Replace 'REPLACE_ME_VALIDATE_DIRECT_HOST_EXECUTION' with 'This repo validates direct host execution.'
    Why this change is needed: This is the explicit requirement for the direct-host certification validation task
acceptance_criteria:
  - README.md contains 'This repo validates direct host execution.'
risks:
  - Content accidentally truncated during edit
`,
      join(projectRoot, ".lineup", ".runs", "plan.yaml"),
      projectRoot
    );

    expect(normalized).toContain('strategy: "Minimal replacement: update the placeholder in place"');
    expect(normalized).toMatch(
      /rationale: "I recommend Approach 1: direct replacement because the repo is tiny[\s\S]*and the task is bounded\."/
    );
    expect(normalized).toContain("file: README.md");
  });

  it("normalizes array-shaped research findings into a structured what_found object", async () => {
    const projectRoot = join(tempDir, "project-host-research-array");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: research-array
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      setTimeout(() => {
        writeFileSync(
          join(projectRoot, ".lineup", ".runs", "hostra", "artifacts", "research.yaml"),
          `type: research
agent: researcher
date: 2026-04-15
topic: host research handoff
status: complete
pipeline_stage: research
what_found:
  - path: cli/src/lib/run-pipeline.ts
    content: Normalizes malformed research artifacts into structured objects.
  - path: cli/test/run-pipeline.test.ts
    content: Proves array-shaped findings recover into key_files entries.
how_it_works: Reads the generated artifact.
constraints:
  git: required
gaps:
  follow_up: []
`,
          "utf8"
        );
      }, 50);

      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "host"
        },
        {
          runId: "hostra"
        }
      );

      expect(result.status).toBe("success");
      expect(result.stageResults.get("research")?.outputs).toMatchObject({
        what_found: {
          key_files: [
            {
              path: "cli/src/lib/run-pipeline.ts",
              description: "Normalizes malformed research artifacts into structured objects."
            },
            {
              path: "cli/test/run-pipeline.test.ts",
              description: "Proves array-shaped findings recover into key_files entries."
            }
          ]
        },
        how_it_works: "Reads the generated artifact."
      });
      const artifact = String(result.stageResults.get("research")?.outputs.artifactPath);
      expect(readFileSync(artifact, "utf8")).toContain("key_files:");
      expect(readFileSync(artifact, "utf8")).not.toContain("content:");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("repairs colon-heavy research summaries into a valid YAML scalar without retrying", async () => {
    const projectRoot = join(tempDir, "project-research-colon-scalar");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: research-colon-scalar
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    let attempts = 0;
    const localAgentRunner: LocalAgentRunner = {
      host: "codex",
      async invoke(input) {
        attempts += 1;
        const content = `what_found:
  files:
    - README.md
    - .lineup-core/workflows/full-pipeline.yaml
how_it_works: The Lineup smoke pipeline is defined by a workflow that consists of multiple stages: triage, research, plan, plan-approval, implement, and verify.
constraints:
  dependencies:
    - Workflow file must exist at .lineup-core/workflows/full-pipeline.yaml
gaps:
  pending: []
`;

        if (input.expectedOutputPath) {
          writeFileSync(input.expectedOutputPath, content, "utf8");
        }

        return {
          host: "codex",
          stderr: "",
          content
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Inspect the workspace"
        },
        {
          runId: "rscln1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(attempts).toBe(1);
      expect(result.stageResults.get("research")?.outputs).toMatchObject({
        how_it_works:
          "The Lineup smoke pipeline is defined by a workflow that consists of multiple stages: triage, research, plan, plan-approval, implement, and verify."
      });
    } finally {
      process.chdir(origCwd);
    }
  });

  it("runs plan, implement, and verify through the local human agent runner", async () => {
    const projectRoot = join(tempDir, "project-human-runner");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: human-pipeline
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
  - id: plan
    type: agent
    agent: architect
    depends_on: [research]
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

    const capturedPrompts: Array<{ agent: string; prompt: string }> = [];
    const capturedInvocations: Array<{
      agent: string;
      projectRoot: string;
      workingDirectory: string;
      outputSchemaPath?: string;
    }> = [];
    const canonicalProjectRoot = realpathSync(projectRoot);

    const localAgentRunner: LocalAgentRunner = {
      host: "claude",
      async invoke(input) {
        capturedPrompts.push({ agent: input.agent, prompt: input.prompt });
        capturedInvocations.push({
          agent: input.agent,
          projectRoot: input.projectRoot,
          workingDirectory: input.workingDirectory,
          outputSchemaPath: input.outputSchemaPath
        });
        if (input.agent === "researcher") {
          return {
            host: "claude",
            stderr: "",
            content: `type: research
agent: researcher
date: 2026-04-13
topic: test
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: Captured by the local runner.
constraints:
  tooling: local
gaps:
  pending: []
`
          };
        }

        if (input.agent === "architect") {
          return {
            host: "claude",
            stderr: "",
            content: APPROVED_PLAN
          };
        }

        if (input.agent === "developer") {
          writeWorkspaceChange(input.workingDirectory, "cli/src/lib/executor.ts", "export const implementedThroughRunner = true")
          return {
            host: "claude",
            stderr: "",
            content: JSON.stringify({
              status: "complete",
              summary: "implemented the requested change",
              changes_made: [
                {
                  file: "cli/src/lib/executor.ts",
                  description: "updated executor",
                  task_id: "CHANGE-001"
                }
              ],
              issues_encountered: []
            })
          };
        }

        return {
          host: "claude",
          stderr: "",
          content: REVIEW_YAML
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          approvePlan: true,
          prompt: "Add a site folder"
        },
        {
          runId: "human1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(result.stageResults.get("research")?.outputs).toMatchObject({
        how_it_works: "Captured by the local runner."
      });
      expect(capturedPrompts.find((entry) => entry.agent === "researcher")?.prompt).not.toContain("Create or overwrite");
      expect(capturedPrompts.find((entry) => entry.agent === "architect")?.prompt).not.toContain("Create or overwrite");
      expect(result.stageResults.get("plan")?.outputs).toHaveProperty("planPath");
      expect(result.stageResults.get("implement")?.outputs).toHaveProperty("task_results");
      expect(result.stageResults.get("verify")?.outputs).toHaveProperty("status", "PASS");
      expect(capturedInvocations.find((entry) => entry.agent === "researcher")).toMatchObject({
        projectRoot: canonicalProjectRoot,
        workingDirectory: canonicalProjectRoot
      });
      expect(capturedInvocations.find((entry) => entry.agent === "architect")).toMatchObject({
        projectRoot: canonicalProjectRoot,
        workingDirectory: canonicalProjectRoot
      });

      const developerInvocation = capturedInvocations.find((entry) => entry.agent === "developer");
      expect(developerInvocation).toBeDefined();
      expect(developerInvocation?.projectRoot).toBe(developerInvocation?.workingDirectory);
      expect(developerInvocation?.projectRoot).not.toBe(canonicalProjectRoot);
      expect(developerInvocation?.outputSchemaPath).toContain("/schemas/json/implementation-state.schema.json");

      const reviewerInvocation = capturedInvocations.find((entry) => entry.agent === "reviewer");
      expect(reviewerInvocation).toBeDefined();
      expect(reviewerInvocation?.projectRoot).toBe(reviewerInvocation?.workingDirectory);
      expect(reviewerInvocation?.projectRoot).not.toBe(canonicalProjectRoot);
      expect(reviewerInvocation?.outputSchemaPath).toContain("/schemas/yaml/v3/review.schema.json");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("includes file-reference stage inputs in downstream prompts", async () => {
    const projectRoot = join(tempDir, "project-file-reference-context");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: file-reference-context
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
  - id: plan
    type: agent
    agent: architect
    depends_on: [research]
    inputs:
      - source: research
        fields: [what_found, constraints]
        via: file-reference
`);

    const capturedPrompts: Array<{ agent: string; prompt: string }> = [];
    const localAgentRunner: LocalAgentRunner = {
      host: "claude",
      async invoke(input) {
        capturedPrompts.push({ agent: input.agent, prompt: input.prompt });
        if (input.agent === "researcher") {
          return {
            host: "claude",
            stderr: "",
            content: `type: research
agent: researcher
date: 2026-04-15
topic: file-reference
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: Captured by the local runner.
constraints:
  tooling: local
gaps:
  pending: []
`
          };
        }

        return {
          host: "claude",
          stderr: "",
          content: APPROVED_PLAN
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Plan with file references"
        },
        {
          runId: "filrf1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      const architectPrompt = capturedPrompts.find((entry) => entry.agent === "architect")?.prompt ?? "";
      expect(architectPrompt).toContain("research:");
      expect(architectPrompt).toContain("Read artifact:");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("uses a compact stage contract for Ollama host-integration prompts", async () => {
    const projectRoot = join(tempDir, "project-compact-ollama-prompts");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);
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

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: compact-ollama-prompts
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
  - id: plan
    type: agent
    agent: architect
    depends_on: [research]
`);

    const capturedPrompts: Array<{ agent: string; prompt: string }> = [];
    const localAgentRunner: LocalAgentRunner = {
      host: "claude",
      async invoke(input) {
        capturedPrompts.push({ agent: input.agent, prompt: input.prompt });
        if (input.agent === "researcher") {
          return {
            host: "claude",
            stderr: "",
            content: `type: research
agent: researcher
date: 2026-04-15
topic: compact
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: Compact prompt path.
constraints:
  host: claude
gaps:
  pending: []
`
          };
        }

        return {
          host: "claude",
          stderr: "",
          content: APPROVED_PLAN
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Replace the README placeholder once."
        },
        {
          runId: "cmpct1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      const researchPrompt = capturedPrompts.find((entry) => entry.agent === "researcher")?.prompt ?? "";
      const planPrompt = capturedPrompts.find((entry) => entry.agent === "architect")?.prompt ?? "";
      for (const prompt of [researchPrompt, planPrompt]) {
        expect(prompt).toContain("Lineup stage:");
        expect(prompt).toContain("Return only the final structured payload with no wrapper prose or markdown.");
        expect(prompt).not.toContain("Stage description:");
        expect(prompt).not.toContain("Expected fields:");
        expect(prompt).not.toContain("Create or overwrite");
        expect(prompt).not.toContain("Follow this output template shape exactly.");
      }
      expect(planPrompt).toContain("Required fields: summary, approaches, recommendation, changes (non-empty array of {file, change, rationale}), acceptance_criteria, risks");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("runs the bundled explain tactic outside the lineup repo", async () => {
    const projectRoot = join(tempDir, "project-explain-tactic");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const localAgentRunner: LocalAgentRunner = {
      host: "codex",
      async invoke(input) {
        if (input.agent === "researcher") {
          return {
            host: "codex",
            stderr: "",
            content: `type: research
agent: researcher
date: 2026-04-13
topic: explain-tactic
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: The bundled explain tactic resolved successfully.
constraints:
  tooling: local
gaps:
  pending: []
`
          };
        }

        if (input.agent === "teacher") {
          return {
            host: "codex",
            stderr: "",
            content: `type: explanation
agent: teacher
date: 2026-04-13
topic: explain-tactic
status: complete
pipeline_stage: explain
learning_objectives:
  - Understand bundled tactic resolution.
prerequisites: []
explanation:
  overview: |
    The bundled explain tactic resolved successfully.
  sections:
    - title: Resolution
      content: |
        The CLI found the built-in explain tactic without requiring a repo-local tactics directory.
      code_examples: []
      key_takeaways:
        - Bundled tactics are available outside the lineup repo.
further_exploration: []
`
          };
        }

        return {
          host: "codex",
          stderr: "",
          content: REVIEW_YAML
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          tactic: "explain",
          mode: "human",
          prompt: "Explain tactic resolution"
        },
        {
          runId: "expln1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(String(result.stageResults.get("research")?.outputs.artifactPath)).toContain("/.lineup/.runs/expln1/artifacts/research.yaml");
      expect(readFileSync(String(result.stageResults.get("research")?.outputs.artifactPath), "utf8")).toContain(
        "The bundled explain tactic resolved successfully."
      );
      expect(result.stageResults.get("explain")?.outputs).toHaveProperty("artifactPath");
      const explainArtifact = String(result.stageResults.get("explain")?.outputs.artifactPath);
      expect(explainArtifact).toContain("/.lineup/.runs/expln1/artifacts/explain.yaml");
      const explainYaml = readFileSync(explainArtifact, "utf8");
      expect(explainYaml).toContain("learning_objectives:");
      expect(explainYaml).toContain("further_exploration:");
      expect(explainYaml).not.toContain("raw_output:");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("normalizes prose developer task summaries through the local native driver", async () => {
    const projectRoot = join(tempDir, "project-human-runner-prose");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: human-prose
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
  - id: plan
    type: agent
    agent: architect
  - id: implement
    type: agent
    agent: developer
  - id: verify
    type: agent
    agent: reviewer
`);

    const localAgentRunner: LocalAgentRunner = {
      host: "codex",
      async invoke(input) {
        if (input.agent === "researcher") {
          return {
            host: "codex",
            stderr: "",
            content: `type: research
agent: researcher
date: 2026-04-15
topic: prose-task
status: complete
pipeline_stage: research
what_found: {}
how_it_works: Research completed through the local runner.
constraints: {}
gaps: {}
`
          };
        }

        if (input.agent === "architect") {
          return {
            host: "codex",
            stderr: "",
            content: APPROVED_PLAN
          };
        }

        if (input.agent === "developer") {
          return {
            host: "codex",
            stderr: "",
            content: `I reviewed the requested task and updated the workspace accordingly.

**Changes made:** None

**Issues encountered:** None

**Verification results:** The requested condition was already satisfied.`
          };
        }

        return {
          host: "codex",
          stderr: "",
          content: REVIEW_YAML
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Make the deterministic README update"
        },
        {
          runId: "humpr1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(result.stageResults.get("implement")?.outputs).toHaveProperty("task_results");
      expect(result.stageResults.get("verify")?.outputs).toHaveProperty("status", "PASS");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("rewrites OpenCode stage prompts to use lower-case tool names", async () => {
    const projectRoot = join(tempDir, "project-opencode-prompt");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: opencode-pipeline
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
  - id: review
    type: agent
    agent: reviewer
    depends_on: [research]
`);

    const capturedPrompts: Array<{ agent: string; prompt: string }> = [];

    const localAgentRunner: LocalAgentRunner = {
      host: "opencode",
      async invoke(input) {
        capturedPrompts.push({ agent: input.agent, prompt: input.prompt });
        if (input.agent === "researcher") {
          return {
            host: "opencode",
            stderr: "",
            content: `type: research
agent: researcher
date: 2026-04-13
topic: prompt-dialect
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: Captured by the OpenCode runner.
constraints:
  tooling: local
gaps:
  pending: []
`
          };
        }

        return {
          host: "opencode",
          stderr: "",
          content: `type: review
agent: reviewer
date: 2026-04-13
topic: prompt-dialect
status: PASS
pipeline_stage: review
plan_ref: none
summary: Prompt dialect normalization succeeded.
issues: []
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Inspect the workspace"
        },
        {
          runId: "opn001",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      const researchPrompt = capturedPrompts.find((entry) => entry.agent === "researcher")?.prompt ?? "";
      const reviewPrompt = capturedPrompts.find((entry) => entry.agent === "reviewer")?.prompt ?? "";
      for (const prompt of [researchPrompt, reviewPrompt]) {
        expect(prompt).toContain("bash");
        expect(prompt).toContain("glob");
        expect(prompt).toContain("read");
        expect(prompt).toContain("grep");
        expect(prompt).toContain("webfetch");
        expect(prompt).toContain("Do not call `task` or `skill` for normal Lineup stages.");
        expect(prompt).not.toMatch(/\bLS\b/);
        expect(prompt).not.toMatch(/\bRead\b/);
        expect(prompt).not.toMatch(/\bGrep\b/);
        expect(prompt).not.toMatch(/\bGlob\b/);
        expect(prompt).not.toMatch(/\bWebSearch\b/);
        expect(prompt).not.toMatch(/\bBash\b/);
      }
      expect(researchPrompt).toContain("Gather files with `bash` and `glob`");
      expect(reviewPrompt).toContain("Review changes by inspecting the relevant files with `read`");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("makes OpenCode researcher retries demand exactly one YAML Research document", async () => {
    const projectRoot = join(tempDir, "project-opencode-research-retry");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: opencode-research-retry
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    const prompts: string[] = [];
    let attempt = 0;

    const localAgentRunner: LocalAgentRunner = {
      host: "opencode",
      async invoke(input) {
        prompts.push(input.prompt);
        attempt += 1;
        if (attempt === 1) {
          return {
            host: "opencode",
            stderr: "",
            content: `Here is the research result.\n\`\`\`yaml\ntype: research\nagent: researcher\n---\ntype: research\nagent: researcher\n\`\`\``
          };
        }

        return {
          host: "opencode",
          stderr: "",
          content: `type: research
agent: researcher
date: 2026-04-14
topic: retry
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: The retry prompt produced one clean YAML Research document.
constraints:
  host: opencode
gaps:
  pending: []
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Inspect the workspace"
        },
        {
          runId: "opn002",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain("OpenCode research contract:");
      expect(prompts[0]).toContain("Emit exactly one YAML Research document.");
      expect(prompts[0]).toContain("Do not wrap the response in markdown, prose, code fences, or commentary.");
      expect(prompts[0]).toContain("This research stage is read-only. Never call `edit`, `write`, or mutating `bash` commands.");
      expect(prompts[0]).toContain("Do not make the requested code change during research. Only inspect and report.");
      expect(prompts[0]).toContain("`what_found`, `constraints`, and `gaps` must be YAML mappings.");
      expect(prompts[0]).toContain("When reusing file contents in a later `edit`, copy only the raw file text");
      expect(prompts[1]).toContain("Previous output was invalid because it did not produce exactly one YAML Research document.");
      expect(prompts[1]).toContain("Rewrite the same facts into one YAML document only.");
      expect(prompts[1]).toContain("Do not add markdown, prose, code fences, bullet lists, or extra wrapper text.");
      expect(prompts[1]).toContain("Do not call edit, write, or mutating bash commands while retrying this research stage.");
      expect(prompts[1]).toContain("what_found: {}");
      expect(prompts[1]).toContain("constraints: {}");
      expect(prompts[1]).toContain("gaps: {}");
      expect(prompts[1]).toContain("Use the declared Research schema fields exactly once and keep the payload directly parseable.");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("extends local agent stage timeouts when true Ollama host integration is enabled", async () => {
    const projectRoot = join(tempDir, "project-ollama-host-timeout");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    mkdirSync(join(projectRoot, ".lineup"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".lineup", "config.yaml"),
      `ollama:\n  enabled: true\n  model: qwen3-coder:30b\n  scope: research\n  host_integration:\n    enabled: true\n    strategy: auto\n`,
      "utf8"
    );

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: ollama-timeout
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    const seenTimeouts: number[] = [];
    const localAgentRunner: LocalAgentRunner = {
      host: "claude",
      async invoke(input) {
        seenTimeouts.push(input.timeoutMs ?? 0);
        return {
          host: "claude",
          stderr: "",
          content: `type: research
agent: researcher
date: 2026-04-15
topic: ollama timeout
status: complete
pipeline_stage: research
what_found: {}
how_it_works: Timeout is extended for true Ollama host integration.
constraints: {}
gaps: {}
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human"
        },
        {
          runId: "oltm01",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(seenTimeouts).toEqual([600_000]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("uses the explicit timeout option for local agent stages", async () => {
    const projectRoot = join(tempDir, "project-explicit-host-timeout");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: explicit-host-timeout
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    const seenTimeouts: number[] = [];
    const localAgentRunner: LocalAgentRunner = {
      host: "codex",
      async invoke(input) {
        seenTimeouts.push(input.timeoutMs ?? 0);
        return {
          host: "codex",
          stderr: "",
          content: `type: research
agent: researcher
date: 2026-04-15
topic: explicit timeout
status: complete
pipeline_stage: research
what_found: {}
how_it_works: Explicit timeout hints override the default local agent timeout.
constraints: {}
gaps: {}
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          timeout: 45
        },
        {
          runId: "expt45",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(seenTimeouts).toEqual([45_000]);
    } finally {
      process.chdir(origCwd);
    }
  });

  it("retries researcher stages when the first response is non-structured", async () => {
    const projectRoot = join(tempDir, "project-research-retry");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: research-retry
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    const prompts: string[] = [];
    let attempt = 0;

    const localAgentRunner: LocalAgentRunner = {
      host: "opencode",
      async invoke(input) {
        prompts.push(input.prompt);
        attempt += 1;
        if (attempt === 1) {
          return {
            host: "opencode",
            stderr: "",
            content: `---
# Research Findings

## Overview
This is useful context, but it is not valid lineup YAML.
`
          };
        }

        return {
          host: "opencode",
          stderr: "",
          content: `type: research
agent: researcher
date: 2026-04-14
topic: retry
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: Retry converted the draft into valid YAML.
constraints:
  host: opencode
gaps:
  pending: []
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Inspect the workspace"
        },
        {
          runId: "rsrch1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("OpenCode research contract:");
      expect(prompts[1]).toContain("Emit exactly one YAML Research document.");
      expect(prompts[1]).toContain("Do not make the requested code change during research. Only inspect and report.");
      expect(prompts[1]).toContain("Previous output was invalid because it did not produce exactly one YAML Research document.");
      expect(prompts[1]).toContain("Do not add markdown, prose, code fences, bullet lists, or extra wrapper text.");
      expect(prompts[1]).toContain("Do not call edit, write, or mutating bash commands while retrying this research stage.");
      expect(String(result.stageResults.get("research")?.outputs.artifactPath)).toContain("/.lineup/.runs/rsrch1/artifacts/research.yaml");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("normalizes scalar and list research fields into schema-valid objects", async () => {
    const projectRoot = join(tempDir, "project-research-normalization");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: research-normalization
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    const localAgentRunner: LocalAgentRunner = {
      host: "claude",
      async invoke() {
        return {
          host: "claude",
          stderr: "",
          content: `what_found:
  files:
    - README.md
how_it_works: The research payload was normalized.
constraints:
  - README.md must change
  - Only one sentence should be added
gaps: none
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Inspect the workspace"
        },
        {
          runId: "rsnorm1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(result.stageResults.get("research")?.outputs).toMatchObject({
        constraints: {
          items: ["README.md must change", "Only one sentence should be added"]
        },
        gaps: {
          note: "none"
        }
      });
    } finally {
      process.chdir(origCwd);
    }
  });

  it("normalizes string-array what_found into a schema-valid object with metadata", async () => {
    const projectRoot = join(tempDir, "project-research-string-array");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: research-string-array
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    const localAgentRunner: LocalAgentRunner = {
      host: "claude",
      async invoke() {
        return {
          host: "claude",
          stderr: "",
          content: `what_found:
  - README.md
  - .lineup-core/workflows/full-pipeline.yaml
how_it_works: The stage reported a string-array what_found payload.
constraints:
  - README.md must change
gaps:
  - none
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Inspect the workspace"
        },
        {
          runId: "rsarr1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(result.stageResults.get("research")?.outputs).toMatchObject({
        what_found: {
          files: ["README.md", ".lineup-core/workflows/full-pipeline.yaml"]
        },
        constraints: {
          items: ["README.md must change"]
        },
        gaps: {
          items: ["none"]
        }
      });
    } finally {
      process.chdir(origCwd);
    }
  });

  it("normalizes an empty-array what_found into a schema-valid object with metadata", async () => {
    const projectRoot = join(tempDir, "project-research-empty-array");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: research-empty-array
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    const localAgentRunner: LocalAgentRunner = {
      host: "claude",
      async invoke() {
        return {
          host: "claude",
          stderr: "",
          content: `what_found: []
how_it_works: The stage found no relevant files for this step.
constraints: Research was limited to the requested smoke files.
gaps:
  - confirm whether additional files are needed in later stages
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Inspect the workspace"
        },
        {
          runId: "rsempt1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(result.stageResults.get("research")?.outputs).toMatchObject({
        what_found: {
          files: []
        },
        constraints: {
          note: "Research was limited to the requested smoke files."
        },
        gaps: {
          items: ["confirm whether additional files are needed in later stages"]
        }
      });
    } finally {
      process.chdir(origCwd);
    }
  });

  it("fills missing required research fields from a partially structured payload", async () => {
    const projectRoot = join(tempDir, "project-research-missing-required-fields");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: research-missing-required-fields
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    const localAgentRunner: LocalAgentRunner = {
      host: "codex",
      async invoke() {
        return {
          host: "codex",
          stderr: "",
          content: `name: exec_command
parameters:
  cmd:
    - npm
    - --prefix cli run
    - add
    - human-run-command
type: research
agent: researcher
date: 2026-04-15
topic: add-a-run-command
status: complete
pipeline_stage: 2
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Inspect the workspace"
        },
        {
          runId: "rsmis1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(result.stageResults.get("research")?.outputs).toMatchObject({
        what_found: {
          observed_fields: ["name", "parameters"]
        },
        how_it_works: "Recovered research output from a exec_command-shaped payload.",
        constraints: {},
        gaps: {}
      });
    } finally {
      process.chdir(origCwd);
    }
  });

  it("removes the previous stage artifact before retrying a malformed researcher response", async () => {
    const projectRoot = join(tempDir, "project-research-retry-artifact-cleanup");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: research-retry-artifact-cleanup
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    let attempt = 0;
    let secondAttemptSawStaleArtifact = false;

    const localAgentRunner: LocalAgentRunner = {
      host: "opencode",
      async invoke(input) {
        attempt += 1;
        if (attempt === 2 && input.expectedOutputPath) {
          secondAttemptSawStaleArtifact = existsSync(input.expectedOutputPath);
        }

        if (attempt === 1) {
          const invalid = `what_found: [README.md\nhow_it_works: invalid\nconstraints:\n  missing_value\n`;
          if (input.expectedOutputPath) {
            writeFileSync(input.expectedOutputPath, invalid, "utf8");
          }
          return {
            host: "opencode",
            stderr: "",
            content: invalid
          };
        }

        const valid = `type: research
agent: researcher
date: 2026-04-14
topic: retry-cleanup
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: Retry succeeded after clearing the stale artifact path.
constraints:
  host: opencode
gaps:
  pending: []
`;
        if (input.expectedOutputPath) {
          writeFileSync(input.expectedOutputPath, valid, "utf8");
        }
        return {
          host: "opencode",
          stderr: "",
          content: valid
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Inspect the workspace"
        },
        {
          runId: "rsrch-cleanup",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(attempt).toBe(2);
      expect(secondAttemptSawStaleArtifact).toBe(false);
      expect(result.stageResults.get("research")?.outputs).toMatchObject({
        how_it_works: "Retry succeeded after clearing the stale artifact path."
      });
    } finally {
      process.chdir(origCwd);
    }
  });

  it("retries researcher stages when the first response fails schema validation", async () => {
    const projectRoot = join(tempDir, "project-research-schema-retry");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const workflowDir = join(projectRoot, ".lineup-core", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "full-pipeline.yaml");
    writeFileSync(workflowPath, `
apiVersion: lineup/v3
kind: Workflow
name: research-schema-retry
stages:
  - id: research
    type: agent
    agent: researcher
    outputs:
      what_found: { type: object }
      how_it_works: { type: string }
      constraints: { type: object }
      gaps: { type: object }
`);

    const prompts: string[] = [];
    let attempt = 0;

    const localAgentRunner: LocalAgentRunner = {
      host: "opencode",
      async invoke(input) {
        prompts.push(input.prompt);
        attempt += 1;
        if (attempt === 1) {
          return {
            host: "opencode",
            stderr: "",
            content: `type: research
agent: researcher
date: 2026-04-14
topic: retry
status: complete
pipeline_stage: research
what_found:
  - path: README.md
    content: ok
  - invalid
`
          };
        }

        return {
          host: "opencode",
          stderr: "",
          content: `type: research
agent: researcher
date: 2026-04-14
topic: retry
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: Retry converted the invalid draft into the required schema.
constraints:
  host: opencode
gaps:
  pending: []
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          workflow: workflowPath,
          mode: "human",
          prompt: "Inspect the workspace"
        },
        {
          runId: "rssch1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("OpenCode research contract:");
      expect(prompts[1]).toContain("Emit exactly one YAML Research document.");
      expect(prompts[1]).toContain("Do not make the requested code change during research. Only inspect and report.");
      expect(prompts[1]).toContain("Previous output was invalid because it did not produce exactly one YAML Research document.");
      expect(prompts[1]).toContain("Do not call edit, write, or mutating bash commands while retrying this research stage.");
      expect(result.stageResults.get("research")?.outputs).toMatchObject({
        how_it_works: "Retry converted the invalid draft into the required schema."
      });
    } finally {
      process.chdir(origCwd);
    }
  });

  it("normalizes teacher prose into a valid structured artifact without warnings", async () => {
    const projectRoot = join(tempDir, "project-explain-prose");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const localAgentRunner: LocalAgentRunner = {
      host: "codex",
      async invoke(input) {
        if (input.agent === "researcher") {
          return {
            host: "codex",
            stderr: "",
            content: `type: research
agent: researcher
date: 2026-04-13
topic: explain-tactic
status: complete
pipeline_stage: research
what_found:
  files:
    - README.md
how_it_works: The bundled explain tactic resolved successfully.
constraints:
  tooling: local
gaps:
  pending: []
`
          };
        }

        if (input.agent === "teacher") {
          return {
            host: "codex",
            stderr: "",
            content: `The bundled explain tactic resolved successfully, but the host returned plain prose instead of structured YAML.`
          };
        }

        return {
          host: "codex",
          stderr: "",
          content: REVIEW_YAML
        };
      }
    };

    const capturedStatuses: string[] = [];
    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          tactic: "explain",
          mode: "human",
          prompt: "Explain tactic resolution"
        },
        {
          runId: "expln2",
          localAgentRunner,
          onProtocolMessage: (message) => {
            if (
              "method" in message &&
              message.method === "agent/output" &&
              message.params !== undefined &&
              "channel" in message.params &&
              message.params.channel === "status"
            ) {
              if (!("chunk" in message.params)) {
                return;
              }
              capturedStatuses.push(message.params.chunk);
            }
          }
        }
      );

      expect(result.status).toBe("success");
      expect(capturedStatuses.some((chunk) => chunk.includes("[stage/warning]"))).toBe(false);
      const explainArtifact = String(result.stageResults.get("explain")?.outputs.artifactPath);
      const explainYaml = readFileSync(explainArtifact, "utf8");
      expect(explainYaml).toContain("type: explanation");
      expect(explainYaml).toContain("agent: teacher");
      expect(explainYaml).toContain("status: complete");
      expect(explainYaml).toContain("raw_output:");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("omits tool-call transcripts from generic retry prompts after malformed Codex research output", async () => {
    const projectRoot = join(tempDir, "project-explain-codex-retry");
    writeTemplatesTo(projectRoot);
    initGitRepo(projectRoot);

    const prompts: string[] = [];
    let researchAttempts = 0;

    const localAgentRunner: LocalAgentRunner = {
      host: "codex",
      async invoke(input) {
        prompts.push(input.prompt);

        if (input.agent === "researcher") {
          researchAttempts += 1;
          if (researchAttempts === 1) {
            return {
              host: "codex",
              stderr: "",
              content: `<function=exec_command>\n<parameter=cmd>\ncat .lineup-core/workflows/full-pipeline.yaml\n</parameter>\n</function>\n</tool_call>`
            };
          }

          return {
            host: "codex",
            stderr: "",
            content: `type: research
agent: researcher
date: 2026-04-15
topic: explain
status: complete
pipeline_stage: 2
what_found:
  files:
    - .lineup-core/workflows/full-pipeline.yaml
how_it_works: The bundled explain tactic routes through the smoke path.
constraints:
  host: codex
gaps:
  pending: []
`
          };
        }

        return {
          host: "codex",
          stderr: "",
          content: `type: explanation
agent: teacher
status: complete
topic: explain
summary: The bundled explain tactic resolved.
details:
  - It runs through the smoke path.
`
        };
      }
    };

    const { runPipeline } = await import("../src/lib/run-pipeline.js");

    const origCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const result = await runPipeline(
        {
          tactic: "explain",
          mode: "human",
          prompt: "Explain the bundled explain tactic and confirm the smoke path."
        },
        {
          runId: "codrx1",
          localAgentRunner
        }
      );

      expect(result.status).toBe("success");
      expect(prompts).toHaveLength(3);
      expect(prompts[1]).toContain("Previous output was invalid because it was not a valid structured Research payload.");
      expect(prompts[1]).toContain("[tool-call transcript omitted; previous output was not a structured artifact]");
      expect(prompts[1]).not.toContain("<function=exec_command>");
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
