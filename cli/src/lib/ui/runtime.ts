import process from "node:process";

import type { PendingGate } from "../gate-store.js";
import { loadCompiledTasksForRun, summarizePipelineState, type RunSummary } from "../inspection.js";
import type {
  PipelinePendingGateRecord,
  PipelineStageStateRecord,
  PipelineStateRecord
} from "../state.js";
import type { BridgeCompleteEvent, BridgeEvent, BridgeQuestionEvent, BridgeStatusEvent } from "../types.js";
import type { WorkflowDefinition, WorkflowStage } from "../types.js";
import { detectTerminalCapabilities, terminalPalette, terminalSymbols, type TerminalCapabilities } from "./terminal.js";

const KNOWN_STAGE_LABELS: Record<string, string> = {
  triage: "Triage",
  clarify: "Clarify",
  research: "Research",
  gate: "Clarification Gate",
  plan: "Plan",
  "plan-approval": "Plan Approval",
  implement: "Implement",
  verify: "Verify",
  document: "Document"
};

const STAGE_RENDER_ORDER = ["triage", "clarify", "research", "gate", "plan", "plan-approval", "implement", "verify", "document"];

export type RuntimeStageRow = {
  stageId: string;
  label: string;
  status: PipelineStageStateRecord["status"];
  durationMs: number | null;
  attemptLabel: string;
  lastMessage: string;
  isCurrent: boolean;
};

export type RuntimeDashboardData = {
  runId: string;
  status: PipelineStateRecord["status"];
  statusLabel: string;
  elapsedMs: number | null;
  workflow: string;
  executionHost: string;
  runnerHost: string;
  currentStageHeader: string;
  currentStageLabel: string;
  currentStageId?: string;
  stageRows: RuntimeStageRow[];
  pendingGate: PipelinePendingGateRecord | null;
  summary: RunSummary;
};

export function formatStageLabel(stageId: string): string {
  if (KNOWN_STAGE_LABELS[stageId]) {
    return KNOWN_STAGE_LABELS[stageId];
  }

  return stageId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function titleCaseStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || durationMs < 0) {
    return "n/a";
  }

  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function wrapSection(title: string, lines: string[], capabilities: TerminalCapabilities): string[] {
  if (lines.length === 0) {
    return [];
  }

  const palette = terminalPalette(capabilities);
  return [
    palette.strong(title),
    ...lines
  ];
}

function stageStatusIcon(status: PipelineStageStateRecord["status"], capabilities: TerminalCapabilities): string {
  const palette = terminalPalette(capabilities);
  const symbols = terminalSymbols(capabilities);

  if (status === "succeeded") {
    return palette.success(symbols.success);
  }
  if (status === "failed") {
    return palette.failure(symbols.failure);
  }
  if (status === "blocked") {
    return palette.warning(symbols.warning);
  }
  if (status === "running") {
    return palette.accent(symbols.running);
  }
  return palette.dim(symbols.pending);
}

function inferPendingGateTimedOut(state: PipelineStateRecord, pendingGate: PipelinePendingGateRecord): boolean {
  return Boolean(
    (state.errors ?? []).find((error) =>
      error.code === "gate_timeout" &&
      typeof error.details === "object" &&
      error.details !== null &&
      "stage_id" in error.details &&
      "request_id" in error.details &&
      String((error.details as Record<string, unknown>).stage_id) === pendingGate.stage_id &&
      String((error.details as Record<string, unknown>).request_id) === pendingGate.request_id
    )
  );
}

export function pendingGateRecoveryCommand(state: PipelineStateRecord, runId = state.run_id): string {
  if (!state.pending_gate) {
    return `lineup show ${runId}`;
  }

  return inferPendingGateTimedOut(state, state.pending_gate)
    ? `lineup resume ${runId}`
    : `lineup bridge answer ${runId} ${state.pending_gate.request_id} --choice "${state.pending_gate.default_choice ?? "<choice>"}"`;
}

