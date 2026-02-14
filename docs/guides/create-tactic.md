# Create a Tactic

This guide walks through creating a custom [tactic](/concepts/tactics) from scratch by writing YAML directly. By the end, you'll have a working tactic file that defines a reusable workflow for your project.

::: tip
Prefer a guided wizard? Run `/lineup:playbook` to create tactics interactively with validation and formatting handled for you. See [Use Playbook](/guides/use-playbook).
:::

## Step 1: Create the directory

Tactics live in `.lineup/tactics/` inside your project root. Create the directory if it doesn't exist:

```bash
mkdir -p .lineup/tactics
```

## Step 2: Create the YAML file

Create a new file. The filename (without `.yaml`) becomes the tactic's identifier, so use kebab-case:

```bash
touch .lineup/tactics/code-review.yaml
```

::: tip
The `name` field inside the file must match the filename. If the file is `code-review.yaml`, the name must be `code-review`.
:::

## Step 3: Define the top-level fields

Every tactic starts with a name and description:

```yaml
name: code-review
description: |
  Run a structured code review on recent changes. Researches the affected
  code, then has the reviewer validate correctness, test coverage, and
  adherence to project conventions.
```

The description is shown in the tactic selection menu when you run `/lineup:kick-off` without arguments. Keep it to one paragraph -- enough to explain what the tactic does and when to use it.

## Step 4: Define stages

The `stages` field is an ordered list of pipeline stages. Each stage needs a `type` and an `agent`:

```yaml
stages:
  - type: research
    agent: researcher
  - type: verify
    agent: reviewer
```

This two-stage tactic runs a researcher to gather context, then a reviewer to validate the code.

### Available stage types

| Type | Purpose |
| ---- | ------- |
| `clarify` | Ask the user questions to refine requirements |
| `research` | Explore the codebase and gather context |
| `clarification-gate` | Resolve ambiguities found during research |
| `plan` | Create an implementation plan |
| `implement` | Write code following a plan |
| `verify` | Run tests and review the diff |
| `document` | Write or update project documentation |
| `explain` | Produce a pedagogical explanation |

### Available agents

| Agent | Typical stages |
| ----- | -------------- |
| `researcher` | research |
| `architect` | plan |
| `developer` | implement |
| `reviewer` | verify |
| `documenter` | document, implement (for doc-only workflows) |
| `teacher` | explain |

You can pair any agent with any stage type -- these are conventions, not hard rules. For example, the `brownfield-docs` example tactic uses the documenter agent in an `implement` stage.

## Step 5: Add custom prompts

By default, each agent follows its built-in instructions. The `prompt` field lets you add tactic-specific guidance that gets appended to the agent's defaults:

```yaml
stages:
  - type: research
    agent: researcher
    prompt: |
      Focus on the files changed in the most recent commits. Analyze
      their test coverage, error handling, and adherence to project
      conventions. Identify any patterns that deviate from the norm.
  - type: verify
    agent: reviewer
    prompt: |
      Review the changes against project conventions, not a plan.
      Focus on correctness, test coverage, and potential regressions.
      Check for common issues: missing error handling, unclosed resources,
      untested edge cases.
```

The prompt is appended, not a replacement. The agent still follows its core instructions -- your prompt adds focus.

## Step 6: Add orchestration controls (optional)

Two fields control the pipeline flow for individual stages.

### `optional: true`

Marks a stage as skippable. The orchestrator asks the user before running it:

```yaml
  - type: research
    agent: researcher
    optional: true
```

The user sees: "Would you like to run the Research stage?" If they decline, execution skips to the next stage.

### `gate: approval`

Pauses for explicit user approval after the stage completes:

```yaml
  - type: plan
    agent: architect
    gate: approval
```

The user must approve the output before the next stage runs. If they reject, the stage re-runs for revision.

Both can be combined on the same stage:

```yaml
  - type: research
    agent: researcher
    optional: true
    gate: approval
```

This asks the user whether to run the stage, and if they say yes, requires approval of the findings before proceeding.

## Step 7: Add variables (optional)

Variables let users provide input before execution. Define them in the `variables` list and reference them in stage prompts with `${variable_name}`:

```yaml
variables:
  - name: branch
    description: "Which branch or commit range to review?"
    default: "HEAD~5..HEAD"

stages:
  - type: research
    agent: researcher
    prompt: |
      Focus on the changes in ${branch}. Analyze the modified files,
      their test coverage, and adherence to project conventions.
```

Each variable needs:

| Field | Required | Description |
| ----- | -------- | ----------- |
| `name` | Yes | Identifier used in `${name}` substitutions |
| `description` | Yes | Shown to the user when prompting for a value |
| `default` | No | Default value offered as option 1 |

When the tactic runs, the orchestrator prompts the user for each variable before executing any stages.

## Step 8: Add verification criteria (optional)

The `verification` field defines human-readable criteria checked after all stages complete:

```yaml
verification:
  - "No critical issues found in the review"
  - "All tests pass"
  - "Code follows project conventions"
```

If the tactic includes a `verify` stage, the reviewer evaluates these criteria. If there's no `verify` stage, the orchestrator presents them as a manual checklist.

## Step 9: Test the tactic

Run your tactic to make sure it works:

```bash
/lineup:kick-off code-review
```

Or run `/lineup:kick-off` without arguments to see it listed in the selection menu.

If the file has syntax errors or missing required fields, the orchestrator will report the issue. Fix the YAML and try again.

## Complete worked example

Here's the complete `code-review.yaml` tactic built through this guide:

```yaml
name: code-review
description: |
  Run a structured code review on recent changes. Researches the affected
  code, then has the reviewer validate correctness, test coverage, and
  adherence to project conventions.

variables:
  - name: branch
    description: "Which branch or commit range to review?"
    default: "HEAD~5..HEAD"

stages:
  - type: research
    agent: researcher
    prompt: |
      Focus on the changes in ${branch}. Analyze the modified files,
      their test coverage, and adherence to project conventions.
      Identify any patterns that deviate from the norm.
  - type: verify
    agent: reviewer
    prompt: |
      Review the changes against project conventions, not a plan.
      Focus on correctness, test coverage, and potential regressions.
      Check for common issues: missing error handling, unclosed resources,
      untested edge cases.

verification:
  - "No critical issues found in the review"
  - "All tests pass"
  - "Code follows project conventions"
```

When you run `/lineup:kick-off code-review`, the orchestrator:

1. Prompts you for the `branch` variable (default: `HEAD~5..HEAD`)
2. Runs the research stage with the variable substituted into the prompt
3. Runs the verify stage with the reviewer focused on conventions
4. Presents the verification criteria as a checklist

## What's next

- See the [Tactic Schema](/reference/tactic-schema) reference for the full field specification
- Browse [example tactics](https://github.com/izantech/lineup/tree/main/examples/tactics) shipped with the plugin
- Learn about [Built-in Tactics](/concepts/built-in-tactics) that ship with the plugin
