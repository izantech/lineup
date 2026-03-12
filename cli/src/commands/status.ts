import type { HostName } from "../lib/constants";
import { printJson, printTableLine } from "../lib/output";
import { resolveRequestedHosts } from "../lib/hosts";
import { readStatus } from "../lib/operations";

export type StatusCommandOptions = {
  host?: string;
  json?: boolean;
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

  if (options.json) {
    printJson(status);
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
}
