import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, copyFileSync, chmodSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

import { CliError } from "./errors";
import { assertSuccess, runCommand } from "./process";

export type GitRepoContext = {
  repoRoot: string;
  worktreeRoot: string;
};

function normalizeRelativePath(input: string): string {
  if (input.trim().length === 0) {
    throw new CliError("Path cannot be empty.", {
      code: "invalid_path"
    });
  }

  if (isAbsolute(input)) {
    throw new CliError(`Absolute path is not allowed: ${input}`, {
      code: "invalid_path"
    });
  }

  const normalized = normalize(input).replaceAll("\\", "/");
  if (normalized === "." || normalized === "") {
    throw new CliError(`Path resolves to an empty relative path: ${input}`, {
      code: "invalid_path"
    });
  }

  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new CliError(`Path escapes the workspace: ${input}`, {
      code: "invalid_path"
    });
  }

  return normalized;
}

export function normalizeExclusionPaths(paths: readonly string[]): string[] {
  return paths.map((path) => normalizeRelativePath(path));
}

export async function resolveGitRepositoryRoot(workspaceRoot: string): Promise<string> {
  const result = await runCommand("git", ["-C", workspaceRoot, "rev-parse", "--show-toplevel"]);
  assertSuccess(result, `git rev-parse --show-toplevel for ${workspaceRoot}`);
  return result.stdout.trim();
}

export async function ensureWorktreeParent(worktreeRoot: string): Promise<void> {
  mkdirSync(dirname(worktreeRoot), { recursive: true });
}

export async function createDetachedWorktree(repoRoot: string, worktreeRoot: string): Promise<void> {
  await ensureWorktreeParent(worktreeRoot);
  if (existsSync(worktreeRoot)) {
    rmSync(worktreeRoot, { recursive: true, force: true });
  }

  const result = await runCommand("git", ["-C", repoRoot, "worktree", "add", "--detach", worktreeRoot, "HEAD"]);
  assertSuccess(result, `git worktree add for ${worktreeRoot}`);
}

export async function removeDetachedWorktree(repoRoot: string, worktreeRoot: string): Promise<void> {
  if (existsSync(worktreeRoot)) {
    const result = await runCommand("git", ["-C", repoRoot, "worktree", "remove", "--force", worktreeRoot]);
    assertSuccess(result, `git worktree remove for ${worktreeRoot}`);
  }

  const pruneResult = await runCommand("git", ["-C", repoRoot, "worktree", "prune"]);
  assertSuccess(pruneResult, `git worktree prune for ${repoRoot}`);
}

export async function pruneStaleWorktrees(repoRoot: string): Promise<void> {
  const result = await runCommand("git", ["-C", repoRoot, "worktree", "prune"]);
  assertSuccess(result, `git worktree prune for ${repoRoot}`);
}

export async function enableSparseCheckout(worktreeRoot: string, paths: readonly string[]): Promise<void> {
  const normalized = normalizeExclusionPaths(paths);
  const initResult = await runCommand("git", ["-C", worktreeRoot, "sparse-checkout", "init", "--no-cone"]);
  assertSuccess(initResult, `git sparse-checkout init for ${worktreeRoot}`);

  const setResult = await runCommand("git", [
    "-C",
    worktreeRoot,
    "sparse-checkout",
    "set",
    "--no-cone",
    "--skip-checks",
    ...normalized
  ]);
  assertSuccess(setResult, `git sparse-checkout set for ${worktreeRoot}`);
}

export function mirrorDirectory(
  sourceDir: string,
  destinationDir: string,
  excludedPaths: readonly string[] = []
): void {
  const normalizedExclusions = excludedPaths.map((entry) => normalizeRelativePath(entry));
  mkdirSync(destinationDir, { recursive: true });

  const sourceEntries = new Set<string>();
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const name = entry.name;
    const relativePath = name;
    if (normalizedExclusions.includes(relativePath)) {
      continue;
    }

    sourceEntries.add(name);
    const sourcePath = join(sourceDir, name);
    const destinationPath = join(destinationDir, name);
    mirrorEntry(sourcePath, destinationPath, normalizedExclusions, relativePath);
  }

  for (const entry of readdirSync(destinationDir, { withFileTypes: true })) {
    const name = entry.name;
    if (normalizedExclusions.includes(name)) {
      continue;
    }
    if (!sourceEntries.has(name)) {
      rmSync(join(destinationDir, name), { recursive: true, force: true });
    }
  }
}

function mirrorEntry(
  sourcePath: string,
  destinationPath: string,
  excludedPaths: readonly string[],
  relativePath: string
): void {
  const stat = lstatSync(sourcePath);
  if (excludedPaths.includes(relativePath)) {
    return;
  }

  if (stat.isDirectory()) {
    mkdirSync(destinationPath, { recursive: true });
    const sourceEntries = new Set<string>();
    for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
      sourceEntries.add(entry.name);
      const childRelative = join(relativePath, entry.name).replaceAll("\\", "/");
      if (excludedPaths.some((excluded) => childRelative === excluded || childRelative.startsWith(`${excluded}/`))) {
        continue;
      }
      mirrorEntry(join(sourcePath, entry.name), join(destinationPath, entry.name), excludedPaths, childRelative);
    }

    for (const entry of readdirSync(destinationPath, { withFileTypes: true })) {
      const childRelative = join(relativePath, entry.name).replaceAll("\\", "/");
      if (excludedPaths.some((excluded) => childRelative === excluded || childRelative.startsWith(`${excluded}/`))) {
        continue;
      }
      if (!sourceEntries.has(entry.name)) {
        rmSync(join(destinationPath, entry.name), { recursive: true, force: true });
      }
    }
    return;
  }

  if (stat.isSymbolicLink()) {
    const target = readlinkSync(sourcePath);
    rmSync(destinationPath, { force: true });
    symlinkSync(target, destinationPath);
    return;
  }

  if (stat.isFile()) {
    mkdirSync(dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
    chmodSync(destinationPath, stat.mode);
  }
}

export function isSubpath(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return relativePath !== "" && !relativePath.startsWith("..") && !relativePath.includes(`..${sep}`);
}

export function buildExcludedPaths(sourceRoot: string, worktreeRoot: string, extraExclusions: readonly string[] = []): string[] {
  const exclusions = new Set<string>([...normalizeExclusionPaths(extraExclusions), ".git"]);
  if (isSubpath(sourceRoot, worktreeRoot)) {
    exclusions.add(relative(sourceRoot, worktreeRoot).replaceAll("\\", "/"));
  }
  return [...exclusions];
}
