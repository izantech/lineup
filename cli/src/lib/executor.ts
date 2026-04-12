import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { stringify as stringifyYaml } from "yaml";

import type { ArtifactStore, StoredArtifactRecord } from "./artifact-store.js";
import { CliError } from "./errors.js";
import { createNativeIsolationWorkspace, type NativeIsolationMode } from "./isolation.js";
import {
  compilePlanToTasks,
  type ApprovedPlan,
  type CompiledTask,
  type CompiledTasksArtifact
} from "./dag.js";
import {
  createLineupNotification,
  createLineupRequest,
  type LineupProtocolMessage
} from "./protocol.js";
import { retryOperation } from "./retry.js";
import type { WorkflowStage } from "./types.js";
import { buildAgentSystemPrompt } from "./prompt-builder.js";
import {
  parseRestrictedYaml,
  validatePlanYaml,
  validateReviewYaml,
  validateTasksJson
} from "./validation.js";

export type ImplementationChange = {
  file: string;
  description: string;
  task_id: string;
};

export type ImplementationIssue = {
  issue: string;
  resolution?: string;
  impact?: "none" | "minor" | "moderate" | "significant";
};

export type ImplementationState = {
  status: "complete";
  task_results: Array<{
    task_id: string;
    attempts: number;
    summary: string;
    write_scope: string[];
    read_scope: string[];
  }>;
  changes_made: ImplementationChange[];
  issues_encountered: ImplementationIssue[];
  tasks_path: string;
};

export type NativeTaskExecutionInput = {
  runId: string;
  projectRoot: string;
  runRoot: string;
  artifactDir: string;
  workspaceRoot: string;
  task: CompiledTask;
  wave: number;
  prompt: string;
  attempt: number;
  previousErrors: Array<{
    code: string;
    message: string;
  }>;
};

export type NativeTaskExecutionResult = {
  status: "complete";
  summary: string;
  changes_made?: ImplementationChange[];
  issues_encountered?: ImplementationIssue[];
};

export type NativeReviewExecutionInput = {
  runId: string;
  projectRoot: string;
  runRoot: string;
  artifactDir: string;
  workspaceRoot: string;
  prompt: string;
  implementationState: ImplementationState;
  approvedPlan: ApprovedPlan;
  tasksArtifact: CompiledTasksArtifact;
};

export type NativeReviewExecutionResult = {
  reviewYaml: string;
  summary?: string;
};

export type NativeExecutionDriver = {
  executeTask(input: NativeTaskExecutionInput): Promise<NativeTaskExecutionResult>;
  executeReview(input: NativeReviewExecutionInput): Promise<NativeReviewExecutionResult>;
};

export type NativeExecutorOptions = {
  runId: string;
  projectRoot: string;
  runRoot: string;
  artifactDir: string;
  gitTreeSha?: string;
  planPath: string;
  artifactStore: ArtifactStore;
  nextProtocolRequestId: () => number;
  emitProtocol: (message: LineupProtocolMessage) => void;
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void;
  implementStage: WorkflowStage;
  verifyStage: WorkflowStage;
  driver?: NativeExecutionDriver;
  isolationMode?: NativeIsolationMode;
};

export type NativeExecutorResult = {
  planRecord: StoredArtifactRecord;
  tasksRecord: StoredArtifactRecord;
  reviewRecord: StoredArtifactRecord;
  implementResult: {
    id: "implement";
    status: "complete";
    outputs: ImplementationState;
  };
  verifyResult: {
    id: "verify";
    status: "complete";
    outputs: Record<string, unknown>;
  };
};

function buildRequestDir(artifactDir: string): string {
  return path.join(artifactDir, "native", "requests");
}

function buildResponseDir(artifactDir: string): string {
  return path.join(artifactDir, "native", "responses");
}

