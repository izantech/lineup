# Installation

Lineup 2.0 is installed and managed via the `lineup` CLI.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) for Claude host operations
- [Codex CLI](https://developers.openai.com/codex/) for Codex host operations
- [OpenCode](https://opencode.ai) for OpenCode host operations

## Install the manager

```bash
npm install -g @izantech/lineup-cli
```

## Where install files come from

`lineup install` and `lineup update` fetch release artifacts from GitHub and cache them locally per tag in `~/.lineup/cache/<tag>/`.

Lineup does not embed canonical workflow files inside the npm package.
For full details, see [CLI Manager Reference](/reference/cli).

## Install Lineup

Install for all hosts:

```bash
lineup install --host all
```

Install for one host:

```bash
lineup install --host claude
lineup install --host codex
lineup install --host opencode
```

If `--host` is omitted in a TTY, Lineup prompts for host selection.
In non-TTY mode, `--host` is required.

## Update

```bash
lineup update --host all
lineup update --host claude --version latest
```

## Status

```bash
lineup status --host all
lineup status --host all --json
```

`status --json` returns:
- `schema_version`
- `state_file`
- `hosts.<host>.installed`
- `hosts.<host>.version`
- `hosts.<host>.source`
- `hosts.<host>.last_action`
- `hosts.<host>.error` (optional)

## Uninstall

```bash
lineup uninstall --host all
```

Uninstall is interactive by default and always asks for confirmation.

Non-interactive:

```bash
lineup uninstall --host all --yes
```

Purge Lineup-owned data paths:

```bash
lineup uninstall --host all --yes --purge
```

Purge targets:
- `~/.claude/lineup/agents/`
- `~/.codex/lineup/agents/`
- `~/.codex/lineup/memory/`
- `~/.config/opencode/lineup/`

## Notes on host installs

- Claude installs are CLI-managed local marketplace/plugin installs.
- Codex installs are global skills in `$HOME/.agents/skills/lineup-*`.
- OpenCode installs are global skills in `~/.config/opencode/skills/`, one directory per skill.
- Existing legacy Claude marketplace installs are detected and can be migrated.

## Troubleshooting

### `lineup: command not found`

- Ensure your global npm bin is in `PATH`.
- Reinstall: `npm install -g @izantech/lineup-cli`

### Claude status shows a legacy install

Run install and accept migration prompt:

```bash
lineup install --host claude
```

### Codex skills are missing

```bash
lineup status --host codex
lineup install --host codex --yes
```

### OpenCode skills are missing

```bash
lineup status --host opencode
lineup install --host opencode --yes
```

## Next step

Go to [Your First Task](/getting-started/first-task).
