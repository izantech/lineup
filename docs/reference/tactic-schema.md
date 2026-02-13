# Tactic Schema

This is the complete reference for tactic YAML files. For a conceptual overview of tactics, see [Tactics](/concepts/tactics). For a step-by-step guide to creating one, see [Create a Tactic](/guides/create-tactic).

## File location

Tactics are YAML files placed in one of two locations:

| Location | Type | Scope |
| -------- | ---- | ----- |
| `.lineup/tactics/*.yaml` | Project tactic | Current project only |
| Plugin `tactics/*.yaml` | Built-in tactic | All projects using the plugin |

Project tactics with the same `name` as a built-in tactic override the built-in version.

## Top-level fields

| Field | Type | Required | Default | Description |
| ----- | ---- | -------- | ------- | ----------- |
| `name` | string | Yes | -- | Unique identifier in kebab-case. Must match the filename without `.yaml`. |
| `description` | string | Yes | -- | One-paragraph summary shown during tactic selection. Supports multi-line YAML (`\|`). |
| `stages` | list | Yes | -- | Ordered list of stages to execute. Minimum one stage. |
| `verification` | list | No | `[]` | Human-readable criteria checked after execution. |
| `variables` | list | No | `[]` | Variables prompted before execution. |

### Example

```yaml
name: api-feature
description: |
  Add a new API endpoint or service. Researches existing API conventions,
  plans the endpoint specification, implements it, and verifies with tests.

stages:
  - type: research
    agent: researcher
  - type: plan
    agent: architect
    gate: approval
  - type: implement
    agent: developer
  - type: verify
    agent: reviewer

verification:
  - "New endpoint follows existing routing conventions"
  - "Tests cover success, validation failure, and auth failure cases"
```

## Stage fields

Each entry in the `stages` list accepts the following fields:

| Field | Type | Required | Default | Description |
| ----- | ---- | -------- | ------- | ----------- |
| `type` | string | Yes | -- | Pipeline stage type. See valid values below. |
| `agent` | string | Yes | -- | Agent to invoke. See valid values below. |
| `prompt` | string | No | `null` | Custom instructions appended to the agent's defaults (not a replacement). Supports multi-line YAML (`\|`). |
| `optional` | boolean | No | `false` | If `true`, the orchestrator asks the user before running this stage. |
| `gate` | string | No | `null` | Set to `"approval"` to pause for explicit user approval after this stage completes. |

### Valid stage types

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

### Valid agent names

| Agent | Typical stage pairing | Notes |
| ----- | --------------------- | ----- |
| `researcher` | `research` | Read-only exploration |
| `architect` | `plan` | Creates implementation plans |
| `developer` | `implement` | Full tool access for code changes |
| `reviewer` | `verify` | Runs tests, reviews diffs |
| `documenter` | `document`, `implement` | Writes documentation files |
| `teacher` | `explain` | Produces structured explanations |

Agent-stage pairings are conventions, not hard constraints. Any agent can be assigned to any stage type.

### Stage example with all fields

```yaml
- type: research
  agent: researcher
  optional: true
  gate: approval
  prompt: |
    Focus on the authentication module. Analyze its structure,
    dependencies, and test coverage. Identify integration points
    with the rest of the application.
```

### Orchestration controls

**`optional: true`** -- The orchestrator asks the user whether to run this stage. If the user declines, the stage is skipped and execution continues with the next one.

```yaml
- type: research
  agent: researcher
  optional: true       # "Would you like to run the Research stage?"
```

**`gate: approval`** -- After the stage completes, the orchestrator presents the output and waits for explicit user approval. If the user rejects, the stage re-runs for revision.

```yaml
- type: plan
  agent: architect
  gate: approval       # User must approve before implementation
```

Both fields can be combined. An optional stage with an approval gate first asks whether to run it, then (if yes) requires approval of the output:

```yaml
- type: research
  agent: researcher
  optional: true
  gate: approval
```

## Variable fields

Each entry in the `variables` list accepts:

| Field | Type | Required | Default | Description |
| ----- | ---- | -------- | ------- | ----------- |
| `name` | string | Yes | -- | Variable identifier used in `${name}` substitutions within stage prompts. |
| `description` | string | Yes | -- | Shown to the user when prompting for the value. |
| `default` | string | No | `null` | Default value offered as option 1 during prompting. |

### Variable substitution

Reference variables in stage prompts with `${variable_name}`. The orchestrator resolves all variables before executing any stages.

```yaml
variables:
  - name: target_module
    description: "Path to the module to refactor (e.g., src/auth/, lib/db.ts)"
    default: "src/"

stages:
  - type: research
    agent: researcher
    prompt: |
      Analyze ${target_module} thoroughly: file structure, public API,
      dependencies, and test coverage.
```

### Variable prompting flow

When the tactic runs, the orchestrator prompts for each variable in order:

1. Shows the variable `description`
2. If a `default` exists, offers it as option 1
3. Includes a free-text option for custom input
4. Substitutes the resolved value into all stage prompts that reference it

## Verification fields

The `verification` field is a list of strings. Each string is a human-readable criterion.

```yaml
verification:
  - "All new public APIs have JSDoc comments"
  - "README.md has been updated with new feature section"
  - "No existing tests are broken"
```

How verification criteria are evaluated depends on whether the tactic includes a `verify` stage:

| Tactic has `verify` stage? | What happens |
| -------------------------- | ------------ |
| Yes | The reviewer agent evaluates criteria against the implementation |
| No | The orchestrator presents criteria as a manual checklist for the user |

## Complete example

This example uses every field available in the tactic schema:

```yaml
name: targeted-refactor
description: |
  Refactor a specific module. Researches the module's current structure and
  dependencies, plans the refactor, implements it, and verifies no regressions.

variables:
  - name: target_module
    description: "Path to the module to refactor (e.g., src/auth/, lib/db.ts)"
    default: "src/"
  - name: refactor_goal
    description: "What should the refactor achieve?"
    default: "Improve readability and reduce complexity"

stages:
  - type: research
    agent: researcher
    prompt: |
      Analyze ${target_module} thoroughly: file structure, public API surface,
      internal dependencies, external consumers, and test coverage. Identify
      code smells, complexity hotspots, and coupling issues.
  - type: plan
    agent: architect
    prompt: |
      Plan the refactor of ${target_module} to ${refactor_goal}. Prioritize
      changes that reduce complexity without changing the public API.
  - type: implement
    agent: developer
  - type: verify
    agent: reviewer
    prompt: |
      Verify the refactor of ${target_module} did not break anything. Run the
      full test suite. Check that the public API surface is unchanged.

verification:
  - "Public API of the module is unchanged"
  - "All existing tests pass"
  - "No new circular dependencies introduced"
  - "Code complexity is reduced (fewer lines, simpler control flow)"
```

## Naming constraints

- The `name` field must be kebab-case (lowercase letters, numbers, hyphens)
- The `name` must match the filename without the `.yaml` extension
- Names must be unique within their scope (project tactics among project tactics, built-in tactics among built-in tactics)
- A project tactic can reuse a built-in tactic's name to override it

## Annotated schema template

The plugin ships a fully annotated schema template at `templates/tactic.yaml`. Copy it as a starting point:

```bash
cp /path/to/lineup/templates/tactic.yaml .lineup/tactics/my-tactic.yaml
```
