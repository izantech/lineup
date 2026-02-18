import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
  const file = fileURLToPath(import.meta.url);
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
  return path.join(homeDir, ".agents", "skills");
}

export function claudeHostRoot(homeDir = os.homedir()): string {
  return path.join(lineupHome(homeDir), "hosts", "claude");
}

export function codexHostRoot(homeDir = os.homedir()): string {
  return path.join(lineupHome(homeDir), "hosts", "codex");
}

export function claudeManagedPluginDir(version: string, homeDir = os.homedir()): string {
  return path.join(claudeHostRoot(homeDir), "plugins", "lineup", version);
}

export function claudeMarketplaceRoot(homeDir = os.homedir()): string {
  return path.join(claudeHostRoot(homeDir), "marketplace");
}

export function codexRepoLocalSkillsDir(cwd = process.cwd()): string {
  return path.join(cwd, ".agents", "skills");
}

export function purgeTargets(hosts: ReadonlyArray<"claude" | "codex">, homeDir = os.homedir()): string[] {
  const targets: string[] = [];

  if (hosts.includes("claude")) {
    targets.push(path.join(homeDir, ".claude", "lineup", "agents"));
  }

  if (hosts.includes("codex")) {
    targets.push(path.join(homeDir, ".codex", "lineup", "agents"));
    targets.push(path.join(homeDir, ".codex", "lineup", "memory"));
  }

  return targets;
}
