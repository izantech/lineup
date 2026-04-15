# Status

This document captures the current validation status of the Lineup CLI as the
host orchestrator, plus the remaining test plan needed to close the live
confidence gaps.

As of April 15, 2026, the direct-host recertification work now has a dedicated
validator command and report format:

- `npm --prefix cli run validate:direct-hosts -- --host claude|codex|opencode|all`

That harness now covers four explicit lanes on the current built runtime:

- `bridge` — bounded non-Ollama implementation plus bundled `explain`
- `recovery` — timeout, late-answer rejection, cancel, lock-conflict, and
  `retry-failed`
- `human` — PTY-driven `lineup run --mode human` parity for the same bounded
  implementation and `explain` task
- `real-repo` — disposable detached git worktree sweeps against the actual
  Lineup repository with deterministic seeded tasks

The report is intended to drive support/status updates directly by recording
per-host lane status, exact run ids, host versions, preserved temp/worktree
paths, trace/log/artifact paths, diff summaries, and blocker classification.

## Scope

This status is about `lineup` as the orchestrator:

- task intake
- triage, research, plan, implement, verify, and explain flows
- bridge question/answer behavior
- detached worktree execution
- host integration for Claude Code, Codex CLI, and OpenCode

It is not a claim that every local model or every host CLI version behaves
equally well. Model quality and host-specific runtime quality still vary.

## Current Status

### Recent updates

On April 15, 2026, the current branch/build picked up four direct-host
validation improvements:

- expanded `npm --prefix cli run validate:direct-hosts` into the current
  four-lane direct-host validator for bounded bridge, recovery, human-mode
  parity, and real-repo worktree validation
- fixed Codex direct-host structured-output schema normalization so strict
  nested object schemas keep required fields only, which unblocked the current
  bounded Codex bridge certification rerun
- fixed `lineup cancel` so blocked bridge sessions now transition to a terminal
  `canceled` bridge state instead of leaving `lineup bridge events` stuck on an
  old pending question
- wired local direct-host stage timeouts through `runPipeline` so focused
  validation scenarios can force a bounded terminal failure instead of hanging
  indefinitely in the host process
- hardened OpenCode direct-host plan normalization so bounded bridge
  certification now survives humanized change keys, string-form
  recommendations, and colon-bearing plain scalars on the current build
- tightened the OpenCode stage prompt contract so bounded Lineup stages do not
  delegate via `task` or `skill` during direct-host validation runs
- added a Python-backed PTY fallback in the human-mode validator so the harness
  can still create a pseudo-terminal on this machine when `node-pty` cannot
  spawn one directly

### Proven green

The following is live-validated and currently green on `izan/runtime-engine`:

- Ollama-backed Claude, Codex, and OpenCode host execution on
  `qwen3-coder:30b`
- full bounded pipeline smoke runs through the bridge contract
- bundled `explain` tactic runs through the bridge contract
- combined `--host all` smoke matrix on the same built runtime
- repo-wide deterministic CLI verification:
  - `npm --prefix cli test`
  - `npm --prefix cli run typecheck`
  - `npm --prefix cli run build`
- bounded direct-host Codex bridge certification on the current built runtime:
  - implementation lane succeeded through `lineup bridge start|events|answer`
  - bundled `explain` lane succeeded through the same bridge contract
  - `lineup show` and `lineup logs` succeeded on the completed direct-host run
  - the bounded workspace diff was limited to `README.md` as intended
- bounded direct-host OpenCode bridge certification on the current built
  runtime:
  - implementation lane succeeded through `lineup bridge start|events|answer`
  - bundled `explain` lane succeeded through the same bridge contract
  - `lineup show` and `lineup logs` succeeded on the completed direct-host run
  - the bounded workspace diff was limited to `README.md` as intended

### Host-specific proven behavior

Claude:

- Ollama-backed execution is green on the current baseline model
- structured runs are stabilized via draft-first formatting and local schema
  validation
- reviewer execution is constrained to the isolated worktree and launched
  without tool access in the stabilized Ollama path

Codex:

- Ollama-backed execution is green on the current baseline model
- the earlier artifact-written-but-process-still-alive handoff bug is fixed and
  covered by regression tests
- live Ollama execution now uses the supported local OSS path
- direct-host bounded bridge certification is green again on the current build
  after tightening Codex structured-output schema normalization for required
  object fields only

OpenCode:

- Ollama-backed execution is green on the current baseline model
- the corrected wrapper/model-selection path is now stable for bounded pipeline
  smoke and bundled `explain`
- direct-host bounded bridge certification is green on the current build after
  tightening plan normalization and bounded-stage prompt constraints for
  OpenCode

### What this does mean

- The Lineup orchestration layer is in good operational shape.
- The bridge contract is working in real runs.
- The bounded end-to-end path is proven across all supported hosts in the
  validated Ollama-backed setup.

### What this does not mean

- It does not prove that every Ollama model works.
- It does not prove that every host CLI version/configuration combination works.
- It does not yet prove a freshly re-run full non-Ollama live matrix for every
  host/provider path after the latest stabilization work.
- It does not yet mean the automated direct-host recovery sweep is fully green
  on all three direct hosts on the same build.
- It does not yet prove human-mode parity for current direct Claude, Codex, and
  OpenCode runs on the same build.

## Confidence Gaps

