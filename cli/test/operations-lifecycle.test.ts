import { describe, expect, it } from "vitest";

import type { HostName } from "../src/lib/constants";
import { CliError } from "../src/lib/errors";
import { createOperations, type OperationsDeps } from "../src/lib/operations";
import type { InstallerState } from "../src/lib/types";

type HarnessCalls = {
  resolveReleaseInputs: Array<{ version?: string }>;
  validateSourceBundleInputs: string[];
  detectLegacyClaudeInstall: number;
  prepareClaudePluginFromSourceInputs: Array<{ sourceRoot: string; version: string }>;
  installClaudeFromPreparedPluginInputs: Array<{ pluginSource: string; version: string; migrateLegacy: boolean }>;
  updateClaudeLocal: number;
  installCodexInputs: Array<{ sourceRoot: string; workspaceRoot: string; global?: boolean }>;
  installOpencodeInputs: Array<{ sourceRoot: string; homeDir: string }>;
  uninstallClaude: number;
  uninstallCodexInputs: Array<boolean | undefined>;
  uninstallOpencodeInputs: string[];
  statusCodexInputs: Array<boolean | undefined>;
  statusOpencodeInputs: string[];
  loadState: number;
  saveState: number;
  updateHostState: Array<{ host: HostName; patch: Record<string, unknown> }>;
  promptUninstallPlanInputs: HostName[][];
  purgeTargetsInputs: HostName[][];
  removePathTargets: string[];
};

