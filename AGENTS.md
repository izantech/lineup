# AGENTS.md

This file is the single source of truth for AI agent instructions in this repository.

## Project Overview

Lineup provides a structured multi-agent workflow:
**Triage -> Clarify -> Research -> Clarification Gate -> Plan -> Implement -> Verify -> Document?**

Stage 0 (Triage) is a lightweight orchestrator-only analysis that classifies complexity, identifies affected areas, and produces search targets before any agent is spawned.

Lineup 2.0 uses a canonical core plus a CLI-managed install flow across Claude Code and Codex CLI.

## Commands

Dev script:

- `./dev check` — run all checks (typecheck, test, schema, generate, build)
- `./dev build` / `./dev typecheck` / `./dev test` — individual checks
- `./dev install local` — build from source and install CLI + all host skills
- `./dev install remote` — install latest from npm
- `./dev install clean [--purge]` — remove CLI and host skills
- `./dev docs` — start VitePress dev server
- `./dev bench [--agent claude|codex|opencode] [--auto-models] [...]` — run Ollama benchmark
- `./dev bench clean` — remove benchmark results
- `./dev clean [--dry-run]` — remove all generated artifacts (build, benchmark, cache)
- `./dev setup` — install dependencies

CLI runtime:

- `lineup install [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup update [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup uninstall [--host claude|codex|opencode|all] [--yes] [--purge]`
- `lineup status [--host claude|codex|opencode|all] [--artifacts] [--json]`
- `lineup run [--workflow <path>] [--tactic <name>] [--from-stage <id>] [--engine auto|native|tf] [--dry-run] [--force-rerun] [--max-parallel <n>] [--isolation index|full|sparse] [--approve-plan] [--json]`
- `lineup runs [--status <status>] [--json]`
- `lineup show <run-id> [--json]`
- `lineup logs <run-id> [--json]`
- `lineup resume <run-id> [--json]`
- `lineup cancel <run-id> [--json]`
- `lineup validate <file> [--kind <kind>] [--json]`
- `lineup artifacts show <kind> [--run <id>] [--json]`
- `lineup artifacts path <kind> [--run <id>]`
- `lineup artifacts diff <kind> [--from <run-id>] [--to <run-id>] [--json]`
- `lineup init [--workflow <name>] [--json]`
- `lineup workflow lint <path> [--json]`
- `lineup workflow list [--json]`
- `lineup tactic new <name>`
- `lineup tactic list [--json]`
- `lineup approve <run-id> [--json]`
- `lineup pending [--json]`
- `lineup completion <bash|zsh|fish>`
- `lineup dag [--workflow <path>] [--json]`

## Architecture

### Canonical + Adapter Model

Lineup avoids prompt drift by keeping one canonical source and generating host artifacts at install time.

