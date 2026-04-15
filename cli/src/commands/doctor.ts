import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";

import { SUPPORTED_HOSTS, type HostName } from "../lib/constants.js";
import { readOllamaConfig } from "../lib/config.js";
import { LINEUP_CODEX_OLLAMA_PROFILE, codexConfigPath } from "../lib/codex-config.js";
import { inspectGitProject } from "../lib/git.js";
import { observeRuntimeStatus } from "../lib/observer.js";
import { LINEUP_OPENCODE_OLLAMA_PROVIDER, opencodeConfigPath } from "../lib/opencode-config.js";
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

type OllamaHostCheck = {
  mode: DoctorCheck;
  binary: DoctorCheck;
  readiness: DoctorCheck;
  integration: DoctorCheck;
};

type OllamaCheck = Record<HostName, OllamaHostCheck>;

export type DoctorReport = {
  healthy: boolean;
  checks: {
    git: DoctorCheck;
    node: DoctorCheck;
    hosts: Record<string, DoctorCheck>;
    ollama: OllamaCheck;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function checkHostCommand(host: string): DoctorCheck {
  const commandCheck = checkCommand(host);

  if (commandCheck.ok) {
    return commandCheck;
  }

  return {
    ok: false,
    detail: `missing (install ${host} or use another supported host)`
  };
}

function stripApiSuffix(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
}

function resolveOllamaIntegrationDetail(host: HostName, strategy: "launch" | "managed", homeDir: string): DoctorCheck {
  if (strategy === "launch") {
    return {
      ok: true,
      detail: host === "claude"
        ? "launch wrapper with Claude env fallback"
        : host === "codex"
          ? "local OSS provider via codex --oss --local-provider ollama"
          : "launch wrapper"
    };
  }

  if (host === "codex") {
    return {
      ok: true,
      detail: `managed profile '${LINEUP_CODEX_OLLAMA_PROFILE}' in ${codexConfigPath(homeDir)}`
    };
  }

  return {
    ok: true,
    detail: `managed provider '${LINEUP_OPENCODE_OLLAMA_PROVIDER}' in ${opencodeConfigPath(homeDir)}`
  };
}

function checkOllamaHost(host: HostName, cwd = process.cwd(), homeDir = os.homedir()): OllamaHostCheck {
  const config = readOllamaConfig({
    projectRoot: cwd,
    homeDir,
    host
  });

  if (!config?.hostIntegration?.enabled) {
    return {
      mode: { ok: true, detail: "disabled" },
      binary: { ok: true, detail: "not required" },
      readiness: { ok: true, detail: "not required" },
      integration: { ok: true, detail: "disabled" }
    };
  }

  const strategy = config.hostIntegration.strategy === "auto"
    ? "launch"
    : config.hostIntegration.strategy;
  const binary = checkCommand("ollama");

  if (!binary.ok) {
    return {
      mode: {
        ok: true,
        detail: `${strategy} (${config.model} @ ${config.baseUrl})`
      },
      binary: {
        ok: false,
        detail: "missing"
      },
      readiness: {
        ok: false,
        detail: "ollama binary is required to verify host integration readiness"
      },
      integration: resolveOllamaIntegrationDetail(host, strategy, homeDir)
    };
  }

  try {
    const output = execSync("ollama list", {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
      env: {
        ...process.env,
        OLLAMA_HOST: stripApiSuffix(config.baseUrl)
      }
    }).toString("utf8");

    return {
      mode: {
        ok: true,
        detail: `${strategy} (${config.model} @ ${config.baseUrl})`
      },
      binary: {
        ok: true,
        detail: "available"
      },
      readiness: new RegExp(`^\\s*${escapeRegExp(config.model)}(?:\\s|$)`, "m").test(output)
        ? {
            ok: true,
            detail: `configured model '${config.model}' is available`
          }
        : {
            ok: false,
            detail: `configured model '${config.model}' is not listed by ollama`
          },
      integration: resolveOllamaIntegrationDetail(host, strategy, homeDir)
    };
  } catch (error) {
    return {
      mode: {
        ok: true,
        detail: `${strategy} (${config.model} @ ${config.baseUrl})`
      },
      binary: {
        ok: true,
        detail: "available"
      },
      readiness: {
        ok: false,
        detail: `ollama list failed: ${error instanceof Error ? error.message : String(error)}`
      },
      integration: resolveOllamaIntegrationDetail(host, strategy, homeDir)
    };
  }
}

function buildRecommendations(
  workflow: DoctorCheck,
  gitProject: ReturnType<typeof inspectGitProject>,
  hostCommands: Record<string, DoctorCheck>,
  ollama: OllamaCheck
): DoctorRecommendation[] {
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

  const availableHosts = Object.entries(hostCommands)
    .filter(([, check]) => check.ok)
    .map(([host]) => host);

  if (availableHosts.length === 0) {
    recommendations.push({
      label: "install and configure a supported host CLI",
      command: "install Claude Code, Codex CLI, or OpenCode, then run lineup install --host <host>",
      detail: "Lineup needs at least one local host binary before native runs can execute"
    });
  }

  for (const host of SUPPORTED_HOSTS) {
    const check = ollama[host];
    if (check.mode.detail === "disabled" || check.readiness.ok) {
      continue;
    }

    recommendations.push({
      label: `verify ${host} Ollama readiness`,
      command: "ollama list",
      detail: `${host} host integration is enabled, but the configured Ollama model could not be verified`
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

export function createDoctorReport(cwd = process.cwd(), homeDir = os.homedir()): DoctorReport {
  const runtime = observeRuntimeStatus();
  const workflow = resolveWorkflowCheck(cwd);
  const gitProject = inspectGitProject(cwd);
  const ollama = Object.fromEntries(
    SUPPORTED_HOSTS.map((host) => [host, checkOllamaHost(host, cwd, homeDir)])
  ) as OllamaCheck;
  const hostCommands = {
    claude: checkHostCommand("claude"),
    codex: checkHostCommand("codex"),
    opencode: checkHostCommand("opencode")
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
  const recommendations = buildRecommendations(workflow, gitProject, hostCommands, ollama);

  return {
    healthy:
      checkCommand("git").ok &&
      checkCommand("node").ok &&
      workflow.ok &&
      gitRepository.ok &&
      gitHead.ok &&
      runtime.run_count >= 0 &&
      Object.values(ollama).every((check) => check.mode.detail === "disabled" || (check.binary.ok && check.readiness.ok)),
    checks: {
      git: checkCommand("git"),
      node: checkCommand("node"),
      hosts: Object.fromEntries(
        SUPPORTED_HOSTS.map((host) => [host, hostCommands[host]])
      ),
      ollama,
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
  for (const host of SUPPORTED_HOSTS) {
    const ollama = report.checks.ollama[host];
    printTableLine(`ollama/${host}: ${ollama.mode.detail}`);
    printTableLine(`  binary: ${ollama.binary.detail}`);
    printTableLine(`  readiness: ${ollama.readiness.detail}`);
    printTableLine(`  integration: ${ollama.integration.detail}`);
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
