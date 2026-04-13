---
title: Migrating from V2
description: What changed in Lineup V3, how to upgrade, and what to watch for.
---

## Overview

V3 rewrites the skill layer from ~100 KB of orchestrator prompt down to ~12 KB of thin CLI wrappers. Pipeline orchestration — agent spawning, DAG scheduling, state management, artifacts — now lives entirely in the CLI. Skills now use the bridge API: they start a session, poll compact events, and answer user questions. The CLI handles the actual orchestration.

This is a breaking change for the skill format. Agent overrides, tactics, project memory, and cached stage results are preserved.

## Upgrade

```bash
npm install -g @izantech/lineup-cli@latest
lineup update
```

`lineup update` regenerates host skill files from the new lean templates. Existing runs in `.lineup/.runs/` are not modified.

If you installed from source:

```bash
./dev install local
```

## What changed

### Skill architecture

| | V2 | V3 |
|--|----|----|
| Skill size | ~100 KB (full orchestrator) | ~12 KB (CLI wrapper) |
| Pipeline orchestration | Inside the skill prompt | Inside the CLI (`run-pipeline.ts`) |
| Agent spawning | Skill spawns agents directly | CLI owns agent spawning internally |
| Gate handling | Skill manages gates inline | Skill polls `lineup bridge events` and calls `lineup bridge answer` |
| Tactic execution | Skill interprets tactic YAML | CLI converts tactics to workflows via `tacticToWorkflow()` |

Skills no longer contain pipeline logic. They launch `lineup bridge start "<user request>" --executor-host <host>`, poll `lineup bridge events <run-id> --after <seq> --wait <seconds>`, and handle questions by asking the user and calling `lineup bridge answer <run-id> <request-id> --choice <value>`.
In fresh projects they should preflight `lineup init` plus git readiness first. `lineup init`
now initializes git when needed, but native implementation still requires an initial commit.

### Gate protocol

Questions are now typed. Each bridge `question` event includes a `gateType` field:

| gateType | Stage | Purpose |
|----------|-------|---------|
| `clarify` | Clarify | Structured questions about the request |
| `clarification` | Gate | Research-driven ambiguity resolution |
| `approval` | Plan | Plan approve/reject |
| `cache` | Any cached stage | Use cached results or re-run |
| `verify-decision` | Verify | Retry failed tasks, accept with warnings, or abort |
| `custom` | Tactic-defined | Custom gate from tactic `gate: approval` |

### Tactic auto-conversion

Existing tactic YAML files work without changes. The CLI converts them to the internal workflow format at runtime:

- Linear stages become DAG nodes with sequential dependencies
- `optional: true` propagates to workflow stage flags
- `gate: approval` inserts an approval stage
- `verification` criteria append a verify stage
- Variables map to workflow variables

Use `lineup tactic convert <name>` to preview the conversion without running.

### Pre-stage logic

The triage and research stages are no longer stubs. Triage now reads git diff stats when a
repository with a HEAD commit is available and otherwise falls back cleanly to file-system
stats. Research and plan execution are handled inside the bridge worker, while clarify
and gate stages surface as bridge questions.

## New CLI flags

Added to `lineup run`:

| Flag | Purpose |
|------|---------|
| `--mode human|host` | Select interactive human mode or NDJSON host mode. Defaults to `human` on a TTY and `host` otherwise. |
| `--gate-timeout <seconds>` | Save state as `blocked` on timeout instead of waiting indefinitely. |
| `--implement-method <method>` | Task execution batching: `phase` (default), `task` (per-task isolation), or `single-session`. |

Added to `lineup resume`:

| Flag | Purpose |
|------|---------|
| `--max-retries <n>` | Cap retry attempts per stage (default: 3). Used with `--retry-failed`. |

Interactive gate prompts are used in `--mode human`. Gate types map to readline prompts: approval is Y/n, clarify is free-text, verify-decision is a numbered menu. Generated skills now use the bridge API; `--mode host` remains for raw protocol consumers and CI.

