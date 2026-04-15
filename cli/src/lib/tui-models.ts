import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createDoctorReport, type DoctorReport } from "../commands/doctor.js";
import { SUPPORTED_HOSTS, type HostName } from "./constants.js";
import { loadBridgeSession, readBridgeEvents } from "./bridge.js";
import type { PendingGate } from "./gate-store.js";
import {
  findPreviousRunState,
  formatArtifactDiffHeader,
  loadCompiledTasksForRun,
  summarizePipelineState
} from "./inspection.js";
import { readStatus } from "./operations.js";
import { observePipelineRuns } from "./observer.js";
import { lineupTuiConfigFile } from "./paths.js";
import type { LineupAgentOutputParams, LineupGateRequestParams, LineupPipelineCompleteParams, LineupProtocolMessage } from "./protocol.js";
import { loadPipelineState } from "./state.js";
import type { BridgeEvent, BridgePendingQuestion, BridgeSessionRecord, ObservedPipelineRun, StatusOutput } from "./types.js";
import { parseWorkflowYaml } from "./validation.js";
import { resolveExecutionOrder } from "./workflow.js";

export type TuiTheme = "system" | "lineup";

export type TuiPreferences = {
  theme: TuiTheme;
  compact: boolean;
  keybindings: {
    quit: string;
    commandPalette: string;
    resume: string;
    artifacts: string;
    logs: string;
  };
};

export type TuiAction = {
  id: string;
  label: string;
  command?: string;
  intent?: "primary" | "neutral" | "warning" | "danger";
  disabled?: boolean;
};

export type TuiStatusTone = "success" | "info" | "warning" | "danger";

export type TuiStatusCard = {
  id: string;
  label: string;
  tone: TuiStatusTone;
  detail: string;
  command?: string;
};

export type TuiRunSummary = {
  runId: string;
  status: string;
  workflow: string;
  currentStage: string;
  updatedAt: string;
  completedStages: number;
  taskSummary?: string;
  nextAction?: string;
};

export type TuiHomeViewModel = {
  cwd: string;
  preferences: TuiPreferences;
  readiness: {
    healthy: boolean;
    summary: string;
    cards: TuiStatusCard[];
    actions: TuiAction[];
  };
  hosts: TuiStatusCard[];
  latestRun: TuiRunSummary | null;
  recentRuns: TuiRunSummary[];
  quickActions: TuiAction[];
};

export type TuiRunComposerViewModel = {
  hosts: HostName[];
  defaults: {
    host: HostName;
    workflow?: string;
    tactic?: string;
    isolation: "index" | "full" | "sparse";
    implementMethod: "phase" | "task" | "single-session";
    approvePlan: boolean;
    maxParallel: number;
  };
};

export type TuiLogEvent = {
  id: string;
  kind: "status" | "question" | "complete";
  stageId: string;
  text: string;
  final?: boolean;
};

export type TuiLiveRunViewModel = {
  runId: string;
  status: string;
  workflow: string;
  currentStage: string;
  completedStages: string[];
  timelineStages: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "blocked" | "complete" | "failed";
    detail?: string;
  }>;
  timing: string[];
  taskSummary: string[];
  whatChanged: string[];
  nextActions: TuiAction[];
  artifacts: string[];
  events: TuiLogEvent[];
  pendingQuestion?: BridgePendingQuestion | PendingGate;
  recoveryCommand?: string;
  verificationSummary?: string;
  lastUpdatedAt?: string;
};

export type TuiInspectionViewModel = {
  run: TuiLiveRunViewModel;
  recentRuns: TuiRunSummary[];
  diffs: Array<{
    kind: string;
    fromRunId: string;
    toRunId: string;
    summary: string;
    command: string;
  }>;
  bridge?: {
    status: BridgeSessionRecord["status"];
    executorHost: BridgeSessionRecord["executor_host"];
    currentSeq: number;
    events: BridgeEvent[];
    recoveryCommand: string;
  };
};

export type TuiCommandPaletteItem = {
  id: string;
  label: string;
  shortcut?: string;
  description: string;
  group: "Runs" | "Setup" | "Artifacts" | "Recovery" | "Help";
};

const DEFAULT_PREFERENCES: TuiPreferences = {
  theme: "lineup",
  compact: false,
  keybindings: {
    quit: "q",
    commandPalette: "/",
    resume: "r",
    artifacts: "a",
    logs: "l"
  }
};

