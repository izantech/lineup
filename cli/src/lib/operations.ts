import { rmSync } from "node:fs";

import type { HostName } from "./constants";
import { CliError, asErrorMessage } from "./errors";
import {
  detectLegacyClaudeInstall,
  installClaudeFromPreparedPlugin,
  prepareClaudePluginFromSource,
  statusClaude,
  uninstallClaude,
  updateClaudeLocal
} from "./host-claude";
import { installCodex, statusCodex, uninstallCodex } from "./host-codex";
import { codexHostRoot, lineupStateFile, purgeTargets } from "./paths";
import { isInteractive, promptMigrationConfirm, promptUninstallPlan } from "./prompts";
import { resolveRelease } from "./release";
import { loadState, saveState, updateHostState } from "./state";
import type { StatusHost, StatusOutput } from "./types";
import { validateSourceBundle } from "./validation";

export type HostActionResult = {
  host: HostName;
  ok: boolean;
  message: string;
};

export type InstallUpdateResult = {
  action: "install" | "update";
  tag: string;
  results: HostActionResult[];
};

export type UninstallResult = {
  action: "uninstall";
  cancelled: boolean;
  purged_paths: string[];
  results: HostActionResult[];
};

async function shouldMigrateLegacyClaudeInstall(yes: boolean): Promise<boolean> {
  const legacyDetected = await detectLegacyClaudeInstall();
  if (!legacyDetected) {
    return false;
  }

  if (yes) {
    return true;
  }

  if (!isInteractive()) {
    throw new CliError(
      "Detected legacy Claude install (lineup@izantech). Re-run with --yes to migrate in non-interactive mode.",
      {
        code: "migration_confirmation_required"
      }
    );
  }

  const approved = await promptMigrationConfirm();
  if (!approved) {
    throw new CliError("Migration cancelled by user.", {
      code: "migration_cancelled"
    });
  }

  return true;
}

function summarizeFailures(failures: Array<{ host: HostName; error: string }>, action: string): never {
  const lines = [
    `Failed to ${action} Lineup for ${failures.length} host(s):`,
    ...failures.map((failure) => `- ${failure.host}: ${failure.error}`)
  ];

  throw new CliError(lines.join("\n"), {
    code: `host_${action}_failed`
  });
}

export async function performInstallOrUpdate(input: {
  action: "install" | "update";
  hosts: HostName[];
  version?: string;
  yes: boolean;
}): Promise<InstallUpdateResult> {
  const release = await resolveRelease({ version: input.version });
  validateSourceBundle(release.sourceRoot);

  const state = loadState();
  const failures: Array<{ host: HostName; error: string }> = [];
  const results: HostActionResult[] = [];

  const migrateLegacyClaude = input.hosts.includes("claude")
    ? await shouldMigrateLegacyClaudeInstall(input.yes)
    : false;

  for (const host of input.hosts) {
    try {
      if (host === "claude") {
        const pluginSource = prepareClaudePluginFromSource(release.sourceRoot, release.tag);
        await installClaudeFromPreparedPlugin({
          pluginSource,
          version: release.tag,
          migrateLegacy: migrateLegacyClaude
        });

        if (input.action === "update") {
          await updateClaudeLocal();
        }

        updateHostState(state, "claude", {
          installed: true,
          version: release.tag,
          source: "cli-managed",
          last_action: input.action
        });

        results.push({
          host,
          ok: true,
          message: `Claude ${input.action} complete (${release.tag}).`
        });
      }

      if (host === "codex") {
        const codexResult = installCodex({
          sourceRoot: release.sourceRoot,
          workspaceRoot: codexHostRoot(),
          global: true
        });

        updateHostState(state, "codex", {
          installed: true,
          version: release.tag,
          source: "cli-managed",
          skills_dir: codexResult.skills_dir,
          last_action: input.action
        });

        results.push({
          host,
          ok: true,
          message: `Codex ${input.action} complete (${release.tag}).`
        });
      }
    } catch (error) {
      const message = asErrorMessage(error);
      failures.push({ host, error: message });
      results.push({
        host,
        ok: false,
        message
      });
    }
  }

  saveState(state);

  if (failures.length > 0) {
    summarizeFailures(failures, input.action);
  }

  return {
    action: input.action,
    tag: release.tag,
    results
  };
}

