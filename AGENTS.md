# AGENTS.md

This file is the single source of truth for AI agent instructions in this repository.

## Project Overview

Lineup is a Claude Code plugin that provides a structured multi-agent workflow: **Clarify → Research → Clarification Gate → Plan → Implement → Verify**. It ships specialized subagents, skills, and a pipeline definition as a self-contained plugin directory.

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
agentic-workflow.md            → Pipeline reference document
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

## Conventions

- Agent names do not use a prefix — the `lineup:` namespace is provided by the plugin manifest
- Frontmatter fields use comma-space separation for tool lists
- All configuration happens via the `/lineup:configure` skill — no external scripts
