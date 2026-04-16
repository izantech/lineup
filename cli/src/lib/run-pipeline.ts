import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";
import { stringify as stringifyYaml } from "yaml";
import type { RunOptions, WorkflowDefinition, WorkflowStage } from "./types.js";
import type { LocalAgentRunner } from "./agent-runner.js";
import type { HostName } from "./constants.js";
import { createArtifactStore, type StoredArtifactRecord } from "./artifact-store.js";
import {
  applyWorkspacePatch,
  executeNativeExecutor,
  normalizePlanForStage,
  normalizeTaskExecutionResult,
  normalizeReviewArtifact,
  prepareExecutionArtifacts,
  type NativeExecutionDriver,
  type NativeTaskExecutionResult,
  waitForResponseFile
} from "./executor.js";
import {
  createLineupNotification,
  createLineupRequest,
  encodeNdjsonMessage,
  type LineupGateType,
  type LineupProtocolMessage
} from "./protocol.js";
import { writePendingGate, waitForGateResponse, GateTimeoutError, type GateResponse, type PendingGate } from "./gate-store.js";
import { handleInteractiveGate } from "./interactive-gate.js";
import {
  lineupArtifactStoreDir,
  lineupRunArtifactsDir,
  lineupRunDebugBundleFile,
  lineupRunDir,
  lineupRuntimeLockFile,
  packageRoot
} from "./paths.js";
import {
  appendPipelineCompletedStage,
  clearPipelinePendingGate,
  defaultPipelineState,
  loadPipelineState,
  markPipelineCurrentStage,
  markPipelineTimestamps,
  savePipelineState,
  setPipelinePendingGate,
  updatePipelineStageState,
  updatePipelineArtifactHashes
} from "./state.js";
import {
  parseWorkflowYaml,
  parseRestrictedYaml,
  selectRestrictedYamlDocument,
  validateTacticYaml,
  validateAgentOutputYaml,
  validatePlanYaml,
  type AgentOutputKind
} from "./validation.js";
import { tacticToWorkflow, type TacticDefinition } from "./tactic-convert.js";
import { validateWorkflowDag, resolveExecutionOrder } from "./workflow.js";
import { evaluateExpressionSafe, type ExpressionContext } from "./expression.js";
import { runVerificationHooks, type VerificationResult } from "./verification.js";
import { notifyPipelineComplete } from "./notify.js";
import { repairJsonOutput, repairYamlOutput } from "./llm-output-repair.js";
import { CliError } from "./errors.js";
import { inspectGitProject } from "./git.js";
import { DEFAULT_OLLAMA, readOllamaConfig, requireOllamaModel } from "./config.js";
import { buildAgentSystemPrompt } from "./prompt-builder.js";
import { HumanRunRenderer } from "./ui/runtime-screen.js";


export type PipelineResult = {
  runId: string;
  status: "success" | "failed" | "aborted" | "blocked";
  stageResults: Map<string, StageResult>;
  outputDir?: string;
};

type StageResult = {
  id: string;
  status: "complete" | "skipped" | "failed" | "blocked";
  outputs: Record<string, unknown>;
  duration?: number;
};

const DEFAULT_LOCAL_AGENT_TIMEOUT_MS = 300_000;
const OLLAMA_HOST_INTEGRATION_TIMEOUT_MS = 600_000;

type RuntimeLockRecord = {
  runId?: string;
  workflow?: string;
  created_at?: string;
  pid?: number;
};

export type RunPipelineHooks = {
  runId?: string;
  localAgentRunner?: LocalAgentRunner;
  emitProtocolToStdout?: boolean;
  onProtocolMessage?: (message: LineupProtocolMessage) => void;
  native?: {
    driver?: NativeExecutionDriver;
    planContent?: string;
  };
};

/**
 * Run the Lineup pipeline: orchestration stages → native execution → post-pipeline stages.
 */
