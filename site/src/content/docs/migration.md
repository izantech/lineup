---
title: Migrating from V2
description: Upgrade to the current Lineup runtime without relearning the whole product.
---

## The short version

V3 moves orchestration into the CLI and keeps host commands thin. For most users, that means Lineup is easier to install, easier to update, and more consistent across Claude Code, Codex CLI, and OpenCode.

## Upgrade

```bash
npm install -g @izantech/lineup-cli@latest
lineup update
```

If you install from source instead of npm:

```bash
./dev install local
```

## What changes for everyday use

- the recommended first-run path is now `lineup start "<task>"`
- host commands stay available, but they call into the shared CLI runtime
- direct terminal runs now use a structured live UI instead of raw stage logs
- run inspection is clearer with `lineup show`, `lineup show --watch`, `lineup waves`, and `lineup history`
- resume and retry flows are more explicit when a run blocks or fails

## What stays familiar

- project tactics still work
- host-specific entry commands still exist
- existing run history is kept on disk
- you can still inspect and resume past runs

## When you need deeper migration detail

If you want the current runtime model after upgrading, read [How It Works](/how-it-works/) and then [Getting Started](/getting-started/) for the new recommended flow.

## Suggested next step

After upgrading, try the new first-run flow in any initialized repo:

```bash
lineup start "Explain the scheduler module for onboarding"
```

---

[Getting Started](/getting-started/) · [How It Works](/how-it-works/)
