import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export function isInteractive() {
  return Boolean(input.isTTY && output.isTTY);
}

function createReadline() {
  return readline.createInterface({ input, output });
}

function normalizeYesNo(value, defaultValue = false) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) {
    return defaultValue;
  }
  if (['y', 'yes'].includes(text)) {
    return true;
  }
  if (['n', 'no'].includes(text)) {
    return false;
  }
  return null;
}

export async function promptHostSelection() {
  if (!isInteractive()) {
    throw new Error('Host selection requires an interactive terminal. Pass --host claude|codex|all.');
  }

  const rl = createReadline();

  try {
    output.write('Select host(s):\n');
    output.write('  1. claude\n');
    output.write('  2. codex\n');
    output.write('  3. all\n');

    while (true) {
      const answer = await rl.question('Enter selection [1-3]: ');
      const normalized = answer.trim();
      if (normalized === '1' || /^claude$/i.test(normalized)) {
        return ['claude'];
      }
      if (normalized === '2' || /^codex$/i.test(normalized)) {
        return ['codex'];
      }
      if (normalized === '3' || /^all$/i.test(normalized)) {
        return ['claude', 'codex'];
      }
      output.write('Invalid selection. Choose 1, 2, or 3.\n');
    }
  } finally {
    rl.close();
  }
}

export async function promptConfirm(message, defaultValue = false) {
  if (!isInteractive()) {
    throw new Error('Confirmation prompt requires an interactive terminal. Pass --yes to continue non-interactively.');
  }

  const rl = createReadline();
  const suffix = defaultValue ? '[Y/n]' : '[y/N]';

  try {
    while (true) {
      const answer = await rl.question(`${message} ${suffix} `);
      const parsed = normalizeYesNo(answer, defaultValue);
      if (parsed === null) {
        output.write('Please answer yes or no.\n');
        continue;
      }
      return parsed;
    }
  } finally {
    rl.close();
  }
}

export async function promptUninstallPlan(hosts) {
  const hostLabel = hosts.join(', ');
  const proceed = await promptConfirm(`Uninstall Lineup for host(s): ${hostLabel}?`, false);
  if (!proceed) {
    return { proceed: false, purge: false };
  }

  const purge = await promptConfirm(
    'Also purge Lineup override/memory data (~/.claude/lineup/agents, ~/.codex/lineup/agents, ~/.codex/lineup/memory)?',
    false
  );

  return { proceed: true, purge };
}