function toneForBoolean(ok: boolean): TuiStatusTone {
  return ok ? "success" : "warning";
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadTuiPreferences(homeDir = os.homedir()): TuiPreferences {
  const parsed = readJsonFile<Partial<TuiPreferences>>(lineupTuiConfigFile(homeDir));
  if (!parsed) {
    return DEFAULT_PREFERENCES;
  }

  return {
    theme: parsed.theme === "system" ? "system" : DEFAULT_PREFERENCES.theme,
    compact: parsed.compact ?? DEFAULT_PREFERENCES.compact,
    keybindings: {
      ...DEFAULT_PREFERENCES.keybindings,
      ...(parsed.keybindings ?? {})
    }
  };
}

export function saveTuiPreferences(preferences: TuiPreferences, homeDir = os.homedir()): void {
  const filePath = lineupTuiConfigFile(homeDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
}

function summarizeRun(run: ObservedPipelineRun): TuiRunSummary {
  const workflow = run.workflow ? path.basename(run.workflow, ".yaml") : "unknown";
  const currentStage = run.current_stage ?? "none";
  const nextAction =
    run.status === "blocked"
      ? `lineup resume ${run.run_id}`
      : run.status === "failed"
        ? `lineup logs ${run.run_id}`
        : run.status === "running"
          ? `lineup show ${run.run_id} --watch`
          : undefined;

  return {
    runId: run.run_id,
    status: run.status,
    workflow,
    currentStage,
    updatedAt: run.updated_at,
    completedStages: run.completed_stages.length,
    nextAction
  };
}

function buildStageTimeline(runId: string, cwd = process.cwd()): TuiLiveRunViewModel["timelineStages"] {
  const state = loadPipelineState(runId, cwd)
  if (!state) {
    return []
  }

  const completed = new Set(state.completed_stages ?? [])

  if (!state.workflow || !existsSync(state.workflow)) {
    const fallback = [...completed]
    if (state.current_stage && !fallback.includes(state.current_stage)) {
      fallback.push(state.current_stage)
    }

    return fallback.map((stageId) => ({
      id: stageId,
      label: stageId,
      status:
        stageId === state.current_stage
          ? state.status === 'failed'
            ? 'failed'
            : state.status === 'blocked'
              ? 'blocked'
              : 'running'
          : 'complete'
    }))
  }

  try {
    const workflow = parseWorkflowYaml(readFileSync(state.workflow, 'utf8'), state.workflow)
    const order = resolveExecutionOrder(workflow).flat()
    const stageById = new Map(workflow.stages.map((stage) => [stage.id, stage] as const))
    return order.map((stageId) => {
      const stage = stageById.get(stageId)
      const label = stage?.id ?? stageId

      if (completed.has(stageId)) {
        return { id: stageId, label, status: 'complete' as const }
      }

      if (state.current_stage === stageId) {
        return {
          id: stageId,
          label,
          status:
            state.status === 'failed'
              ? 'failed'
              : state.status === 'blocked'
                ? 'blocked'
                : 'running'
        }
      }

      return { id: stageId, label, status: 'pending' as const }
    })
  } catch {
    return []
  }
}

function buildReadinessCards(report: DoctorReport): TuiStatusCard[] {
  return [
    { id: "git", label: "Repo: Git", tone: toneForBoolean(report.checks.git.ok), detail: report.checks.git.detail },
    { id: "node", label: "Runtime: Node", tone: toneForBoolean(report.checks.node.ok), detail: report.checks.node.detail },
    {
      id: "workflow",
      label: "Repo: Workflow",
      tone: toneForBoolean(report.checks.project.workflow.ok),
      detail: report.checks.project.workflow.detail,
      command: !report.checks.project.workflow.ok ? "lineup init" : undefined
    },
    {
      id: "repo",
      label: "Repo: Repository",
      tone: toneForBoolean(report.checks.project.git_repository.ok),
      detail: report.checks.project.git_repository.detail,
      command: !report.checks.project.git_repository.ok ? "lineup init" : undefined
    },
    {
      id: "head",
      label: "Repo: Initial Commit",
      tone: toneForBoolean(report.checks.project.git_head.ok),
      detail: report.checks.project.git_head.detail,
      command: !report.checks.project.git_head.ok ? "git commit -m \"Initial commit\"" : undefined
    },
    {
      id: "artifacts",
      label: "Runtime: Artifact Store",
      tone: toneForBoolean(report.checks.runtime.artifact_store.ok),
      detail: report.checks.runtime.artifact_store.detail
    },
    {
      id: "runs-dir",
      label: "Runtime: Runs Directory",
      tone: toneForBoolean(report.checks.runtime.runs_dir.ok),
      detail: report.checks.runtime.runs_dir.detail
    }
  ];
}

function buildHostCards(status: StatusOutput): TuiStatusCard[] {
  return SUPPORTED_HOSTS.map((host) => {
    const item = status.hosts[host];
    if (!item) {
      return {
        id: host,
        label: host,
        tone: "warning",
        detail: "status unavailable"
      };
    }

    return {
      id: host,
      label: host,
      tone: item.installed && !item.error ? "success" : item.error ? "danger" : "warning",
      detail: item.error
        ? item.error
        : item.installed
          ? `${item.version ?? "unknown"} from ${item.source ?? "unknown"}`
          : "not installed"
    };
  });
}

export async function buildHomeViewModel(cwd = process.cwd(), homeDir = os.homedir()): Promise<TuiHomeViewModel> {
  const preferences = loadTuiPreferences(homeDir);
  const report = createDoctorReport(cwd, homeDir);
  const status = await readStatus([...SUPPORTED_HOSTS]);
  const runs = observePipelineRuns(cwd);
  const recentRuns = runs.slice(0, 6).map(summarizeRun);
  const latestRun = recentRuns[0] ?? null;

  return {
    cwd,
    preferences,
    readiness: {
      healthy: report.healthy,
      summary: report.healthy ? "Ready to run Lineup." : "Setup needs attention before a native run.",
      cards: buildReadinessCards(report),
      actions: report.checks.project.next_commands.map((item, index) => ({
        id: `next-${index}`,
        label: item.label,
        command: item.command,
        intent: "primary"
      }))
    },
    hosts: buildHostCards(status),
    latestRun,
    recentRuns,
    quickActions: [
      { id: "new-run", label: "New run", intent: "primary" },
      {
        id: "resume-selected",
        label: "Resume selected run",
        command: latestRun && ["blocked", "failed", "canceled"].includes(latestRun.status) ? `lineup resume ${latestRun.runId}` : undefined,
        disabled: !latestRun || !["blocked", "failed", "canceled"].includes(latestRun.status)
      },
      { id: "inspect-selected", label: "Inspect selected run", command: latestRun ? `lineup show ${latestRun.runId}` : undefined, disabled: !latestRun },
      { id: "doctor", label: "Refresh readiness", command: "lineup doctor", intent: "neutral" }
    ]
  };
}

export function buildRunComposerViewModel(): TuiRunComposerViewModel {
  return {
    hosts: [...SUPPORTED_HOSTS],
    defaults: {
      host: "codex",
      isolation: "index",
      implementMethod: "phase",
      approvePlan: false,
      maxParallel: 3
    }
  };
}

function buildRunActions(runId: string, status: string): TuiAction[] {
  const actions: TuiAction[] = [
    { id: "inspect-run", label: "Inspect run", command: `lineup show ${runId}`, intent: "neutral" },
    { id: "artifacts", label: "Artifact actions", command: `lineup artifacts show plan --run ${runId}` }
  ];

  if (status === "blocked" || status === "canceled") {
    actions.unshift({ id: "resume", label: "Resume", command: `lineup resume ${runId}`, intent: "primary" });
  } else if (status === "failed") {
    actions.unshift({ id: "retry", label: "Retry failed stage", command: `lineup resume ${runId} --retry-failed`, intent: "warning" });
    actions.push({ id: "logs", label: "Logs", command: `lineup logs ${runId}` });
  } else if (status === "running") {
    actions.unshift({ id: "watch", label: "Attach live view", command: `lineup show ${runId} --watch`, intent: "primary" });
    actions.push({ id: "cancel", label: "Cancel", command: `lineup cancel ${runId}`, intent: "danger" });
  }

  return actions;
}

function buildArtifactLines(runId: string, cwd = process.cwd()): string[] {
  const state = loadPipelineState(runId, cwd);
  if (!state) {
    return [];
  }

  return Object.entries(state.artifact_hashes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, sha]) => formatArtifactDiffHeader(kind, runId, runId, sha, sha));
}

