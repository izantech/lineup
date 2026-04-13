import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { printJson, printTableLine } from "../lib/output.js";
import { lineupRunsDir } from "../lib/paths.js";
import type { PipelineStateRecord } from "../lib/state.js";

export type HistoryCommandOptions = {
  status?: string;
  limit?: number;
  json?: boolean;
};

type HistoryEntry = {
  run_id: string;
  status: string;
  workflow: string | null;
  current_stage: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  duration_human: string | null;
  completed_stages: number;
  retry_count: number;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatWorkflowName(workflowPath: string | null | undefined): string {
  if (!workflowPath) return "-";
  const base = path.basename(workflowPath, ".yaml");
  return base;
}

export async function runHistoryCommand(options: HistoryCommandOptions): Promise<void> {
  const cwd = process.cwd();
  const runsDir = lineupRunsDir(cwd);
  const limit = options.limit ?? 20;

  let entries: HistoryEntry[] = [];

  try {
    const dirEntries = readdirSync(runsDir, { withFileTypes: true })
      .filter(e => e.isDirectory());

    for (const dirEntry of dirEntries) {
      const stateFile = path.join(runsDir, dirEntry.name, "pipeline-state.json");
      try {
        const raw = readFileSync(stateFile, "utf8");
        const state = JSON.parse(raw) as PipelineStateRecord;

        if (options.status && state.status !== options.status) continue;

        const retryCount = state.retry_state
          ? Object.values(state.retry_state).reduce((sum, r) => sum + r.attempt, 0)
          : 0;

        entries.push({
          run_id: state.run_id,
          status: state.status,
          workflow: state.workflow ? formatWorkflowName(state.workflow) : null,
          current_stage: state.current_stage ?? null,
          started_at: state.started_at ?? state.updated_at,
          finished_at: state.finished_at ?? null,
          duration_ms: state.duration_ms ?? null,
          duration_human: state.duration_ms ? formatDuration(state.duration_ms) : null,
          completed_stages: state.completed_stages?.length ?? 0,
          retry_count: retryCount,
        });
      } catch { continue; }
    }
  } catch {
    entries = [];
  }

  // Sort by started_at descending
  entries.sort((a, b) => {
    const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
    const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
    return bTime - aTime;
  });

  // Apply limit
  entries = entries.slice(0, limit);

  if (options.json) {
    printJson(entries);
    return;
  }

  if (entries.length === 0) {
    printTableLine("No pipeline runs found.");
    return;
  }

  printTableLine(`\nPipeline History (${entries.length} runs)\n`);
  printTableLine(`  ${"ID".padEnd(8)} ${"Status".padEnd(12)} ${"Workflow".padEnd(18)} ${"Duration".padEnd(10)} ${"Stages".padEnd(8)} ${"Started"}`);
  printTableLine(`  ${"─".repeat(8)} ${"─".repeat(12)} ${"─".repeat(18)} ${"─".repeat(10)} ${"─".repeat(8)} ${"─".repeat(20)}`);

  for (const entry of entries) {
    const status = formatStatus(entry.status);
    const duration = entry.duration_human ?? (entry.finished_at ? "-" : "running");
    const started = entry.started_at ? formatTimestamp(entry.started_at) : "-";
    const retryLabel = entry.retry_count > 0 ? ` (${entry.retry_count} retries)` : "";

    printTableLine(
      `  ${entry.run_id.padEnd(8)} ${status.padEnd(12)} ${(entry.workflow ?? "-").padEnd(18)} ${duration.padEnd(10)} ${String(entry.completed_stages).padEnd(8)} ${started}${retryLabel}`
    );
  }

  printTableLine("");
}

function formatStatus(status: string): string {
  switch (status) {
    case "succeeded": return "OK";
    case "failed": return "FAIL";
    case "canceled": return "CANCEL";
    case "blocked": return "BLOCKED";
    case "running": return "RUNNING";
    case "pending": return "PENDING";
    default: return status;
  }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 60000) return "just now";
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