export async function runPipeline(options: RunOptions, hooks: RunPipelineHooks = {}): Promise<PipelineResult> {
  const runMode = options.mode ?? (process.stdin.isTTY && process.stdout.isTTY ? "human" : "host");
  const projectRoot = resolve(".");
  const localAgentRunner = hooks.localAgentRunner;
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
  validateProjectPrerequisites(projectRoot, workflow, Boolean(options.dryRun));

  // 3. Generate run ID (6 char hex from random bytes)
  const runId =
    hooks.runId ??
    createHash("sha256")
      .update(Date.now().toString() + Math.random().toString())
      .digest("hex")
      .slice(0, 6);

  // 4. Setup directories
  const runRoot = lineupRunDir(runId, projectRoot);
  const artifactDir = lineupRunArtifactsDir(runId, projectRoot);
  const localAgentTimeoutMs = localAgentRunner
    ? resolveLocalAgentTimeoutMs(projectRoot, localAgentRunner.host, options.timeout)
    : DEFAULT_LOCAL_AGENT_TIMEOUT_MS;
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
    markPipelineTimestamps(
      defaultPipelineState({
        runId,
        workflow: workflowPath,
        taskPrompt: options.prompt,
        executionHost: options.executionHost ?? options.host,
        runnerHost: options.runnerHost ?? options.host,
        forceOllamaBackend: options.forceOllamaBackend,
        ollamaModel: options.model,
        gateTimeoutSeconds: options.gateTimeout,
        gitTreeSha,
        status: "running"
      }),
      "start"
    ),
    projectRoot
  );
  const humanRenderer = runMode === "human" ? new HumanRunRenderer(workflow, projectRoot) : null;

  const emitProtocol = (message: LineupProtocolMessage): void => {
    protocolMessages.push(message);
    hooks.onProtocolMessage?.(message);
    if (runMode === "host" && hooks.emitProtocolToStdout !== false) {
      process.stdout.write(`${encodeNdjsonMessage(message)}\n`);
    }
  };

  const emitStatus = (stageId: string, chunk: string, final = false): void => {
    pipelineState = savePipelineState(
      updatePipelineStageState(
        pipelineState,
        stageId,
        classifyStageStatusUpdate(chunk, final, {
          ...resolveRetryDisplay(stageId, pipelineState)
        })
      ),
      projectRoot
    );
    protocolSequence += 1;
    const message = createLineupNotification({
      method: "agent/output",
      params: {
        runId,
        stageId,
        channel: "status",
        sequence: protocolSequence,
        chunk,
        ...(final ? { final: true } : {})
      }
    });
    emitProtocol(message);
    humanRenderer?.update(stageId, chunk, pipelineState, final);
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
  let lockAcquired = false;

  try {
    acquireRuntimeLock(projectRoot, runId, workflowPath);
    lockAcquired = true;

    const cliOllamaOverride = options.model || options.forceOllamaBackend
      ? {
          ollama: {
            ...(options.forceOllamaBackend ? { enabled: true, scope: "full" as const } : {}),
            ...(options.model ? { model: options.model } : {}),
            ...(options.forceOllamaBackend
              ? {
                  hostIntegration: {
                    enabled: true,
                    strategy: "launch" as const
                  }
                }
              : {})
          }
        }
      : undefined;
    const ollama = readOllamaConfig({
      projectRoot,
      ...(localAgentRunner?.host ?? options.host ? { host: localAgentRunner?.host ?? options.host } : {}),
      ...(cliOllamaOverride ? { cli: cliOllamaOverride } : {})
    });
    if (ollama?.enabled) {
      requireOllamaModel({
        projectRoot,
        ...(localAgentRunner?.host ?? options.host ? { host: localAgentRunner?.host ?? options.host } : {}),
        ...(cliOllamaOverride ? { cli: cliOllamaOverride } : {})
      }, "Ollama is enabled but no model is configured. Pass --model <name> or set ollama.model in .lineup/config.yaml.");
    }

    // 5. Resolve execution order
    const waves = resolveExecutionOrder(workflow);
    const expressionCtx: ExpressionContext = {
      stages: {},
      variables: { task_prompt: options.prompt ?? "" }
    };

    // 7. Dry-run: just print the plan
    if (options.dryRun) {
      printExecutionPlan(waves, workflow);
      return { runId, status: "success", stageResults };
    }

    // 8. Execute stages in wave order
    const postStages = new Set(["document"]);

    for (const wave of waves) {
      for (const stageId of wave) {
        const stage = workflow.stages.find((s) => s.id === stageId)!;
        pipelineState = savePipelineState(
          updatePipelineStageState(
            markPipelineCurrentStage(clearPipelinePendingGate(pipelineState), stageId),
            stageId,
            {
              status: "running",
              last_message: `Starting ${stage.type} stage '${stage.id}'.`,
              ...resolveRetryDisplay(stageId, pipelineState)
            }
          ),
          projectRoot
        );
        humanRenderer?.beginStage(stageId, pipelineState);

        // Evaluate condition/skip_if
        if (stage.condition && !evaluateExpressionSafe(stage.condition, expressionCtx, true)) {
          emitStatus(stageId, `Skipped stage '${stageId}' because condition evaluated to false.`, true);
          stageResults.set(stageId, { id: stageId, status: "skipped", outputs: {} });
          expressionCtx.stages[stageId] = { outputs: {} };
          pipelineState = savePipelineState(appendPipelineCompletedStage(pipelineState, stageId), projectRoot);
          continue;
        }
        if (stage.skip_if && evaluateExpressionSafe(stage.skip_if, expressionCtx, false)) {
          emitStatus(stageId, `Skipped stage '${stageId}' because skip_if evaluated to true.`, true);
          stageResults.set(stageId, { id: stageId, status: "skipped", outputs: {} });
          expressionCtx.stages[stageId] = { outputs: {} };
          pipelineState = savePipelineState(appendPipelineCompletedStage(pipelineState, stageId), projectRoot);
          continue;
        }

        const isPrePipelineStage =
          stage.id === "clarify" ||
          stage.id === "gate" ||
          stage.type === "builtin" ||
          (stage.type === "agent" &&
            stage.id !== "plan" &&
            stage.id !== "implement" &&
            stage.id !== "verify" &&
            !postStages.has(stage.id));

        if (isPrePipelineStage) {
          // Pre-pipeline: output protocol messages for host orchestrator
          const result = await executePreStage(
            stage,
            expressionCtx,
            projectRoot,
            localAgentRunner?.host ?? options.host,
            artifactDir,
            localAgentTimeoutMs,
            runId,
            options.prompt ?? "",
            () => protocolRequestId++,
            emitProtocol,
            emitStatus,
            options.gateTimeout !== undefined ? options.gateTimeout * 1000 : undefined,
            options.validateOutputs !== false,
            runMode,
            localAgentRunner,
            options.forceOllamaBackend ?? false,
            options.model,
            (pendingGate, pendingStageId, timeoutMs) => {
              pipelineState = savePipelineState(
                recordPendingGateState(
                  pipelineState,
                  pendingGate,
                  timeoutMs ? Math.round(timeoutMs / 1000) : undefined
                ),
                projectRoot
              );
              humanRenderer?.beginStage(pendingStageId, pipelineState);
            },
            (resolvedGateType, resolvedGate, resolvedStageId) => {
              pipelineState = savePipelineState(
                updatePipelineStageState(
                  {
                    ...clearPipelinePendingGate(pipelineState),
                    status: "running"
                  },
                  resolvedStageId,
                  {
                    status: "running",
                    last_message: `Gate '${resolvedGateType}' resolved: ${resolvedGate.choice}.`,
                    ...resolveRetryDisplay(resolvedStageId, pipelineState)
                  }
                ),
                projectRoot
              );
            },
            (error, blockedStageId, timeoutMs) => {
              pipelineState = recordGateTimeout(
                pipelineState,
                projectRoot,
                blockedStageId,
                error,
                timeoutMs ? Math.round(timeoutMs / 1000) : undefined
              );
            },
            () => humanRenderer?.pause(),
            () => humanRenderer?.resume(pipelineState)
          );
          stageResults.set(stageId, result);
          expressionCtx.stages[stageId] = { outputs: result.outputs };
          if (result.status === "blocked") {
            pipelineState = savePipelineState({ ...pipelineState, status: "blocked" }, projectRoot);
            await humanRenderer?.finish(pipelineState, `Run ${runId} is blocked. Resume with \`lineup resume ${runId}\` when ready.`);
            return { runId, status: "blocked", stageResults };
          }

        } else if (stageId === "plan") {
          // Phase 1: invoke planner adapter directly
          const planResult = await executePlannerPhase(
            stage,
            expressionCtx,
            projectRoot,
            localAgentRunner?.host ?? options.host,
            artifactDir,
            localAgentTimeoutMs,
            runId,
            options.prompt ?? "",
            () => protocolRequestId++,
            emitProtocol,
            emitStatus,
            hooks,
            runMode,
            localAgentRunner,
            options.forceOllamaBackend ?? false,
            options.model
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
            const planPath = expressionCtx.stages["plan"]?.outputs?.planPath as string | undefined;
            const planContext = buildPlanApprovalContext(planPath);
            const reqId = protocolRequestId++;
            const pendingGate: PendingGate = {
              requestId: reqId,
              stageId,
              gateType: "approval",
              question: "Approve the generated plan?",
              choices: ["approve", "reject"],
              defaultChoice: "approve",
              ...(planContext ? { context: planContext } : {}),
              createdAt: new Date().toISOString()
            };
            pipelineState = savePipelineState(
              recordPendingGateState(pipelineState, pendingGate, options.gateTimeout),
              projectRoot
            );
            let gateResponse;
            if (runMode === "human") {
              gateResponse = await handleInteractiveGate(pendingGate, {
                onPromptStart: () => humanRenderer?.pause(),
                onPromptEnd: () => humanRenderer?.resume(pipelineState)
              });
            } else {
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
                    defaultChoice: "approve",
                    ...(planContext ? { context: planContext } : {})
                  }
                })
              );

              // Block until skill responds via `lineup gate respond`
              try {
                gateResponse = await waitForGateResponse(runId, reqId, projectRoot, options.gateTimeout !== undefined ? options.gateTimeout * 1000 : undefined, "approval");
              } catch (err) {
                if (err instanceof GateTimeoutError) {
                  const blockedResult: StageResult = { id: stageId, status: "blocked", outputs: {} };
                  stageResults.set(stageId, blockedResult);
                  pipelineState = recordGateTimeout(
                    pipelineState,
                    projectRoot,
                    stageId,
                    err,
                    options.gateTimeout
                  );
                  await humanRenderer?.finish(pipelineState, `Run ${runId} is blocked. Resume with \`lineup resume ${runId}\` when ready.`);
                  return { runId, status: "blocked", stageResults };
                }
                throw err;
              }
            }
            pipelineState = savePipelineState(
              updatePipelineStageState(
                {
                  ...clearPipelinePendingGate(pipelineState),
                  status: "running"
                },
                stageId,
                {
                  status: "running",
                  last_message: `Plan approval decision received: ${gateResponse.choice}.`,
                  ...resolveRetryDisplay(stageId, pipelineState)
                }
              ),
              projectRoot
            );
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

            {
              emitStatus("verify", "Running verification hooks...");
              let verificationResults: VerificationResult[] = [];
              try {
                verificationResults = await runVerificationHooks(projectRoot);
                const passed = verificationResults.filter((r) => r.exitCode === 0).length;
                const failed = verificationResults.filter((r) => r.exitCode !== 0).length;
                if (verificationResults.length > 0) {
                  emitStatus("verify", `Verification: ${passed}/${verificationResults.length} passed${failed > 0 ? `, ${failed} failed` : ""}.`);
                } else {
                  emitStatus("verify", "Verification: no hooks detected.");
                }
              } catch {
                emitStatus("verify", "Verification hooks failed to run.");
              }

              const nativeResult = await executeNativeExecutor({
                runId,
                projectRoot,
                host: localAgentRunner?.host ?? options.host,
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
                driver: hooks.native?.driver ?? createHumanNativeDriver(localAgentRunner),
                implementMethod: options.implementMethod,
                verificationResults
              });

              const reviewStatus = nativeResult.verifyResult.outputs.status as string | undefined;
              if (reviewStatus === "FAIL" || reviewStatus === "PASS_WITH_WARNINGS") {
                const reviewSummary = (nativeResult.verifyResult.outputs.summary as string | undefined) ?? "Verification failed.";
                const reqId = protocolRequestId++;
                const pendingGate: PendingGate = {
                  requestId: reqId,
                  stageId: "verify",
                  gateType: "verify-decision",
                  question: reviewSummary,
                  choices: ["retry", "accept", "abort"],
                  defaultChoice: "retry",
                  createdAt: new Date().toISOString()
                };

                let gateResponse;
                if (runMode === "human") {
                  pipelineState = savePipelineState(
                    recordPendingGateState(pipelineState, pendingGate, options.gateTimeout),
                    projectRoot
                  );
                  gateResponse = await handleInteractiveGate(pendingGate, {
                    onPromptStart: () => humanRenderer?.pause(),
                    onPromptEnd: () => humanRenderer?.resume(pipelineState)
                  });
                } else {
                  pipelineState = savePipelineState(
                    recordPendingGateState(pipelineState, pendingGate, options.gateTimeout),
                    projectRoot
                  );
                  writePendingGate(runId, pendingGate, projectRoot);
                  emitProtocol(
                    createLineupRequest({
                      method: "gate/request",
                      id: reqId,
                      params: {
                        runId,
                        stageId: "verify",
                        gateType: "verify-decision",
                        question: reviewSummary,
                        choices: ["retry", "accept", "abort"],
                        defaultChoice: "retry"
                      }
                    })
                  );
                  try {
                    gateResponse = await waitForGateResponse(runId, reqId, projectRoot, options.gateTimeout !== undefined ? options.gateTimeout * 1000 : undefined, "verify-decision");
                  } catch (err) {
                    if (err instanceof GateTimeoutError) {
                      stageResults.set("implement", nativeResult.implementResult);
                      stageResults.set("verify", { id: "verify", status: "blocked", outputs: {} });
                      pipelineState = recordGateTimeout(
                        pipelineState,
                        projectRoot,
                        "verify",
                        err,
                        options.gateTimeout
                      );
                      await humanRenderer?.finish(pipelineState, `Run ${runId} is blocked. Resume with \`lineup resume ${runId}\` when ready.`);
                      return { runId, status: "blocked", stageResults };
                    }
                    throw err;
                  }
                }
                pipelineState = savePipelineState(
                  updatePipelineStageState(
                    {
                      ...clearPipelinePendingGate(pipelineState),
                      status: "running"
                    },
                    "verify",
                    {
                      status: "running",
                      last_message: `Verify decision received: ${gateResponse.choice}.`,
                      ...resolveRetryDisplay("verify", pipelineState)
                    }
                  ),
                  projectRoot
                );

                if (gateResponse.choice === "retry") {
                  const retryResult = await executeNativeExecutor({
                    runId,
                    projectRoot,
                    host: localAgentRunner?.host ?? options.host,
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
                    driver: hooks.native?.driver ?? createHumanNativeDriver(localAgentRunner),
                    implementMethod: options.implementMethod,
                    verificationResults,
                    taskFilter: nativeResult.failedTaskIds
                  });
                  await applyWorkspacePatch(projectRoot, retryResult.workspacePatchPath);
                  pipelineState = savePipelineState(
                    updatePipelineArtifactHashes(pipelineState, {
                      plan: retryResult.planRecord.sha256,
                      tasks: retryResult.tasksRecord.sha256,
                      review: retryResult.reviewRecord.sha256
                    }),
                    projectRoot
                  );
                  stageResults.set("implement", retryResult.implementResult);
                  stageResults.set("verify", retryResult.verifyResult);
                  expressionCtx.stages["implement"] = { outputs: retryResult.implementResult.outputs };
                  expressionCtx.stages["verify"] = { outputs: retryResult.verifyResult.outputs };
                } else if (gateResponse.choice === "accept") {
                  await applyWorkspacePatch(projectRoot, nativeResult.workspacePatchPath);
                  pipelineState = savePipelineState(
                    updatePipelineArtifactHashes(pipelineState, {
                      plan: nativeResult.planRecord.sha256,
                      tasks: nativeResult.tasksRecord.sha256,
                      review: nativeResult.reviewRecord.sha256
                    }),
                    projectRoot
                  );
                  stageResults.set("implement", nativeResult.implementResult);
                  stageResults.set("verify", {
                    ...nativeResult.verifyResult,
                    outputs: { ...nativeResult.verifyResult.outputs, warnings: true }
                  });
                  expressionCtx.stages["implement"] = { outputs: nativeResult.implementResult.outputs };
                  expressionCtx.stages["verify"] = { outputs: { ...nativeResult.verifyResult.outputs, warnings: true } };
                } else {
                  stageResults.set("implement", nativeResult.implementResult);
                  stageResults.set("verify", { id: "verify", status: "failed", outputs: nativeResult.verifyResult.outputs });
                  pipelineState = savePipelineState({ ...pipelineState, status: "failed" }, projectRoot);
                  throw new Error(`Verification aborted: ${reviewSummary}`);
                }
              } else {
                await applyWorkspacePatch(projectRoot, nativeResult.workspacePatchPath);
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
          }
          // verify is handled together with implement in the selected engine

        } else if (postStages.has(stageId)) {
          const result = executePostStage(stage, expressionCtx, projectRoot, emitStatus, options.validateOutputs !== false);
          stageResults.set(stageId, result);
        }

        pipelineState = savePipelineState(
          finalizeStageState(appendPipelineCompletedStage(pipelineState, stageId), stageId, stageResults.get(stageId)),
          projectRoot
        );
      }
    }

    const completionSummary = "Pipeline completed successfully.";
    emitProtocol(
      createLineupNotification({
        method: "pipeline/complete",
        params: {
          runId,
          status,
          completedAt: new Date().toISOString(),
          summary: completionSummary
        }
      })
    );
    persistProtocolArtifact();
    pipelineState = savePipelineState(
      markPipelineTimestamps(
        {
          ...clearPipelinePendingGate(markPipelineCurrentStage(pipelineState, null)),
          status: "succeeded"
        },
        "finish"
      ),
      projectRoot
    );
    await humanRenderer?.finish(pipelineState, completionSummary);
    if (runMode === "human") {
      notifyPipelineComplete(runId, "succeeded", "Pipeline completed successfully.");
    }
    // 10. Cleanup on success
    cleanup(artifactDir, cacheDir, true);
  } catch (error) {
    status = "failed";
    const errorSummary = error instanceof Error ? error.message : String(error);
    const preserveRecoveryMessage =
      error instanceof CliError && error.message.includes("Another mutating Lineup run is already active");
    const failureMessage = preserveRecoveryMessage ? errorSummary : buildPipelineFailureMessage(runId, errorSummary);
    emitProtocol(
      createLineupNotification({
        method: "pipeline/complete",
        params: {
          runId,
          status,
          completedAt: new Date().toISOString(),
          summary: failureMessage
        }
      })
    );
    persistProtocolArtifact();
    const failingStageId = pipelineState.current_stage;
    const failedState = clearPipelinePendingGate(
      failingStageId
        ? updatePipelineStageState(pipelineState, failingStageId, {
            status: "failed",
            last_message: errorSummary,
            ...resolveRetryDisplay(failingStageId, pipelineState)
          })
        : pipelineState
    );
    pipelineState = savePipelineState(
      markPipelineTimestamps(
        {
          ...markPipelineCurrentStage(failedState, null),
          status: "failed"
        },
        "finish"
      ),
      projectRoot
    );
    await humanRenderer?.finish(pipelineState, failureMessage);
    if (runMode === "human") {
      notifyPipelineComplete(runId, "failed", error instanceof Error ? error.message : String(error));
    }
    writeDebugBundle(projectRoot, runId, {
      run_id: runId,
      workflow: workflowPath,
      engine: "native",
      error: error instanceof Error ? error.message : String(error),
      stage_results: Object.fromEntries(stageResults.entries()),
      protocol_messages: protocolMessages,
      pipeline_state: pipelineState
    });
    // Cleanup on error (keep cache for debugging)
    cleanup(artifactDir, cacheDir, false);
    if (preserveRecoveryMessage && error instanceof CliError) {
      error.alreadyReported = runMode === "human";
      throw error;
    }
    throw error instanceof CliError
      ? new CliError(failureMessage, { code: error.code, exitCode: error.exitCode, alreadyReported: runMode === "human" })
      : new CliError(failureMessage, { code: "command_failed", alreadyReported: runMode === "human" });
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
  throw new CliError(
    "No workflow file found. Run `lineup init` to scaffold .lineup-core/workflows/full-pipeline.yaml, or pass --workflow <path>.",
    { code: "artifact_validation_failed" }
  );
}

