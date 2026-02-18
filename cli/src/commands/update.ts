import { printTableLine } from "../lib/output";
import { resolveRequestedHosts } from "../lib/hosts";
import { performInstallOrUpdate } from "../lib/operations";

export type UpdateCommandOptions = {
  host?: string;
  version?: string;
  yes?: boolean;
};

export async function runUpdateCommand(options: UpdateCommandOptions): Promise<void> {
  const hosts = await resolveRequestedHosts(options.host);
  const result = await performInstallOrUpdate({
    action: "update",
    hosts,
    version: options.version,
    yes: Boolean(options.yes)
  });

  printTableLine(`Updated Lineup ${result.tag} for: ${hosts.join(", ")}`);
  for (const item of result.results) {
    printTableLine(`- ${item.host}: ${item.ok ? "ok" : "failed"} (${item.message})`);
  }
}