These are the remaining items that should be treated as not fully re-certified:

- a fresh direct non-Ollama Claude rerun on the current build after local
  Claude auth is restored on this machine (`/login` is still required locally)
- direct non-Ollama Codex retry/recovery completion after the latest
  stabilization work
- direct non-Ollama human-mode parity completion after the latest PTY-harness
  fallback change
- failure/recovery parity across all three direct host paths in one current
  sweep
- human-mode parity across all three direct host paths
- broader real-repo battle testing after the final Ollama stabilization changes

## Proposed Test Plan

### 1. Native host certification matrix

Goal: prove the orchestrator directly against each host CLI, not just the
Ollama-backed matrix.

Run for each host:

- direct Claude Code
- direct Codex CLI
- direct OpenCode

For each host, run:

- one bounded full-pipeline task
- one bundled `explain` task
- one bridge-driven run that exercises `bridge start`, `bridge events`, and
  `bridge answer`

Acceptance:

- run reaches terminal `succeeded`
- structured artifacts are valid
- expected workspace diff is produced
- `explain` returns a valid artifact
- no silent stall after artifact creation

Current progress:

- automated by `npm --prefix cli run validate:direct-hosts -- --lane bridge`
- Codex bounded bridge certification is green on the current build
- OpenCode bounded bridge certification is green on the current build
- the remaining full all-host bridge blocker is local Claude auth, not the
  bounded Codex/OpenCode direct-host path

### 2. Human-mode parity sweep

Goal: confirm the same host paths behave correctly in local interactive mode,
not only via bridge-backed smoke.

Run for each direct host:

- `lineup run --mode human` on a bounded implementation task
- `lineup run --mode human --tactic explain`

Acceptance:

- interactive flow completes without host supervision drift
- final artifacts match the bridge-run shape closely enough for the same task

Current progress:

- automated by `npm --prefix cli run validate:direct-hosts -- --lane human`
- the PTY harness now includes a Python fallback because `node-pty` pseudo-TTY
  spawn failed in this desktop environment
- a full fresh all-host rerun is still outstanding on the current build

### 3. Failure and recovery matrix

Goal: prove operational recovery, not just happy-path success.

Run across the direct host matrix:

- gate timeout
- late bridge answer rejection
- failed implement stage
- failed review stage
- stale runtime lock conflict
- `lineup resume --retry-failed`
- `lineup cancel`

Acceptance:

- user-facing recovery guidance is explicit
- recovery commands work without manual cleanup
- resume/cancel state transitions stay consistent across hosts

Current progress:

- automated by `npm --prefix cli run validate:direct-hosts -- --lane recovery`
- gate-timeout, late-answer rejection, cancel, lock-conflict, and
  `retry-failed` now have dedicated validator scenarios
- `lineup cancel` now synchronizes blocked bridge sessions into a terminal
  `canceled` bridge state instead of leaving `bridge events` stuck on the old
  pending question
- live all-host current-build reruns are still required before this lane can be
  treated as re-certified

### 4. Real-repo battle tests

Goal: move beyond tiny synthetic smoke tasks.

Run each direct host on at least these repo scenarios:

- analysis-only task
- docs-only task
- multi-file implementation task
- plan-approval task
- failure-and-resume task

Acceptance:

- repeated runs succeed without host drift
- host-specific regressions are either fixed immediately or converted into tests

Current progress:

- automated by `npm --prefix cli run validate:direct-hosts -- --lane real-repo`
- runs execute in detached temporary git worktrees seeded with deterministic
  markers so the main checkout is never mutated
- a fresh all-host current-build sweep is still outstanding

### 5. Cross-host artifact parity review

Goal: make sure “green” does not hide materially different behavior.

For the same bounded task, compare across direct Claude, Codex, and OpenCode:

- research artifact shape
- plan artifact quality
- implementation state shape
- review artifact outcome
- final bridge summaries

Acceptance:

- no host produces structurally invalid artifacts
- host differences stay within expected quality variance rather than contract
  breakage

Current progress:

- the validator now emits artifact-parity status in its JSON report
- the support statement should stay conservative until a fresh all-host current
  build report shows no contract breakage

### 6. Periodic recertification lane

Goal: keep the support statement current.

Recommended cadence:

- rerun the native host certification matrix when host CLI versions change
- rerun after major pipeline/runtime changes
- rerun when switching the preferred local acceptance model baseline

## Recommended Support Statement

Until the remaining direct-host matrix is re-run, the safest public statement is:

> Lineup is live-validated end to end for Claude, Codex, and OpenCode in the
> current Ollama-backed acceptance setup on `qwen3-coder:30b`. The orchestration
> layer is in good shape, and the direct-host validator now covers bounded
> bridge, recovery, human-mode, and disposable real-repo lanes on the current
> build. Codex and OpenCode direct-host bounded bridge certification are green
> again, but a fresh full direct-host certification matrix still remains
> outstanding for non-Ollama Claude until local auth is restored, plus the final
> current all-host recovery, human-mode, and broader real-repo parity sweeps.

## Exit Criteria

This document can be simplified once all of the following are true:

- direct Claude full matrix is green
- direct Codex full matrix is green
- direct OpenCode full matrix is green
- failure/recovery paths are re-validated on current builds
- at least one fresh real-repo battle-test sweep is complete