function resolveTacticPath(name: string): string {
  const candidates = [
    resolve(".lineup", "tactics", `${name}.yaml`),
    resolve("tactics", `${name}.yaml`),
    resolve(packageRoot(), "tactics", `${name}.yaml`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`Tactic '${name}' not found. Searched: ${candidates.join(", ")}`);
}

function appendPipelineErrorRecord(
  state: ReturnType<typeof defaultPipelineState>,
  error: { code: string; message: string; details?: unknown }
) {
  return {
    ...state,
    errors: [...(state.errors ?? []), error]
  };
}

function resolveRetryDisplay(stageId: string, state: ReturnType<typeof defaultPipelineState>): { attempt?: number; max_attempts?: number } {
  const retryState = state.retry_state?.[stageId];
  if (!retryState) {
    return {};
  }

  return {
    attempt: Math.max(retryState.attempt + 1, 1),
    max_attempts: retryState.max_attempts
  };
}

function classifyStageStatusUpdate(
  chunk: string,
  final: boolean,
  retryDisplay: { attempt?: number; max_attempts?: number }
): {
  status: "running" | "succeeded";
  last_message: string;
  attempt?: number;
  max_attempts?: number;
} {
  return {
    status: final ? "succeeded" : "running",
    last_message: chunk,
    ...retryDisplay
  };
}

function recordPendingGateState(
  state: ReturnType<typeof defaultPipelineState>,
  pendingGate: PendingGate,
  timeoutSeconds?: number
) {
  const expiresAt =
    timeoutSeconds !== undefined
      ? new Date(Date.parse(pendingGate.createdAt) + timeoutSeconds * 1000).toISOString()
      : undefined;

  return setPipelinePendingGate(
    updatePipelineStageState(
      {
        ...state,
        status: "blocked"
      },
      pendingGate.stageId ?? "gate",
      {
        status: "blocked",
        last_message: `Awaiting ${pendingGate.gateType} response.`,
        ...resolveRetryDisplay(pendingGate.stageId ?? "gate", state)
      }
    ),
    {
      request_id: String(pendingGate.requestId),
      stage_id: pendingGate.stageId ?? "gate",
      gate_type: pendingGate.gateType,
      question: pendingGate.question,
      choices: [...pendingGate.choices],
      ...(pendingGate.defaultChoice ? { default_choice: pendingGate.defaultChoice } : {}),
      created_at: pendingGate.createdAt,
      ...(expiresAt ? { expires_at: expiresAt } : {})
    }
  );
}

function finalizeStageState(
  state: ReturnType<typeof defaultPipelineState>,
  stageId: string,
  result: StageResult | undefined
) {
  if (!result) {
    return state;
  }

  const current = state.stage_state?.[stageId];
  if (current?.status === "failed" || current?.status === "blocked") {
    return state;
  }

  if (result.status === "failed") {
    return updatePipelineStageState(state, stageId, {
      status: "failed",
      last_message: current?.last_message ?? `Stage '${stageId}' failed.`,
      ...resolveRetryDisplay(stageId, state)
    });
  }

  if (result.status === "blocked") {
    return updatePipelineStageState(state, stageId, {
      status: "blocked",
      last_message: current?.last_message ?? `Stage '${stageId}' is blocked.`,
      ...resolveRetryDisplay(stageId, state)
    });
  }

  if (current?.status === "succeeded" && current.finished_at) {
    return state;
  }

  return updatePipelineStageState(state, stageId, {
    status: "succeeded",
    last_message: current?.last_message ?? `Completed stage '${stageId}'.`,
    ...resolveRetryDisplay(stageId, state)
  });
}

function recordGateTimeout(
  state: ReturnType<typeof defaultPipelineState>,
  projectRoot: string,
  stageId: string,
  error: GateTimeoutError,
  timeoutSeconds?: number
) {
  return savePipelineState(
    appendPipelineErrorRecord(
      updatePipelineStageState(
        {
          ...state,
          status: "blocked"
        },
        stageId,
        {
          status: "blocked",
          last_message: `${error.gateType} gate timed out while waiting for a response.`,
          ...resolveRetryDisplay(stageId, state)
        }
      ),
      {
        code: "gate_timeout",
        message: `${error.gateType} gate timed out while waiting for a response.`,
        details: {
          stage_id: stageId,
          request_id: error.requestId,
          timeout_seconds: timeoutSeconds
        }
      }
    ),
    projectRoot
  );
}

function buildRuntimeLockError(lockPath: string, current?: RuntimeLockRecord, currentStatus?: string): CliError {
  if (current?.runId) {
    const statusDetail = currentStatus ? ` (${currentStatus})` : "";
    return new CliError(
      `Another mutating Lineup run is already active${statusDetail}: ${current.runId}. Inspect with \`lineup show ${current.runId}\`, cancel it with \`lineup cancel ${current.runId}\`, or remove ${lockPath} only if that lock is stale.`,
      { code: "command_failed" }
    );
  }

  return new CliError(
    `Another mutating Lineup run is already active. Inspect the current run, or remove ${lockPath} only if it is stale.`,
    { code: "command_failed" }
  );
}

function buildPipelineFailureMessage(runId: string, errorSummary: string): string {
  return `Run ${runId} failed: ${errorSummary}. Inspect with \`lineup show ${runId}\` or \`lineup logs ${runId}\`. Retry with \`lineup resume ${runId} --retry-failed\` when appropriate.`;
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
    let current: RuntimeLockRecord | undefined;
    let currentStatus: string | undefined;

    try {
      current = JSON.parse(readFileSync(lockPath, "utf8")) as RuntimeLockRecord;
      if (current.runId) {
        currentStatus = loadPipelineState(current.runId, projectRoot)?.status;
      }
    } catch {
      // fall through to the generic guidance
    }

    throw buildRuntimeLockError(lockPath, current, currentStatus);
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
  return inspectGitProject(projectRoot).treeSha;
}

function printExecutionPlan(waves: string[][], workflow: WorkflowDefinition): void {
  process.stderr.write("LINEUP:pipeline:dry-run\n");
  for (let i = 0; i < waves.length; i++) {
    const stageNames = waves[i].map((id) => {
      const s = workflow.stages.find((st) => st.id === id)!;
      return `${id} (${s.type}${s.agent ? `: ${s.agent}` : ""})`;
    });
    process.stderr.write(`  Wave ${i + 1}: ${stageNames.join(", ")}\n`);
  }
}

function createHumanNativeDriver(localAgentRunner?: LocalAgentRunner): NativeExecutionDriver | undefined {
  if (!localAgentRunner) {
    return undefined;
  }

  return {
    async executeTask(input) {
      const result = await localAgentRunner.invoke({
        projectRoot: input.workspaceRoot,
        workingDirectory: input.workspaceRoot,
        agent: "developer",
        prompt: input.prompt,
        timeoutMs: input.timeoutMs,
        addDirs: [input.runRoot, input.artifactDir],
        outputSchemaPath: resolveArtifactSchemaPath("developer", "ImplementationState"),
        tracePrefixPath: resolve(input.runRoot, "host", `implement-${taskTraceLabel(input.task.id)}-${localAgentRunner.host}`)
      });
      return normalizeTaskExecutionResult(result.content, input.task, `local-agent:${localAgentRunner.host}:${input.task.id}`);
    },
    async executeReview(input) {
      const reviewPath = resolve(input.artifactDir, "review.yaml");
      const result = await localAgentRunner.invoke({
        projectRoot: input.workspaceRoot,
        workingDirectory: input.workspaceRoot,
        agent: "reviewer",
        prompt: input.prompt,
        timeoutMs: input.timeoutMs,
        addDirs: [input.runRoot, input.artifactDir],
        outputSchemaPath: resolveArtifactSchemaPath("reviewer", "Review"),
        expectedOutputPath: reviewPath,
        tracePrefixPath: resolve(input.runRoot, "host", `verify-reviewer-${localAgentRunner.host}`)
      });
      return {
        reviewYaml: normalizeReviewArtifact(result.content, reviewPath)
      };
    }
  };
}

function selectStageInput(stage: WorkflowStage, ctx: ExpressionContext): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const input of stage.inputs ?? []) {
    const sourceOutputs = (ctx.stages[input.source]?.outputs ?? {}) as Record<string, unknown>;
    const selected: Record<string, unknown> = {};

    for (const field of input.fields) {
      if (field in sourceOutputs) {
        selected[field] = sourceOutputs[field];
      }
    }

    if (input.via === "file-reference" && typeof sourceOutputs.artifactPath === "string") {
      selected.artifactPath = sourceOutputs.artifactPath;
    }

    if (Object.keys(selected).length > 0) {
      payload[input.source] = selected;
      continue;
    }

    if (input.fallback) {
      payload[input.source] = { fallback: input.fallback };
    }
  }

  return payload;
}

