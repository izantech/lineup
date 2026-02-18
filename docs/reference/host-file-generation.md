# Host File Generation

Lineup supports multiple agent hosts (Claude Code and Codex CLI) without duplicating full workflow files.

## Source of truth

All workflow logic is authored once in canonical templates:

- `.lineup-core/skills/kick-off/core.md`
- `.lineup-core/skills/kick-off/init.core.md`
- `.lineup-core/skills/configure/core.md`
- `.lineup-core/skills/explain/core.md`
- `.lineup-core/skills/playbook/core.md`

Host-specific variables are defined in:

- `.lineup-core/hosts/claude.json`
- `.lineup-core/hosts/codex.json`

## Generated targets

Generated skill files:

| Host | Generated path |
|------|----------------|
| Claude Code | `skills/**` |
| Codex CLI | `.agents/skills/**` |

Every generated file includes this header:

```md
<!-- AUTO-GENERATED. Edit canonical source in .lineup-core/. -->
```

## Commands

Generate files:

```bash
node scripts/sync-host-files.mjs
```

Check drift (CI-safe):

```bash
node scripts/check-host-files.mjs
```

## Edit policy

- Do edit: `.lineup-core/skills/**` and `.lineup-core/hosts/*.json`
- Do not edit: `skills/**` and `.agents/skills/**`
- Always run `sync-host-files` before committing template changes
- Run `check-host-files` locally or in CI to prevent drift

## CI behavior

The workflow `.github/workflows/host-files-check.yml` runs `check-host-files` on pushes and pull requests.

If any generated file is out of sync with canonical templates, CI fails and asks you to run:

```bash
node scripts/sync-host-files.mjs
```
