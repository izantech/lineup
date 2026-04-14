---
title: How It Works
description: The simple mental model for using Lineup day to day.
---

## One engine, two entrypoints

You can start Lineup in two normal ways:

- **CLI** with `lineup start` or `lineup run`
- **Host commands** from Claude Code, Codex CLI, or OpenCode

Both paths use the same underlying engine. The host commands are just thin entrypoints into the CLI runtime.

## The basic flow

Lineup moves work through a consistent sequence:

**Triage → Clarify → Research → Plan → Implement → Verify**

Not every task needs every step. Small, obvious changes stay lighter. Larger or less certain work gets more research and planning.

## What Lineup decides for you

Lineup handles the operational parts that are easy to get wrong by hand:

- it scopes the work before implementation starts
- it keeps plan and implementation stages inspectable
- it organizes independent changes into execution waves
- it preserves state so blocked or failed runs can resume later

The goal is simple: spend less time orchestrating and more time reviewing useful output.

## What you do during a run

Most runs look like this:

1. Start with `lineup start` or `lineup run`.
2. Approve or answer questions when the pipeline asks.
3. Inspect the result with `lineup show <run-id>`.
4. Resume with `lineup resume <run-id>` if the run blocks or fails.

For implementation-heavy work, `lineup waves --run <run-id>` shows how the plan was split into parallel task waves.

## Host usage stays simple

From the user side, host usage should feel just as direct as CLI usage:

- start the task from the installed host command
- answer questions when they appear
- inspect the final run if you want more detail

You do not need to think about bridge sessions or protocol events to use Lineup successfully.

## Tactics are optional

The default workflow is enough for most work. Use a tactic only when you want a more specific path, such as an explanation flow or a security-focused review.

## Need the deeper internals?

The public site intentionally stays lightweight. Contributor and integration detail lives in the repository docs:

- [Architecture](https://github.com/izantech/lineup/blob/main/docs/architecture.md)
- [Pipeline](https://github.com/izantech/lineup/blob/main/docs/pipeline.md)
- [Gate protocol](https://github.com/izantech/lineup/blob/main/docs/gate-protocol.md)
- [Skills and host integrations](https://github.com/izantech/lineup/blob/main/docs/skills.md)

---

[Examples](/examples/) · [Getting Started](/getting-started/)
