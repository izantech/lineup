import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, '..');

export const GENERATED_BANNER = '<!-- AUTO-GENERATED. Edit canonical source in .lineup-core/. -->';

const HOSTS = ['claude', 'codex'];

function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function readText(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

export function loadHostAdapters() {
  const adapters = new Map();

  for (const host of HOSTS) {
    const adapter = readJson(path.join('.lineup-core', 'hosts', `${host}.json`));
    if (!adapter?.vars || typeof adapter.vars !== 'object') {
      throw new Error(`Host adapter '${host}' is missing a 'vars' object.`);
    }
    adapters.set(host, adapter);
  }

  return adapters;
}

function buildTemplateSpecs(hostAdapters) {
  const claudeVars = hostAdapters.get('claude').vars;
  const codexVars = hostAdapters.get('codex').vars;

  return [
    {
      source: '.lineup-core/skills/kick-off/core.md',
      targets: {
        claude: `skills/${claudeVars.SKILL_NAME_KICKOFF}/SKILL.md`,
        codex: `.agents/skills/${codexVars.SKILL_NAME_KICKOFF}/SKILL.md`
      }
    },
    {
      source: '.lineup-core/skills/kick-off/init.core.md',
      targets: {
        claude: `skills/${claudeVars.SKILL_NAME_KICKOFF}/INIT.md`,
        codex: `.agents/skills/${codexVars.SKILL_NAME_KICKOFF}/INIT.md`
      }
    },
    {
      source: '.lineup-core/skills/configure/core.md',
      targets: {
        claude: `skills/${claudeVars.SKILL_NAME_CONFIGURE}/SKILL.md`,
        codex: `.agents/skills/${codexVars.SKILL_NAME_CONFIGURE}/SKILL.md`
      }
    },
    {
      source: '.lineup-core/skills/explain/core.md',
      targets: {
        claude: `skills/${claudeVars.SKILL_NAME_EXPLAIN}/SKILL.md`,
        codex: `.agents/skills/${codexVars.SKILL_NAME_EXPLAIN}/SKILL.md`
      }
    },
    {
      source: '.lineup-core/skills/playbook/core.md',
      targets: {
        claude: `skills/${claudeVars.SKILL_NAME_PLAYBOOK}/SKILL.md`,
        codex: `.agents/skills/${codexVars.SKILL_NAME_PLAYBOOK}/SKILL.md`
      }
    }
  ];
}

function renderTemplate(rawTemplate, vars, source, host) {
  return rawTemplate.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, token) => {
    if (!(token in vars)) {
      throw new Error(
        `Missing template variable '${token}' for host '${host}' while rendering '${source}'.`
      );
    }

    return String(vars[token]);
  });
}

function withBanner(content) {
  const trimmedEnd = content.replace(/\s+$/u, '');
  return `${GENERATED_BANNER}\n\n${trimmedEnd}\n`;
}

export function generateAllHostFiles() {
  const hostAdapters = loadHostAdapters();
  const specs = buildTemplateSpecs(hostAdapters);
  const outputs = [];

  for (const spec of specs) {
    const template = readText(spec.source);

    for (const [host, adapter] of hostAdapters.entries()) {
      const rendered = renderTemplate(template, adapter.vars, spec.source, host);
      outputs.push({
        host,
        source: spec.source,
        target: spec.targets[host],
        content: withBanner(rendered)
      });
    }
  }

  return outputs;
}
