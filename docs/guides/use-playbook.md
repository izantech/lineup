# Use Playbook

This guide walks through using `/lineup:playbook` to create, import, edit, and delete [tactics](/concepts/tactics) for your project. Instead of authoring YAML files by hand, the playbook skill provides an interactive wizard that handles schema, validation, and formatting for you.

## The sports metaphor

A project's **playbook** is its collection of tactic files -- the set of plays your team has ready to run. Each tactic is a play: a named sequence of agent stages designed for a specific task pattern. The playbook skill is the coach's tool for drawing up new plays, importing proven ones, revising existing ones, or retiring plays that are no longer needed.

## When to use playbook vs editing YAML manually

Use `/lineup:playbook` when:

- You're creating your first tactic and want guidance on stage types, agents, and validation
- You want to import an example tactic and optionally customize it
- You want to rename, restructure, or delete an existing tactic
- You want cross-reference validation between variables and prompts

Edit YAML manually when:

- You already know the [tactic schema](/reference/tactic-schema) well
- You need to make a small prompt tweak in a single stage
- You're copying a tactic from another project with minor adjustments

Both approaches produce identical files in `.lineup/tactics/`. There's no lock-in either way.

## Running the playbook

```bash
/lineup:playbook
```

The skill takes no arguments. It discovers your current tactics, example templates, and built-in tactics, then presents an inventory and asks what you want to do.

## Step 1: Inventory

The playbook reads the current state and shows a summary:

:::info Playbook Inventory

Playbook inventory:

Project tactics (.lineup/tactics/):
  - brownfield-docs -- Generate missing documentation for an existing codebase
  - api-feature -- Add a new API endpoint or service

Built-in tactics (plugin):
  - explain -- Get a clear explanation of any project component

Example templates available:
  - brownfield-docs, api-feature, targeted-refactor, bug-triage, full-feature

:::

If you have no project tactics yet, it shows "No project tactics defined yet."

## Step 2: Choose a mode

The playbook offers four modes:

| Mode | What it does |
| ---- | ------------ |
| **Create** | Build a new tactic from scratch with guided prompts |
| **Import** | Copy an example template into your project, optionally customizing it |
| **Edit** | Modify an existing project tactic (name, stages, variables, verification) |
| **Delete** | Remove a project tactic from `.lineup/tactics/` |

If no project tactics exist, only Create and Import are available.

## Mode: Create from scratch

The wizard walks through six steps to build a complete tactic.

### Name and description

You provide a kebab-case name (e.g., `code-review`, `deploy-check`) and a 1-3 sentence description explaining what the tactic does and when to use it.

Validation rules:
- Names must be lowercase letters, digits, and hyphens only
- 3-50 characters, no leading or trailing hyphens
- Must not conflict with an existing project tactic
- If it matches a built-in tactic name, you'll get a warning that your project tactic will override it

### Stage builder

This is the core of the wizard. You start by choosing a common stage pattern or building from scratch:

:::info Stage Patterns

Start from a common pattern or build from scratch?

  1. Research-first (research -> plan -> implement -> verify)
  2. Quick fix (plan -> implement -> verify)
  3. Documentation pass (research -> plan -> document)
  4. Full pipeline with controls
  5. Investigation only (research -> explain)
  6. Build from scratch

:::

For each stage, the wizard collects four pieces of information:

1. **Stage type and agent** -- Select from the eight stage types. Each type has a conventional agent pairing (e.g., `research` pairs with `researcher`, `plan` with `architect`). You can override the agent if needed.

2. **Custom prompt** (optional) -- Specific instructions for the agent in this stage. Use `${variable_name}` to reference variables you'll define later.

3. **Optional flag** -- Whether the orchestrator should ask the user before running this stage.

4. **Approval gate** -- Whether to pause for user approval after this stage completes.

After each stage, you can add more or move on.

### Verification criteria

Define human-readable checks that the reviewer evaluates after execution:

:::info Verification Criteria

Criteria so far: ["All tests pass", "No lint errors"]. Add another?

:::

If your tactic includes a `verify` stage, the wizard warns if you skip this step.

### Variables

Define variables that users fill in at runtime. Each variable has a name (snake_case), a description, and an optional default value.

After defining variables, the wizard validates cross-references:
- Every `${variable_name}` in stage prompts must match a defined variable
- Any defined variables not referenced in prompts get flagged as potentially unused

### Validate and preview

The wizard runs schema and semantic validation, then shows the complete YAML:

```yaml
# code-review -- Run a structured code review on recent changes.

name: code-review
description: |
  Run a structured code review on recent changes. Researches the affected
  code, then has the reviewer validate correctness and test coverage.

stages:
  - type: research
    agent: researcher
    prompt: |
      Focus on the files changed in the most recent commits.
  - type: verify
    agent: reviewer

verification:
  - "No critical issues found"
  - "All tests pass"
```

You can approve, go back to make changes, or cancel.

### Write

