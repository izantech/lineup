import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

import { SUPPORTED_HOSTS } from "../lib/constants.js";
import { inspectGitProject } from "../lib/git.js";
import { observeRuntimeStatus } from "../lib/observer.js";
import { printJson, printTableLine } from "../lib/output.js";

export type DoctorCommandOptions = {
  json?: boolean;
};

type DoctorCheck = {
  ok: boolean;
  detail: string;
};

function resolveWorkflowCheck(cwd = process.cwd()): DoctorCheck {
  const workflowCandidates = [
    `${cwd}/.lineup-core/workflows/full-pipeline.yaml`,
    `${cwd}/.lineup/workflows/full-pipeline.yaml`
  ];
  const workflowPath = workflowCandidates.find((candidate) => existsSync(candidate));

  if (!workflowPath) {
    return {
      ok: false,
      detail: "missing (.lineup-core/workflows/full-pipeline.yaml)"
    };
  }

  return {
    ok: true,
    detail: workflowPath
  };
}

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
  const workflow = resolveWorkflowCheck();
  const gitProject = inspectGitProject(process.cwd());
  const hostCommands = {
    claude: checkCommand("claude"),
    codex: checkCommand("codex"),
    opencode: checkCommand("opencode")
  };

  const gitRepository: DoctorCheck = gitProject.isRepository
    ? { ok: true, detail: "available" }
    : { ok: false, detail: "current directory is not a git repository" };

  const gitHead: DoctorCheck = gitProject.hasHeadCommit
    ? { ok: true, detail: gitProject.treeSha ?? "present" }
    : {
        ok: false,
        detail: gitProject.isRepository ? "repository has no commits yet" : "unavailable"
      };

  const report = {
    healthy:
      checkCommand("git").ok &&
      checkCommand("node").ok &&
      workflow.ok &&
      gitRepository.ok &&
      gitHead.ok &&
      runtime.run_count >= 0,
    checks: {
      git: checkCommand("git"),
      node: checkCommand("node"),
      hosts: Object.fromEntries(
        SUPPORTED_HOSTS.map((host) => [host, hostCommands[host]])
      ),
      project: {
        workflow,
        git_repository: gitRepository,
        git_head: gitHead
      },
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
  printTableLine(`workflow: ${report.checks.project.workflow.detail}`);
  printTableLine(`git_repository: ${report.checks.project.git_repository.detail}`);
  printTableLine(`git_head: ${report.checks.project.git_head.detail}`);
  printTableLine(`artifact_store: ${report.checks.runtime.artifact_store.detail}`);
  printTableLine(`runs_dir: ${report.checks.runtime.runs_dir.detail}`);
  printTableLine(`latest_run: ${report.checks.runtime.latest_run.detail}`);
}
