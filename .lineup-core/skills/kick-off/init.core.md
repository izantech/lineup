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

1. Check the file size of the global MEMORY.md for this agent. If the file exceeds
   50 KB, read it incrementally: first scan for project-header boundaries (Grep for
   `## Project:` patterns), then read only the matching section(s) plus surrounding
   context using offset and limit. For files under 50 KB, read the full file.
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

- **Read before write**: For files under 50 KB, read the full global MEMORY.md into
  context before making any changes. For files over 50 KB, read incrementally: scan
  for project-header boundaries first (Grep for `## Project:` patterns), then read
  only the matching section(s) plus surrounding context. Do not alternate between
  reading and writing within a single section migration.
- **Write-then-clean order**: When migrating a section, always write it to the destination
  first, then remove it from the source. Never remove from the source before confirming the
  destination write succeeded. If the pipeline is interrupted between these two steps, the
  section exists in both locations — on the next retry, it will be detected as already
  present in project-scoped memory and the source copy will be cleaned up normally.
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
3. If the user provides values, substitute them. If they choose to continue with
   the literal string, inject a note at the top of each affected stage prompt:
   "Note: The following variable references could not be resolved and appear as
   literal text: ${var1}, ${var2}."
   List only the unresolved references that appear in that specific stage's prompt.

### Tactic Inlining

Before executing stages, expand any tactic references into their constituent stages:

1. **Expand**: Walk the `stages` array. For each stage that has a `tactic` field
   (instead of `type`/`agent`):
   a. Load the referenced tactic file (same discovery logic as Tactic Resolution).
   b. Replace the tactic-reference stage with the referenced tactic's `stages` array
      (flattened in place).
   c. If the referencing stage had `prompt`, `optional`, or `gate` fields, apply them
      as overrides to the **first** inlined stage only.
2. **Cycle detection**: Maintain a set of tactic names currently being expanded
   (the "expansion stack"). Before expanding a tactic, check if its name is already
   in the stack. If so, report an error:
   "Error: Circular tactic reference detected: <stack trace as A -> B -> A>.
   Aborting tactic execution."
   Use **AskUserQuestion** to let the user choose: abort or run the default pipeline.
3. **Variable scoping**: When inlining tactic B into tactic A:
   - Variables defined in A override B's defaults for any `${var}` references that
     share the same name.
   - Variables defined only in B use B's defaults.
   - After inlining, re-run Variable Validation on the expanded stage list.
4. **Stage count**: Recalculate total stage count after all inlining is complete.
   Stage labels use the expanded count (e.g., "Stage 3/8" not "Stage 2/5").

Inlining is recursive — an inlined tactic may itself contain tactic references.
The cycle detection stack prevents infinite recursion.

### Tactic Execution

When a tactic is selected, **replace the default pipeline** with the tactic's stage sequence (after tactic inlining has expanded all references):

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
6. **Cleanup**: If `TEAMS_MODE = true`, check if any teammates are still running
   and send a `shutdown_request` to each one. Teammates should already have been
   shut down eagerly after each stage, so this is a safety net.

**Stage labels**: When running a tactic, use the stage count from the tactic, not the default
7-stage numbering. For example, a 3-stage tactic shows "Stage 1/3", "Stage 2/3", "Stage 3/3".

---

## Team Setup

After tactic resolution, check whether Claude Code Teams are available and
whether the terminal is wide enough to support side-by-side teammate panels.

### Terminal width check

Before checking for Teams availability, detect the terminal width:

1. Run `tput cols` using the Bash tool.
2. If the command succeeds and returns a number **less than 80**, the terminal is
   too narrow for Teams. Set `TEAMS_MODE = false` and skip the rest of this
   section (Detection, Creating the team, etc.). Log briefly:
   "Note: Terminal width (<N> cols) below 80 — using standard agents."
3. If the command fails (non-zero exit, no output, or non-numeric output), log a
   warning: "Warning: Could not detect terminal width — assuming wide terminal."
   Then continue to Detection below. Do not abort the pipeline over a failed width check.
4. If the width is **80 or greater**, continue to Detection below.

### Detection

Check whether the `TeamCreate` tool is available in your environment. If it is
**not available**, skip this section entirely and use the standard subagent path
for all stages. Set an internal flag: `TEAMS_MODE = false`.

