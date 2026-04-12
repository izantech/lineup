# Use Explain

This guide covers how to use `/lineup:explain` to get structured explanations of any part of your codebase.

## Basic usage

Type the command followed by a question about your code:

| Host | Command |
| ---- | ------- |
| Claude Code | `/lineup:explain How does the authentication middleware work?` |
| Codex CLI | `$lineup-explain How does the authentication middleware work?` |
| OpenCode | `/lineup-explain How does the authentication middleware work?` |

The skill triggers a two-stage workflow: a researcher explores the relevant code, then a teacher produces a structured, pedagogical explanation.

## What happens behind the scenes

`/lineup:explain` is an alias for the built-in `explain` [tactic](/concepts/built-in-tactics). When you run it:

1. The skill invokes `/lineup:kick-off explain` with your question as the task description
2. The kick-off skill resolves the built-in `explain` tactic from the plugin's `tactics/` directory
3. **Stage 1 (Research):** A researcher agent explores the codebase, focusing on the component, pattern, or decision you asked about. It gathers code, relationships, data flow, and architectural context.
4. **Stage 2 (Explain):** A teacher agent takes the research findings and produces a structured explanation designed for learning.

The output is a YAML document with learning objectives, prerequisites, a structured explanation with code examples from your actual codebase, and suggestions for further exploration.

## What kinds of questions work well

The explain skill works best with questions about how things work, why decisions were made, and how parts of the codebase connect to each other.

### Good questions

```bash
/lineup:explain How does the authentication middleware work?
/lineup:explain What is the data flow from API request to database write?
/lineup:explain Why does the config module use a factory pattern?
/lineup:explain How are database migrations structured in this project?
/lineup:explain What happens when a user submits the checkout form?
/lineup:explain How does the caching layer interact with the database queries?
```

These questions ask about specific components, patterns, flows, or decisions. The researcher knows what to look for, and the teacher can build a clear explanation around it.

### Less effective questions

```bash
/lineup:explain Is this code good?
/lineup:explain What should I work on next?
/lineup:explain How can I improve performance?
```

These are too broad or subjective. The researcher can't focus its exploration, and the teacher doesn't have a clear concept to explain. For these kinds of questions, use `/lineup:kick-off` with a more specific task instead.

## How it differs from asking the main session

You could ask your question directly in the Claude Code (or your host's) session without using the explain skill. The difference is in depth and structure:

| Aspect | Direct question | `/lineup:explain` |
| ------ | --------------- | ------------------- |
| **Research** | The main session reads a few files | A dedicated researcher agent does a thorough exploration |
| **Depth** | Answers from whatever is in context | Answers backed by systematic codebase analysis |
| **Structure** | Free-form response | Structured explanation with learning objectives, sections, and code examples |
| **Code references** | May reference some files | Includes specific file paths and line numbers from the researcher's findings |
| **Memory** | Uses the main session's context | Researcher and teacher build on their persistent agent memory |

For quick questions about something already in context ("what does this function do?"), a direct question is faster. For deeper questions about how systems connect or why things are built a certain way, `/lineup:explain` produces more thorough, better-organized answers.

## Explain vs. kick-off

Both `/lineup:explain` and `/lineup:kick-off` accept a question or task as input. The key difference is intent:

| | `/lineup:explain` | `/lineup:kick-off` |
| - | ------------------- | -------------------- |
| **Purpose** | Understand code | Change code |
| **Output** | A structured explanation | Implemented changes |
| **Modifies files?** | No | Yes |
| **Stages** | Research + Explain | Up to 7 stages |

Use `/lineup:explain` when you want to learn. Use `/lineup:kick-off` when you want to build.

## Broad onboarding with explain-codebase

If you want a full codebase tour rather than an answer to a specific question, use the `explain-codebase` example tactic instead. It produces a structured onboarding guide covering project purpose, directory structure, key modules, data flow, and conventions.

```bash
/lineup:kick-off explain-codebase
```

See the [Codebase Explanation](/examples/codebase-explanation) walkthrough for a complete example of this tactic in action.

## Overriding the built-in explain tactic

If you want the explain workflow to behave differently in your project -- for example, adding a plan stage or changing the researcher's focus -- create a project tactic that overrides the built-in:

```bash
mkdir -p .lineup/tactics
```

Then create `.lineup/tactics/explain.yaml` with your custom stages. A project tactic with the name `explain` takes precedence over the built-in one. See [Create a Tactic](/guides/create-tactic) for detailed instructions.