function formatStageContext(stage: WorkflowStage, ctx: ExpressionContext): string {
  const payload = selectStageInput(stage, ctx);
  const lines: string[] = [];

  for (const [source, value] of Object.entries(payload)) {
    lines.push(`${source}:`);

    if (value && typeof value === "object" && !Array.isArray(value) && "artifactPath" in value && typeof (value as { artifactPath?: unknown }).artifactPath === "string") {
      lines.push(`Read artifact: ${(value as { artifactPath: string }).artifactPath}`);
      const copy = { ...(value as Record<string, unknown>) };
      delete copy.artifactPath;
      if (Object.keys(copy).length > 0) {
        lines.push(JSON.stringify(copy, null, 2));
      }
    } else {
      lines.push(JSON.stringify(value, null, 2));
    }

    lines.push("");
  }

  return lines.join("\n").trim();
}

function formatCompactStageContext(stage: WorkflowStage, ctx: ExpressionContext): string {
  const payload = selectStageInput(stage, ctx);
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : "";
}

function describeStageOutputs(stage: WorkflowStage): string {
  const entries = Object.entries(resolveEffectiveStageOutputs(stage));
  if (entries.length === 0) {
    return "- Return structured output only.";
  }

  return entries
    .map(([name, def]) => `- ${name}: ${def.type}${def.max_length ? ` (max ${def.max_length})` : ""}`)
    .join("\n");
}

function describeCompactStageOutputs(stage: WorkflowStage): string {
  if (stage.agent === "architect") {
    return "summary, approaches, recommendation, changes (non-empty array of {file, change, rationale}), acceptance_criteria, risks";
  }

  const entries = Object.entries(resolveEffectiveStageOutputs(stage));
  if (entries.length === 0) {
    return "structured payload only";
  }

  return entries.map(([name]) => name).join(", ");
}

function shouldUseCompactOllamaHostPrompt(projectRoot: string, host?: HostName): boolean {
  if (!host) {
    return false;
  }

  const ollama = readOllamaConfig({ projectRoot, host });
  return Boolean(ollama?.hostIntegration?.enabled);
}

function buildCompactStageExtraInstructions(input: {
  stage: WorkflowStage;
  taskPrompt: string;
  ctx: ExpressionContext;
  outputSchema: string;
  host?: HostName;
}): string {
  const lines = [
    "Lineup stage:",
    `- id: ${input.stage.id}`,
    `- schema: ${input.outputSchema}`,
    "- Return only the final structured payload with no wrapper prose or markdown.",
    `- Required fields: ${describeCompactStageOutputs(input.stage)}`,
    `- Request: ${formatStageTaskPrompt(input.stage, input.taskPrompt)}`
  ];

  const compactContext = formatCompactStageContext(input.stage, input.ctx);
  if (compactContext) {
    lines.push(`- Context JSON: ${compactContext}`);
  }

  if (input.host === "opencode" && input.stage.agent === "researcher") {
    lines.push("- OpenCode research: emit exactly one YAML Research document, stay read-only, and do not call edit/write or mutating bash commands.");
  }

  return lines.join("\n");
}

function formatStageTaskPrompt(stage: WorkflowStage, taskPrompt: string): string {
  const normalizedTaskPrompt = taskPrompt.trim();
  if (stage.agent !== "researcher") {
    return normalizedTaskPrompt;
  }

  if (normalizedTaskPrompt.length === 0) {
    return "Research only the repository context needed for later stages. Do not attempt to create files, logos, assets, code changes, or other final deliverables during this stage."
  }

  return [
    "Research only the repository context needed to support the overall task later.",
    "Do not attempt to create files, logos, assets, code changes, or other final deliverables during this stage.",
    `Overall task: ${normalizedTaskPrompt}`
  ].join(" ")
}

function resolveEffectiveStageOutputs(stage: WorkflowStage): Record<string, { type: string; max_length?: number }> {
  if (stage.outputs && Object.keys(stage.outputs).length > 0) {
    return stage.outputs;
  }

  if (stage.agent === "researcher") {
    return {
      what_found: { type: "object" },
      how_it_works: { type: "string" },
      constraints: { type: "object" },
      gaps: { type: "object" }
    };
  }

  return {};
}

function loadOutputTemplate(projectRoot: string, agentName: string): string | null {
  const candidates = [
    resolve(projectRoot, "templates", `${agentName}.yaml`),
    resolve(packageRoot(), "templates", `${agentName}.yaml`)
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8").trim();
    }
  }

  return null;
}

function resolveArtifactSchemaPath(agentName: string, outputSchema: string): string | undefined {
  const packageSchemas = resolve(packageRoot(), "schemas");
  if (outputSchema === "Plan") {
    return resolve(packageSchemas, "yaml", "v3", "plan.schema.json");
  }
  if (outputSchema === "ImplementationState") {
    return resolve(packageSchemas, "json", "implementation-state.schema.json");
  }
  if (outputSchema === "Review") {
    return resolve(packageSchemas, "yaml", "v3", "review.schema.json");
  }
  if (agentName === "researcher") {
    return resolve(packageSchemas, "yaml", "agent-output", "researcher.schema.json");
  }
  return undefined;
}

