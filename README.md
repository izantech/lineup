[![npm version](https://img.shields.io/npm/v/%40izantech%2Flineup-cli)](https://www.npmjs.com/package/@izantech/lineup-cli)
[![GitHub release](https://img.shields.io/github/v/release/izantech/lineup)](https://github.com/izantech/lineup/releases)

# [Lineup](https://lineup.izantech.app)

Lineup is a structured multi-agent workflow for Claude Code, Codex CLI, and OpenCode:
**Triage -> Clarify -> Research -> Clarification Gate -> Plan -> Implement -> Verify -> Document**.

Lineup 2.0 is distributed through a single CLI manager: `lineup`.

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
lineup run [--workflow <path>] [--dry-run] [--json]
```

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
./dev docs                      # Start docs dev server
./dev setup                     # Install dependencies
```

## Upgrading from 1.x

If you are using Lineup 1.x via the Claude marketplace, see the [Migration Guide](https://lineup.izantech.app/guides/migration-v2) for step-by-step upgrade instructions. The CLI detects legacy installs automatically and handles the transition.

## Learn more

- [Getting Started](https://lineup.izantech.app/getting-started/installation)
- [Concepts](https://lineup.izantech.app/concepts/pipeline)
- [Guides](https://lineup.izantech.app/guides/run-kick-off)
- [Reference](https://lineup.izantech.app/reference/agents)
- [Examples](https://lineup.izantech.app/examples/feature-development)

## License

MIT
