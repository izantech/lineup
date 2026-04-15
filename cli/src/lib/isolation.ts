import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { CliError } from "./errors";
import { lineupRunsDir } from "./paths";
import { assertSuccess, runCommand } from "./process.js";
import { loadPipelineState } from "./state";
import type { IsolationMode } from "./types.js";
import {
  buildExcludedPaths,
  createDetachedWorktree,
  enableSparseCheckout,
  isSubpath,
  mirrorDirectory,
  pruneStaleWorktrees,
  removeDetachedWorktree,
  resolveGitRepositoryRoot
} from "./worktree.js";

export type NativeIsolationMode = IsolationMode;

export type NativeIsolationOptions = {
  workspaceRoot: string;
  runId: string;
  mode: NativeIsolationMode;
  sparseEnabled?: boolean;
  sparsePaths?: string[];
  excludedPaths?: string[];
  runRoot?: string;
};

export type NativeIsolationWorkspace = {
  repoRoot: string;
  sourceRoot: string;
  runRoot: string;
  worktreeRoot: string;
  baselineHead: string;
  mode: NativeIsolationMode;
  cleanup: () => Promise<void>;
};

function resolveRunRoot(workspaceRoot: string, runId: string, runRoot?: string): string {
  return runRoot ?? resolve(workspaceRoot, ".lineup", ".runs", runId);
}

export async function createNativeIsolationWorkspace(options: NativeIsolationOptions): Promise<NativeIsolationWorkspace> {
  const repoRoot = await resolveGitRepositoryRoot(options.workspaceRoot);
  const sourceRoot = options.workspaceRoot;
  const runRoot = resolveRunRoot(sourceRoot, options.runId, options.runRoot);
  const worktreeRoot = resolve(runRoot, "worktree");

  await pruneInactiveIsolationWorktrees(sourceRoot, options.runId);
  if (existsSync(runRoot)) {
    rmSync(runRoot, { recursive: true, force: true });
  }

  mkdirSync(runRoot, { recursive: true });
  await pruneStaleWorktrees(repoRoot);
  await createDetachedWorktree(repoRoot, worktreeRoot);

  if (options.mode === "full") {
    const exclusions = buildExcludedPaths(sourceRoot, worktreeRoot, options.excludedPaths);
    mirrorDirectory(sourceRoot, worktreeRoot, exclusions);
  }

  if (options.mode === "sparse") {
    if (!options.sparseEnabled) {
      throw new CliError("Sparse isolation is disabled by default.", {
        code: "sparse_isolation_disabled"
      });
    }
    if (!options.sparsePaths || options.sparsePaths.length === 0) {
      throw new CliError("Sparse isolation requires at least one sparse path.", {
        code: "sparse_isolation_missing_paths"
      });
    }

    await enableSparseCheckout(worktreeRoot, options.sparsePaths);
  }

  const baselineHeadResult = await runCommand("git", ["-C", worktreeRoot, "rev-parse", "HEAD"]);
  assertSuccess(baselineHeadResult, `git rev-parse HEAD for ${worktreeRoot}`);
  const baselineHead = baselineHeadResult.stdout.trim();

  return {
    repoRoot,
    sourceRoot,
    runRoot,
    worktreeRoot,
    baselineHead,
    mode: options.mode,
    cleanup: async () => {
      await removeDetachedWorktree(repoRoot, worktreeRoot);
      if (existsSync(runRoot)) {
        rmSync(runRoot, { recursive: true, force: true });
      }
    }
  };
}

export async function cleanupNativeIsolationWorkspace(workspace: NativeIsolationWorkspace): Promise<void> {
  await workspace.cleanup();
}

export async function cleanupStaleNativeIsolationRun(runRoot: string): Promise<void> {
  if (existsSync(runRoot)) {
    rmSync(runRoot, { recursive: true, force: true });
  }
}

export async function pruneInactiveIsolationWorktrees(workspaceRoot: string, activeRunId?: string): Promise<void> {
  const runsDir = lineupRunsDir(workspaceRoot);
  if (!existsSync(runsDir)) {
    return;
  }

  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (activeRunId && entry.name === activeRunId) {
      continue;
    }

    const state = loadPipelineState(entry.name, workspaceRoot);
    if (!state || ["succeeded", "failed", "canceled"].includes(state.status)) {
      await cleanupStaleNativeIsolationRun(resolve(runsDir, entry.name));
    }
  }
}

export { buildExcludedPaths, isSubpath, resolveGitRepositoryRoot } from "./worktree.js";
