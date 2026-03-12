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
import { resolveLocalRelease, resolveRelease } from "./release";
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

export type OperationsDeps = {
  resolveRelease: typeof resolveRelease;
  resolveLocalRelease: typeof resolveLocalRelease;
  validateSourceBundle: typeof validateSourceBundle;
  detectLegacyClaudeInstall: typeof detectLegacyClaudeInstall;
  installClaudeFromPreparedPlugin: typeof installClaudeFromPreparedPlugin;
  prepareClaudePluginFromSource: typeof prepareClaudePluginFromSource;
  statusClaude: typeof statusClaude;
  uninstallClaude: typeof uninstallClaude;
  updateClaudeLocal: typeof updateClaudeLocal;
  installCodex: typeof installCodex;
  statusCodex: typeof statusCodex;
  uninstallCodex: typeof uninstallCodex;
  codexHostRoot: typeof codexHostRoot;
  lineupStateFile: typeof lineupStateFile;
  purgeTargets: typeof purgeTargets;
  isInteractive: typeof isInteractive;
  promptMigrationConfirm: typeof promptMigrationConfirm;
  promptUninstallPlan: typeof promptUninstallPlan;
  loadState: typeof loadState;
  saveState: typeof saveState;
  updateHostState: typeof updateHostState;
  removePath: (target: string) => void;
  asErrorMessage: typeof asErrorMessage;
};

const defaultDeps: OperationsDeps = {
  resolveRelease,
  resolveLocalRelease,
  validateSourceBundle,
  detectLegacyClaudeInstall,
  installClaudeFromPreparedPlugin,
  prepareClaudePluginFromSource,
  statusClaude,
  uninstallClaude,
  updateClaudeLocal,
  installCodex,
  statusCodex,
  uninstallCodex,
  codexHostRoot,
  lineupStateFile,
  purgeTargets,
  isInteractive,
  promptMigrationConfirm,
  promptUninstallPlan,
  loadState,
  saveState,
  updateHostState,
  removePath: (target: string) => {
    rmSync(target, { recursive: true, force: true });
  },
  asErrorMessage
};

function summarizeFailures(failures: Array<{ host: HostName; error: string }>, action: string): never {
  const lines = [
    `Failed to ${action} Lineup for ${failures.length} host(s):`,
    ...failures.map((failure) => `- ${failure.host}: ${failure.error}`)
  ];

  throw new CliError(lines.join("\n"), {
    code: `host_${action}_failed`
  });
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

export function createOperations(overrides: Partial<OperationsDeps> = {}) {
  const deps: OperationsDeps = {
    ...defaultDeps,
    ...overrides
  };

  async function shouldMigrateLegacyClaudeInstall(yes: boolean): Promise<boolean> {
    const legacyDetected = await deps.detectLegacyClaudeInstall();
    if (!legacyDetected) {
      return false;
    }

    if (yes) {
      return true;
    }

    if (!deps.isInteractive()) {
      throw new CliError(
        "Detected legacy Claude install (lineup@izantech). Re-run with --yes to migrate in non-interactive mode.",
        {
          code: "migration_confirmation_required"
        }
      );
    }

    const approved = await deps.promptMigrationConfirm();
    if (!approved) {
      throw new CliError("Migration cancelled by user.", {
        code: "migration_cancelled"
      });
    }

    return true;
  }

  async function performInstallOrUpdate(input: {
    action: "install" | "update";
    hosts: HostName[];
    version?: string;
    fromDir?: string;
    yes: boolean;
  }): Promise<InstallUpdateResult> {
    const release = input.fromDir
      ? deps.resolveLocalRelease(input.fromDir)
      : await deps.resolveRelease({ version: input.version });
    deps.validateSourceBundle(release.sourceRoot);

    const state = deps.loadState();
    const failures: Array<{ host: HostName; error: string }> = [];
    const results: HostActionResult[] = [];

    const migrateLegacyClaude = input.hosts.includes("claude")
      ? await shouldMigrateLegacyClaudeInstall(input.yes)
      : false;

    for (const host of input.hosts) {
      try {
        if (host === "claude") {
          const pluginSource = deps.prepareClaudePluginFromSource(release.sourceRoot, release.tag);
          await deps.installClaudeFromPreparedPlugin({
            pluginSource,
            version: release.tag,
            migrateLegacy: migrateLegacyClaude
          });

          if (input.action === "update") {
            await deps.updateClaudeLocal();
          }

          deps.updateHostState(state, "claude", {
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
          const codexResult = deps.installCodex({
            sourceRoot: release.sourceRoot,
            workspaceRoot: deps.codexHostRoot(),
            global: true
          });

          deps.updateHostState(state, "codex", {
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
        const message = deps.asErrorMessage(error);
        failures.push({ host, error: message });
        results.push({
          host,
          ok: false,
          message
        });
      }
    }

    deps.saveState(state);

    if (failures.length > 0) {
      summarizeFailures(failures, input.action);
    }

    return {
      action: input.action,
      tag: release.tag,
      results
    };
  }

  async function performUninstall(input: {
    hosts: HostName[];
    yes: boolean;
    purge: boolean;
  }): Promise<UninstallResult> {
    let purge = input.purge;

    if (!input.yes) {
      if (!deps.isInteractive()) {
        throw new CliError("Uninstall requires confirmation in interactive mode. Use --yes for non-interactive execution.", {
          code: "uninstall_confirmation_required"
        });
      }

      const plan = await deps.promptUninstallPlan(input.hosts);
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

    const state = deps.loadState();
    const failures: Array<{ host: HostName; error: string }> = [];
    const results: HostActionResult[] = [];

    for (const host of input.hosts) {
      try {
        if (host === "claude") {
          await deps.uninstallClaude();
          deps.updateHostState(state, "claude", {
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
          deps.uninstallCodex(true);
          deps.updateHostState(state, "codex", {
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
        const message = deps.asErrorMessage(error);
        failures.push({ host, error: message });
        results.push({ host, ok: false, message });
      }
    }

    const purged: string[] = [];
    if (purge) {
      const targets = deps.purgeTargets(input.hosts);
      for (const target of targets) {
        deps.removePath(target);
        purged.push(target);
      }
    }

    deps.saveState(state);

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

  async function readStatus(hosts: HostName[]): Promise<StatusOutput> {
    const state = deps.loadState();

    const outputHosts: Partial<Record<HostName, StatusHost>> = {};

    for (const host of hosts) {
      if (host === "claude") {
        const runtime = await deps.statusClaude();
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
        const runtime = deps.statusCodex(true);
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
      state_file: deps.lineupStateFile(),
      hosts: outputHosts
    };
  }

  return {
    performInstallOrUpdate,
    performUninstall,
    readStatus
  };
}

const operations = createOperations();

export const performInstallOrUpdate = operations.performInstallOrUpdate;
export const performUninstall = operations.performUninstall;
export const readStatus = operations.readStatus;
