import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

import { SUPPORTED_HOSTS } from "../lib/constants.js";
import { observeRuntimeStatus } from "../lib/observer.js";
import { printJson, printTableLine } from "../lib/output.js";

export type DoctorCommandOptions = {
  json?: boolean;
};

type DoctorCheck = {
  ok: boolean;
  detail: string;
};

function checkCommand(command: string): DoctorCheck {
  try {
    execSync(`which ${command}`, { stdio: "ignore" });
    return {
      ok: true,
      detail: "available"
    };
  } catch {
    return {
      ok: false,
      detail: "missing"
    };
  }
}

export async function runDoctorCommand(options: DoctorCommandOptions): Promise<void> {
  const runtime = observeRuntimeStatus();
  const hostCommands = {
    claude: checkCommand("claude"),
    codex: checkCommand("codex"),
    opencode: checkCommand("opencode")
  };

  const report = {
    healthy:
      checkCommand("git").ok &&
      checkCommand("node").ok &&
      runtime.run_count >= 0,
    checks: {
      git: checkCommand("git"),
      node: checkCommand("node"),
      hosts: Object.fromEntries(
        SUPPORTED_HOSTS.map((host) => [host, hostCommands[host]])
      ),
      runtime: {
        artifact_store: {
          ok: existsSync(runtime.artifact_store_dir),
          detail: runtime.artifact_store_dir
        },
        runs_dir: {
          ok: existsSync(runtime.runs_dir),
          detail: runtime.runs_dir
        },
        latest_run: runtime.latest_run
          ? {
              ok: runtime.latest_run.status !== "failed",
              detail: `${runtime.latest_run.run_id} (${runtime.latest_run.status})`
            }
          : {
              ok: true,
              detail: "no runs recorded"
            }
      }
    }
  };

  if (options.json) {
    printJson(report);
    return;
  }

  printTableLine(`healthy: ${report.healthy ? "yes" : "no"}`);
  printTableLine(`git: ${report.checks.git.detail}`);
  printTableLine(`node: ${report.checks.node.detail}`);
  for (const host of SUPPORTED_HOSTS) {
    printTableLine(`${host}: ${hostCommands[host].detail}`);
  }
  printTableLine(`artifact_store: ${report.checks.runtime.artifact_store.detail}`);
  printTableLine(`runs_dir: ${report.checks.runtime.runs_dir.detail}`);
  printTableLine(`latest_run: ${report.checks.runtime.latest_run.detail}`);
}
