import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { RunOptions, WorkflowDefinition, WorkflowStage } from "./types.js";
import type { HostName } from "./constants.js";
import { parseWorkflowYaml } from "./validation.js";
import { validateWorkflowDag, resolveExecutionOrder } from "./workflow.js";
import { evaluateExpression, type ExpressionContext } from "./expression.js";
import { generateTfConfig, generatePassthroughConfig, type TfGeneratorContext } from "./tf-config.js";
import { generateTfAdapters, type AdapterGenerationContext } from "./tf-adapters.js";

export type PipelineResult = {
  runId: string;
  status: "success" | "failed" | "aborted";
  stageResults: Map<string, StageResult>;
  tfOutputDir?: string;
};

type StageResult = {
  id: string;
  status: "complete" | "skipped" | "failed";
  outputs: Record<string, unknown>;
  duration?: number;
};

/**
 * Run the Lineup pipeline: pre-pipeline stages (native) → TF core → post-pipeline stages (native).
 */
export async function runPipeline(options: RunOptions): Promise<PipelineResult> {
  // 1. Load workflow
  const workflowPath = options.workflow ?? findDefaultWorkflow();
  const raw = readFileSync(workflowPath, "utf-8");
  const workflow = parseWorkflowYaml(raw, workflowPath);

  // 2. Validate DAG
  validateWorkflowDag(workflow);

  // 3. Generate run ID (6 char hex from random bytes)
  const runId = createHash("sha256")
    .update(Date.now().toString() + Math.random().toString())
    .digest("hex")
    .slice(0, 6);

  // 4. Setup directories
  const projectRoot = resolve(".");
  const artifactDir = resolve(projectRoot, ".lineup", ".ephemeral", runId);
  const cacheDir = resolve(projectRoot, ".lineup", ".cache");
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  let status: "success" | "failed" | "aborted" = "success";

  try {
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
      return { runId, status: "success", stageResults: new Map<string, StageResult>(), tfOutputDir: artifactDir };
    }

    // 6. Resolve execution order
    const waves = resolveExecutionOrder(workflow);
    const stageResults = new Map<string, StageResult>();
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
    const tfStages = new Set(["plan", "plan-approval", "implement", "verify"]);
    const postStages = new Set(["document"]);

    for (const wave of waves) {
      for (const stageId of wave) {
        const stage = workflow.stages.find((s) => s.id === stageId)!;

        // Evaluate condition/skip_if
        if (stage.condition && !evaluateExpression(stage.condition, expressionCtx)) {
          stageResults.set(stageId, { id: stageId, status: "skipped", outputs: {} });
          expressionCtx.stages[stageId] = { outputs: {} };
          continue;
        }
        if (stage.skip_if && evaluateExpression(stage.skip_if, expressionCtx)) {
          stageResults.set(stageId, { id: stageId, status: "skipped", outputs: {} });
          expressionCtx.stages[stageId] = { outputs: {} };
          continue;
        }

        if (preStages.has(stageId)) {
          // Pre-pipeline: output protocol messages for host orchestrator
          const result = executePreStage(stage, expressionCtx, projectRoot);
          stageResults.set(stageId, result);
          expressionCtx.stages[stageId] = { outputs: result.outputs };

        } else if (stageId === "plan") {
          // Phase 1: invoke planner adapter directly
          const planResult = await executePlannerPhase(
            stage, workflow, expressionCtx, host, projectRoot, artifactDir
          );
          stageResults.set(stageId, planResult);
          expressionCtx.stages[stageId] = { outputs: planResult.outputs };

        } else if (stageId === "plan-approval") {
          // Output approval protocol message — host handles user interaction
          console.log("LINEUP:approval:plan");
          const approvalResult: StageResult = { id: stageId, status: "complete", outputs: { approved: true } };
          stageResults.set(stageId, approvalResult);
          expressionCtx.stages[stageId] = { outputs: approvalResult.outputs };

        } else if (stageId === "implement" || stageId === "verify") {
          // Phase 2: invoke TF with passthrough planner for workers + validator
          if (stageId === "implement") {
            const tfResult = await executeTfPhase(
              workflow, expressionCtx, host, projectRoot, artifactDir, options.timeout
            );
            stageResults.set("implement", tfResult.implementResult);
            stageResults.set("verify", tfResult.verifyResult);
            expressionCtx.stages["implement"] = { outputs: tfResult.implementResult.outputs };
            expressionCtx.stages["verify"] = { outputs: tfResult.verifyResult.outputs };
          }
          // verify is handled together with implement in TF invocation

        } else if (postStages.has(stageId)) {
          const result = executePostStage(stage, expressionCtx, projectRoot);
          stageResults.set(stageId, result);
        }
      }
    }

    // 10. Cleanup on success
    cleanup(artifactDir, cacheDir, true);
  } catch (error) {
    status = "failed";
    // Cleanup on error (keep cache for debugging)
    cleanup(artifactDir, cacheDir, false);
    throw error;
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

function detectHost(): HostName {
  // Check for host CLIs in order of preference
  try { execSync("which claude", { stdio: "ignore" }); return "claude"; } catch {}
  try { execSync("which codex", { stdio: "ignore" }); return "codex"; } catch {}
  try { execSync("which opencode", { stdio: "ignore" }); return "opencode"; } catch {}
  throw new Error("No supported host CLI found (claude, codex, or opencode).");
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
  projectRoot: string
): StageResult {
  // Output protocol message for the host orchestrator to handle
  console.log(`LINEUP:stage:start id=${stage.id} type=${stage.type}`);
  if (stage.type === "builtin") {
    console.log(`LINEUP:stage:builtin id=${stage.id}`);
  } else if (stage.type === "reasoning") {
    console.log(`LINEUP:stage:reasoning id=${stage.id}`);
  } else if (stage.type === "agent") {
    console.log(`LINEUP:stage:spawn agent=${stage.agent} id=${stage.id}`);
  }
  console.log(`LINEUP:stage:complete id=${stage.id}`);
  return { id: stage.id, status: "complete", outputs: {} };
}

async function executePlannerPhase(
  stage: WorkflowStage,
  workflow: WorkflowDefinition,
  ctx: ExpressionContext,
  host: HostName,
  projectRoot: string,
  artifactDir: string
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

  // Invoke planner adapter directly (Phase 1)
  console.log("LINEUP:stage:start id=plan type=agent agent=architect");
  console.log(`LINEUP:planner:invoke adapter=${adapterPaths.planner.adapterPath}`);

  // The host orchestrator reads this and invokes the planner
  // The planner output (TaskManifest YAML) is written to artifactDir
  const manifestPath = resolve(artifactDir, "planner-output.yaml");
  console.log(`LINEUP:planner:output path=${manifestPath}`);
  console.log("LINEUP:stage:complete id=plan");

  return {
    id: stage.id,
    status: "complete",
    outputs: { manifestPath },
  };
}

async function executeTfPhase(
  workflow: WorkflowDefinition,
  ctx: ExpressionContext,
  host: HostName,
  projectRoot: string,
  artifactDir: string,
  timeout?: number
): Promise<{ implementResult: StageResult; verifyResult: StageResult }> {
  const manifestPath = ctx.stages["plan"]?.outputs?.manifestPath as string;
  if (!manifestPath) {
    throw new Error("No planner manifest found. Plan stage must complete before TF invocation.");
  }

  // Generate passthrough config
  const tfCtx: TfGeneratorContext = {
    workflow,
    projectRoot,
    runId: artifactDir.split("/").pop()!,
    adaptersDir: resolve(artifactDir, "adapters"),
    promptsDir: resolve(artifactDir, "adapters"),
    host,
    timeout,
  };
  const configYaml = generatePassthroughConfig(tfCtx, manifestPath);
  const configPath = resolve(artifactDir, "tf-config.yaml");
  writeFileSync(configPath, configYaml, "utf-8");

  // Write input file (user request)
  const inputPath = resolve(artifactDir, "request.txt");
  // Input will be populated by the host orchestrator

  // Invoke TF
  console.log("LINEUP:tf:invoke");
  console.log(`LINEUP:tf:config path=${configPath}`);
  console.log(`LINEUP:tf:command task-foundry --config ${configPath} --input-file ${inputPath}`);
  if (timeout) {
    console.log(`LINEUP:tf:timeout ${timeout}`);
  }

  // TF output directory
  const tfOutputDir = resolve(projectRoot, ".runner-output");
  console.log(`LINEUP:tf:output dir=${tfOutputDir}`);

  return {
    implementResult: { id: "implement", status: "complete", outputs: { tfOutputDir } },
    verifyResult: { id: "verify", status: "complete", outputs: { tfOutputDir } },
  };
}

function executePostStage(
  stage: WorkflowStage,
  ctx: ExpressionContext,
  projectRoot: string
): StageResult {
  console.log(`LINEUP:stage:start id=${stage.id} type=${stage.type}`);
  if (stage.type === "agent") {
    console.log(`LINEUP:stage:spawn agent=${stage.agent} id=${stage.id}`);
  }
  console.log(`LINEUP:stage:complete id=${stage.id}`);
  return { id: stage.id, status: "complete", outputs: {} };
}

function cleanup(artifactDir: string, cacheDir: string, success: boolean): void {
  // Always clean ephemeral artifacts
  try {
    rmSync(artifactDir, { recursive: true, force: true });
  } catch {}

  // Clean cache only on success
  if (success && existsSync(cacheDir)) {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {}
  }

  console.log("LINEUP:pipeline:complete");
}
