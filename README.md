[![npm version](https://img.shields.io/npm/v/%40izantech%2Flineup-cli)](https://www.npmjs.com/package/@izantech/lineup-cli)
[![GitHub release](https://img.shields.io/github/v/release/izantech/lineup)](https://github.com/izantech/lineup/releases)

# [Lineup](https://lineup.izantech.app)

One pipeline. Every AI coding tool.

Lineup is a native multi-agent pipeline for Claude Code, Codex CLI, and OpenCode. It classifies work, routes stages to the right agent/model, validates artifacts, compiles implementation waves, and persists run state so interrupted work can be resumed and inspected.

Distributed through a single CLI: `lineup`.

## Install the CLI

```bash
npm install -g @izantech/lineup-cli
```

## Manage hosts

```bash
lineup install --host all
lineup update --host all
lineup status --host all
lineup status --host all --artifacts
lineup doctor
lineup uninstall --host opencode
```

### Command surface

```text
lineup install [--host claude|codex|opencode|all] [--version <tag>|latest] [--yes]
lineup update [--host claude|codex|opencode|all] [--version <tag>|latest] [--yes]
lineup uninstall [--host claude|codex|opencode|all] [--yes] [--purge]
lineup status [--host claude|codex|opencode|all] [--artifacts] [--json]
lineup doctor [--json]
lineup init [--workflow <name>] [--json]
lineup run [task] [--workflow <path>] [--tactic <name>] [--dry-run] [--max-parallel <n>] [--isolation <mode>] [--implement-method <method>] [--non-tty] [--json]
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
./dev install local             # Build from source and install CLI + all host skills
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
