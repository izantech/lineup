# Built-in Tactics

Built-in tactics are workflows that ship with the Lineup plugin itself. They provide common patterns out of the box, without requiring any setup in your project.

## How they differ from project tactics

| | Built-in tactics | Project tactics |
| - | ---------------- | --------------- |
| **Location** | Plugin's `tactics/` directory | Your project's `.lineup/tactics/` directory |
| **Maintained by** | Lineup plugin authors | You and your team |
| **Available in** | Every project using Lineup | Only the project that contains them |
| **Requires setup** | No | Yes (create `.lineup/tactics/` and add YAML files) |

## Discovery

When you run `/lineup:kick-off`, the orchestrator discovers tactics from two sources:

1. **Plugin built-in**: reads all `.yaml` files from the plugin's own `tactics/` directory
2. **Project tactics**: reads all `.yaml` files from `.lineup/tactics/` in the current working directory

Both lists are merged and presented together in the tactic selection menu. From the user's perspective, built-in and project tactics look the same.

## Override precedence

If a project tactic has the same `name` as a built-in tactic, **the project version takes precedence**. The built-in version is silently replaced.

This means you can:
- Use built-in tactics as-is for common workflows
- Override a built-in tactic by creating a project tactic with the same name and different stages
- Extend the set by adding project tactics alongside built-ins

For example, if you want the `explain` tactic to include a plan stage in your project, create `.lineup/tactics/explain.yaml` with your custom stages. It will replace the built-in `explain` tactic for that project only.

## Current built-in tactics

### `explain`

A two-stage workflow that combines codebase research with pedagogical explanation.

```yaml
name: explain
description: |
  Get a clear explanation of any project component, pattern, or decision.
  Combines codebase research with pedagogical explanation.

stages:
  - type: research
    agent: researcher
    prompt: |
      Focus the research on the specific component, pattern, or decision
      the user wants to understand. Gather relevant code, relationships,
      data flow, and architectural context.
  - type: explain
    agent: teacher
    prompt: |
      Produce a structured, pedagogical explanation based on the research
      findings. Include the user's original question for focus.
```

**Stages:**
1. **Research** -- The researcher agent explores the codebase, focusing on whatever the user asked about. It gathers code, relationships, data flow, and architectural context.
2. **Explain** -- The teacher agent takes the research findings and produces a structured explanation designed for learning.

**How it's used:** The `/lineup:explain` skill is an alias that runs this tactic via `/lineup:kick-off explain`. When you type:

```bash
/lineup:explain How does the authentication middleware work?
```

Behind the scenes, the explain skill invokes kick-off with the `explain` tactic name, which resolves to this built-in tactic (unless your project overrides it).

## For plugin contributors: adding new built-in tactics

If you're contributing to Lineup and want to add a new built-in tactic:

1. Create a new `.yaml` file in the plugin's `tactics/` directory (not `examples/tactics/`).
2. Follow the [tactic schema](/reference/tactic-schema) -- same format as project tactics.
3. The name must be unique among built-in tactics.
4. Consider whether the tactic warrants a dedicated skill alias (like `explain` has `/lineup:explain`). If so, create a matching `skills/<name>/SKILL.md` that delegates to kick-off with the tactic name.
5. Update the AGENTS.md built-in tactics section to list the new tactic.

Built-in tactics should represent broadly useful patterns that benefit most projects. Project-specific workflows belong in `examples/tactics/` as copyable examples, not as built-ins.
