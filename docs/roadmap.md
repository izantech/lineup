# Roadmap

This document is the handoff point for the next implementation session.

Current baseline:

- Native v3 engine is the shipped runtime
- Generated skills now use the detached bridge API instead of supervising raw `lineup run --mode host`
- `lineup run --mode host` remains public for CI and advanced integrations
- `./dev install local` and `./dev web` now self-bootstrap missing dependencies after a clean
- Full verification last completed successfully with `./dev check`
- Bridge event payloads now include reconnect-safe `session`, `pendingQuestion`, and `recovery` fields
- Bridge `status` events now include host-facing `stageLabel` and `kind`
- Bridge text output now includes `continue_with` for exact next-poll guidance
- Installed skills now inject the real executor host instead of a literal placeholder
- Built-in CLI tactics such as `explain` now resolve outside the Lineup repo and can be listed with `lineup tactic list --include-builtins`
- Explain/teacher stages now preserve valid structured output and coerce plain-prose host output into a minimal valid explanation artifact when needed

Use these docs as the current source of truth:

- [Commands](./commands.md)
- [Architecture](./architecture.md)
- [Skills](./skills.md)
- [Gate Protocol](./gate-protocol.md)
- [Agents](./agents.md)

## Priority Order

1. Host UX polish
2. First-run onboarding
3. Resume and recovery UX
4. Battle-testing on real repos
5. Run/artifact inspection polish
6. Public site simplification
7. Release hardening

## 1. Host UX Polish

Goal: make bridge-backed host sessions feel lightweight, visible, and reliable.

Completed:

- enriched bridge `status` events with `stageLabel` and `kind` so hosts can render progress without parsing raw text
- improved `complete` event summaries for `succeeded`, `blocked`, `failed`, and `canceled`
- made completion guidance artifact-aware so explain/plan/review flows point at the most useful inspection command
- added `stageId`, `createdAt`, and timeout-aware `expiresAt` to bridge `question` events
- added reconnect-safe `session`, `pendingQuestion`, and `recovery` fields to `lineup bridge events --json`
- added `continue_with` to human-readable `lineup bridge events` output
- made timed-out bridge answers return explicit recovery guidance instead of accepted-but-inert responses
- updated generated kickoff/explain skills and docs to use exact bridge statuses `succeeded`, `blocked`, `failed`, and `canceled`
- fixed installed-skill executor host templating for Claude, Codex, and OpenCode
- fixed built-in `explain` tactic resolution outside the Lineup repo
- added targeted bridge, host, tactic, and pipeline tests covering reconnect, timeout recovery, built-in tactics, and explain execution

Tasks:

- enrich bridge `status` events with higher-signal summaries
- improve `complete` event summaries for success, blocked, failed, and canceled runs
- make `question` events easier for hosts to render without extra interpretation
- improve reconnect behavior for interrupted host sessions
- verify kickoff/explain flows on Claude, Codex, and OpenCode with installed skills

Acceptance:

- host users can understand run progress without reading raw artifacts
- reconnecting to an active bridge run is reliable and replay-safe
- installed skills no longer feel like opaque blocking wrappers

Status:

- mostly complete
- remaining practical follow-up is deeper real-host verification of live gate timeout/recovery paths, especially on Codex once quota allows it

## 2. First-Run Onboarding

Goal: reduce friction for new repos and new users.

Completed:

- added `lineup start "<task>"` as an opinionated first-run native entrypoint
- made `lineup start` scaffold Lineup project files automatically, then stop with exact commit guidance if the repo is not yet ready for git-based isolation
- refactored init/doctor readiness checks into shared helpers so onboarding and diagnostics stay aligned
- improved `lineup doctor` to emit exact `next_commands` in JSON and a readable `next:` block in text output
- documented `lineup start` as the preferred first-run CLI path while keeping host skills on bridge-backed flows

Tasks:

- add an opinionated first-run entrypoint such as `lineup start "<task>"`
- collapse init + readiness + first-run guidance into one clearer flow
- improve `lineup doctor` to recommend the exact next command
- improve errors around missing initial commit, missing workflow, and missing host tooling

Acceptance:

- a new user can go from empty repo to first successful run with minimal manual reasoning
- diagnostics explain the next action precisely

Status:

- complete for the planned onboarding scope
- follow-up host-tooling guidance in `lineup doctor` is now in place when no supported local executor is installed

## 3. Resume And Recovery UX

Goal: make failure recovery obvious and low-friction.

Completed:

- made `lineup resume` more explicit for blocked, failed, and canceled runs with direct `show`, `cancel`, and `--retry-failed` guidance
- preserved gate-timeout context in native blocked-run messaging so timeout recovery is distinguishable from other blocked states
- improved human-mode `lineup run` blocked summaries to point directly at `lineup resume <run-id>` and `lineup show <run-id>`
- improved stale runtime lock conflicts so they identify the active run and suggest `lineup show <active-run>` / `lineup cancel <active-run>` before manual lock removal
- improved stale pipeline-state mismatch errors so they point at `lineup show <run-id>` and tell the user to restore the matching tree or start fresh
- improved failed native run summaries to point directly at `lineup show`, `lineup logs`, and `lineup resume <run-id> --retry-failed`

