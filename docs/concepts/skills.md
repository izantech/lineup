# Skills

Skills are slash commands provided by a Claude Code plugin. Lineup ships three skills that serve as entry points into different workflows.

## What is a skill?

In Claude Code, a skill is a `SKILL.md` file inside a plugin's `skills/` directory. When the plugin loads, each skill becomes a slash command that users can invoke. The skill file contains instructions that tell the orchestrator what to do when the command is run.

## The `lineup:` namespace

All Lineup skills are prefixed with `lineup:` automatically. This comes from the plugin name in `.claude-plugin/plugin.json`:

```json
{
  "name": "lineup",
  ...
}
```

When Claude Code loads the plugin, it discovers `skills/kick-off/SKILL.md` and registers it as `/lineup:kick-off`. You don't need to type the namespace yourself in the skill files -- it's added by the plugin system.

## Available skills

### `/lineup:kick-off`

The main entry point. Runs the full agentic pipeline: Clarify, Research, Clarification Gate, Plan, Implement, Verify, Document.

```bash
/lineup:kick-off Refactor the authentication module to use JWT tokens
```

You can also pass a tactic name to run a specific workflow:

```bash
/lineup:kick-off brownfield-docs
```

Or run it with no arguments to see available [tactics](/concepts/tactics) and choose one:

```bash
/lineup:kick-off
```

The orchestrator decides how much of the pipeline to run based on the task complexity. Simple tasks may skip straight to implementation; complex tasks get the full treatment. See [Pipeline Tiers](/concepts/pipeline-tiers) for details.

### `/lineup:configure`

Interactively customize agent settings. Walks you through changing models, tools, and memory scope for any or all agents.

```bash
/lineup:configure
```

The configurator shows current settings, asks what you want to change, previews the result, and applies changes to the agent files. See [Customize Agents](/guides/customize-agents) for a detailed walkthrough.

### `/lineup:explain`

Get a structured explanation of any project component, pattern, or decision. This skill is an alias that runs the built-in `explain` [tactic](/concepts/built-in-tactics) via kick-off.

```bash
/lineup:explain How does the authentication middleware work?
```

Behind the scenes, this triggers a two-stage workflow: a researcher explores the relevant code, then a teacher produces a structured, pedagogical explanation. See [Use Explain](/guides/use-explain) for usage details.

## When to use each skill

| Situation | Skill |
| --------- | ----- |
| Building a feature, fixing a bug, refactoring code | `/lineup:kick-off` |
| Running a defined project workflow | `/lineup:kick-off <tactic-name>` |
| Changing agent models, tools, or memory | `/lineup:configure` |
| Understanding unfamiliar code or architecture | `/lineup:explain` |

## Skill reference

For the complete specification of each skill's behavior, stages, and rules, see the [Skill Commands](/reference/skills) reference.
