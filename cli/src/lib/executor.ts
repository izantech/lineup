import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { stringify as stringifyYaml } from "yaml";

import type { ArtifactStore, StoredArtifactRecord } from "./artifact-store.js";
import type { VerificationResult } from "./verification.js";
import { readOllamaConfig } from "./config.js";
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
import type { ImplementMethod, WorkflowStage } from "./types.js";
import { buildAgentSystemPrompt } from "./prompt-builder.js";
import type { HostName } from "./constants.js";
import {
  parseRestrictedYaml,
  selectRestrictedYamlDocument,
  validatePlanYaml,
  validateReviewYaml,
  validateTasksJson
} from "./validation.js";
import { repairJsonOutput, repairYamlOutput } from "./llm-output-repair.js";
import { packageRoot } from "./paths.js";
import { assertSuccess, runCommand } from "./process.js";

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
  timeoutMs?: number;
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
  verificationResults?: VerificationResult[];
  timeoutMs?: number;
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
  host?: HostName;
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
  implementMethod?: ImplementMethod;
  verificationResults?: VerificationResult[];
  taskFilter?: string[];
};

export type PreparedExecutionArtifacts = {
  approvedPlan: ApprovedPlan;
  tasksArtifact: CompiledTasksArtifact;
  planRecord: StoredArtifactRecord;
  tasksRecord: StoredArtifactRecord;
};

export type NativeExecutorResult = {
  planRecord: StoredArtifactRecord;
  tasksRecord: StoredArtifactRecord;
  reviewRecord: StoredArtifactRecord;
  workspacePatchPath?: string;
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
  failedTaskIds: string[];
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

export function normalizePlanForStage(rawPlan: string, source: string, projectRoot: string): string {
  try {
    validatePlanYaml(rawPlan, source);
    return rawPlan;
  } catch {
    const normalized = normalizePlanDraft(parseRestrictedYaml(rawPlan, source), source, projectRoot);
    const validatedRaw = stringifyYaml(normalized);
    validatePlanYaml(validatedRaw, source);
    return validatedRaw;
  }
}

function normalizeApprovedPlan(rawPlan: string, source: string, projectRoot: string): { raw: string; parsed: ApprovedPlan } {
  let parsed: NormalizedPlanArtifact;
  const validatedRaw = normalizePlanForStage(rawPlan, source, projectRoot);
  parsed = parseRestrictedYaml(validatedRaw, source) as NormalizedPlanArtifact;

  if (parsed.status === "approved") {
    return { raw: validatedRaw, parsed: parsed as ApprovedPlan };
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

function normalizePlanDraft(raw: unknown, source: string, projectRoot: string): NormalizedPlanArtifact {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new CliError(`Plan ${source} must be a YAML object.`, {
      code: "artifact_validation_failed"
    });
  }

  const doc = raw as Record<string, unknown>;
  const normalizedChanges = normalizePlanChanges(doc.changes, projectRoot);
  const changeIdMap = new Map<string, number>();
  normalizedChanges.forEach((change, index) => {
    changeIdMap.set(String(index + 1), index + 1);
    if (typeof change._sourceId === "string" && change._sourceId.length > 0) {
      changeIdMap.set(change._sourceId, index + 1);
    }
  });

  const dependencies = normalizePlanDependencies(doc.dependencies, changeIdMap);
  const parallelizationStrategy = normalizeParallelizationStrategy(doc.parallelization_strategy, changeIdMap);

  const batches = parallelizationStrategy.batches ?? [];
  const normalized: NormalizedPlanArtifact = {
    apiVersion: "lineup/v3",
    kind: "Plan",
    status: normalizePlanStatus(doc.status),
    summary: coerceRequiredString(doc.summary, "summary", source),
    approaches: normalizePlanApproaches(doc.approaches),
    recommendation: normalizePlanRecommendation(doc.recommendation, doc.approaches),
    changes: normalizedChanges.map(({ _sourceId, ...change }) => change),
    acceptance_criteria: normalizeAcceptanceCriteria(doc.acceptance_criteria),
    risks: normalizePlanRisks(doc.risks),
    ...(dependencies.length > 0 ? { dependencies } : {}),
    ...(batches.length > 0 ||
    parallelizationStrategy.default_recommendation ||
    parallelizationStrategy.rationale
      ? { parallelization_strategy: parallelizationStrategy }
      : {})
  };

  return normalized;
}

type NormalizedPlanArtifact = Omit<ApprovedPlan, "status"> & {
  status: "draft" | "approved" | "superseded";
};

type NormalizedPlanChange = ApprovedPlan["changes"][number] & { _sourceId?: string };

function coerceRequiredString(value: unknown, label: string, source: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new CliError(`Plan ${source} is missing required field '${label}'.`, {
    code: "artifact_validation_failed"
  });
}

function normalizePlanStatus(value: unknown): NormalizedPlanArtifact["status"] {
  if (value === "approved" || value === "superseded") {
    return value;
  }
  return "draft";
}

function normalizePlanApproaches(value: unknown): ApprovedPlan["approaches"] {
  if (!Array.isArray(value) || value.length === 0) {
    return [
      {
        name: "Default approach",
        strategy: "Implement the requested change directly with the smallest viable diff."
      }
    ];
  }

  return value.map((entry, index) => {
    const item = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
    const scope = normalizeApproachScope(item.scope ?? item.estimated_scope);
    return {
      name:
        firstNonEmptyString(item.name, item.id, item.approach, `Approach ${index + 1}`) ?? `Approach ${index + 1}`,
      strategy:
        firstNonEmptyString(item.strategy, item.description, item.summary, "Describe how the approach works.") ??
        "Describe how the approach works.",
      ...(normalizeStringArray(item.pros).length > 0 ? { pros: normalizeStringArray(item.pros) } : {}),
      ...(normalizeStringArray(item.cons).length > 0 ? { cons: normalizeStringArray(item.cons) } : {}),
      ...(scope ? { scope } : {})
    };
  });
}

function normalizeApproachScope(value: unknown): { files_changed?: number; lines_changed?: number } | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    const filesChanged = coercePositiveInteger(item.files_changed);
    const linesChanged = coercePositiveInteger(item.lines_changed);
    if (filesChanged !== undefined || linesChanged !== undefined) {
      return {
        ...(filesChanged !== undefined ? { files_changed: filesChanged } : {}),
        ...(linesChanged !== undefined ? { lines_changed: linesChanged } : {})
      };
    }
    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const filesMatch = value.match(/(\d+)\s*file/i);
  const lineMatch = value.match(/(\d+)(?:\s*-\s*(\d+))?\s*line/i);
  const filesChanged = filesMatch ? Number.parseInt(filesMatch[1], 10) : undefined;
  const linesChanged = lineMatch ? Number.parseInt(lineMatch[2] ?? lineMatch[1], 10) : undefined;
  if (filesChanged === undefined && linesChanged === undefined) {
    return undefined;
  }
  return {
    ...(filesChanged !== undefined ? { files_changed: filesChanged } : {}),
    ...(linesChanged !== undefined ? { lines_changed: linesChanged } : {})
  };
}

function normalizePlanRecommendation(value: unknown, approaches: unknown): ApprovedPlan["recommendation"] {
  const item = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const normalizedApproaches = normalizePlanApproaches(approaches);
  return {
    approach: firstNonEmptyString(item.approach, normalizedApproaches[0]?.name, "Default approach") ?? "Default approach",
    rationale:
      firstNonEmptyString(
        item.rationale,
        "This approach best balances scope, risk, and implementation speed for the requested task."
      ) ?? "This approach best balances scope, risk, and implementation speed for the requested task."
  };
}

function normalizePlanChanges(value: unknown, projectRoot: string): NormalizedPlanChange[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CliError("Plan must include at least one change.", {
      code: "artifact_validation_failed"
    });
  }

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }

    const item = entry as Record<string, unknown>;
    const file = normalizeDraftPath(firstNonEmptyString(item.file, item.path, item.file_path), projectRoot);
    const change = firstNonEmptyString(item.change, item.description, item.action, item.what_to_change);
    if (!file || !change) {
      return [];
    }

    return [
      {
        file,
        change,
        rationale:
          firstNonEmptyString(
            item.rationale,
            item.description,
            item.reason,
            item.why_this_change_is_needed,
            "Required to satisfy the approved plan."
          ) ??
          "Required to satisfy the approved plan.",
        ...(normalizeDraftPaths(normalizeStringArray(item.reads), projectRoot).length > 0
          ? { reads: normalizeDraftPaths(normalizeStringArray(item.reads), projectRoot) }
          : {}),
        ...(typeof item.id === "string" && item.id.trim().length > 0 ? { _sourceId: item.id.trim() } : {})
      }
    ];
  });
}

