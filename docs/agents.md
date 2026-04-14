# Agents

## Agent Definitions (`agents/*.md`)

Each agent file has YAML frontmatter:

```markdown
---
name: <role>
color: <color>
description: <one-line>
tools: <comma-separated>
model: haiku|sonnet|opus
memory: user|project|local
---

<Agent instructions>
```

Frontmatter fields:

- `name`: role name
- `color`: visual color (`blue`, `green`, `yellow`, `red`; `cyan`, `magenta` may render inconsistently)
- `description`: one-line summary
- `tools`: comma-space separated list
- `model`: `haiku`, `sonnet`, or `opus`
- `memory`: `user`, `project`, or `local`

## Conditional Ollama Appendices (`agents/*-ollama.md`)

Agents with Ollama integration (researcher, architect) have a separate `*-ollama.md`
appendix file containing all Ollama-specific instructions. The orchestrator appends
these to the spawn prompt only when `OLLAMA_AVAILABLE = true`, saving ~3.6 KB per
agent spawn when Ollama is disabled.

## Teams Mode

When Claude Code's experimental teams feature is enabled, Lineup spawns agents as visible
tmux panes instead of background subagents. Each agent appears as a named pane with its
role and status.

The orchestrator creates a session-scoped team (`lineup-<session_id>`) and manages teammate
lifecycle — spawning agents when stages begin, shutting them down when their work completes.
Teams mode falls back to standard subagents transparently when unavailable.

## Runtime Contract

Agents are orchestrated by the CLI runtime, not by the host skill templates. Generated
skills launch `lineup bridge start "<user request>" --executor-host <host>`, poll
`lineup bridge events <run-id> --after <seq> --wait <seconds> --json`, and answer
questions with `lineup bridge answer <run-id> <request-id> --choice <value>`.
Interactive terminal use stays on `lineup run --mode human`.

Fresh projects still need `lineup init` before native implementation can run. It
scaffolds the workflow/runtime files and initializes git if needed. Host wrappers
should still verify that the repo has at least one commit before launching
the bridge or `lineup run --mode host`.

`lineup run --mode host` remains public for advanced/custom integrations and CI, but
generated skills should treat it as the low-level raw protocol path rather than the
default host integration.

Repo-local `agents/*.md` files are optional. When a project does not define one, Lineup
falls back to the bundled definitions shipped in `cli/agents/`. Use repo-local files only
when the project needs to override the default role instructions.

## Ollama Integration

Lineup optionally uses local Ollama-backed models. Ollama runs in two scopes:
`research` for pre-digesting large files and fetch results, and `full` for broader
local-agent coverage when explicitly enabled.

Configuration is in `~/.claude/lineup/ollama.yaml`. When enabled, researchers can use
`research` scope for pre-digesting large files and web fetch results, or `full` scope
to route all Lineup agent stages through the selected host using the configured local
model target. When unavailable, all features degrade cleanly — Ollama is never required
for correctness.

## Agent Configuration Overrides

Runtime overrides are persisted outside the repo:

- Claude: `~/.claude/lineup/agents/`
- Codex: `~/.codex/lineup/agents/`
- Opencode: `~/.config/opencode/lineup/agents/`

Override precedence: user override > agent frontmatter defaults.

## Memory

Default memory scope is `project`.

Storage locations:

- `user`: `~/.claude/agent-memory/<agent>/`
- `project`: `~/.claude/projects/<project-path>/agent-memory/<agent>/`
- `local`: `.lineup/memory/<agent>/`

Use project memory for project-specific knowledge; user memory for cross-project knowledge.

Migration for global memory files over 50 KB is incremental — section headers are scanned
first, then only matching sections are read into context.
