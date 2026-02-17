# Customize Agents

This guide walks through using `/lineup:configure` to change agent models, tools, and memory settings.

## Running the configurator

Type the command in a Claude Code session with Lineup installed:

```bash
/lineup:configure
```

The configurator walks through five steps: read current config, ask what to change, preview, apply, and confirm.

## Step 1: Current config

The configurator reads all agent files and displays a summary table:

| Agent | Model | Memory | Tools |
| ----- | ----- | ------ | ----- |
| researcher | haiku | project | Read, Grep, Glob, LS, WebFetch, WebSearch |
| architect | opus | project | Read, Grep, Glob, LS, Write |
| developer | opus | project | Read, Grep, Glob, LS, Edit, Write, Bash, NotebookEdit |
| reviewer | opus | project | Read, Grep, Glob, LS, Bash |
| documenter | opus | project | Read, Grep, Glob, LS, Write, WebFetch |
| teacher | opus | project | Read, Grep, Glob, LS, WebFetch, WebSearch |

This shows you the starting point before any changes.

## Step 2: What you can change

The configurator offers four categories. You can change one or more in a single session.

### Model

Controls which language model each agent uses.

| Option | What it does |
| ------ | ------------ |
| Keep defaults | No changes |
| Set one model for all agents | All agents use the same model |
| Set per-agent | Choose individually for each agent |

Valid models: `haiku`, `sonnet`, `opus`.

### Tools

Controls which tools each agent has access to.

| Option | What it does |
| ------ | ------------ |
| Replace tools | Swap one tool for another across all agents |
| Add tools | Append tools to specific agents |
| Remove tools | Remove tools from specific agents |
| No changes | Keep current tools |

### Memory

Controls how each agent stores persistent knowledge across sessions.

| Option | What it does |
| ------ | ------------ |
| Keep defaults | No changes |
| Set one scope for all agents | All agents use the same memory scope |
| Set per-agent | Choose individually for each agent |

Valid scopes: `user`, `project`, `local`.

### Reset

Restores all agents to their factory defaults. The configurator deletes all override files in `~/.claude/lineup/agents/`.

## Step 3: Preview

Before writing anything, the configurator shows you the override files that will be created or modified:

```yaml
# ~/.claude/lineup/agents/researcher.yaml
tools: Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search (was: Read, Grep, Glob, LS, WebFetch, WebSearch)
```

For agents that won't change, you'll see `(no changes)`. If all fields match defaults for an agent, its override file will be deleted.

Review the preview and confirm before changes are applied.

## Step 4: Apply

The configurator writes override YAML files to `~/.claude/lineup/agents/`, never modifying the plugin's agent `.md` files. This means agent instructions always come from the plugin and benefit from upstream improvements.

## Step 5: Confirm

You'll see a summary of what changed:

:::tip Changes Applied

Changes applied:
- researcher: model haiku -> sonnet, WebSearch -> mcp__brave-search__brave_web_search
- teacher: model opus -> sonnet, WebSearch -> mcp__brave-search__brave_web_search

:::

## When to change models

Model selection is a cost-vs-quality tradeoff:

| Model | Cost | Quality | Best for |
| ----- | ---- | ------- | -------- |
| **Haiku** | Lowest | Good for exploration | Researchers doing high-volume file scanning |
| **Sonnet** | Moderate | Strong general reasoning | Good balance when cost matters |
| **Opus** | Highest | Best reasoning | Planning, implementation, review -- high-stakes outputs |

The defaults (Haiku for researcher, Opus for everything else) are a good starting point. Consider changing them when:

- **Cost is a concern:** Downgrade architects or reviewers to Sonnet. They'll still produce good output for most tasks.
- **Speed matters more than depth:** Switch all agents to Sonnet for faster pipeline runs.
- **Research quality matters:** Upgrade the researcher to Sonnet or Opus for tasks where deep code analysis is critical.

## How to add or replace tools

