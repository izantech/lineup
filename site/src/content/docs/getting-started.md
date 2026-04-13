---
title: Getting Started
description: Install Lineup and run your first pipeline.
---

## Prerequisites

One of the following AI coding hosts, already installed and configured:

- **Claude Code**
- **Codex CLI**
- **OpenCode**

## Install

```bash
npm install -g @izantech/lineup-cli
lineup install
lineup init
```

`lineup install` detects available hosts and installs skill files for each one.
`lineup init` scaffolds the local `.lineup/` runtime directories and a default workflow.

## First pipeline run with the CLI

Pass a task description and let Lineup handle approval gates interactively:

```bash
lineup run "Review the auth middleware in src/auth.ts and identify security gaps"
```

Expected output:

```
[triage] Collecting project stats...
[plan] Waiting for approval...
[implement] Executing native wave 1...
[verify] Running verification hooks...
Pipeline completed successfully.
```

## What happened

1. **Triage** classified the task, identified affected areas, and selected the right model tier per role.
2. The CLI evaluated the workflow DAG, compiled the approved plan into execution waves, and drove the run through typed stages.
3. Stage outputs and protocol events were persisted under `.lineup/.runs/` and `.lineup/.artifacts/`, so the run can be inspected or resumed later.

The triage step drives model selection automatically. Simple tasks (rename a variable) use fast models. Complex tasks (redesign a subsystem) escalate to more capable ones. This is determined by the task scope, not by user configuration.

## First pipeline run from a host

If you prefer to stay inside your host UI, Lineup also installs thin host commands:

- Claude Code: `/lineup:kick-off`
- Codex CLI: `$lineup-kick-off`
- OpenCode: `/lineup-kick-off`

These wrappers launch the same native CLI pipeline and handle `gate/request` messages for you.

## When a run fails

Resume a failed run instead of starting over:

```bash
lineup resume <run-id> --retry-failed
```

The pipeline restarts from the failed stage, preserving all completed upstream work. Use `--max-retries 5` to cap retry attempts per stage.

To inspect past runs:

```bash
lineup runs                  # recent runs with status
lineup show <run-id>         # stage details and artifact hashes
lineup history               # table of recent runs with status and duration
lineup waves --run <run-id>  # task execution waves and parallelism
```

## Next steps

- [Examples](/examples/) — see Lineup applied to real-world scenarios
- [How It Works](/how-it-works/) — pipeline architecture, tactics, teams mode
