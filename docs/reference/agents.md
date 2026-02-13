# Agent Configuration

This is the complete reference for Lineup agent configuration. For a conceptual overview of what agents do and why they exist, see [Agents](/concepts/agents).

## Frontmatter schema

Every agent is defined as a Markdown file in the plugin's `agents/` directory. The YAML frontmatter block controls configuration:

```markdown
---
name: researcher
color: blue
description: Explores codebases, reads documentation, and gathers context.
tools: Read, Grep, Glob, LS, WebFetch, WebSearch
model: haiku
memory: user
---

(Agent instructions follow here)
```

### Fields

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `name` | string | Yes | Agent role name. Must match the filename without `.md`. |
| `color` | string | Yes | Display color for visual identification in the terminal. |
| `description` | string | Yes | One-line summary of the agent's purpose and when to use it. |
| `tools` | string | Yes | Comma-space separated list of tools the agent can use. |
| `model` | string | Yes | Language model to use. One of `haiku`, `sonnet`, `opus`. |
| `memory` | string | Yes | Persistent memory scope. One of `user`, `project`, `local`. |

### Color values

| Color | Status |
| ----- | ------ |
| `blue` | Fully supported |
| `green` | Fully supported |
| `yellow` | Fully supported |
| `red` | Fully supported |
| `cyan` | Supported (may have rendering issues in some terminals) |
| `magenta` | Supported (may have rendering issues in some terminals) |

### Model values

| Value | Description |
| ----- | ----------- |
| `haiku` | Fast, cost-effective. Best for high-volume exploration tasks. |
| `sonnet` | Balanced cost and capability. Strong general reasoning. |
| `opus` | Most capable. Best for planning, implementation, and review. |

### Memory values

| Value | Storage location | Shared across |
| ----- | ---------------- | ------------- |
| `user` | `~/.claude/agent-memory/<agent>/` | All projects for this user |
| `project` | Project-scoped memory | Only the current project |
| `local` | Directory-scoped memory | Only the current directory |

## Default agent configurations

These are the factory defaults. Use `/lineup:configure` to customize, or reset to these values at any time. See [Customize Agents](/guides/customize-agents) for a walkthrough.

### Researcher

| Field | Default |
| ----- | ------- |
| Name | `researcher` |
| Color | `blue` |
| Model | `haiku` |
| Memory | `user` |
| Tools | `Read, Grep, Glob, LS, WebFetch, WebSearch` |

Read-only codebase exploration with web search. Cannot modify files. Safe to run without supervision. Uses Haiku for cost-effective, high-volume file scanning.

### Architect

| Field | Default |
| ----- | ------- |
| Name | `architect` |
| Color | `red` |
| Model | `opus` |
| Memory | `user` |
| Tools | `Read, Grep, Glob, LS, Write` |

Reads the codebase and research findings, then writes implementation plans. Has Write to save plans when requested. No Bash or Edit -- planning doesn't require running commands or modifying existing files.

### Developer

| Field | Default |
| ----- | ------- |
| Name | `developer` |
| Color | `yellow` |
| Model | `opus` |
| Memory | `user` |
| Tools | `Read, Grep, Glob, LS, Edit, Write, Bash, NotebookEdit` |

Full tool access. Creates files, edits code, runs build commands, handles notebooks. The only agent with unrestricted tools.

### Reviewer

| Field | Default |
| ----- | ------- |
| Name | `reviewer` |
| Color | `green` |
| Model | `opus` |
| Memory | `user` |
| Tools | `Read, Grep, Glob, LS, Bash` |

Read access plus Bash to run tests. Cannot modify code. Reports issues rather than fixing them.

### Documenter

| Field | Default |
| ----- | ------- |
| Name | `documenter` |
| Color | `cyan` |
| Model | `opus` |
| Memory | `user` |
| Tools | `Read, Grep, Glob, LS, Write, WebFetch` |

Read access, Write (for creating documentation files), and WebFetch (for pulling in external references). No Bash -- documentation doesn't require running commands.

### Teacher

| Field | Default |
| ----- | ------- |
| Name | `teacher` |
| Color | `magenta` |
| Model | `opus` |
| Memory | `user` |
| Tools | `Read, Grep, Glob, LS, WebFetch, WebSearch` |

Same tool set as the researcher -- read-only access plus web search. Explores code to build understanding, then produces explanations.

## Available tools

These are the tools that can be assigned to agents:

| Tool | Purpose |
| ---- | ------- |
| `Read` | Read file contents |
| `Grep` | Search file contents with regex |
| `Glob` | Find files by pattern |
| `LS` | List directory contents |
| `Edit` | Modify existing files |
| `Write` | Create or overwrite files |
| `Bash` | Execute shell commands |
| `NotebookEdit` | Edit Jupyter notebook cells |
| `WebFetch` | Fetch content from URLs |
| `WebSearch` | Search the web |

MCP tools can also be used. For example, `mcp__brave-search__brave_web_search` for the Brave Search MCP server. Tool names are specified exactly as they appear in Claude Code.

## Tool format in frontmatter

Tools are specified as a comma-space separated list:

```yaml
tools: Read, Grep, Glob, LS, WebFetch, WebSearch
```

Not an array -- this is a flat string with comma-space (`, `) as the delimiter.

## Agent file structure

The frontmatter is the configuration block. The body (everything after the second `---`) contains the agent's instructions. Both frontmatter and body are immutable -- `/lineup:configure` never modifies these files. Instead, it writes override files to `~/.claude/lineup/agents/`.

```markdown
---
name: researcher
color: blue
description: One-line summary.
tools: Read, Grep, Glob, LS
model: haiku
memory: user
---

(This is the agent's instruction body.
Neither the body nor the frontmatter are modified by /lineup:configure.
User customizations are stored as override files in ~/.claude/lineup/agents/.)
```

## The orchestrator

The orchestrator is the main Claude Code session itself. It coordinates the pipeline, delegates to subagents, and interacts with the user. It is not a subagent file -- there is no `orchestrator.md`.

The orchestrator has access to all tools and runs at whatever model the user's Claude Code session uses. It cannot be configured through `/lineup:configure`.
