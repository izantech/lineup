# Skills

## Lean Skill Architecture

Skills are thin CLI wrappers (~12 KB total, down from ~100 KB). The kick-off skill:

1. Preflights workflow and git readiness (`lineup init` if needed, `lineup doctor --json`)
2. Launches `lineup run "<user request>" --mode host` (or `lineup run "<user request>" --tactic <name> --mode host`)
3. Reads NDJSON protocol messages from stdout
4. Handles `gate/request` messages by asking the user and calling `lineup gate respond`
5. Handles `agent/spawn` messages by writing the requested artifact or response file to the path provided by the CLI
6. Presents `pipeline/complete` results

All pipeline orchestration (agent spawning, DAG scheduling, state, artifacts) lives in the CLI.
Stages 1-3 (clarify, research, gate) emit `gate/request` with typed `gateType` fields.
The skill maps each gate type to the appropriate user interaction pattern.

When a host writes plan, task, or review outputs in `host` mode, it should write them
atomically (temp file + rename). The runtime polls those paths and treats them as the
handoff boundary between the host wrapper and the native executor.

Recommended host integration:

- launch `lineup run --mode host` in the background
- redirect stdout to a NDJSON log file and stderr to a diagnostics file
- poll only new stdout lines and react to protocol messages incrementally

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

## Commands

- Claude: `/lineup:kick-off`, `/lineup:configure`, `/lineup:explain`, `/lineup:playbook`, `/lineup:digest`
- Codex: `$lineup-kick-off`, `$lineup-configure`, `$lineup-explain`, `$lineup-playbook`, `$lineup-digest`
- OpenCode: `/lineup-kick-off`, `/lineup-configure`, `/lineup-explain`, `/lineup-playbook`, `/lineup-digest`