function renderPendingGateBlock(state: PipelineStateRecord, capabilities: TerminalCapabilities): string[] {
  const pendingGate = state.pending_gate;
  if (!pendingGate) {
    return [];
  }

  const timedOut = inferPendingGateTimedOut(state, pendingGate);
  const lines = [
    `gate_type: ${pendingGate.gate_type}`,
    `stage: ${formatStageLabel(pendingGate.stage_id)}`,
    `question: ${pendingGate.question}`,
    `choices: ${pendingGate.choices.join(", ")}`,
    `default: ${pendingGate.default_choice ?? "none"}`,
    `created_at: ${pendingGate.created_at}`,
    `expires_at: ${pendingGate.expires_at ?? "none"}`,
    `recovery: ${timedOut ? "resume" : "answer"}`,
    `command: ${pendingGateRecoveryCommand(state)}`
  ];

  return wrapSection("Pending Question", lines, capabilities);
}

export function orderedStageEntries(stageState: Record<string, PipelineStageStateRecord> | undefined): Array<[string, PipelineStageStateRecord]> {
  if (!stageState) {
    return [];
  }

  const entries = Object.entries(stageState);
  return entries.sort(([left], [right]) => {
    const leftKnown = STAGE_RENDER_ORDER.indexOf(left);
    const rightKnown = STAGE_RENDER_ORDER.indexOf(right);
    if (leftKnown >= 0 || rightKnown >= 0) {
      if (leftKnown < 0) {
        return 1;
      }
      if (rightKnown < 0) {
        return -1;
      }
      return leftKnown - rightKnown;
    }
    return left.localeCompare(right);
  });
}

export function inferStageEntries(state: PipelineStateRecord): Array<[string, PipelineStageStateRecord]> {
  if (state.stage_state && Object.keys(state.stage_state).length > 0) {
    return orderedStageEntries(state.stage_state);
  }

  const inferred = new Map<string, PipelineStageStateRecord>();
  for (const stageId of state.completed_stages ?? []) {
    inferred.set(stageId, {
      status: "succeeded",
      updated_at: state.updated_at,
      last_message: `Completed stage '${stageId}'.`
    });
  }

  if (state.current_stage) {
    inferred.set(state.current_stage, {
      status: state.status === "blocked" ? "blocked" : "running",
      updated_at: state.updated_at,
      ...(state.started_at ? { started_at: state.started_at } : {}),
      last_message: state.status === "blocked" ? `Stage '${state.current_stage}' is blocked.` : `Running stage '${state.current_stage}'.`
    });
  }

  return orderedStageEntries(Object.fromEntries(inferred));
}

export function stageDurationMs(record: PipelineStageStateRecord, now = Date.now()): number | null {
  if (record.finished_at && record.started_at) {
    return Date.parse(record.finished_at) - Date.parse(record.started_at);
  }

  if (record.started_at) {
    return now - Date.parse(record.started_at);
  }

  return null;
}

export function buildRuntimeDashboardSummary(state: PipelineStateRecord, cwd = process.cwd()): RunSummary {
  return summarizePipelineState(state, {
    previousState: undefined,
    tasks: loadCompiledTasksForRun(state.run_id, cwd)
  });
}

function renderStageTable(state: PipelineStateRecord, capabilities: TerminalCapabilities): string[] {
  const entries = inferStageEntries(state);
  if (entries.length === 0) {
    return wrapSection("Stages", ["No structured stage state recorded yet."], capabilities);
  }

  const lines = entries.map(([stageId, record]) => {
    const durationMs = stageDurationMs(record);
    const attempt =
      record.attempt !== undefined && record.max_attempts !== undefined
        ? `${record.attempt}/${record.max_attempts}`
        : record.attempt !== undefined
          ? String(record.attempt)
          : "-";
    const message = truncate(record.last_message ?? "-", Math.max(24, capabilities.width - 45));
    return `${stageStatusIcon(record.status, capabilities)} ${formatStageLabel(stageId).padEnd(19)} attempt ${attempt.padEnd(5)} ${formatDuration(durationMs).padEnd(7)} ${message}`;
  });

  return wrapSection("Stages", lines, capabilities);
}

