---
title: Examples
description: Common ways to use Lineup without learning the internals first.
---

## Feature work

```bash
lineup run "Implement webhook retry logic with exponential backoff per #142"
```

Good fit when a task spans several files and you want planning, implementation, and verification in one flow.

## Bug fix

```bash
lineup run "Fix intermittent 500 errors on POST /checkout — NullReferenceError at OrderService.validate (order.ts:87)"
```

Useful when you have a concrete symptom but still want Lineup to inspect related code before patching.

## Security review

```bash
lineup run "Audit token handling in src/auth.ts"
```

This works well for targeted reviews where you want findings, follow-up changes, and verification guidance in one run.

## Code explanation

```bash
lineup run "Explain src/pipeline/coordinator.ts for onboarding a new team member" --tactic explain
```

Use this when the outcome should be an explanation artifact instead of a code change.

## Tests and refactors

```bash
lineup run "Expand test coverage for src/pipeline/scheduler.ts"
lineup run "Extract validation logic from processOrder() into a separate validator"
```

Lineup is especially helpful when work needs to be split into several safe steps rather than edited in one shot.

## Inspect the result

After a run, these are the commands most people need:

```bash
lineup show <run-id>
lineup waves --run <run-id>
lineup resume <run-id> --retry-failed
```

`lineup show` gives the quick summary, `lineup waves` shows how implementation work was grouped, and `lineup resume` continues from the point that failed or blocked.

## Use the same flow from your host

Prefer Claude Code, Codex CLI, or OpenCode? Start with the installed host command instead of the CLI:

- Claude Code: `/lineup:kick-off`
- Codex CLI: `$lineup-kick-off`
- OpenCode: `/lineup-kick-off`

The run and inspection flow stays the same after kickoff.

## Want advanced usage?

The repository docs cover the deeper pieces that are intentionally out of scope for the public site:

- [Commands](https://github.com/izantech/lineup/blob/main/docs/commands.md)
- [Tactics](https://github.com/izantech/lineup/blob/main/docs/tactics.md)
- [Pipeline internals](https://github.com/izantech/lineup/blob/main/docs/pipeline.md)

---

[How It Works](/how-it-works/) · [Getting Started](/getting-started/)
