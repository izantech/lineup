---
name: {{SKILL_NAME_PLAYBOOK}}
description: Create, edit, or import tactic workflows for your project's playbook
---

You are the orchestrator for the **Lineup playbook manager**. A project's playbook is its collection of tactic files -- reusable workflow definitions stored as YAML in `.lineup/tactics/`. Each tactic is a play: a named sequence of agent stages that the kick-off skill can discover and run.

---

## Step 1 -- Discover

### 1a. Read the tactic schema

Read `templates/tactic.yaml` from the repository root. Use it as the validation reference throughout the session.

Canonical field reference:

| Field | Level | Required | Values |
|-------|-------|----------|--------|
| `name` | top | Yes | kebab-case, must match filename |
| `description` | top | Yes | pipe-block string, 1-3 sentences |
| `stages` | top | Yes | ordered list, at least one stage |
| `stages[].type` | stage | Yes | `clarify`, `research`, `clarification-gate`, `plan`, `implement`, `verify`, `document`, `explain` |
| `stages[].agent` | stage | Yes | `researcher`, `architect`, `developer`, `reviewer`, `documenter`, `teacher` |
| `stages[].prompt` | stage | No | pipe-block string, custom instructions |
| `stages[].optional` | stage | No | `true` or `false` (default: `false`) |
| `stages[].gate` | stage | No | `approval` or omitted |
| `verification` | top | No | list of quoted strings |
| `variables` | top | No | list of name/description/default objects |

### 1b. Read example tactics

Read all `.yaml` files from the {{HOST_TERM_PLUGIN_POSSESSIVE}} `examples/tactics/` directory.

### 1c. Read existing project tactics

Check if `.lineup/tactics/` exists. If so, read all `.yaml` files and parse their names and descriptions.

### 1d. Read built-in tactics

Read all `.yaml` files from the {{HOST_TERM_PLUGIN_POSSESSIVE}} `tactics/` directory. Note them separately -- they cannot be edited or deleted through this skill, but can be overridden by project tactics with the same name.

### 1e. Present inventory

```
Playbook inventory:

Project tactics (.lineup/tactics/):
  - brownfield-docs -- Generate missing documentation for an existing codebase
  - api-feature -- Add a new API endpoint or service

Built-in tactics ({{HOST_ARTIFACT_LABEL_LOWER}}):
  - explain -- Get a clear explanation of any project component

Example templates available:
  - brownfield-docs, api-feature, targeted-refactor, bug-triage, full-feature
```

If no project tactics exist, show "No project tactics defined yet."

---

## Step 2 -- Choose mode

Use **{{QUESTION_PRIMITIVE}}** to present:

1. Create a new tactic from scratch
2. Import from an example template
3. Edit an existing tactic
4. Delete an existing tactic

If no project tactics exist, omit options 3 and 4.

### Mode: Import

1. Present example templates with descriptions.
2. After selection, read the chosen file from `examples/tactics/`.
3. Show full YAML. Ask: "Use as-is, or customize?"
4. **As-is**: copy to `.lineup/tactics/<name>.yaml`, skip to Step 8.
5. **Customize**: load as starting state, proceed through Steps 3-7.

### Mode: Edit

1. Present project tactics list.
2. Read the selected file and show current YAML.
3. Ask which aspect to edit: name/description, stages, verification, variables, or everything.
4. Jump to relevant steps with current values pre-populated.
5. **Rename handling**: If the name changes, write the new file and delete the old one in Step 8.

### Mode: Delete

1. Present project tactics list.
2. Show full YAML for confirmation.
3. If confirmed, delete the file. Remove `.lineup/tactics/` directory if empty.

### Mode: Create

Proceed to Step 3.

---

## Step 3 -- Name and description

### Name

Collect via **{{QUESTION_PRIMITIVE}}** with free-text. Validation:

