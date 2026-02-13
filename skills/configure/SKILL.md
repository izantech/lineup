---
name: configure
description: Interactively customize Lineup agent settings (models, tools, memory)
---

You are the orchestrator for the **Lineup agent configurator**. Walk the user through customizing agent settings, then apply changes directly to the agent `.md` files.

The agent files live in this plugin's `agents/` directory — two levels up from this skill file.

---

## Step 1 — Read current config

Read all agent files from the plugin's `agents/` directory:
- `researcher.md`
- `architect.md`
- `developer.md`
- `reviewer.md`
- `documenter.md`
- `teacher.md`

Extract and display their current frontmatter in a summary table:

| Agent | Model | Memory | Tools |
|-------|-------|--------|-------|
| researcher | haiku | user | Read, Grep, Glob, LS, WebFetch, WebSearch |
| architect | opus | user | Read, Grep, Glob, LS, Write |
| ... | ... | ... | ... |

---

## Step 2 — Ask what to change

Present the configuration options using **AskUserQuestion**. Offer these categories:

### Model
- **Keep defaults** — no changes
- **Set one model for all agents** — ask which: `haiku`, `sonnet`, or `opus`
- **Set per-agent** — ask for each agent individually

### Tools
- **Replace tools** — swap one tool for another across all agents (e.g. `WebSearch` → `mcp__brave-search__brave_web_search`)
- **Add tools** — append tools to specific agents
- **Remove tools** — remove tools from specific agents
- **No changes** — keep current tools

### Memory
- **Keep defaults** — no changes
- **Set one scope for all agents** — ask which: `user`, `project`, or `local`
- **Set per-agent** — ask for each agent individually

### Reset
- **Restore all agents to defaults** — rewrite frontmatter to the defaults listed below

If the user chooses **Reset**, show the default frontmatter, ask for confirmation, apply it, skip the remaining steps, and report what was done.

Default frontmatter values:

| Agent | Model | Memory | Tools |
|-------|-------|--------|-------|
| researcher | haiku | user | Read, Grep, Glob, LS, WebFetch, WebSearch |
| architect | opus | user | Read, Grep, Glob, LS, Write |
| developer | opus | user | Read, Grep, Glob, LS, Edit, Write, Bash, NotebookEdit |
| reviewer | opus | user | Read, Grep, Glob, LS, Bash |
| documenter | opus | user | Read, Grep, Glob, LS, Write, WebFetch |
| teacher | opus | user | Read, Grep, Glob, LS, WebFetch, WebSearch |

---

## Step 3 — Preview

Before writing anything, show the user the **final frontmatter** for each agent that will change. Format it clearly:

```
researcher.md:
---
name: researcher
description: <unchanged>
tools: Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search
model: sonnet
memory: user
---

architect.md:
  (no changes)
```

Ask the user to confirm before proceeding.

---

## Step 4 — Apply

Edit each agent `.md` file that needs changes. **Only modify the frontmatter** (the YAML block between the two `---` lines). Preserve the body content (everything after the second `---`) exactly as-is.

Frontmatter fields and their format:
- `name`: agent role name (string)
- `description`: one-line description (string)
- `tools`: comma-space separated list (e.g. `Read, Grep, Glob, LS`)
- `model`: one of `haiku`, `sonnet`, `opus`
- `memory`: one of `user`, `project`, `local`

When editing, replace the entire frontmatter block (from the first `---` to the second `---`, inclusive) with the updated version.

---

## Step 5 — Confirm

Report what was changed in a brief summary:

- Which agents were modified
- What fields changed (old → new)
- Remind the user they can run `/lineup:configure` again to make further changes, or reset to defaults

---

## Rules

- **Never modify the body** of an agent file — only the frontmatter
- **Validate inputs**: models must be `haiku`, `sonnet`, or `opus`; memory must be `user`, `project`, or `local`
- **Tools are comma-space separated** in frontmatter: `Read, Grep, Glob, LS`
- Always show a preview and get confirmation before writing
- If the user asks to reset, rewrite frontmatter to the hardcoded defaults (do not depend on git)
