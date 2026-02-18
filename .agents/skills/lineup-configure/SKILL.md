<!-- AUTO-GENERATED. Edit canonical source in .lineup-core/. -->

---
name: lineup-configure
description: Interactively customize Lineup agent settings (models, tools, memory)
---

You are the orchestrator for the **Lineup agent configurator**. Walk the user through customizing agent settings, then write override files to persist their preferences.

Customizations are stored as YAML override files in `~/.codex/lineup/agents/`. The skill pack's agent `.md` files are **never modified** — they provide defaults, and overrides layer on top.

---

## Step 1 — Read current config

### 1a. Read skill pack defaults

Read all agent files from the repository's `agents/` directory:
- `researcher.md`
- `architect.md`
- `developer.md`
- `reviewer.md`
- `documenter.md`
- `teacher.md`

Extract the frontmatter fields: `model`, `tools`, `memory`.

These are the skill pack defaults (used as reference if agent files cannot be read):

| Agent | Model | Memory | Tools |
|-------|-------|--------|-------|
| researcher | haiku | project | Read, Grep, Glob, LS, WebFetch, WebSearch |
| architect | opus | project | Read, Grep, Glob, LS, Write |
| developer | opus | project | Read, Grep, Glob, LS, Edit, Write, Bash, NotebookEdit |
| reviewer | opus | project | Read, Grep, Glob, LS, Bash |
| documenter | opus | project | Read, Grep, Glob, LS, Write, WebFetch |
| teacher | opus | project | Read, Grep, Glob, LS, WebFetch, WebSearch |

### 1b. Read user overrides

Check if `~/.codex/lineup/agents/` exists. For each agent, check if a corresponding override file exists (e.g. `~/.codex/lineup/agents/researcher.yaml`).

Override files are YAML with this format:

```yaml
plugin_version: "1.5.0"
model: sonnet
tools: Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search
```

Only fields the user has changed from defaults are present (plus `plugin_version`).

### 1c. Merge and display

For each agent, merge: **override values win** over skill pack defaults. Display the merged config in a summary table. Mark overridden fields with `*`:

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

If any overrides exist, note: "Run with **Reset** to restore all agents to skill pack defaults."

---

## Step 2 — Ask what to change

Present the configuration options using **structured multiple-choice prompts**. Offer these categories:

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

### Reset
- **Restore all agents to skill pack defaults** — delete all override files

If the user chooses **Reset**, show the skill pack defaults, ask for confirmation, then:
1. Delete all `.yaml` files in `~/.codex/lineup/agents/`
2. Delete the `~/.codex/lineup/agents/` directory if it is empty
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

Create the `~/.codex/lineup/agents/` directory if it does not exist. Write a YAML override file containing **only the fields that differ from skill pack defaults**, plus `plugin_version`. The file path is `~/.codex/lineup/agents/<agent>.yaml`.

Format:

```yaml
plugin_version: "1.5.0"
model: sonnet
tools: Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search
memory: user
```

Rules:
- `plugin_version` is always the first field
- Only include `model`, `tools`, or `memory` if they differ from the skill pack defaults for that agent
- Use the same comma-space separated format for tools as in agent frontmatter

### Delete override file

If the user's changes cause all fields for an agent to match skill pack defaults (i.e., no overrides remain), delete that agent's override file if it exists.

---

## Step 5 — Confirm

Report what was changed in a brief summary:

- Which agents had override files written or deleted
- What fields changed (old -> new)
- Remind the user they can run `$lineup-configure` again to make further changes, or reset to defaults

---

## Rules

- **Never modify agent `.md` files** — all customizations go in override files under `~/.codex/lineup/agents/`
- **Override files only contain changed fields** — do not write fields that match skill pack defaults
- **Always include `plugin_version`** in override files — read it from `.claude-plugin/plugin.json`
- **Delete override files when unnecessary** — if all fields match defaults, remove the file
- **Validate inputs**: models must be `haiku`, `sonnet`, or `opus`; memory must be `user`, `project`, or `local`
- **Tools are comma-space separated**: `Read, Grep, Glob, LS`
- Always show a preview and get confirmation before writing
- If the user asks to reset, delete override files (do not modify agent `.md` files)
