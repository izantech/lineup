import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

import { OPENCODE_REQUIRED_FILES, OPENCODE_SKILL_DIRS } from "./constants";
import { CliError } from "./errors";
import { generateHostFiles, loadHostAdapter, writeGeneratedFiles } from "./generate";
import { opencodeGlobalSkillsDir, opencodeHostRoot } from "./paths";
import type { LineupMethod } from "./protocol";
import type { StatusHost } from "./types";

export function ensureOpencodeGenerated(sourceRoot: string, homeDir: string): string {
  const outputRoot = opencodeHostRoot(homeDir);
  const files = generateHostFiles(sourceRoot, "opencode");
  writeGeneratedFiles(files, outputRoot);
  return path.join(outputRoot, ".opencode", "skills");
}

function requiredAbsolutePaths(baseDir: string): string[] {
  return OPENCODE_REQUIRED_FILES.map((relative) => path.join(baseDir, ...relative.replace(/^\.opencode\/skills\//, "").split("/")));
}

export function validateOpencodeSkillsDir(skillsDir: string): void {
  const missing = requiredAbsolutePaths(skillsDir).filter((item) => !existsSync(item));
  if (missing.length > 0) {
    throw new CliError([`OpenCode skills directory is missing required files in ${skillsDir}:`, ...missing.map((item) => `- ${item}`)].join("\n"), {
      code: "opencode_skill_validation_failed"
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
  "pipeline/cancel": "cancel",
  "pipeline/complete": "complete"
};

export type OpencodeProtocolBridge = {
  host: "opencode";
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

export function describeOpencodeProtocolBridge(sourceRoot: string): OpencodeProtocolBridge {
  const adapter = loadHostAdapter(sourceRoot, "opencode");
  return {
    host: "opencode",
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

export function installOpencode(sourceRoot: string, homeDir: string): { skills_dir: string; files_verified: number } {
  const sourceSkills = ensureOpencodeGenerated(sourceRoot, homeDir);
  validateOpencodeSkillsDir(sourceSkills);

  const destinationRoot = opencodeGlobalSkillsDir(homeDir);
  mkdirSync(destinationRoot, { recursive: true });

  for (const dirName of OPENCODE_SKILL_DIRS) {
    const from = path.join(sourceSkills, dirName);
    const to = path.join(destinationRoot, dirName);
    replaceDirectoryAtomic(from, to);
  }

  validateOpencodeSkillsDir(destinationRoot);

  return {
    skills_dir: destinationRoot,
    files_verified: OPENCODE_REQUIRED_FILES.length
  };
}

export function uninstallOpencode(homeDir: string): { skills_dir: string } {
  const root = opencodeGlobalSkillsDir(homeDir);
  for (const dirName of OPENCODE_SKILL_DIRS) {
    const target = path.join(root, dirName);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  }

  return { skills_dir: root };
}

export function statusOpencode(homeDir: string): StatusHost {
  const root = opencodeGlobalSkillsDir(homeDir);
  const missing = requiredAbsolutePaths(root).filter((item) => !existsSync(item));

  return {
    host: "opencode",
    installed: missing.length === 0,
    version: null,
    source: null,
    last_action: null,
    ...(missing.length > 0 ? { error: `Missing ${missing.length} required files.` } : {})
  };
}
