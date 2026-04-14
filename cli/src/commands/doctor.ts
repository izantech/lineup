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

type DoctorRecommendation = {
  label: string;
  command: string;
  detail: string;
};

export type DoctorReport = {
  healthy: boolean;
  checks: {
    git: DoctorCheck;
    node: DoctorCheck;
    hosts: Record<string, DoctorCheck>;
    project: {
      workflow: DoctorCheck;
      git_repository: DoctorCheck;
      git_head: DoctorCheck;
      next_commands: DoctorRecommendation[];
    };
    runtime: {
      artifact_store: DoctorCheck;
      runs_dir: DoctorCheck;
      latest_run: DoctorCheck;
    };
  };
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

function buildRecommendations(workflow: DoctorCheck, gitProject: ReturnType<typeof inspectGitProject>): DoctorRecommendation[] {
  const recommendations: DoctorRecommendation[] = [];

  if (!workflow.ok) {
    recommendations.push({
      label: "scaffold the Lineup workflow and git repo",
      command: "lineup init",
      detail: "creates .lineup-core/workflows/full-pipeline.yaml and initializes git if needed"
    });
  }

  if (!gitProject.isRepository) {
    recommendations.push({
      label: "initialize git",
      command: "lineup init",
      detail: "creates a git repository for native Lineup runs"
    });
  } else if (!gitProject.hasHeadCommit) {
    recommendations.push({
      label: "create the first commit",
      command: 'git add -A && git commit -m "Initial commit"',
      detail: "native Lineup runs require at least one commit"
    });
  }

  const uniqueRecommendations: DoctorRecommendation[] = [];
  const seenCommands = new Set<string>();

  for (const recommendation of recommendations) {
    if (seenCommands.has(recommendation.command)) {
      continue;
    }

    seenCommands.add(recommendation.command);
    uniqueRecommendations.push(recommendation);
  }

  return uniqueRecommendations;
}

export function createDoctorReport(cwd = process.cwd()): DoctorReport {
  const runtime = observeRuntimeStatus();
  const workflow = resolveWorkflowCheck(cwd);
  const gitProject = inspectGitProject(cwd);
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
  const recommendations = buildRecommendations(workflow, gitProject);

  return {
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
        git_head: gitHead,
        next_commands: recommendations
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
}

export async function runDoctorCommand(options: DoctorCommandOptions): Promise<void> {
  const report = createDoctorReport();
  const hostCommands = report.checks.hosts;
  const recommendations = report.checks.project.next_commands;

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
  if (recommendations.length > 0) {
    printTableLine("next:");
    for (const recommendation of recommendations) {
      printTableLine(`  ${recommendation.command} — ${recommendation.detail}`);
    }
  }
  printTableLine(`artifact_store: ${report.checks.runtime.artifact_store.detail}`);
  printTableLine(`runs_dir: ${report.checks.runtime.runs_dir.detail}`);
  printTableLine(`latest_run: ${report.checks.runtime.latest_run.detail}`);
}
