# Lineup v3 Roadmap

This roadmap tracks execution of [lineup-v3.md](/Users/izan/Dev/Projects/lineup/docs/rfc/lineup-v3.md), which is the source of truth. Task files in [tasks/](/Users/izan/Dev/Projects/lineup/docs/rfc/tasks) are the executable units. If this roadmap diverges from the RFC, follow the RFC and update the roadmap.

## Status Legend

- `todo`: not started
- `in_progress`: actively being worked
- `blocked`: cannot proceed yet
- `done`: complete

## Corrections Landed First

These RFC deltas are now part of the tracked plan:

- v3 targets a native Lineup executor, not a permanent Task Foundry backend.
- Persisted validation stays on AJV + JSON Schema.
- Git execution uses raw subprocesses.
- Runtime stays Node-compatible first; Bun compile is packaging.
- Sparse isolation is gated and non-default.
- RFC now maps each v3 subsystem to existing CLI and skill-pack code.

## Wave Plan

| Wave | Tasks | Notes |
| --- | --- | --- |
| 0 | `V3-00` | Correct RFC and align architecture to the repo |
| 1 | `V3-01`, `V3-02`, `V3-04`, `V3-05`, `V3-06`, `V3-09` | Parallel foundation work |
| 2 | `V3-03`, `V3-07`, `V3-08` | Artifact state, adapters, task compiler |
| 3 | `V3-10`, `V3-11` | Native executor and skill-pack refactor |
| 4 | `V3-12` | Integration, docs, tests, command surface |
| 5 | `V3-13`, `V3-14`, `V3-15` | Production-readiness controls, regression harness, operational hardening |
| 6 | `V3-16` | Dogfood evidence and native-default cutover |

## Task Index

| ID | Title | Status | Deps | Wave | Owner | Last Updated |
| --- | --- | --- | --- | --- | --- | --- |
| [V3-00](./tasks/v3-00-rfc-corrections.yaml) | Correct RFC and add existing-code mapping | `done` | — | 0 | architect | 2026-04-12 |
| [V3-01](./tasks/v3-01-roadmap-scaffold.yaml) | Create roadmap/task scaffolding | `done` | `V3-00` | 1 | architect | 2026-04-12 |
| [V3-02](./tasks/v3-02-artifact-schemas.yaml) | Add v3 artifact/protocol/state schemas | `done` | `V3-00` | 1 | developer | 2026-04-12 |
| [V3-03](./tasks/v3-03-artifact-store-and-state.yaml) | Implement artifact store, output repair, run-state hashing | `done` | `V3-02` | 2 | developer | 2026-04-12 |
| [V3-04](./tasks/v3-04-workflow-v3-upgrade.yaml) | Upgrade workflow/types/expression to v3 | `done` | `V3-00` | 1 | developer | 2026-04-12 |
| [V3-05](./tasks/v3-05-config-model-routing-and-ollama.yaml) | Add config resolution, model aliases, and Ollama bridge | `done` | `V3-00` | 1 | developer | 2026-04-12 |
| [V3-06](./tasks/v3-06-json-rpc-protocol.yaml) | Add JSON-RPC transport and protocol types | `done` | `V3-00` | 1 | developer | 2026-04-12 |
| [V3-07](./tasks/v3-07-host-adapter-migration.yaml) | Migrate Claude/Codex/OpenCode adapters to JSON-RPC | `done` | `V3-06` | 2 | developer | 2026-04-12 |
| [V3-08](./tasks/v3-08-task-compiler-and-waves.yaml) | Compile `Plan` to deterministic `Tasks` and execution waves | `done` | `V3-02`, `V3-04` | 2 | developer | 2026-04-12 |
| [V3-09](./tasks/v3-09-native-isolation.yaml) | Implement native isolation layer | `done` | `V3-00` | 1 | developer | 2026-04-12 |
| [V3-10](./tasks/v3-10-native-executor.yaml) | Implement native executor, retry, diff apply, verify hooks | `todo` | `V3-03`, `V3-06`, `V3-08`, `V3-09` | 3 | developer | 2026-04-12 |
| [V3-11](./tasks/v3-11-prompt-builder-and-skill-pack.yaml) | Refactor prompt builder, agent contracts, and canonical skill pack | `todo` | `V3-02`, `V3-04`, `V3-05`, `V3-07`, `V3-10` | 3 | architect + developer | 2026-04-12 |
| [V3-12](./tasks/v3-12-command-surface-tests-and-docs.yaml) | Finish command surface, observer, tests, docs, and examples | `todo` | `V3-03`, `V3-05`, `V3-07`, `V3-10`, `V3-11` | 4 | developer + reviewer | 2026-04-12 |
| [V3-13](./tasks/v3-13-transitional-engine-mode.yaml) | Add transitional engine mode and GA scope guards | `todo` | `V3-07`, `V3-10`, `V3-12` | 5 | developer | 2026-04-12 |
| [V3-14](./tasks/v3-14-differential-regression-harness.yaml) | Build differential regression harness and task corpus | `todo` | `V3-10`, `V3-12` | 5 | reviewer | 2026-04-12 |
| [V3-15](./tasks/v3-15-operational-hardening-and-migrations.yaml) | Add operational hardening and v3 clean-break invalidation | `todo` | `V3-03`, `V3-09`, `V3-10`, `V3-12` | 5 | developer | 2026-04-12 |
| [V3-16](./tasks/v3-16-dogfood-metrics-and-cutover.yaml) | Dogfood, readiness metrics, and native-default cutover | `todo` | `V3-13`, `V3-14`, `V3-15` | 6 | reviewer | 2026-04-12 |

## Current Handoff

- Active task: wave 2 runtime-state, task-compiler, and adapter integration complete
- Current state:
  - `V3-00` complete
  - `V3-01` complete
  - `V3-02`, `V3-04`, `V3-05`, `V3-06`, and `V3-09` are complete
  - `V3-03`, `V3-07`, and `V3-08` are complete
  - `./dev check` passes with the new wave 2 surface
- Ready-to-start tasks after wave 2:
  - `V3-10`
  - `V3-11`
- Immediate next step:
  - start wave 3 by carving executor/retry/runtime integration away from prompt and skill-pack refactors
- Known blockers:
  - current CLI runtime still routes implementation/verification through the TF bridge
  - native executor, operational hardening, and cutover controls are not implemented yet
  - differential regression harness does not exist yet
