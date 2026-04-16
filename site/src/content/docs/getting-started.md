---
title: Getting Started
description: Install Lineup and run your first task from the CLI or your host.
---

## Prerequisites

Install and configure at least one supported host:

- **Claude Code**
- **Codex CLI**
- **OpenCode**

## Install

```bash
npm install -g @izantech/lineup-cli
lineup install
```

`lineup install` detects the hosts available on your machine and installs the matching Lineup commands for them.

## First run from the CLI

Use `lineup start` for your first task in a repo:

```bash
lineup start "Review the auth middleware in src/auth.ts and identify security gaps"
```

`lineup start` is the opinionated onboarding path. It will:

1. Scaffold Lineup files if the repo has not been initialized yet.
2. Check git readiness.
3. Stop with the exact next command if the repo still needs its first commit.
4. Start the pipeline once the project is ready.

After the first run, you can use `lineup run "<task>"` directly whenever you want.

When you run in a terminal, human mode now shows a structured live view instead
of raw stage logs. On a real TTY that becomes a dynamic dashboard with live
timers and stage status; on non-TTY output it stays plain append-only text.
Active progress stays on `stderr`, while JSON and host-mode output remain on
`stdout`.

## Start from Claude, Codex, or OpenCode

If you prefer to stay inside your host UI, use the installed host command instead:

- Claude Code: `/lineup:kick-off`
- Codex CLI: `$lineup-kick-off`
- OpenCode: `/lineup-kick-off`

Those commands call the same Lineup engine. The only difference is where you start the task.

## Inspect and resume runs

Lineup keeps run state and artifacts so you can inspect work or continue later:

```bash
lineup runs
lineup show <run-id>
lineup resume <run-id> --retry-failed
lineup waves --run <run-id>
```

Use `lineup show` for a quick run summary, `lineup waves` to inspect task parallelism, and `lineup resume` when a run fails or blocks.

If you want to keep an active run on screen, use:

```bash
lineup show <run-id> --watch
```

That view shows the run header, stage-by-stage status, any pending question,
artifact and change summaries, and the exact next commands to use. On a TTY it
refreshes live; when piped it stays plain append-only text.

## When you want more detail

If you want the runtime-level view after setup, continue with:

- [How It Works](/how-it-works/) for the pipeline, bridge flow, and resume model
- [Examples](/examples/) for common task patterns and prompts

## Next steps

- [How It Works](/how-it-works/) for the high-level mental model
- [Examples](/examples/) for common task patterns
- [Migrating from V2](/migration/) if you already use an older Lineup install
