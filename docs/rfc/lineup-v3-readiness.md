# Lineup v3 Readiness

This document records the evidence for the Lineup v3 native-default decision. The source of
truth remains [lineup-v3.md](/Users/izan/Dev/Projects/lineup/docs/rfc/lineup-v3.md), with task
tracking in [roadmap.md](/Users/izan/Dev/Projects/lineup/docs/rfc/roadmap.md) and
[V3-16](./tasks/v3-16-dogfood-metrics-and-cutover.yaml).

## Repeatable Checks

Refresh the current evidence with:

```bash
./scripts/lineup-v3-readiness.sh
```

That command runs the full repo check and the dedicated differential regression harness.

## Metrics

| Metric | Definition | Current evidence (2026-04-12) | Status |
| --- | --- | --- | --- |
| Success rate | `./dev check` must pass on the Lineup repo | `./dev check` passed with 25 Vitest files / 141 tests green | pass |
| Determinism | The same approved plan must compile to the same task graph and wave ordering | `cli/test/differential-regression.test.ts` passes against the tracked golden task graph | pass |
| Cleanup correctness | Failed runs must preserve debug state; concurrent runs must be guarded | `cli/test/run-pipeline.test.ts` covers debug bundle capture and lock rejection | pass |
| Runtime observability | Operators must be able to inspect latest runs and environment health | `lineup status --artifacts` and `lineup doctor` landed in wave 4 and are covered by tests | pass |
| Reversibility | Native default must remain reversible while evidence matures | `lineup run --engine tf` remains available as an explicit fallback | pass |

## Dogfood Evidence

### Lineup repo

- Native engine is the default path for `lineup run --engine auto`.
- The Lineup repo passes `./dev check`.
- The operational safety tests cover:
  - runtime lock contention
  - debug bundle capture on failure
  - stale run/worktree cleanup

### Fixture repo corpus

- The tracked differential corpus lives under [cli/fixtures/differential](/Users/izan/Dev/Projects/lineup/cli/fixtures/differential).
- The harness in [cli/test/differential-regression.test.ts](/Users/izan/Dev/Projects/lineup/cli/test/differential-regression.test.ts):
  - runs `native` and `tf` against the same approved plan
  - verifies identical compiled task graphs against the golden artifact
  - verifies deterministic wave ordering
  - captures the current native-vs-fallback behavior gap without changing artifact contracts

## Cutover Decision

Current decision: **keep native as the default for `engine=auto`, keep `--engine tf` available as the reversible fallback.**

Reasoning:

- The native path is now covered by the repo-wide check, runtime safety tests, and a tracked
  differential harness.
- Artifact contracts remain stable across `native` and `tf` modes.
- The fallback path is still available for controlled comparison and rollback.

Additional dogfood on external repositories is still useful, but the current evidence is now
recorded rather than implicit.

## External Dogfood Corpus

Three external fixture shapes are defined for dogfood validation:

| Fixture | Shape | Key Journeys |
|---------|-------|--------------|
| monorepo | Multi-package TS/Python | init, dry-run, cancel, resume |
| library | Single-package TS | init, dry-run, validate, artifacts |
| fullstack | Multi-module with Docker | init, full run, cancel, resume, diff |

Fixture definitions: `cli/fixtures/external-dogfood/`

### Dogfood Execution Checklist

- [ ] Each fixture repo cloned and pinned to a specific commit
- [ ] `lineup init` succeeds in each repo
- [ ] `lineup run --dry-run` produces valid execution plan
- [ ] `lineup run --engine native` completes or fails with clear diagnostics
- [ ] `lineup cancel` and `lineup resume` work correctly
- [ ] No regressions in `lineup doctor` output