function buildDiffEntries(runId: string, cwd = process.cwd()): TuiInspectionViewModel["diffs"] {
  const state = loadPipelineState(runId, cwd)
  const previousState = findPreviousRunState(runId, cwd)
  if (!state || !previousState) {
    return []
  }

  return Object.entries(state.artifact_hashes)
    .sort(([left], [right]) => left.localeCompare(right))
    .filter(([kind, sha]) => previousState.artifact_hashes[kind as keyof typeof previousState.artifact_hashes] !== sha)
    .map(([kind, sha]) => ({
      kind,
      fromRunId: previousState.run_id,
      toRunId: runId,
      summary: formatArtifactDiffHeader(
        kind,
        previousState.run_id,
        runId,
        previousState.artifact_hashes[kind as keyof typeof previousState.artifact_hashes],
        sha
      ),
      command: `lineup artifacts diff ${kind} --from ${previousState.run_id} --to ${runId}`
    }))
}

export async function buildInspectionViewModel(runId: string, cwd = process.cwd()): Promise<TuiInspectionViewModel | null> {
  const run = buildLiveRunViewModel(runId, [], cwd);
  if (!run) {
    return null;
  }

  const runs = observePipelineRuns(cwd)
  const recentRuns = runs
    .filter((candidate) => candidate.run_id !== runId)
    .slice(0, 5)
    .map(summarizeRun)

  const session = loadBridgeSession(runId, cwd);
  if (!session) {
    return {
      run,
      recentRuns,
      diffs: buildDiffEntries(runId, cwd)
    };
  }

  const bridgeEvents = await readBridgeEvents(runId, {}, cwd);

  return {
    run,
    recentRuns,
    diffs: buildDiffEntries(runId, cwd),
    bridge: {
      status: session.status,
      executorHost: session.executor_host,
      currentSeq: bridgeEvents.nextCursor,
      events: bridgeEvents.events,
      recoveryCommand: bridgeEvents.recovery.command
    }
  };
}