Tasks:

- improve blocked-run messaging and recovery suggestions
- make `lineup resume` more guided for common failure states
- surface stale lock and gate timeout recovery more clearly
- improve cancellation and post-failure summaries

Acceptance:

- users can tell whether to resume, retry, cancel, or inspect logs without reading internals

Status:

- mostly complete
- remaining practical follow-up is deeper live gate-timeout battle testing on real hosts, but the native CLI recovery surfaces are now explicit

## 4. Battle-Testing On Real Repos

Goal: validate bridge and native execution outside synthetic fixtures.

Completed:

- battle-tested installed `lineup:explain` on Claude against `/Users/izan/Dev/Projects/revenuecat-cli`
- battle-tested installed `/lineup-explain` on OpenCode against `/Users/izan/Dev/Projects/website-manager`
- battle-tested installed `$lineup-explain` on Codex against `/Users/izan/Dev/Projects/lineup`
- battle-tested detached bridge timeout/recovery on `/Users/izan/Dev/Projects/lineup` with a real gate timeout, late-answer rejection, and `lineup resume --json`
- confirmed missing-workflow failure guidance on `/Users/izan/Dev/Projects/website-manager` is explicit and actionable
- battle-tested installed `/lineup-kick-off` on OpenCode against `/Users/izan/Dev/Projects/transportapp-ios`
- converted battle-test regressions into code and tests:
  - Codex schema incompatibility no longer breaks bridge-backed skills
  - built-in `explain` tactic resolution now works outside the Lineup repo
  - installed skill templates no longer emit a literal executor-host placeholder
  - explain/teacher prose output now normalizes into a valid artifact instead of surfacing a validation warning
  - resumed blocked runs now preserve `gate_timeout_seconds` from pipeline state
  - `lineup resume --json` no longer leaks raw host-mode NDJSON before its final JSON payload
- confirmed bridge payload and recovery behavior during real detached runs on installed hosts

Tasks:

- run full bridge-backed workflows against multiple disposable repos
- run host-skill smoke tests against real installed Claude/Codex/OpenCode integrations
- test research-heavy, plan-heavy, and implement-heavy tasks separately
- capture regressions as tests where practical

Suggested scenarios:

- analysis-only repo task
- docs-heavy task
- multi-file implementation task
- failure + resume path
- plan approval path

Acceptance:

- repeated real-repo runs succeed without host supervision drift
- regressions found during battle tests are either fixed or converted into tests/issues

Status:

- mostly complete
- installed explain coverage is now in place on Claude, Codex, and OpenCode
- real timeout/recovery behavior is confirmed on the Lineup repo
- remaining practical follow-up is a real Codex multi-file implementation regression found during host smoke:
  - installed `$lineup-kick-off` on a disposable repo launched the bridge correctly, completed triage, then stalled in research with no new bridge events after seq 6 (`run_id: a1db54`)
  - the blocked disposable run was canceled cleanly with `lineup cancel a1db54 --json`

## 5. Run And Artifact Inspection Polish

Goal: make finished runs easier to inspect and debug.

Tasks:

- improve `lineup show` readability
- improve artifact diff ergonomics
- improve wave/task summaries
- add clearer “what changed in this run?” reporting

Acceptance:

- a user can inspect a run quickly without reading raw JSON/YAML unless they want to

Status:

- complete

## 6. Public Site Simplification

Goal: keep the website user-facing and keep deep operational detail in `docs/`.

Tasks:

- continue trimming protocol/integration detail from the site
- keep the website focused on install, terminal use, and host-skill use
- move any contributor-facing detail into `docs/`

Acceptance:

- the site stays lean
- `docs/` stays comprehensive for contributors and agents

Status:

- complete

## 7. Release Hardening

Goal: prepare for a stable public release after the bridge transition.

Tasks:

- do one more clean install-from-source pass
- verify host installs after local rebuild on all supported hosts
- review package/release metadata
- ensure migration notes reflect the bridge-first skill model

Acceptance:

- fresh local install, host install, and website build all succeed from a cleaned workspace

Status:

- mostly complete
- clean local install-from-source now succeeds on machines that only have a subset of supported host CLIs installed
- package/plugin metadata and migration-facing docs are aligned with the bridge-first runtime
- fresh local rebuild, dist smoke, and website build are green
- remaining environment-limited follow-up is end-to-end Claude host verification on a machine with the `claude` CLI installed

## Recommended Next Session

Start here:

1. Investigate the live Codex research-stage stall on bridge-backed multi-file implementation runs
2. Re-run full Claude host verification on a machine with the `claude` CLI installed
3. Optional broader real-host coverage after the Codex stall is fixed

Concrete first step:

- inspect run `a1db54`-style Codex bridge stalls in research and convert the failure mode into a reproducible test if possible

## Verification Checklist

Run after meaningful changes:

```bash
./dev check
./dev install local
./dev web build
```

For host integration work, also verify:

```bash
lineup doctor --json
lineup run "sanity task"
```

And where applicable:

- invoke installed Claude/Codex/OpenCode skills against a disposable repo
- confirm bridge start, bridge events, bridge answer, and final inspection all work end to end
