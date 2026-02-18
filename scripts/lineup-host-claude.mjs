import { spawnSync } from 'node:child_process';

const CLAUDE_PLUGIN = 'lineup@izantech';
const CLAUDE_MARKETPLACE = 'izantech/claude-plugins';

function formatFailure(label, result) {
  const stdout = String(result.stdout ?? '').trim();
  const stderr = String(result.stderr ?? '').trim();
  return [
    `${label} failed with exit code ${result.status}.`,
    stdout ? `stdout:\n${stdout}` : null,
    stderr ? `stderr:\n${stderr}` : null
  ]
    .filter(Boolean)
    .join('\n');
}

function runClaude(args, { allowAlready = false } = {}) {
  const result = spawnSync('claude', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('`claude` command not found. Install Claude Code CLI and retry.');
    }
    throw result.error;
  }

  if (result.status !== 0) {
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (allowAlready && /already|exists|added/i.test(combined)) {
      return result;
    }

    throw new Error(formatFailure(`claude ${args.join(' ')}`, result));
  }

  return result;
}

export function installClaude({ logger }) {
  logger?.info?.(`Ensuring marketplace ${CLAUDE_MARKETPLACE} is configured...`);
  runClaude(['plugin', 'marketplace', 'add', CLAUDE_MARKETPLACE], { allowAlready: true });

  logger?.info?.(`Installing ${CLAUDE_PLUGIN}...`);
  runClaude(['plugin', 'install', CLAUDE_PLUGIN]);

  return {
    host: 'claude',
    plugin: CLAUDE_PLUGIN,
    marketplace: CLAUDE_MARKETPLACE,
    action: 'install',
    version: 'marketplace'
  };
}

export function updateClaude({ logger }) {
  logger?.info?.(`Updating ${CLAUDE_PLUGIN}...`);
  runClaude(['plugin', 'update', CLAUDE_PLUGIN]);

  return {
    host: 'claude',
    plugin: CLAUDE_PLUGIN,
    action: 'update',
    version: 'marketplace'
  };
}

export function uninstallClaude({ logger }) {
  logger?.info?.(`Removing ${CLAUDE_PLUGIN}...`);
  runClaude(['plugin', 'remove', CLAUDE_PLUGIN]);

  return {
    host: 'claude',
    plugin: CLAUDE_PLUGIN,
    action: 'uninstall'
  };
}

export function statusClaude() {
  try {
    const listResult = runClaude(['plugin', 'list']);
    const output = `${listResult.stdout ?? ''}\n${listResult.stderr ?? ''}`;
    const installed = /lineup@izantech|\blineup\b/i.test(output);

    return {
      host: 'claude',
      available: true,
      installed,
      plugin: CLAUDE_PLUGIN
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      host: 'claude',
      available: false,
      installed: false,
      plugin: CLAUDE_PLUGIN,
      error: message
    };
  }
}