function ensureParentDirectory(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeApprovedPlan(rawPlan: string, source: string): { raw: string; parsed: ApprovedPlan } {
  validatePlanYaml(rawPlan, source);
  const parsed = parseRestrictedYaml(rawPlan, source) as ApprovedPlan;

  if (parsed.status === "approved") {
    return { raw: rawPlan, parsed };
  }

  const approvedPlan: ApprovedPlan = {
    ...parsed,
    status: "approved"
  };
  const approvedYaml = stringifyYaml(approvedPlan);
  validatePlanYaml(approvedYaml, source);
  return {
    raw: approvedYaml,
    parsed: approvedPlan
  };
}

function readRequiredTextFile(filePath: string, label: string): string {
  if (!existsSync(filePath)) {
    throw new CliError(`${label} not found at ${filePath}.`, {
      code: "artifact_validation_failed"
    });
  }

  return readFileSync(filePath, "utf8");
}

function writeJsonRequest(filePath: string, payload: unknown): void {
  ensureParentDirectory(filePath);
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildDeveloperPrompt(input: {
  projectRoot: string;
  approvedPlan: ApprovedPlan;
  task: CompiledTask;
  attempt: number;
  previousErrors: Array<{ code: string; message: string }>;
}): string {
  const extraInstructions = [
    "Native Lineup v3 task contract:",
    "- You are executing one compiled task from an approved lineup/v3 Plan.",
    "- Apply edits directly in the provided worktree.",
    "- Keep changes scoped to the declared write_scope.",
    "- Return a JSON object with status, summary, changes_made[], and issues_encountered[].",
    "",
    `Task ID: ${input.task.id}`,
    `Wave: ${input.task.wave}`,
    `Title: ${input.task.title}`,
    `Write scope: ${(input.task.write_scope ?? []).join(", ") || "(none declared)"}`,
    `Read scope: ${(input.task.read_scope ?? []).join(", ") || "(none declared)"}`,
    "",
    "Approved plan summary:",
    input.approvedPlan.summary,
    "",
    "Task payload:",
    JSON.stringify(input.task, null, 2)
  ];

  if (input.attempt > 1) {
    extraInstructions.push("", `Retry attempt: ${input.attempt}`);
    if (input.previousErrors.length > 0) {
      extraInstructions.push("Previous errors:", JSON.stringify(input.previousErrors, null, 2));
    }
  }

  return buildAgentSystemPrompt({
    agentFilePath: path.join(input.projectRoot, "agents", "developer.md"),
    promptTemplate: "{{AGENT_BODY}}",
    extraInstructions: extraInstructions.join("\n")
  }).prompt;
}

function buildReviewerPrompt(input: {
  projectRoot: string;
  approvedPlan: ApprovedPlan;
  implementationState: ImplementationState;
  tasksArtifact: CompiledTasksArtifact;
}): string {
  return buildAgentSystemPrompt({
    agentFilePath: path.join(input.projectRoot, "agents", "reviewer.md"),
    promptTemplate: "{{AGENT_BODY}}",
    extraInstructions: [
      "Native Lineup v3 review contract:",
      "- Review the completed implementation against the approved plan.",
      "- Validate acceptance criteria and note concrete issues only.",
      "- Return a lineup/v3 Review YAML document.",
      "",
      "Approved plan summary:",
      input.approvedPlan.summary,
      "",
      "Compiled tasks:",
      JSON.stringify(input.tasksArtifact.tasks, null, 2),
      "",
      "Implementation state:",
      JSON.stringify(input.implementationState, null, 2)
    ].join("\n")
  }).prompt;
}

function defaultDriver(artifactDir: string): NativeExecutionDriver {
  return {
    async executeTask(input) {
      const requestPath = path.join(buildRequestDir(artifactDir), `${input.task.id}.json`);
      writeJsonRequest(requestPath, {
        runId: input.runId,
        task: input.task,
        attempt: input.attempt,
        previousErrors: input.previousErrors,
        prompt: input.prompt
      });

      const responsePath = path.join(buildResponseDir(artifactDir), `${input.task.id}.json`);
      const raw = readRequiredTextFile(
        responsePath,
        `Native task response for ${input.task.id}`
      );
      const parsed = JSON.parse(raw) as NativeTaskExecutionResult;

      if (parsed.status !== "complete" || !parsed.summary) {
        throw new CliError(`Task response ${responsePath} is invalid.`, {
          code: "malformed_output"
        });
      }

      return parsed;
    },
    async executeReview(input) {
      const requestPath = path.join(buildRequestDir(artifactDir), "review.json");
      writeJsonRequest(requestPath, {
        runId: input.runId,
        implementationState: input.implementationState,
        approvedPlan: input.approvedPlan,
        tasksArtifact: input.tasksArtifact,
        prompt: input.prompt
      });

      const reviewPath = path.join(buildResponseDir(artifactDir), "review.yaml");
      return {
        reviewYaml: readRequiredTextFile(reviewPath, "Native review response")
      };
    }
  };
}

function mergeImplementationResult(
  accumulated: ImplementationState,
  task: CompiledTask,
  attemptCount: number,
  result: NativeTaskExecutionResult
): void {
  accumulated.task_results.push({
    task_id: task.id,
    attempts: attemptCount,
    summary: result.summary,
    write_scope: task.write_scope ?? [],
    read_scope: task.read_scope ?? []
  });

  for (const change of result.changes_made ?? []) {
    accumulated.changes_made.push(change);
  }

  for (const issue of result.issues_encountered ?? []) {
    accumulated.issues_encountered.push(issue);
  }
}

export async function executeNativeExecutor(options: NativeExecutorOptions): Promise<NativeExecutorResult> {
  const rawPlan = readRequiredTextFile(options.planPath, "Approved plan");
  const normalizedPlan = normalizeApprovedPlan(rawPlan, options.planPath);
  const planRecord = options.artifactStore.persistText("plan", normalizedPlan.raw, "yaml");
  const { artifact: tasksArtifact } = compilePlanToTasks(normalizedPlan.parsed, {
    gitTreeSha: options.gitTreeSha
  });
  validateTasksJson(tasksArtifact, options.planPath);
  const tasksRecord = options.artifactStore.persistJson("tasks", tasksArtifact);

  const driver = options.driver ?? defaultDriver(options.artifactDir);
  const workspace = await createNativeIsolationWorkspace({
    workspaceRoot: options.projectRoot,
    runId: options.runId,
    mode: options.isolationMode ?? "full",
    sparseEnabled: false
  });

  try {
    const implementationState: ImplementationState = {
      status: "complete",
      task_results: [],
      changes_made: [],
      issues_encountered: [],
      tasks_path: tasksRecord.path
    };

    const tasksByWave = new Map<number, CompiledTask[]>();
    for (const task of tasksArtifact.tasks) {
      const existing = tasksByWave.get(task.wave) ?? [];
      existing.push(task);
      tasksByWave.set(task.wave, existing);
    }

    const orderedWaves = [...tasksByWave.keys()].sort((left, right) => left - right);
    for (const wave of orderedWaves) {
      const waveTasks = (tasksByWave.get(wave) ?? []).sort((left, right) => left.id.localeCompare(right.id));
      options.emitStatus("implement", `Executing native wave ${wave} (${waveTasks.map((task) => task.id).join(", ")}).`);

      for (const task of waveTasks) {
        const retryResult = await retryOperation(
          {
            maxAttempts: Math.max(options.implementStage.retry?.max_attempts ?? 1, 1),
            on: options.implementStage.retry?.on
          },
          async (retryContext) => {
            const prompt = buildDeveloperPrompt({
              projectRoot: options.projectRoot,
              approvedPlan: normalizedPlan.parsed,
              task,
              attempt: retryContext.attempt,
              previousErrors: retryContext.previousErrors
            });

            options.emitProtocol(
              createLineupRequest({
                method: "agent/spawn",
                id: options.nextProtocolRequestId(),
                params: {
                  runId: options.runId,
                  stageId: "implement",
                  agent: options.implementStage.agent ?? "developer",
                  prompt,
                  inputs: {
                    plan_path: planRecord.path,
                    tasks_path: tasksRecord.path,
                    task
                  },
                  outputs: {
                    schema: "ImplementationState"
                  },
                  timeoutMs: 600_000,
                  retryAttempt: retryContext.attempt - 1
                }
              })
            );

            const result = await driver.executeTask({
              runId: options.runId,
              projectRoot: options.projectRoot,
              runRoot: options.runRoot,
              artifactDir: options.artifactDir,
              workspaceRoot: workspace.worktreeRoot,
              task,
              wave,
              prompt,
              attempt: retryContext.attempt,
              previousErrors: retryContext.previousErrors
            });

            options.emitProtocol(
              createLineupNotification({
                method: "agent/done",
                params: {
                  runId: options.runId,
                  stageId: "implement",
                  status: "success",
                  summary: `${task.id}: ${result.summary}`
                }
              })
            );

            return result;
          }
        );

        mergeImplementationResult(implementationState, task, retryResult.attempts, retryResult.value);
      }
    }

    options.emitStatus("implement", "Native task execution completed.", true);

    const reviewPrompt = buildReviewerPrompt({
      projectRoot: options.projectRoot,
      approvedPlan: normalizedPlan.parsed,
      implementationState,
      tasksArtifact
    });

    options.emitProtocol(
      createLineupRequest({
        method: "agent/spawn",
        id: options.nextProtocolRequestId(),
        params: {
          runId: options.runId,
          stageId: "verify",
          agent: options.verifyStage.agent ?? "reviewer",
          prompt: reviewPrompt,
          inputs: {
            plan_path: planRecord.path,
            tasks_path: tasksRecord.path,
            implementation_state: implementationState
          },
          outputs: {
            schema: "Review"
          },
          timeoutMs: 300_000,
          retryAttempt: 0
        }
      })
    );

    const reviewResult = await driver.executeReview({
      runId: options.runId,
      projectRoot: options.projectRoot,
      runRoot: options.runRoot,
      artifactDir: options.artifactDir,
      workspaceRoot: workspace.worktreeRoot,
      prompt: reviewPrompt,
      implementationState,
      approvedPlan: normalizedPlan.parsed,
      tasksArtifact
    });
    validateReviewYaml(reviewResult.reviewYaml, path.join(options.artifactDir, "review.yaml"));
    const reviewRecord = options.artifactStore.persistText("review", reviewResult.reviewYaml, "yaml");
    const parsedReview = parseRestrictedYaml(reviewResult.reviewYaml, reviewRecord.path) as Record<string, unknown>;

    options.emitProtocol(
      createLineupNotification({
        method: "agent/done",
        params: {
          runId: options.runId,
          stageId: "verify",
          status: "success",
          summary: reviewResult.summary ?? String(parsedReview.summary ?? "Review completed.")
        }
      })
    );
    options.emitStatus("verify", "Native review completed.", true);

    return {
      planRecord,
      tasksRecord,
      reviewRecord,
      implementResult: {
        id: "implement",
        status: "complete",
        outputs: implementationState
      },
      verifyResult: {
        id: "verify",
        status: "complete",
        outputs: parsedReview
      }
    };
  } finally {
    await workspace.cleanup();
  }
}
