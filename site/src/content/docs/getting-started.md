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
```

`lineup install` detects available hosts and installs skill files for each one.

## First pipeline run

Run a task through the full pipeline:

```bash
lineup kick-off "Review the auth middleware in src/auth.ts and identify security gaps"
```

Expected output:

```
Triage: analyzing task complexity...
  Task: medium complexity
  Route: 3-stage pipeline (research → analysis → report)

Starting pipeline...
[Stage 1/3] Research: Gathering context on authentication patterns
[Stage 2/3] Analysis: Checking for security vulnerabilities
[Stage 3/3] Report: Generating findings and recommendations

Pipeline complete. Results in ./lineup-output/
```

## What happened

1. **Triage** classified the task as medium complexity and selected a 3-stage pipeline.
2. Each stage was assigned to an agent with the appropriate model — lightweight models for context gathering, more capable models for analysis.
3. Stage outputs were cached. If the run had been interrupted, re-running the same command would resume from the last completed stage.

The triage step drives model selection automatically. Simple tasks (rename a variable) use fast models. Complex tasks (redesign a subsystem) escalate to more capable ones. This is determined by the task scope, not by user configuration.

## Next steps

- [Examples](/examples/) — see Lineup applied to real-world scenarios
- [How It Works](/how-it-works/) — pipeline architecture, tactics, teams mode
