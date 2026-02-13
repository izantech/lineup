# Agents

Lineup uses specialized subagents for different stages of the pipeline. Each agent has a specific role, a curated set of tools, and a model chosen to balance cost and capability.

## Agent roles

| Role | Model | Tools | Purpose |
| ---- | ----- | ----- | ------- |
| **Orchestrator** | -- | All | Coordinates the pipeline, delegates work, interacts with the user |
| **Researcher** | Haiku | Read-only + Web | Explores code, reads docs, gathers context |
| **Architect** | Opus | Read-only + Write | Synthesizes findings into actionable plans |
| **Developer** | Opus | All | Implements the approved plan |
| **Reviewer** | Opus | Read-only + Bash | Runs tests, reviews diffs, validates work |
| **Documenter** | Opus | Read-only + Write + Web | Generates project documentation |
| **Teacher** | Opus | Read-only + Web | Explains codebase components |

The orchestrator is the main Claude Code session itself -- it's not a subagent file, but the top-level coordinator that delegates to the others.

## Why different models?

The researcher uses **Haiku** because its job is high-volume, read-only exploration. It needs to scan many files quickly to gather context. Haiku is fast and cost-effective for this kind of work -- you don't need the most capable model to read and summarize code.

All other agents use **Opus** because their tasks require deeper reasoning: planning architecture, writing correct code, catching subtle bugs, producing clear explanations. These are high-stakes outputs where quality matters more than speed.

You can change any agent's model with `/lineup:configure`. See [Customize Agents](/guides/customize-agents) for details.

## Tool assignments

Each agent gets only the tools it needs. This is intentional -- restricting tools prevents agents from doing things they shouldn't.

### Researcher

`Read, Grep, Glob, LS, WebFetch, WebSearch`

Read-only codebase access plus web search. The researcher can explore files and look up external documentation, but it cannot modify anything. This makes research safe to run without supervision.

### Architect

`Read, Grep, Glob, LS, Write`

Read access plus Write. The architect reads the codebase and research findings, then writes the implementation plan. No Bash or Edit -- planning doesn't require running commands or modifying existing files.

### Developer

`Read, Grep, Glob, LS, Edit, Write, Bash, NotebookEdit`

Full access. The developer needs to create files, edit existing code, run build commands, and handle any file type including notebooks. This is the only agent with unrestricted tools.

### Reviewer

`Read, Grep, Glob, LS, Bash`

Read access plus Bash. The reviewer needs to read the diff and run tests, but should not modify code. If tests fail, the reviewer reports the failure -- it doesn't try to fix things itself.

### Documenter

`Read, Grep, Glob, LS, Write, WebFetch`

Read access, Write, and web fetch. The documenter reads the codebase and implementation details, then writes documentation files. Web fetch allows pulling in external references. No Bash -- documentation doesn't require running commands.

### Teacher

`Read, Grep, Glob, LS, WebFetch, WebSearch`

Same tools as the researcher -- read-only access plus web search. The teacher explores code to build understanding, then produces explanations. Like the researcher, it cannot modify anything.

## Agent memory

All subagents have **persistent user-level memory**. They accumulate knowledge about your codebases across sessions in `~/.claude/agent-memory/<agent>/`.

This means:
- The researcher remembers architectural patterns it discovered in previous sessions
- The developer remembers build quirks and debugging insights
- The reviewer remembers common issues it flagged before

Memory captures reusable knowledge (patterns, conventions, decisions), not session-specific artifacts. This is distinct from the [ephemeral documents](/concepts/ephemeral-documents) that agents produce during a pipeline run.

Memory scope can be changed per-agent with `/lineup:configure`:

| Scope | What it means |
| ----- | ------------- |
| `user` | Memory persists across all projects for this user (default) |
| `project` | Memory is scoped to the current project |
| `local` | Memory is scoped to the current directory |

## Full configuration reference

For the complete specification of agent frontmatter fields, default tool lists, and configuration options, see the [Agent Configuration](/reference/agents) reference.
