# Kick-off Initialization

This file contains the initialization sequence for the kick-off pipeline.
The orchestrator reads this before starting the pipeline stages.

---

## Agent Configuration Overrides

Before spawning any agent, check for user-level configuration overrides:

1. Check if `{{OVERRIDES_DIR}}` exists.
2. For each agent about to be spawned, look for `{{OVERRIDES_DIR}}<agent>.yaml`.
3. If an override file exists, read it and apply the overridden values (model,
   tools, memory) when spawning the agent. These values take precedence over
   the agent's frontmatter defaults.
4. If no override file exists, use the agent's {{HOST_DEFAULTS_TERM}} as-is.

Override files contain only the fields the user customized:

```yaml
plugin_version: "1.5.0"
model: sonnet
tools: Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search
```

When spawning an agent with overrides, specify the overridden model and tools
in the agent invocation. For example, if the researcher's override sets
`model: sonnet`, spawn the researcher with Sonnet instead of its default Haiku.

**Version mismatch warning:** If the override file's `plugin_version` does not
match the current Lineup version (from `.claude-plugin/plugin.json`), note this
in the agent spawn log but proceed normally. Suggest the user run
`{{CMD_CONFIGURE}}` to review their customizations if the major version changed.

### Override validation

When reading an override file:

1. If the file is not valid YAML, report:
   "Warning: {{OVERRIDES_DIR}}<agent>.yaml is malformed. Using {{HOST_DEFAULTS_TERM}}
   for <agent>."
   Proceed with {{HOST_DEFAULTS_TERM}} for that agent.
2. Validate known fields:
   - `model` must be one of `haiku`, `sonnet`, `opus`
   - `memory` must be one of `user`, `project`, `local`
   - `tools` must be a non-empty comma-space separated string
3. If a field has an invalid value, report and use the {{HOST_DEFAULTS_TERM}} for
   that field only:
   "Warning: researcher override has model 'gpt-4' (invalid). Using default
   'haiku'."
4. Unknown fields are ignored silently.

---

## Memory Migration

After reading agent configurations, check if any agents have **global memory** that contains
project-specific knowledge which should be migrated to project-scoped memory. This is a one-time
migration per project, triggered automatically when running the pipeline.

### When to run

Only run this check if ALL of these conditions are true:

1. The project-scoped memory directory does not yet exist for at least one agent
   (i.e., `{{MEMORY_PROJECT_DIR}}/<project-path>/agent-memory/lineup-<agent>/` is missing or empty).
2. The global memory directory exists and contains files
   (i.e., `{{MEMORY_USER_DIR}}/lineup-<agent>/MEMORY.md` exists).

If project-scoped memory already exists for all agents, skip migration silently -- it was
already done in a previous session.

### How to migrate

For each agent that needs migration:

1. Read `{{MEMORY_USER_DIR}}/lineup-<agent>/MEMORY.md`.
2. Identify sections relevant to the current project. Agent memory files typically organize
   knowledge under `## Project: <name>` headers. Match by:
   - Project name appearing in the header (e.g., `## Project: Lineup`)
   - Working directory path appearing in the content
   - Use judgment for sections without explicit project headers
3. Extract the matching section(s) and write them to
   `{{MEMORY_PROJECT_DIR}}/<project-path>/agent-memory/lineup-<agent>/MEMORY.md`.
4. Remove the migrated section(s) from the global MEMORY.md.
5. If the global MEMORY.md becomes empty after migration, delete it.
6. If the agent has additional files beyond MEMORY.md in its global memory directory
   (e.g., specialized research documents), note them in the migration log but do not
   move them automatically -- the agent will handle them over time through normal
   memory management.

### Safety rules

- **Read before write**: Read the full global MEMORY.md into context before making any changes. Do not alternate between reading and writing.
- **Idempotency**: If project-scoped memory already contains a section with the same header as the global file, skip that section (already migrated in a partial previous run). Do not duplicate content.
- **Preserve on failure**: If writing to project-scoped memory fails, leave the global memory unchanged. Report the failure and continue the pipeline without migration. The user can retry on the next run.
- **One agent at a time**: Complete migration for one agent fully (read, write, clean) before starting the next. This limits the blast radius of any interruption.

### Project path encoding

Claude Code encodes project paths by replacing `/` with `-` and prepending `-`.
For example: `/Users/izan/Dev/Projects/lineup` becomes `-Users-izan-Dev-Projects-lineup`.