function normalizeDraftPath(value: string | undefined, projectRoot: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (!path.isAbsolute(value)) {
    return value;
  }

  const relative = path.relative(projectRoot, value);
  if (!relative || relative.startsWith("..")) {
    const recovered = recoverRepoRelativeSuffix(value, projectRoot);
    return recovered ?? value;
  }

  return relative.replaceAll(path.sep, "/");
}

function recoverRepoRelativeSuffix(value: string, projectRoot: string): string | undefined {
  const normalized = path.normalize(value);
  const segments = normalized.split(path.sep).filter((segment) => segment.length > 0);

  for (let start = 0; start < segments.length; start += 1) {
    const candidate = path.join(...segments.slice(start));
    const projectCandidate = path.join(projectRoot, candidate);
    if (existsSync(projectCandidate)) {
      return candidate.replaceAll(path.sep, "/");
    }
  }

  return undefined;
}

function normalizeDraftPaths(values: string[], projectRoot: string): string[] {
  return values
    .map((value) => normalizeDraftPath(value, projectRoot))
    .filter((value): value is string => Boolean(value));
}

function normalizeParallelizationStrategy(
  value: unknown,
  changeIdMap: Map<string, number>
): NonNullable<ApprovedPlan["parallelization_strategy"]> {
  const item = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const batches = Array.isArray(item.batches)
    ? item.batches.flatMap((entry, index) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          return [];
        }
        const batch = entry as Record<string, unknown>;
        const normalizedChanges = normalizeChangeReferences(batch.changes, changeIdMap);
        if (normalizedChanges.length === 0) {
          return [];
        }
        return [
          {
            batch_number: coercePositiveInteger(batch.batch_number) ?? coercePositiveInteger(batch.batch) ?? index + 1,
            execution: normalizeExecutionMode(batch.execution, batch.parallel),
            changes: normalizedChanges,
            rationale:
              firstNonEmptyString(batch.rationale, batch.notes, "These changes can be executed together.") ??
              "These changes can be executed together."
          }
        ];
      })
    : [];

  const defaultRecommendation = normalizeExecutionLabel(item.default_recommendation ?? item.recommendation);
  const rationale = firstNonEmptyString(item.rationale, item.notes);

  return {
    ...(batches.length > 0 ? { batches } : {}),
    ...(defaultRecommendation ? { default_recommendation: defaultRecommendation } : {}),
    ...(rationale ? { rationale } : {})
  };
}

function normalizePlanDependencies(
  value: unknown,
  changeIdMap: Map<string, number>
): NonNullable<ApprovedPlan["dependencies"]> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const item = entry as Record<string, unknown>;
    const fromChange = resolveChangeReference(item.from_change ?? item.from, changeIdMap);
    const toChange = resolveChangeReference(item.to_change ?? item.to, changeIdMap);
    const description = firstNonEmptyString(item.description, item.reason);
    if (!fromChange || !toChange || !description || fromChange === toChange) {
      return [];
    }
    return [
      {
        from_change: fromChange,
        to_change: toChange,
        description
      }
    ];
  });
}

function normalizeAcceptanceCriteria(value: unknown): ApprovedPlan["acceptance_criteria"] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ criterion: "The requested change is implemented and verified." }];
  }

  return value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim().length > 0) {
      return [{ criterion: entry.trim() }];
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const item = entry as Record<string, unknown>;
    const criterion = firstNonEmptyString(item.criterion, item.description, item.name);
    if (!criterion) {
      return [];
    }
    const verifiedBy = firstNonEmptyString(item.verified_by, item.verification, item.verify_with);
    return [
      {
        criterion,
        ...(verifiedBy ? { verified_by: verifiedBy } : {})
      }
    ];
  });
}

