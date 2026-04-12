import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { EngineMode, RunOptions, WorkflowDefinition, WorkflowStage } from "./types.js";
import type { HostName } from "./constants.js";
import { createArtifactStore, type StoredArtifactRecord } from "./artifact-store.js";
import {
  executeNativeExecutor,
  prepareExecutionArtifacts,
  type NativeExecutionDriver
} from "./executor.js";
import {
  createLineupNotification,
  createLineupRequest,
  encodeNdjsonMessage,
  type LineupGateType,
  type LineupProtocolMessage
} from "./protocol.js";
import { writePendingGate, waitForGateResponse, type PendingGate } from "./gate-store.js";
import {
  lineupArtifactStoreDir,
  lineupRunArtifactsDir,
  lineupRunDebugBundleFile,
  lineupRunDir,
  lineupRuntimeLockFile
} from "./paths.js";
import {
  appendPipelineCompletedStage,
  defaultPipelineState,
  invalidateLegacyRuntimeArtifacts,
  loadPipelineState,
  markPipelineCurrentStage,
  savePipelineState,
  updatePipelineArtifactHashes
} from "./state.js";
import { parseWorkflowYaml, parseRestrictedYaml, validateTacticYaml } from "./validation.js";
import { tacticToWorkflow, type TacticDefinition } from "./tactic-convert.js";
import { validateWorkflowDag, resolveExecutionOrder } from "./workflow.js";
import { evaluateExpression, type ExpressionContext } from "./expression.js";
import { generateTfConfig, generatePassthroughConfig, type TfGeneratorContext } from "./tf-config.js";
import { generateTfAdapters, type AdapterGenerationContext } from "./tf-adapters.js";

export type PipelineResult = {
  runId: string;
  status: "success" | "failed" | "aborted";
  stageResults: Map<string, StageResult>;
  outputDir?: string;
};

type StageResult = {
  id: string;
  status: "complete" | "skipped" | "failed";
  outputs: Record<string, unknown>;
  duration?: number;
};

export type RunPipelineHooks = {
  runId?: string;
  native?: {
    driver?: NativeExecutionDriver;
    planContent?: string;
  };
};

/**
 * Run the Lineup pipeline: orchestration stages → native execution → post-pipeline stages.
 */
