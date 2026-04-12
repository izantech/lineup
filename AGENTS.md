# AGENTS.md

This file is the single source of truth for AI agent instructions in this repository.

## Project Overview

Lineup is a multi-agent pipeline for Claude Code, Codex CLI, and OpenCode that picks the right model for every task — automatically.

Pipeline: **Triage -> Clarify -> Research -> Clarification Gate -> Plan -> Implement -> Verify -> Document?**

Stage 0 (Triage) classifies complexity, identifies affected areas, and produces search targets before any agent is spawned. Distributed via a single CLI (`lineup`) across all supported hosts.

## Commands

Dev script:

- `./dev check` — run all checks (typecheck, test, schema, generate, build)
- `./dev build` / `./dev typecheck` / `./dev test` — individual checks
- `./dev install local` — build from source and install CLI + all host skills
- `./dev install remote` — install latest from npm
- `./dev install clean [--purge]` — remove CLI and host skills
- `./dev web` — start website dev server (Astro + Starlight)
- `./dev bench [--agent claude|codex|opencode] [--auto-models] [...]` — run Ollama benchmark
- `./dev bench clean` — remove benchmark results
- `./dev clean [--dry-run]` — remove all generated artifacts (build, benchmark, cache)
- `./dev setup` — install dependencies

CLI runtime:

