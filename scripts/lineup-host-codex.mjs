import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SKILL_DIRS = [
  'lineup-kick-off',
  'lineup-configure',
  'lineup-explain',
  'lineup-playbook'
];

const REQUIRED_FILES = [
  '.agents/skills/lineup-kick-off/SKILL.md',
  '.agents/skills/lineup-kick-off/INIT.md',
  '.agents/skills/lineup-configure/SKILL.md',
  '.agents/skills/lineup-explain/SKILL.md',
  '.agents/skills/lineup-playbook/SKILL.md'
];

function absoluteRequiredPaths(baseDir) {
  return REQUIRED_FILES.map((relative) => path.join(baseDir, ...relative.split('/')));
}

export function getCodexGlobalSkillsDir() {
  return path.join(os.homedir(), '.agents', 'skills');
}

export function validateCodexSourceDir(sourceDir) {
  const missing = absoluteRequiredPaths(sourceDir).filter((target) => !existsSync(target));
  if (missing.length > 0) {
    throw new Error(
      [
        `Release source is missing required Codex skill files in ${sourceDir}:`,
        ...missing.map((item) => `- ${item}`)
      ].join('\n')
    );
  }
}

function replaceDirectoryAtomic(sourceDir, targetDir) {
  const parentDir = path.dirname(targetDir);
  const suffix = `${Date.now()}-${process.pid}`;
  const tmpDir = path.join(parentDir, `.${path.basename(targetDir)}.tmp-${suffix}`);
  const backupDir = path.join(parentDir, `.${path.basename(targetDir)}.bak-${suffix}`);

  mkdirSync(parentDir, { recursive: true });
  cpSync(sourceDir, tmpDir, { recursive: true });

  let movedTargetToBackup = false;

  try {
    if (existsSync(targetDir)) {
      renameSync(targetDir, backupDir);
      movedTargetToBackup = true;
    }

    renameSync(tmpDir, targetDir);

    if (movedTargetToBackup && existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }

    if (movedTargetToBackup && !existsSync(targetDir) && existsSync(backupDir)) {
      renameSync(backupDir, targetDir);
    }

    throw error;
  }
}

export function installOrUpdateCodexFromSource({ sourceDir, tag, logger }) {
  validateCodexSourceDir(sourceDir);

  const sourceSkillsRoot = path.join(sourceDir, '.agents', 'skills');
  const destinationRoot = getCodexGlobalSkillsDir();
  mkdirSync(destinationRoot, { recursive: true });

  for (const skillDir of SKILL_DIRS) {
    const from = path.join(sourceSkillsRoot, skillDir);
    const to = path.join(destinationRoot, skillDir);
    logger?.info?.(`Syncing ${to}`);
    replaceDirectoryAtomic(from, to);
  }

  const status = statusCodex();
  if (!status.installed) {
    const missing = status.missing_files?.length ? status.missing_files.join(', ') : 'unknown files';
    throw new Error(`Codex install verification failed. Missing: ${missing}`);
  }

  return {
    host: 'codex',
    action: 'install-or-update',
    version: tag,
    skills_dir: destinationRoot,
    files_verified: REQUIRED_FILES.length
  };
}

export function uninstallCodex({ logger }) {
  const destinationRoot = getCodexGlobalSkillsDir();

  for (const skillDir of SKILL_DIRS) {
    const target = path.join(destinationRoot, skillDir);
    if (!existsSync(target)) {
      continue;
    }
    logger?.info?.(`Removing ${target}`);
    rmSync(target, { recursive: true, force: true });
  }

  return {
    host: 'codex',
    action: 'uninstall',
    skills_dir: destinationRoot
  };
}

export function statusCodex() {
  const destinationRoot = getCodexGlobalSkillsDir();

  const missing = REQUIRED_FILES.map((relativePath) => {
    const rel = relativePath.replace(/^\.agents\/skills\//, '');
    const absolute = path.join(destinationRoot, ...rel.split('/'));
    return existsSync(absolute) ? null : absolute;
  }).filter(Boolean);

  const installedDirs = existsSync(destinationRoot)
    ? readdirSync(destinationRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('lineup-'))
        .map((entry) => entry.name)
    : [];

  return {
    host: 'codex',
    available: true,
    installed: missing.length === 0,
    skills_dir: destinationRoot,
    installed_skill_dirs: installedDirs,
    missing_files: missing
  };
}