`--gate-timeout` pairs with `lineup resume` for unattended runs. A blocked pipeline can be resumed later without losing state.

## New commands

| Command | Purpose |
|---------|---------|
| `lineup show --watch` | Poll pipeline state every 2s with a live progress table. |
| `lineup replay <run-id>` | Replay a completed run as a chronological narrative with timestamps. |
| `lineup waves [--run <id>]` | Visualize task execution waves and parallelism from a compiled plan. |
| `lineup history [--status <s>]` | List past pipeline runs with status, duration, and retry counts. |
| `lineup bridge start|events|answer` | Thin skill-facing bridge API for detached pipeline runs. |

## New pipeline features

### Verification hooks

Before the reviewer agent runs, the pipeline auto-detects test/typecheck/lint commands from `package.json` scripts and Makefile targets. Each command runs with a 120-second timeout. Results (exit code, stdout, stderr, duration) feed into the reviewer as structured context.

No configuration needed. If `package.json` defines `test`, `typecheck`, or `lint` scripts, they run automatically.

### Agent output validation

After each `agent/done` message, agent outputs are validated against schemas in `cli/schemas/yaml/agent-output/`. On validation failure, a `stage/warning` is emitted. If the stage has retry settings, the agent is retried automatically.

### Retry UX

When verification fails, a `verify-decision` gate presents three options:

1. **Retry** — re-runs only the failed tasks within the same run (no new run ID)
2. **Accept with warnings** — marks the stage complete and continues
3. **Abort** — marks the pipeline as failed

### Persistent retry state

`lineup resume --retry-failed` now tracks retry attempts per stage with configurable limits via `--max-retries`. Retry count, last error, and timestamps persist in `pipeline-state.json`. After exhausting retries, the command rejects with a clear message instead of retrying indefinitely.

### Run timing

Pipeline state records `started_at`, `finished_at`, and `duration_ms`. These are visible in `lineup history` and `lineup show`.

### Desktop notifications

Native desktop notifications fire on pipeline completion or failure. macOS uses `osascript`; Linux uses `notify-send`. Auto-disabled in CI environments. Best-effort — notification failures never block the pipeline.

### Execution isolation

`--implement-method` controls developer agent session batching. `phase` (default) groups by wave. `task` isolates each task into its own session with no prior context. `single-session` runs all tasks in one session with cumulative context from prior tasks.

### Task compiler improvements

The plan-to-task compiler now detects cross-cutting changes (a type change touching 10 files becomes one task, not 10) and adds read-write dependency edges (if task A writes a file that task B reads, B waits for A).

## What you don't need to change

- **Agent overrides** in `~/.claude/lineup/agents/` continue to work. Override precedence is unchanged.
- **Ollama configuration** in `~/.claude/lineup/ollama.yaml` is unchanged.
- **Project tactics** in `.lineup/tactics/` are auto-converted at runtime.
- **Agent memory** (project-scoped) is preserved across the upgrade.
- **Stage cache** in `.lineup/.cache/` remains valid for `--from-stage` restarts.

## Troubleshooting

**Skills don't reflect V3 changes after upgrade**

Run `lineup update --host all` to force-regenerate skill files for all hosts. If skills were manually modified, the update overwrites them — back up any custom changes first.

**Bridge events are garbled**

Bridge sessions should be polled with `lineup bridge events`, not by tailing raw
NDJSON logs. Use `--wait` for long polling and `lineup bridge answer` for user
responses. Keep `lineup run --mode host` for advanced integrations and CI that need
the raw protocol.

**Verification hooks run unwanted commands**

The detector looks for specific script names in `package.json` (`test`, `typecheck`, `type-check`, `lint`) and Makefile targets (`test`, `check`, `lint`). Rename scripts to avoid auto-detection, or disable hooks by setting `verificationHooks: false` in the workflow stage config.

---

[Getting Started](/getting-started/) · [How It Works](/how-it-works/) · [Examples](/examples/)
