# Skills

## Lean Skill Architecture

Skills are thin CLI wrappers (~12 KB total, down from ~100 KB). The kick-off skill:

1. Runs `lineup run "<user request>" --mode host` (or `lineup run "<user request>" --tactic <name> --mode host`)
2. Reads NDJSON protocol messages from stdout
3. Handles `gate/request` messages by asking the user and calling `lineup gate respond`
4. Presents `pipeline/complete` results

All pipeline orchestration (agent spawning, DAG scheduling, state, artifacts) lives in the CLI.
Stages 1-3 (clarify, research, gate) emit `gate/request` with typed `gateType` fields.
The skill maps each gate type to the appropriate user interaction pattern.

## Commands

- Claude: `/lineup:kick-off`, `/lineup:configure`, `/lineup:explain`, `/lineup:playbook`, `/lineup:digest`
- Codex: `$lineup-kick-off`, `$lineup-configure`, `$lineup-explain`, `$lineup-playbook`, `$lineup-digest`
- OpenCode: `/lineup-kick-off`, `/lineup-configure`, `/lineup-explain`, `/lineup-playbook`, `/lineup-digest`
