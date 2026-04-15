[![npm version](https://img.shields.io/npm/v/%40izantech%2Flineup-cli)](https://www.npmjs.com/package/@izantech/lineup-cli)
[![GitHub release](https://img.shields.io/github/v/release/izantech/lineup)](https://github.com/izantech/lineup/releases)

# [Lineup](https://lineup.izantech.app)

One pipeline. Every AI coding tool.

Lineup is a native multi-agent pipeline for Claude Code, Codex CLI, and OpenCode. It classifies work, routes stages to the right agent/model, validates artifacts, compiles implementation waves, and persists run state so interrupted work can be resumed and inspected.

There are two frontends:

- `lineup` or `lineup tui` opens the human TUI in an interactive terminal
- `lineup <subcommand>` stays the operator and automation surface for scripts, host wrappers, and CI

## Install

```bash
npm install -g @izantech/lineup-cli
```

## Start in a terminal

```bash
lineup
```

Use `lineup tui` when you want the explicit TUI entrypoint, and `--no-tui` when you want classic text output in an interactive shell. Non-interactive shells stay on the operator surface automatically. The TUI should surface readiness checks, recent runs, the selected run, and the same persistent state that powers inspection and recovery commands.

Human launches now auto-initialize a repo on first run. If the project does not have Lineup scaffolding yet, Lineup creates the workflow/runtime files and initializes git when needed before starting the pipeline. `lineup init` remains available when you want to do that setup explicitly.

## Common operator commands

- `lineup doctor --json`
- `lineup status --json`
- `lineup run --mode host`
- `lineup bridge start|events|answer`
- `lineup show <run-id>`
- `lineup logs <run-id>`
- `lineup resume <run-id>`
- `lineup cancel <run-id>`
- `lineup artifacts show|path|diff`
- `lineup workflow lint|list`
- `lineup tactic new|list|convert`

See [docs/commands.md](docs/commands.md) for the compact command reference.

## Bridge contract

Generated skills should use the bridge API, not raw host supervision:

- `lineup bridge start` launches a detached session owned by the CLI
- `lineup bridge events` streams compact `status`, `question`, and `complete` events
- `lineup bridge answer` responds to user questions

Keep `lineup run --mode host` for advanced integrations and CI that need the raw NDJSON protocol. Use `lineup gate respond` only for raw host-mode consumers; generated skills should answer via `lineup bridge answer`.

The bridge JSON contract is stable and machine-owned. `lineup bridge events --json` keeps:

- `runId`
- `events`
- `nextCursor`
- `terminal`
- `status`

It also returns:

- `session` — session metadata for reconnect-safe rendering
- `pendingQuestion` — the unresolved question even if no new `question` event is in the current page
- `recovery` — the concrete next step: `answer`, `resume`, or `inspect`

The interactive TUI is the same human entrypoint that should let you start a run, answer gates, inspect artifacts, and recover blocked work without leaving the terminal. The command surface remains the source of truth for automation, generated skills, and bridge consumers.

## Development

```bash
./dev check                     # Run all checks (typecheck, test, schema, generate, build)
./dev build                     # Build CLI
./dev typecheck                 # Run type checks
./dev test                      # Run test suite
./dev tui                       # Launch the local-source TUI in the caller's project without a global install
./dev install local             # Build from source and install CLI + detected host skills
./dev install remote            # Install latest from npm
./dev install clean [--purge]   # Remove CLI and host skills
./dev web                       # Start website dev server
./dev setup                     # Install dependencies
```

## Learn more

- [CLI overview](docs/cli-overview.md)
- [TUI guide](docs/tui.md)
- [Commands](docs/commands.md)
- [Gate protocol](docs/gate-protocol.md)
- [Getting Started](https://lineup.izantech.app/getting-started/)
- [How It Works](https://lineup.izantech.app/how-it-works/)
- [Migration](https://lineup.izantech.app/migration/)
- [Examples](https://lineup.izantech.app/examples/)

## License

MIT
