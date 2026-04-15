import { existsSync } from "node:fs";
import os from "node:os";
import process from "node:process";

import { resolveLocalExecutionHost } from "../lib/agent-runner.js";
import {
  AGENT_NAMES,
  hostOllamaPath,
  hostOverrideDir,
  projectConfigPath,
  readOllamaConfig,
  resolveAgentConfig,
  resolveLineupConfig,
  type LineupConfigFile
} from "../lib/config.js";
import type { HostName } from "../lib/constants.js";
import { printTableLine } from "../lib/output.js";
import { projectRoot } from "../lib/paths.js";

export type ConfigInspectionOptions = {
  host?: HostName;
};

export type ConfigReport = {
  projectRoot: string;
  projectConfig: {
    path: string;
    exists: boolean;
  };
  hostResolution: {
    requested: HostName | null;
    resolved: HostName | null;
    order: readonly HostName[];
    note?: string;
  };
  hostPaths: {
    ollamaConfig: {
      path: string | null;
      exists: boolean;
    };
    agentOverridesDir: {
      path: string | null;
      exists: boolean;
    };
  };
  modelRouting: Record<string, string>;
  ollama: ReturnType<typeof readOllamaConfig>;
  agents: Array<{
    name: string;
    modelAlias: string;
    modelTarget: string;
    modelSource: string;
    memory: string;
    memorySource: string;
    tools: string;
    toolsSource: string;
    warnings: string[];
  }>;
  warnings: string[];
};

export const HOST_ORDER: readonly HostName[] = ["claude", "codex", "opencode"];

function resolveHostForInspection(requestedHost?: HostName): { requested: HostName | null; resolved: HostName | null; note?: string } {
  if (requestedHost) {
    return { requested: requestedHost, resolved: requestedHost };
  }

  try {
    return { requested: null, resolved: resolveLocalExecutionHost() };
  } catch (error) {
    return {
      requested: null,
      resolved: null,
      note: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildConfigReport(
  options: ConfigInspectionOptions = {},
  cwd = process.cwd(),
  homeDir = os.homedir(),
  projectConfigOverride?: LineupConfigFile
): ConfigReport {
  const root = projectRoot(cwd);
  const hostResolution = resolveHostForInspection(options.host);
  const inspectHost = hostResolution.resolved ?? options.host;
  const lineupConfig = resolveLineupConfig({
    projectRoot: root,
    homeDir,
    host: inspectHost,
    ...(projectConfigOverride ? { projectConfig: projectConfigOverride } : {})
  });

  const ollamaConfigPath = inspectHost ? hostOllamaPath(inspectHost, homeDir) : null;
  const agentOverridesPath = inspectHost ? hostOverrideDir(inspectHost, homeDir) : null;

  return {
    projectRoot: root,
    projectConfig: {
      path: projectConfigPath(root),
      exists: existsSync(projectConfigPath(root))
    },
    hostResolution: {
      requested: hostResolution.requested,
      resolved: hostResolution.resolved,
      order: HOST_ORDER,
      ...(hostResolution.note ? { note: hostResolution.note } : {})
    },
    hostPaths: {
      ollamaConfig: {
        path: ollamaConfigPath,
        exists: ollamaConfigPath ? existsSync(ollamaConfigPath) : false
      },
      agentOverridesDir: {
        path: agentOverridesPath,
        exists: agentOverridesPath ? existsSync(agentOverridesPath) : false
      }
    },
    modelRouting: lineupConfig.modelRouting,
    ollama: inspectHost
      ? readOllamaConfig({
          projectRoot: root,
          homeDir,
          host: inspectHost,
          ...(projectConfigOverride ? { projectConfig: projectConfigOverride } : {})
        })
      : null,
    agents: inspectHost
      ? AGENT_NAMES.map((agent) => {
          const resolved = resolveAgentConfig(agent, {
            projectRoot: root,
            homeDir,
            host: inspectHost,
            ...(projectConfigOverride ? { projectConfig: projectConfigOverride } : {})
          });

          return {
            name: agent,
            modelAlias: resolved.model,
            modelTarget: resolved.modelTarget,
            modelSource: resolved.source.model,
            memory: resolved.memory,
            memorySource: resolved.source.memory,
            tools: resolved.tools,
            toolsSource: resolved.source.tools,
            warnings: resolved.warnings
          };
        })
      : [],
    warnings: lineupConfig.warnings
  };
}

export function createConfigReport(options: ConfigInspectionOptions = {}, cwd = process.cwd(), homeDir = os.homedir()): ConfigReport {
  return buildConfigReport(options, cwd, homeDir);
}

export function createConfigPreviewReport(
  options: ConfigInspectionOptions = {},
  draftConfig: LineupConfigFile,
  cwd = process.cwd(),
  homeDir = os.homedir()
): ConfigReport {
  return buildConfigReport(options, cwd, homeDir, draftConfig);
}

export function printConfigReport(report: ConfigReport): void {
  printTableLine(`project_root: ${report.projectRoot}`);
  printTableLine(`project_config: ${report.projectConfig.path} (${report.projectConfig.exists ? "present" : "missing"})`);
  printTableLine(`requested_host: ${report.hostResolution.requested ?? "auto"}`);
  printTableLine(`resolved_host: ${report.hostResolution.resolved ?? "unresolved"}`);
  printTableLine(`host_resolution_order: ${report.hostResolution.order.join(" -> ")}`);
  if (report.hostResolution.note) {
    printTableLine(`host_note: ${report.hostResolution.note}`);
  }

  if (report.hostPaths.ollamaConfig.path) {
    printTableLine(`ollama_config: ${report.hostPaths.ollamaConfig.path} (${report.hostPaths.ollamaConfig.exists ? "present" : "missing"})`);
  }
  if (report.hostPaths.agentOverridesDir.path) {
    printTableLine(`agent_override_dir: ${report.hostPaths.agentOverridesDir.path} (${report.hostPaths.agentOverridesDir.exists ? "present" : "missing"})`);
  }

  printTableLine("model_routing:");
  for (const [alias, target] of Object.entries(report.modelRouting)) {
    printTableLine(`  ${alias} -> ${target}`);
  }

  printTableLine("agents:");
  for (const agent of report.agents) {
    printTableLine(`  ${agent.name}: ${agent.modelAlias} -> ${agent.modelTarget} (model:${agent.modelSource}, memory:${agent.memorySource}, tools:${agent.toolsSource})`);
  }

  if (report.ollama) {
    printTableLine(`ollama: enabled (${report.ollama.model || "<missing>"} @ ${report.ollama.baseUrl}, scope:${report.ollama.scope})`);
    if (report.ollama.hostIntegration) {
      printTableLine(`ollama_host_integration: enabled (${report.ollama.hostIntegration.strategy})`);
    } else {
      printTableLine("ollama_host_integration: disabled");
    }
  } else {
    printTableLine("ollama: disabled");
  }

  if (report.warnings.length > 0) {
    printTableLine("warnings:");
    for (const warning of report.warnings) {
      printTableLine(`  - ${warning}`);
    }
  }
}