- `lineup install [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup update [--host claude|codex|opencode|all] [--version <tag>|latest] [--from-dir <path>] [--yes]`
- `lineup uninstall [--host claude|codex|opencode|all] [--yes] [--purge]`
- `lineup status [--host claude|codex|opencode|all] [--artifacts] [--json]`
- `lineup run [--workflow <path>] [--tactic <name>] [--from-stage <id>] [--dry-run] [--force-rerun] [--max-parallel <n>] [--isolation index|full|sparse] [--approve-plan] [--gate-timeout <seconds>] [-i|--interactive] [--json]`
- `lineup runs [--status <status>] [--json]`
- `lineup show <run-id> [-w|--watch] [--json]`
- `lineup logs <run-id> [--json]`
- `lineup replay <run-id> [--json]`
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
.lineup-core/skills/**        → Canonical skill templates (source of truth)
  kick-off/core.md            → Lean CLI wrapper: launch pipeline, handle gates, present results
  kick-off/init.core.md       → Pre-flight: override detection, tactic selection, health check
  configure/core.md           → Agent config customization (models, tools, memory, Ollama)
  digest/core.md              → Codebase onboarding digest generator
  playbook/core.md            → Tactic CRUD manager
  explain/core.md             → Explain alias (delegates to CLI tactic)
.lineup-core/hosts/*.json     → Host adapter maps (claude, codex, opencode)
agents/*.md                   → Shared agent definitions
tactics/*.yaml                → Built-in tactics
templates/*.yaml              → YAML format references
cli/                          → Lineup CLI package (pipeline engine, install/update/uninstall)
```

Generated host outputs are **not committed** to git:

- Claude skill files are generated into the CLI-managed local plugin directory during install/update.
- Codex skill files are generated and synced into `$HOME/.agents/skills/lineup-*`.

### CLI Package (`cli/`)

`cli/` is the source of truth for distribution and host lifecycle management.

Key internals:

- `cli/src/cli.ts` — Commander command registration and dispatch
- `cli/src/commands/*.ts` — install/update/uninstall/status/gate handlers
- `cli/src/lib/run-pipeline.ts` — Pipeline orchestration engine with gate blocking
- `cli/src/lib/protocol.ts` — NDJSON protocol types (gate/request, gate/respond, agent/spawn)
- `cli/src/lib/gate-store.ts` — Gate request/response file persistence, `GateTimeoutError`
- `cli/src/lib/interactive-gate.ts` — Interactive stdin gate handler for `--interactive` mode
- `cli/src/lib/verification.ts` — Auto-detect and run project test/typecheck/lint hooks
- `cli/src/lib/tactic-convert.ts` — Tactic-to-Workflow auto-converter
- `cli/src/lib/release.ts` — GitHub release resolution, cache, checksum verification
- `cli/src/lib/generate.ts` — template rendering using host adapters
- `cli/src/lib/host-claude.ts` — Claude lifecycle and migration handling
- `cli/src/lib/host-codex.ts` — Codex global skill sync/uninstall/status
- `cli/src/lib/validation.ts` — AJV + YAML parsing + schema checks + agent output validation
- `cli/src/lib/dag.ts` — Task compilation, cross-cutting detection, read-write dependency analysis
- `cli/src/commands/replay.ts` — Pipeline run narrative replay
- `cli/schemas/**` — JSON/YAML schemas

### Triage-Driven Pipeline Optimizations

Stage 0 (Triage) produces a lightweight assessment that drives downstream behavior:

- **Research scoping**: Researchers receive concrete search targets (directories, file patterns, questions) from the triage assessment instead of deriving scope from scratch.
- **Conditional approach analysis**: Simple tasks get 1 approach in the Plan stage (no multi-approach comparison); moderate/complex tasks get 2-3.
- **Parallel architects**: When 2+ independent areas are detected, separate architect agents spawn in parallel. The orchestrator merges their outputs into a single master plan.
- **Effort-based model selection**: Triage complexity drives model assignment per agent role (haiku/sonnet/opus). User overrides act as a floor — they can upgrade but not downgrade below the effort-assigned level.
- **Output compression**: `how_it_works` capped at ~500 words, empty YAML sections omitted, structured lists preferred over prose between stages. Snapshots exceeding ~2 KB are compressed to key findings with file path references.
- **Triage analysis**: The triage stage runs `git diff --stat HEAD` and counts project files to produce a structured assessment (file count, changed files, insertions, deletions). This data feeds into research scoping and model selection.
- **Verification hooks**: Before the reviewer agent runs, the pipeline auto-detects test/typecheck/lint commands from `package.json` scripts and Makefile targets, executes them (120s timeout each), and feeds structured results (exit code, stdout, stderr, duration) to the reviewer as additional context.
- **Agent output validation**: After each `agent/done` message, agent outputs are validated against schemas in `cli/schemas/yaml/agent-output/`. On validation failure, a `stage/warning` is emitted and the agent is optionally retried if stage retry settings allow.

### Task Compilation

The plan-to-task compiler in `dag.ts` converts architect plans into executable task DAGs:

- **Cross-cutting detection**: Changes touching >3 files with the same extension in the same directory tree are kept as a single task instead of being split per-file
- **Read-write dependency edges**: If change A writes to a file that change B reads from, B depends on A (sequential waves). Write-write overlaps go to the same wave (serial).
- **Wave assignment**: Independent changes with no overlap run in the same wave (parallel). Read-write overlaps produce sequential waves.

### Lean Skill Architecture

Skills are thin CLI wrappers (~12 KB total, down from ~100 KB). The kick-off skill:

1. Runs `lineup run --json` (or `lineup run --tactic <name> --json`)
2. Reads NDJSON protocol messages from stdout
3. Handles `gate/request` messages by asking the user and calling `lineup gate respond`
4. Presents `pipeline/complete` results

All pipeline orchestration (agent spawning, DAG scheduling, state, artifacts) lives in the CLI.
Stages 1-3 (clarify, research, gate) emit `gate/request` with typed `gateType` fields.
The skill maps each gate type to the appropriate user interaction pattern.

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

### Gate Protocol

The CLI emits `gate/request` messages via NDJSON when user interaction is needed.
Each gate has a typed `gateType` field:

| gateType | Stage | Purpose |
|----------|-------|---------|
| `clarify` | Clarify | Structured questions about the request |
| `clarification` | Gate | Research-driven ambiguity resolution |
| `approval` | Plan-approval | Plan approve/reject |
| `cache` | Any cached stage | Use cached results or re-run |
| `verify-decision` | Verify | Retry failed tasks, accept with warnings, or abort |
| `custom` | Tactic-defined | Custom gate from tactic `gate: approval` |

The skill reads `gate/request` from stdout, asks the user, then calls
`lineup gate respond <run-id> <request-id> --choice <value>`. The CLI
writes pending gate files to `.lineup/runs/<id>/gates/` and blocks until
a response file appears (atomic write via temp+rename).

**Interactive mode** (`--interactive`): Gates are handled via stdin prompts instead of
file-based polling, making Lineup usable without a host skill. Each gate type maps to
a readline prompt (approval → Y/n, clarify → free text, verify-decision → numbered menu).

**Gate timeout** (`--gate-timeout <seconds>`): On timeout, the pipeline saves state as
`blocked` (not `failed`) and exits cleanly. Blocked runs can be resumed with `lineup resume`.

**Retry UX**: When verification fails (`FAIL` or `PASS_WITH_WARNINGS`), a `verify-decision`
gate presents three options: retry (re-runs only failed tasks within the same run), accept
with warnings (pipeline continues), or abort (marks failed).

### Tactic Auto-Conversion

Existing tactics (simple `name/stages/verification` format) are automatically
converted to `Workflow` format when `lineup run --tactic <name>` is invoked:

- Linear stages → DAG with sequential dependencies
- `optional: true` → `optional` flag on workflow stage
- `gate: approval` → inserted approval stage
- `verification` → appended verify stage with reviewer agent
- `variables` → workflow variables

Use `lineup tactic convert <name>` to preview the conversion.

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