export async function runPipeline(options: RunOptions, hooks: RunPipelineHooks = {}): Promise<PipelineResult> {
  // 1. Load workflow
  let workflow: WorkflowDefinition;
  let workflowPath: string;

  if (options.tactic) {
    const tacticPath = resolveTacticPath(options.tactic);
    const tacticRaw = readFileSync(tacticPath, "utf-8");
    validateTacticYaml(tacticRaw, tacticPath);
    const tacticDef = parseRestrictedYaml(tacticRaw, tacticPath) as TacticDefinition;
    workflow = tacticToWorkflow(tacticDef);
    workflowPath = tacticPath;
  } else {
    workflowPath = options.workflow ?? findDefaultWorkflow();
    const raw = readFileSync(workflowPath, "utf-8");
    workflow = parseWorkflowYaml(raw, workflowPath);
  }

  // 2. Validate DAG
  validateWorkflowDag(workflow);

  // 3. Generate run ID (6 char hex from random bytes)
  const runId =
    hooks.runId ??
    createHash("sha256")
      .update(Date.now().toString() + Math.random().toString())
      .digest("hex")
      .slice(0, 6);

  // 4. Setup directories
  const projectRoot = resolve(".");
  const runRoot = lineupRunDir(runId, projectRoot);
  const artifactDir = lineupRunArtifactsDir(runId, projectRoot);
  const cacheDir = resolve(projectRoot, ".lineup", ".cache");
  const artifactStore = createArtifactStore(lineupArtifactStoreDir(projectRoot));
  const protocolMessages: LineupProtocolMessage[] = [];
  let protocolSequence = 0;
  let protocolRequestId = 1;
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(runRoot, { recursive: true });

  const gitTreeSha = resolveGitTreeSha(projectRoot);
  let pipelineState = savePipelineState(
    defaultPipelineState({
      runId,
      workflow: workflowPath,
      gitTreeSha,
      status: "running"
    }),
    projectRoot
  );

  const emitProtocol = (message: LineupProtocolMessage): void => {
    protocolMessages.push(message);
    process.stdout.write(`${encodeNdjsonMessage(message)}\n`);
  };

  const emitStatus = (stageId: string, chunk: string, final = false): void => {
    protocolSequence += 1;
    emitProtocol(
      createLineupNotification({
        method: "agent/output",
        params: {
          runId,
          stageId,
          channel: "status",
          sequence: protocolSequence,
          chunk,
          ...(final ? { final: true } : {})
        }
      })
    );
  };

  const persistProtocolArtifact = (): void => {
    const protocolRecord = artifactStore.persistJson("protocol", protocolMessages);
    pipelineState = savePipelineState(
      updatePipelineArtifactHashes(pipelineState, {
        protocol: protocolRecord.sha256
      }),
      projectRoot
    );
  };

  let status: "success" | "failed" | "aborted" = "success";
  const stageResults = new Map<string, StageResult>();
  const selectedEngine = resolveEngineMode(options.engine);
  let lockAcquired = false;

  try {
    invalidateLegacyRuntimeArtifacts(projectRoot);
    acquireRuntimeLock(projectRoot, runId, workflowPath);
    lockAcquired = true;

    // 5. Generate-only: produce TF artifacts and return immediately
    if (options.generateOnly) {
      const host = detectHost();
      const adaptersDir = resolve(artifactDir, "adapters");
      const adaptersCtx: AdapterGenerationContext = {
        host,
        adaptersSourceDir: resolve(projectRoot, ".lineup-core", "adapters"),
        promptsSourceDir: resolve(projectRoot, ".lineup-core", "prompts"),
        outputDir: adaptersDir,
        agentsDir: resolve(projectRoot, "agents"),
        modelMap: { scope_selector: "", planner: "claude-sonnet-4-6", worker: "claude-sonnet-4-6", validator: "claude-sonnet-4-6" },
      };
      generateTfAdapters(adaptersCtx);
      const tfCtx: TfGeneratorContext = {
        workflow,
        projectRoot,
        runId,
        adaptersDir,
        promptsDir: adaptersDir,
        host,
        timeout: options.timeout,
      };
      const configYaml = generateTfConfig(tfCtx);
      const configPath = resolve(artifactDir, "tf-config.yaml");
      writeFileSync(configPath, configYaml, "utf-8");
      const configRecord = artifactStore.persistText("config", configYaml, "yaml");
      pipelineState = savePipelineState(
        updatePipelineArtifactHashes(pipelineState, {
          config: configRecord.sha256
        }),
        projectRoot
      );
      persistProtocolArtifact();
      return { runId, status: "success", stageResults: new Map<string, StageResult>(), outputDir: artifactDir };
    }

    // 6. Resolve execution order
    const waves = resolveExecutionOrder(workflow);
    const expressionCtx: ExpressionContext = { stages: {}, variables: {} };

    // 7. Dry-run: just print the plan
    if (options.dryRun) {
      printExecutionPlan(waves, workflow);
      return { runId, status: "success", stageResults };
    }

    // 8. Detect host (check which CLI is available)
    const host = detectHost();

    // 9. Execute stages in wave order
    const preStages = new Set(["triage", "clarify", "research", "gate"]);
    const postStages = new Set(["document"]);

    for (const wave of waves) {
      for (const stageId of wave) {
        const stage = workflow.stages.find((s) => s.id === stageId)!;
        pipelineState = savePipelineState(markPipelineCurrentStage(pipelineState, stageId), projectRoot);

        // Evaluate condition/skip_if
        if (stage.condition && !evaluateExpression(stage.condition, expressionCtx)) {
          emitStatus(stageId, `Skipped stage '${stageId}' because condition evaluated to false.`, true);
          stageResults.set(stageId, { id: stageId, status: "skipped", outputs: {} });
          expressionCtx.stages[stageId] = { outputs: {} };
          pipelineState = savePipelineState(appendPipelineCompletedStage(pipelineState, stageId), projectRoot);
          continue;
        }
        if (stage.skip_if && evaluateExpression(stage.skip_if, expressionCtx)) {
          emitStatus(stageId, `Skipped stage '${stageId}' because skip_if evaluated to true.`, true);
          stageResults.set(stageId, { id: stageId, status: "skipped", outputs: {} });
          expressionCtx.stages[stageId] = { outputs: {} };
          pipelineState = savePipelineState(appendPipelineCompletedStage(pipelineState, stageId), projectRoot);
          continue;
        }

        if (preStages.has(stageId)) {
          // Pre-pipeline: output protocol messages for host orchestrator
          const result = await executePreStage(stage, expressionCtx, projectRoot, runId, () => protocolRequestId++, emitProtocol, emitStatus);
          stageResults.set(stageId, result);
          expressionCtx.stages[stageId] = { outputs: result.outputs };

        } else if (stageId === "plan") {
          // Phase 1: invoke planner adapter directly
          const planResult = await executePlannerPhase(
            stage,
            host,
            projectRoot,
            artifactDir,
            runId,
            () => protocolRequestId++,
            emitProtocol,
            emitStatus,
            hooks
          );
          stageResults.set(stageId, planResult);
          expressionCtx.stages[stageId] = { outputs: planResult.outputs };

        } else if (stageId === "plan-approval") {
          if (options.approvePlan) {
            // Auto-approve when --approve-plan is set
            const approvalResult: StageResult = { id: stageId, status: "complete", outputs: { approved: true } };
            stageResults.set(stageId, approvalResult);
            expressionCtx.stages[stageId] = { outputs: approvalResult.outputs };
          } else {
            const reqId = protocolRequestId++;
            const pendingGate: PendingGate = {
              requestId: reqId,
              gateType: "approval",
              question: "Approve the generated plan?",
              choices: ["approve", "reject"],
              defaultChoice: "approve",
              createdAt: new Date().toISOString()
            };
            writePendingGate(runId, pendingGate, projectRoot);

            emitProtocol(
              createLineupRequest({
                method: "gate/request",
                id: reqId,
                params: {
                  runId,
                  stageId,
                  gateType: "approval",
                  question: "Approve the generated plan?",
                  choices: ["approve", "reject"],
                  defaultChoice: "approve"
                }
              })
            );

            // Block until skill responds via `lineup gate respond`
            const gateResponse = await waitForGateResponse(runId, reqId, projectRoot);
            const approved = gateResponse.choice === "approve";

            if (!approved) {
              const approvalResult: StageResult = { id: stageId, status: "failed", outputs: { approved: false, reason: gateResponse.reason } };
              stageResults.set(stageId, approvalResult);
              expressionCtx.stages[stageId] = { outputs: approvalResult.outputs };
              throw new Error(`Plan rejected: ${gateResponse.reason ?? "no reason given"}`);
            }

            pipelineState = savePipelineState(
              { ...pipelineState, status: "running", approval: { approved_at: new Date().toISOString(), approved_by: "skill" } },
              projectRoot
            );

            const approvalResult: StageResult = { id: stageId, status: "complete", outputs: { approved: true } };
            stageResults.set(stageId, approvalResult);
            expressionCtx.stages[stageId] = { outputs: approvalResult.outputs };
          }

        } else if (stageId === "implement" || stageId === "verify") {
          // Implement and verify run through the selected v3 engine.
          if (stageId === "implement") {
            const implementStage = workflow.stages.find((candidate) => candidate.id === "implement");
            const verifyStage = workflow.stages.find((candidate) => candidate.id === "verify");
            if (!implementStage || !verifyStage) {
              throw new Error("Workflow must define both implement and verify stages.");
            }

            const planPath = expressionCtx.stages["plan"]?.outputs?.planPath as string | undefined;
            if (!planPath) {
              throw new Error("No approved plan artifact path found. Plan stage must complete before native execution.");
            }

            if (selectedEngine === "tf") {
              const tfResult = await executeTfPhaseReference(
                workflow,
                host,
                projectRoot,
                artifactDir,
                runId,
                planPath,
                artifactStore,
                gitTreeSha,
                options.timeout,
                emitStatus
              );
              pipelineState = savePipelineState(
                updatePipelineArtifactHashes(pipelineState, {
                  plan: tfResult.planRecord.sha256,
                  tasks: tfResult.tasksRecord.sha256
                }),
                projectRoot
              );
              stageResults.set("implement", tfResult.implementResult);
              stageResults.set("verify", tfResult.verifyResult);
              expressionCtx.stages["implement"] = { outputs: tfResult.implementResult.outputs };
              expressionCtx.stages["verify"] = { outputs: tfResult.verifyResult.outputs };
            } else {
              const nativeResult = await executeNativeExecutor({
                runId,
                projectRoot,
                runRoot,
                artifactDir,
                gitTreeSha,
                planPath,
                artifactStore,
                nextProtocolRequestId: () => protocolRequestId++,
                emitProtocol,
                emitStatus,
                implementStage,
                verifyStage,
                driver: hooks.native?.driver
              });

              pipelineState = savePipelineState(
                updatePipelineArtifactHashes(pipelineState, {
                  plan: nativeResult.planRecord.sha256,
                  tasks: nativeResult.tasksRecord.sha256,
                  review: nativeResult.reviewRecord.sha256
                }),
                projectRoot
              );

              stageResults.set("implement", nativeResult.implementResult);
              stageResults.set("verify", nativeResult.verifyResult);
              expressionCtx.stages["implement"] = { outputs: nativeResult.implementResult.outputs };
              expressionCtx.stages["verify"] = { outputs: nativeResult.verifyResult.outputs };
            }
          }
          // verify is handled together with implement in the selected engine

        } else if (postStages.has(stageId)) {
          const result = executePostStage(stage, expressionCtx, projectRoot, emitStatus);
          stageResults.set(stageId, result);
        }

        pipelineState = savePipelineState(appendPipelineCompletedStage(pipelineState, stageId), projectRoot);
      }
    }

    emitProtocol(
      createLineupNotification({
        method: "pipeline/complete",
        params: {
          runId,
          status,
          completedAt: new Date().toISOString(),
          summary: "Pipeline completed successfully."
        }
      })
    );
    persistProtocolArtifact();
    pipelineState = savePipelineState(
      {
        ...markPipelineCurrentStage(pipelineState, null),
        status: "succeeded"
      },
      projectRoot
    );
    // 10. Cleanup on success
    cleanup(artifactDir, cacheDir, true);
  } catch (error) {
    status = "failed";
    emitProtocol(
      createLineupNotification({
        method: "pipeline/complete",
        params: {
          runId,
          status,
          completedAt: new Date().toISOString(),
          summary: error instanceof Error ? error.message : String(error)
        }
      })
    );
    persistProtocolArtifact();
    pipelineState = savePipelineState(
      {
        ...markPipelineCurrentStage(pipelineState, null),
        status: "failed"
      },
      projectRoot
    );
    writeDebugBundle(projectRoot, runId, {
      run_id: runId,
      workflow: workflowPath,
      engine: selectedEngine,
      error: error instanceof Error ? error.message : String(error),
      stage_results: Object.fromEntries(stageResults.entries()),
      protocol_messages: protocolMessages,
      pipeline_state: pipelineState
    });
    // Cleanup on error (keep cache for debugging)
    cleanup(artifactDir, cacheDir, false);
    throw error;
  } finally {
    if (lockAcquired) {
      releaseRuntimeLock(projectRoot, runId);
    }
  }

  return { runId, status, stageResults };
}

