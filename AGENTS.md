# AGENTS.md

This file is the single source of truth for AI agent instructions in this repository.

## Project Overview

Lineup provides a structured multi-agent workflow: **Clarify → Research → Clarification Gate → Plan → Implement → Verify → Document?** across Claude Code and Codex CLI. It ships specialized subagents, skills, and a pipeline definition with host-specific wrappers generated from one canonical source.

The project is a set of Markdown agent definitions, canonical skill templates, generated host skill files, a plugin manifest, and a workflow reference — no runtime dependencies.

## Commands

Core commands:

- `node scripts/sync-host-files.mjs` — render generated Claude and Codex skill files from `.lineup-core/`
- `node scripts/check-host-files.mjs` — fail if generated host files drift from canonical source
- `node scripts/lineup.mjs <install|update|uninstall|status> ...` — cross-host Lineup installer wrapper (Claude marketplace + Codex global skills)
- `bash scripts/install-lineup.sh [--version <tag>]` — bootstrap installer for a local `lineup` shim (`~/.local/bin/lineup`)

## Architecture

### Host Structure

Lineup is maintained as canonical templates plus generated host adapters:

```
.lineup-core/skills/**        → Canonical host-neutral skill templates (source of truth)
.lineup-core/hosts/*.json     → Host adapter variable maps (claude, codex)
scripts/sync-host-files.mjs   → Generator that renders host files
scripts/check-host-files.mjs  → Drift checker for generated host files
scripts/lineup*.mjs           → Cross-host installer/update/status wrapper implementation
scripts/install-lineup.sh     → Bootstrap shim installer for end users
skills/**                     → Generated Claude skill files (plugin targets)
.agents/skills/**             → Generated Codex skill files
.claude-plugin/plugin.json    → Claude plugin manifest (lineup namespace)
agents/*.md                   → Shared agent definitions
tactics/*.yaml                → Built-in tactics
templates/*.yaml              → YAML schemas for agent output documents
```

### Agent Definitions (`agents/*.md`)

Each agent is a Markdown file with YAML frontmatter:

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

The frontmatter fields are:
- `name`: agent role name
- `color`: display color for visual identification (valid: `blue`, `green`, `yellow`, `red`; officially supported but may have rendering issues: `cyan`, `magenta`)
- `description`: one-line summary
- `tools`: comma-space separated list (e.g. `Read, Grep, Glob, LS`)
- `model`: one of `haiku`, `sonnet`, `opus`
- `memory`: one of `user`, `project`, `local`

The body (everything after the second `---`) contains the agent's instructions and is preserved as-is during configuration.

### Agent Configuration Overrides

User customizations are stored as YAML override files in host-specific user directories:
- Claude: `~/.claude/lineup/agents/`
- Codex: `~/.codex/lineup/agents/`

These files persist across updates and contain only the frontmatter fields
the user has changed (model, tools, memory).

```
~/.claude/lineup/agents/ (Claude example)
  researcher.yaml      ← Override for researcher (e.g., model: sonnet)
  architect.yaml       ← Override for architect (if customized)
```

Override precedence: user override file > plugin agent frontmatter defaults.

The configure workflow (`/lineup:configure` or `$lineup-configure`) writes these files.
The kick-off workflow (`/lineup:kick-off` or `$lineup-kick-off`) reads them before spawning
agents. If no override file exists for an agent, defaults are used.

Override files include a `plugin_version` field indicating which plugin version
they were created against. This is informational — overrides are forward-compatible
since they only contain model/tools/memory fields.

### Skills

Workflows are defined once in `.lineup-core/skills/**` and generated for each host.

