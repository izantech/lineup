# AGENTS.md

This file is the single source of truth for AI agent instructions in this repository.

## Project Overview

Lineup is a Claude Code plugin that provides a structured multi-agent workflow: **Clarify → Research → Clarification Gate → Plan → Implement → Verify → Document?**. It ships specialized subagents, skills, and a pipeline definition as a self-contained plugin directory.

The project is a set of Markdown agent definitions, skills, a plugin manifest, and a workflow reference — no build system, no runtime dependencies.

## Commands

There are no build, lint, or test commands. This is a pure-Markdown plugin.

## Architecture

### Plugin Structure

Lineup is structured as a Claude Code plugin. The `.claude-plugin/plugin.json` manifest provides the `lineup` namespace — all agents and skills are automatically namespaced under `lineup:` when loaded as a plugin.

```
.claude-plugin/plugin.json    → Plugin manifest (name, version, author)
agents/*.md                   → Agent definitions (loaded as lineup:<name>)
skills/kick-off/SKILL.md      → Skill: full pipeline entry point
skills/configure/SKILL.md     → Skill: interactive agent configurator
skills/explain/SKILL.md       → Skill: explain project components (alias for explain tactic)
tactics/*.yaml                → Built-in tactics (shipped with plugin)
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

User customizations are stored as YAML override files in `~/.claude/lineup/agents/`.
These files persist across plugin updates and contain only the frontmatter fields
the user has changed (model, tools, memory).

```
~/.claude/lineup/agents/
  researcher.yaml      ← Override for researcher (e.g., model: sonnet)
  architect.yaml       ← Override for architect (if customized)
```

Override precedence: user override file > plugin agent frontmatter defaults.

The `/lineup:configure` skill writes these files. The `/lineup:kick-off` skill
reads them before spawning agents. If no override file exists for an agent,
plugin defaults are used.

Override files include a `plugin_version` field indicating which plugin version
they were created against. This is informational — overrides are forward-compatible
since they only contain model/tools/memory fields.

### Skills (`skills/`)

Skills are static SKILL.md files that provide slash commands.

| Skill | Path | Command | Purpose |
|-------|------|---------|---------|
| Kick-off | `skills/kick-off/SKILL.md` | `/lineup:kick-off` | Entry point for the full agentic pipeline |
| Configure | `skills/configure/SKILL.md` | `/lineup:configure` | Interactive agent configurator |
| Explain | `skills/explain/SKILL.md` | `/lineup:explain` | Explain project components via researcher + teacher |

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
- All configuration happens via the `/lineup:configure` skill — no external scripts
- Agent plugin files (`agents/*.md`) are immutable at runtime — never edited by skills or users directly
- User customizations live in `~/.claude/lineup/agents/` as YAML override files

## Release Process

When releasing a new version:

1. Update the version in `.claude-plugin/plugin.json`
2. Add a new entry to `CHANGELOG.md` following the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format
3. Commit the changes with a conventional commit message
4. Push to the remote repository
5. Create a GitHub release using `gh`:
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

Agents use `~/.claude/agent-memory/<agent>/` for persistent knowledge -- patterns, conventions, architectural decisions, and debugging insights. This is distinct from document output: memory captures reusable knowledge, not session-specific artifacts.
