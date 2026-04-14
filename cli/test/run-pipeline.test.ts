import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
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
          return {
            host: "claude",
            stderr: "",
            content: JSON.stringify({
              status: "complete",
              summary: "implemented the requested change",
              changes_made: [
                {
                  file: "README.md",
                  description: "updated readme",
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
            content: `Here is the research result.\n\`\`\`yaml\ntype: research\nagent: researcher\n\`\`\``
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
      expect(prompts[1]).toContain("Previous output was invalid because it did not produce exactly one YAML Research document.");
      expect(prompts[1]).toContain("Rewrite the same facts into one YAML document only.");
      expect(prompts[1]).toContain("Do not add markdown, prose, code fences, bullet lists, or extra wrapper text.");
      expect(prompts[1]).toContain("Do not call edit, write, or mutating bash commands while retrying this research stage.");
      expect(prompts[1]).toContain("Use the declared Research schema fields exactly once and keep the payload directly parseable.");
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
      expect(prompts[1]).toContain("Previous output was invalid because it did not produce exactly one YAML Research document.");
      expect(prompts[1]).toContain("Do not add markdown, prose, code fences, bullet lists, or extra wrapper text.");
      expect(prompts[1]).toContain("Do not call edit, write, or mutating bash commands while retrying this research stage.");
      expect(String(result.stageResults.get("research")?.outputs.artifactPath)).toContain("/.lineup/.runs/rsrch1/artifacts/research.yaml");
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
          const invalid = `what_found:\n  - README.md\nhow_it_works: invalid\nconstraints:\n  missing_value\n`;
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
summary: This is still the wrong artifact shape.
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