function normalizePlanRisks(value: unknown): ApprovedPlan["risks"] {
  const defaultRisks = [
    {
      risk: "No explicit risks were captured in the draft plan.",
      mitigation: "Review the implementation scope before execution.",
      severity: "low" as const
    }
  ];

  if (!Array.isArray(value) || value.length === 0) {
    return defaultRisks;
  }

  const normalized = value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim().length > 0) {
      return [
        {
          risk: entry.trim(),
          mitigation: "Address during implementation review."
        }
      ];
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const item = entry as Record<string, unknown>;
    const risk = firstNonEmptyString(item.risk, item.description);
    if (!risk) {
      return [];
    }
    const severity = normalizeSeverity(item.severity, item.impact, item.likelihood);
    return [
      {
        risk,
        mitigation:
          firstNonEmptyString(item.mitigation, item.response, "Address during implementation review.") ??
          "Address during implementation review.",
        ...(severity ? { severity } : {})
      }
    ];
  });

  return normalized.length > 0 ? normalized : defaultRisks;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function coercePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

function normalizeExecutionMode(execution: unknown, parallel: unknown): "parallel" | "serial" {
  const normalizedExecution = normalizeExecutionLabel(execution);
  if (normalizedExecution) {
    return normalizedExecution;
  }
  return parallel === true ? "parallel" : "serial";
}

function normalizeExecutionLabel(value: unknown): "parallel" | "serial" | undefined {
  if (value === "parallel" || value === "serial") {
    return value;
  }
  if (value === "sequential") {
    return "serial";
  }
  return undefined;
}

function normalizeSeverity(...values: unknown[]): "low" | "medium" | "high" | "critical" | undefined {
  for (const value of values) {
    if (value === "low" || value === "medium" || value === "high" || value === "critical") {
      return value;
    }
  }
  return undefined;
}

function resolveChangeReference(value: unknown, changeIdMap: Map<string, number>): number | undefined {
  const direct = coercePositiveInteger(value);
  if (direct !== undefined) {
    return direct;
  }
  if (typeof value === "string") {
    return changeIdMap.get(value.trim());
  }
  return undefined;
}

function normalizeChangeReferences(value: unknown, changeIdMap: Map<string, number>): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => resolveChangeReference(entry, changeIdMap)).filter((entry): entry is number => entry !== undefined))];
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

function writeExecutorFailureSnapshot(artifactDir: string, payload: unknown): void {
  writeJsonRequest(path.join(artifactDir, "native", "executor-debug.json"), payload);
}

function collectPatchScopes(tasksArtifact: CompiledTasksArtifact): string[] {
  return [...new Set(
    tasksArtifact.tasks
      .flatMap((task) => task.write_scope ?? [])
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0)
      .sort((left, right) => left.localeCompare(right))
  )];
}

async function scopeExistsInWorkspace(worktreeRoot: string, scope: string): Promise<boolean> {
  if (existsSync(path.join(worktreeRoot, scope))) {
    return true;
  }

  const trackedResult = await runCommand("git", ["-C", worktreeRoot, "ls-tree", "-r", "--name-only", "HEAD", "--", scope]);
  if (trackedResult.code !== 0) {
    return false;
  }

  return trackedResult.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .some((entry) => entry.length > 0);
}

async function captureWorkspacePatch(
  worktreeRoot: string,
  baselineHead: string,
  artifactDir: string,
  tasksArtifact: CompiledTasksArtifact
): Promise<string | undefined> {
  const candidateScopes = collectPatchScopes(tasksArtifact);
  const scopes: string[] = [];
  for (const scope of candidateScopes) {
    if (await scopeExistsInWorkspace(worktreeRoot, scope)) {
      scopes.push(scope);
    }
  }
  if (scopes.length === 0) {
    return undefined;
  }

  const addResult = await runCommand("git", ["-C", worktreeRoot, "add", "-A", "--", ...scopes]);
  assertSuccess(addResult, `git add -A for ${worktreeRoot}`);

  const diffResult = await runCommand("git", ["-C", worktreeRoot, "diff", "--cached", "--binary", baselineHead, "--", ...scopes]);
  assertSuccess(diffResult, `git diff --cached --binary ${baselineHead} for ${worktreeRoot}`);

  const patch = diffResult.stdout;
  if (patch.trim().length === 0) {
    return undefined;
  }

  const patchPath = path.join(artifactDir, "native", "workspace.patch");
  ensureParentDirectory(patchPath);
  writeFileSync(patchPath, patch, "utf8");
  return patchPath;
}

export async function applyWorkspacePatch(sourceRoot: string, patchPath?: string): Promise<void> {
  if (!patchPath || !existsSync(patchPath)) {
    return;
  }

  const checkResult = await runCommand("git", ["-C", sourceRoot, "apply", "--check", "--whitespace=nowarn", patchPath]);
  if (checkResult.code !== 0) {
    const reverseCheckResult = await runCommand("git", [
      "-C",
      sourceRoot,
      "apply",
      "--reverse",
      "--check",
      "--whitespace=nowarn",
      patchPath
    ]);

    if (reverseCheckResult.code === 0) {
      return;
    }

    assertSuccess(checkResult, `git apply --check for ${patchPath}`);
  }

  const applyResult = await runCommand("git", ["-C", sourceRoot, "apply", "--whitespace=nowarn", patchPath]);
  assertSuccess(applyResult, `git apply for ${patchPath}`);
}

