# Skill Commands

This is the complete reference for Lineup's skill commands. For a conceptual overview, see [Skills](/concepts/skills).

## Overview

Skills are slash commands provided by the Lineup plugin. Each skill is a `SKILL.md` file in the plugin's `skills/` directory. The `lineup:` namespace prefix comes from the plugin name in `.claude-plugin/plugin.json`.

| Command | Skill file | Purpose |
| ------- | ---------- | ------- |
| `/lineup:kick-off` | `skills/kick-off/SKILL.md` | Run the agentic pipeline or a tactic |
| `/lineup:configure` | `skills/configure/SKILL.md` | Customize agent settings interactively |
| `/lineup:explain` | `skills/explain/SKILL.md` | Get a structured codebase explanation |
| `/lineup:playbook` | `skills/playbook/SKILL.md` | Create, edit, import, or delete tactics |

## `/lineup:kick-off`

The main entry point for all Lineup workflows.

### Syntax

```bash
/lineup:kick-off [task-description | tactic-name]
```

### Arguments

| Argument | Required | Description |
| -------- | -------- | ----------- |
| `task-description` | No | Free-text description of the work to do |
| `tactic-name` | No | Name of a tactic to execute (kebab-case, matches a `.yaml` filename) |

If no argument is provided, the skill enters menu mode.

### Behavior

**With a task description:** The orchestrator evaluates the description, selects a [pipeline tier](/concepts/pipeline-tiers) based on complexity, and runs the appropriate stages.

```bash
/lineup:kick-off Refactor the authentication module to use JWT tokens
```

**With a tactic name:** The orchestrator looks for the named tactic in `.lineup/tactics/` (project) and the plugin's `tactics/` directory (built-in). If found, it runs the tactic's stage sequence. If not found, it reports the error and lists available tactics.

```bash
/lineup:kick-off brownfield-docs
```

**With no arguments (menu mode):** If tactics exist (project or built-in), the orchestrator presents a selection menu showing each tactic's name and description, plus options for the default pipeline and custom input. If no tactics exist, it prompts for a task description.

```bash
/lineup:kick-off
```

### Pipeline stages

When running the default pipeline, kick-off executes up to 7 stages:

| Stage | Name | Agent | User interaction |
| ----- | ---- | ----- | ---------------- |
| 1 | Clarify | Orchestrator | Answers structured questions |
| 2 | Research | Researcher | None (wait for findings) |
| 3 | Clarification Gate | Orchestrator | Answers follow-up questions |
| 4 | Plan | Architect | **Must approve** before implementation |
| 5 | Implement | Developer | None (wait for changes) |
| 6 | Verify | Reviewer | Reviews the report |
| 7 | Document (optional) | Documenter | Opts in or skips |

Stages may be skipped depending on the selected tier. See [Pipeline Tiers](/concepts/pipeline-tiers).

### Tactic execution

When a tactic is selected, its stage list replaces the default pipeline entirely. The orchestrator:

1. Prompts for variable values (if the tactic defines `variables`)
2. Executes each stage in order, respecting `optional` and `gate` controls
3. Passes context between stages (upstream output feeds downstream)
4. Presents `verification` criteria after all stages complete

Stage labels use the tactic's count: a 3-stage tactic shows "Stage 1/3", "Stage 2/3", "Stage 3/3".

### Rules

- The orchestrator never implements code itself -- it delegates to the developer agent
- The orchestrator never does deep exploration -- it delegates to the researcher agent
- User approval is always required before moving from Plan to Implement
- AskUserQuestion is used for all user decisions in Clarify, Clarification Gate, and Document stages

## `/lineup:configure`

Interactive agent configurator.

### Syntax

```bash
/lineup:configure
```

### Arguments

None. The skill is fully interactive.

### Behavior

The configurator walks through five steps:

| Step | What happens |
| ---- | ------------ |
| 1. Read | Reads all agent files and displays current frontmatter as a summary table |
| 2. Ask | Presents configuration categories (model, tools, memory, reset) and collects choices |
| 3. Preview | Shows the final frontmatter for each agent that will change |
| 4. Apply | Writes override YAML files to `~/.claude/lineup/agents/` |
| 5. Confirm | Reports what changed (which agents, which fields, old and new values) |

### Configuration categories

| Category | Options |
| -------- | ------- |
| Model | Keep defaults, set one for all agents, set per-agent |
| Tools | Replace tools, add tools, remove tools, no changes |
| Memory | Keep defaults, set one for all agents, set per-agent |
| Reset | Restore all agents to factory defaults |

### What it modifies

Writes override files to `~/.claude/lineup/agents/` containing only the fields you changed (model, tools, memory). Never modifies agent `.md` files.

### Validation

- Models must be `haiku`, `sonnet`, or `opus`
- Memory must be `user`, `project`, or `local`
- Tools are comma-space separated strings
- A preview is always shown before changes are written
- User confirmation is required before applying

### Default values (used by Reset)

