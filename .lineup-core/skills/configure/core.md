---
name: {{SKILL_NAME_CONFIGURE}}
description: Interactively customize Lineup agent settings (models, tools, memory)
---

You are the orchestrator for the **Lineup agent configurator**. Walk the user through customizing agent settings, then write override files to persist their preferences.

Customizations are stored as YAML override files in `{{OVERRIDES_DIR}}`. The {{HOST_TERM_PLUGIN_POSSESSIVE}} agent `.md` files are **never modified** — they provide defaults, and overrides layer on top.

---

## Step 1 — Read current config

### 1a. Read {{HOST_DEFAULTS_TERM}}

Read all agent files from the repository's `agents/` directory:
- `researcher.md`
- `architect.md`
- `developer.md`
- `reviewer.md`
- `documenter.md`
- `teacher.md`

Extract the frontmatter fields: `model`, `tools`, `memory`.

These are the {{HOST_DEFAULTS_TERM}} (used as reference if agent files cannot be read):

| Agent | Model | Memory | Tools |
|-------|-------|--------|-------|
| researcher | haiku | project | Read, Grep, Glob, LS, WebFetch, WebSearch |
| architect | opus | project | Read, Grep, Glob, LS, Write |
| developer | opus | project | Read, Grep, Glob, LS, Edit, Write, Bash, NotebookEdit |
| reviewer | opus | project | Read, Grep, Glob, LS, Bash |
| documenter | opus | project | Read, Grep, Glob, LS, Write, WebFetch |
| teacher | opus | project | Read, Grep, Glob, LS, WebFetch, WebSearch |

### 1b. Read user overrides

Check if `{{OVERRIDES_DIR}}` exists. For each agent, check if a corresponding override file exists (e.g. `{{OVERRIDES_DIR}}researcher.yaml`).

Override files are YAML with this format:

```yaml
plugin_version: "1.5.0"
model: sonnet
tools: Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search
```

Only fields the user has changed from defaults are present (plus `plugin_version`).

### 1c. Merge and display

For each agent, merge: **override values win** over {{HOST_DEFAULTS_TERM}}. Display the merged config in a summary table. Mark overridden fields with `*`:

```
Current agent configuration:

| Agent       | Model    | Memory | Tools                                                          |
|-------------|----------|--------|----------------------------------------------------------------|
| researcher  | sonnet*  | project | Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search* |
| architect   | opus     | project | Read, Grep, Glob, LS, Write                                   |
| developer   | opus     | project | Read, Grep, Glob, LS, Edit, Write, Bash, NotebookEdit         |
| reviewer    | opus     | project | Read, Grep, Glob, LS, Bash                                    |
| documenter  | opus     | project | Read, Grep, Glob, LS, Write, WebFetch                         |
| teacher     | opus     | project | Read, Grep, Glob, LS, WebFetch, WebSearch                     |

Fields marked with * have user overrides.
```

If any overrides exist, note: "Run with **Reset** to restore all agents to {{HOST_DEFAULTS_TERM}}."

---

## Step 2 — Ask what to change

Present the configuration options using **{{QUESTION_PRIMITIVE}}**. Offer these categories:

### Model
- **Keep current** — no changes
- **Set one model for all agents** — ask which: `haiku`, `sonnet`, or `opus`
- **Set per-agent** — ask for each agent individually

### Tools
- **Replace tools** — swap one tool for another across all agents (e.g. `WebSearch` -> `mcp__brave-search__brave_web_search`)
- **Add tools** — append tools to specific agents
- **Remove tools** — remove tools from specific agents
- **No changes** — keep current tools

### Memory
- **Keep current** — no changes
- **Set one scope for all agents** — ask which: `user`, `project`, or `local`
- **Set per-agent** — ask for each agent individually

### Ollama

