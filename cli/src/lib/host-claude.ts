import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CLAUDE_LEGACY_PLUGIN,
  CLAUDE_LOCAL_MARKETPLACE_NAME,
  CLAUDE_LOCAL_PLUGIN,
  LINEUP_PLUGIN_NAME
} from "./constants";
import { CliError } from "./errors";
import { generateHostFiles, loadHostAdapter, prepareClaudePluginSkeleton, writeGeneratedFiles } from "./generate";
import { claudeManagedPluginDir, claudeMarketplaceRoot } from "./paths";
import type { LineupMethod } from "./protocol";
import { assertSuccess, runCommand } from "./process";
import type { StatusHost } from "./types";

function parseInstallPresence(output: string): { localInstalled: boolean; legacyInstalled: boolean } {
  return {
    localInstalled: new RegExp(`${LINEUP_PLUGIN_NAME}@${CLAUDE_LOCAL_MARKETPLACE_NAME}`, "i").test(output),
    legacyInstalled: new RegExp(CLAUDE_LEGACY_PLUGIN, "i").test(output)
  };
}

function checkPluginOnDisk(): { installed: boolean; source: StatusHost["source"] } {
  const marketplaceManifest = path.join(claudeMarketplaceRoot(), ".claude-plugin", "marketplace.json");
  if (existsSync(marketplaceManifest)) {
    return { installed: true, source: "cli-managed" };
  }
  return { installed: false, source: null };
}

function claudePluginVersionsRoot(homeDir = os.homedir()): string {
  return path.join(claudeMarketplaceRoot(homeDir), "plugins", "lineup");
}

function pruneClaudeManagedPluginVersions(options: { keepVersion?: string; homeDir?: string } = {}): void {
  const versionsRoot = claudePluginVersionsRoot(options.homeDir);
  if (!existsSync(versionsRoot)) {
    return;
  }

  for (const entry of readdirSync(versionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (options.keepVersion && entry.name === options.keepVersion) {
      continue;
    }

    rmSync(path.join(versionsRoot, entry.name), { recursive: true, force: true });
  }
}

function writeMarketplace(root: string, pluginSource: string, version: string): string {
  const dotClaude = path.join(root, ".claude-plugin");
  mkdirSync(dotClaude, { recursive: true });

  const marketplace = {
    name: CLAUDE_LOCAL_MARKETPLACE_NAME,
    owner: {
      name: "izantech"
    },
    metadata: {
      description: "CLI-managed local marketplace for Lineup",
      version
    },
    plugins: [
      {
        name: LINEUP_PLUGIN_NAME,
        source: `./${path.relative(root, pluginSource)}`,
        version,
        description: "Lineup local managed plugin"
      }
    ]
  };

  const filePath = path.join(dotClaude, "marketplace.json");
  writeFileSync(filePath, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");
  return root;
}

const JSON_RPC_METHOD_MAP: Record<LineupMethod, string> = {
  "agent/spawn": "spawn",
  "agent/output": "stream",
  "agent/done": "complete",
  "agent/cancel": "cancel",
  "gate/request": "question",
  "gate/respond": "respond",
  "pipeline/cancel": "cancel",
  "pipeline/complete": "complete"
};

export type ClaudeProtocolBridge = {
  host: "claude";
  transport: "json-rpc-2.0";
  framing: "ndjson";
  questionPrimitive: string;
  commands: {
    kickoff: string;
    configure: string;
    explain: string;
    playbook: string;
    digest: string;
  };
  methodMap: Record<LineupMethod, string>;
};

export function describeClaudeProtocolBridge(sourceRoot: string): ClaudeProtocolBridge {
  const adapter = loadHostAdapter(sourceRoot, "claude");
  return {
    host: "claude",
    transport: "json-rpc-2.0",
    framing: "ndjson",
    questionPrimitive: adapter.vars.QUESTION_PRIMITIVE,
    commands: {
      kickoff: adapter.vars.CMD_KICKOFF,
      configure: adapter.vars.CMD_CONFIGURE,
      explain: adapter.vars.CMD_EXPLAIN,
      playbook: adapter.vars.CMD_PLAYBOOK,
      digest: adapter.vars.CMD_DIGEST
    },
    methodMap: JSON_RPC_METHOD_MAP
  };
}

export function prepareClaudePluginFromSource(sourceRoot: string, version: string, homeDir = os.homedir()): string {
  const targetRoot = claudeManagedPluginDir(version, homeDir);
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });

  prepareClaudePluginSkeleton(sourceRoot, targetRoot);

  const files = generateHostFiles(sourceRoot, "claude");
  writeGeneratedFiles(files, targetRoot);

  const pluginManifest = path.join(targetRoot, ".claude-plugin", "plugin.json");
  if (!existsSync(pluginManifest)) {
    throw new CliError(`Generated Claude plugin is missing manifest: ${pluginManifest}`, {
      code: "missing_plugin_manifest"
    });
  }

  return targetRoot;
}