export async function performUninstall(input: {
  hosts: HostName[];
  yes: boolean;
  purge: boolean;
}): Promise<UninstallResult> {
  let purge = input.purge;

  if (!input.yes) {
    if (!isInteractive()) {
      throw new CliError("Uninstall requires confirmation in interactive mode. Use --yes for non-interactive execution.", {
        code: "uninstall_confirmation_required"
      });
    }

    const plan = await promptUninstallPlan(input.hosts);
    if (!plan.proceed) {
      return {
        action: "uninstall",
        cancelled: true,
        purged_paths: [],
        results: []
      };
    }

    purge = plan.purge;
  }

  const state = loadState();
  const failures: Array<{ host: HostName; error: string }> = [];
  const results: HostActionResult[] = [];

  for (const host of input.hosts) {
    try {
      if (host === "claude") {
        await uninstallClaude();
        updateHostState(state, "claude", {
          installed: false,
          version: null,
          source: null,
          last_action: "uninstall"
        });

        results.push({
          host,
          ok: true,
          message: "Claude uninstall complete."
        });
      }

      if (host === "codex") {
        uninstallCodex(true);
        updateHostState(state, "codex", {
          installed: false,
          version: null,
          source: null,
          skills_dir: null,
          last_action: "uninstall"
        });

        results.push({
          host,
          ok: true,
          message: "Codex uninstall complete."
        });
      }
    } catch (error) {
      const message = asErrorMessage(error);
      failures.push({ host, error: message });
      results.push({ host, ok: false, message });
    }
  }

  const purged: string[] = [];
  if (purge) {
    const targets = purgeTargets(input.hosts);
    for (const target of targets) {
      rmSync(target, { recursive: true, force: true });
      purged.push(target);
    }
  }

  saveState(state);

  if (failures.length > 0) {
    summarizeFailures(failures, "uninstall");
  }

  return {
    action: "uninstall",
    cancelled: false,
    purged_paths: purged,
    results
  };
}

function mergeStatus(stateHost: StatusHost | undefined, runtimeHost: StatusHost): StatusHost {
  return {
    host: runtimeHost.host,
    installed: runtimeHost.installed,
    version: runtimeHost.version ?? stateHost?.version ?? null,
    source: runtimeHost.source ?? stateHost?.source ?? null,
    last_action: stateHost?.last_action ?? runtimeHost.last_action ?? null,
    ...(runtimeHost.error ? { error: runtimeHost.error } : {})
  };
}

export async function readStatus(hosts: HostName[]): Promise<StatusOutput> {
  const state = loadState();

  const outputHosts: Partial<Record<HostName, StatusHost>> = {};

  for (const host of hosts) {
    if (host === "claude") {
      const runtime = await statusClaude();
      const stateHost = state.hosts.claude
        ? {
            host: "claude" as const,
            installed: state.hosts.claude.installed,
            version: state.hosts.claude.version ?? null,
            source: state.hosts.claude.source ?? null,
            last_action: state.hosts.claude.last_action
          }
        : undefined;

      outputHosts.claude = mergeStatus(stateHost, runtime);
    }

    if (host === "codex") {
      const runtime = statusCodex(true);
      const stateHost = state.hosts.codex
        ? {
            host: "codex" as const,
            installed: state.hosts.codex.installed,
            version: state.hosts.codex.version ?? null,
            source: state.hosts.codex.source ?? null,
            last_action: state.hosts.codex.last_action
          }
        : undefined;

      outputHosts.codex = mergeStatus(stateHost, runtime);
    }
  }

  return {
    schema_version: state.schema_version,
    state_file: lineupStateFile(),
    hosts: outputHosts
  };
}
