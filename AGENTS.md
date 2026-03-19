# AGENTS.md

This file is the single source of truth for AI agent instructions in this repository.

## Project Overview

Lineup provides a structured multi-agent workflow:
**Triage -> Clarify -> Research -> Clarification Gate -> Plan -> Implement -> Verify -> Document?**

Stage 0 (Triage) is a lightweight orchestrator-only analysis that classifies complexity, identifies affected areas, and produces search targets before any agent is spawned.

Lineup 2.0 uses a canonical core plus a CLI-managed install flow across Claude Code and Codex CLI.

## Commands

Repository checks:

- `npm --prefix cli run typecheck`
- `npm --prefix cli test`
- `npm --prefix cli run schema:check`
- `npm --prefix cli run generate:check`
- `npm --prefix cli run build`

CLI runtime:

- `lineup install [--host claude|codex|all] [--version <tag>|latest] [--yes]`
- `lineup update [--host claude|codex|all] [--version <tag>|latest] [--yes]`
- `lineup uninstall [--host claude|codex|all] [--yes] [--purge]`
- `lineup status [--host claude|codex|all] [--json]`

## Architecture

### Canonical + Adapter Model

Lineup avoids prompt drift by keeping one canonical source and generating host artifacts at install time.

```
.lineup-core/skills/**        → Canonical workflow templates (source of truth)
.lineup-core/hosts/*.json     → Host adapter maps (claude, codex)
agents/*.md                   → Shared agent definitions
tactics/*.yaml                → Built-in tactics
templates/*.yaml              → YAML format references
cli/                          → Lineup CLI package (install/update/uninstall/status)
```

Generated host outputs are **not committed** to git:

- Claude skill files are generated into the CLI-managed local plugin directory during install/update.
- Codex skill files are generated and synced into `$HOME/.agents/skills/lineup-*`.

### CLI Package (`cli/`)

`cli/` is the source of truth for distribution and host lifecycle management.

Key internals:

- `cli/src/cli.ts` — Commander command registration and dispatch
- `cli/src/commands/*.ts` — install/update/uninstall/status handlers
- `cli/src/lib/release.ts` — GitHub release resolution, cache, checksum verification
- `cli/src/lib/generate.ts` — template rendering using host adapters
- `cli/src/lib/host-claude.ts` — Claude lifecycle and migration handling
- `cli/src/lib/host-codex.ts` — Codex global skill sync/uninstall/status
- `cli/src/lib/validation.ts` — AJV + YAML parsing + schema checks
- `cli/schemas/**` — JSON/YAML schemas

### Triage-Driven Pipeline Optimizations

Stage 0 (Triage) produces a lightweight assessment that drives downstream behavior:

- **Research scoping**: Researchers receive concrete search targets (directories, file patterns, questions) from the triage assessment instead of deriving scope from scratch.
- **Conditional approach analysis**: Simple tasks get 1 approach in the Plan stage (no multi-approach comparison); moderate/complex tasks get 2-3.
- **Parallel architects**: When 2+ independent areas are detected, separate architect agents spawn in parallel. The orchestrator merges their outputs into a single master plan.
- **Output compression**: `how_it_works` capped at ~500 words, empty YAML sections omitted, structured lists preferred over prose between stages.

### Agent Definitions (`agents/*.md`)

Each agent file has YAML frontmatter:

```markdown
---
name: <role>
color: <color>
description: <one-line>
tools: <comma-separated>
model: haiku|sonnet|opus
memory: user|project|local
---

<Agent instructions>
```

Frontmatter fields:

- `name`: role name
- `color`: visual color (`blue`, `green`, `yellow`, `red`; `cyan`, `magenta` may render inconsistently)
- `description`: one-line summary
- `tools`: comma-space separated list
- `model`: `haiku`, `sonnet`, or `opus`
- `memory`: `user`, `project`, or `local`

### Claude Code Teams Mode