function buildStageAgentPrompt(input: {
  stage: WorkflowStage;
  projectRoot: string;
  host?: HostName;
  forceOllamaBackend?: boolean;
  ollamaModel?: string;
  taskPrompt: string;
  ctx: ExpressionContext;
  outputSchema: string;
  outputPath?: string;
}): string {
  const agentName = input.stage.agent ?? "architect";
  const outputTemplate = loadOutputTemplate(input.projectRoot, agentName);
  const useCompactContract = input.forceOllamaBackend || shouldUseCompactOllamaHostPrompt(input.projectRoot, input.host);
  const extraInstructions = useCompactContract
    ? buildCompactStageExtraInstructions({
        stage: input.stage,
        taskPrompt: input.taskPrompt,
        ctx: input.ctx,
        outputSchema: input.outputSchema,
        host: input.host
      })
    : [
        "Lineup stage contract:",
        `- Stage ID: ${input.stage.id}`,
        `- Stage description: ${input.stage.description ?? "n/a"}`,
        `- User request: ${formatStageTaskPrompt(input.stage, input.taskPrompt)}`,
        `- Output schema: ${input.outputSchema}`,
        input.outputPath
          ? `- Create or overwrite ${input.outputPath} with the final structured payload. If you cannot write the file directly, emit only the payload content for that path.`
          : "- Emit only the payload content with no prose or explanation.",
        "",
        "Expected fields:",
        describeStageOutputs(input.stage),
        ...(outputTemplate
          ? [
              "",
              "Follow this output template shape exactly. Replace placeholder values, but keep the same YAML-style structure:",
              outputTemplate,
              "",
              "Do not return markdown headings, bullets, or prose outside the structured payload."
            ]
          : []),
        "",
        "Stage context:",
        formatStageContext(input.stage, input.ctx) || "(none)",
        ...(input.host === "opencode" ? ["", buildOpenCodeStageToolInstructions(input.stage)] : []),
        ...(input.host === "opencode" && input.stage.agent === "researcher"
          ? ["", buildOpenCodeResearchPromptInstructions(input.stage)]
          : [])
      ].join("\n");
  const prompt = buildAgentSystemPrompt({
    agentFilePath: resolve(input.projectRoot, "agents", `${agentName}.md`),
    promptTemplate: "{{AGENT_BODY}}",
    configOptions: {
      projectRoot: input.projectRoot,
      ...(input.host ? { host: input.host } : {}),
      ...((input.forceOllamaBackend || input.ollamaModel)
        ? {
            cli: {
              ollama: {
                ...(input.forceOllamaBackend ? { enabled: true } : {}),
                ...(input.ollamaModel ? { model: input.ollamaModel } : {}),
                ...(input.forceOllamaBackend
                  ? {
                      scope: "full",
                      baseUrl: DEFAULT_OLLAMA.baseUrl,
                      hostIntegration: {
                        enabled: true,
                        strategy: "launch"
                      }
                    }
                  : {})
              }
            }
          }
        : {})
    },
    extraInstructions
  });

  return input.host === "opencode" ? normalizeOpenCodeStagePrompt(prompt.prompt) : prompt.prompt;
}

function buildOpenCodeResearchPromptInstructions(stage: WorkflowStage): string {
  const lines = [
    "OpenCode research contract:",
    "- Stay bounded to the tiny smoke task or the explicitly requested feature.",
    "- Do not perform broad workspace globbing or repeated search sweeps.",
    "- Emit exactly one YAML Research document.",
    "- Do not wrap the response in markdown, prose, code fences, or commentary.",
    "- This research stage is read-only. Never call `edit`, `write`, or mutating `bash` commands.",
    "- Do not make the requested code change during research. Only inspect and report.",
    "- Keep the document structurally complete and directly usable.",
    "- Use the top-level keys `what_found`, `how_it_works`, `constraints`, and `gaps` exactly once.",
    "- `what_found`, `constraints`, and `gaps` must be YAML mappings. Never emit them as scalars or lists.",
    "- If any mapping would otherwise be empty, return `{}` instead of prose or a placeholder bullet list.",
    "- Return only the final YAML payload."
  ];

  if (stage.outputs && Object.keys(stage.outputs).length > 0) {
    lines.push("- Fill every declared output field exactly once.");
  } else {
    lines.push("- If no outputs are declared, still return a single valid Research document with the standard fields.");
  }

  return lines.join("\n");
}

function buildOpenCodeStageToolInstructions(stage: WorkflowStage): string {
  const lines = [
    "OpenCode tool dialect:",
    "- Use lower-case OpenCode tool names only: `bash`, `read`, `grep`, `glob`, `edit`, `write`, `webfetch`, `task`, `skill`.",
    "- There is no dedicated `ls` tool. For file discovery, prefer `glob` and use `bash` for directory listing when needed.",
    "- For file reading, use `read`.",
    "- `read` output is rendered for display. When reusing file contents in a later `edit`, copy only the raw file text and never include line numbers or `(End of file ...)` wrappers in `oldString`.",
    "- For text search, use `grep`.",
    "- Use `webfetch` only when you already have a URL. Do not request a separate web-search tool.",
    "- Do not call `task` or `skill` for normal Lineup stages. Complete the stage in the current invocation unless the prompt explicitly asks you to delegate."
  ];

  if (stage.agent === "researcher") {
    lines.push(
      "- Keep research output concise and evidence-driven.",
      "- Gather files with `bash` and `glob`, then inspect only the relevant paths with `read`."
    );
  }

  if (stage.agent === "reviewer") {
    lines.push(
      "- Review changes by inspecting the relevant files with `read` and corroborating with `grep` when needed.",
      "- Avoid requesting unavailable uppercase tools."
    );
  }

  return lines.join("\n");
}

function normalizeOpenCodeStagePrompt(prompt: string): string {
  return prompt
    .replace(/\bLS\b/g, "bash")
    .replace(/\bRead\b/g, "read")
    .replace(/\bGrep\b/g, "grep")
    .replace(/\bGlob\b/g, "glob")
    .replace(/\bBash\b/g, "bash")
    .replace(/\bEdit\b/g, "edit")
    .replace(/\bWrite\b/g, "write")
    .replace(/\bWebFetch\b/g, "webfetch")
    .replace(/\bWebSearch\b/g, "webfetch")
    .replace(/\bNotebookEdit\b/g, "edit");
}

function buildOpenCodeResearchRetryPrompt(originalPrompt: string, invalidOutput: string): string {
  const sanitizedInvalidOutput = sanitizeInvalidOutputForRetry(invalidOutput);

  return [
    originalPrompt.trimEnd(),
    "",
    "Previous output was invalid because it did not produce exactly one YAML Research document.",
    "Rewrite the same facts into one YAML document only.",
    "Stay bounded to the requested task and do not expand into repository-wide exploration.",
    "Do not add markdown, prose, code fences, bullet lists, or extra wrapper text.",
    "Do not call edit, write, or mutating bash commands while retrying this research stage.",
    "Return this exact top-level shape and keep mapping fields as mappings:",
    "what_found: {}",
    "how_it_works: \"\"",
    "constraints: {}",
    "gaps: {}",
    "Use the declared Research schema fields exactly once and keep the payload directly parseable.",
    "",
    "Previous invalid output:",
    sanitizedInvalidOutput
  ].join("\n");
}

function resolveLocalAgentTimeoutMs(projectRoot: string, host?: HostName, timeoutSeconds?: number): number {
  if (timeoutSeconds !== undefined && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0) {
    return Math.round(timeoutSeconds * 1000)
  }

  const ollama = readOllamaConfig({ projectRoot, host });
  if (ollama?.hostIntegration?.enabled) {
    return OLLAMA_HOST_INTEGRATION_TIMEOUT_MS;
  }

  return DEFAULT_LOCAL_AGENT_TIMEOUT_MS;
}

function slugifyTopic(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "task";
}

function taskTraceLabel(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "task";
}

function normalizeResearchArtifact(raw: string, taskPrompt: string, source: string): string {
  const repaired = repairResearchYamlScalars(repairYamlOutput(raw).content);

  try {
    const normalized = normalizeResearchDocument(parseRestrictedYaml(repaired, source), taskPrompt);
    return normalized ? stringifyStructuredYaml(normalized) : repaired;
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== "yaml_parse_failed") {
      throw error;
    }

    const recovered = selectRestrictedYamlDocument(repaired, source, {
      describe: "research artifact",
      normalize: (payload) => {
        const normalized = normalizeResearchDocument(payload, taskPrompt);
        return normalized ? stringifyStructuredYaml(normalized) : null;
      }
    });

    if (recovered) {
      return recovered;
    }

    throw error;
  }
}

function repairResearchYamlScalars(raw: string): string {
  return raw
    .replace(/^how_it_works:\s*(.+)$/m, (line, value: string) => {
      const trimmed = value.trim();
      if (
        trimmed.length === 0 ||
        trimmed.startsWith("\"") ||
        trimmed.startsWith("'") ||
        trimmed.startsWith("|") ||
        trimmed.startsWith(">") ||
        !trimmed.includes(": ")
      ) {
        return line;
      }

      return `how_it_works: |-\n  ${trimmed}`;
    })
    .replace(/^(\s*-\s+)(.+)$/gm, (line, prefix: string, value: string) => {
      const trimmed = value.trim();
      if (
        trimmed.length === 0 ||
        trimmed.startsWith("\"") ||
        trimmed.startsWith("'") ||
        trimmed.startsWith("|") ||
        trimmed.startsWith(">") ||
        !trimmed.includes("`")
      ) {
        return line;
      }

      const escaped = trimmed
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
      return `${prefix}"${escaped}"`;
    });
}

function stringifyStructuredYaml(payload: unknown): string {
  return stringifyYaml(payload);
}

function normalizePlanDraftArtifact(raw: string, source: string, projectRoot: string): string {
  const repaired = repairYamlOutput(raw).content;

  try {
    return normalizePlanForStage(repaired, source, projectRoot);
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== "yaml_parse_failed") {
      throw error;
    }

    const recovered = selectRestrictedYamlDocument(repaired, source, {
      describe: "plan artifact",
      normalize: (payload) => {
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
          return null;
        }

        const candidate = stringifyStructuredYaml(payload);
        try {
          return normalizePlanForStage(candidate, source, projectRoot);
        } catch {
          return null;
        }
      }
    });

    if (recovered) {
      return recovered;
    }

    throw error;
  }
}

