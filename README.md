[![npm version](https://img.shields.io/npm/v/%40izantech%2Flineup-cli)](https://www.npmjs.com/package/@izantech/lineup-cli)
[![GitHub release](https://img.shields.io/github/v/release/izantech/lineup)](https://github.com/izantech/lineup/releases)

# [Lineup](https://lineup.izantech.app)

Lineup is a structured multi-agent workflow for Claude Code and Codex CLI:
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
lineup uninstall --host codex
```

### Command surface

```text
lineup install [--host claude|codex|all] [--version <tag>|latest] [--yes]
lineup update [--host claude|codex|all] [--version <tag>|latest] [--yes]
lineup uninstall [--host claude|codex|all] [--yes] [--purge]
lineup status [--host claude|codex|all] [--json]
```

### Host behavior

| Operation | Claude | Codex |
| --------- | ------ | ----- |
| Install | CLI-managed local marketplace plugin install | Atomic sync into `$HOME/.agents/skills/lineup-*` |
| Update | Refresh local marketplace plugin from selected release tag | Re-sync from selected release tag |
| Uninstall | Remove CLI-managed plugin | Remove `$HOME/.agents/skills/lineup-*` |
| Status | Detect install + legacy marketplace state | Verify required skill files |

## Workflow commands (unchanged)

Claude:
- `/lineup:kick-off`
- `/lineup:configure`
- `/lineup:explain`
- `/lineup:playbook`

Codex:
- `$lineup-kick-off`
- `$lineup-configure`
- `$lineup-explain`
- `$lineup-playbook`

## Canonical source model

Lineup uses canonical templates plus host adapters:

- Canonical templates: `.lineup-core/skills/**`
- Host adapters: `.lineup-core/hosts/*.json`
- Generated host files are install-time artifacts and are not committed to git

## Validation and checks

```bash
npm --prefix cli run typecheck
npm --prefix cli test
npm --prefix cli run schema:check
npm --prefix cli run generate:check
npm --prefix cli run build
```

## Learn more

- [Getting Started](https://lineup.izantech.app/getting-started/installation)
- [Concepts](https://lineup.izantech.app/concepts/pipeline)
- [Guides](https://lineup.izantech.app/guides/run-kick-off)
- [Reference](https://lineup.izantech.app/reference/agents)
- [Examples](https://lineup.izantech.app/examples/feature-development)

## License

MIT