// --- Internal functions ---

function findDefaultWorkflow(): string {
  const candidates = [
    resolve(".lineup-core", "workflows", "full-pipeline.yaml"),
    resolve(".lineup", "workflows", "full-pipeline.yaml"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error("No workflow file found. Specify one with --workflow <path>.");
}

function resolveTacticPath(name: string): string {
  const candidates = [
    resolve(".lineup", "tactics", `${name}.yaml`),
    resolve("tactics", `${name}.yaml`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`Tactic '${name}' not found. Searched: ${candidates.join(", ")}`);
}

function detectHost(): HostName {
  // Check for host CLIs in order of preference
  try { execSync("which claude", { stdio: "ignore" }); return "claude"; } catch {}
  try { execSync("which codex", { stdio: "ignore" }); return "codex"; } catch {}
  try { execSync("which opencode", { stdio: "ignore" }); return "opencode"; } catch {}
  throw new Error("No supported host CLI found (claude, codex, or opencode).");
}

function resolveEngineMode(raw: EngineMode | undefined): Exclude<EngineMode, "auto"> {
  if (!raw || raw === "auto") {
    return "native";
  }

  return raw;
}

function acquireRuntimeLock(projectRoot: string, runId: string, workflowPath: string): void {
  const lockPath = lineupRuntimeLockFile(projectRoot);
  if (existsSync(lockPath)) {
    try {
      const current = JSON.parse(readFileSync(lockPath, "utf8")) as { runId?: string };
      if (current.runId) {
        const state = loadPipelineState(current.runId, projectRoot);
        if (!state || ["succeeded", "failed", "canceled"].includes(state.status)) {
          rmSync(lockPath, { force: true });
        }
      } else {
        rmSync(lockPath, { force: true });
      }
    } catch {
      rmSync(lockPath, { force: true });
    }
  }

  try {
    writeFileSync(
      lockPath,
      `${JSON.stringify({ runId, workflow: workflowPath, created_at: new Date().toISOString(), pid: process.pid }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
  } catch {
    throw new Error(`Another mutating Lineup run is already active. Remove ${lockPath} if it is stale.`);
  }
}

function releaseRuntimeLock(projectRoot: string, runId: string): void {
  const lockPath = lineupRuntimeLockFile(projectRoot);
  if (!existsSync(lockPath)) {
    return;
  }

  try {
    const current = JSON.parse(readFileSync(lockPath, "utf8")) as { runId?: string };
    if (!current.runId || current.runId === runId) {
      rmSync(lockPath, { force: true });
    }
  } catch {
    rmSync(lockPath, { force: true });
  }
}

function writeDebugBundle(projectRoot: string, runId: string, payload: unknown): void {
  const filePath = lineupRunDebugBundleFile(runId, projectRoot);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveGitTreeSha(projectRoot: string): string | undefined {
  try {
    return execSync("git rev-parse HEAD^{tree}", {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

function printExecutionPlan(waves: string[][], workflow: WorkflowDefinition): void {
  console.log("LINEUP:pipeline:dry-run");
  for (let i = 0; i < waves.length; i++) {
    const stageNames = waves[i].map((id) => {
      const s = workflow.stages.find((st) => st.id === id)!;
      return `${id} (${s.type}${s.agent ? `: ${s.agent}` : ""})`;
    });
    console.log(`  Wave ${i + 1}: ${stageNames.join(", ")}`);
  }
}

function executePreStage(
  stage: WorkflowStage,
  ctx: ExpressionContext,
  projectRoot: string,
  runId: string,
  nextRequestId: () => number,
  emitProtocol: (message: LineupProtocolMessage) => void,
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void
): StageResult | Promise<StageResult> {
  emitStatus(stage.id, `Starting ${stage.type} stage '${stage.id}'.`);

  if (stage.id === "clarify") {
    return emitGateAndWait(stage, "clarify", "Review the user's request and identify any ambiguities that need clarification.", ["No clarification needed", "Ask questions"], "No clarification needed", runId, projectRoot, nextRequestId, emitProtocol, emitStatus, true);
  }

  if (stage.id === "gate") {
    return emitGateAndWait(stage, "clarification", "Review research findings. Are there unresolved ambiguities?", ["No ambiguities \u2014 proceed", "Ask clarification questions"], "No ambiguities \u2014 proceed", runId, projectRoot, nextRequestId, emitProtocol, emitStatus, true);
  }

  // triage, research: non-interactive
  if (stage.type === "builtin") {
    emitStatus(stage.id, `Executing builtin stage '${stage.id}'.`);
  } else if (stage.type === "reasoning") {
    emitStatus(stage.id, `Executing reasoning stage '${stage.id}'.`);
  } else if (stage.type === "agent") {
    emitStatus(stage.id, `Spawning ${stage.agent ?? "unknown"} for stage '${stage.id}'.`);
  }
  emitStatus(stage.id, `Completed stage '${stage.id}'.`, true);
  return { id: stage.id, status: "complete", outputs: {} };
}

async function emitGateAndWait(
  stage: WorkflowStage,
  gateType: LineupGateType,
  question: string,
  choices: string[],
  defaultChoice: string,
  runId: string,
  projectRoot: string,
  nextRequestId: () => number,
  emitProtocol: (message: LineupProtocolMessage) => void,
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void,
  allowFreeText: boolean
): Promise<StageResult> {
  const reqId = nextRequestId();
  const pendingGate: PendingGate = {
    requestId: reqId,
    gateType,
    question,
    choices,
    defaultChoice,
    allowFreeText,
    createdAt: new Date().toISOString()
  };
  writePendingGate(runId, pendingGate, projectRoot);

  emitProtocol(
    createLineupRequest({
      method: "gate/request",
      id: reqId,
      params: { runId, stageId: stage.id, gateType, question, choices, defaultChoice, allowFreeText }
    })
  );

  const gateResponse = await waitForGateResponse(runId, reqId, projectRoot);
  emitStatus(stage.id, `Gate '${gateType}' resolved: ${gateResponse.choice}.`, true);

  return {
    id: stage.id,
    status: "complete",
    outputs: { choice: gateResponse.choice, reason: gateResponse.reason }
  };
}

async function executePlannerPhase(
  stage: WorkflowStage,
  host: HostName,
  projectRoot: string,
  artifactDir: string,
  runId: string,
  nextRequestId: () => number,
  emitProtocol: (message: LineupProtocolMessage) => void,
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void,
  hooks: RunPipelineHooks
): Promise<StageResult> {
  // Generate adapters
  const adaptersCtx: AdapterGenerationContext = {
    host,
    adaptersSourceDir: resolve(projectRoot, ".lineup-core", "adapters"),
    promptsSourceDir: resolve(projectRoot, ".lineup-core", "prompts"),
    outputDir: resolve(artifactDir, "adapters"),
    agentsDir: resolve(projectRoot, "agents"),
    modelMap: { scope_selector: "", planner: "claude-sonnet-4-6", worker: "claude-sonnet-4-6", validator: "claude-sonnet-4-6" },
  };
  const adapterPaths = generateTfAdapters(adaptersCtx);

  emitProtocol(
    createLineupRequest({
      method: "agent/spawn",
      id: nextRequestId(),
      params: {
        runId,
        stageId: stage.id,
        agent: stage.agent ?? "architect",
        prompt: `Invoke planner adapter at ${adapterPaths.planner.adapterPath}`,
        timeoutMs: 300000,
        retryAttempt: 0
      }
    })
  );

  const planPath = resolve(artifactDir, "plan.yaml");
  if (hooks.native?.planContent) {
    writeFileSync(planPath, hooks.native.planContent, "utf8");
  }

  emitStatus(stage.id, `Approved plan artifact path: ${planPath}.`, true);

  return {
    id: stage.id,
    status: "complete",
    outputs: { planPath },
  };
}

async function executeTfPhaseReference(
  workflow: WorkflowDefinition,
  host: HostName,
  projectRoot: string,
  artifactDir: string,
  runId: string,
  planPath: string,
  artifactStore: ReturnType<typeof createArtifactStore>,
  gitTreeSha: string | undefined,
  timeout: number | undefined,
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void
): Promise<{
  planRecord: StoredArtifactRecord;
  tasksRecord: StoredArtifactRecord;
  implementResult: StageResult;
  verifyResult: StageResult;
}> {
  const preparedArtifacts = prepareExecutionArtifacts({
    planPath,
    artifactStore,
    gitTreeSha
  });

  const tfCtx: TfGeneratorContext = {
    workflow,
    projectRoot,
    runId,
    adaptersDir: resolve(artifactDir, "adapters"),
    promptsDir: resolve(artifactDir, "adapters"),
    host,
    timeout,
  };
  const configYaml = generatePassthroughConfig(tfCtx, planPath);
  const configPath = resolve(artifactDir, "tf-config.yaml");
  writeFileSync(configPath, configYaml, "utf-8");

  const tfOutputDir = resolve(projectRoot, ".runner-output");
  emitStatus("implement", `Using TF reference engine with config ${configPath}.`, true);
  emitStatus("verify", `TF reference outputs would be read from ${tfOutputDir}.`, true);

  return {
    planRecord: preparedArtifacts.planRecord,
    tasksRecord: preparedArtifacts.tasksRecord,
    implementResult: {
      id: "implement",
      status: "complete",
      outputs: {
        engine: "tf",
        output_dir: tfOutputDir,
        config_path: configPath,
        tasks_path: preparedArtifacts.tasksRecord.path
      }
    },
    verifyResult: {
      id: "verify",
      status: "complete",
      outputs: {
        engine: "tf",
        output_dir: tfOutputDir,
        config_path: configPath,
        tasks_path: preparedArtifacts.tasksRecord.path
      }
    }
  };
}

function executePostStage(
  stage: WorkflowStage,
  ctx: ExpressionContext,
  projectRoot: string,
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void
): StageResult {
  emitStatus(stage.id, `Starting ${stage.type} stage '${stage.id}'.`);
  if (stage.type === "agent") {
    emitStatus(stage.id, `Spawning ${stage.agent ?? "unknown"} for stage '${stage.id}'.`);
  }
  emitStatus(stage.id, `Completed stage '${stage.id}'.`, true);
  return { id: stage.id, status: "complete", outputs: {} };
}

function cleanup(artifactDir: string, cacheDir: string, success: boolean): void {
  // Clean cache only on success
  if (success && existsSync(cacheDir)) {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {}
  }
}
