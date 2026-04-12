# Migrating from 1.x to 2.0

Lineup 2.0 replaces the manual marketplace installation with a CLI manager. This guide walks you through the upgrade.

## What changed

| Area | 1.x | 2.0 |
|------|-----|-----|
| Installation | Claude marketplace UI (`lineup@izantech`) | CLI: `npm install -g @izantech/lineup-cli` then `lineup install` |
| Skill files | Committed to git in `skills/` and `.agents/skills/` | Generated at install time, not committed (in `.gitignore`) |
| Updates | Reinstall plugin manually | `lineup update --host all` |
| Version tracking | None | `lineup status --json` reports version per host |
| Uninstall | Manual plugin removal | `lineup uninstall --host all` |

## What stays the same

- Core skill commands (`kick-off`, `configure`, `explain`, `playbook`) still work identically across all hosts. Lineup 2.0+ adds additional commands like `/lineup:digest`.
- Agent configuration overrides in `~/.claude/lineup/agents/` are preserved
- Tactic format (`.lineup/tactics/*.yaml`) is unchanged
- Agent behavior and pipeline stages are unchanged

## Step-by-step upgrade

### 1. Install the CLI

```bash
npm install -g @izantech/lineup-cli
```

Verify with:

```bash
lineup --version
```

### 2. Run install with automatic migration

```bash
lineup install --host claude
```

The CLI detects the legacy `lineup@izantech` marketplace plugin automatically. When detected, it:

1. Removes the old `lineup@izantech` plugin
2. Installs the new CLI-managed `lineup@lineup-local` plugin from a local marketplace
3. Generates skill files from canonical templates

Accept the migration prompt to proceed.

For Codex (if applicable):

```bash
lineup install --host codex
```

### 3. Clean up legacy files

If your repository still has committed skill files from 1.x, remove them:

```bash
git rm -r skills/ .agents/skills/ scripts/ 2>/dev/null
```

These directories are now in `.gitignore` since generated files are install-time artifacts.

### 4. Verify

```bash
lineup status --host all
```

You should see each host reporting `installed: true` with a `2.x` version and `source: cli-managed`.

Test that skills still work:

```
/lineup:kick-off What does this codebase do?
```

## Troubleshooting

### Legacy plugin still shows up after migration

If `lineup status --host claude` still reports a legacy install:

```bash
lineup install --host claude
```

Re-running install triggers the migration flow again. The CLI attempts to remove `lineup@izantech` before installing the new plugin.

### Agent overrides not applied

Agent override files in `~/.claude/lineup/agents/` work the same in 2.0. If an override is not applying, check that:

- The file is valid YAML
- `model` is one of `haiku`, `sonnet`, `opus`
- `tools` is a non-empty comma-space separated string

Run `/lineup:configure` to review and update overrides interactively.

### Hand-edited skill files are gone

In 2.0, skill files are regenerated from canonical templates on every `lineup install` or `lineup update`. Any hand-edits to files in the old `skills/` directory are not preserved.

If you had customized skill behavior, the supported approach is:

- **Agent behavior**: Use agent overrides in `~/.claude/lineup/agents/`
- **Workflows**: Create tactics in `.lineup/tactics/` via `/lineup:playbook`

### `lineup: command not found`

Ensure your global npm bin directory is in your `PATH`:

```bash
npm bin -g
```

If the path shown is not in your `PATH`, add it to your shell profile.
