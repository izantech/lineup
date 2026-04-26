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

export function lineupHome(homeDir = os.homedir()): string {
  return path.join(homeDir, ".lineup");
}

export function lineupStateFile(homeDir = os.homedir()): string {
  return path.join(lineupHome(homeDir), "state.json");
}

export function lineupCacheDir(homeDir = os.homedir()): string {
  return path.join(lineupHome(homeDir), "cache");
}

export function codexGlobalSkillsDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ".codex", "skills");
}

export function codexLegacyGlobalSkillsDir(homeDir = os.homedir()): string {
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

export function codexAgentsDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ".codex", "agents");
}

export function opencodeAgentsDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ".config", "opencode", "agents");
}

export function opencodeLineupConfigPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".config", "opencode", "lineup", "install-config.yaml");
}

export function claudeLineupConfigPath(homeDir: string): string {
  return path.join(homeDir, ".claude", "lineup", "install-config.yaml");
}

export function codexLineupConfigPath(homeDir: string): string {
  return path.join(homeDir, ".codex", "lineup", "install-config.yaml");
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
