---
title: How It Works
description: How Lineup runs work from first entrypoint through planning, execution, and resume.
---

## One engine, three entrypoints

Lineup has three practical entrypoints:

- `lineup start` for first-run and onboarding flows
- `lineup run` for direct terminal execution
- `lineup bridge start|events|answer` for installed host wrappers

All three lead to the same runtime engine. The CLI is the source of truth, and host integrations are wrappers around it rather than separate orchestrators.

![Entry points and engine flow](/diagrams/how-it-works-entrypoints.svg)

## What each entrypoint is for

### `lineup start`

This is the safest first entrypoint in a repo. It prepares the project, checks whether native execution can run yet, and only starts the pipeline once the repo is ready.

That means it can:

- initialize Lineup project files
- tell you if the repo still needs its first commit
- stop with exact next commands instead of failing mid-run

### `lineup run`

This is the normal direct executor. It chooses the runtime mode automatically:

- `human` on an interactive terminal
- `host` when running non-interactively

In both modes, it hands off to the same orchestration engine.

### `lineup bridge`

This is the preferred wrapper contract for Claude Code, Codex CLI, and OpenCode integrations. Instead of making each host supervise raw protocol output directly, the CLI owns a detached worker and exposes a compact event stream.

## The pipeline shape

The default full pipeline is:

**Triage → Clarify → Research → Clarification Gate → Plan → Implement → Verify → Document?**

Not every task runs every step. Triage can reduce the run for simpler work.

![Pipeline stages from workflow load to optional document stage](/diagrams/how-it-works-pipeline.svg)

## What Lineup decides for you

Lineup handles the parts that are easy to get wrong by hand:

- it scopes the work before implementation starts
- it keeps plan and implementation stages inspectable
- it organizes independent changes into execution waves
- it preserves state so blocked or failed runs can resume later

The goal is simple: spend less time orchestrating and more time reviewing useful output.

## Where planning turns into execution

The early stages produce structured artifacts. The key handoff is from `plan` into `implement`.

Once the plan is approved, Lineup compiles it into executable tasks and task waves. That is what makes `lineup waves` possible and what allows retries to focus only on failed tasks instead of restarting everything.

![Implementation flow from approved plan through retries or completion](/diagrams/how-it-works-implementation.svg)

## What you do during a run

Most runs look like this:

1. Start with `lineup start` or `lineup run`.
2. Approve or answer questions when the pipeline asks.
3. Inspect the result with `lineup show <run-id>`.
4. Resume with `lineup resume <run-id>` if the run blocks or fails.

For implementation-heavy work, `lineup waves --run <run-id>` shows how the plan was split into parallel task waves.

## Human mode vs host mode

The engine is the same in both modes. The difference is how progress and questions are surfaced.

![Human mode compared with host mode](/diagrams/how-it-works-human-vs-host.svg)

Use `host` mode when you need raw protocol integration, such as CI or a custom wrapper.

## Why bridge mode exists

Bridge mode sits on top of the same engine, but it gives installed host wrappers a safer contract:

- `lineup bridge start` launches a detached worker
- `lineup bridge events` returns compact `status`, `question`, and `complete` events
- `lineup bridge answer` responds to a pending question

![Bridge mode flow from start to polling and answers](/diagrams/how-it-works-bridge.svg)

This is what makes reconnect-safe polling possible. A host can drop and reconnect without losing the run state.

## Why runs are resumable

Lineup persists state and artifacts under `.lineup`, including:

- pipeline state
- plan, tasks, review, and protocol artifacts
- pending gate requests and responses
- bridge session and bridge event files for detached runs

That persistence is what powers:

- `lineup show`
- `lineup logs`
- `lineup replay`
- `lineup resume`
- `lineup bridge events`

## Tactics are optional

The default workflow is enough for most work. Use a tactic only when you want a more specific path, such as an explanation flow or a security-focused review.

## The design choice behind all this

Lineup keeps orchestration inside the CLI instead of distributing orchestration logic across hosts.

That gives the project:

- one runtime contract
- one bridge contract
- one place for output normalization and retries
- one run model for inspection and resume

---

[Examples](/examples/) · [Getting Started](/getting-started/)