| Workflow | Claude target | Codex target | Commands |
|-------|------|---------|---------|
| Kick-off | `skills/kick-off/SKILL.md` | `.agents/skills/lineup-kick-off/SKILL.md` | Claude: `/lineup:kick-off` · Codex: `$lineup-kick-off` |
| Configure | `skills/configure/SKILL.md` | `.agents/skills/lineup-configure/SKILL.md` | Claude: `/lineup:configure` · Codex: `$lineup-configure` |
| Explain | `skills/explain/SKILL.md` | `.agents/skills/lineup-explain/SKILL.md` | Claude: `/lineup:explain` · Codex: `$lineup-explain` |
| Playbook | `skills/playbook/SKILL.md` | `.agents/skills/lineup-playbook/SKILL.md` | Claude: `/lineup:playbook` · Codex: `$lineup-playbook` |

### Tactics (`.lineup/tactics/`)

Tactics are per-project reusable workflow definitions. They let users define custom
agent sequences that the kick-off skill can discover and execute.

- Stored as YAML files in `.lineup/tactics/` within the project directory
- Schema documented in `templates/tactic.yaml`
- Discovered automatically by `/lineup:kick-off`
- Each tactic defines: `name`, `description`, `stages`, `verification`, and optional `variables`
- Stages support orchestration controls: `optional` (ask before running) and `gate: approval` (pause after)
- Example tactics available in `examples/tactics/` for common workflows

### Built-in Tactics (`tactics/`)

Built-in tactics are shipped with the plugin in the `tactics/` directory (distinct from
per-project `.lineup/tactics/`). They provide common workflows out of the box.

- Discovered automatically by `/lineup:kick-off` alongside project tactics
- Project tactics with the same name override built-in tactics
- Current built-in tactics: `explain`

The explain skill (`/lineup:explain`) is an alias that runs the built-in `explain` tactic
via kick-off.

Each stage in the `stages` list accepts the following fields:

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Pipeline stage: `clarify`, `research`, `clarification-gate`, `plan`, `implement`, `verify`, `document`, `explain` |
| `agent` | Yes | Agent to invoke: `researcher`, `architect`, `developer`, `reviewer`, `documenter`, `teacher` |
| `prompt` | No | Custom instructions appended to agent defaults |
| `optional` | No | If `true`, orchestrator asks user before running this stage (default: `false`) |
| `gate` | No | If `approval`, orchestrator pauses for explicit user approval after this stage completes |

## Conventions

- Agent names do not use a prefix — the `lineup:` namespace is provided by the plugin manifest
- Frontmatter fields use comma-space separation for tool lists
- All configuration happens via the configure workflow (`/lineup:configure` or `$lineup-configure`)
- Agent files (`agents/*.md`) are immutable at runtime — never edited by skills or users directly
- User customizations live in `~/.claude/lineup/agents/` as YAML override files
- Generated host skill files are immutable by convention — never edit `skills/**` or `.agents/skills/**` directly
- Edit canonical templates in `.lineup-core/skills/**`, then run `node scripts/sync-host-files.mjs`

## Release Process

When releasing a new version:

1. Run `node scripts/sync-host-files.mjs`
2. Run `node scripts/check-host-files.mjs` and confirm no drift
3. Update the version in `.claude-plugin/plugin.json`
4. Add a new entry to `CHANGELOG.md` following the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format
5. Commit the changes with a conventional commit message
6. Push to the remote repository
7. Validate installer wrapper against release semantics:
   - `node scripts/lineup.mjs status --host all --json`
   - Confirm bootstrap script references latest release install path (`scripts/install-lineup.sh`)
8. Create a GitHub release using `gh`:
   ```bash
   gh release create <version> --title "<version>" --notes "$(cat <<'EOF'
   ## <Descriptive Title>

   <Paste the CHANGELOG content for this version here>
   EOF
   )"
   ```

Example:
```bash
gh release create 1.3.0 --title "1.3.0" --notes "$(cat <<'EOF'
## Persistent Configuration and Built-in Tactics

### Added
- Feature descriptions...
EOF
)"
```

When shipping installer wrapper + Codex global install support, release as a major (`2.0.0+`).

