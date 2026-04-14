# Bridge Protocol

Generated skills use the bridge API, not raw `lineup run --mode host` supervision.
The bridge keeps the host thin: it polls compact events, asks the user only when a
question event arrives, and answers back through the CLI.

Before starting a bridge session, the project should have:

- a default workflow (`lineup init` scaffolds one)
- a git repository (`lineup init` creates one if missing)
- at least one git commit before native implementation stages run

## Bridge Commands

The skill-facing contract is:

- `lineup bridge start "<task>" --executor-host <host> [--workflow <path>] [--tactic <name>] [--approve-plan] [--gate-timeout <seconds>] [--json]`
- `lineup bridge events <run-id> --after <seq> --wait <seconds> [--json]`
- `lineup bridge answer <run-id> <request-id> --choice <value> [--reason <text>] [--json]`

Recommended host pattern:

1. Start a bridge session and capture the returned `runId`
2. Poll `lineup bridge events` for `status`, `question`, and `complete` events
3. Use `pendingQuestion` when reconnecting after the caller's cursor has already advanced past the original `question` event
4. Present only `question` / `pendingQuestion` to the user and answer them with `lineup bridge answer` while `recovery.action` is `answer`
5. If `recovery.action` is `resume`, surface the timeout state and resume instead of sending an inert late answer
6. Inspect results after completion with `lineup show`, `lineup artifacts show`, or `lineup logs`

## Event Types

| type | Purpose |
|------|---------|
| `status` | Progress updates for stage execution |
| `question` | User-facing decisions that require a response |
| `complete` | Terminal success, failure, or aborted state |

`status` events also carry host-facing `stageLabel` and `kind` fields so hosts can
render progress without interpreting raw stage text.

`question` events carry the interaction details that the skill should present:

- `stageId`
- `gateType`
- `question`
- `choices`
- `defaultChoice` if present
- `context` if present
- `allowFreeText` if present
- `createdAt`
- `expiresAt` if a gate timeout is active

The skill should present the question via its normal question primitive, then call
`lineup bridge answer <run-id> <request-id> --choice <value>` with an optional reason.

`lineup bridge events --json` also returns:

- `session` — session metadata for reconnect-safe rendering
- `pendingQuestion` — the unresolved question even if no new `question` event is in the current page
- `recovery` — the concrete next step: `answer`, `resume`, or `inspect`

The text-mode `lineup bridge events` output also emits `continue_with` so hosts
that are shelling out manually can reuse the exact next `--after` cursor value.

## Triage Gate

The triage stage still classifies task complexity before any work is spawned. The
`classify` gate uses project stats and changed-file context to choose one of:

- `simple`
- `moderate`
- `complex`

When the bridge receives a `classify` question, the skill should:

1. Read the `context` block
2. Choose a complexity option
3. Add structured reasoning in `--reason` when possible

## Retry UX

When verification fails (`FAIL` or `PASS_WITH_WARNINGS`), the bridge can surface a
`verify-decision` question with retry, accept-with-warnings, or abort choices.
Skills should present those choices directly and answer with `lineup bridge answer`.

## Low-Level Host Mode

`lineup run --mode host` still exists for advanced/custom integrations and CI. It is
the raw protocol path, not the default skill path. Generated skills should not
background it or tail NDJSON logs directly.

## Output Contract

The bridge event stream is intentionally smaller than the raw host protocol:

- `status`
- `question`
- `complete`

Blocked bridge runs still use `status: "blocked"` but should be treated as recovery
states. A live unanswered gate yields `recovery.action = "answer"`. A timed-out gate
that already stopped the worker yields `recovery.action = "resume"`.

The bridge owns orchestration, local agent spawning, and artifact handoff. Generated
skills stay focused on progress display and user decisions.
