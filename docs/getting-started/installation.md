# Installation

Lineup supports both Claude Code and Codex CLI.

> The wrapper CLI + Codex global install flow on this page is targeted for **2.0.0**.  
> If you're on released `1.5.0`, use the Claude marketplace/native instructions.

## Prerequisites

- For Claude: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and configured
- For Codex: [Codex CLI](https://developers.openai.com/codex) installed and configured
- Node.js available in your shell
- A terminal where you can run `claude` or `codex` commands

## Choose your install method

| Method | Best for | Time |
| ------ | -------- | ---- |
| [Lineup wrapper CLI](#lineup-wrapper-cli-recommended) | Most users (cross-host install/update/status) | 1 minute |
| [Claude marketplace](#claude-marketplace-native) | Claude-only native flow | 1 minute |
| [Codex repo-local](#codex-repo-local-native) | Contributors running from source | 1 minute |
| [Manual plugin dir](#manual-plugin-dir-claude) | Local development and plugin internals | 2 minutes |

## Lineup wrapper CLI (Recommended)

Install the `lineup` shim:

```bash
curl -fsSL https://raw.githubusercontent.com/izantech/lineup/main/scripts/install-lineup.sh | bash
```

This installs:
- shim: `~/.local/bin/lineup`
- cached release payloads: `~/.lineup/bootstrap/releases/<tag>/source`
- active symlink: `~/.lineup/current`

### Wrapper command surface

```text
lineup install [--host claude|codex|all] [--version <tag>|latest] [--yes]
lineup update [--host claude|codex|all] [--version <tag>|latest] [--yes]
lineup uninstall [--host claude|codex|all] [--yes] [--purge]
lineup status [--host claude|codex|all] [--json]
```

### Host behavior matrix

| `lineup` command | Claude backend | Codex backend |
| --- | --- | --- |
| `install` | `claude plugin marketplace add izantech/claude-plugins` + `claude plugin install lineup@izantech` | Install skills into `$HOME/.agents/skills/lineup-*` |
| `update` | `claude plugin update lineup@izantech` | Re-sync `$HOME/.agents/skills/lineup-*` from release |
| `uninstall` | `claude plugin remove lineup@izantech` | Remove `$HOME/.agents/skills/lineup-*` |
| `status` | Read `claude plugin list` | Verify required skill files in `$HOME/.agents/skills/` |

### Non-interactive examples

```bash
lineup install --host all --yes
lineup update --host codex --version latest --yes
lineup status --host all --json
lineup uninstall --host claude --yes
```

### Uninstall prompts and purge semantics

`lineup uninstall` is interactive by default.

- In TTY mode, it asks:
  - confirm uninstall target hosts
  - confirm whether to purge Lineup data directories
- In non-TTY mode, pass `--yes`.
- Use `--purge` to delete data paths without prompt when combined with `--yes`.

Purge targets:
- `~/.claude/lineup/agents/`
- `~/.codex/lineup/agents/`
- `~/.codex/lineup/memory/`

## Claude marketplace (native)

```bash
claude plugin marketplace add izantech/claude-plugins
claude plugin install lineup@izantech
```

Update later:

```bash
claude plugin update lineup@izantech
```

## Codex repo-local (native)

Clone and run Codex from the repository root:

```bash
git clone https://github.com/izantech/lineup.git
cd lineup
codex
```

Codex discovers Lineup workflows from `.agents/skills/`:
- `$lineup-kick-off`
- `$lineup-configure`
- `$lineup-explain`
- `$lineup-playbook`

## Manual plugin dir (Claude)

Clone the repository and point Claude Code at it:

```bash
git clone https://github.com/izantech/lineup.git
claude --plugin-dir /path/to/lineup
```

This loads all agents and skills automatically. The `lineup:` namespace comes from the plugin name in `plugin.json`.

## Verify installation

After installing in Claude, confirm everything is working:

```bash
/lineup:kick-off Hello, just checking the pipeline works!
```

For Codex, run:

```text
$lineup-kick-off Hello, just checking the pipeline works!
```

With the wrapper installed, you can also verify quickly:

```bash
lineup status --host all
```

## Troubleshooting

### `lineup` command not found

- Ensure `~/.local/bin` is in your shell `PATH`.
- Re-run bootstrap install script.

### Bootstrap reports missing `scripts/lineup.mjs`

If bootstrap prints `installer artifacts unavailable`, the latest published release tag does not include the wrapper scripts yet.

- Use repo mode temporarily: `node scripts/lineup.mjs <command> ...`
- Retry bootstrap after the next tagged release is published

### Claude plugin not found

If `/lineup:kick-off` is not recognized:

- Confirm marketplace registration: `claude plugin marketplace add izantech/claude-plugins`
- Re-run install: `claude plugin install lineup@izantech`

### Codex skills missing

If `$lineup-kick-off` is not recognized:

- Run `lineup status --host codex`
- Re-run `lineup install --host codex --yes`
- Confirm `~/.agents/skills/lineup-kick-off/SKILL.md` exists

### "No such agent" errors (Claude)

Agent names are auto-namespaced by the plugin. You should see agents like `lineup:researcher`, `lineup:architect`, etc. If you see bare names without the `lineup:` prefix, confirm `.claude-plugin/plugin.json` exists and has `"name": "lineup"`.

## Next steps

Head to [Your First Task](/getting-started/first-task) to walk through a complete pipeline run.