export function renderWatchDashboard(
  state: PipelineStateRecord,
  cwd = process.cwd(),
  stream: NodeJS.WriteStream = process.stdout
): string[] {
  const capabilities = detectTerminalCapabilities(stream);
  const summary = buildRuntimeDashboardSummary(state, cwd);
  const startTime = state.started_at ? Date.parse(state.started_at) : Date.parse(state.updated_at);
  const elapsedMs = Number.isNaN(startTime) ? null : Date.now() - startTime;
  const lines: string[] = [
    ...wrapSection("Run", [
      `run_id: ${state.run_id}`,
      `status: ${titleCaseStatus(state.status)}`,
      `elapsed: ${formatDuration(elapsedMs)}`,
      `workflow: ${state.workflow ?? "unknown"}`,
      `execution_host: ${state.execution_host ?? "unknown"}`,
      `runner_host: ${state.runner_host ?? "unknown"}`
    ], capabilities),
    "",
    ...renderStageTable(state, capabilities)
  ];

  const pendingLines = renderPendingGateBlock(state, capabilities);
  if (pendingLines.length > 0) {
    lines.push("", ...pendingLines);
  }

  if (summary.changeLines.length > 0 || summary.artifactLines.length > 0) {
    lines.push(
      "",
      ...wrapSection("Changes", [
        ...summary.changeLines,
        ...(summary.artifactLines.length > 0 ? [`primary_artifact: ${summary.artifactLines[0]}`] : [])
      ], capabilities)
    );
  }

  if (summary.nextLines.length > 0) {
    lines.push("", ...wrapSection("Next Actions", summary.nextLines, capabilities));
  }

  return lines;
}

function workflowStageMap(workflow: WorkflowDefinition): Map<string, { index: number; total: number; stage: WorkflowStage }> {
  const total = workflow.stages.length;
  return new Map(workflow.stages.map((stage, index) => [stage.id, { index: index + 1, total, stage }] as const));
}

function stagePurpose(stage: WorkflowStage | undefined): string {
  return stage?.description?.trim() || "Execute stage work";
}

export function stageHeader(stageId: string, workflow: WorkflowDefinition): string {
  const stageMeta = workflowStageMap(workflow).get(stageId);
  if (!stageMeta) {
    return formatStageLabel(stageId);
  }

  return `Stage ${stageMeta.index}/${stageMeta.total} | ${formatStageLabel(stageId)} | ${stagePurpose(stageMeta.stage)}`;
}

export function buildRuntimeDashboardData(
  state: PipelineStateRecord,
  options: {
    summary?: RunSummary;
    workflow?: WorkflowDefinition;
    now?: number;
  } = {}
): RuntimeDashboardData {
  const summary = options.summary ?? buildRuntimeDashboardSummary(state);
  const now = options.now ?? Date.now();
  const startTime = state.started_at ? Date.parse(state.started_at) : Date.parse(state.updated_at);
  const elapsedMs = Number.isNaN(startTime) ? null : now - startTime;
  const currentStageId = state.current_stage;
  const currentStageHeader = currentStageId
    ? options.workflow
      ? stageHeader(currentStageId, options.workflow)
      : formatStageLabel(currentStageId)
    : "No active stage";

  return {
    runId: state.run_id,
    status: state.status,
    statusLabel: titleCaseStatus(state.status),
    elapsedMs,
    workflow: state.workflow ?? "unknown",
    executionHost: state.execution_host ?? "unknown",
    runnerHost: state.runner_host ?? "unknown",
    currentStageHeader,
    currentStageLabel: currentStageId ? formatStageLabel(currentStageId) : "None",
    ...(currentStageId ? { currentStageId } : {}),
    stageRows: inferStageEntries(state).map(([stageId, record]) => ({
      stageId,
      label: formatStageLabel(stageId),
      status: record.status,
      durationMs: stageDurationMs(record, now),
      attemptLabel:
        record.attempt !== undefined && record.max_attempts !== undefined
          ? `${record.attempt}/${record.max_attempts}`
          : record.attempt !== undefined
            ? String(record.attempt)
            : "-",
      lastMessage: record.last_message ?? "-",
      isCurrent: stageId === currentStageId
    })),
    pendingGate: state.pending_gate ?? null,
    summary
  };
}

