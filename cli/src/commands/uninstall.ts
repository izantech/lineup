import { printTableLine } from "../lib/output";
import { resolveRequestedHosts } from "../lib/hosts";
import { performUninstall } from "../lib/operations";

export type UninstallCommandOptions = {
  host?: string;
  yes?: boolean;
  purge?: boolean;
};

export async function runUninstallCommand(options: UninstallCommandOptions): Promise<void> {
  const hosts = await resolveRequestedHosts(options.host);
  const result = await performUninstall({
    hosts,
    yes: Boolean(options.yes),
    purge: Boolean(options.purge)
  });

  if (result.cancelled) {
    printTableLine("Uninstall cancelled.");
    return;
  }

  printTableLine(`Uninstalled Lineup for: ${hosts.join(", ")}`);
  for (const item of result.results) {
    printTableLine(`- ${item.host}: ${item.ok ? "ok" : "failed"} (${item.message})`);
  }

  if (result.purged_paths.length > 0) {
    printTableLine("Purged data paths:");
    for (const target of result.purged_paths) {
      printTableLine(`- ${target}`);
    }
  }
}
