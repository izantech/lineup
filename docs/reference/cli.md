# CLI Manager

Lineup 2.0 is distributed as an npm CLI package: `@izantech/lineup-cli`.

## Install

```bash
npm install -g @izantech/lineup-cli
```

## Commands

```bash
lineup install [--host claude|codex|opencode|all] [--version <tag>|latest] [--yes]
lineup update [--host claude|codex|opencode|all] [--version <tag>|latest] [--yes]
lineup uninstall [--host claude|codex|opencode|all] [--yes] [--purge]
lineup status [--host claude|codex|opencode|all] [--json]
```

## Release source model

Install and update do not use embedded workflow files from the npm package.

They resolve a release and download source artifacts from GitHub:

1. Resolve tag (`--version <tag>` or `latest`)
2. Fetch `lineup-manifest.json` (or fallback `release-manifest.json` at that tag)
3. Download release tarball from `manifest.tarball_url`
4. Verify SHA-256 checksum from the manifest
5. Extract canonical source and generate host outputs

Downloaded releases are cached per tag:

- `~/.lineup/cache/<tag>/manifest.json`
- `~/.lineup/cache/<tag>/release.tar.gz`
- `~/.lineup/cache/<tag>/source/`

If a cached tag is present and valid, Lineup reuses it.

## Runtime state and install paths

State file:

- `~/.lineup/state.json`

Claude managed assets:

- `~/.lineup/hosts/claude/plugins/lineup/<version>/`
- `~/.lineup/hosts/claude/marketplace/.claude-plugin/marketplace.json`

Codex managed assets:

- `~/.agents/skills/lineup-kick-off/`
- `~/.agents/skills/lineup-configure/`
- `~/.agents/skills/lineup-explain/`
- `~/.agents/skills/lineup-playbook/`

OpenCode managed assets:

- `~/.config/opencode/skills/lineup-kick-off/`
- `~/.config/opencode/skills/lineup-configure/`
- `~/.config/opencode/skills/lineup-explain/`
- `~/.config/opencode/skills/lineup-playbook/`

Optional uninstall purge targets:

- `~/.claude/lineup/agents/`
- `~/.codex/lineup/agents/`
- `~/.codex/lineup/memory/`
- `~/.config/opencode/lineup/`

## Interactive and non-interactive rules

- If `--host` is omitted:
  - TTY session: prompt for host selection
  - Non-TTY session: command fails and requires `--host`
- `uninstall` requires explicit confirmation:
  - TTY: prompt
  - Non-TTY: requires `--yes`

## JSON status contract

`lineup status --json` returns a stable top-level shape:

- `schema_version`
- `state_file`
- `hosts`

Each host can include:

- `host`
- `installed`
- `version`
- `source`
- `last_action`
- `error` (optional)
