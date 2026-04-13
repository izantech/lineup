---
title: How It Works
description: Pipeline architecture, triage, stage caching, tactics, teams mode, and Ollama integration.
---

## Pipeline

Lineup decomposes a task into **stages**, each assigned to a typed agent (researcher, architect, developer, reviewer, documenter). Stages execute sequentially by default, with parallel execution where the dependency graph allows it.

The full pipeline: **Triage → Clarify → Research → Clarification Gate → Plan → Implement → Verify → Document**

Not every task runs all stages. Triage classifies complexity and selects the appropriate pipeline tier:

| Tier | Stages | When used |
|------|--------|-----------|
| Full | 0–7 | Multi-module changes, unclear requirements, unfamiliar code |
| Lightweight | 0, 4–6 | Single-module changes with understood scope |
| Direct | Inline | Single-file fixes with explicit instructions |

## Triage

Stage 0 runs before any agent is spawned. It produces:

- **Complexity classification** (`simple`, `moderate`, `complex`) — drives model selection per role
- **Affected areas** — scopes downstream research
- **Search targets** — concrete file patterns and questions for researchers
- **Independent areas** — enables parallel architect spawns when 2+ areas have no coupling

Model assignment follows the effort mapping:

| Role | Simple | Moderate | Complex |
|------|--------|----------|---------|
| Researcher | Haiku | Sonnet | Sonnet |
| Architect | Sonnet | Sonnet | Opus |
| Developer | Haiku | Haiku | Sonnet |
| Reviewer | Sonnet | Sonnet | Sonnet |

## Execution methods

The `--implement-method` flag controls how developer agent sessions are batched during implementation:

| Method | Behavior | Use case |
|--------|----------|----------|
| `phase` (default) | One agent session per wave | Balanced context and cost |
| `task` | One agent session per task, no prior context | Maximum isolation, lowest context bloat |
| `single-session` | All tasks in one session with cumulative context | Small specs, fast iteration |

In `task` mode, each developer agent receives only its own task scope — no cross-task context leaks. In `single-session` mode, summaries of all prior completed tasks are injected into each prompt. `phase` groups tasks by their dependency wave.

## Retry and resume

Pipeline runs persist retry state per stage. When a stage fails:

- `lineup resume <run-id> --retry-failed` retries from the failed stage
- `--max-retries <n>` caps attempts per stage (default: 3)
- Retry count, last error, and timestamps are recorded in `pipeline-state.json`

Runs also track `started_at`, `finished_at`, and `duration_ms` for timing analysis.

## Wave visualization

`lineup waves` displays the compiled task execution plan from the latest (or a specific) run:

```
Execution Waves (6 tasks → 3 waves)

  Wave 1 (3 parallel)
    CHANGE-001  Add validation schema
    CHANGE-002  Create error types
    CHANGE-003  Update config parser

  Wave 2 (2 parallel)
    CHANGE-004  Implement validator
    CHANGE-005  Add integration test

  Wave 3
    CHANGE-006  Wire up to endpoint

  Max parallelism: 3
  Sequential depth: 3
```

Use `--json` for machine consumption or `--compact` for minimal output.

## Execution history

`lineup history` lists past pipeline runs with status, duration, stage counts, and retry information:

```
Pipeline History (5 runs)

  ID       Status       Workflow           Duration   Stages   Started
  ──────── ──────────── ────────────────── ────────── ──────── ────────────────────
  0db944   OK           full-pipeline      2m 34s     7        12m ago
  31a577   FAIL         full-pipeline      1m 12s     4        1h ago
  114639   CANCEL       full-pipeline      0.8s       1        3h ago
```

Filter with `--status` or limit with `--limit <n>`.

## Desktop notifications

The pipeline sends native desktop notifications on completion or failure. macOS uses `osascript` with a Glass sound; Linux uses `notify-send`. Notifications are auto-disabled in CI environments and are best-effort — failures never block the pipeline.

## Stage caching

Each stage writes its output to `.lineup/.cache/`. On re-run with the same task, Lineup detects cached results and offers to skip completed stages. The `--from-stage N` flag restarts execution at stage N using cached upstream outputs.

This makes long pipelines practical. A 5-stage run that fails at stage 4 can be fixed and resumed without re-running stages 1–3. Token cost scales with the work that actually needs to be redone.

## Tactics

Tactics are YAML workflow templates that replace or extend the default pipeline. A tactic defines a sequence of stages, each mapped to an agent type, with optional approval gates and variables.

```yaml
name: security-review
description: Security-focused audit pipeline
stages:
  - type: research
    agent: researcher
    prompt: "Identify attack surface in ${target}"
  - type: plan
    agent: architect
    gate: approval
  - type: implement
    agent: developer
variables:
  target:
    description: File or module to audit
    default: "src/"
```

Tactics compose — a stage can reference another tactic, which is inlined recursively with cycle detection. Project tactics in `.lineup/tactics/` override built-in tactics by name.

## Teams mode

When Claude Code's experimental teams feature is enabled, Lineup spawns agents as visible tmux panes instead of background subagents. Each agent appears as a named pane with its role and status.

The orchestrator creates a session-scoped team (`lineup-<session_id>`) and manages teammate lifecycle — spawning agents when stages begin, shutting them down when their work completes. Teams mode falls back to standard subagents transparently when unavailable.

## Ollama

Lineup optionally delegates summarization and context gathering to local Ollama models. Code generation and architectural decisions always use the primary model.

Configuration is in `~/.claude/lineup/ollama.yaml`. When enabled, researchers use Ollama for pre-digesting large files and web fetch results. When unavailable, all features degrade cleanly — Ollama is never required for correctness.

---

[Examples](/examples/) · [Getting Started](/getting-started/)