function createHarness(overrides: Partial<OperationsDeps> = {}): {
  deps: OperationsDeps;
  state: InstallerState;
  calls: HarnessCalls;
} {
  const state: InstallerState = {
    schema_version: 1,
    updated_at: null,
    hosts: {}
  };

  const calls: HarnessCalls = {
    resolveReleaseInputs: [],
    validateSourceBundleInputs: [],
    detectLegacyClaudeInstall: 0,
    prepareClaudePluginFromSourceInputs: [],
    installClaudeFromPreparedPluginInputs: [],
    updateClaudeLocal: 0,
    installCodexInputs: [],
    installOpencodeInputs: [],
    uninstallClaude: 0,
    uninstallCodexInputs: [],
    uninstallOpencodeInputs: [],
    statusCodexInputs: [],
    statusOpencodeInputs: [],
    loadState: 0,
    saveState: 0,
    updateHostState: [],
    promptUninstallPlanInputs: [],
    purgeTargetsInputs: [],
    removePathTargets: []
  };

  const deps: OperationsDeps = {
    resolveRelease: async (input = {}) => {
      calls.resolveReleaseInputs.push(input);
      return {
        tag: input.version ?? "v2.0.0",
        sourceRoot: "/tmp/release-source",
        cacheDir: "/tmp/release-cache",
        manifest: {
          tag: input.version ?? "v2.0.0",
          tarball_url: "https://example.com/release.tgz",
          sha256: "abc123"
        }
      };
    },
    resolveLocalRelease: (dirPath: string) => ({
      tag: "v2.0.0",
      sourceRoot: dirPath,
      cacheDir: dirPath,
      manifest: { tag: "v2.0.0", tarball_url: "local", sha256: "local" }
    }),
    validateSourceBundle: (sourceRoot: string) => {
      calls.validateSourceBundleInputs.push(sourceRoot);
    },
    detectLegacyClaudeInstall: async () => {
      calls.detectLegacyClaudeInstall += 1;
      return false;
    },
    installClaudeFromPreparedPlugin: async (input) => {
      calls.installClaudeFromPreparedPluginInputs.push(input);
    },
    prepareClaudePluginFromSource: (sourceRoot, version) => {
      calls.prepareClaudePluginFromSourceInputs.push({ sourceRoot, version });
      return "/tmp/generated-claude-plugin";
    },
    statusClaude: async () => ({
      host: "claude",
      installed: false,
      version: null,
      source: null,
      last_action: null,
      error: "Required command not found: claude"
    }),
    uninstallClaude: async () => {
      calls.uninstallClaude += 1;
    },
    updateClaudeLocal: async () => {
      calls.updateClaudeLocal += 1;
    },
    installCodex: (input) => {
      calls.installCodexInputs.push(input);
      return {
        skills_dir: "/tmp/codex-skills",
        files_verified: 5
      };
    },
    statusCodex: (global) => {
      calls.statusCodexInputs.push(global);
      return {
        host: "codex",
        installed: false,
        version: null,
        source: null,
        last_action: null,
        error: "Missing 5 required files."
      };
    },
    uninstallCodex: (global) => {
      calls.uninstallCodexInputs.push(global);
      return {
        skills_dir: "/tmp/codex-skills"
      };
    },
    codexHostRoot: () => "/tmp/codex-host",
    installOpencode: (sourceRoot, homeDir) => {
      calls.installOpencodeInputs.push({ sourceRoot, homeDir });
      return {
        skills_dir: "/tmp/opencode-skills",
        files_verified: 5
      };
    },
    statusOpencode: (homeDir) => {
      calls.statusOpencodeInputs.push(homeDir);
      return {
        host: "opencode",
        installed: false,
        version: null,
        source: null,
        last_action: null,
        error: "Missing 5 required files."
      };
    },
    uninstallOpencode: (homeDir) => {
      calls.uninstallOpencodeInputs.push(homeDir);
      return {
        skills_dir: "/tmp/opencode-skills"
      };
    },
    opencodeHostRoot: () => "/tmp/opencode-home",
    homeDir: () => "/tmp/opencode-home",
    lineupStateFile: () => "/tmp/lineup-state.json",
    purgeTargets: (hosts) => {
      calls.purgeTargetsInputs.push([...hosts]);
      return ["/tmp/purge-a", "/tmp/purge-b"];
    },
    isInteractive: () => false,
    promptMigrationConfirm: async () => true,
    promptUninstallPlan: async (hosts) => {
      calls.promptUninstallPlanInputs.push([...hosts]);
      return {
        proceed: true,
        purge: false
      };
    },
    loadState: () => {
      calls.loadState += 1;
      return state;
    },
    saveState: (nextState) => {
      calls.saveState += 1;
      state.updated_at = nextState.updated_at;
      state.hosts = nextState.hosts;
      return nextState;
    },
    updateHostState: (nextState, host, patch) => {
      calls.updateHostState.push({ host, patch: { ...(patch as Record<string, unknown>) } });

      const previous = nextState.hosts[host] ?? {
        installed: false,
        last_action: null,
        last_updated_at: null
      };

      nextState.hosts[host] = {
        ...previous,
        ...patch,
        last_updated_at: "2026-02-18T00:00:00.000Z"
      };

      return nextState;
    },
    removePath: (target: string) => {
      calls.removePathTargets.push(target);
    },
    asErrorMessage: (error: unknown) => {
      if (error instanceof Error) {
        return error.message;
      }

      return String(error);
    }
  };

  return {
    deps: {
      ...deps,
      ...overrides
    },
    state,
    calls
  };
}

