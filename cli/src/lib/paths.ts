import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
  const file = fileURLToPath(import.meta.url);
  let current = path.dirname(file);
  const filesystemRoot = path.parse(current).root;

  while (true) {
    const candidate = path.join(current, "package.json");
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
        if (parsed.name === "@izantech/lineup-cli") {
          return current;
        }
      } catch {
        // Continue walking when package.json is unreadable or invalid.
      }
    }

    if (current === filesystemRoot) {
      break;
    }
    current = path.dirname(current);
  }

  return path.resolve(path.dirname(file), "..", "..");
}

export function projectRoot(cwd = process.cwd()): string {
  return cwd;
}

export function lineupProjectRoot(cwd = process.cwd()): string {
  return path.join(projectRoot(cwd), ".lineup");
}

export function lineupRunsDir(cwd = process.cwd()): string {
  return path.join(lineupProjectRoot(cwd), ".runs");
}

export function lineupRunDir(runId: string, cwd = process.cwd()): string {
  return path.join(lineupRunsDir(cwd), runId);
}

export function lineupRunArtifactsDir(runId: string, cwd = process.cwd()): string {
  return path.join(lineupRunDir(runId, cwd), "artifacts");
}

export function lineupRunBridgeDir(runId: string, cwd = process.cwd()): string {
  return path.join(lineupRunDir(runId, cwd), "bridge");
}

export function lineupRunBridgeSessionFile(runId: string, cwd = process.cwd()): string {
  return path.join(lineupRunBridgeDir(runId, cwd), "session.json");
}

export function lineupRunBridgeEventsFile(runId: string, cwd = process.cwd()): string {
  return path.join(lineupRunBridgeDir(runId, cwd), "events.ndjson");
}

export function lineupRunBridgeStdoutLogFile(runId: string, cwd = process.cwd()): string {
  return path.join(lineupRunBridgeDir(runId, cwd), "stdout.log");
}

export function lineupRunBridgeStderrLogFile(runId: string, cwd = process.cwd()): string {
  return path.join(lineupRunBridgeDir(runId, cwd), "stderr.log");
}

export function lineupRunStateFile(runId: string, cwd = process.cwd()): string {
  return path.join(lineupRunDir(runId, cwd), "pipeline-state.json");
}

export function lineupRunDebugBundleFile(runId: string, cwd = process.cwd()): string {
  return path.join(lineupRunDir(runId, cwd), "debug-bundle.json");
}

export function lineupArtifactStoreDir(cwd = process.cwd()): string {
  return path.join(lineupProjectRoot(cwd), ".artifacts");
}

export function lineupRuntimeLockFile(cwd = process.cwd()): string {
  return path.join(lineupProjectRoot(cwd), "runtime.lock");
}

export function lineupHome(homeDir = os.homedir()): string {
  return path.join(homeDir, ".lineup");
}

export function lineupUserConfigDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ".config", "lineup");
}

export function lineupTuiConfigFile(homeDir = os.homedir()): string {
  return path.join(lineupUserConfigDir(homeDir), "tui.json");
}

export function lineupStateFile(homeDir = os.homedir()): string {
  return path.join(lineupHome(homeDir), "state.json");
}

export function lineupCacheDir(homeDir = os.homedir()): string {
  return path.join(lineupHome(homeDir), "cache");
}

export function codexGlobalSkillsDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ".agents", "skills");
}

export function claudeHostRoot(homeDir = os.homedir()): string {
  return path.join(lineupHome(homeDir), "hosts", "claude");
}

export function codexHostRoot(homeDir = os.homedir()): string {
  return path.join(lineupHome(homeDir), "hosts", "codex");
}

export function opencodeGlobalSkillsDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ".config", "opencode", "skills");
}

export function opencodeHostRoot(homeDir = os.homedir()): string {
  return path.join(lineupHome(homeDir), "hosts", "opencode");
}

export function claudeManagedPluginDir(version: string, homeDir = os.homedir()): string {
  return path.join(claudeMarketplaceRoot(homeDir), "plugins", "lineup", version);
}

export function claudeMarketplaceRoot(homeDir = os.homedir()): string {
  return path.join(claudeHostRoot(homeDir), "marketplace");
}

export function codexRepoLocalSkillsDir(cwd = process.cwd()): string {
  return path.join(cwd, ".agents", "skills");
}

export function purgeTargets(hosts: ReadonlyArray<"claude" | "codex" | "opencode">, homeDir = os.homedir()): string[] {
  const targets: string[] = [];

  if (hosts.includes("claude")) {
    targets.push(path.join(homeDir, ".claude", "lineup", "agents"));
  }

  if (hosts.includes("codex")) {
    targets.push(path.join(homeDir, ".codex", "lineup", "agents"));
    targets.push(path.join(homeDir, ".codex", "lineup", "memory"));
  }

  if (hosts.includes("opencode")) {
    targets.push(path.join(homeDir, ".config", "opencode", "lineup"));
  }

  return targets;
}

export function agentOverridesDir(host: "claude" | "codex" | "opencode", homeDir = os.homedir()): string {
  switch (host) {
    case "claude":
      return path.join(homeDir, ".claude", "lineup", "agents");
    case "codex":
      return path.join(homeDir, ".codex", "lineup", "agents");
    case "opencode":
      return path.join(homeDir, ".config", "opencode", "lineup", "agents");
  }
}