Once confirmed, the wizard creates `.lineup/tactics/` if it doesn't exist and writes the YAML file. You'll see:

:::tip Tactic Created

Tactic written to .lineup/tactics/code-review.yaml

You can run it with: /lineup:kick-off code-review

:::

## Mode: Import from examples

Import copies an example tactic into your project.

1. The wizard shows the available example templates with descriptions
2. You select one and see the full YAML content
3. Choose **use as-is** or **customize**:
   - **As-is**: Copies directly to `.lineup/tactics/<name>.yaml`
   - **Customize**: Loads the example as a starting point and walks you through the name, stages, variables, and verification steps so you can tailor it

This is the fastest way to get started. The five example templates cover common workflow patterns:

| Template | Stages | Use case |
| -------- | ------ | -------- |
| `brownfield-docs` | Research, Plan, Implement (documenter) | Generate missing docs |
| `api-feature` | Research, Plan, Implement, Verify | Add API endpoints |
| `targeted-refactor` | Research, Plan, Implement, Verify | Refactor with variable targeting |
| `bug-triage` | Research, Plan, Implement, Verify | Investigate and fix bugs |
| `full-feature` | Research?, Plan (gate), Implement, Verify, Document? | Full pipeline with controls |

## Mode: Edit existing

Edit lets you modify any project tactic without starting over.

1. Select the tactic to edit from your project tactics list
2. Choose what to change:

| Option | What it covers |
| ------ | -------------- |
| Name and description | Rename the tactic or update the description |
| Stages | Add, remove, or reorder stages; change prompts, agents, or controls |
| Verification criteria | Add, remove, or modify criteria |
| Variables | Add, remove, or modify variable definitions |
| Edit everything | Walk through all steps with current values pre-populated |

**Rename handling:** If you change the tactic's name, the wizard writes the new file and deletes the old one. No manual cleanup needed.

## Mode: Delete

Delete removes a project tactic.

1. Select the tactic to delete
2. Review the full YAML content
3. Confirm deletion

The wizard deletes the file and removes `.lineup/tactics/` if it's now empty. Built-in tactics cannot be deleted through the playbook -- only project tactics.

## Common workflows

### Bootstrap a project's playbook

If you're setting up tactics for a project for the first time:

1. Run `/lineup:playbook` and choose **Import**
2. Import `full-feature` as your general-purpose workflow
3. Run `/lineup:playbook` again and import `bug-triage` for debugging workflows
4. Customize either one to match your project's conventions

### Convert a one-off workflow into a tactic

After running a successful `/lineup:kick-off` with specific stages, capture it as a tactic:

1. Run `/lineup:playbook` and choose **Create**
2. Pick the stage pattern that matches what worked
3. Add the custom prompts you found effective
4. Define variables for the parts that change between runs

### Override a built-in tactic

If you want the `explain` tactic to work differently for your project:

1. Run `/lineup:playbook` and choose **Create**
2. Name it `explain` -- the wizard warns this overrides the built-in
3. Define your custom stages
4. Your project tactic takes priority when running `/lineup:kick-off explain`

## How tactics integrate with kick-off

Tactics created through the playbook are standard `.lineup/tactics/*.yaml` files. The `/lineup:kick-off` skill discovers them automatically:

```bash
# Run a specific tactic by name
/lineup:kick-off code-review

# See all tactics (project + built-in) and choose
/lineup:kick-off

# Run the default pipeline (ignores tactics)
/lineup:kick-off Add input validation to the login form
```

There's no difference between tactics created by the playbook wizard and tactics authored by hand. The files are identical.

## Tips for effective tactic design

**Start with a common pattern.** The five stage patterns cover most workflows. Build from scratch only when your workflow doesn't fit any of them.

**Keep tactics focused.** A tactic that tries to do everything is no better than the default pipeline. Design each tactic for a specific task pattern -- "add an API endpoint", not "do backend work".

**Use variables for the moving parts.** If a tactic applies to different modules, endpoints, or branches, define variables instead of hardcoding values in prompts. This makes the tactic reusable without editing the YAML each time.

**Add approval gates before implementation.** A `gate: approval` on the plan stage lets you review and redirect before any code gets written. This is especially valuable for tactics that make broad changes.

**Make research optional when appropriate.** Users who already know the codebase well can skip research to save time. Mark it `optional: true` rather than removing it entirely.

**Write specific verification criteria.** Vague criteria like "code is good" don't help the reviewer. Be concrete: "All new endpoints return proper error responses" gives the reviewer something to actually check.

**Match prompts to the agent's strengths.** The researcher is best at exploration and analysis. The architect is best at planning and structure. Write prompts that play to each agent's role rather than asking them to do something another agent does better.

## What's next

- Learn the concepts behind tactics in [Tactics](/concepts/tactics)
- See the full field specification in [Tactic Schema](/reference/tactic-schema)
- Browse [example tactics](https://github.com/izantech/lineup/tree/main/examples/tactics) shipped with the plugin
