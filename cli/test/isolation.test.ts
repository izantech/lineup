import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { createNativeIsolationWorkspace, cleanupNativeIsolationWorkspace } from "../src/lib/isolation.js";
import { cleanupStaleNativeIsolationRun, resolveGitRepositoryRoot } from "../src/lib/isolation.js";
import { buildExcludedPaths } from "../src/lib/worktree.js";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function initRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "lineup-isolation-"));
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Lineup Test"]);
  writeFileSync(join(root, "tracked.txt"), "tracked\n");
  mkdirSync(join(root, "nested"), { recursive: true });
  writeFileSync(join(root, "nested", "file.txt"), "nested\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "init"]);
  return root;
}

describe("native isolation", () => {
  let repoRoot: string;
  let runRoot: string;

  beforeEach(() => {
    repoRoot = initRepo();
    runRoot = join(repoRoot, ".lineup", ".runs", "run-123");
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("resolves the git repository root", async () => {
    const resolved = await resolveGitRepositoryRoot(repoRoot);
    expect(resolved).toBe(realpathSync(repoRoot));
  });

  it("creates and cleans up an index isolation worktree", async () => {
    const workspace = await createNativeIsolationWorkspace({
      workspaceRoot: repoRoot,
      runId: "run-123",
      runRoot,
      mode: "index"
    });

    expect(workspace.mode).toBe("index");
    expect(existsSync(workspace.worktreeRoot)).toBe(true);
    expect(readFileSync(join(workspace.worktreeRoot, "tracked.txt"), "utf8")).toContain("tracked");

    await cleanupNativeIsolationWorkspace(workspace);
    expect(existsSync(workspace.worktreeRoot)).toBe(false);
    expect(existsSync(runRoot)).toBe(false);
  });

  it("mirrors untracked files for full isolation", async () => {
    writeFileSync(join(repoRoot, "untracked.txt"), "untracked\n");

    const workspace = await createNativeIsolationWorkspace({
      workspaceRoot: repoRoot,
      runId: "run-123",
      runRoot,
      mode: "full"
    });

    expect(readFileSync(join(workspace.worktreeRoot, "untracked.txt"), "utf8")).toContain("untracked");

    await cleanupNativeIsolationWorkspace(workspace);
  });

  it("rejects sparse isolation unless explicitly enabled", async () => {
    await expect(
      createNativeIsolationWorkspace({
        workspaceRoot: repoRoot,
        runId: "run-123",
        runRoot,
        mode: "sparse",
        sparsePaths: ["nested"]
      })
    ).rejects.toThrow(/disabled by default/i);
  });

  it("supports gated sparse isolation", async () => {
    const workspace = await createNativeIsolationWorkspace({
      workspaceRoot: repoRoot,
      runId: "run-123",
      runRoot,
      mode: "sparse",
      sparseEnabled: true,
      sparsePaths: ["nested"]
    });

    expect(existsSync(join(workspace.worktreeRoot, "nested", "file.txt"))).toBe(true);
    expect(existsSync(join(workspace.worktreeRoot, "tracked.txt"))).toBe(false);

    await cleanupNativeIsolationWorkspace(workspace);
  });

  it("cleans only the scoped run directory", async () => {
    mkdirSync(join(repoRoot, ".lineup", ".runs", "other-run"), { recursive: true });
    writeFileSync(join(repoRoot, ".lineup", ".runs", "other-run", "keep.txt"), "keep\n");
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(join(runRoot, "stale.txt"), "stale\n");

    await cleanupStaleNativeIsolationRun(runRoot);

    expect(existsSync(runRoot)).toBe(false);
    expect(existsSync(join(repoRoot, ".lineup", ".runs", "other-run", "keep.txt"))).toBe(true);
  });

  it("builds exclusions without allowing escapes", () => {
    expect(buildExcludedPaths(repoRoot, join(repoRoot, ".lineup", ".runs", "run-123"), ["node_modules"])).toContain(".git");
  });
});