export async function statusClaude(): Promise<StatusHost> {
  try {
    const result = await runCommand("claude", ["plugin", "list"]);
    if (result.code !== 0) {
      const disk = checkPluginOnDisk();
      return {
        host: "claude",
        installed: disk.installed,
        version: null,
        source: disk.source,
        last_action: null,
        error: disk.installed
          ? "claude plugin list unavailable; status detected from filesystem"
          : result.stderr.trim() || "Failed to run claude plugin list"
      };
    }

    const output = `${result.stdout}\n${result.stderr}`;
    const parsed = parseInstallPresence(output);

    return {
      host: "claude",
      installed: parsed.localInstalled || parsed.legacyInstalled,
      version: null,
      source: parsed.localInstalled ? "cli-managed" : parsed.legacyInstalled ? "legacy-marketplace" : null,
      last_action: null,
      ...(parsed.legacyInstalled ? { error: "Legacy marketplace install detected." } : {})
    };
  } catch (error) {
    return {
      host: "claude",
      installed: false,
      version: null,
      source: null,
      last_action: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function installClaudeFromPreparedPlugin({
  pluginSource,
  version,
  migrateLegacy,
  homeDir = os.homedir()
}: {
  pluginSource: string;
  version: string;
  migrateLegacy: boolean;
  homeDir?: string;
}): Promise<void> {
  pruneClaudeManagedPluginVersions({ keepVersion: version, homeDir });
  const marketplaceRoot = claudeMarketplaceRoot(homeDir);
  const marketplacePath = writeMarketplace(marketplaceRoot, pluginSource, version);

  if (migrateLegacy) {
    const removeLegacy = await runCommand("claude", ["plugin", "remove", CLAUDE_LEGACY_PLUGIN]);
    if (removeLegacy.code !== 0) {
      const combined = `${removeLegacy.stdout}\n${removeLegacy.stderr}`;
      if (!/not installed|unknown|could not find/i.test(combined)) {
        assertSuccess(removeLegacy, "claude plugin remove lineup@izantech");
      }
    }
  }

  const addMarketplace = await runCommand("claude", ["plugin", "marketplace", "add", marketplacePath]);
  assertSuccess(addMarketplace, "claude plugin marketplace add", [/already|exists|configured/i]);

  const installPlugin = await runCommand("claude", ["plugin", "install", CLAUDE_LOCAL_PLUGIN]);
  assertSuccess(installPlugin, `claude plugin install ${CLAUDE_LOCAL_PLUGIN}`, [/already installed|already exists/i]);
}

export async function updateClaudeLocal(): Promise<void> {
  const update = await runCommand("claude", ["plugin", "update", CLAUDE_LOCAL_PLUGIN]);
  assertSuccess(update, `claude plugin update ${CLAUDE_LOCAL_PLUGIN}`);
}

export async function uninstallClaude(homeDir = os.homedir()): Promise<void> {
  const removeLocal = await runCommand("claude", ["plugin", "remove", CLAUDE_LOCAL_PLUGIN]);
  if (removeLocal.code !== 0) {
    const output = `${removeLocal.stdout}\n${removeLocal.stderr}`;
    if (!/not installed|unknown/i.test(output)) {
      assertSuccess(removeLocal, `claude plugin remove ${CLAUDE_LOCAL_PLUGIN}`);
    }
  }

  pruneClaudeManagedPluginVersions({ homeDir });
  rmSync(path.join(claudeMarketplaceRoot(homeDir), ".claude-plugin", "marketplace.json"), { force: true });
}

export async function detectLegacyClaudeInstall(): Promise<boolean> {
  const status = await statusClaude();
  return status.source === "legacy-marketplace";
}
