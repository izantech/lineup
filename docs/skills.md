# Skills

## Interaction Model

Lineup has one engine and two user-facing entrypoints:

- **Direct CLI use**: the user runs `lineup` in a terminal
- **Host skill use**: the user invokes a generated Lineup skill inside Claude, Codex, or OpenCode

In both cases, the CLI owns orchestration, state, artifacts, retries, and native
execution. Skills are host-native entrypoints, not separate runtimes.

### Direct CLI use

Direct terminal users interact with the engine themselves:

- `lineup init`
- `lineup run "<task>"` for interactive local use
- `lineup run "<task>" --mode host` for low-level raw protocol consumers
- inspection and control commands like `lineup show`, `lineup logs`, `lineup runs`, `lineup artifacts show`, `lineup resume`, and `lineup cancel`

This path is appropriate when the user is already working in a shell or when an
external integration wants the raw runtime contract directly.

### Host skill use

Host users stay inside the assistant session:

- Claude: `/lineup:kick-off`
- Codex: `$lineup-kick-off`
- OpenCode: `/lineup-kick-off`

The host skill should:

1. Preflight with `lineup init` and `lineup doctor`
2. Start a detached bridge session with `lineup bridge start`
3. Poll `lineup bridge events`
4. Show `status` events as progress
5. Prefer `pendingQuestion` on reconnect instead of assuming the last page still contains the original `question` event
6. Ask the user only for `question` / `pendingQuestion`
7. Reply with `lineup bridge answer` only while `recovery.action` is `answer`
8. If `recovery.action` is `resume`, treat the run as a timeout-recovery flow instead of sending an inert answer
9. Inspect final results with `lineup show`, `lineup artifacts show`, or `lineup logs`

This keeps the host session thin and prevents prompt-space orchestration drift.

### Bridge vs raw host mode

Use the bridge for generated skills.

Use `lineup run --mode host` only when a caller explicitly wants the raw NDJSON
protocol and is prepared to supervise low-level runtime events like `agent/spawn`,
`gate/request`, and `pipeline/complete`.

## Lean Skill Architecture

Skills are thin CLI wrappers (~12 KB total, down from ~100 KB). The kick-off skill:

1. Preflights workflow and git readiness (`lineup init` if needed, `lineup doctor --json`)
2. Launches `lineup bridge start "<user request>" --executor-host <host>` (or adds `--tactic <name>` / `--workflow <path>`)
3. Polls `lineup bridge events <run-id> --after <seq> --wait <seconds> --json`
4. Uses `pendingQuestion` for reconnect-safe gate handling
5. Handles live `question` / `pendingQuestion` payloads by asking the user and calling `lineup bridge answer`
6. Uses `recovery` to distinguish `answer`, `resume`, and `inspect` next steps
7. Presents `status` events as progress updates
8. Presents `complete` results, then inspects artifacts with `lineup show`, `lineup artifacts show`, or `lineup logs`

All pipeline orchestration (agent spawning, DAG scheduling, state, artifacts) lives in the CLI.
The bridge is the skill-facing API; it keeps the host session thin and avoids raw
NDJSON supervision in prompt space.

Recommended host integration:

- launch `lineup bridge start ...` in the background or as a detached session
- poll `lineup bridge events` for incremental updates
- answer only `question` events with `lineup bridge answer`
- inspect final results with the existing read-only commands after completion

Built-in CLI tactics such as `explain` are resolvable by name even outside the
Lineup repo. They are not currently advertised by `lineup tactic list`, which
remains focused on repo-local/project tactics.

This keeps the host session responsive instead of treating the pipeline as a single
opaque blocking Bash call.

`lineup init` now scaffolds the workflow/runtime directories and initializes git if
needed, but host wrappers should still check that the repository has an initial
commit before starting native implementation.

The CLI is tolerant of several common host-side formatting mistakes, but wrappers
should still aim to emit the correct artifacts on the first try:

- planner prose is retried once with a stricter prompt
- fenced JSON/YAML payloads are repaired before schema validation
- developer responses may use `complete`, `done`, or `success`
- markdown-style reviewer summaries are normalized into `Review` YAML

Stages 1-3 (clarify, research, gate) now surface as bridge `question` events with
typed `gateType` fields. The bridge also persists unresolved gate metadata in
`pendingQuestion` so interrupted host sessions can reconnect without replaying the
entire event stream. The skill maps each gate type to the appropriate user
interaction pattern and follows `recovery.action` when a gate has timed out.

## Commands

- Claude: `/lineup:kick-off`, `/lineup:configure`, `/lineup:explain`, `/lineup:playbook`, `/lineup:digest`
- Codex: `$lineup-kick-off`, `$lineup-configure`, `$lineup-explain`, `$lineup-playbook`, `$lineup-digest`
- OpenCode: `/lineup-kick-off`, `/lineup-configure`, `/lineup-explain`, `/lineup-playbook`, `/lineup-digest`