export async function waitForResponseFile(filePath: string, label: string, timeoutMs = 300_000): Promise<string> {
  const startedAt = Date.now();
  const pollIntervalMs = 100;

  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8");
      if (raw.trim().length > 0) {
        return raw;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new CliError(`${label} timed out after ${timeoutMs}ms at ${filePath}.`, {
    code: "timeout"
  });
}

function normalizeYamlArtifact(
  raw: string,
  source: string,
  validate: (content: string, source: string) => void
): string {
  const yamlRepair = repairYamlOutput(raw);
  try {
    validate(yamlRepair.content, source);
    return yamlRepair.content;
  } catch (yamlError) {
    const jsonRepair = repairJsonOutput(raw);

    try {
      const parsed = JSON.parse(jsonRepair.content);
      const converted = stringifyYaml(parsed);
      validate(converted, source);
      return converted;
    } catch {
      throw yamlError;
    }
  }
}

export function normalizeReviewArtifact(raw: string, source: string): string {
  try {
    validateReviewYaml(raw, source);
    return raw;
  } catch {
    // fall through to best-effort normalization
  }

  let parsed: unknown;
  try {
    parsed = parseRestrictedYaml(raw, source);
  } catch (error) {
    if (error instanceof CliError && error.code === "yaml_parse_failed") {
      try {
        parsed = parseRestrictedYaml(repairYamlOutput(raw).content, source);
      } catch {
        // keep falling through to the existing recovery paths
      }

      if (parsed === undefined) {
        try {
          parsed = parseRestrictedYaml(normalizeInlineReviewTestResults(raw), source);
        } catch {
          // keep falling through to the existing recovery paths
        }
      }
    }

    if (parsed !== undefined) {
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return raw;
      }
    } else {
    if (error instanceof CliError && error.code === "yaml_parse_failed") {
      try {
        const recovered = selectRestrictedYamlDocument(raw, source, {
          describe: "review artifact",
          normalize: (payload) => {
            if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
              return null;
            }

            const candidate = stringifyYaml(payload);
            try {
              validateReviewYaml(candidate, source);
              return candidate;
            } catch {
              return null;
            }
          }
        });

        if (recovered) {
          return recovered;
        }
      } catch (recoveryError) {
        if (!(recoveryError instanceof CliError) || recoveryError.code !== "yaml_parse_failed") {
          throw recoveryError;
        }
      }
    }

    const markdownReview = normalizeMarkdownReviewArtifact(raw);
    if (markdownReview) {
      return stringifyYaml(markdownReview);
    }
    return raw;
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return raw;
  }

  const doc = parsed as Record<string, unknown>;
  const testSuite = normalizeReviewTestSuite(doc.test_results);
  const normalized = {
    apiVersion: normalizeReviewApiVersion(doc.apiVersion, doc.lineup),
    kind: "Review",
    ...(typeof doc.type === "string" && doc.type.trim().length > 0 ? { type: "review" } : {}),
    ...(typeof doc.agent === "string" && doc.agent.trim().length > 0 ? { agent: "reviewer" } : {}),
    ...(typeof doc.date === "string" && doc.date.trim().length > 0 ? { date: doc.date.trim() } : {}),
    ...(typeof doc.topic === "string" && doc.topic.trim().length > 0 ? { topic: doc.topic.trim() } : {}),
    ...(doc.pipeline_stage !== undefined ? { pipeline_stage: doc.pipeline_stage } : {}),
    ...(typeof doc.plan_ref === "string" && doc.plan_ref.trim().length > 0 ? { plan_ref: doc.plan_ref.trim() } : {}),
    status: normalizeReviewStatus(doc.status),
    summary: firstNonEmptyString(doc.summary, "Review completed.") ?? "Review completed.",
    issues: normalizeReviewIssues(doc.issues),
    test_results: {
      test_suite: testSuite
    }
  };

  return stringifyYaml(normalized);
}

function normalizeInlineReviewTestResults(raw: string): string {
  return raw.replace(
    /^test_results:\s+(.+)$/m,
    (_match, detail: string) => [
      "test_results:",
      "  test_suite:",
      "    status: pass",
      `    note: ${JSON.stringify(detail.trim())}`
    ].join("\n")
  );
}

function normalizeMarkdownReviewArtifact(raw: string): Record<string, unknown> | undefined {
  const statusMatch =
    raw.match(/\*\*Status:\s*([A-Z_ ]+)\*\*/i) ??
    raw.match(/\*\*Status:\*\*\s*([A-Z_ ]+)(?:\n|$)/i) ??
    raw.match(/\*\*Status\*\*:\s*([A-Z_ ]+)(?:\n|$)/i);
  const summaryMatch =
    raw.match(/\*\*Summary:\*\*\s*([\s\S]*?)(?:\n\s*\n\*\*|\n\*\*|$)/i) ??
    raw.match(/\*\*Summary\*\*:\s*([\s\S]*?)(?:\n\s*\n\*\*|\n\*\*|$)/i);
  if (!statusMatch && !summaryMatch) {
    return undefined;
  }

  const issuesMatch =
    raw.match(/\*\*Issues:\*\*\s*([\s\S]*?)(?:\n\s*\n\*\*|\n\*\*|$)/i) ??
    raw.match(/\*\*Issues\*\*:\s*([\s\S]*?)(?:\n\s*\n\*\*|\n\*\*|$)/i);
  const testsMatch =
    raw.match(/\*\*Test results:\*\*\s*([\s\S]*)$/i) ??
    raw.match(/\*\*Test results\*\*:\s*([\s\S]*)$/i);
  const testLines = (testsMatch?.[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  const testsFailed = testLines.filter((line) => /\*\*fail\*\*|: fail\b/i.test(line)).length;
  const testsRun = testLines.length;

  return {
    apiVersion: "lineup/v3",
    kind: "Review",
    status: normalizeReviewStatus(statusMatch?.[1]?.trim()?.replaceAll(" ", "_")),
    summary: (summaryMatch?.[1] ?? "Review completed.").trim(),
    issues: normalizeMarkdownIssues(issuesMatch?.[1]),
    test_results: {
      test_suite: {
        status: testsFailed > 0 ? "fail" : "pass",
        ...(testsRun > 0 ? { tests_run: testsRun } : {}),
        ...(testsRun > 0 ? { tests_passed: Math.max(0, testsRun - testsFailed) } : {}),
        ...(testsRun > 0 ? { tests_failed: testsFailed } : {})
      }
    }
  };
}

function normalizeMarkdownIssues(rawIssues: string | undefined): Array<{
  severity: "critical" | "warning" | "suggestion";
  confidence: number;
  file: string;
  line: number;
  description: string;
  fix: string;
}> {
  if (!rawIssues) {
    return [];
  }

  const trimmed = rawIssues.trim();
  if (trimmed.length === 0 || /^none\.?$/i.test(trimmed)) {
    return [];
  }

  return trimmed
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => ({
      severity: "warning" as const,
      confidence: 80,
      file: "unknown",
      line: 1,
      description: line,
      fix: "Review and address the reported issue."
    }));
}

function normalizeReviewApiVersion(apiVersion: unknown, lineup: unknown): "lineup/v3" {
  if (apiVersion === "lineup/v3") {
    return "lineup/v3";
  }
  if (lineup === "v3" || lineup === "lineup/v3") {
    return "lineup/v3";
  }
  return "lineup/v3";
}

function normalizeReviewStatus(value: unknown): "PASS" | "FAIL" | "PASS_WITH_WARNINGS" {
  if (value === "PASS" || value === "FAIL" || value === "PASS_WITH_WARNINGS") {
    return value;
  }
  if (value === "PASS WITH WARNINGS") {
    return "PASS_WITH_WARNINGS";
  }
  return "PASS";
}

function normalizeReviewIssues(value: unknown): Array<{
  severity: "critical" | "warning" | "suggestion";
  confidence: number;
  file: string;
  line: number;
  description: string;
  fix: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const item = entry as Record<string, unknown>;
    const severity = normalizeIssueSeverity(item.severity);
    const confidence = typeof item.confidence === "number" ? item.confidence : 75;
    const file = firstNonEmptyString(item.file);
    const line = typeof item.line === "number" ? item.line : 1;
    const description = firstNonEmptyString(item.description);
    const fix = firstNonEmptyString(item.fix, item.recommendation);
    if (!severity || !file || !description || !fix) {
      return [];
    }
    return [{ severity, confidence: Math.max(75, Math.min(100, Math.round(confidence))), file, line, description, fix }];
  });
}