function normalizeResearchDocument(payload: unknown, taskPrompt: string): Record<string, unknown> | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const doc = { ...(payload as Record<string, unknown>) };
  const normalizedWhatFound = normalizeResearchWhatFound(doc.what_found);
  if (normalizedWhatFound === null) {
    return null;
  }
  doc.what_found = normalizedWhatFound ?? inferMissingResearchWhatFound(doc);
  doc.how_it_works = normalizeResearchHowItWorks(doc);
  doc.constraints = normalizeResearchObjectField(doc.constraints);
  doc.gaps = normalizeResearchObjectField(doc.gaps);
  const today = new Date().toISOString().slice(0, 10);
  doc.type = "research";
  doc.agent = "researcher";
  doc.date = typeof doc.date === "string" && doc.date.trim().length > 0 ? doc.date : today;
  doc.topic = typeof doc.topic === "string" && doc.topic.trim().length > 0 ? doc.topic : slugifyTopic(taskPrompt);
  doc.status = "complete";
  doc.pipeline_stage = doc.pipeline_stage ?? 2;
  return doc;
}

function inferMissingResearchWhatFound(doc: Record<string, unknown>): Record<string, unknown> {
  const fieldNames = Object.keys(doc).filter((key) => !["type", "agent", "date", "topic", "status", "pipeline_stage"].includes(key));
  return fieldNames.length > 0
    ? { observed_fields: fieldNames }
    : {};
}

function normalizeResearchHowItWorks(doc: Record<string, unknown>): string {
  if (typeof doc.how_it_works === "string" && doc.how_it_works.trim().length > 0) {
    return doc.how_it_works.trim();
  }

  if (typeof doc.name === "string" && doc.name.trim().length > 0) {
    return `Recovered research output from a ${doc.name.trim()}-shaped payload.`;
  }

  return "Recovered research output from a partially structured payload.";
}

function normalizeResearchWhatFound(value: unknown): Record<string, unknown> | null | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  if (value.length === 0) {
    return {
      files: []
    };
  }

  if (value.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    return {
      files: value.map((entry) => (entry as string).trim())
    };
  }

  const keyFiles = value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }

    const record = entry as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!path || !content) {
      return null;
    }

    return {
      path,
      description: content
    };
  });

  if (keyFiles.some((entry) => entry === null)) {
    return null;
  }

  return {
    key_files: keyFiles
  };
}

function normalizeResearchObjectField(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (Array.isArray(value)) {
    return { items: value };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? { note: trimmed } : {};
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return { value };
  }

  return {};
}

function buildPlannerRetryPrompt(originalPrompt: string, invalidOutput: string, reason?: string): string {
  const sanitizedInvalidOutput = sanitizeInvalidOutputForRetry(invalidOutput);

  return [
    originalPrompt.trimEnd(),
    "",
    reason
      ? `Previous output was invalid because ${reason}.`
      : "Previous output was invalid because it was not a structured lineup/v3 Plan payload.",
    "Return only the structured payload. Do not say that you wrote the plan. Do not add prose before or after the payload.",
    "The payload must be a valid lineup/v3 Plan.",
    "Include a non-empty `changes` array of objects. Each change object must include `file`, `change`, and `rationale`.",
    "Every `changes[].file` value must be a repo-relative path such as `README.md` or `src/index.ts`, never an absolute filesystem path.",
    "",
    "Previous invalid output:",
    sanitizedInvalidOutput
  ].join("\n");
}

function buildStructuredArtifactRetryPrompt(
  originalPrompt: string,
  invalidOutput: string,
  schemaLabel: string
): string {
  const sanitizedInvalidOutput = sanitizeInvalidOutputForRetry(invalidOutput);

  return [
    originalPrompt.trimEnd(),
    "",
    `Previous output was invalid because it was not a valid structured ${schemaLabel} payload.`,
    "Rewrite the same facts into the exact structured payload only.",
    "Do not add markdown headings, tables, commentary, or wrapper prose.",
    "If the previous draft included extra narrative, strip it and keep only the final structured artifact.",
    "",
    "Previous invalid output:",
    sanitizedInvalidOutput
  ].join("\n");
}

