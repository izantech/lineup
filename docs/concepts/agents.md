# Agents

Lineup uses specialized subagents for different stages of the pipeline. Each agent has a specific role, a curated set of tools, and a model selected dynamically based on task complexity.

## Agent roles

| Role | Default Model | Tools | Purpose |
| ---- | ------------- | ----- | ------- |
| **Orchestrator** | -- | All | Coordinates the pipeline, delegates work, interacts with the user |
| **Researcher** | Haiku | Read-only + Web | Explores code, reads docs, gathers context |
| **Architect** | Sonnet | Read-only + Write | Synthesizes findings into actionable plans |
| **Developer** | Haiku | All | Implements the approved plan |
| **Reviewer** | Sonnet | Read-only + Bash | Runs tests, reviews diffs, validates work |
| **Documenter** | Opus | Read-only + Write + Web | Generates project documentation |
| **Teacher** | Opus | Read-only + Web | Explains codebase components |

The "Default Model" column shows the model used for simple-complexity tasks. The orchestrator is the main Claude Code session itself -- it's not a subagent file, but the top-level coordinator that delegates to the others.

## Effort-based model selection

Models are not fixed per agent. The orchestrator selects a model for each agent based on the triage complexity classification from Stage 0:

| Role | simple | moderate | complex |
| ---- | ------ | -------- | ------- |
| **Researcher** | Haiku | Sonnet | Sonnet |
| **Architect** | Sonnet | Sonnet | Opus |
| **Developer** | Haiku | Haiku | Sonnet |
| **Reviewer** | Sonnet | Sonnet | Sonnet |

This means a simple bug fix runs researchers on Haiku (fast and cheap), while a complex multi-module refactor upgrades architects to Opus (deeper reasoning for harder planning).

Agents not in the effort mapping table (documenter, teacher) use their frontmatter default model regardless of complexity.

### Override interaction

User overrides (set via `/lineup:configure`) act as a **floor**, not a ceiling. If you override an agent's model to Opus, it will always use at least Opus -- even for simple tasks. If you override to Haiku but effort assigns Sonnet, the agent uses Sonnet (effort requirements take precedence).

See [Customize Agents](/guides/customize-agents) for details on setting model overrides.

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

The teacher is used in the built-in `explain` tactic (via `/lineup:explain`) and in the `explain-codebase` example tactic for full codebase onboarding. See the [Codebase Explanation](/examples/codebase-explanation) walkthrough for a worked example.

## Tool usage priorities and the research protocol

Beyond having the right tools, each agent has built-in guidance on *how* to use them efficiently. Every agent's instructions include a **Tool Usage Priorities** section that orders tools by context cost -- search before reading, read targeted sections instead of whole files, use the cheapest tool that answers the question.

The researcher agent goes further with a **Context-Efficient Research Protocol** -- a three-phase approach (Map with Glob/LS, Scan with Grep, Read only targeted sections) plus output discipline rules that keep findings compact. Agents also include **Tool Pattern Examples** -- concrete, annotated sequences showing effective tool use for common tasks.

These strategies work automatically. You do not need to configure anything. For a detailed breakdown of the protocol, the per-agent priority tables, and the tool pattern examples, see [Context Efficiency](/concepts/context-efficiency).

## Agent memory

All subagents have **persistent project-scoped memory** by default. They accumulate knowledge about the current project across sessions in `~/.claude/projects/<project-path>/agent-memory/<agent>/`.

This means:
- The researcher remembers architectural patterns it discovered in previous sessions
- The developer remembers build quirks and debugging insights
- The reviewer remembers common issues it flagged before

Memory captures reusable knowledge (patterns, conventions, decisions), not session-specific artifacts. This is distinct from the [ephemeral documents](/concepts/ephemeral-documents) that agents produce during a pipeline run.

Memory scope can be changed per-agent with `/lineup:configure`:

| Scope | What it means |
| ----- | ------------- |
| `user` | Memory persists across all projects for this user |
| `project` | Memory is scoped to the current project (default) |
| `local` | Memory is scoped to the current directory |

### Memory migration

When you first run the pipeline in a project, the kick-off skill checks whether any agents have global memory (from `user`-scoped usage) that contains knowledge relevant to the current project. If so, it automatically migrates those sections to project-scoped memory. This is a one-time operation -- subsequent runs skip it silently. The migration ensures that project-specific knowledge ends up in the right scope even if agents previously used `user` memory.

## Claude Code Teams mode

When `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in your environment, the kick-off pipeline runs agents as **teammates** instead of subagents. A single team named `lineup` is created during initialization, and each agent spawns as a named teammate visible as a tmux pane.

Key differences from standard subagent mode:

- **Visibility**: teammates appear as named tmux panes, which makes it easier to follow what each agent is doing in real time.
- **Prompt embedding**: because the teams runtime does not apply agent frontmatter automatically, the orchestrator reads each agent's `.md` file and embeds the body instructions directly in the spawn prompt.
- **Tool restrictions advisory**: the tool list from agent frontmatter is not enforced by the platform in team mode -- it is treated as a guideline only.
- **No sub-teammates**: teammates cannot spawn their own teammates. Nesting is blocked by the platform.

If `TeamCreate` is not available (standard Claude Code without the experiment flag, or Codex CLI), the pipeline falls back to the standard subagent path transparently -- no configuration change needed.

## Full configuration reference

For the complete specification of agent frontmatter fields, default tool lists, and configuration options, see the [Agent Configuration](/reference/agents) reference.