function normalizeIssueSeverity(value: unknown): "critical" | "warning" | "suggestion" | undefined {
  if (value === "critical" || value === "warning" || value === "suggestion") {
    return value;
  }
  if (value === "Critical") return "critical";
  if (value === "Warning") return "warning";
  if (value === "Suggestion") return "suggestion";
  return undefined;
}

function normalizeReviewTestSuite(value: unknown): {
  status: "pass" | "fail";
  tests_run?: number;
  tests_passed?: number;
  tests_failed?: number;
} {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    if (typeof item.test_suite === "object" && item.test_suite !== null && !Array.isArray(item.test_suite)) {
      const suite = item.test_suite as Record<string, unknown>;
      const status = suite.status === "fail" ? "fail" : "pass";
      return {
        status,
        ...(typeof suite.tests_run === "number" ? { tests_run: suite.tests_run } : {}),
        ...(typeof suite.tests_passed === "number" ? { tests_passed: suite.tests_passed } : {}),
        ...(typeof suite.tests_failed === "number" ? { tests_failed: suite.tests_failed } : {})
      };
    }
  }

  if (Array.isArray(value)) {
    const testsRun = value.length;
    const testsFailed = value.filter((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return false;
      }
      const item = entry as Record<string, unknown>;
      return item.outcome === "fail" || item.status === "fail";
    }).length;
    const testsPassed = Math.max(0, testsRun - testsFailed);
    return {
      status: testsFailed > 0 ? "fail" : "pass",
      tests_run: testsRun,
      tests_passed: testsPassed,
      tests_failed: testsFailed
    };
  }

  return { status: "pass" };
}

function normalizeTaskExecutionStatus(value: unknown): "complete" {
  if (value === "complete" || value === "done" || value === "success") {
    return "complete";
  }
  return "complete";
}

function normalizeImplementationChanges(value: unknown, task: CompiledTask): ImplementationChange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const defaultFile = task.write_scope?.[0] ?? task.deliverables?.[0] ?? task.id;
  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      const description = entry.trim();
      if (!description) {
        return [];
      }

      return [{
        file: defaultFile,
        description,
        task_id: task.id
      }];
    }

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }

    const item = entry as Record<string, unknown>;
    const file = firstNonEmptyString(item.file, defaultFile);
    const description = firstNonEmptyString(item.description, item.change, item.summary);
    if (!file || !description) {
      return [];
    }

    return [{
      file,
      description,
      task_id: firstNonEmptyString(item.task_id, item.taskId, task.id) ?? task.id
    }];
  });
}

function normalizeImplementationIssues(value: unknown): ImplementationIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }

    const item = entry as Record<string, unknown>;
    const issue = firstNonEmptyString(item.issue, item.description, item.summary);
    if (!issue) {
      return [];
    }

    const impact = item.impact === "minor" || item.impact === "moderate" || item.impact === "significant" ? item.impact : "none";
    return [{
      issue,
      ...(typeof item.resolution === "string" && item.resolution.trim().length > 0 ? { resolution: item.resolution.trim() } : {}),
      impact
    }];
  });
}