function sanitizeInvalidOutputForRetry(invalidOutput: string): string {
  const trimmed = invalidOutput.trim();
  if (trimmed.length === 0) {
    return "[empty output]"
  }

  if (looksLikeToolCallTranscript(trimmed)) {
    return "[tool-call transcript omitted; previous output was not a structured artifact]"
  }

  const maxLength = 4_000
  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, maxLength)}\n... [truncated]`
}

function looksLikeToolCallTranscript(value: string): boolean {
  return /<function=|<parameter=|<\/?tool_call>/.test(value)
}

function parseStructuredStageArtifact(
  kind: AgentOutputKind,
  content: string,
  source: string,
  validateOutputs: boolean
): Record<string, unknown> {
  const parsed = parseRestrictedYaml(content, source);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError(`Structured ${kind} output at ${source} must be a YAML object.`, {
      code: "malformed_output"
    });
  }

  if (validateOutputs) {
    validateAgentOutputYaml(kind, content, source);
  }

  return parsed as Record<string, unknown>;
}

function matchesStageOutputType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    default:
      return true;
  }
}

function assertDeclaredStageOutputs(
  stage: WorkflowStage,
  parsed: Record<string, unknown>,
  source: string
): void {
  for (const [field, definition] of Object.entries(resolveEffectiveStageOutputs(stage))) {
    if (!(field in parsed)) {
      throw new CliError(`Structured ${stage.agent ?? "agent"} output at ${source} is missing required field '${field}'.`, {
        code: "schema_validation_failed"
      });
    }

    if (!matchesStageOutputType(parsed[field], definition.type)) {
      throw new CliError(
        `Structured ${stage.agent ?? "agent"} output at ${source} has invalid field '${field}': expected ${definition.type}.`,
        {
          code: "schema_validation_failed"
        }
      );
    }
  }
}

async function executePreStage(
  stage: WorkflowStage,
  ctx: ExpressionContext,
  projectRoot: string,
  host: HostName | undefined,
  artifactDir: string,
  localAgentTimeoutMs: number,
  runId: string,
  taskPrompt: string,
  nextRequestId: () => number,
  emitProtocol: (message: LineupProtocolMessage) => void,
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void,
  gateTimeoutMs?: number,
  validateOutputs = true,
  runMode: "human" | "host" = "human",
  localAgentRunner?: LocalAgentRunner,
  forceOllamaBackend = false,
  ollamaModel?: string,
  onGatePending?: (gate: PendingGate, stageId: string, timeoutMs?: number) => void,
  onGateResolved?: (gateType: LineupGateType, response: GateResponse, stageId: string) => void,
  onGateTimeout?: (error: GateTimeoutError, stageId: string, timeoutMs?: number) => void,
  onHumanGatePromptStart?: () => void | Promise<void>,
  onHumanGatePromptEnd?: () => void | Promise<void>
): Promise<StageResult> {
  emitStatus(stage.id, `Starting ${stage.type} stage '${stage.id}'.`);

  if (stage.id === "clarify") {
    if (runMode === "human") {
      emitStatus(stage.id, "No concrete clarification questions were generated; skipping interactive clarify gate.", true);
      return { id: stage.id, status: "complete", outputs: {} };
    }

    const result = await emitGateAndWait(stage, "clarify", "Review the user's request and identify any ambiguities that need clarification.", ["No clarification needed", "Ask questions"], "No clarification needed", runId, projectRoot, nextRequestId, emitProtocol, emitStatus, true, gateTimeoutMs, runMode, undefined, onGatePending, onGateResolved, onGateTimeout, onHumanGatePromptStart, onHumanGatePromptEnd);
    if (result.status !== "complete") return result;
    return { ...result, outputs: { requirements: result.outputs.choice, reason: result.outputs.reason } };
  }

  if (stage.id === "gate") {
    if (runMode === "human") {
      emitStatus(stage.id, "No concrete follow-up clarification questions were generated; skipping interactive clarification gate.", true);
      return { id: stage.id, status: "complete", outputs: {} };
    }

    const result = await emitGateAndWait(stage, "clarification", "Review research findings. Are there unresolved ambiguities?", ["No ambiguities \u2014 proceed", "Ask clarification questions"], "No ambiguities \u2014 proceed", runId, projectRoot, nextRequestId, emitProtocol, emitStatus, true, gateTimeoutMs, runMode, undefined, onGatePending, onGateResolved, onGateTimeout, onHumanGatePromptStart, onHumanGatePromptEnd);
    if (result.status !== "complete") return result;
    return { ...result, outputs: { resolved_requirements: result.outputs.choice, reason: result.outputs.reason } };
  }

  if (stage.id === "triage" || stage.type === "builtin") {
    emitStatus(stage.id, `Collecting project stats.`);
    const stats = executeTriageBuiltin(projectRoot);
    emitStatus(stage.id, `Stats collected: ${stats.fileCount} files, ${stats.changedFiles} changed.`);

    // If the workflow declares outputs for triage, run the classify gate
    // to get LLM-driven classification. Otherwise, return stats only.
    const hasOutputSchema = stage.outputs && Object.keys(stage.outputs).length > 0;
    if (hasOutputSchema) {
      if (runMode === "human") {
        const classification = autoClassifyTriage(stats);
        emitStatus(stage.id, `Triage complete: ${classification.complexity}, ${classification.affected_areas.length} areas.`, true);
        return { id: stage.id, status: "complete", outputs: classification };
      }

      const contextPayload = formatTriageContext(stats);
      const classifyResult = await emitGateAndWait(
        stage, "classify",
        "Classify this task's complexity and identify affected areas based on the project stats below.",
        ["simple", "moderate", "complex"],
        "moderate", runId, projectRoot, nextRequestId,
        emitProtocol, emitStatus, true, gateTimeoutMs, runMode,
        contextPayload,
        onGatePending,
        onGateResolved,
        onGateTimeout,
        onHumanGatePromptStart,
        onHumanGatePromptEnd
      );

      if (classifyResult.status !== "complete") return classifyResult;

      const classification = parseClassifyResponse(classifyResult.outputs, stats);
      emitStatus(stage.id, `Triage complete: ${classification.complexity}, ${classification.affected_areas.length} areas.`, true);
      return { id: stage.id, status: "complete", outputs: classification };
    }

    emitStatus(stage.id, `Triage complete: ${stats.fileCount} files, ${stats.changedFiles} changed.`, true);
    return { id: stage.id, status: "complete", outputs: stats };
  }

  if (stage.type === "agent" && stage.agent) {
    emitStatus(stage.id, `Spawning ${stage.agent} for stage '${stage.id}'.`);
    const outputPath = resolve(artifactDir, `${stage.id}.yaml`);
    const basePrompt = buildStageAgentPrompt({
      stage,
      projectRoot,
      host,
      forceOllamaBackend,
      ollamaModel,
      taskPrompt,
      ctx,
      outputSchema: stage.agent === "researcher" ? "Research" : stage.agent,
      outputPath: runMode === "host" ? outputPath : undefined
    });

    const schemaLabel = stage.agent === "researcher" ? "Research" : stage.agent;
    let prompt = basePrompt;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      rmSync(outputPath, { force: true });
      let rawOutput: string;
      if (localAgentRunner) {
        rawOutput = (
          await localAgentRunner.invoke({
            projectRoot,
            workingDirectory: projectRoot,
            agent: stage.agent,
            prompt,
            ollamaModel,
            timeoutMs: localAgentTimeoutMs,
            addDirs: [artifactDir],
            outputSchemaPath: resolveArtifactSchemaPath(stage.agent, schemaLabel),
            expectedOutputPath: outputPath,
            tracePrefixPath: resolve(dirname(artifactDir), "host", `${stage.id}-${localAgentRunner.host}`)
          })
        ).content;
      } else {
        const reqId = nextRequestId();
        emitProtocol(
          createLineupRequest({
            method: "agent/spawn",
            id: reqId,
            params: {
              runId,
              stageId: stage.id,
              agent: stage.agent,
              prompt,
              inputs: selectStageInput(stage, ctx),
              outputs: {
                schema: schemaLabel,
                path: outputPath
              },
              timeoutMs: 300_000,
              retryAttempt: attempt
            }
          })
        );
        rawOutput = await waitForResponseFile(outputPath, `${stage.id} response`, 300_000);
      }

      try {
        let repaired = repairYamlOutput(rawOutput).content;
        if (stage.agent === "researcher") {
          repaired = normalizeResearchArtifact(repaired, taskPrompt, outputPath);
        }
        if (stage.agent === "teacher") {
          repaired = coerceTeacherAgentOutput(repaired, stage.id);
        }
        writeFileSync(outputPath, repaired, "utf8");
        const parsed = parseStructuredStageArtifact(
          stage.agent as AgentOutputKind,
          repaired,
          outputPath,
          validateOutputs
        );
        assertDeclaredStageOutputs(stage, parsed, outputPath);
        const outputs = {
          ...Object.fromEntries(Object.keys(resolveEffectiveStageOutputs(stage)).map((key) => [key, parsed[key]])),
          artifactPath: outputPath
        };

        emitStatus(stage.id, `Completed stage '${stage.id}'.`, true);
        return { id: stage.id, status: "complete", outputs };
      } catch (error) {
        if (stage.agent === "teacher" || attempt === 1) {
          throw error;
        }

        emitStatus(stage.id, "Agent returned non-structured output. Retrying with stricter instructions.");
        prompt =
          host === "opencode" && stage.agent === "researcher"
            ? buildOpenCodeResearchRetryPrompt(basePrompt, rawOutput)
            : buildStructuredArtifactRetryPrompt(basePrompt, rawOutput, schemaLabel);
      }
    }
  }

  if (stage.type === "reasoning") {
    emitStatus(stage.id, `Executing reasoning stage '${stage.id}'.`);
  }
  emitStatus(stage.id, `Completed stage '${stage.id}'.`, true);
  return { id: stage.id, status: "complete", outputs: {} };
}

type TriageStats = {
  fileCount: number;
  changedFiles: number;
  insertions: number;
  deletions: number;
  diffSummary: string;
  changedPaths: string[];
};

type TriageOutputs = {
  complexity: "simple" | "moderate" | "complex";
  affected_areas: Array<{ name: string; coupled: boolean }>;
  search_targets: Array<{ area: string; targets: string[] }>;
  independent_areas: string[][];
  fileCount: number;
  changedFiles: number;
  insertions: number;
  deletions: number;
};

function executeTriageBuiltin(projectRoot: string): TriageStats {
  const gitProject = inspectGitProject(projectRoot);
  let diffSummary = "";
  let changedFiles = 0;
  let insertions = 0;
  let deletions = 0;
  if (gitProject.hasHeadCommit) {
    diffSummary = execSync("git diff --stat HEAD", { cwd: projectRoot, timeout: 30000 }).toString().trim();
    const changedMatch = diffSummary.match(/(\d+) file/);
    const insertMatch = diffSummary.match(/(\d+) insertion/);
    const deleteMatch = diffSummary.match(/(\d+) deletion/);
    changedFiles = changedMatch ? parseInt(changedMatch[1], 10) : 0;
    insertions = insertMatch ? parseInt(insertMatch[1], 10) : 0;
    deletions = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;
  } else if (gitProject.isRepository) {
    diffSummary = "Git repository has no commits yet.";
  } else {
    diffSummary = "Not a git repository.";
  }

  let changedPaths: string[] = [];
  if (gitProject.hasHeadCommit) {
    const nameOnly = execSync("git diff --name-only HEAD", { cwd: projectRoot, timeout: 30000 }).toString().trim();
    changedPaths = nameOnly ? nameOnly.split("\n").filter(Boolean) : [];
  }

  let fileCount = 0;
  try {
    const countOutput = execSync(
      'find . -type f -not -path "./.git/*" -not -path "./node_modules/*" | wc -l',
      { cwd: projectRoot, timeout: 30000 }
    ).toString().trim();
    fileCount = parseInt(countOutput, 10) || 0;
  } catch {
    fileCount = 0;
  }

  return { fileCount, changedFiles, insertions, deletions, diffSummary, changedPaths };
}

function validateProjectPrerequisites(projectRoot: string, workflow: WorkflowDefinition, dryRun: boolean): void {
  if (dryRun) {
    return;
  }

  const requiresNativeExecution = workflow.stages.some((stage) => stage.id === "implement" || stage.id === "verify");
  if (!requiresNativeExecution) {
    return;
  }

  const gitProject = inspectGitProject(projectRoot);
  if (!gitProject.isRepository) {
    throw new CliError(
      "Native Lineup execution requires a git repository because implementation runs use isolated git worktrees. Run `git init`, then create an initial commit before rerunning.",
      { code: "isolation_failed" }
    );
  }

  if (!gitProject.hasHeadCommit) {
    throw new CliError(
      "Native Lineup execution requires at least one git commit. Run `git add -A && git commit -m \"Initial commit\"`, then rerun.",
      { code: "isolation_failed" }
    );
  }
}

function formatTriageContext(stats: TriageStats): string {
  const lines: string[] = [
    `Project: ${stats.fileCount} files total`,
    `Changed: ${stats.changedFiles} files, +${stats.insertions}/-${stats.deletions}`,
  ];
  if (stats.changedPaths.length > 0) {
    lines.push("", "Changed files:");
    for (const p of stats.changedPaths.slice(0, 50)) {
      lines.push(`  ${p}`);
    }
    if (stats.changedPaths.length > 50) {
      lines.push(`  ... and ${stats.changedPaths.length - 50} more`);
    }
  }
  lines.push(
    "",
    "Respond with:",
    '- choice: "simple", "moderate", or "complex"',
    "- reason: JSON object with affected_areas, search_targets, independent_areas",
    "",
    "affected_areas: [{name: string, coupled: boolean}]",
    "search_targets: [{area: string, targets: string[]}]",
    "independent_areas: string[][] (groups of uncoupled areas)"
  );
  return lines.join("\n");
}

function parseClassifyResponse(
  gateOutputs: Record<string, unknown>,
  stats: TriageStats
): TriageOutputs {
  const choice = String(gateOutputs.choice ?? "moderate");
  const complexity = (["simple", "moderate", "complex"].includes(choice) ? choice : "moderate") as TriageOutputs["complexity"];

  let affected_areas: TriageOutputs["affected_areas"] = [];
  let search_targets: TriageOutputs["search_targets"] = [];
  let independent_areas: TriageOutputs["independent_areas"] = [];

  const reason = String(gateOutputs.reason ?? "");
  if (reason) {
    try {
      const parsed = JSON.parse(reason);
      if (Array.isArray(parsed.affected_areas)) affected_areas = parsed.affected_areas;
      if (Array.isArray(parsed.search_targets)) search_targets = parsed.search_targets;
      if (Array.isArray(parsed.independent_areas)) independent_areas = parsed.independent_areas;
    } catch {
      // Fall back to deriving areas from changed paths
      affected_areas = deriveAreasFromPaths(stats.changedPaths);
      search_targets = affected_areas.map(a => ({ area: a.name, targets: stats.changedPaths.filter(p => p.startsWith(a.name)) }));
      independent_areas = affected_areas.filter(a => !a.coupled).map(a => [a.name]);
    }
  }

  return {
    complexity,
    affected_areas,
    search_targets,
    independent_areas,
    fileCount: stats.fileCount,
    changedFiles: stats.changedFiles,
    insertions: stats.insertions,
    deletions: stats.deletions,
  };
}

