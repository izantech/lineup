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
- the Codex-side research handoff regression found during host smoke is now fixed:
  - prior host smoke showed a disposable run that launched the bridge correctly, completed triage, then stalled in research with no new bridge events after seq 6 (`run_id: a1db54`)
  - the local Codex runner now resolves as soon as the expected artifact exists instead of waiting for the Codex subprocess to exit
  - a deterministic regression test now covers the artifact-written-but-process-still-alive case
- remaining practical follow-up is a fresh real Codex multi-file implementation rerun to confirm the original `a1db54` scenario stays green under live quota

### Ollama Host Stabilization

Latest live Ollama validation on `qwen3.5:9b` is still failing, but the failure
classes are now instrumented and no longer conflated:

- Claude:
  - both the `ollama launch claude` lane and the Anthropic-compatible env
    fallback lane stall inside the strict research invocation
  - the host trace records only a `spawn` event
  - there is no stdout, no stderr, no close event, and no research artifact
- OpenCode:
  - the process starts and logs its one-time SQLite migration
  - after startup it produces no stdout, no artifact, and no process exit
- Codex:
  - the process starts on `provider: ollama`
  - stderr shows active reasoning and tool planning
  - no research artifact is written, so the bridge sees no stage progress even
    though the host is active

Current instrumentation:

- smoke runs now preserve the temp workspace on failure or stall
- smoke summaries print the run roots plus:
  - bridge event/log files
  - host trace JSON
  - host stdout/stderr logs
- runner traces now flush at spawn time instead of only on process settlement,
  so hung hosts still leave a `.trace.json`
- smoke progress classification now also watches host trace/log/artifact file
  growth instead of relying only on bridge events
- Ollama-backed Claude strict passes now run from a neutral temporary cwd while
  still receiving repo access through explicit `--add-dir`
- Ollama-backed Claude structured runs now go draft-first and keep the strict
  formatter as the final schema-preserving pass instead of starting with the
  direct strict host invocation
- Ollama-backed researcher stages can use a compact host-specific prompt body,
  and the local smoke lane now uses a deterministic tiny-repo task instead of a
  generic freeform smoke request
- pre-stage structured artifacts are now stricter:
  - malformed/non-object YAML gets one stricter retry
  - researcher stages without explicit workflow outputs receive default required
    fields (`what_found`, `how_it_works`, `constraints`, `gaps`)
  - outputs are checked for required fields before the stage is accepted
  - retries clear the previous artifact path before re-invoking the host so a
    malformed first artifact cannot satisfy the retry with stale output
- OpenCode research prompts now explicitly mark the stage as read-only and
  require exactly one YAML Research document

Comprehensive fix plan:

1. Shared smoke/progress hardening
   - completed:
     - treat host trace/log/artifact growth as progress in the smoke runner,
       not only bridge events
     - keep the current no-progress timeout for truly silent hosts without
       classifying actively logging hosts as stalled
     - add deterministic coverage for file-activity-based progress tracking
   - remaining:
     - preserve the same classification model in any future direct-repro helper
       commands so host-specific debugging stays consistent
2. Claude stabilization
   - completed:
     - replace strict-schema-first execution with a draft-first plus strict
       formatter flow for Ollama-backed Claude structured runs
   - remaining:
     - build a direct repro for the current draft-mode hang
     - try a narrower draft transport such as JSON-mode draft output before
       changing the final validation contract again
3. OpenCode stabilization
   - completed:
     - tighten the research prompt to require exactly one YAML Research document
     - make the research contract explicitly read-only
     - fix retry-path stale artifact reuse before host reinvocation
   - remaining:
     - reproduce the current `opencode run --pure --format json --model lineup-ollama/<model>`
       command outside the pipeline with the same temp home
     - keep OpenCode on the bounded tiny-repo task instead of broad workspace
       exploration during retry/follow-up behavior
     - determine whether the non-interactive path still needs a different
       output mode once the bounded prompt behavior is stable
4. Codex stabilization
   - keep `codex exec --oss --local-provider ollama` as the live provider path
   - completed:
     - watch both the final artifact path and the Codex `-o` output path
     - tighten the smoke task and researcher prompt so the host sees a small,
       deterministic target
   - remaining:
     - rerun Codex on top of the current Claude/OpenCode retry-hardening branch
     - tighten the research artifact contract so the local model actually writes
       the expected file instead of free-running in tool/reasoning mode
   - if needed, add a Codex-specific completion helper that can recover a valid
     research artifact from returned output when the file is not written
5. Final acceptance
   - green deterministic suite
   - green per-host live smoke for `claude`, `opencode`, and `codex`
   - only after all three are green individually, run `--host all`

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
- end-to-end Claude bridge verification is now complete on a machine with the `claude` CLI installed
- the Codex artifact handoff bug behind the research-stage bridge stall is now fixed and covered by regression test plus bridge-level shim validation
- remaining environment-limited follow-up is a fresh live Codex multi-file rerun once quota allows it

## Recommended Next Session

Start here:

1. Fix smoke progress classification so active Codex stderr/trace activity is
   not treated as a silent stall
2. Build the direct minimal repro for the Claude strict-schema Ollama hang
3. Build the direct minimal repro for the OpenCode non-interactive hang
4. Turn those repros into host-specific runtime fixes before attempting another
   `--host all` pass

Concrete first step:

- use the preserved Ollama smoke trace bundles to create direct per-host repro
  commands, starting with the Claude strict research invocation

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
