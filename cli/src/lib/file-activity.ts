import { existsSync, readdirSync, statSync } from "node:fs";

export type FileActivitySnapshot = Record<
  string,
  {
    size: number;
    mtimeMs: number;
  }
>;

export function listImmediateFiles(root: string | undefined): string[] {
  if (!root || !existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${root}/${entry.name}`)
    .sort();
}

export function captureFileActivity(paths: string[]): FileActivitySnapshot {
  const snapshot: FileActivitySnapshot = {};

  for (const filePath of [...new Set(paths)].sort()) {
    if (!existsSync(filePath)) {
      continue;
    }

    const stats = statSync(filePath);
    if (!stats.isFile()) {
      continue;
    }

    snapshot[filePath] = {
      size: stats.size,
      mtimeMs: stats.mtimeMs
    };
  }

  return snapshot;
}

export function hasFileActivity(previous: FileActivitySnapshot, current: FileActivitySnapshot): boolean {
  const previousPaths = Object.keys(previous).sort();
  const currentPaths = Object.keys(current).sort();

  if (previousPaths.length !== currentPaths.length) {
    return true;
  }

  for (let index = 0; index < currentPaths.length; index += 1) {
    const currentPath = currentPaths[index];
    if (currentPath !== previousPaths[index]) {
      return true;
    }

    const prior = previous[currentPath];
    const next = current[currentPath];
    if (!prior || !next) {
      return true;
    }

    if (prior.size !== next.size || prior.mtimeMs !== next.mtimeMs) {
      return true;
    }
  }

  return false;
}
