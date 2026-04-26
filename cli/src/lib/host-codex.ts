import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CODEX_REQUIRED_FILES, CODEX_SKILL_DIRS, LINEUP_AGENT_ROLES } from "./constants";
import { CliError } from "./errors";
import { generateHostAgents, generateHostFiles, writeGeneratedFiles } from "./generate";
import { codexAgentsDir, codexGlobalSkillsDir, codexLegacyGlobalSkillsDir } from "./paths";
import { promptCodexModels } from "./prompts";
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

export async function installCodex({
  sourceRoot,
  workspaceRoot,
  homeDir
}: {
  sourceRoot: string;
  workspaceRoot: string;
  homeDir: string;
}): Promise<{ skills_dir: string; files_verified: number }> {
  const codexModels = await promptCodexModels(homeDir);

  const generatedRoot = path.join(workspaceRoot, "generated", "codex");
  const sourceSkills = ensureCodexGenerated(sourceRoot, generatedRoot);
  validateCodexSkillsDir(sourceSkills);

  const agentFiles = generateHostAgents(sourceRoot, "codex", { codex: codexModels });
  const agentDir = codexAgentsDir(homeDir);
  mkdirSync(agentDir, { recursive: true });
  for (const f of agentFiles) {
    const target = path.join(agentDir, path.basename(f.target));
    writeFileSync(target, f.content, "utf8");
  }

  const destinationRoot = codexGlobalSkillsDir(homeDir);
  const legacyRoot = codexLegacyGlobalSkillsDir(homeDir);
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

export function uninstallCodex(homeDir: string): { skills_dir: string } {
  const root = codexGlobalSkillsDir(homeDir);
  const legacyRoot = codexLegacyGlobalSkillsDir(homeDir);
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

  for (const role of LINEUP_AGENT_ROLES) {
    const f = path.join(codexAgentsDir(homeDir), `lineup-${role}.toml`);
    if (existsSync(f)) rmSync(f, { force: true });
  }

  return { skills_dir: root };
}

export function statusCodex(homeDir: string): StatusHost {
  const root = codexGlobalSkillsDir(homeDir);
  const missingSkills = requiredAbsolutePaths(root).filter((item) => !existsSync(item));

  const missingAgents = LINEUP_AGENT_ROLES.filter(
    (role) => !existsSync(path.join(codexAgentsDir(homeDir), `lineup-${role}.toml`))
  );

  const missing = missingSkills.length + missingAgents.length;

  return {
    host: "codex",
    installed: missing === 0,
    version: null,
    source: null,
    last_action: null,
    ...(missing > 0 ? { error: `Missing ${missing} required files.` } : {})
  };
}