```
.lineup-core/skills/**        → Canonical workflow templates (source of truth)
  kick-off/core.md            → Orchestrator core: triage, agent spawning, context flow, rules
  kick-off/init.core.md       → Initialization: overrides, memory migration, tactics, teams
  kick-off/stages-1-3.core.md → Stages 1-3 (Clarify, Research, Gate) + effort mapping
  kick-off/stages-4-5.core.md → Stages 4-5 (Plan, Implement) + stage result caching
  kick-off/stages-6-7.core.md → Stages 6-7 (Verify, Document) + cleanup + ephemeral lifecycle
.lineup-core/hosts/*.json     → Host adapter maps (claude, codex, opencode)
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
- **Effort-based model selection**: Triage complexity drives model assignment per agent role (haiku/sonnet/opus). User overrides act as a floor — they can upgrade but not downgrade below the effort-assigned level.
- **Output compression**: `how_it_works` capped at ~500 words, empty YAML sections omitted, structured lists preferred over prose between stages. Snapshots exceeding ~2 KB are compressed to key findings with file path references.

### Staged Prompt Loading

The kick-off orchestrator prompt is split into on-demand files to reduce upfront token cost:

- `core.md` (SKILL.md) loads at startup: context flow, agent spawning, triage, pipeline tiers, rules
- `stages-1-3.core.md` (STAGES-1-3.md) loads when entering Stage 1
- `stages-4-5.core.md` (STAGES-4-5.md) loads when entering Stage 4
- `stages-6-7.core.md` (STAGES-6-7.md) loads when entering Stage 6

Each stage file is self-contained — the orchestrator reads it before executing that stage group.

### Stage Result Caching

Stage outputs can be cached to `.lineup/.cache/<stage>-<hash>.yaml` for re-run and rollback:

- Cache key: SHA-256 of (task prompt + triage assessment), first 12 hex chars
- On re-run with matching hash, the orchestrator offers to skip the stage
- `--from-stage N` restarts execution at stage N using cached upstream outputs
- Cache files are ephemeral — cleaned up by Pipeline Cleanup

### Transient File Lifecycle

Large intermediate outputs are written to `.lineup/.ephemeral/` instead of passed inline:

- Downstream agents receive file path references (e.g., "Read `.lineup/.ephemeral/research-auth.yaml`")
- Cleanup runs after the reviewer finishes (Stage 6) and again in Pipeline Cleanup
- Never delete transient files before the reviewer finishes

### Snapshot Streaming

Inter-stage context snapshots exceeding 500 bytes are written to `.lineup/.ephemeral/`
as `snapshot-<from>-<to>-<hash>.yaml`. Downstream agents receive a file reference
instead of inline content. Snapshots under 500 bytes remain inline (cheaper than an
extra file read). The threshold applies after compression.

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

### Conditional Ollama Appendices (`agents/*-ollama.md`)

Agents with Ollama integration (researcher, architect) have a separate `*-ollama.md`
appendix file containing all Ollama-specific instructions. The orchestrator appends
these to the spawn prompt only when `OLLAMA_AVAILABLE = true`, saving ~3.6 KB per
agent spawn when Ollama is disabled.

### Lazy Agent Loading

The orchestrator only reads agent definition files for roles the current pipeline
tier will actually spawn:

| Tier | Agents loaded |
|------|---------------|
| Full | researcher, architect, developer, reviewer, documenter |
| Full (no doc) | researcher, architect, developer, reviewer |
| Lightweight | architect, developer, reviewer |
| Direct | none |
| Tactic | only agents in the tactic's stages |

Agent files are read at the latest responsible moment (when spawning that role),
not upfront. In Teams mode, the Team Preamble only writes instruction bodies for
the needed roles.

### Claude Code Teams Mode

When `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set and `TeamCreate` is available,
the kick-off pipeline runs in **teams mode**, subject to a terminal width check:

- **Terminal width gate**: At pipeline start, `tput cols` is run to detect width.
  If the terminal is narrower than 80 columns, Teams mode is disabled and agents
  spawn as standard subagents instead. If `tput` fails, a warning is logged and
  the pipeline continues with Teams mode enabled.

- A session-scoped team named `lineup-<session_id>` is created once during initialization
  (the 6-character `session_id` is generated randomly to isolate concurrent runs).
- All agent spawns use the Agent tool with `team_name="lineup-<session_id>"`,
  `name="<role>-<session_id>"`, and `model=<frontmatter model>`.
- A **Team Preamble** step writes all agent instruction bodies to
  `.lineup/.ephemeral/agent-instructions.md` (one `## <role>` section each) after
  team creation. Spawn prompts reference this file instead of embedding the full
  body inline, reducing per-spawn token cost.
- Teammates are visible as tmux panes named after their role.
- Teammates cannot spawn sub-teammates (nesting is blocked by the platform).
- Tool restrictions from agent frontmatter are advisory only in team mode (known platform limitation).

If `TeamCreate` is not available (e.g., Codex CLI, standard Claude Code without the
experiment flag), the pipeline falls back to the standard subagent path transparently.

### Agent Configuration Overrides

Runtime overrides are persisted outside the repo:

- Claude: `~/.claude/lineup/agents/`
- Codex: `~/.codex/lineup/agents/`
- Opencode: `~/.config/opencode/lineup/agents/`

Override precedence: user override > agent frontmatter defaults.

### Skills / Commands

Command surface is unchanged:

- Claude: `/lineup:kick-off`, `/lineup:configure`, `/lineup:explain`, `/lineup:playbook`, `/lineup:digest`
- Codex: `$lineup-kick-off`, `$lineup-configure`, `$lineup-explain`, `$lineup-playbook`, `$lineup-digest`
- OpenCode: `/lineup-kick-off`, `/lineup-configure`, `/lineup-explain`, `/lineup-playbook`, `/lineup-digest`

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

Tactic composition: a stage can reference another tactic via a `tactic` field (mutually
exclusive with `type`/`agent`). The orchestrator inlines the referenced tactic's stages
before execution. Cycle detection prevents infinite recursion; parent variables override
child defaults.

## Release Process (2.0)

1. Update versions (`cli/package.json`, `.claude-plugin/plugin.json` as needed)
2. Update `CHANGELOG.md`
3. Run checks: `./dev check`
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

Migration for global memory files over 50 KB is incremental — section headers are scanned
first, then only matching sections are read into context.
