# Use Teams Mode

When Claude Code's experimental teams feature is available, Lineup can run agents as **teammates** instead of subagents. Each agent appears as a named tmux pane, giving you real-time visibility into what every agent is doing.

## Prerequisites

- Claude Code with teams support
- The `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` environment variable set
- The `TeamCreate` tool available in your session

## Enable teams mode

Set the environment variable before launching Claude Code:

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude
```

Or set it inline:

```bash
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude
```

Then run the pipeline as usual:

```
/lineup:kick-off Add a caching layer to the API
```

The orchestrator detects `TeamCreate` availability and automatically creates a `lineup` team. No other configuration is needed.

## What changes in teams mode

### Agent visibility

In standard mode, subagents run in the background and you only see their output when they finish. In teams mode, each agent spawns as a **named tmux pane** -- you can watch the researcher scanning files, the architect writing the plan, and the developer implementing code, all in real time.

### Prompt embedding

The teams runtime does not apply agent definition files (frontmatter + body) automatically when `team_name` is specified. To work around this, the orchestrator reads each agent's `.md` file and embeds the full instructions directly in the spawn prompt. This means agents behave identically in both modes -- the instructions are the same, only the delivery mechanism differs.

### Tool restrictions

In standard subagent mode, the tool list from agent frontmatter is enforced by the platform. In teams mode, tool restrictions are **advisory only** -- a known platform limitation. Agents still follow their defined tool boundaries through their instructions, but the platform does not block disallowed tool calls.

### No nesting

Teammates cannot spawn their own teammates. The platform blocks nested team creation, so the orchestrator does not attempt it.

## Fallback behavior

If any of the prerequisites are missing -- the environment variable is unset, `TeamCreate` is unavailable, or team creation fails -- the pipeline falls back to standard subagent mode transparently. You do not need to change any configuration. The orchestrator logs which mode it selected during initialization.

## When to use teams mode

Teams mode is useful when you want to:

- **Monitor agent activity** in real time during long-running pipelines
- **Debug pipeline behavior** by watching what each agent reads, searches, and writes
- **Demo Lineup** to others with visible, parallel agent activity

For most day-to-day use, standard subagent mode works identically. The pipeline output and quality are the same in both modes.
