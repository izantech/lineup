import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { RunOptions, WorkflowDefinition, WorkflowStage } from "./types.js";
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
import { writePendingGate, waitForGateResponse, GateTimeoutError, type PendingGate } from "./gate-store.js";
import { handleInteractiveGate } from "./interactive-gate.js";
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
  loadPipelineState,
  markPipelineCurrentStage,
  savePipelineState,
  updatePipelineArtifactHashes
} from "./state.js";
import { parseWorkflowYaml, parseRestrictedYaml, validateTacticYaml, validateAgentOutputYaml, type AgentOutputKind } from "./validation.js";
import { tacticToWorkflow, type TacticDefinition } from "./tactic-convert.js";
import { validateWorkflowDag, resolveExecutionOrder } from "./workflow.js";
import { evaluateExpression, type ExpressionContext } from "./expression.js";
import { runVerificationHooks, type VerificationResult } from "./verification.js";


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
  let lockAcquired = false;

  try {
    acquireRuntimeLock(projectRoot, runId, workflowPath);
    lockAcquired = true;

    // 5. Resolve execution order
    const waves = resolveExecutionOrder(workflow);
    const expressionCtx: ExpressionContext = { stages: {}, variables: {} };

    // 7. Dry-run: just print the plan
    if (options.dryRun) {
      printExecutionPlan(waves, workflow);
      return { runId, status: "success", stageResults };
    }

    // 8. Execute stages in wave order
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
          const result = await executePreStage(stage, expressionCtx, projectRoot, runId, () => protocolRequestId++, emitProtocol, emitStatus, options.gateTimeout !== undefined ? options.gateTimeout * 1000 : undefined, options.validateOutputs !== false, options.interactive);
          stageResults.set(stageId, result);
          expressionCtx.stages[stageId] = { outputs: result.outputs };
          if (result.status === "blocked") {
            pipelineState = savePipelineState({ ...pipelineState, status: "blocked" }, projectRoot);
            return { runId, status: "blocked", stageResults };
          }

        } else if (stageId === "plan") {
          // Phase 1: invoke planner adapter directly
          const planResult = await executePlannerPhase(
            stage,
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
            let gateResponse;
            if (options.interactive) {
              gateResponse = await handleInteractiveGate(pendingGate);
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
                    defaultChoice: "approve"
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
                  pipelineState = savePipelineState({ ...pipelineState, status: "blocked" }, projectRoot);
                  return { runId, status: "blocked", stageResults };
                }
                throw err;
              }
            }
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
                driver: hooks.native?.driver,
                verificationResults
              });

              const reviewStatus = nativeResult.verifyResult.outputs.status as string | undefined;
              if (reviewStatus === "FAIL" || reviewStatus === "PASS_WITH_WARNINGS") {
                const reviewSummary = (nativeResult.verifyResult.outputs.summary as string | undefined) ?? "Verification failed.";
                const reqId = protocolRequestId++;
                const pendingGate: PendingGate = {
                  requestId: reqId,
                  gateType: "verify-decision",
                  question: reviewSummary,
                  choices: ["retry", "accept", "abort"],
                  defaultChoice: "retry",
                  createdAt: new Date().toISOString()
                };

                let gateResponse;
                if (options.interactive) {
                  gateResponse = await handleInteractiveGate(pendingGate);
                } else {
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
                      pipelineState = savePipelineState({ ...pipelineState, status: "blocked" }, projectRoot);
                      return { runId, status: "blocked", stageResults };
                    }
                    throw err;
                  }
                }

                if (gateResponse.choice === "retry") {
                  const retryResult = await executeNativeExecutor({
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
                    driver: hooks.native?.driver,
                    verificationResults,
                    taskFilter: nativeResult.failedTaskIds
                  });
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
      engine: "native",
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
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void,
  gateTimeoutMs?: number,
  validateOutputs = true,
  interactive?: boolean
): StageResult | Promise<StageResult> {
  emitStatus(stage.id, `Starting ${stage.type} stage '${stage.id}'.`);

  if (stage.id === "clarify") {
    return emitGateAndWait(stage, "clarify", "Review the user's request and identify any ambiguities that need clarification.", ["No clarification needed", "Ask questions"], "No clarification needed", runId, projectRoot, nextRequestId, emitProtocol, emitStatus, true, gateTimeoutMs, interactive);
  }

  if (stage.id === "gate") {
    return emitGateAndWait(stage, "clarification", "Review research findings. Are there unresolved ambiguities?", ["No ambiguities \u2014 proceed", "Ask clarification questions"], "No ambiguities \u2014 proceed", runId, projectRoot, nextRequestId, emitProtocol, emitStatus, true, gateTimeoutMs, interactive);
  }

  if (stage.id === "triage" || stage.type === "builtin") {
    emitStatus(stage.id, `Executing builtin stage '${stage.id}'.`);
    const triageResult = executeTriageBuiltin(projectRoot);
    emitStatus(stage.id, `Triage complete: ${triageResult.fileCount} files, ${triageResult.changedFiles} changed.`, true);
    return { id: stage.id, status: "complete", outputs: triageResult };
  }

  if (stage.type === "agent" && stage.agent) {
    emitStatus(stage.id, `Spawning ${stage.agent} for stage '${stage.id}'.`);
    const reqId = nextRequestId();
    emitProtocol(
      createLineupRequest({
        method: "agent/spawn",
        id: reqId,
        params: { runId, stageId: stage.id, agent: stage.agent, prompt: "" }
      })
    );
    emitStatus(stage.id, `Completed stage '${stage.id}'.`, true);
    const result: StageResult = { id: stage.id, status: "complete", outputs: { agentRequestId: reqId } };
    if (typeof result.outputs["output_yaml"] === "string") {
      validateAndWarnAgentOutput(stage.id, stage.agent as AgentOutputKind, result.outputs["output_yaml"] as string, emitStatus, validateOutputs);
    }
    return result;
  }

  if (stage.type === "reasoning") {
    emitStatus(stage.id, `Executing reasoning stage '${stage.id}'.`);
  }
  emitStatus(stage.id, `Completed stage '${stage.id}'.`, true);
  return { id: stage.id, status: "complete", outputs: {} };
}

