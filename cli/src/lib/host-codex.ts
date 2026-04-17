import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

import { CODEX_REQUIRED_FILES, CODEX_SKILL_DIRS } from "./constants";
import { CliError } from "./errors";
import { generateHostFiles, writeGeneratedFiles } from "./generate";
import { codexGlobalSkillsDir, codexLegacyGlobalSkillsDir } from "./paths";
import type { StatusHost } from "./types";

export function ensureCodexGenerated(sourceRoot: string, outputRoot: string): string {
  const files = generateHostFiles(sourceRoot, "codex");
  writeGeneratedFiles(files, outputRoot);
  return path.join(outputRoot, ".codex", "skills");
}

function requiredAbsolutePaths(baseDir: string): string[] {
  return CODEX_REQUIRED_FILES.map((relative) => path.join(baseDir, ...relative.replace(/^\.codex\/skills\//, "").split("/")));
}

export function validateCodexSkillsDir(baseDir: string): void {
  const missing = requiredAbsolutePaths(baseDir).filter((item) => !existsSync(item));
  if (missing.length > 0) {
    throw new CliError([`Codex skills directory is missing required files in ${baseDir}:`, ...missing.map((item) => `- ${item}`)].join("\n"), {
      code: "codex_skill_validation_failed"
    });
  }
}

function replaceDirectoryAtomic(sourceDir: string, targetDir: string): void {
  const parentDir = path.dirname(targetDir);
  const nonce = `${Date.now()}-${process.pid}`;
  const tempDir = path.join(parentDir, `.${path.basename(targetDir)}.tmp-${nonce}`);
  const backupDir = path.join(parentDir, `.${path.basename(targetDir)}.bak-${nonce}`);

  mkdirSync(parentDir, { recursive: true });
  cpSync(sourceDir, tempDir, { recursive: true });

  let movedTarget = false;

  try {
    if (existsSync(targetDir)) {
      renameSync(targetDir, backupDir);
      movedTarget = true;
    }

    renameSync(tempDir, targetDir);

    if (movedTarget && existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }

    if (movedTarget && !existsSync(targetDir) && existsSync(backupDir)) {
      renameSync(backupDir, targetDir);
    }

    throw error;
  }
}

export function installCodex({
  sourceRoot,
  workspaceRoot
}: {
  sourceRoot: string;
  workspaceRoot: string;
}): { skills_dir: string; files_verified: number } {
  const generatedRoot = path.join(workspaceRoot, "generated", "codex");
  const sourceSkills = ensureCodexGenerated(sourceRoot, generatedRoot);
  validateCodexSkillsDir(sourceSkills);

  const destinationRoot = codexGlobalSkillsDir();
  const legacyRoot = codexLegacyGlobalSkillsDir();
  mkdirSync(destinationRoot, { recursive: true });

  for (const dirName of CODEX_SKILL_DIRS) {
    const from = path.join(sourceSkills, dirName);
    const to = path.join(destinationRoot, dirName);
    replaceDirectoryAtomic(from, to);

    const legacy = path.join(legacyRoot, dirName);
    if (existsSync(legacy)) {
      rmSync(legacy, { recursive: true, force: true });
    }
  }

  validateCodexSkillsDir(destinationRoot);

  return {
    skills_dir: destinationRoot,
    files_verified: CODEX_REQUIRED_FILES.length
  };
}

export function uninstallCodex(): { skills_dir: string } {
  const root = codexGlobalSkillsDir();
  const legacyRoot = codexLegacyGlobalSkillsDir();
  for (const dirName of CODEX_SKILL_DIRS) {
    const target = path.join(root, dirName);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }

    const legacyTarget = path.join(legacyRoot, dirName);
    if (existsSync(legacyTarget)) {
      rmSync(legacyTarget, { recursive: true, force: true });
    }
  }

  return { skills_dir: root };
}

export function statusCodex(): StatusHost {
  const root = codexGlobalSkillsDir();
  const missing = requiredAbsolutePaths(root).filter((item) => !existsSync(item));

  return {
    host: "codex",
    installed: missing.length === 0,
    version: null,
    source: null,
    last_action: null,
    ...(missing.length > 0 ? { error: `Missing ${missing.length} required files.` } : {})
  };
}