export function buildLiveRunViewModel(runId: string, events: TuiLogEvent[] = [], cwd = process.cwd()): TuiLiveRunViewModel | null {
  const state = loadPipelineState(runId, cwd);
  if (!state) {
    return null;
  }

  const tasks = loadCompiledTasksForRun(runId, cwd);
  const summary = summarizePipelineState(state, {
    tasks,
    previousState: findPreviousRunState(runId, cwd)
  });
  const bridgeSession = loadBridgeSession(runId, cwd);

  return {
    runId: state.run_id,
    status: state.status,
    workflow: state.workflow ? path.basename(state.workflow, ".yaml") : "unknown",
    currentStage: state.current_stage ?? "none",
    completedStages: state.completed_stages ?? [],
    timelineStages: buildStageTimeline(runId, cwd),
    timing: summary.timingLines,
    taskSummary: summary.taskLines,
    whatChanged: summary.changeLines,
    nextActions: buildRunActions(state.run_id, state.status).concat(
      summary.nextLines.map((line, index) => ({
        id: `next-${index}`,
        label: line.replace(/`/g, ""),
        command: line.includes("`") ? line.split("`")[1] : undefined
      }))
    ),
    artifacts: buildArtifactLines(runId, cwd).length > 0 ? buildArtifactLines(runId, cwd) : summary.artifactLines,
    events,
    pendingQuestion: bridgeSession?.pending_question,
    recoveryCommand: bridgeSession ? `lineup bridge events ${runId} --after ${bridgeSession.current_seq}` : undefined,
    verificationSummary:
      state.status === "succeeded"
        ? "Verification passed and the run completed."
        : state.status === "failed"
          ? "Verification or execution failed. Inspect logs or retry the failed stage."
          : state.status === "blocked"
            ? "Run is waiting on a gate or resume action."
            : "Verification is still in progress.",
    lastUpdatedAt: state.updated_at
  };
}

export function protocolMessageToTuiEvent(message: LineupProtocolMessage): TuiLogEvent | null {
  if (!("method" in message)) {
    return null;
  }

  if (message.method === "agent/output") {
    const params = message.params as LineupAgentOutputParams | undefined;
    if (!params || params.channel !== "status") {
      return null;
    }

    return {
      id: `status-${params.sequence}`,
      kind: "status",
      stageId: params.stageId,
      text: params.chunk,
      final: params.final
    };
  }

  if (message.method === "gate/request" && "id" in message) {
    const params = message.params as LineupGateRequestParams;
    return {
      id: `question-${message.id}`,
      kind: "question",
      stageId: params.stageId,
      text: params.question
    };
  }

  if (message.method === "pipeline/complete") {
    const params = message.params as LineupPipelineCompleteParams;
    return {
      id: `complete-${params.runId}`,
      kind: "complete",
      stageId: "pipeline",
      text: params.summary ?? `Pipeline ${params.status}.`
    };
  }

  return null;
}

export function buildCommandPaletteItems(preferences: TuiPreferences): TuiCommandPaletteItem[] {
  return [
    { id: "new-run", label: "New run", shortcut: "Enter", description: "Open the run composer and start a new pipeline.", group: "Runs" },
    { id: "resume", label: "Resume selected run", shortcut: preferences.keybindings.resume, description: "Resume a blocked, failed, or canceled run.", group: "Recovery" },
    { id: "inspect", label: "Inspect selected run", shortcut: preferences.keybindings.artifacts, description: "Open inspection and artifact actions for the selected run.", group: "Runs" },
    { id: "logs", label: "Toggle logs", shortcut: preferences.keybindings.logs, description: "Show or hide detailed event output for the active run.", group: "Runs" },
    { id: "refresh", label: "Refresh readiness", shortcut: "", description: "Reload doctor readiness, host state, and run summaries.", group: "Setup" },
    { id: "artifacts-plan", label: "Open plan artifact", description: "Focus the selected run plan artifact.", group: "Artifacts" },
    { id: "artifacts-review", label: "Open review artifact", description: "Focus the selected run review artifact.", group: "Artifacts" },
    { id: "quit", label: "Quit", shortcut: preferences.keybindings.quit, description: "Exit the Lineup terminal UI.", group: "Help" }
  ];
}