The full project memory path for an agent is:
`{{MEMORY_PROJECT_DIR}}/-Users-izan-Dev-Projects-lineup/agent-memory/lineup-researcher/MEMORY.md`

### Migration log

After migration, briefly report what was done:

```
Memory migration: migrated project-specific knowledge for researcher, architect, developer.
3 agents migrated, 2 agents had no project-specific content, 1 agent already had project memory.
```

If nothing needed migration, skip the log entirely -- do not report "nothing to migrate".

---

## Tactic Resolution

Before starting the pipeline, check if the project defines any **tactics** -- reusable
workflow definitions stored as YAML files in `.lineup/tactics/`.

### Discovery

1. Read all `.yaml` files from the {{HOST_TERM_PLUGIN_POSSESSIVE}} own `tactics/` directory (built-in tactics).
2. Check if `.lineup/tactics/` exists in the current working directory.
3. If it does, read all `.yaml` files in that directory (project tactics).
4. Merge both lists. If a project tactic has the same `name` as a built-in tactic, the project version takes precedence (override).
5. If any project tactic overrode a built-in tactic, note it to the user: "Note: project tactic 'X' overrides the built-in 'X' tactic." Continue normally -- this is informational, not an error.
6. Parse each file and extract: `name`, `description`, `stages`, `verification`, and `variables`.

### Selection

- If the user provided a tactic name as an argument (e.g., `{{CMD_KICKOFF}} brownfield-docs`),
  look for `.lineup/tactics/brownfield-docs.yaml`. If found, load it. If not found, report the
  error and list available tactics.

- If the user provided NO argument AND tactics exist, use **{{QUESTION_PRIMITIVE}}** to present them:

```
Question: "This project has tactics defined. Which workflow would you like to run?"
Options:
  1. brownfield-docs -- Generate missing documentation for an existing codebase
  2. api-feature -- Full pipeline with API-focused research and testing
  3. Run the default pipeline (Clarify -> Research -> ... -> Document?)
  4. Other (please specify)
```

Each option shows the tactic `name` followed by a truncated `description`.
Always include "Run the default pipeline" and "Other" as the last two options.

- If neither `.lineup/tactics/` nor {{HOST_ARTIFACT_LABEL_LOWER}} built-in tactics exist, skip this stage silently and proceed to Stage 1.

### Variable Prompting

If the selected tactic defines `variables`, prompt the user for each one before execution:

- Show the variable `description` and `default` value
- Use **{{QUESTION_PRIMITIVE}}** with the default as option 1 and a free-text option
- Substitute resolved values into stage prompts using `${variable_name}` replacement

### Variable Validation

After resolving all variable values, scan all stage prompts for `${...}` patterns.
If any `${variable_name}` reference does not match a defined variable:

1. List the unresolved references and which stage prompts contain them.
2. Use **{{QUESTION_PRIMITIVE}}** to ask:
   - "Provide a value for this variable"
   - "Continue with the literal string (agent will see '${variable_name}')"
   - "Abort tactic execution"
3. If the user provides values, substitute them. If they choose to continue,
   proceed with a warning.

### Tactic Execution

When a tactic is selected, **replace the default pipeline** with the tactic's stage sequence:

1. Iterate over the tactic's `stages` array in order.
2. For each stage:
   a. If the stage has `optional: true`, use **{{QUESTION_PRIMITIVE}}** to ask the user
      whether to run it. If they decline, skip to the next stage.
   b. Delegate to the specified `agent`.
   c. If the stage has a custom `prompt`, include it in the agent's instructions
      (appended after the agent's default instructions, not replacing them).
   d. If the stage has `gate: approval`, present the agent's output to the user
      and **wait for explicit approval** before proceeding to the next stage.
      If the user rejects, return to this stage for revision.
3. Pass context between stages the same way as the default pipeline (upstream output feeds downstream).
4. After all stages complete, if `verification` criteria exist, present them to the user as a
   checklist and evaluate them:
   - If a `verify` stage was included in the tactic, the reviewer evaluates the criteria.
   - If no `verify` stage exists, the orchestrator presents them as a manual checklist.
5. **Do not** fall through to the default Stage 1-7 pipeline -- tactic execution is complete.

**Stage labels**: When running a tactic, use the stage count from the tactic, not the default
7-stage numbering. For example, a 3-stage tactic shows "Stage 1/3", "Stage 2/3", "Stage 3/3".
