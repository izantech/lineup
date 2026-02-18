[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-7c3aed)](https://docs.anthropic.com/en/docs/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex%20CLI-skills-10a37f)](https://developers.openai.com/codex)
[![GitHub release](https://img.shields.io/github/v/release/izantech/lineup)](https://github.com/izantech/lineup/releases)

# [Lineup](https://lineup.izantech.app)

A structured multi-agent workflow for Claude Code and Codex CLI that breaks complex tasks into
a clear pipeline: **Clarify, Research, Plan, Implement, Verify, Document**.

Instead of letting a single agent do everything in one shot, Lineup delegates work
to specialized subagents -- each with its own tools, model, and persistent memory.

**[Read the full documentation →](https://lineup.izantech.app)**

> Installer wrapper and Codex global install support described below are planned for the next major release (**2.0.0**).  
> Current marketplace release (`1.5.0`) remains Claude-first.

## Quick Start (Lineup CLI Wrapper)

Install the `lineup` wrapper command (bootstrap):

```bash
curl -fsSL https://raw.githubusercontent.com/izantech/lineup/main/scripts/install-lineup.sh | bash
```

If bootstrap reports `missing scripts/lineup.mjs`, the latest published tag does not yet include installer artifacts. Use `node scripts/lineup.mjs ...` from a clone until the next release tag is published.

Install Lineup for both hosts:

```bash
lineup install --host all
```

Common operations:

```bash
lineup update --host all
lineup status --host all
lineup uninstall --host codex
lineup uninstall --host all --purge
```

## Host Command Matrix

| Operation | Claude backend | Codex backend |
| --------- | -------------- | ------------- |
| Install | `claude plugin marketplace add izantech/claude-plugins` + `claude plugin install lineup@izantech` | Copy release `.agents/skills/lineup-*` to `$HOME/.agents/skills/` |
| Update | `claude plugin update lineup@izantech` | Re-sync `$HOME/.agents/skills/lineup-*` from release |
| Uninstall | `claude plugin remove lineup@izantech` | Remove `$HOME/.agents/skills/lineup-*` |
| Status | `claude plugin list` | Verify required skill files in `$HOME/.agents/skills/` |

## Existing Workflow Commands (Unchanged)

Claude commands:
- `/lineup:kick-off`
- `/lineup:configure`
- `/lineup:explain`
- `/lineup:playbook`

Codex commands:
- `$lineup-kick-off`
- `$lineup-configure`
- `$lineup-explain`
- `$lineup-playbook`

## Native Host Install Paths (without wrapper)

### Claude marketplace

```bash
claude plugin marketplace add izantech/claude-plugins
claude plugin install lineup@izantech
```

### Codex repo-local mode

Run Codex from this repository root (`.agents/skills/` is discovered locally):

```bash
codex
```

## Generated Host Files

Lineup uses a canonical source plus generated host adapters to avoid prompt drift.

- Canonical templates: `.lineup-core/skills/**`
- Host adapters: `.lineup-core/hosts/claude.json`, `.lineup-core/hosts/codex.json`
- Generated outputs:
  - Claude plugin skill files: `skills/**`
  - Codex skill files: `.agents/skills/**`

Do not edit generated files directly. Edit canonical templates, then run:

```bash
node scripts/sync-host-files.mjs
node scripts/check-host-files.mjs
```

## Learn More

- [Getting Started](https://lineup.izantech.app/getting-started/installation) -- Installation and first task
- [Concepts](https://lineup.izantech.app/concepts/pipeline) -- How the pipeline, agents, and tactics work
- [How-To Guides](https://lineup.izantech.app/guides/run-kick-off) -- Step-by-step task guides
- [Reference](https://lineup.izantech.app/reference/agents) -- Complete configuration reference
- [Examples](https://lineup.izantech.app/examples/feature-development) -- Real walkthroughs with output

## Credits

The clarification gate, confidence-based review filtering, and multi-option
architecture patterns were adapted from the
[feature-dev](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/feature-dev)
skill for Claude Code.

## License

MIT