When `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set and `TeamCreate` is available,
the kick-off pipeline runs in **teams mode**:

- A session-scoped team named `lineup-<session_id>` is created once during initialization
  (the 6-character `session_id` is generated randomly to isolate concurrent runs).
- All agent spawns use the Agent tool with `team_name="lineup-<session_id>"`,
  `name="<role>-<session_id>"`, and `model=<frontmatter model>`.
- Because custom agent definitions (frontmatter + body) are silently dropped by the
  teams runtime when `team_name` is specified, the orchestrator reads each agent's
  `.md` file and embeds the body instructions directly in the `prompt` parameter.
- Teammates are visible as tmux panes named after their role.
- Teammates cannot spawn sub-teammates (nesting is blocked by the platform).
- Tool restrictions from agent frontmatter are advisory only in team mode (known platform limitation).

If `TeamCreate` is not available (e.g., Codex CLI, standard Claude Code without the
experiment flag), the pipeline falls back to the standard subagent path transparently.

### Agent Configuration Overrides

Runtime overrides are persisted outside the repo:

- Claude: `~/.claude/lineup/agents/`
- Codex: `~/.codex/lineup/agents/`

Override precedence: user override > agent frontmatter defaults.

### Skills / Commands

Command surface is unchanged:

- Claude: `/lineup:kick-off`, `/lineup:configure`, `/lineup:explain`, `/lineup:playbook`
- Codex: `$lineup-kick-off`, `$lineup-configure`, `$lineup-explain`, `$lineup-playbook`

## Data and Schema Conventions

### YAML (human-authored)

- Canonical workflow templates: `.lineup-core/skills/**/*.md`
- Tactics: `.lineup/tactics/*.yaml` and built-ins in `tactics/*.yaml`
- YAML restrictions: no anchors, aliases, merge keys, or custom tags
- Validation flow: parse YAML -> validate with JSON Schema

### JSON (machine-owned)

- Host adapters: `.lineup-core/hosts/*.json`
- Installer state: `~/.lineup/state.json`
- Release manifest/checksum metadata

All are validated with JSON Schema in CI and runtime paths.

## Tactics

Project tactics:

- Stored in `.lineup/tactics/`
- Schema reference: `templates/tactic.yaml`
- Discovered by kick-off
- Define `name`, `description`, `stages`, `verification`, optional `variables`

Built-ins live in `tactics/`. Project tactics override built-ins by matching `name`.

## Release Process (2.0)

1. Update versions (`cli/package.json`, `.claude-plugin/plugin.json` as needed)
2. Update `CHANGELOG.md`
3. Run checks:
   - `npm --prefix cli run typecheck`
   - `npm --prefix cli test`
   - `npm --prefix cli run schema:check`
   - `npm --prefix cli run generate:check`
   - `npm --prefix cli run build`
4. Commit and push
5. Create GitHub release tag
6. Publish npm package via GitHub Actions OIDC (workflow checks tag/version alignment)

## Document Conventions

Agent outputs are YAML-structured and **ephemeral by default** (conversation context unless explicitly requested to persist).

Template references:

- `templates/researcher.yaml`
- `templates/architect.yaml`
- `templates/developer.yaml`
- `templates/reviewer.yaml`
- `templates/documenter.yaml`
- `templates/teacher.yaml`

Status values:

- research: `complete`
- plan: `draft`, `approved`, `superseded`
- implementation: `complete`
- review: `PASS`, `FAIL`, `PASS_WITH_WARNINGS`
- documentation: `complete`
- explanation: `complete`

## Memory

Default memory scope is `project`.

Storage locations:

- `user`: `~/.claude/agent-memory/<agent>/`
- `project`: `~/.claude/projects/<project-path>/agent-memory/<agent>/`
- `local`: `.lineup/memory/<agent>/`

Use project memory for project-specific knowledge; user memory for cross-project knowledge.