function renderBridgeStatusEvent(event: BridgeStatusEvent, capabilities: TerminalCapabilities): string[] {
  const icon = event.kind === "warning"
    ? stageStatusIcon("blocked", capabilities)
    : event.kind === "stage-end"
      ? stageStatusIcon("succeeded", capabilities)
      : stageStatusIcon("running", capabilities);

  return wrapSection(`${formatStageLabel(event.stageId)} ${event.kind}`, [
    `${icon} ${event.text}`
  ], capabilities);
}

function renderBridgeQuestionEvent(event: BridgeQuestionEvent, capabilities: TerminalCapabilities, runId: string): string[] {
  return wrapSection(`Question | ${formatStageLabel(event.stageId)}`, [
    `gate_type: ${event.gateType}`,
    `question: ${event.question}`,
    `choices: ${event.choices.map((choice, index) => `${index + 1}) ${choice}${event.defaultChoice === choice ? " (default)" : ""}`).join("  ")}`,
    `created_at: ${event.createdAt}`,
    `expires_at: ${event.expiresAt ?? "none"}`,
    `answer_with: lineup bridge answer ${runId} ${event.requestId} --choice "${event.defaultChoice ?? "<choice>"}"`,
    ...(event.context ? [`context: ${truncate(event.context.replace(/\s+/g, " "), Math.max(48, capabilities.width - 12))}`] : [])
  ], capabilities);
}

function renderBridgeCompleteEvent(event: BridgeCompleteEvent, capabilities: TerminalCapabilities): string[] {
  return wrapSection(`Complete | ${titleCaseStatus(event.status)}`, [
    event.summary ?? "Bridge run completed."
  ], capabilities);
}

export function renderBridgeEventLines(
  event: BridgeEvent,
  runId: string,
  stream: NodeJS.WriteStream = process.stdout
): string[] {
  const capabilities = detectTerminalCapabilities(stream);
  if (event.type === "status") {
    return renderBridgeStatusEvent(event, capabilities);
  }
  if (event.type === "question") {
    return renderBridgeQuestionEvent(event, capabilities, runId);
  }
  return renderBridgeCompleteEvent(event, capabilities);
}

export function renderPendingBridgeQuestionLines(
  runId: string,
  pendingQuestion: {
    requestId: string | number;
    stageId: string;
    gateType: string;
    question: string;
    choices: readonly string[];
    defaultChoice?: string;
    createdAt: string;
    expiresAt?: string;
  },
  timedOut: boolean,
  stream: NodeJS.WriteStream = process.stdout
): string[] {
  const capabilities = detectTerminalCapabilities(stream);
  return wrapSection(`Pending | ${formatStageLabel(pendingQuestion.stageId)}`, [
    `gate_type: ${pendingQuestion.gateType}`,
    `question: ${pendingQuestion.question}`,
    `choices: ${pendingQuestion.choices.join(", ")}`,
    `default: ${pendingQuestion.defaultChoice ?? "none"}`,
    `expires_at: ${pendingQuestion.expiresAt ?? "none"}`,
    `command: ${timedOut ? `lineup resume ${runId}` : `lineup bridge answer ${runId} ${pendingQuestion.requestId} --choice "${pendingQuestion.defaultChoice ?? "<choice>"}"`}`
  ], capabilities);
}

export function writeGatePromptFrame(
  gate: PendingGate,
  stream: NodeJS.WriteStream = process.stderr
): void {
  const capabilities = detectTerminalCapabilities(stream);
  const defaultLabel = gate.defaultChoice ? `Default: ${gate.defaultChoice}` : "Default: none";
  const lines = [
    `gate_type: ${gate.gateType}`,
    `question: ${gate.question}`,
    ...(gate.context ? [`context: ${gate.context}`] : []),
    ...(gate.choices.length > 0 ? [`choices: ${gate.choices.map((choice, index) => `${index + 1}) ${choice}${gate.defaultChoice === choice ? " (default)" : ""}`).join("  ")}`] : []),
    defaultLabel
  ];

  for (const line of wrapSection(`Gate | ${formatStageLabel(gate.stageId ?? gate.gateType)}`, lines, capabilities)) {
    stream.write(`${line}\n`);
  }
}