function executeTriageBuiltin(projectRoot: string): { fileCount: number; changedFiles: number; insertions: number; deletions: number; diffSummary: string } {
  let diffSummary = "";
  let changedFiles = 0;
  let insertions = 0;
  let deletions = 0;
  try {
    diffSummary = execSync("git diff --stat HEAD", { cwd: projectRoot, timeout: 30000 }).toString().trim();
    const changedMatch = diffSummary.match(/(\d+) file/);
    const insertMatch = diffSummary.match(/(\d+) insertion/);
    const deleteMatch = diffSummary.match(/(\d+) deletion/);
    changedFiles = changedMatch ? parseInt(changedMatch[1], 10) : 0;
    insertions = insertMatch ? parseInt(insertMatch[1], 10) : 0;
    deletions = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;
  } catch {
    diffSummary = "";
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

  return { fileCount, changedFiles, insertions, deletions, diffSummary };
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
  interactive?: boolean
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

  let gateResponse;
  if (interactive) {
    gateResponse = await handleInteractiveGate(pendingGate);
  } else {
    writePendingGate(runId, pendingGate, projectRoot);

    emitProtocol(
      createLineupRequest({
        method: "gate/request",
        id: reqId,
        params: { runId, stageId: stage.id, gateType, question, choices, defaultChoice, allowFreeText }
      })
    );

    try {
      gateResponse = await waitForGateResponse(runId, reqId, projectRoot, gateTimeoutMs, gateType);
    } catch (err) {
      if (err instanceof GateTimeoutError) {
        return { id: stage.id, status: "blocked", outputs: {} };
      }
      throw err;
    }
  }
  emitStatus(stage.id, `Gate '${gateType}' resolved: ${gateResponse.choice}.`, true);

  return {
    id: stage.id,
    status: "complete",
    outputs: { choice: gateResponse.choice, reason: gateResponse.reason }
  };
}

async function executePlannerPhase(
  stage: WorkflowStage,
  projectRoot: string,
  artifactDir: string,
  runId: string,
  nextRequestId: () => number,
  emitProtocol: (message: LineupProtocolMessage) => void,
  emitStatus: (stageId: string, chunk: string, final?: boolean) => void,
  hooks: RunPipelineHooks
): Promise<StageResult> {
  emitProtocol(
    createLineupRequest({
      method: "agent/spawn",
      id: nextRequestId(),
      params: {
        runId,
        stageId: stage.id,
        agent: stage.agent ?? "architect",
        prompt: `Generate an implementation plan for the current pipeline run.`,
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
    const message = err instanceof Error ? err.message : String(err);
    emitStatus(stageId, `[stage/warning] Agent output validation failed: ${message}`);
  }
}

function cleanup(artifactDir: string, cacheDir: string, success: boolean): void {
  // Clean cache only on success
  if (success && existsSync(cacheDir)) {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {}
  }
}