## Document Conventions

Agents produce structured documents during pipeline execution (research findings, plans, implementation reports, reviews). These follow a standardized YAML format for consistency and parseability.

### Ephemeral by Default

All agent documents are **ephemeral** -- they exist in the conversation context and are passed between agents by the orchestrator. No files are written to the project directory unless the user explicitly requests it. This avoids polluting projects with tool-specific artifacts.

### YAML Format

All agent output follows YAML schemas defined in `templates/`:

| Template | Agent | Document Type |
|----------|-------|---------------|
| `templates/researcher.yaml` | researcher | Research findings |
| `templates/architect.yaml` | architect | Implementation plan |
| `templates/developer.yaml` | developer | Implementation report |
| `templates/reviewer.yaml` | reviewer | Review report |
| `templates/documenter.yaml` | documenter | Documentation report |
| `templates/teacher.yaml` | teacher | Explanation |

Every document includes these core fields:

| Field | Required | Values | Description |
|-------|----------|--------|-------------|
| type | Yes | `research`, `plan`, `implementation`, `review`, `documentation`, `explanation` | Document type |
| agent | Yes | `researcher`, `architect`, `developer`, `reviewer`, `documenter`, `teacher` | Producing agent |
| date | Yes | `YYYY-MM-DD` | Creation date |
| topic | Yes | kebab-case string | Short topic label |
| status | Yes | varies by type | Document status |
| pipeline_stage | Yes | `2`, `4`, `5`, `6`, `7`, `null` | Pipeline stage number |
| plan_ref | Conditional | filename string | Required for `implementation` and `review` types |

**Status values by type**:
- research: `complete`
- plan: `draft`, `approved`, `superseded`
- implementation: `complete`
- review: `PASS`, `FAIL`, `PASS_WITH_WARNINGS`
- documentation: `complete`
- explanation: `complete`

### Persistence

All documents are **fully ephemeral**:

| Document | Storage | Purpose |
|----------|---------|---------|
| Research findings | Conversation context | Passed to architect as input |
| Implementation plan | Conversation context | Passed to developer and reviewer as input |
| Implementation report | Conversation context | Passed to reviewer as input |
| Review report | Conversation context | Presented to user in conversation |
| Documentation report | Conversation context + project files | Documenter writes docs to project; report is ephemeral |
| Explanation | Conversation context | Presented to user in conversation |

If the user wants to save any document for future reference, they can copy it from the conversation.

### Agent Memory (Cross-Session Knowledge)

Agents use persistent memory for cross-session knowledge -- patterns, conventions, architectural decisions, and debugging insights. This is distinct from document output: memory captures reusable knowledge, not session-specific artifacts.

Memory scope defaults to `project` (scoped to the current project). The three scopes and their storage locations:

| Scope | Storage location |
| ----- | ---------------- |
| `user` | `~/.claude/agent-memory/<agent>/` |
| `project` | `~/.claude/projects/<project-path>/agent-memory/<agent>/` |
| `local` | `.lineup/memory/<agent>/` |

When the kick-off skill detects global memory (`~/.claude/agent-memory/<agent>/`) containing project-specific knowledge, it automatically migrates matching sections to the project-scoped memory path. This is a one-time migration per project.

### Agent Persistent Memory Instructions

Every agent has a persistent memory directory whose contents survive across conversations.

- Store **project-specific knowledge** in project-scoped memory: patterns, conventions,
  architectural decisions, key file locations, and insights unique to this project.
- If you also have user-scoped memory, store **cross-project knowledge** there: general
  language idioms, universal techniques, and framework patterns that apply to any codebase.

### Agent Document Output Instructions

Every agent structures its output as YAML following the schema in its corresponding
`templates/<agent>.yaml` file from this plugin's directory. Present the YAML directly in
your response -- do not write it to a file unless explicitly requested. The orchestrator
passes your structured output to downstream agents as context.
