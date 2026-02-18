#!/usr/bin/env node

import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  getStateFilePath,
  loadState,
  resolveRelease,
  saveState,
  setHostState
} from './lineup-release.mjs';
import {
  installClaude,
  statusClaude,
  uninstallClaude,
  updateClaude
} from './lineup-host-claude.mjs';
import {
  getCodexGlobalSkillsDir,
  installOrUpdateCodexFromSource,
  statusCodex,
  uninstallCodex
} from './lineup-host-codex.mjs';
import {
  isInteractive,
  promptHostSelection,
  promptUninstallPlan
} from './lineup-prompts.mjs';

const VALID_COMMANDS = new Set(['install', 'update', 'uninstall', 'status']);
const VALID_HOSTS = new Set(['claude', 'codex', 'all']);

function usage() {
  return `Lineup installer wrapper (Claude + Codex)

Usage:
  lineup <command> [options]

Commands:
  install      Install Lineup for selected host(s)
  update       Update Lineup for selected host(s)
  uninstall    Uninstall Lineup for selected host(s)
  status       Show Lineup installation status

Options:
  --host <claude|codex|all>   Target host(s)
  --version <tag|latest>      Release version for install/update (default: latest)
  --yes                       Skip interactive confirmations
  --purge                     Purge Lineup data paths on uninstall
  --json                      Emit JSON output (status only)
  --help                      Show this message

Examples:
  lineup install --host all
  lineup update --host codex --version 1.5.0
  lineup uninstall --host claude
  lineup status --host all --json
`;
}

