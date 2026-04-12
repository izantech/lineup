import type { HostName } from "../lib/constants";
import { observeRuntimeStatus } from "../lib/observer";
import { printJson, printTableLine } from "../lib/output";
import { resolveRequestedHosts } from "../lib/hosts";
import { readStatus } from "../lib/operations";

export type StatusCommandOptions = {
  host?: string;
  json?: boolean;
  artifacts?: boolean;
};

function printHostStatus(host: HostName, item: { installed: boolean; version: string | null; source: string | null; last_action: string | null; error?: string }): void {
  printTableLine(`- ${host}: ${item.installed ? "installed" : "not installed"}`);
  printTableLine(`  version: ${item.version ?? "unknown"}`);
  printTableLine(`  source: ${item.source ?? "unknown"}`);
  printTableLine(`  last_action: ${item.last_action ?? "none"}`);
  if (item.error) {
    printTableLine(`  error: ${item.error}`);
  }
}

export async function runStatusCommand(options: StatusCommandOptions): Promise<void> {
  const hosts = await resolveRequestedHosts(options.host);
  const status = await readStatus(hosts);
  const runtime = options.artifacts ? observeRuntimeStatus() : undefined;

  if (options.json) {
    printJson({
      ...status,
      ...(runtime ? { runtime } : {})
    });
    return;
  }

  for (const host of hosts) {
    const item = status.hosts[host];
    if (!item) {
      continue;
    }
    printHostStatus(host, item);
  }

  printTableLine(`state_file: ${status.state_file}`);

  if (runtime) {
    printTableLine(`runs_dir: ${runtime.runs_dir}`);
    printTableLine(`artifact_store_dir: ${runtime.artifact_store_dir}`);
    printTableLine(`run_count: ${runtime.run_count}`);
    if (runtime.latest_run) {
      printTableLine(`latest_run: ${runtime.latest_run.run_id} (${runtime.latest_run.status})`);
      printTableLine(`  workflow: ${runtime.latest_run.workflow ?? "unknown"}`);
      printTableLine(`  current_stage: ${runtime.latest_run.current_stage ?? "none"}`);
      for (const artifact of runtime.latest_run.artifacts) {
        printTableLine(`  artifact:${artifact.kind}: ${artifact.sha256} (${artifact.exists ? "present" : "missing"})`);
      }
    } else {
      printTableLine("latest_run: none");
    }
  }
}
