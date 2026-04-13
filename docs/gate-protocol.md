# Gate Protocol

In `lineup run --mode host`, the CLI emits `gate/request` messages via NDJSON when
user interaction is needed.

Before a host launches `lineup run --mode host`, it should make sure the current
project has:

- a default workflow (`lineup init` scaffolds one)
- a git repository (`lineup init` creates one if missing)
- at least one git commit

The recommended host pattern is to launch the CLI in the background, write stdout to
an NDJSON log file, then poll and process only new lines as they appear.
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

## Agent Spawn Handoff

In `host` mode, `agent/spawn` messages are also part of the contract:

- `plan` stages include `params.outputs.path` for the plan artifact the host must write
- native `implement` stages include `params.inputs.task` plus a response file path under
  `.lineup/.runs/<id>/artifacts/native/responses/`
- native `verify` stages expect a review artifact at
  `.lineup/.runs/<id>/artifacts/native/responses/review.yaml`

Hosts should write these files atomically (temp file + rename). The CLI polls for them
and repairs fenced JSON/YAML payloads before schema validation.

If the planner writes prose instead of a structured `Plan`, the CLI issues one
immediate retry with stricter instructions before failing the run. For developer
and reviewer outputs, the runtime also normalizes a few common variants:

- developer JSON may use `status: done|success|complete`
- `changes_made` entries may omit `task_id`
- reviewer markdown summaries are converted into `lineup/v3 Review` YAML

## Interactive Mode

`lineup run` operates in two modes:

- `human` — local readline prompts, human-readable progress, prompts/progress on `stderr`
- `host` — no local prompts, NDJSON protocol on `stdout`

Interactive gate prompts are used in `human` mode. Each gate type maps to a readline
prompt (approval → Y/n, clarify → free text, verify-decision → numbered menu). Host
skills and CI should pass `--mode host` to receive `gate/request` JSON via stdout.

## Gate Timeout

`--gate-timeout <seconds>`: On timeout, the pipeline saves state as `blocked`
(not `failed`) and exits cleanly. Blocked runs can be resumed with `lineup resume`.

## Retry UX

When verification fails (`FAIL` or `PASS_WITH_WARNINGS`), a `verify-decision` gate
presents three options: retry (re-runs only failed tasks within the same run), accept
with warnings (pipeline continues), or abort (marks failed).
