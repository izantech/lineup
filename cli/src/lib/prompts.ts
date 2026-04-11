import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { HostName } from "./constants";

export function isInteractive(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

function createInterface() {
  return readline.createInterface({ input, output });
}

function parseYesNo(raw: string, defaultValue: boolean): boolean | null {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }

  if (value === "y" || value === "yes") {
    return true;
  }

  if (value === "n" || value === "no") {
    return false;
  }

  return null;
}

export async function promptHostSelection(): Promise<HostName[]> {
  const rl = createInterface();

  try {
    output.write("Select host(s):\n");
    output.write("  1. claude\n");
    output.write("  2. codex\n");
    output.write("  3. opencode\n");
    output.write("  4. all\n");

    while (true) {
      const answer = await rl.question("Enter selection [1-4]: ");
      const normalized = answer.trim().toLowerCase();
      if (normalized === "1" || normalized === "claude") {
        return ["claude"];
      }
      if (normalized === "2" || normalized === "codex") {
        return ["codex"];
      }
      if (normalized === "3" || normalized === "opencode") {
        return ["opencode"];
      }
      if (normalized === "4" || normalized === "all") {
        return ["claude", "codex", "opencode"];
      }
      output.write("Invalid selection. Choose 1, 2, 3, or 4.\n");
    }
  } finally {
    rl.close();
  }
}

export async function promptConfirm(message: string, defaultValue = false): Promise<boolean> {
  const rl = createInterface();

  try {
    while (true) {
      const suffix = defaultValue ? "[Y/n]" : "[y/N]";
      const answer = await rl.question(`${message} ${suffix} `);
      const parsed = parseYesNo(answer, defaultValue);
      if (parsed === null) {
        output.write("Please answer yes or no.\n");
        continue;
      }

      return parsed;
    }
  } finally {
    rl.close();
  }
}

export async function promptMigrationConfirm(): Promise<boolean> {
  return promptConfirm("Detected existing lineup@izantech install. Migrate to CLI-managed install now?", true);
}

export async function promptUninstallPlan(hosts: HostName[]): Promise<{ proceed: boolean; purge: boolean }> {
  const proceed = await promptConfirm(`Uninstall Lineup for host(s): ${hosts.join(", ")}?`, false);
  if (!proceed) {
    return { proceed: false, purge: false };
  }

  const purge = await promptConfirm(
    "Also purge Lineup data (~/.claude/lineup/agents, ~/.codex/lineup/agents, ~/.codex/lineup/memory, ~/.config/opencode/lineup)?",
    false
  );

  return { proceed: true, purge };
}
