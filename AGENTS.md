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
skills/explain/SKILL.md       → Skill: explain project components
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
- Stages reference existing agents (researcher, architect, developer, reviewer, documenter, teacher)
- Custom prompts in stages are appended to agent defaults, not replacements
- Example tactics available in `examples/tactics/` for common workflows

## Conventions

- Agent names do not use a prefix — the `lineup:` namespace is provided by the plugin manifest
- Frontmatter fields use comma-space separation for tool lists
- All configuration happens via the `/lineup:configure` skill — no external scripts

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
