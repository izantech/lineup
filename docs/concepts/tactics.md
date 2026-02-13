# Tactics

Tactics are per-project reusable workflow definitions. Instead of running the full 7-stage pipeline every time, you can define a custom sequence of agents and stages tailored to a specific task pattern.

## What is a tactic?

A tactic is a YAML file that describes:
- A **name** and **description** for the workflow
- An ordered list of **stages** to execute
- Optional **verification criteria** to check after execution
- Optional **variables** the user fills in before the workflow starts

When you run `/lineup:kick-off` with a tactic, the tactic's stage list replaces the default pipeline entirely. The same agents and context-passing mechanisms apply, but the stages and their order come from the tactic.

## A simple example

Here's a tactic that generates missing documentation for an existing codebase:

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

This tactic runs three stages (Research, Plan, Implement) instead of the full seven. The research and plan stages get custom prompts to focus on documentation. The implement stage uses the documenter agent instead of the developer.

## Where to put tactics

Create a `.lineup/tactics/` directory in your project root and add YAML files there:

```text
your-project/
  .lineup/
    tactics/
      brownfield-docs.yaml
      api-feature.yaml
      targeted-refactor.yaml
```

The kick-off skill discovers tactics automatically -- no registration or configuration needed.

## Running a tactic

Three ways to run a tactic:

```bash
# Run a specific tactic by name
/lineup:kick-off brownfield-docs

# See all available tactics and choose
/lineup:kick-off

# Run the default pipeline (no tactics)
/lineup:kick-off Add input validation to the login form
```

When you run `/lineup:kick-off` without arguments and tactics exist, the orchestrator presents a selection menu showing each tactic's name and description, plus options for the default pipeline and custom input.

## The YAML schema

### Top-level fields

| Field | Required | Description |
| ----- | -------- | ----------- |
| `name` | Yes | Unique identifier in kebab-case (must match the filename without `.yaml`) |
| `description` | Yes | One-paragraph summary shown during tactic selection |
| `stages` | Yes | Ordered list of stages to execute |
| `verification` | No | List of human-readable criteria checked after execution |
| `variables` | No | List of variables prompted before execution |

### Stage fields

Each entry in the `stages` list accepts:

| Field | Required | Description |
| ----- | -------- | ----------- |
| `type` | Yes | Pipeline stage: `clarify`, `research`, `clarification-gate`, `plan`, `implement`, `verify`, `document`, `explain` |
| `agent` | Yes | Agent to invoke: `researcher`, `architect`, `developer`, `reviewer`, `documenter`, `teacher` |
| `prompt` | No | Custom instructions appended to the agent's defaults (not a replacement) |
| `optional` | No | If `true`, the orchestrator asks the user before running this stage (default `false`) |
| `gate` | No | Set to `"approval"` to pause for explicit user approval after this stage completes |

### Variable fields

Each entry in the `variables` list accepts:

| Field | Required | Description |
| ----- | -------- | ----------- |
| `name` | Yes | Variable identifier used in `${name}` substitutions within stage prompts |
| `description` | Yes | Shown to the user when prompting for the value |
| `default` | No | Default value offered as option 1 during prompting |

## Orchestration controls

Two stage fields give tactics fine-grained control over the pipeline flow.

### `optional: true`

The orchestrator asks the user before running this stage. If the user declines, the stage is skipped and execution continues with the next one.

Use this for stages that are valuable but not always needed -- like research when the user already knows the codebase, or documentation when the changes are minor.

```yaml
- type: research
  agent: researcher
  optional: true       # "Would you like to run the Research stage?"
```

### `gate: approval`

After the stage completes, the orchestrator presents the agent's output and waits for the user to explicitly approve before moving on. If the user rejects, the stage is re-run for revision.

Use this for checkpoint stages where the output shapes everything downstream -- like plan approval before implementation.

```yaml
- type: plan
  agent: architect
  gate: approval       # User must approve the plan before implementation begins
```

### Combining both

Both fields can be combined on the same stage. An optional research stage with an approval gate first asks the user whether to run it, and if they say yes, requires approval of the findings before proceeding:

```yaml
- type: research
  agent: researcher
  optional: true
  gate: approval
```

## Variable substitution

Variables let tactics accept user input before execution. Define them in the `variables` list, and reference them in stage prompts with `${variable_name}`:

```yaml
name: targeted-refactor
description: Refactor a specific module with focused research and testing.

variables:
  - name: target_module
    description: "Which module should be refactored?"
    default: "src/"

stages:
  - type: research
    agent: researcher
    prompt: |
      Focus research on the ${target_module} module. Analyze its structure,
      dependencies, and test coverage.
  - type: plan
    agent: architect
  - type: implement
    agent: developer
  - type: verify
    agent: reviewer
```

When the tactic runs, the orchestrator prompts the user for each variable's value before executing any stages. The default value is offered as option 1.

## Verification criteria

The `verification` field defines human-readable criteria that are evaluated after all stages complete:

```yaml
verification:
  - "All new public APIs have JSDoc comments"
  - "README.md has been updated with new feature section"
  - "No existing tests are broken"
```

If the tactic includes a `verify` stage, the reviewer agent evaluates these criteria against the implementation. If there's no `verify` stage, the orchestrator presents them as a manual checklist for the user.

## Committing tactics to your project

Whether to commit `.lineup/tactics/` is up to your team:

- **Commit them** if tactics are shared workflow standards for your project
- **Gitignore them** if they are personal workflow preferences

## Example tactics

Lineup ships example tactics in the `examples/tactics/` directory. Copy any of them into your project:

```bash
mkdir -p .lineup/tactics
cp /path/to/lineup/examples/tactics/api-feature.yaml .lineup/tactics/
```

| Tactic | Stages | Use case |
| ------ | ------ | -------- |
| `brownfield-docs` | Research, Plan, Implement (documenter) | Generate missing docs for an existing codebase |
| `api-feature` | Research, Plan, Implement, Verify | Add a new API endpoint following existing conventions |
| `targeted-refactor` | Research, Plan, Implement, Verify | Refactor a specific module with variable targeting |
| `bug-triage` | Research, Plan, Implement, Verify | Investigate and fix a reported bug with regression tests |
| `full-feature` | Research?, Plan, Implement, Verify, Document? | End-to-end feature with optional stages and approval gate |

For step-by-step instructions on authoring your own tactics, see [Create a Tactic](/guides/create-tactic). For the full annotated schema, see [Tactic Schema](/reference/tactic-schema).

## Built-in tactics

Lineup also ships [built-in tactics](/concepts/built-in-tactics) in the plugin's `tactics/` directory. These work alongside project tactics and can be overridden by project tactics with the same name.
