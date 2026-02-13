[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-7c3aed)](https://docs.anthropic.com/en/docs/claude-code)
[![GitHub release](https://img.shields.io/github/v/release/izantech/lineup)](https://github.com/izantech/lineup/releases)

# Lineup

A structured multi-agent workflow that breaks complex tasks into a clear pipeline: **Clarify → Research → Clarification Gate → Plan → Implement → Verify → Document?**.

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
├── agents/
│   ├── researcher.md             # Read-only codebase explorer (Haiku)
│   ├── architect.md              # Plan creator (Opus)
│   ├── developer.md              # Code implementer (Opus)
│   ├── reviewer.md               # Post-implementation verifier (Opus)
│   ├── documenter.md             # Post-verify documentation generator (Opus)
│   └── teacher.md                # Codebase explainer (Opus)
├── skills/
│   ├── kick-off/                 # /lineup:kick-off slash command
│   │   └── SKILL.md
│   ├── configure/               # /lineup:configure slash command
│   │   └── SKILL.md
│   └── explain/                  # /lineup:explain slash command
│       └── SKILL.md
├── templates/
│   ├── researcher.yaml           # Research findings YAML schema
│   ├── architect.yaml            # Implementation plan YAML schema
│   ├── developer.yaml            # Implementation report YAML schema
│   ├── reviewer.yaml             # Review report YAML schema
│   ├── tactic.yaml               # Tactic definition schema
│   ├── documenter.yaml           # Documentation report YAML schema
│   └── teacher.yaml              # Explanation YAML schema
├── examples/
│   └── tactics/                   # Example tactic files to copy into your project
│       ├── brownfield-docs.yaml
│       ├── api-feature.yaml
│       ├── targeted-refactor.yaml
│       └── bug-triage.yaml
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
   [DOCUMENT?] ────── documenter agent writes project docs (optional, user-prompted)
            │
            ▼
   [USER REVIEWS] ─── User sees the final result
```

### When to use each tier

| Tier | Pipeline | Use when |
|------|----------|----------|
| **Full** | Clarify → Research → Clarification Gate → Plan → Implement → Verify → Document? | Complex multi-file changes, unclear requirements, unfamiliar code |
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
| Documenter | `documenter.md` | Opus | Read-only + Write + Web | Generates project documentation after verify |
| Teacher | `teacher.md` | Opus | Read-only + Web | Explains codebase components via /lineup:explain |

All subagents have **persistent user-level memory** — they accumulate knowledge about your codebases across sessions.

## Skills

Skills are slash commands that trigger predefined workflows. The `lineup:` prefix is provided automatically by the plugin namespace.

| Skill | Command | Description |
|-------|---------|-------------|
| Kick-off | `/lineup:kick-off` | Runs the full agentic pipeline (Clarify → Research → Clarification Gate → Plan → Implement → Verify → Document?) |
| Configure | `/lineup:configure` | Interactively customize agent models, tools, and memory settings |
| Explain | `/lineup:explain` | Get a structured explanation of any project component |

### Usage

Type `/lineup:kick-off` in a Claude Code session followed by your task description. The skill will walk the orchestrator through all pipeline stages, delegating to the appropriate subagents at each step.

```
/lineup:kick-off Refactor the authentication module to use JWT tokens
```

Type `/lineup:configure` to interactively customize agent settings. The skill walks you through model, tool, and memory configuration, previews the changes, and applies them to the agent files.

```
/lineup:configure
```

Type `/lineup:explain` followed by a question about any part of the codebase. The skill delegates to the teacher agent, which explores the code and returns a structured explanation.

```
/lineup:explain How does the authentication middleware work?
```

## Tactics

Tactics are per-project reusable workflows. Instead of running the full 7-stage pipeline
every time, you can define a custom sequence of agents and stages tailored to a specific
task pattern.

### Creating a tactic

1. Create `.lineup/tactics/` in your project root
2. Add a YAML file (e.g., `brownfield-docs.yaml`). See `templates/tactic.yaml` for the schema.

Example -- `brownfield-docs.yaml`:

```yaml
name: brownfield-docs
description: |
  Generate missing documentation for an existing codebase. Skips clarification
  (docs are always needed) and implementation (no code changes). Focuses on finding
  documentation gaps, planning doc structure, and writing the docs.

stages:
  - type: research
    agent: researcher
    prompt: |
      Focus on documentation gaps: missing READMEs, undocumented public APIs,
      stale architecture docs, missing setup guides. Catalog what exists and
      what is missing.
  - type: plan
    agent: architect
    prompt: |
      Create a documentation plan based on the research findings. Prioritize
      the most impactful gaps. Define what documents to create or update.
  - type: implement
    agent: documenter

verification:
  - "README.md exists and covers project setup"
  - "All public API endpoints are documented"
  - "Architecture overview document exists"
```

### Running a tactic

```
/lineup:kick-off brownfield-docs
```

Or run `/lineup:kick-off` with no arguments to see available tactics and choose one.

### Tactic schema

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier in kebab-case (must match the filename without `.yaml`) |
| `description` | Yes | One-paragraph summary shown during tactic selection |
| `stages` | Yes | Ordered list of stages to execute (see below) |
| `verification` | No | List of human-readable criteria checked after execution |
| `variables` | No | List of variables prompted before execution (see below) |

**Stage fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Pipeline stage: `clarify`, `research`, `clarification-gate`, `plan`, `implement`, `verify`, `document` |
| `agent` | Yes | Agent to invoke: `researcher`, `architect`, `developer`, `reviewer`, `documenter`, `teacher` |
| `prompt` | No | Custom instructions appended to the agent's defaults (not a replacement) |

**Variable fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Variable identifier used in `${name}` substitutions within stage prompts |
| `description` | Yes | Shown to the user when prompting for the value |
| `default` | No | Default value offered as option 1 during prompting |

Full annotated schema: [`templates/tactic.yaml`](templates/tactic.yaml)

### Example tactics

The `examples/tactics/` directory contains ready-to-use tactic files. Copy any of them into your project:

```bash
mkdir -p .lineup/tactics
cp /path/to/lineup/examples/tactics/api-feature.yaml .lineup/tactics/
```

| Tactic | Stages | Use case |
|--------|--------|----------|
| [`brownfield-docs`](examples/tactics/brownfield-docs.yaml) | Research, Plan, Implement (documenter) | Generate missing docs for an existing codebase |
| [`api-feature`](examples/tactics/api-feature.yaml) | Research, Plan, Implement, Verify | Add a new API endpoint following existing conventions |
| [`targeted-refactor`](examples/tactics/targeted-refactor.yaml) | Research, Plan, Implement, Verify | Refactor a specific module with variable targeting |
| [`bug-triage`](examples/tactics/bug-triage.yaml) | Research, Plan, Implement, Verify | Investigate and fix a reported bug with regression tests |

The `targeted-refactor` and `bug-triage` tactics demonstrate **variables** -- the orchestrator prompts for values like `target_module` or `bug_description` before execution.

### Adding `.lineup/` to .gitignore

Tactics are project-specific configuration. Whether to commit them is up to your team:

- **Commit them** if tactics are shared workflow standards for your project
- **Gitignore them** if they are personal workflow preferences

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