describe("operations lifecycle flows", () => {
  it("installs claude and codex successfully", async () => {
    const harness = createHarness();
    const operations = createOperations(harness.deps);

    const result = await operations.performInstallOrUpdate({
      action: "install",
      hosts: ["claude", "codex"],
      version: "v2.0.0",
      yes: true
    });

    expect(harness.calls.resolveReleaseInputs).toEqual([{ version: "v2.0.0" }]);
    expect(harness.calls.validateSourceBundleInputs).toEqual(["/tmp/release-source"]);
    expect(harness.calls.detectLegacyClaudeInstall).toBe(1);
    expect(harness.calls.prepareClaudePluginFromSourceInputs).toEqual([
      {
        sourceRoot: "/tmp/release-source",
        version: "v2.0.0"
      }
    ]);
    expect(harness.calls.installClaudeFromPreparedPluginInputs).toEqual([
      {
        pluginSource: "/tmp/generated-claude-plugin",
        version: "v2.0.0",
        migrateLegacy: false
      }
    ]);
    expect(harness.calls.installCodexInputs).toEqual([
      {
        sourceRoot: "/tmp/release-source",
        workspaceRoot: "/tmp/codex-host",
        global: true
      }
    ]);
    expect(harness.calls.saveState).toBe(1);

    expect(harness.state.hosts.claude?.installed).toBe(true);
    expect(harness.state.hosts.codex?.installed).toBe(true);
    expect(harness.state.hosts.claude?.last_action).toBe("install");
    expect(harness.state.hosts.codex?.last_action).toBe("install");

    expect(result).toEqual({
      action: "install",
      tag: "v2.0.0",
      results: [
        {
          host: "claude",
          ok: true,
          message: "Claude install complete (v2.0.0)."
        },
        {
          host: "codex",
          ok: true,
          message: "Codex install complete (v2.0.0)."
        }
      ]
    });
  });

  it("updates claude and records update action", async () => {
    const harness = createHarness();
    const operations = createOperations(harness.deps);

    const result = await operations.performInstallOrUpdate({
      action: "update",
      hosts: ["claude"],
      yes: true
    });

    expect(harness.calls.updateClaudeLocal).toBe(1);
    expect(harness.state.hosts.claude?.last_action).toBe("update");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.message).toContain("Claude update complete");
  });

  it("aggregates host install failures and still saves state", async () => {
    const harness = createHarness();
    harness.deps.installCodex = (input) => {
      harness.calls.installCodexInputs.push(input);
      throw new Error("codex install failed");
    };

    const operations = createOperations(harness.deps);

    try {
      await operations.performInstallOrUpdate({
        action: "install",
        hosts: ["claude", "codex"],
        yes: true
      });
      throw new Error("Expected install to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const cliError = error as CliError;
      expect(cliError.code).toBe("host_install_failed");
      expect(cliError.message).toContain("- codex: codex install failed");
    }

    expect(harness.calls.installClaudeFromPreparedPluginInputs).toHaveLength(1);
    expect(harness.calls.installCodexInputs).toHaveLength(1);
    expect(harness.calls.saveState).toBe(1);
    expect(harness.state.hosts.claude?.installed).toBe(true);
    expect(harness.state.hosts.codex).toBeUndefined();
  });

  it("requires --yes for non-interactive uninstall", async () => {
    const harness = createHarness();
    const operations = createOperations(harness.deps);

    await expect(
      operations.performUninstall({
        hosts: ["claude"],
        yes: false,
        purge: false
      })
    ).rejects.toMatchObject({
      code: "uninstall_confirmation_required"
    });

    expect(harness.calls.uninstallClaude).toBe(0);
    expect(harness.calls.saveState).toBe(0);
  });

  it("returns cancelled when interactive uninstall is declined", async () => {
    const harness = createHarness({
      isInteractive: () => true,
      promptUninstallPlan: async (hosts) => {
        harness.calls.promptUninstallPlanInputs.push([...hosts]);
        return {
          proceed: false,
          purge: false
        };
      }
    });

    const operations = createOperations(harness.deps);
    const result = await operations.performUninstall({
      hosts: ["claude", "codex"],
      yes: false,
      purge: false
    });

    expect(result).toEqual({
      action: "uninstall",
      cancelled: true,
      purged_paths: [],
      results: []
    });

    expect(harness.calls.promptUninstallPlanInputs).toEqual([["claude", "codex"]]);
    expect(harness.calls.loadState).toBe(0);
    expect(harness.calls.saveState).toBe(0);
  });

  it("purges configured paths during uninstall", async () => {
    const harness = createHarness();
    const operations = createOperations(harness.deps);

    const result = await operations.performUninstall({
      hosts: ["claude", "codex"],
      yes: true,
      purge: true
    });

    expect(harness.calls.uninstallClaude).toBe(1);
    expect(harness.calls.uninstallCodexInputs).toEqual([true]);
    expect(harness.calls.purgeTargetsInputs).toEqual([["claude", "codex"]]);
    expect(harness.calls.removePathTargets).toEqual(["/tmp/purge-a", "/tmp/purge-b"]);
    expect(harness.calls.saveState).toBe(1);

    expect(result.cancelled).toBe(false);
    expect(result.purged_paths).toEqual(["/tmp/purge-a", "/tmp/purge-b"]);
  });

  it("installs opencode successfully", async () => {
    const harness = createHarness();
    const operations = createOperations(harness.deps);

    const result = await operations.performInstallOrUpdate({
      action: "install",
      hosts: ["opencode"],
      version: "v2.0.0",
      yes: true
    });

    expect(harness.calls.installOpencodeInputs).toEqual([
      { sourceRoot: "/tmp/release-source", homeDir: "/tmp/opencode-home" }
    ]);
    expect(harness.calls.saveState).toBe(1);
    expect(harness.state.hosts.opencode?.installed).toBe(true);
    expect(harness.state.hosts.opencode?.last_action).toBe("install");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.message).toContain("OpenCode install complete");
  });

  it("uninstalls opencode successfully", async () => {
    const harness = createHarness();
    const operations = createOperations(harness.deps);

    const result = await operations.performUninstall({
      hosts: ["opencode"],
      yes: true,
      purge: false
    });

    expect(harness.calls.uninstallOpencodeInputs).toEqual(["/tmp/opencode-home"]);
    expect(harness.calls.saveState).toBe(1);
    expect(result.cancelled).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.host).toBe("opencode");
    expect(result.results[0]?.ok).toBe(true);
  });

  it("reads opencode status", async () => {
    const harness = createHarness();
    const operations = createOperations(harness.deps);

    const output = await operations.readStatus(["opencode"]);

    expect(harness.calls.statusOpencodeInputs).toEqual(["/tmp/opencode-home"]);
    expect(output.hosts.opencode).toMatchObject({
      host: "opencode",
      installed: false
    });
  });

  it("merges runtime status with state fallbacks", async () => {
    const harness = createHarness();
    harness.state.hosts = {
      claude: {
        installed: true,
        version: "v1.2.3",
        source: "state-source",
        last_action: "update",
        last_updated_at: "2026-02-18T00:00:00.000Z"
      },
      codex: {
        installed: true,
        version: "v9.9.9",
        source: "cli-managed",
        skills_dir: "/tmp/skills",
        last_action: "install",
        last_updated_at: "2026-02-18T00:00:00.000Z"
      }
    };

    harness.deps.statusClaude = async () => ({
      host: "claude",
      installed: true,
      version: null,
      source: "runtime-source",
      last_action: null
    });

    harness.deps.statusCodex = (global) => {
      harness.calls.statusCodexInputs.push(global);
      return {
        host: "codex",
        installed: false,
        version: null,
        source: null,
        last_action: null,
        error: "Missing 5 required files."
      };
    };

    const operations = createOperations(harness.deps);
    const output = await operations.readStatus(["claude", "codex"]);

    expect(output.schema_version).toBe(1);
    expect(output.state_file).toBe("/tmp/lineup-state.json");
    expect(output.hosts.claude).toEqual({
      host: "claude",
      installed: true,
      version: "v1.2.3",
      source: "runtime-source",
      last_action: "update"
    });
    expect(output.hosts.codex).toEqual({
      host: "codex",
      installed: false,
      version: "v9.9.9",
      source: "cli-managed",
      last_action: "install",
      error: "Missing 5 required files."
    });
    expect(harness.calls.statusCodexInputs).toEqual([true]);
  });
});
