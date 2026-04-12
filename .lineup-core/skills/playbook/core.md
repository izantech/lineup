---
name: {{SKILL_NAME_PLAYBOOK}}
description: Create, edit, or import tactic workflows for your project's playbook
---

Manage project tactics — reusable workflow definitions in `.lineup/tactics/`.

## Discover

Run `lineup tactic list --json` to get existing tactics. Read example templates
from `examples/tactics/`. Present inventory to user.

## Choose mode

Use **{{QUESTION_PRIMITIVE}}**:
1. **Create** — new tactic from scratch
2. **Import** — copy from example templates
3. **Edit** — modify existing tactic
4. **Delete** — remove a tactic

## Create / Import flow

For **Import**: show examples, let user choose, ask "use as-is or customize?"
- As-is: copy to `.lineup/tactics/<name>.yaml`
- Customize: proceed through create flow with pre-populated values

For **Create**:
1. **Name**: kebab-case, 3-50 chars. Alternatively, run `lineup tactic new <name>` to scaffold
2. **Description**: 1-3 sentences
3. **Stages**: use stage builder with common patterns:
   | Pattern | Stages |
   |---------|--------|
   | Research-first | research → plan → implement → verify |
   | Quick fix | plan → implement → verify |
   | Documentation | research → plan → document |
   | Full with controls | research? → plan (gate) → implement → verify → document? |
   | Investigation | research → explain |

   For each stage: type + agent (use defaults), optional prompt, optional/gate flags.

4. **Verification**: list of criteria strings
5. **Variables**: name (snake_case), description, default value

## Validate and preview

Check: valid types/agents, no circular tactic refs, `${var}` references resolve.
Show formatted YAML preview. Ask confirmation before writing.

## Write

Write to `.lineup/tactics/<name>.yaml`. Report:
"Tactic written. Run with: `{{CMD_KICKOFF}} <name>`"

## Rules

- Never modify {{HOST_ARTIFACT_LABEL_LOWER}} example or built-in files
- Always preview before writing
- Use **{{QUESTION_PRIMITIVE}}** for all user decisions
- Match YAML formatting from examples
