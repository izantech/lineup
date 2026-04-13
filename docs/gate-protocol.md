# Gate Protocol

The CLI emits `gate/request` messages via NDJSON when user interaction is needed.
Each gate has a typed `gateType` field:

| gateType | Stage | Purpose |
|----------|-------|---------|
| `classify` | Triage | LLM-driven complexity classification and area identification |
| `clarify` | Clarify | Structured questions about the request |
| `clarification` | Gate | Research-driven ambiguity resolution |
| `approval` | Plan-approval | Plan approve/reject |
| `cache` | Any cached stage | Use cached results or re-run |
| `verify-decision` | Verify | Retry failed tasks, accept with warnings, or abort |
| `custom` | Tactic-defined | Custom gate from tactic `gate: approval` |

## Classify Gate

The triage stage collects deterministic project stats (file count, changed files, diff stats,
changed file paths) then emits a `classify` gate. The `context` field carries the stats as
structured text. The orchestrator LLM should:

1. Read the `context` (project stats and changed file paths)
2. Select `choice` from `["simple", "moderate", "complex"]`
3. Put a JSON object in `reason` with: `affected_areas`, `search_targets`, `independent_areas`

If the orchestrator cannot provide structured JSON in `reason`, the engine falls back to
deriving areas from the changed file paths.

The skill reads `gate/request` from stdout, asks the user, then calls
`lineup gate respond <run-id> <request-id> --choice <value>`. The CLI
writes pending gate files to `.lineup/.runs/<id>/gates/` and blocks until
a response file appears (atomic write via temp+rename).

## Interactive Mode

`--interactive`: Gates are handled via stdin prompts instead of file-based polling,
making Lineup usable without a host skill. Each gate type maps to a readline prompt
(approval → Y/n, clarify → free text, verify-decision → numbered menu).

## Gate Timeout

`--gate-timeout <seconds>`: On timeout, the pipeline saves state as `blocked`
(not `failed`) and exits cleanly. Blocked runs can be resumed with `lineup resume`.

## Retry UX

When verification fails (`FAIL` or `PASS_WITH_WARNINGS`), a `verify-decision` gate
presents three options: retry (re-runs only failed tasks within the same run), accept
with warnings (pipeline continues), or abort (marks failed).