The most common tool change is swapping the built-in `WebSearch` for a dedicated search tool like the Brave Search MCP:

:::info

Replace WebSearch with mcp__brave-search__brave_web_search for all agents

:::

The configurator handles the swap across all agents that currently have `WebSearch` (researcher and teacher by default).

You can also add tools to agents that don't have them. For example, giving the reviewer `WebFetch` so it can check external API documentation during verification.

## Memory scopes

Memory controls where agents store persistent knowledge across sessions:

| Scope | Stored in | Shared across |
| ----- | --------- | ------------- |
| `user` | `~/.claude/agent-memory/<agent>/` | All projects for this user |
| `project` | `~/.claude/projects/<project-path>/agent-memory/<agent>/` | Only this project |
| `local` | `.lineup/memory/<agent>/` | Only the current directory |

**When to use `project` (default):** Agents accumulate knowledge specific to the current project -- architecture decisions, file locations, build quirks, conventions. This is the best default for most workflows because project knowledge stays isolated and relevant.

**When to use `user`:** You want agents to carry knowledge across all your projects. The researcher remembers patterns from your React project when working on your Vue project. Useful for solo developers who work across similar codebases.

**When to use `local`:** Rarely needed. Scopes memory to the exact directory, which is too narrow for most workflows.

## How customizations persist

The configurator saves your changes to `~/.claude/lineup/agents/` as small YAML
override files. These files live outside the plugin directory, so they survive
plugin updates.

Each override file contains only the fields you changed:

```yaml
# ~/.claude/lineup/agents/researcher.yaml
plugin_version: "1.5.0"
model: sonnet
tools: Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search
memory: user
```

When you run the pipeline, the kick-off skill reads these overrides and applies
them when spawning agents. If no override file exists for an agent, it uses the
plugin defaults.

### Override scope

Overrides are **user-level** — they apply to all projects for the current user.
For project-level differences:
- Use `project` memory scope so agents build project-specific knowledge
- Use [tactics](/concepts/tactics) to define project-specific workflows with custom prompts

### What gets overridden

Only frontmatter fields are overridden: `model`, `tools`, and `memory`. The agent's
instructions (the body of its .md file) always come from the plugin and benefit from
upstream improvements on every update.

## After a plugin update

Your customizations carry over automatically. When the plugin updates:

1. New agent instructions take effect immediately (from the updated plugin files)
2. Your model, tools, and memory choices remain active (from your override files)
3. New agents added in the update use their defaults until you customize them

If a major version changes the available agents or tool names, the configurator
will note this when you next run `/lineup:configure` and help you review your
overrides.

## Examples

### Downgrade all agents to Sonnet

Choose "Set one model for all agents" and select `sonnet`. Every agent runs on Sonnet, reducing cost while maintaining strong quality for most tasks.

### Add Brave Search

Choose "Replace tools" and swap `WebSearch` for `mcp__brave-search__brave_web_search`. This affects the researcher and teacher agents, which are the two that have web search by default.

### Use project memory for team consistency

Choose "Set one scope for all agents" and select `project`. Agents accumulate knowledge specific to the current project rather than mixing it with other projects.

## How to reset to defaults

Run `/lineup:configure` and choose "Reset". The configurator restores all agents to their factory defaults:

| Agent | Model | Memory | Tools |
| ----- | ----- | ------ | ----- |
| researcher | haiku | project | Read, Grep, Glob, LS, WebFetch, WebSearch |
| architect | opus | project | Read, Grep, Glob, LS, Write |
| developer | opus | project | Read, Grep, Glob, LS, Edit, Write, Bash, NotebookEdit |
| reviewer | opus | project | Read, Grep, Glob, LS, Bash |
| documenter | opus | project | Read, Grep, Glob, LS, Write, WebFetch |
| teacher | opus | project | Read, Grep, Glob, LS, WebFetch, WebSearch |

This is a hard reset -- it doesn't depend on git history, so it works even if you've modified agent files manually.