If `TeamCreate` is available, set `TEAMS_MODE = true` and proceed below.

### Creating the team

Generate a random **session ID**: a 6-character lowercase alphanumeric string
(e.g., `a3f2k9`, `m1x7b2`). This ID uniquely identifies the current pipeline run
and prevents namespace collisions when multiple projects run concurrently.

Call `TeamCreate` with:
- `team_name`: `lineup-<session_id>` (e.g., `lineup-a3f2k9`)
- `description`: `Lineup agentic pipeline — researcher, architect, developer, reviewer, documenter`

If `TeamCreate` fails due to a **name conflict** (team name already exists), generate
a new session ID and retry. Retry up to 3 attempts. If all retries fail due to name
conflicts, log the error, set `TEAMS_MODE = false`, and continue with the standard
subagent path.

If `TeamCreate` fails because the leader is **already managing another team** (error
message contains "Already leading team"), notify the user:
"Note: Teams mode unavailable — another session is already leading a team. Continuing
with standard agents."
Then set `TEAMS_MODE = false` and continue with the standard subagent path. Do not
attempt to delete the other team, as it may be actively in use.

If `TeamCreate` fails for any **other reason** not covered above, log the error, set
`TEAMS_MODE = false`, and continue with the standard subagent path. Do not abort the
pipeline.

Store both values in working context:
- `session_id` — the generated 6-character ID
- `team_name` — the full namespaced team name (e.g., `lineup-a3f2k9`)

All agent spawns in this pipeline will use these values to construct `team_name`
and `name` parameters for the Agent tool.

### Team Preamble

After the team is created (`TEAMS_MODE = true`), write a combined agent instruction
file to reduce per-spawn token cost:

1. Determine which agents are needed using the **Lazy Agent Loading** table in
   `SKILL.md`. Only include roles that the current pipeline tier will actually spawn.
2. For each needed role, read `{{AGENTS_DIR}}<role>.md`.
3. Extract the body (everything after the closing `---` of the frontmatter).
4. Write all bodies to `.lineup/.ephemeral/agent-instructions.md`, separated by
   `## <role>` headers.
5. This file is referenced by team-mode spawn prompts instead of embedding the full
   body inline. See the Team mode section in the core pipeline definition.

If `.lineup/.ephemeral/` does not exist, create it. This file is cleaned up by
Pipeline Cleanup like all other ephemeral artifacts.

If a later stage needs an agent that was not in the initial set (e.g., Stage 7
triggers documenter but the team preamble only had 4 roles), append that agent's
body section to `.lineup/.ephemeral/agent-instructions.md` at that point.

### Team teardown

Do not call `TeamDelete` at pipeline end -- Claude Code manages the team entity
lifecycle. However, you **must** shut down individual teammates when the pipeline
completes. See the Pipeline Cleanup section in the core pipeline definition for
the shutdown procedure.

---

## Ollama Detection

After Team Setup, check whether Ollama is available for use by researcher agents.

1. Check if `{{OLLAMA_CONFIG_PATH}}` exists. If the file does not exist or cannot be
   read, set `OLLAMA_AVAILABLE = false` and skip the rest of this section silently.

2. Read the file and parse the YAML. If `enabled` is missing or `false`, set
   `OLLAMA_AVAILABLE = false` and skip silently.

3. If `enabled: true`, verify the MCP server is actually running. Use ToolSearch
   with query `"select:mcp__ollama__ollama_list"` to check if the tool is available.

   a. If the tool is found and calling `mcp__ollama__ollama_list` returns a non-empty
      model list, set `OLLAMA_AVAILABLE = true` and store `OLLAMA_MODEL` from the
      `model` field in the YAML.

   b. If the tool is not found or the call fails, set `OLLAMA_AVAILABLE = false` and log:
      "Warning: Ollama is enabled in config but the MCP server is not available.
      Run `claude mcp add ollama -- npx -y ollama-mcp` to set it up."

Store in working context:
- `OLLAMA_AVAILABLE` — boolean, whether Ollama is ready for use
- `OLLAMA_MODEL` — string, the model name from config (only set when `OLLAMA_AVAILABLE = true`)