function autoClassifyTriage(stats: TriageStats): TriageOutputs {
  const affected_areas = deriveAreasFromPaths(stats.changedPaths);
  const search_targets = affected_areas.map((area) => ({
    area: area.name,
    targets: stats.changedPaths.filter((path) => path.startsWith(area.name))
  }));
  const independent_areas = affected_areas.filter((area) => !area.coupled).map((area) => [area.name]);

  let complexity: TriageOutputs["complexity"] = "moderate";
  if (stats.changedFiles >= 8 || affected_areas.length >= 4) {
    complexity = "complex";
  } else if (stats.changedFiles > 0 && stats.changedFiles <= 2 && affected_areas.length <= 1) {
    complexity = "simple";
  }

  return {
    complexity,
    affected_areas,
    search_targets,
    independent_areas,
    fileCount: stats.fileCount,
    changedFiles: stats.changedFiles,
    insertions: stats.insertions,
    deletions: stats.deletions
  };
}

function deriveAreasFromPaths(paths: string[]): Array<{ name: string; coupled: boolean }> {
  const dirs = new Map<string, number>();
  for (const p of paths) {
    const parts = p.split("/");
    const dir = parts.length > 1 ? parts[0] : ".";
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
  }
  const topLevel = [...dirs.keys()];
  return topLevel.map(name => ({ name, coupled: topLevel.length > 1 }));
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
  allowFreeText: boolean,
  gateTimeoutMs?: number,
  runMode: "human" | "host" = "human",
  context?: string,
  onGatePending?: (gate: PendingGate, stageId: string, timeoutMs?: number) => void,
  onGateResolved?: (gateType: LineupGateType, response: GateResponse, stageId: string) => void,
  onGateTimeout?: (error: GateTimeoutError, stageId: string, timeoutMs?: number) => void,
  onHumanGatePromptStart?: () => void | Promise<void>,
  onHumanGatePromptEnd?: () => void | Promise<void>
): Promise<StageResult> {
  const reqId = nextRequestId();
  const pendingGate: PendingGate = {
    requestId: reqId,
    stageId: stage.id,
    gateType,
    question,
    choices,
    defaultChoice,
    allowFreeText,
    ...(context ? { context } : {}),
    createdAt: new Date().toISOString()
  };
  onGatePending?.(pendingGate, stage.id, gateTimeoutMs);

  let gateResponse;
  if (runMode === "human") {
    gateResponse = await handleInteractiveGate(pendingGate, {
      onPromptStart: onHumanGatePromptStart,
      onPromptEnd: onHumanGatePromptEnd
    });
  } else {
    writePendingGate(runId, pendingGate, projectRoot);

    emitProtocol(
      createLineupRequest({
        method: "gate/request",
        id: reqId,
        params: { runId, stageId: stage.id, gateType, question, choices, defaultChoice, allowFreeText, ...(context ? { context } : {}) }
      })
    );

    try {
      gateResponse = await waitForGateResponse(runId, reqId, projectRoot, gateTimeoutMs, gateType);
    } catch (err) {
      if (err instanceof GateTimeoutError) {
        onGateTimeout?.(err, stage.id, gateTimeoutMs);
        return { id: stage.id, status: "blocked", outputs: {} };
      }
      throw err;
    }
  }
  onGateResolved?.(gateType, gateResponse, stage.id);
  emitStatus(stage.id, `Gate '${gateType}' resolved: ${gateResponse.choice}.`, true);

  return {
    id: stage.id,
    status: "complete",
    outputs: { choice: gateResponse.choice, reason: gateResponse.reason }
  };
}

async function executePlannerPhase(
  stage: WorkflowStage,
  ctx: ExpressionContext,
  projectRoot: string,
  host: HostName | undefined,
  artifactDir: string,
  localAgentTimeoutMs: number,
  runId: string,
  taskPrompt: string,
  nextRequestId: () => number,
  emitProtocol: (message: LineupProtocolMessage) => void,
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void,
  hooks: RunPipelineHooks,
  runMode: "human" | "host",
  localAgentRunner?: LocalAgentRunner,
  forceOllamaBackend = false,
  ollamaModel?: string
): Promise<StageResult> {
  const planPath = resolve(artifactDir, "plan.yaml");
  const basePrompt = buildStageAgentPrompt({
    stage,
    projectRoot,
    host,
    forceOllamaBackend,
    ollamaModel,
    taskPrompt,
    ctx,
    outputSchema: "Plan",
    outputPath: runMode === "host" ? planPath : undefined
  });

  if (hooks.native?.planContent) {
    writeFileSync(planPath, repairYamlOutput(hooks.native.planContent).content, "utf8");
  } else {
    let prompt = basePrompt;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (localAgentRunner) {
        if (!localAgentRunner) {
          throw new CliError("No local agent runner configured for the plan stage.", {
            code: "agent_spawn_failed"
          });
        }
        const result = await localAgentRunner.invoke({
          projectRoot,
          workingDirectory: projectRoot,
          agent: stage.agent ?? "architect",
          prompt,
          ollamaModel,
          timeoutMs: localAgentTimeoutMs,
          addDirs: [artifactDir],
          outputSchemaPath: resolveArtifactSchemaPath(stage.agent ?? "architect", "Plan"),
          expectedOutputPath: planPath,
          tracePrefixPath: resolve(dirname(artifactDir), "host", `${stage.id}-${localAgentRunner.host}`)
        });
        try {
          const repaired = normalizePlanDraftArtifact(result.content, planPath, projectRoot);
          writeFileSync(planPath, repaired, "utf8");
          validatePlanYaml(repaired, planPath);
          break;
        } catch (error) {
          if (attempt === 1) {
            throw error;
          }
          emitStatus(stage.id, "Planner returned non-structured output. Retrying with stricter instructions.");
          const invalidOutput = existsSync(planPath) ? readFileSync(planPath, "utf8") : repairYamlOutput(result.content).content;
          const reason = error instanceof Error ? error.message.replaceAll(planPath, "the plan artifact") : undefined;
          prompt = buildPlannerRetryPrompt(basePrompt, invalidOutput, reason);
          continue;
        }
      }

      emitProtocol(
        createLineupRequest({
          method: "agent/spawn",
          id: nextRequestId(),
          params: {
            runId,
            stageId: stage.id,
            agent: stage.agent ?? "architect",
            prompt,
            inputs: selectStageInput(stage, ctx),
            outputs: {
              schema: "Plan",
              path: planPath
            },
            timeoutMs: 300000,
            retryAttempt: attempt
          }
        })
      );
      const rawPlan = await waitForResponseFile(planPath, "Plan response", 300_000);
      try {
        const repaired = normalizePlanDraftArtifact(rawPlan, planPath, projectRoot);
        writeFileSync(planPath, repaired, "utf8");
        validatePlanYaml(repaired, planPath);
        break;
      } catch (error) {
        if (attempt === 1) {
          throw error;
        }
        emitStatus(stage.id, "Planner returned non-structured output. Retrying with stricter instructions.")
        const invalidOutput = existsSync(planPath) ? readFileSync(planPath, "utf8") : repairYamlOutput(rawPlan).content;
        const reason = error instanceof Error ? error.message.replaceAll(planPath, "the plan artifact") : undefined;
        prompt = buildPlannerRetryPrompt(basePrompt, invalidOutput, reason);
        continue;
      }
    }
  }

  emitStatus(stage.id, `Approved plan artifact path: ${planPath}.`, true);

  return {
    id: stage.id,
    status: "complete",
    outputs: { planPath },
  };
}

function executePostStage(
  stage: WorkflowStage,
  ctx: ExpressionContext,
  projectRoot: string,
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void,
  validateOutputs = true
): StageResult {
  emitStatus(stage.id, `Starting ${stage.type} stage '${stage.id}'.`);
  if (stage.type === "agent") {
    emitStatus(stage.id, `Spawning ${stage.agent ?? "unknown"} for stage '${stage.id}'.`);
  }
  emitStatus(stage.id, `Completed stage '${stage.id}'.`, true);
  const result: StageResult = { id: stage.id, status: "complete", outputs: {} };
  if (stage.type === "agent" && stage.agent && typeof result.outputs["output_yaml"] === "string") {
    validateAndWarnAgentOutput(stage.id, stage.agent as AgentOutputKind, result.outputs["output_yaml"] as string, emitStatus, validateOutputs);
  }
  return result;
}

function buildPlanApprovalContext(planPath: string | undefined): string | undefined {
  if (!planPath || !existsSync(planPath)) {
    return undefined;
  }

  const content = readFileSync(planPath, "utf8").trim();
  if (content.length === 0) {
    return `Plan artifact: ${planPath}`;
  }

  return `Plan artifact: ${planPath}\n\n${content}`;
}

export function validateAndWarnAgentOutput(
  stageId: string,
  kind: AgentOutputKind,
  content: string,
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void,
  validateOutputs = true
): void {
  if (!validateOutputs) return;
  try {
    validateAgentOutputYaml(kind, content, `stage:${stageId}`);
  } catch (err) {
    if (kind === "teacher") {
      const normalized = coerceTeacherAgentOutput(content, stageId);
      try {
        validateAgentOutputYaml(kind, normalized, `stage:${stageId}`);
        return;
      } catch {
        // Fall through to the warning below if normalization still does not satisfy the schema.
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    emitStatus(stageId, `[stage/warning] Agent output validation failed: ${message}`);
  }
}

function coerceTeacherAgentOutput(content: string, stageId: string): string {
  const cleaned = repairYamlOutput(content).content.trim();
  try {
    validateAgentOutputYaml("teacher", cleaned, `stage:${stageId}`);
    return cleaned;
  } catch {
    // Fall back to a minimal valid explanation envelope when the host returned prose.
  }

  const overview = cleaned.length > 0 ? cleaned : "Teacher output was not structured.";
  const topic = slugifyTopic(stageId);

  return stringifyYaml({
    type: "explanation",
    agent: "teacher",
    date: new Date().toISOString().slice(0, 10),
    topic,
    status: "complete",
    pipeline_stage: stageId,
    explanation: {
      overview
    },
    raw_output: overview
  });
}

function cleanup(artifactDir: string, cacheDir: string, success: boolean): void {
  // Clean cache only on success
  if (success && existsSync(cacheDir)) {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {}
  }
}
