import { existsSync } from "node:fs";
import os from "node:os";
import process from "node:process";
import readline from "node:readline/promises";

import { resolveLocalExecutionHost } from "../lib/agent-runner.js";
import {
  AGENT_NAMES,
  MEMORY_SCOPES,
  OLLAMA_HOST_INTEGRATION_STRATEGIES,
  OLLAMA_SCOPES,
  hostOllamaPath,
  hostOverrideDir,
  projectConfigPath,
  readOllamaConfig,
  readProjectConfigFile,
  resolveAgentConfig,
  resolveLineupConfig,
  writeProjectConfigFile,
  type LineupConfigFile,
  type ModelAlias
} from "../lib/config.js";
import type { HostName } from "../lib/constants.js";
import { CliError } from "../lib/errors.js";
import { printJson, printTableLine } from "../lib/output.js";
import { projectRoot } from "../lib/paths.js";
import { isInteractive } from "../lib/prompts.js";

export type ConfigCommandMode = "show" | "edit";

export type ConfigCommandOptions = {
  host?: HostName;
  json?: boolean;
  mode?: ConfigCommandMode;
};

type ConfigReport = {
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

const HOST_ORDER: readonly HostName[] = ["claude", "codex", "opencode"];
const MODEL_ALIAS_SET = new Set<ModelAlias>(["haiku", "sonnet", "opus"]);
const AGENT_NAME_SET = new Set<string>(AGENT_NAMES);
const MEMORY_SCOPE_SET = new Set<string>(MEMORY_SCOPES);
const OLLAMA_SCOPE_SET = new Set<string>(OLLAMA_SCOPES);
const OLLAMA_STRATEGY_SET = new Set<string>(OLLAMA_HOST_INTEGRATION_STRATEGIES);

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

export function createConfigReport(options: ConfigCommandOptions = {}, cwd = process.cwd(), homeDir = os.homedir()): ConfigReport {
  const root = projectRoot(cwd);
  const hostResolution = resolveHostForInspection(options.host);
  const inspectHost = hostResolution.resolved ?? options.host;
  const lineupConfig = resolveLineupConfig({
    projectRoot: root,
    homeDir,
    host: inspectHost
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
          host: inspectHost
        })
      : null,
    agents: inspectHost
      ? AGENT_NAMES.map((agent) => {
          const resolved = resolveAgentConfig(agent, {
            projectRoot: root,
            homeDir,
            host: inspectHost
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

function printConfigReport(report: ConfigReport): void {
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

function parseBoolean(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  throw new CliError(`Invalid boolean '${raw}'. Use true|false.`, {
    code: "invalid_args"
  });
}

function validateConfigPath(configPath: string): void {
  const parts = configPath.split(".");
  if (parts.length < 2) {
    throw new CliError(`Unsupported config key '${configPath}'.`, {
      code: "invalid_args"
    });
  }

  if (parts[0] === "models") {
    if (parts.length === 2 && MODEL_ALIAS_SET.has(parts[1] as ModelAlias)) {
      return;
    }
    throw new CliError(`Unsupported model key '${configPath}'. Use models.haiku|sonnet|opus.`, {
      code: "invalid_args"
    });
  }

  if (parts[0] === "agents") {
    if (parts.length === 3 && AGENT_NAME_SET.has(parts[1]) && ["model", "tools", "memory"].includes(parts[2])) {
      return;
    }
    throw new CliError(`Unsupported agent key '${configPath}'. Use agents.<agent>.model|tools|memory.`, {
      code: "invalid_args"
    });
  }

  const supportedOllamaPaths = new Set([
    "ollama.enabled",
    "ollama.model",
    "ollama.scope",
    "ollama.baseUrl",
    "ollama.host_integration.enabled",
    "ollama.host_integration.strategy"
  ]);
  if (supportedOllamaPaths.has(configPath)) {
    return;
  }

  throw new CliError(`Unsupported config key '${configPath}'.`, {
    code: "invalid_args"
  });
}

function normalizeConfigValue(configPath: string, rawValue: string): string | boolean {
  validateConfigPath(configPath);

  if (configPath === "ollama.enabled" || configPath === "ollama.host_integration.enabled") {
    return parseBoolean(rawValue);
  }

  if (configPath.endsWith(".model") && configPath.startsWith("agents.")) {
    const value = rawValue.trim();
    if (!MODEL_ALIAS_SET.has(value as ModelAlias)) {
      throw new CliError(`Invalid model alias '${rawValue}'. Use haiku|sonnet|opus.`, {
        code: "invalid_args"
      });
    }
    return value;
  }

  if (configPath.endsWith(".memory")) {
    const value = rawValue.trim();
    if (!MEMORY_SCOPE_SET.has(value)) {
      throw new CliError(`Invalid memory scope '${rawValue}'. Use user|project|local.`, {
        code: "invalid_args"
      });
    }
    return value;
  }

  if (configPath === "ollama.scope") {
    const value = rawValue.trim();
    if (!OLLAMA_SCOPE_SET.has(value)) {
      throw new CliError(`Invalid Ollama scope '${rawValue}'. Use research|full.`, {
        code: "invalid_args"
      });
    }
    return value;
  }

  if (configPath === "ollama.host_integration.strategy") {
    const value = rawValue.trim();
    if (!OLLAMA_STRATEGY_SET.has(value)) {
      throw new CliError(`Invalid Ollama strategy '${rawValue}'. Use auto|launch|managed.`, {
        code: "invalid_args"
      });
    }
    return value;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new CliError(`Value for '${configPath}' cannot be empty.`, {
      code: "invalid_args"
    });
  }
  return trimmed;
}

function setNestedValue(target: Record<string, unknown>, configPath: string, value: string | boolean): void {
  const parts = configPath.split(".");
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function unsetNestedValue(target: Record<string, unknown>, configPath: string): void {
  const parts = configPath.split(".");
  const stack: Array<{ parent: Record<string, unknown>; key: string }> = [];
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    stack.push({ parent: cursor, key });
    cursor = next as Record<string, unknown>;
  }

  delete cursor[parts[parts.length - 1]];
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const { parent, key } = stack[index];
    const value = parent[key];
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0) {
      delete parent[key];
      continue;
    }
    break;
  }
}

function formatEditableConfig(config: LineupConfigFile): string {
  return JSON.stringify(config, null, 2);
}

async function runConfigEditor(cwd = process.cwd()): Promise<void> {
  if (!isInteractive()) {
    throw new CliError("`lineup config` requires an interactive terminal. Use `lineup config show` for read-only output.", {
      code: "invalid_args"
    });
  }

  const root = projectRoot(cwd);
  const configPath = projectConfigPath(root);
  const { config, warnings } = readProjectConfigFile(configPath);
  const draft: LineupConfigFile = structuredClone(config);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    printTableLine(`Editing project config: ${configPath}`);
    printTableLine("Commands: show, set <path> <value>, unset <path>, save, quit, help");
    printTableLine("Supported keys: models.{haiku|sonnet|opus}, agents.<agent>.{model|tools|memory}, ollama.{enabled|model|scope|baseUrl}, ollama.host_integration.{enabled|strategy}");
    for (const warning of warnings) {
      printTableLine(warning);
    }

    while (true) {
      const answer = (await rl.question("lineup-config> ")).trim();
      if (!answer) {
        continue;
      }

      if (answer === "help") {
        printTableLine("Commands: show, set <path> <value>, unset <path>, save, quit");
        continue;
      }

      if (answer === "show") {
        printTableLine(formatEditableConfig(draft));
        continue;
      }

      if (answer === "save") {
        writeProjectConfigFile(configPath, draft);
        printTableLine(`Saved project config: ${configPath}`);
        return;
      }

      if (answer === "quit" || answer === "exit") {
        printTableLine("Config editor closed without saving.");
        return;
      }

      if (answer.startsWith("set ")) {
        const [, rest] = answer.split(/^set\s+/, 2);
        const firstSpace = rest.indexOf(" ");
        if (firstSpace <= 0) {
          throw new CliError("Usage: set <path> <value>", {
            code: "invalid_args"
          });
        }
        const configPathValue = rest.slice(0, firstSpace).trim();
        const rawValue = rest.slice(firstSpace + 1);
        const normalized = normalizeConfigValue(configPathValue, rawValue);
        setNestedValue(draft as Record<string, unknown>, configPathValue, normalized);
        printTableLine(`set ${configPathValue} = ${String(normalized)}`);
        continue;
      }

      if (answer.startsWith("unset ")) {
        const [, configPathValue] = answer.split(/^unset\s+/, 2);
        const trimmedPath = configPathValue.trim();
        validateConfigPath(trimmedPath);
        unsetNestedValue(draft as Record<string, unknown>, trimmedPath);
        printTableLine(`unset ${trimmedPath}`);
        continue;
      }

      printTableLine("Unknown command. Use help, show, set, unset, save, or quit.");
    }
  } finally {
    rl.close();
  }
}

export async function runConfigCommand(options: ConfigCommandOptions = {}): Promise<void> {
  const mode = options.mode ?? (options.json ? "show" : "edit");
  if (mode === "edit" && !options.json) {
    await runConfigEditor();
    return;
  }

  const report = createConfigReport(options);

  if (options.json) {
    printJson(report);
    return;
  }

  printConfigReport(report);
}