| Agent | Model | Memory | Tools |
| ----- | ----- | ------ | ----- |
| researcher | haiku | project | Read, Grep, Glob, LS, WebFetch, WebSearch |
| architect | opus | project | Read, Grep, Glob, LS, Write |
| developer | opus | project | Read, Grep, Glob, LS, Edit, Write, Bash, NotebookEdit |
| reviewer | opus | project | Read, Grep, Glob, LS, Bash |
| documenter | opus | project | Read, Grep, Glob, LS, Write, WebFetch |
| teacher | opus | project | Read, Grep, Glob, LS, WebFetch, WebSearch |

## `/lineup:explain`

Structured codebase explanation via the built-in `explain` tactic.

### Syntax

```bash
/lineup:explain <question>
```

### Arguments

| Argument | Required | Description |
| -------- | -------- | ----------- |
| `question` | Yes | A question about a project component, pattern, or decision |

### Behavior

This skill is an alias. It invokes `/lineup:kick-off explain` with the user's question as the task description. The kick-off skill resolves the built-in `explain` tactic and executes its two stages:

1. **Research:** A researcher agent explores the codebase, focusing on the topic the user asked about
2. **Explain:** A teacher agent produces a structured explanation based on the research findings

### Output

A YAML document following the `templates/teacher.yaml` schema, containing:
- Learning objectives
- Prerequisites
- Structured explanation with code examples from the actual codebase
- Suggestions for further exploration

The output is ephemeral -- it appears in the conversation and is not written to any file.

### What questions work best

Questions about specific components, patterns, data flows, and architectural decisions produce the best results. See [Use Explain](/guides/use-explain) for examples of effective questions.

### Override

Create `.lineup/tactics/explain.yaml` in your project to override the built-in explain tactic with a custom workflow.

## `/lineup:playbook`

Interactive tactic management wizard.

### Syntax

```bash
/lineup:playbook
```

### Arguments

None. The skill is fully interactive.

### Behavior

The playbook skill walks through up to eight steps depending on the mode selected:

| Step | What happens |
| ---- | ------------ |
| 1. Discover | Reads tactic schema, example templates, project tactics, and built-in tactics |
| 2. Mode | Presents mode selection: Create, Import, Edit, Delete |
| 3. Name/desc | Collects tactic name (kebab-case) and description |
| 4. Stage builder | Guides through building an ordered list of stages |
| 5. Verification | Collects human-readable verification criteria |
| 6. Variables | Defines variables with cross-reference validation |
| 7. Validate | Runs schema and semantic validation, shows YAML preview |
| 8. Write | Writes the tactic to `.lineup/tactics/<name>.yaml` |

Steps 3-7 are skipped or adapted depending on the mode.

### Modes

| Mode | Steps used | Description |
| ---- | ---------- | ----------- |
| Create | 3, 4, 5, 6, 7, 8 | Build a new tactic from scratch |
| Import | Selection + optional 3-7, 8 | Copy an example template, optionally customize |
| Edit | Selection + targeted 3-7, 8 | Modify an existing project tactic |
| Delete | Selection, confirmation | Remove a project tactic |

### Stage types and conventional agents

The stage builder presents these type-agent pairings as defaults:

| Type | Default agent |
| ---- | ------------- |
| `clarify` | `researcher` |
| `research` | `researcher` |
| `clarification-gate` | `architect` |
| `plan` | `architect` |
| `implement` | `developer` |
| `verify` | `reviewer` |
| `document` | `documenter` |
| `explain` | `teacher` |

Any agent can be paired with any stage type -- these are conventions, not constraints.

### Common stage patterns

The stage builder offers five pre-built patterns as starting points:

| Pattern | Stages |
| ------- | ------ |
| Research-first | research, plan, implement, verify |
| Quick fix | plan, implement, verify |
| Documentation pass | research, plan, document |
| Full pipeline with controls | research (optional), plan (gate: approval), implement, verify, document (optional) |
| Investigation only | research, explain |

### Validation

**Schema validation** (blocks write):
- Name is kebab-case, 3-50 characters, matches filename
- Description is non-empty
- At least one stage exists
- Stage types and agent names are valid
- Variable names are snake_case
- All `${variable_name}` references resolve to defined variables

**Semantic validation** (warns only):
- `verify` stage without verification criteria
- Verification criteria without a `verify` stage
- `implement` stage without a preceding `plan` stage
- `plan` stage without `gate: approval`
- Unused defined variables
- `implement` as the first stage

### What it modifies

Writes, renames, or deletes files in `.lineup/tactics/` only. Never modifies plugin example files (`examples/tactics/`) or built-in tactics (`tactics/`).

### Rules

- Preview and explicit confirmation are required before every write
- Example tactics and built-in tactics are read-only
- Rename in edit mode writes the new file before deleting the old one
- YAML formatting matches the example tactics exactly (header comments, pipe-blocks, field order)
- AskUserQuestion is used for all decisions
