---
title: Migrating from V2
description: What changed in Lineup V3, how to upgrade, and what to watch for.
---

## Overview

V3 rewrites the skill layer from ~100 KB of orchestrator prompt down to ~12 KB of thin CLI wrappers. Pipeline orchestration — agent spawning, DAG scheduling, state management, artifacts — now lives entirely in the CLI. Skills handle only the gate protocol (presenting gates to the user and relaying responses).

This is a breaking change for the skill format. Agent overrides, tactics, project memory, and cached stage results are preserved.

## Upgrade

```bash
npm install -g @izantech/lineup-cli@latest
lineup update
```

`lineup update` regenerates host skill files from the new lean templates. Existing runs in `.lineup/runs/` are not modified.

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
| Agent spawning | Skill spawns agents directly | CLI emits `agent/spawn` protocol messages |
| Gate handling | Skill manages gates inline | Skill reads `gate/request` from stdout, calls `lineup gate respond` |
| Tactic execution | Skill interprets tactic YAML | CLI converts tactics to workflows via `tacticToWorkflow()` |

Skills no longer contain pipeline logic. They launch `lineup run --json`, read NDJSON protocol messages from stdout, and handle gates by asking the user and calling `lineup gate respond <run-id> <request-id> --choice <value>`.

### Gate protocol

Gates are now typed. Each `gate/request` message includes a `gateType` field:

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

The triage and research stages are no longer stubs. Triage now runs `git diff --stat HEAD` and counts project files to produce a structured assessment. Research stages emit `agent/spawn` protocol messages for researcher agents. Clarify and gate stages continue to use the existing `gate/request` flow.

## New CLI flags

Added to `lineup run`:

| Flag | Purpose |
|------|---------|
| `--interactive` / `-i` | Handle gates via stdin prompts. No host skill needed. |
| `--gate-timeout <seconds>` | Save state as `blocked` on timeout instead of waiting indefinitely. |

`--interactive` makes Lineup usable as a standalone terminal tool. Gate types map to readline prompts: approval is Y/n, clarify is free-text, verify-decision is a numbered menu.

`--gate-timeout` pairs with `lineup resume` for unattended runs. A blocked pipeline can be resumed later without losing state.

## New commands

| Command | Purpose |
|---------|---------|
| `lineup show --watch` | Poll pipeline state every 2s with a live progress table. |
| `lineup replay <run-id>` | Replay a completed run as a chronological narrative with timestamps. |

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

**`lineup run --interactive` prompts are garbled**

Interactive mode requires a TTY. It does not work in piped or non-interactive shells. Use file-based gates (the default) in CI environments.

**Verification hooks run unwanted commands**

The detector looks for specific script names in `package.json` (`test`, `typecheck`, `type-check`, `lint`) and Makefile targets (`test`, `check`, `lint`). Rename scripts to avoid auto-detection, or disable hooks by setting `verificationHooks: false` in the workflow stage config.

---

[Getting Started](/getting-started/) · [How It Works](/how-it-works/) · [Examples](/examples/)
