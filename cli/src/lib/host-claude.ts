import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  CLAUDE_LEGACY_PLUGIN,
  CLAUDE_LOCAL_MARKETPLACE_NAME,
  CLAUDE_LOCAL_PLUGIN,
  LINEUP_PLUGIN_NAME
} from "./constants";
import { CliError } from "./errors";
import { generateHostFiles, prepareClaudePluginSkeleton, writeGeneratedFiles } from "./generate";
import { claudeManagedPluginDir, claudeMarketplaceRoot } from "./paths";
import { assertSuccess, runCommand } from "./process";
import type { StatusHost } from "./types";

function parseInstallPresence(output: string): { localInstalled: boolean; legacyInstalled: boolean } {
  return {
    localInstalled: new RegExp(`${LINEUP_PLUGIN_NAME}@${CLAUDE_LOCAL_MARKETPLACE_NAME}`, "i").test(output),
    legacyInstalled: new RegExp(CLAUDE_LEGACY_PLUGIN, "i").test(output)
  };
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

export function prepareClaudePluginFromSource(sourceRoot: string, version: string): string {
  const targetRoot = claudeManagedPluginDir(version);
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
      return {
        host: "claude",
        installed: false,
        version: null,
        source: null,
        last_action: null,
        error: result.stderr.trim() || "Failed to run claude plugin list"
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
  migrateLegacy
}: {
  pluginSource: string;
  version: string;
  migrateLegacy: boolean;
}): Promise<void> {
  const marketplaceRoot = claudeMarketplaceRoot();
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

export async function uninstallClaude(): Promise<void> {
  const removeLocal = await runCommand("claude", ["plugin", "remove", CLAUDE_LOCAL_PLUGIN]);
  if (removeLocal.code !== 0) {
    const output = `${removeLocal.stdout}\n${removeLocal.stderr}`;
    if (!/not installed|unknown/i.test(output)) {
      assertSuccess(removeLocal, `claude plugin remove ${CLAUDE_LOCAL_PLUGIN}`);
    }
  }
}

export async function detectLegacyClaudeInstall(): Promise<boolean> {
  const status = await statusClaude();
  return status.source === "legacy-marketplace";
}
