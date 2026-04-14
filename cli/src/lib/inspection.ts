import { readFileSync } from "node:fs";
import path from "node:path";

import { createArtifactStore } from "./artifact-store.js";
import { buildTaskWaves, type CompiledTask, type CompiledTasksArtifact } from "./dag.js";
import { observePipelineRuns } from "./observer.js";
import { lineupArtifactStoreDir, lineupRunArtifactsDir } from "./paths.js";
import type { PipelineArtifactHashes, PipelineStateRecord } from "./state.js";
import { loadPipelineState } from "./state.js";

export type RunSummary = {
  statusLine: string;
  workflowLine: string;
  stageLine: string;
  completedLine: string;
  timingLines: string[];
  taskLines: string[];
  changeLines: string[];
  nextLines: string[];
  artifactLines: string[];
};

type RunSummaryOptions = {
  previousState?: PipelineStateRecord | null;
  tasks?: CompiledTask[] | null;
};

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function summarizeArtifacts(
  state: PipelineStateRecord,
  previousState?: PipelineStateRecord | null
): { changeLines: string[]; changedKinds: string[] } {
  const currentEntries = Object.entries(state.artifact_hashes).sort(([left], [right]) => left.localeCompare(right));
  const currentKinds = currentEntries.map(([kind]) => kind);
  const changeLines: string[] = [];

  if (currentKinds.length === 0) {
    return { changeLines, changedKinds: [] };
  }

  if (!previousState) {
    changeLines.push(`artifacts created: ${currentKinds.join(", ")}`);
    return { changeLines, changedKinds: currentKinds };
  }

  const previousArtifacts = previousState.artifact_hashes;
  const changedKinds = currentKinds.filter((kind) => previousArtifacts[kind as keyof PipelineArtifactHashes] !== state.artifact_hashes[kind as keyof PipelineArtifactHashes]);
  const addedKinds = currentKinds.filter((kind) => !(kind in previousArtifacts));
  const removedKinds = Object.keys(previousArtifacts)
    .sort((left, right) => left.localeCompare(right))
    .filter((kind) => !(kind in state.artifact_hashes));

  const changedOnly = changedKinds.filter((kind) => !addedKinds.includes(kind));

  if (changedOnly.length > 0) {
    changeLines.push(`artifacts changed vs run ${previousState.run_id}: ${changedOnly.join(", ")}`);
  }

  if (addedKinds.length > 0) {
    changeLines.push(`artifacts added vs run ${previousState.run_id}: ${addedKinds.join(", ")}`);
  }

  if (removedKinds.length > 0) {
    changeLines.push(`artifacts removed vs run ${previousState.run_id}: ${removedKinds.join(", ")}`);
  }

  if (changeLines.length === 0) {
    changeLines.push(`artifact set matches run ${previousState.run_id}`);
  }

  return { changeLines, changedKinds };
}

function summarizeTasks(tasks?: CompiledTask[] | null): string[] {
  if (!tasks || tasks.length === 0) {
    return [];
  }

  const waves = buildTaskWaves(tasks);
  const maxParallelism = Math.max(...waves.map((wave) => wave.length));
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const lines = [`${tasks.length} tasks across ${waves.length} waves (max parallelism ${maxParallelism})`];
  const wavesToShow = waves.slice(0, 3);

  wavesToShow.forEach((wave, waveIndex) => {
    const titles = wave
      .map((taskId) => taskById.get(taskId)?.title ?? taskId)
      .map((title) => title.replace(/\s+/g, " ").trim());
    const summary = titles.slice(0, 2).join(" | ");
    const extraCount = titles.length - 2;
    lines.push(`wave ${waveIndex + 1}: ${summary}${extraCount > 0 ? ` | +${extraCount} more` : ""}`);
  });

  if (waves.length > wavesToShow.length) {
    lines.push(`${waves.length - wavesToShow.length} more waves not shown`);
  }

  return lines;
}

function selectPrimaryArtifactKind(state: PipelineStateRecord): string | null {
  for (const kind of ["review", "plan", "spec", "tasks", "protocol"] as const) {
    if (state.artifact_hashes[kind]) {
      return kind;
    }
  }

  const first = Object.keys(state.artifact_hashes).sort((left, right) => left.localeCompare(right))[0];
  return first ?? null;
}

