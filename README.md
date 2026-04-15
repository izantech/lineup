[![npm version](https://img.shields.io/npm/v/%40izantech%2Flineup-cli)](https://www.npmjs.com/package/@izantech/lineup-cli)
[![GitHub release](https://img.shields.io/github/v/release/izantech/lineup)](https://github.com/izantech/lineup/releases)

# [Lineup](https://lineup.izantech.app)

One pipeline. Every AI coding tool.

Lineup is a native multi-agent pipeline for Claude Code, Codex CLI, and OpenCode. It classifies work, routes stages to the right agent/model, validates artifacts, compiles implementation waves, and persists run state so interrupted work can be resumed and inspected.

Distributed through a single CLI: `lineup`.

Users typically enter Lineup in one of two ways:

- directly in a terminal with `lineup start "<task>"` or `lineup run "<task>"`
- from Claude/Codex/OpenCode through the installed Lineup skill

In both cases, the CLI is the engine. Skills are host-native entrypoints layered on
top of it.

## Install the CLI

```bash
npm install -g @izantech/lineup-cli
```

For native implementation runs, Lineup expects the current project to have at least
one git commit. In a new repo, start with:

```bash
lineup start "Explain the scheduler module for onboarding"
```

`lineup start` scaffolds Lineup if needed, checks git readiness, and stops with the
exact next command if the repo still needs its first commit.

## Manage hosts

```bash
lineup install --host all
lineup update --host all
lineup status --host all
lineup status --host all --artifacts
lineup config --host codex
lineup doctor
lineup uninstall --host opencode
```

### Command surface

```text
lineup install [--host claude|codex|opencode|all] [--version <tag>|latest] [--yes]
lineup update [--host claude|codex|opencode|all] [--version <tag>|latest] [--yes]
lineup uninstall [--host claude|codex|opencode|all] [--yes] [--purge]
lineup status [--host claude|codex|opencode|all] [--artifacts] [--json]
lineup config [show] [--host claude|codex|opencode] [--json]
lineup doctor [--json]
lineup start [task] [--workflow <path>] [--tactic <name>] [--host <host>] [--mode human|host] [--max-parallel <n>] [--isolation <mode>] [--implement-method <method>] [--approve-plan] [--gate-timeout <seconds>]
lineup init [--workflow <name>] [--json]
lineup run [task] [--workflow <path>] [--tactic <name>] [--from-stage <id>] [--dry-run] [--force-rerun] [--max-parallel <n>] [--isolation <mode>] [--mode human|host] [--implement-method <method>] [--approve-plan] [--gate-timeout <seconds>]
lineup bridge start <task> --executor-host <host> [--workflow <path>] [--tactic <name>] [--approve-plan] [--gate-timeout <seconds>] [--json]
lineup bridge events <run-id> --after <seq> --wait <seconds> [--json]
lineup bridge answer <run-id> <request-id> --choice <value> [--reason <text>] [--json]
lineup runs [--status <status>] [--json]
lineup show <run-id> [--watch] [--json]
lineup logs <run-id> [--json]
lineup replay <run-id> [--json]
lineup resume <run-id> [--retry-failed] [--max-retries <n>] [--json]
lineup cancel <run-id> [--json]
lineup validate <file> [--kind <kind>] [--json]
lineup artifacts show|path|diff ...
lineup workflow lint|list ...
lineup tactic new|list|convert ...
lineup approve <run-id> [--json]
lineup pending [--json]
lineup gate respond <run-id> <request-id> --choice <value> [--reason <text>] [--json]
lineup completion <bash|zsh|fish>
lineup dag [--workflow <path>] [--json]
lineup waves [--run <id>] [--compact] [--json]
lineup history [--status <status>] [--limit <n>] [--json]
```

See [docs/commands.md](/Users/izan/Dev/Projects/lineup/docs/commands.md:1) for the full command reference used by the repo and agent docs.

`lineup run` has two execution modes:

- `--mode human` for interactive terminal use. Prompts and progress render for people.
- `--mode host` for raw protocol consumers, advanced integrations, and CI. The CLI emits NDJSON protocol messages on stdout and expects gate responses via `lineup gate respond`.

If `--mode` is omitted, Lineup defaults to `human` on a TTY and `host` otherwise.

Generated skills should prefer the bridge API:

- `lineup bridge start` launches a detached session owned by the CLI
- `lineup bridge events` streams compact `status`, `question`, and `complete` events
- `lineup bridge answer` responds to user questions

Keep `lineup run --mode host` for advanced/custom integrations that need the raw protocol.
Use `lineup gate respond` only for raw host-mode consumers; generated skills should answer via `lineup bridge answer`.

For first-run local usage, prefer `lineup start "<task>"`. It runs `init`-style
scaffolding automatically, checks workflow and git readiness, and only hands off to
the pipeline when the repo is ready. `lineup init` remains available when you want
manual control over scaffolding.

`./dev install local` is a clean replace flow: it removes the previously installed
global CLI, clears managed host installs, installs missing CLI build dependencies if
needed, rebuilds the CLI from source, reinstalls the global package, and regenerates
host skills from the current working tree for detected hosts. Use `./dev install local --host all`
to force every supported host, or `./dev install local --host codex` to target one explicitly.

### Host behavior

| Operation | Claude | Codex | OpenCode |
| --------- | ------ | ----- | -------- |
| Install | CLI-managed local marketplace plugin install | Atomic sync into `$HOME/.agents/skills/lineup-*` | Sync into `~/.config/opencode/skills/` |
| Update | Refresh local marketplace plugin from selected release tag | Re-sync from selected release tag | Re-sync from selected release tag |
| Uninstall | Remove CLI-managed plugin | Remove `$HOME/.agents/skills/lineup-*` | Remove skill directories from `~/.config/opencode/skills/` |
| Status | Detect install + legacy marketplace state | Verify required skill files | Verify required skill files |

## Workflow commands (unchanged)

Claude:
- `/lineup:kick-off`
- `/lineup:configure`
- `/lineup:explain`
- `/lineup:playbook`
- `/lineup:digest`

Codex:
- `$lineup-kick-off`
- `$lineup-configure`
- `$lineup-explain`
- `$lineup-playbook`
- `$lineup-digest`

OpenCode:
- `/lineup-kick-off`
- `/lineup-configure`
- `/lineup-explain`
- `/lineup-playbook`
- `/lineup-digest`

These host wrappers now call the bridge API instead of supervising raw host-mode
NDJSON streams directly. They should preflight workflow and git readiness first,
then start a bridge session, poll `lineup bridge events`, and answer only
`question` events.

The runtime is also defensive about common host output mistakes:

- planner responses that arrive as prose instead of a structured `Plan` get one stricter retry
- fenced JSON/YAML is repaired before validation
- developer responses accept common variants like `status: "done"`
- markdown-style reviewer summaries are normalized into `lineup/v3 Review` YAML

## Canonical source model

Lineup uses canonical templates plus host adapters:

- Canonical templates: `.lineup-core/skills/**`
- Host adapters: `.lineup-core/hosts/*.json`
- Generated host files are install-time artifacts and are not committed to git

## Development

```bash
./dev check                     # Run all checks (typecheck, test, schema, generate, build)
./dev build                     # Build CLI
./dev typecheck                 # Run type checks
./dev test                      # Run test suite
./dev install local             # Build from source and install CLI + detected host skills
./dev install remote            # Install latest from npm
./dev install clean [--purge]   # Remove CLI and host skills
./dev web                       # Start website dev server
./dev setup                     # Install dependencies
```

## Learn more

- [Getting Started](https://lineup.izantech.app/getting-started/)
- [How It Works](https://lineup.izantech.app/how-it-works/)
- [Migration](https://lineup.izantech.app/migration/)
- [Examples](https://lineup.izantech.app/examples/)

## License

MIT
