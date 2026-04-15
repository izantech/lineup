# @izantech/lineup-cli

Lineup is the shared runtime for Claude Code, Codex CLI, and OpenCode.

It installs host commands, runs the native pipeline, persists run state and artifacts,
and exposes the bridge API used by generated skills.

The runtime also includes a shared terminal UI layer for:

- structured human-mode progress on `stderr`
- `lineup show --watch` dashboards
- richer plain-text bridge output
- consistent interactive gate prompts

## Install

```bash
npm install -g @izantech/lineup-cli
lineup install
```

## First run

```bash
lineup start "Review the auth middleware in src/auth.ts and identify security gaps"
```

`lineup start` is the preferred first-run path in a repo. It scaffolds Lineup if needed,
checks git readiness, and only starts the pipeline once the project is ready.

## Common commands

- `lineup install [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup update [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup status [--host claude|codex|opencode|all] [--artifacts] [--json]`
- `lineup doctor [--json]`
- `lineup start [task] [...]`
- `lineup run [task] [...]`
- `lineup bridge start|events|answer ...`
- `lineup runs [--status <status>] [--json]`
- `lineup show <run-id> [--watch] [--json]`
- `lineup resume <run-id> [--retry-failed] [--skip-task <id>] [--max-retries <n>] [--json]`
- `lineup waves [--run <id>] [--compact] [--json]`
- `lineup history [--status <status>] [--limit <n>] [--json]`

## Runtime model

- `lineup start` and `lineup run` are the normal human-facing entrypoints
- generated skills should prefer `lineup bridge start`, `lineup bridge events`, and `lineup bridge answer`
- `lineup run --mode host` remains available for advanced integrations and CI that need the raw NDJSON protocol
- `lineup show --watch` is the main live operational dashboard for active runs

## Learn more

- Public docs: [https://lineup.izantech.app](https://lineup.izantech.app)
- Commands: [https://github.com/izantech/lineup/blob/main/docs/commands.md](https://github.com/izantech/lineup/blob/main/docs/commands.md)
- Skills: [https://github.com/izantech/lineup/blob/main/docs/skills.md](https://github.com/izantech/lineup/blob/main/docs/skills.md)
