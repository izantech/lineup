import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

import { CODEX_REQUIRED_FILES, CODEX_SKILL_DIRS } from "./constants";
import { CliError } from "./errors";
import { generateHostFiles, loadHostAdapter, writeGeneratedFiles } from "./generate";
import { codexGlobalSkillsDir, codexRepoLocalSkillsDir } from "./paths";
import type { LineupMethod } from "./protocol";
import type { StatusHost } from "./types";

export function ensureCodexGenerated(sourceRoot: string, outputRoot: string): string {
  const files = generateHostFiles(sourceRoot, "codex");
  writeGeneratedFiles(files, outputRoot);
  return path.join(outputRoot, ".agents", "skills");
}

function requiredAbsolutePaths(baseDir: string): string[] {
  return CODEX_REQUIRED_FILES.map((relative) => path.join(baseDir, ...relative.replace(/^\.agents\/skills\//, "").split("/")));
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

const JSON_RPC_METHOD_MAP: Record<LineupMethod, string> = {
  "agent/spawn": "spawn",
  "agent/output": "stream",
  "agent/done": "complete",
  "agent/cancel": "cancel",
  "gate/request": "question",
  "gate/respond": "respond",
  "pipeline/cancel": "cancel",
  "pipeline/complete": "complete"
};

export type CodexProtocolBridge = {
  host: "codex";
  transport: "json-rpc-2.0";
  framing: "ndjson";
  questionPrimitive: string;
  commands: {
    kickoff: string;
    configure: string;
    explain: string;
    playbook: string;
    digest: string;
  };
  methodMap: Record<LineupMethod, string>;
};

export function describeCodexProtocolBridge(sourceRoot: string): CodexProtocolBridge {
  const adapter = loadHostAdapter(sourceRoot, "codex");
  return {
    host: "codex",
    transport: "json-rpc-2.0",
    framing: "ndjson",
    questionPrimitive: adapter.vars.QUESTION_PRIMITIVE,
    commands: {
      kickoff: adapter.vars.CMD_KICKOFF,
      configure: adapter.vars.CMD_CONFIGURE,
      explain: adapter.vars.CMD_EXPLAIN,
      playbook: adapter.vars.CMD_PLAYBOOK,
      digest: adapter.vars.CMD_DIGEST
    },
    methodMap: JSON_RPC_METHOD_MAP
  };
}

export function installCodex({
  sourceRoot,
  workspaceRoot,
  global = true
}: {
  sourceRoot: string;
  workspaceRoot: string;
  global?: boolean;
}): { skills_dir: string; files_verified: number } {
  const generatedRoot = path.join(workspaceRoot, "generated", "codex");
  const sourceSkills = ensureCodexGenerated(sourceRoot, generatedRoot);
  validateCodexSkillsDir(sourceSkills);

  const destinationRoot = global ? codexGlobalSkillsDir() : codexRepoLocalSkillsDir();
  mkdirSync(destinationRoot, { recursive: true });

  for (const dirName of CODEX_SKILL_DIRS) {
    const from = path.join(sourceSkills, dirName);
    const to = path.join(destinationRoot, dirName);
    replaceDirectoryAtomic(from, to);
  }

  validateCodexSkillsDir(destinationRoot);

  return {
    skills_dir: destinationRoot,
    files_verified: CODEX_REQUIRED_FILES.length
  };
}

export function uninstallCodex(global = true): { skills_dir: string } {
  const root = global ? codexGlobalSkillsDir() : codexRepoLocalSkillsDir();
  for (const dirName of CODEX_SKILL_DIRS) {
    const target = path.join(root, dirName);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  }

  return { skills_dir: root };
}

export function statusCodex(global = true): StatusHost {
  const root = global ? codexGlobalSkillsDir() : codexRepoLocalSkillsDir();
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