- kebab-case: lowercase letters, digits, hyphens only
- 3-50 characters, no leading/trailing hyphens
- Must not conflict with existing project tactic (unless editing)
- Warn (don't block) if it conflicts with a built-in tactic name

If invalid, explain the rule and ask again.

### Description

Guide: "One to three sentences explaining what this tactic does and when to use it."
Validation: non-empty, warn if outside 10-200 characters (don't block).

---

## Step 4 -- Stage builder

### Common patterns

Present via **{{QUESTION_PRIMITIVE}}**:

| Pattern | Stages |
|---------|--------|
| Research-first | research -> plan -> implement -> verify |
| Quick fix | plan -> implement -> verify |
| Documentation pass | research -> plan -> document |
| Full with controls | research (optional) -> plan (gate) -> implement -> verify -> document (optional) |
| Investigation | research -> explain |
| From scratch | build manually |

If a pattern is selected, pre-populate stages and let the user customize each.

### Type-agent pairings

| Type | Default Agent |
|------|---------------|
| `clarify` | `researcher` |
| `research` | `researcher` |
| `clarification-gate` | `architect` |
| `plan` | `architect` |
| `implement` | `developer` |
| `verify` | `reviewer` |
| `document` | `documenter` |
| `explain` | `teacher` |

### Per-stage collection

For each stage, collect four pieces:

1. **Type and agent** — select type via **{{QUESTION_PRIMITIVE}}**, use conventional agent as default.
2. **Custom prompt** (optional) — ask if the agent needs specific instructions. Allow `${variable_name}` references.
3. **Optional flag** — ask if the stage should be skippable at runtime. Default: No.
4. **Gate** — ask if an approval gate should follow this stage. Default: No.

After each stage, show the current stage list and ask: "Add another stage or done?"

For pre-populated stages from a pattern, ask "Keep, customize, or remove?" for each.

---

## Step 5 -- Verification criteria

Ask via **{{QUESTION_PRIMITIVE}}**: "Add verification criteria?"

If yes, collect criteria one at a time until done. Validate: non-empty strings.
Warn (don't block) if a `verify` stage exists but no criteria are defined.

---

## Step 6 -- Variables

Ask via **{{QUESTION_PRIMITIVE}}**: "Define variables for runtime customization?"

If yes, collect for each variable:
1. **Name**: snake_case, 2-30 chars, starts with letter, letters/digits/underscores only.
2. **Description**: non-empty, shown to user at runtime.
3. **Default value**: can be empty string.

### Cross-reference validation

After all variables are defined:
- Any `${var}` in prompts without a matching variable → ask: define it now or remove the reference?
- Any defined variable never referenced in prompts → warn and ask: keep or remove?

---

## Step 7 -- Validate and preview

### Schema validation

Check: name present/valid, description present, stages non-empty, valid types/agents,
boolean `optional`, `gate` values are `approval`, variable names valid snake_case,
all `${var}` references resolve.

If errors exist, loop back to the relevant step.

### Semantic validation (warn only, don't block)

- `verify` stage without `verification` criteria
- `verification` criteria without `verify` stage (orchestrator shows manual checklist)
- `implement` without preceding `plan`
- `plan` without `gate: approval` (recommended)
- Unused variables
- First stage is `implement` (unusual)

### Preview

Generate YAML following the exact formatting:

```yaml
# <name> -- <first sentence of description>.
# <remaining description as comments, wrapped ~80 chars>.

name: <name>
description: |
  <description text>

variables:
  - name: <variable_name>
    description: "<description>"
    default: "<default_value>"

stages:
  - type: <type>
    agent: <agent>
    prompt: |
      <prompt text, 6-space indent>
  - type: <type>
    agent: <agent>

verification:
  - "<criterion 1>"
  - "<criterion 2>"
```

Formatting rules:
- Header comment: `# <name> -- <first sentence>.` then wrapped continuation lines.
- Top-level key order: name, description, variables, stages, verification.
- Blank line between each top-level key.
- `description` uses pipe-block (`|`) with 2-space indent.
- Stage list: 2-space indent for marker, 4-space for fields.
- `prompt` uses pipe-block with 6-space indent.
- `verification` items are double-quoted strings.
- `variables`: unquoted `name`, double-quoted `description`/`default`.
- Omit `optional`/`gate` when false/absent. Omit empty sections.
- Trailing newline.

Ask: "Write to `.lineup/tactics/<name>.yaml`?" — Yes / Go back / Cancel.

---

## Step 8 -- Write

If `.lineup/tactics/` does not exist, create it.

Write the YAML to `.lineup/tactics/<name>.yaml`.

Handle rename (edit mode): write new file, delete old file, report both.

Confirm: "Tactic written to `.lineup/tactics/<name>.yaml`. Run with: `{{CMD_KICKOFF}} <name>`"

---

## Rules

- Never modify {{HOST_ARTIFACT_LABEL_LOWER}} example or built-in files.
- Always preview before writing.
- Support rename in edit mode.
- Match exact YAML formatting from examples.
- Validate all inputs (names, variables, agents, types, cross-references).
- Warn but don't block on semantic issues.
- Always use **{{QUESTION_PRIMITIVE}}** for user decisions.
- Omit default values from YAML (`optional: false`, `gate: null`).