function buildNextLines(
  state: PipelineStateRecord,
  changedKinds: string[],
  previousState?: PipelineStateRecord | null,
  tasks?: CompiledTask[] | null
): string[] {
  const lines: string[] = [];

  if (state.status === "blocked") {
    lines.push(`resume with \`lineup resume ${state.run_id}\``);
    lines.push(`cancel with \`lineup cancel ${state.run_id}\` if you want to stop instead`);
  } else if (state.status === "failed") {
    lines.push(`inspect logs with \`lineup logs ${state.run_id}\``);
    lines.push(`retry the failed stage with \`lineup resume ${state.run_id} --retry-failed\``);
  } else if (state.status === "canceled") {
    lines.push(`continue the run with \`lineup resume ${state.run_id}\``);
  } else if (state.status === "running" || state.status === "pending") {
    lines.push(`watch progress with \`lineup show ${state.run_id} --watch\``);
  }

  const primaryArtifact = selectPrimaryArtifactKind(state);
  if (primaryArtifact) {
    lines.push(`inspect ${primaryArtifact} with \`lineup artifacts show ${primaryArtifact} --run ${state.run_id}\``);
  }

  if (tasks && tasks.length > 0) {
    lines.push(`inspect task waves with \`lineup waves --run ${state.run_id}\``);
  }

  if (previousState) {
    const diffKind = ["review", "plan", "spec", "tasks", "config", "constitution", "protocol"]
      .find((kind) => changedKinds.includes(kind));

    if (diffKind) {
      lines.push(`compare ${diffKind} with \`lineup artifacts diff ${diffKind} --from ${previousState.run_id} --to ${state.run_id}\``);
    }
  }

  return [...new Set(lines)];
}

export function summarizePipelineState(state: PipelineStateRecord, options: RunSummaryOptions = {}): RunSummary {
  const completed = state.completed_stages ?? [];
  const startedAt = state.started_at ?? null;
  const finishedAt = state.finished_at ?? null;
  const durationMs = state.duration_ms ?? (startedAt ? Date.now() - new Date(startedAt).getTime() : null);
  const timingLines: string[] = [];

  if (startedAt) {
    timingLines.push(`started_at: ${startedAt}`);
  }

  if (finishedAt) {
    timingLines.push(`finished_at: ${finishedAt}`);
  }

  if (durationMs !== null) {
    timingLines.push(`duration: ${formatDuration(durationMs)}`);
  }

  const changeLines = completed.length > 0
    ? [`completed stages: ${completed.join(", ")}`]
    : [];
  const artifactSummary = summarizeArtifacts(state, options.previousState);
  changeLines.push(...artifactSummary.changeLines);

  return {
    statusLine: `status: ${state.status}`,
    workflowLine: `workflow: ${state.workflow ?? "unknown"}`,
    stageLine: `current_stage: ${state.current_stage ?? "none"}`,
    completedLine: completed.length > 0
      ? `completed_stages: ${completed.join(", ")} (${completed.length})`
      : "completed_stages: none",
    timingLines,
    taskLines: summarizeTasks(options.tasks),
    changeLines,
    nextLines: buildNextLines(state, artifactSummary.changedKinds, options.previousState, options.tasks),
    artifactLines: Object.entries(state.artifact_hashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, sha256]) => `${kind}: ${sha256.slice(0, 12)}  lineup artifacts show ${kind} --run ${state.run_id}`)
  };
}

export function describeBlockedRunNextStep(runId: string): string {
  return `Next step: run \`lineup resume ${runId}\`, inspect with \`lineup show ${runId}\`, or cancel with \`lineup cancel ${runId}\`.`;
}

export function findPreviousRunState(runId: string, cwd = process.cwd()): PipelineStateRecord | null {
  const runs = observePipelineRuns(cwd);
  const runIndex = runs.findIndex((run) => run.run_id === runId);
  const previousRunId = runIndex >= 0 ? runs[runIndex + 1]?.run_id : null;

  if (!previousRunId) {
    return null;
  }

  return loadPipelineState(previousRunId, cwd);
}

export function loadCompiledTasksForRun(runId: string, cwd = process.cwd()): CompiledTask[] | null {
  const state = loadPipelineState(runId, cwd);
  if (!state) {
    return null;
  }

  const store = createArtifactStore(lineupArtifactStoreDir(cwd));
  const tasksHash = state.artifact_hashes.tasks;

  if (tasksHash) {
    try {
      const content = store.readText({ kind: "tasks", format: "json", sha256: tasksHash });
      const parsed = JSON.parse(content) as CompiledTasksArtifact;
      return parsed.tasks;
    } catch {
      // Fall through to the run-local artifact path.
    }
  }

  try {
    const raw = readFileSync(path.join(lineupRunArtifactsDir(runId, cwd), "tasks.json"), "utf8");
    const parsed = JSON.parse(raw) as CompiledTasksArtifact;
    return parsed.tasks;
  } catch {
    return null;
  }
}

export function formatArtifactDiffHeader(
  kind: string,
  fromRunId: string,
  toRunId: string,
  fromSha?: string,
  toSha?: string
): string {
  const fromLabel = fromSha ? `${fromRunId} (${fromSha.slice(0, 12)})` : fromRunId;
  const toLabel = toSha ? `${toRunId} (${toSha.slice(0, 12)})` : toRunId;
  return `${kind} diff: ${fromLabel} -> ${toLabel}`;
}