- **Enable Ollama for research** — walks the user through setup:
  1. Check if Ollama is installed by running `ollama --version` via Bash. If the
     command fails or is not found, provide install instructions (`https://ollama.com`)
     and stop.
  2. Check if the MCP server is configured by looking for `ollama` in the MCP config.
     If not found, offer to run `claude mcp add ollama -- npx -y ollama-mcp` via Bash.
  3. Ask which model to use. Run `ollama list` via Bash to show available models.
     Default recommendation: `llama3.1:8b` or whatever model is already pulled.
  4. Write `{{OLLAMA_CONFIG_PATH}}`:
     ```yaml
     enabled: true
     model: llama3.1:8b
     scope: research
     ```
     (Use the user-selected model instead of the hardcoded default.)
  5. Confirm: "Ollama enabled for research tasks. Researchers will use `<model>` for
     text summarization and context gathering."

- **Disable Ollama** — set `enabled: false` in `{{OLLAMA_CONFIG_PATH}}` (or delete the
  file if the user prefers a clean state)
- **No changes** — skip

**Validation rules** when reading `{{OLLAMA_CONFIG_PATH}}`:
- `enabled` must be a boolean
- `model` must be a non-empty string
- `scope` must be `research` (only supported value)

If any field is invalid, report the specific issue and treat the file as if Ollama is
disabled.

### Reset
- **Restore all agents to {{HOST_DEFAULTS_TERM}}** — delete all override files

If the user chooses **Reset**, show the {{HOST_DEFAULTS_TERM}}, ask for confirmation, then:
1. Delete all `.yaml` files in `{{OVERRIDES_DIR}}`
2. Delete the `{{OVERRIDES_DIR}}` directory if it is empty
3. Report which agents were restored to defaults and skip the remaining steps

---

## Step 3 — Preview

Before writing anything, show the user what will change. For each agent with changes, show the override file that will be written:

```
researcher — override file will be written:
  model: sonnet  (was: haiku)
  tools: Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search  (was: Read, Grep, Glob, LS, WebFetch, WebSearch)

architect — no changes

developer — override file will be deleted (all fields match defaults)
```

Ask the user to confirm before proceeding.

---

## Step 4 — Apply

Read the plugin version from `.claude-plugin/plugin.json` (the `version` field). This is the `plugin_version` value to include in override files.

For each agent that has changes:

### Write override file

Create the `{{OVERRIDES_DIR}}` directory if it does not exist. Write a YAML override file containing **only the fields that differ from {{HOST_DEFAULTS_TERM}}**, plus `plugin_version`. The file path is `{{OVERRIDES_DIR}}<agent>.yaml`.

Format:

```yaml
plugin_version: "1.5.0"
model: sonnet
tools: Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search
memory: user
```

Rules:
- `plugin_version` is always the first field
- Only include `model`, `tools`, or `memory` if they differ from the {{HOST_DEFAULTS_TERM}} for that agent
- Use the same comma-space separated format for tools as in agent frontmatter

### Delete override file

If the user's changes cause all fields for an agent to match {{HOST_DEFAULTS_TERM}} (i.e., no overrides remain), delete that agent's override file if it exists.

---

## Step 5 — Confirm

Report what was changed in a brief summary:

- Which agents had override files written or deleted
- What fields changed (old -> new)
- Remind the user they can run `{{CMD_CONFIGURE}}` again to make further changes, or reset to defaults

---

## Rules

- **Never modify agent `.md` files** — all customizations go in override files under `{{OVERRIDES_DIR}}`
- **Override files only contain changed fields** — do not write fields that match {{HOST_DEFAULTS_TERM}}
- **Always include `plugin_version`** in override files — read it from `.claude-plugin/plugin.json`
- **Delete override files when unnecessary** — if all fields match defaults, remove the file
- **Validate inputs**: models must be `haiku`, `sonnet`, or `opus`; memory must be `user`, `project`, or `local`
- **Tools are comma-space separated**: `Read, Grep, Glob, LS`
- Always show a preview and get confirmation before writing
- If the user asks to reset, delete override files (do not modify agent `.md` files)