function parseArgs(argv) {
  const options = {
    host: null,
    version: null,
    yes: false,
    purge: false,
    json: false,
    help: false
  };

  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }

    if (token === '--yes') {
      options.yes = true;
      continue;
    }

    if (token === '--purge') {
      options.purge = true;
      continue;
    }

    if (token === '--json') {
      options.json = true;
      continue;
    }

    if (token.startsWith('--host=')) {
      options.host = token.split('=', 2)[1];
      continue;
    }

    if (token === '--host') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --host');
      }
      options.host = next;
      index += 1;
      continue;
    }

    if (token.startsWith('--version=')) {
      options.version = token.split('=', 2)[1];
      continue;
    }

    if (token === '--version') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --version');
      }
      options.version = next;
      index += 1;
      continue;
    }

    if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}`);
    }

    positionals.push(token);
  }

  const command = positionals[0] ?? null;
  return { command, options };
}

function normalizeHost(host) {
  if (!host) {
    return null;
  }

  const normalized = String(host).trim().toLowerCase();
  if (!VALID_HOSTS.has(normalized)) {
    throw new Error(`Invalid --host value: ${host}. Expected claude, codex, or all.`);
  }
  return normalized;
}

async function resolveHosts(hostOption) {
  const normalized = normalizeHost(hostOption);
  if (normalized === 'all') {
    return ['claude', 'codex'];
  }
  if (normalized) {
    return [normalized];
  }

  if (isInteractive()) {
    return promptHostSelection();
  }

  throw new Error('No host selected. Use --host claude|codex|all when running non-interactively.');
}

function assertOptionCompatibility(command, options) {
  if (!VALID_COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  if (options.json && command !== 'status') {
    throw new Error('--json is only supported for the status command.');
  }

  if (options.purge && command !== 'uninstall') {
    throw new Error('--purge is only supported for the uninstall command.');
  }

  if (options.version && !['install', 'update'].includes(command)) {
    throw new Error('--version is only supported for install and update commands.');
  }
}

function loggerFor(jsonMode) {
  return {
    info: (message) => {
      if (!jsonMode) {
        process.stdout.write(`${message}\n`);
      }
    },
    warn: (message) => {
      if (!jsonMode) {
        process.stderr.write(`${message}\n`);
      }
    }
  };
}

function printStatus(status, jsonMode) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return;
  }

  for (const host of Object.keys(status.hosts)) {
    const item = status.hosts[host];
    process.stdout.write(`- ${host}: ${item.installed ? 'installed' : 'not installed'}\n`);
    if (item.version) {
      process.stdout.write(`  version: ${item.version}\n`);
    }
    if (item.error) {
      process.stdout.write(`  error: ${item.error}\n`);
    }
    if (item.skills_dir) {
      process.stdout.write(`  skills_dir: ${item.skills_dir}\n`);
    }
    if (Array.isArray(item.missing_files) && item.missing_files.length > 0) {
      process.stdout.write(`  missing_files: ${item.missing_files.length}\n`);
    }
  }

  process.stdout.write(`state_file: ${status.state_file}\n`);
}

function purgePaths(hosts, logger) {
  const targets = [];

  if (hosts.includes('claude')) {
    targets.push(path.join(os.homedir(), '.claude', 'lineup', 'agents'));
  }

  if (hosts.includes('codex')) {
    targets.push(path.join(os.homedir(), '.codex', 'lineup', 'agents'));
    targets.push(path.join(os.homedir(), '.codex', 'lineup', 'memory'));
  }

  for (const target of targets) {
    logger.info(`Purging ${target}`);
    rmSync(target, { recursive: true, force: true });
  }

  return targets;
}

async function runInstallOrUpdate(command, hosts, options, state, logger) {
  const results = {};
  const failures = [];

  let release = null;
  if (hosts.includes('codex')) {
    const version = options.version ?? 'latest';
    release = await resolveRelease({ version, logger });
    logger.info(`Resolved release ${release.tag}`);
  } else if (options.version && hosts.includes('claude')) {
    logger.warn('Version pinning is not applied to Claude marketplace updates; Claude uses marketplace latest.');
  }

  for (const host of hosts) {
    try {
      if (host === 'claude') {
        const data = command === 'install' ? installClaude({ logger }) : updateClaude({ logger });
        setHostState(state, 'claude', {
          installed: command === 'install' || command === 'update',
          version: 'marketplace',
          source: 'claude-marketplace',
          last_action: command
        });
        results.claude = { ok: true, ...data };
      }

      if (host === 'codex') {
        const data = installOrUpdateCodexFromSource({
          sourceDir: release.sourceDir,
          tag: release.tag,
          logger
        });
        setHostState(state, 'codex', {
          installed: true,
          version: release.tag,
          source: release.sourceDir,
          skills_dir: getCodexGlobalSkillsDir(),
          last_action: command
        });
        results.codex = { ok: true, ...data };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ host, error: message });
      results[host] = { ok: false, error: message };
    }
  }

  saveState(state);

  if (failures.length > 0) {
    const payload = { command, ok: false, results, failures };
    throw new Error(JSON.stringify(payload, null, 2));
  }

  return { command, ok: true, results };
}

async function runUninstall(hosts, options, state, logger) {
  if (!options.yes) {
    if (!isInteractive()) {
      throw new Error('Uninstall requires confirmation in interactive mode. Use --yes for non-interactive execution.');
    }

    const plan = await promptUninstallPlan(hosts);
    if (!plan.proceed) {
      return { command: 'uninstall', ok: true, skipped: true, reason: 'cancelled-by-user' };
    }
    options.purge = plan.purge;
  }

  const results = {};
  const failures = [];

  for (const host of hosts) {
    try {
      if (host === 'claude') {
        const data = uninstallClaude({ logger });
        setHostState(state, 'claude', {
          installed: false,
          last_action: 'uninstall'
        });
        results.claude = { ok: true, ...data };
      }

      if (host === 'codex') {
        const data = uninstallCodex({ logger });
        setHostState(state, 'codex', {
          installed: false,
          last_action: 'uninstall'
        });
        results.codex = { ok: true, ...data };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ host, error: message });
      results[host] = { ok: false, error: message };
    }
  }

  let purgedPaths = [];
  if (options.purge) {
    purgedPaths = purgePaths(hosts, logger);
  }

  saveState(state);

  if (failures.length > 0) {
    const payload = { command: 'uninstall', ok: false, results, failures, purged_paths: purgedPaths };
    throw new Error(JSON.stringify(payload, null, 2));
  }

  return {
    command: 'uninstall',
    ok: true,
    results,
    purged_paths: purgedPaths
  };
}

function runStatus(hosts, options, state) {
  const status = {
    command: 'status',
    ok: true,
    hosts: {},
    state_file: getStateFilePath(),
    state
  };

  for (const host of hosts) {
    if (host === 'claude') {
      const runtime = statusClaude();
      const saved = state.hosts?.claude ?? null;
      status.hosts.claude = {
        ...runtime,
        version: runtime.installed ? saved?.version ?? 'marketplace' : saved?.version ?? null,
        last_action: saved?.last_action ?? null
      };
      continue;
    }

    if (host === 'codex') {
      const runtime = statusCodex();
      const saved = state.hosts?.codex ?? null;
      status.hosts.codex = {
        ...runtime,
        version: runtime.installed ? saved?.version ?? null : saved?.version ?? null,
        last_action: saved?.last_action ?? null
      };
    }
  }

  printStatus(status, options.json);
  return status;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || options.help || command === 'help') {
    process.stdout.write(usage());
    return;
  }

  assertOptionCompatibility(command, options);

  const state = loadState();
  const logger = loggerFor(options.json);
  const hosts = await resolveHosts(options.host);

  if (command === 'status') {
    runStatus(hosts, options, state);
    return;
  }

  let result;
  if (command === 'install' || command === 'update') {
    result = await runInstallOrUpdate(command, hosts, options, state, logger);
  } else {
    result = await runUninstall(hosts, options, state, logger);
  }

  if (!options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
