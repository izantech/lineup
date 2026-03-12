import { printTableLine } from "../lib/output";
import { performInstallOrUpdate } from "../lib/operations";
import { resolveRequestedHosts } from "../lib/hosts";

export type InstallCommandOptions = {
  host?: string;
  version?: string;
  fromDir?: string;
  yes?: boolean;
};

export async function runInstallCommand(options: InstallCommandOptions): Promise<void> {
  const hosts = await resolveRequestedHosts(options.host);
  const result = await performInstallOrUpdate({
    action: "install",
    hosts,
    version: options.version,
    fromDir: options.fromDir,
    yes: Boolean(options.yes)
  });

  printTableLine(`Installed Lineup ${result.tag} for: ${hosts.join(", ")}`);
  for (const item of result.results) {
    printTableLine(`- ${item.host}: ${item.ok ? "ok" : "failed"} (${item.message})`);
  }
}
