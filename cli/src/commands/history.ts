import { printJson, printTableLine } from "../lib/output.js";
import { readRunHistory } from "../lib/tui-services.js";

export type HistoryCommandOptions = {
  status?: string;
  limit?: number;
  json?: boolean;
};

export async function runHistoryCommand(options: HistoryCommandOptions): Promise<void> {
  const entries = readRunHistory({ status: options.status, limit: options.limit })

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