function extractMarkdownSection(raw: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`\\*\\*${escaped}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[^\\n]+:\\*\\*|$)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function summarizeProseTaskResult(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const [firstBlock] = trimmed.split(/\n\s*\n\*\*/);
  const summary = firstBlock?.trim();
  return summary && summary.length > 0 ? summary : null;
}

function parseProseListSection(section: string | null): string[] {
  if (!section) {
    return [];
  }

  const trimmed = section.trim();
  if (!trimmed || /^none\.?$/i.test(trimmed)) {
    return [];
  }

  const bulletItems = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0);

  if (bulletItems.length > 0) {
    return bulletItems;
  }

  return [trimmed.replace(/\s+/g, " ")];
}

function normalizeTaskExecutionResultFromProse(raw: string, task: CompiledTask, source: string): NativeTaskExecutionResult {
  const summary = summarizeProseTaskResult(raw);
  if (!summary) {
    throw new CliError(`Task response ${source} is invalid.`, {
      code: "malformed_output"
    });
  }

  const defaultFile = task.write_scope?.[0] ?? task.deliverables?.[0] ?? task.id;
  const changes_made = parseProseListSection(extractMarkdownSection(raw, "Changes made")).map((description) => ({
    file: defaultFile,
    description,
    task_id: task.id
  }));
  const issues_encountered = parseProseListSection(extractMarkdownSection(raw, "Issues encountered")).map((issue) => ({
    issue,
    impact: "none" as const
  }));

  return {
    status: "complete",
    summary,
    changes_made,
    issues_encountered
  };
}

export function normalizeTaskExecutionResult(raw: string, task: CompiledTask, source: string): NativeTaskExecutionResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(repairJsonOutput(raw).content) as Record<string, unknown>;
  } catch {
    return normalizeTaskExecutionResultFromProse(raw, task, source);
  }
  const summary = firstNonEmptyString(parsed.summary, parsed.result, parsed.message);
  if (!summary) {
    return normalizeTaskExecutionResultFromProse(raw, task, source);
  }

  return {
    status: normalizeTaskExecutionStatus(parsed.status),
    summary,
    changes_made: normalizeImplementationChanges(parsed.changes_made, task),
    issues_encountered: normalizeImplementationIssues(parsed.issues_encountered)
  };
}

function buildDeveloperPrompt(input: {
  projectRoot: string;
  host?: HostName;
  approvedPlan: ApprovedPlan;
  task: CompiledTask;
  attempt: number;
  previousErrors: Array<{ code: string; message: string }>;
  implementMethod?: ImplementMethod;
  priorTaskSummaries?: Array<{ task_id: string; summary: string }>;
}): string {
  const extraInstructions = buildDeveloperExtraInstructions(input);

  if (input.attempt > 1) {
    extraInstructions.push("", `Retry attempt: ${input.attempt}`);
    if (input.previousErrors.length > 0) {
      extraInstructions.push("Previous errors:", JSON.stringify(input.previousErrors, null, 2));
    }
  }

  // In single-session mode, include summaries of all prior tasks for full context.
  // In task mode, omit prior context for maximum isolation.
  // In phase mode (default), include summaries from current wave only.
  if (input.implementMethod === "single-session" && input.priorTaskSummaries?.length) {
    extraInstructions.push(
      "",
      "Prior completed tasks in this session:",
      ...input.priorTaskSummaries.map(t => `- ${t.task_id}: ${t.summary}`)
    );
  }

  return buildAgentSystemPrompt({
    agentFilePath: path.join(input.projectRoot, "agents", "developer.md"),
    promptTemplate: "{{AGENT_BODY}}",
    configOptions: {
      projectRoot: input.projectRoot,
      ...(input.host ? { host: input.host } : {})
    },
    extraInstructions: extraInstructions.join("\n")
  }).prompt;
}

function shouldUseCompactNativeOllamaPrompt(projectRoot: string, host?: HostName): boolean {
  if (!host) {
    return false;
  }

  return Boolean(readOllamaConfig({ projectRoot, host })?.hostIntegration?.enabled);
}

function buildDeveloperExtraInstructions(input: {
  projectRoot: string;
  host?: HostName;
  approvedPlan: ApprovedPlan;
  task: CompiledTask;
  attempt: number;
  previousErrors: Array<{ code: string; message: string }>;
  implementMethod?: ImplementMethod;
  priorTaskSummaries?: Array<{ task_id: string; summary: string }>;
}): string[] {
  const compact = shouldUseCompactNativeOllamaPrompt(input.projectRoot, input.host);
  const lines = compact
    ? [
        "Native Lineup task:",
        "- Apply edits directly in the provided worktree.",
        "- Keep the change strictly inside the declared write scope.",
        "- Read the target files in the write scope before editing them.",
        "- Make the requested file changes on disk before returning.",
        "- Do not stage, commit, stash, or otherwise clean the worktree.",
        "- A claimed change with no workspace diff is treated as failure.",
        "- Return JSON only with status, summary, changes_made[], and issues_encountered[].",
        `- Task ID: ${input.task.id}`,
        `- Wave: ${input.task.wave}`,
        `- Title: ${input.task.title}`,
        `- Write scope: ${(input.task.write_scope ?? []).join(", ") || "(none declared)"}`,
        `- Read scope: ${(input.task.read_scope ?? []).join(", ") || "(none declared)"}`,
        `- Deliverables: ${(input.task.deliverables ?? []).join(", ") || "(none declared)"}`,
        `- Approved plan summary: ${input.approvedPlan.summary}`
      ]
    : [
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
    lines.push("", `Retry attempt: ${input.attempt}`);
    if (input.previousErrors.length > 0) {
      lines.push(
        compact ? `Previous errors: ${JSON.stringify(input.previousErrors)}` : "Previous errors:",
        compact ? "" : JSON.stringify(input.previousErrors, null, 2)
      );
    }
  }

  if (input.implementMethod === "single-session" && input.priorTaskSummaries?.length) {
    lines.push(
      "",
      "Prior completed tasks in this session:",
      ...input.priorTaskSummaries.map((t) => `- ${t.task_id}: ${t.summary}`)
    );
  }

  return compact ? lines.filter((line) => line.length > 0) : lines;
}

function buildReviewerPrompt(input: {
  projectRoot: string;
  host?: HostName;
  approvedPlan: ApprovedPlan;
  implementationState: ImplementationState;
  tasksArtifact: CompiledTasksArtifact;
  verificationResults?: VerificationResult[];
  outputPath?: string;
  workspaceDiff?: string;
}): string {
  const templatePath = path.join(packageRoot(), "templates", "reviewer.yaml");
  const outputTemplate = existsSync(templatePath) ? readFileSync(templatePath, "utf8").trim() : null;
  const compact = shouldUseCompactNativeOllamaPrompt(input.projectRoot, input.host);
  const extraInstructions = compact
    ? [
        "Native Lineup review:",
        "- Review the completed implementation against the approved plan.",
        "- Treat the provided workspace diff and changed files as the source of truth.",
        "- Ignore .lineup, .lineup-core, and other runtime scaffolding unless they appear in changes_made or the workspace diff.",
        "- Do not modify, stage, commit, or clean files while reviewing.",
        "- Return only the final structured Review payload.",
        ...(input.outputPath
          ? [`- Write or emit the payload for ${input.outputPath}.`]
          : []),
        `- Approved plan summary: ${input.approvedPlan.summary}`,
        `- Task IDs: ${input.tasksArtifact.tasks.map((task) => task.id).join(", ") || "(none)"}`,
        "Implementation state summary:",
        JSON.stringify(
          {
            task_results: input.implementationState.task_results,
            changes_made: input.implementationState.changes_made,
            issues_encountered: input.implementationState.issues_encountered
          },
          null,
          2
        ),
        ...(input.workspaceDiff
          ? [
              "Workspace diff:",
              input.workspaceDiff
            ]
          : [])
      ]
    : [
        "Native Lineup v3 review contract:",
        "- Review the completed implementation against the approved plan.",
        "- Validate acceptance criteria and note concrete issues only.",
        "- Return a lineup/v3 Review YAML document.",
        ...(input.outputPath
          ? [`- Create or overwrite ${input.outputPath} with the final structured payload. If you cannot write the file directly, emit only the payload content for that path.`]
          : []),
        "",
        "Approved plan summary:",
        input.approvedPlan.summary,
        "",
        "Compiled tasks:",
        JSON.stringify(input.tasksArtifact.tasks, null, 2),
        "",
        "Implementation state:",
        JSON.stringify(input.implementationState, null, 2),
        ...(input.workspaceDiff
          ? [
              "",
              "Workspace diff:",
              input.workspaceDiff
            ]
          : [])
      ];

  if (outputTemplate) {
    extraInstructions.push(
      "",
      "Follow this output template shape exactly. Replace placeholder values, but keep the same YAML structure:",
      outputTemplate,
      "",
      "Do not return markdown headings, bullets, or prose outside the structured payload."
    );
  }

  if (input.verificationResults && input.verificationResults.length > 0) {
    extraInstructions.push(
      "",
      "Verification hook results:",
      JSON.stringify(input.verificationResults, null, 2)
    );
  }

  return buildAgentSystemPrompt({
    agentFilePath: path.join(input.projectRoot, "agents", "reviewer.md"),
    promptTemplate: "{{AGENT_BODY}}",
    configOptions: {
      projectRoot: input.projectRoot,
      ...(input.host ? { host: input.host } : {})
    },
    extraInstructions: extraInstructions.join("\n")
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
      const raw = await waitForResponseFile(
        responsePath,
        `Native task response for ${input.task.id}`,
        input.timeoutMs ?? 600_000
      );
      return normalizeTaskExecutionResult(raw, input.task, responsePath);
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
      const raw = await waitForResponseFile(
        reviewPath,
        "Native review response",
        input.timeoutMs ?? 300_000
      );
      return {
        reviewYaml: normalizeReviewArtifact(raw, reviewPath)
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

function collectScopedWorkspaceChanges(
  workspaceRoot: string,
  baselineHead: string,
  scope: string[]
): string[] {
  if (scope.length === 0) {
    return []
  }

  const addResult = spawnSync("git", ["add", "-A", "--", ...scope], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: process.env
  })

  if (addResult.status !== 0) {
    return []
  }

  const diffResult = spawnSync("git", ["diff", "--cached", "--name-only", baselineHead, "--", ...scope], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: process.env
  })

  if (diffResult.status !== 0) {
    return []
  }

  return diffResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const renameParts = line.split(" -> ")
      return renameParts.at(-1)?.trim() ?? line
    })
}

function inferTaskChangesFromWorkspace(
  workspaceRoot: string,
  baselineHead: string,
  task: CompiledTask,
  result: NativeTaskExecutionResult
): NativeTaskExecutionResult {
  const scope = task.write_scope?.length ? task.write_scope : task.deliverables ?? []
  if (scope.length === 0) {
    return result
  }

  const changedFiles = collectScopedWorkspaceChanges(workspaceRoot, baselineHead, scope)

  if (changedFiles.length === 0) {
    if ((result.changes_made?.length ?? 0) > 0) {
      throw new CliError(`Task ${task.id} reported file changes but produced no workspace diff.`, {
        code: "build_failure"
      })
    }

    return result
  }

  if ((result.changes_made?.length ?? 0) > 0) {
    return result
  }

  return {
    ...result,
    changes_made: changedFiles.map((file) => ({
      file,
      description: `Updated ${file}`,
      task_id: task.id
    }))
  }
}

function buildWorkspaceDiffContext(
  workspaceRoot: string,
  baselineHead: string,
  implementationState: ImplementationState
): string | undefined {
  const changedFiles = [...new Set(
    implementationState.changes_made
      .map((change) => change.file.trim())
      .filter((file) => file.length > 0)
  )]

  if (changedFiles.length === 0) {
    return undefined
  }

  const addResult = spawnSync("git", ["add", "-A", "--", ...changedFiles], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: process.env
  })

  if (addResult.status !== 0) {
    return undefined
  }

  const diff = spawnSync("git", ["diff", "--cached", "--binary", baselineHead, "--", ...changedFiles], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: process.env
  })

  if (diff.status !== 0) {
    return undefined
  }

  const content = diff.stdout.trim()
  if (content.length === 0) {
    return undefined
  }

  const maxLength = 12_000
  if (content.length <= maxLength) {
    return content
  }

  return `${content.slice(0, maxLength)}\n... [diff truncated]`
}

export async function executeNativeExecutor(options: NativeExecutorOptions): Promise<NativeExecutorResult> {
  const {
    approvedPlan,
    tasksArtifact,
    planRecord,
    tasksRecord
  } = prepareExecutionArtifacts({
    projectRoot: options.projectRoot,
    planPath: options.planPath,
    artifactStore: options.artifactStore,
    gitTreeSha: options.gitTreeSha
  });

  const driver = options.driver ?? defaultDriver(options.artifactDir);
  const workspace = await createNativeIsolationWorkspace({
    workspaceRoot: options.projectRoot,
    runId: options.runId,
    runRoot: path.join(options.runRoot, "native-isolation"),
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

    const method = options.implementMethod ?? "phase";
    const orderedWaves = [...tasksByWave.keys()].sort((left, right) => left - right);

    if (method !== "phase") {
      options.emitStatus("implement", `Execution method: ${method}.`);
    }

    for (const wave of orderedWaves) {
      const waveTasks = (tasksByWave.get(wave) ?? []).sort((left, right) => left.id.localeCompare(right.id));
      options.emitStatus("implement", `Executing native wave ${wave} (${waveTasks.map((task) => task.id).join(", ")}).`);

      for (const task of waveTasks) {
        if (options.taskFilter && !options.taskFilter.includes(task.id)) {
          implementationState.task_results.push({
            task_id: task.id,
            attempts: 0,
            summary: "skipped (not in retry filter)",
            write_scope: task.write_scope ?? [],
            read_scope: task.read_scope ?? []
          });
          continue;
        }
        try {
          const retryResult = await retryOperation(
            {
              maxAttempts: Math.max(options.implementStage.retry?.max_attempts ?? 1, 1),
              on: options.implementStage.retry?.on
            },
            async (retryContext) => {
              const prompt = buildDeveloperPrompt({
                projectRoot: options.projectRoot,
                host: options.host,
                approvedPlan,
                task,
                attempt: retryContext.attempt,
                previousErrors: retryContext.previousErrors,
                implementMethod: method,
                priorTaskSummaries: method === "single-session"
                  ? implementationState.task_results.map(r => ({ task_id: r.task_id, summary: r.summary }))
                  : undefined
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

              const rawResult = await driver.executeTask({
                runId: options.runId,
                projectRoot: options.projectRoot,
                runRoot: options.runRoot,
                artifactDir: options.artifactDir,
                workspaceRoot: workspace.worktreeRoot,
                task,
                wave,
                prompt,
                attempt: retryContext.attempt,
                timeoutMs: 600_000,
                previousErrors: retryContext.previousErrors
              });
              const result = inferTaskChangesFromWorkspace(workspace.worktreeRoot, workspace.baselineHead, task, rawResult)

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
        } catch (error) {
          writeExecutorFailureSnapshot(options.artifactDir, {
            phase: "implement",
            task_id: task.id,
            error: error instanceof Error ? error.message : String(error),
            implementation_state: implementationState
          });
          throw error;
        }
      }
    }

    options.emitStatus("implement", "Native task execution completed.", true);

    const workspaceDiff = buildWorkspaceDiffContext(workspace.worktreeRoot, workspace.baselineHead, implementationState)
    const reviewPrompt = buildReviewerPrompt({
      projectRoot: options.projectRoot,
      host: options.host,
      approvedPlan,
      implementationState,
      tasksArtifact,
      verificationResults: options.verificationResults,
      outputPath: path.join(options.artifactDir, "review.yaml"),
      workspaceDiff
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

    let reviewResult;
    try {
      reviewResult = await driver.executeReview({
        runId: options.runId,
        projectRoot: options.projectRoot,
        runRoot: options.runRoot,
        artifactDir: options.artifactDir,
        workspaceRoot: workspace.worktreeRoot,
        prompt: reviewPrompt,
        implementationState,
        approvedPlan,
        tasksArtifact,
        verificationResults: options.verificationResults,
        timeoutMs: 300_000
      });
    } catch (error) {
      writeExecutorFailureSnapshot(options.artifactDir, {
        phase: "verify",
        error: error instanceof Error ? error.message : String(error),
        implementation_state: implementationState
      });
      throw error;
    }
    const normalizedReviewYaml = normalizeReviewArtifact(reviewResult.reviewYaml, path.join(options.artifactDir, "review.yaml"));
    validateReviewYaml(normalizedReviewYaml, path.join(options.artifactDir, "review.yaml"));
    const reviewRecord = options.artifactStore.persistText("review", normalizedReviewYaml, "yaml");
    const workspacePatchPath = await captureWorkspacePatch(workspace.worktreeRoot, workspace.baselineHead, options.artifactDir, tasksArtifact);
    const parsedReview = parseRestrictedYaml(normalizedReviewYaml, reviewRecord.path) as Record<string, unknown>;

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

    const reviewIssueFiles = new Set(
      ((parsedReview.issues ?? []) as Array<{ file: string }>).map((issue) => issue.file)
    );
    const failedTaskIds = tasksArtifact.tasks
      .filter((task) => (task.write_scope ?? []).some((f) => reviewIssueFiles.has(f)))
      .map((task) => task.id);
    const effectiveFailedTaskIds = failedTaskIds.length > 0 ? failedTaskIds : tasksArtifact.tasks.map((task) => task.id);

    return {
      planRecord,
      tasksRecord,
      reviewRecord,
      workspacePatchPath,
      implementResult: {
        id: "implement",
        status: "complete",
        outputs: implementationState
      },
      verifyResult: {
        id: "verify",
        status: "complete",
        outputs: parsedReview
      },
      failedTaskIds: effectiveFailedTaskIds
    };
  } finally {
    await workspace.cleanup();
  }
}

export function prepareExecutionArtifacts(input: {
  projectRoot: string;
  planPath: string;
  artifactStore: ArtifactStore;
  gitTreeSha?: string;
}): PreparedExecutionArtifacts {
  const rawPlan = readRequiredTextFile(input.planPath, "Approved plan");
  const normalizedPlan = normalizeApprovedPlan(rawPlan, input.planPath, input.projectRoot);
  const planRecord = input.artifactStore.persistText("plan", normalizedPlan.raw, "yaml");
  const { artifact: tasksArtifact } = compilePlanToTasks(normalizedPlan.parsed, {
    gitTreeSha: input.gitTreeSha
  });
  validateTasksJson(tasksArtifact, input.planPath);
  const tasksRecord = input.artifactStore.persistJson("tasks", tasksArtifact);

  return {
    approvedPlan: normalizedPlan.parsed,
    tasksArtifact,
    planRecord,
    tasksRecord
  };
}
