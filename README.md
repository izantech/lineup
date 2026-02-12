[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-7c3aed)](https://docs.anthropic.com/en/docs/claude-code)
[![GitHub release](https://img.shields.io/github/v/release/izantech/lineup)](https://github.com/izantech/lineup/releases)

# Lineup

A structured multi-agent workflow that breaks complex tasks into a clear pipeline: **Clarify → Research → Clarification Gate → Plan → Implement → Verify**.

Instead of letting a single agent do everything in one shot, this workflow delegates work to specialized subagents — each with its own tools, model, and persistent memory.

## Why use this?

Most agentic coding sessions follow a pattern: the agent reads some code, makes changes, hopes they work. For simple tasks that's fine. For anything complex, it leads to wasted context, wrong assumptions, and rework.

This workflow adds structure:

- **Clarification** prevents building the wrong thing
- **Research** by dedicated read-only agents keeps exploration out of your main context
- **Planning** with user approval catches issues before any code is written
- **Implementation** follows an approved plan instead of improvising
- **Verification** catches bugs before you even see the result

## What's included

```
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── agentic-workflow.md           # The workflow reference
├── agents/
│   ├── researcher.md             # Read-only codebase explorer (Haiku)
│   ├── architect.md              # Plan creator (Opus)
│   ├── developer.md              # Code implementer (Opus)
│   └── reviewer.md               # Post-implementation verifier (Opus)
├── skills/
│   ├── kick-off/                 # /lineup:kick-off slash command
│   │   └── SKILL.md
│   └── configure/               # /lineup:configure slash command
│       └── SKILL.md
```

## Quick start

### Marketplace install (recommended)

First, register the izantech marketplace (one-time setup):

```bash
claude plugin marketplace add izantech/claude-plugins
```

Then install lineup:

```bash
/plugin install lineup@izantech
```

Update to the latest version anytime:

```bash
claude plugin update lineup@izantech
```

### Manual install

For development or customization, point Claude Code at a local clone:

```bash
git clone https://github.com/izantech/lineup.git
claude --plugin-dir /path/to/lineup
```

This loads all agents and skills automatically. The `lineup:` namespace comes from the plugin name in `plugin.json`.

### Customized install

If you want to tweak agent models, tools, or memory settings:

```bash
git clone https://github.com/izantech/lineup.git
claude --plugin-dir /path/to/lineup
# Then inside Claude Code:
/lineup:configure
```

## The pipeline

```
     [USER REQUEST]
            │
            ▼
   1. CLARIFY ─────── Orchestrator asks questions to refine requirements
            │
            ▼
   2. RESEARCH ────── researcher agents explore the codebase (parallel OK)
            │
            ▼
   [CLARIFICATION GATE] ── Orchestrator resolves ambiguities with user
            │
            ▼
   3. PLAN ────────── architect agent creates an implementation plan
            │
            ▼
   [USER APPROVAL] ── User reviews and approves the plan
            │
            ▼
   4. IMPLEMENT ───── developer agents write code (parallel OK)
            │
            ▼
   5. VERIFY ──────── reviewer agent runs tests and reviews the diff
            │
            ▼
   [USER REVIEWS] ─── User sees the final result
```

### When to use each tier

| Tier | Pipeline | Use when |
|------|----------|----------|
| **Full** | Clarify → Research → Clarification Gate → Plan → Implement → Verify | Complex multi-file changes, unclear requirements, unfamiliar code |
| **Lightweight** | Plan → Implement → Verify | Moderate tasks, scope is understood, single module |
| **Direct** | Just do it | Simple fixes, single file, explicit instructions from user |

## Agent roles

| Role | File | Model | Tools | Purpose |
|------|------|-------|-------|---------|
| Orchestrator | *(main session)* | — | All | Coordinates the pipeline, delegates work |
| Researcher | `researcher.md` | Haiku | Read-only + Web | Explores code, reads docs, gathers context |
| Architect | `architect.md` | Opus | Read-only + Write | Synthesizes findings into actionable plans |
| Developer | `developer.md` | Opus | All | Implements the approved plan |
| Reviewer | `reviewer.md` | Opus | Read-only + Bash | Runs tests, reviews diffs, validates work |

All subagents have **persistent user-level memory** — they accumulate knowledge about your codebases across sessions.

## Skills

Skills are slash commands that trigger predefined workflows. The `lineup:` prefix is provided automatically by the plugin namespace.

| Skill | Command | Description |
|-------|---------|-------------|
| Kick-off | `/lineup:kick-off` | Runs the full agentic pipeline (Clarify → Research → Clarification Gate → Plan → Implement → Verify) |
| Configure | `/lineup:configure` | Interactively customize agent models, tools, and memory settings |

### Usage

Type `/lineup:kick-off` in a Claude Code session followed by your task description. The skill will walk the orchestrator through all pipeline stages, delegating to the appropriate subagents at each step.

```
/lineup:kick-off Refactor the authentication module to use JWT tokens
```

Type `/lineup:configure` to interactively customize agent settings. The skill walks you through model, tool, and memory configuration, previews the changes, and applies them to the agent files.

```
/lineup:configure
```

## Customization

Run `/lineup:configure` inside Claude Code to customize agent settings interactively. The skill walks through:

1. **Current config** — displays each agent's model, tools, and memory scope
2. **What to change** — model, tools, memory, or reset to defaults
3. **Preview** — shows the final frontmatter before writing
4. **Apply** — edits agent files, preserving body content
5. **Confirm** — reports what changed

### What's configurable

| Setting | Scope | Description |
|---------|-------|-------------|
| Model | All agents or per-agent | `haiku`, `sonnet`, or `opus` |
| Tools | Per-agent | Add, remove, or replace tools (e.g. swap `WebSearch` for Brave Search MCP) |
| Memory | All agents or per-agent | `user`, `project`, or `local` |
| Reset | All agents | Restore agent files to defaults |

### Managing agents

Run `/agents` in your coding agent to view, create, edit, or delete subagents interactively.

## Contributing

Contributions are welcome! If you've created useful subagents, improved the workflow, or have feedback from real usage, please open an issue or PR.

Ideas for contributions:
- New subagent roles (e.g., `security-auditor`, `migration-planner`)
- Workflow variations for specific domains (frontend, backend, data)
- Performance benchmarks (tokens used, quality comparisons)

## Credits

The clarification gate, confidence-based review filtering, and multi-option architecture patterns were adapted from the [feature-dev](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/feature-dev) skill for Claude Code.

## License

MIT
