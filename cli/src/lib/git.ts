import { execSync } from "node:child_process";

export type GitProjectStatus = {
  isRepository: boolean;
  hasHeadCommit: boolean;
  treeSha?: string;
};

function canRunGit(projectRoot: string, command: string): string | undefined {
  try {
    return execSync(command, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export function inspectGitProject(projectRoot: string): GitProjectStatus {
  const insideWorkTree = canRunGit(projectRoot, "git rev-parse --is-inside-work-tree");
  if (insideWorkTree !== "true") {
    return {
      isRepository: false,
      hasHeadCommit: false
    };
  }

  const headCommit = canRunGit(projectRoot, "git rev-parse --verify HEAD^{commit}");
  const treeSha = headCommit ? canRunGit(projectRoot, "git rev-parse HEAD^{tree}") : undefined;

  return {
    isRepository: true,
    hasHeadCommit: Boolean(headCommit),
    treeSha
  };
}

export function initializeGitRepository(projectRoot: string): void {
  execSync("git init", {
    cwd: projectRoot,
    stdio: ["ignore", "ignore", "ignore"]
  });
}
