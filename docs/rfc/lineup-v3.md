# RFC: Lineup v3 - Native Engine

## Metadata

- Status: Draft
- Owner: Izan
- Date: 2026-04-12
- Audience: CLI engine, host adapter, and skill-pack implementers
- Source of truth: this document

## Purpose

Lineup v3 moves deterministic orchestration out of prompt prose and into the CLI.
The target state is a native Lineup engine that owns artifacts, workflow evaluation,
task compilation, execution, retry, and state tracking. Host adapters remain thin.

This RFC is implementation-oriented. The companion execution documents are:

- [roadmap.md](/Users/izan/Dev/Projects/lineup/docs/rfc/roadmap.md)
- [`tasks/*.yaml`](/Users/izan/Dev/Projects/lineup/docs/rfc/tasks)

If a roadmap or task file conflicts with this RFC, the RFC wins.

## Implementation Contract

```yaml
rfc:
  id: lineup-v3
  target: native-lineup-engine
  status: draft

runtime:
  language: typescript
  compatibility: node-20-plus
  packaging_target: bun-compile
  packaging_fallback: node-js

execution:
  backend: native-lineup
  migration_reference: task-foundry
  dag_solver: required
  retry_with_context: required
  isolation_tiers:
    - index
    - full
    - sparse-gated

protocol:
  transport: stdio
  framing: ndjson
  rpc: json-rpc-2.0

validation:
  persisted_schema_stack: ajv-json-schema
  agent_output_repair: mechanical

artifacts:
  reviewable: yaml
  internal_state: json
  docs: markdown
  cache: content-addressed

tracking_docs:
  roadmap: docs/rfc/roadmap.md
  tasks_dir: docs/rfc/tasks/
```

## Problem

Lineup currently spends too much model context on deterministic orchestration work:

- stage bookkeeping
- file routing and snapshot handling
- validation and repair
- caching and resume behavior
- execution handoff and cleanup

The repository already contains useful pieces of a runtime engine, but they are split
between:

- prompt-heavy orchestration in `.lineup-core/skills/kick-off/*.md`
- workflow parsing and validation in the CLI
- a Task Foundry bridge for planning and execution

Lineup v3 consolidates these responsibilities into a native CLI engine.

## Goals

1. Move deterministic mechanics into the CLI.
2. Define stable artifact contracts for every pipeline stage.
3. Compile approved plans into deterministic task waves.
4. Run implementation and verification through a native Lineup executor.
5. Keep host adapters thin and generated skill packs canonical.
6. Preserve resumability across sessions through tracked roadmap and task files.

## Non-Goals

- Replacing Claude Code, Codex, or OpenCode as interactive hosts
- Supporting non-git repositories
- Making Ollama required for correctness
- Shipping sparse isolation as the default on day one
- Keeping Task Foundry as the long-term execution backend
- Backwards compatibility with Lineup v2 artifacts, workflows, or runtime behavior

## Research-Backed Corrections

The following corrections are part of the v3 design, based on repo inspection and
official upstream docs:

1. Bun compile is viable as a packaging target, but the runtime should stay Node-compatible first.
   Source: [Bun single-file executable docs](https://bun.sh/docs/bundler/executables)
2. Ollama exposes an OpenAI-compatible `/v1/` API, so CLI-side model routing can share one HTTP interface.
   Source: [Ollama OpenAI compatibility docs](https://docs.ollama.com/api/openai-compatibility)
3. `git sparse-checkout` is worktree-aware, but Git still documents it as experimental, so sparse isolation is gated and non-default.
   Source: [git-sparse-checkout docs](https://git-scm.com/docs/git-sparse-checkout)

## Existing Code Mapping

Lineup v3 is not a greenfield rewrite. The implementation should build directly on these
existing anchors.

| Subsystem | Current source | V3 direction |
| --- | --- | --- |
| Workflow model | [.lineup-core/workflows/full-pipeline.yaml](/Users/izan/Dev/Projects/lineup/.lineup-core/workflows/full-pipeline.yaml), [cli/src/lib/types.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/types.ts), [cli/src/lib/workflow.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/workflow.ts), [cli/src/lib/expression.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/expression.ts) | upgrade to `lineup/v3`, richer stage contracts, deterministic task compilation |
| Runtime entrypoint | [cli/src/commands/run.ts](/Users/izan/Dev/Projects/lineup/cli/src/commands/run.ts), [cli/src/lib/run-pipeline.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/run-pipeline.ts) | replace `LINEUP:*` text emission with native orchestration and JSON-RPC transport |
| Validation stack | [cli/src/lib/validation.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/validation.ts), [cli/schemas/](/Users/izan/Dev/Projects/lineup/cli/schemas) | keep AJV + JSON Schema for persisted artifacts and workflow/schema upgrades |
| Host adapters | [cli/src/lib/host-claude.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/host-claude.ts), [cli/src/lib/host-codex.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/host-codex.ts), [cli/src/lib/host-opencode.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/host-opencode.ts), [.lineup-core/hosts/](/Users/izan/Dev/Projects/lineup/.lineup-core/hosts) | keep adapters thin; map JSON-RPC methods to host-native primitives |
| Canonical skill pack | [.lineup-core/skills/kick-off/core.md](/Users/izan/Dev/Projects/lineup/.lineup-core/skills/kick-off/core.md), [.lineup-core/skills/kick-off/stages-1-3.core.md](/Users/izan/Dev/Projects/lineup/.lineup-core/skills/kick-off/stages-1-3.core.md), [.lineup-core/skills/kick-off/stages-4-5.core.md](/Users/izan/Dev/Projects/lineup/.lineup-core/skills/kick-off/stages-4-5.core.md), [.lineup-core/skills/kick-off/stages-6-7.core.md](/Users/izan/Dev/Projects/lineup/.lineup-core/skills/kick-off/stages-6-7.core.md) | reduce runtime prose; keep the skill pack as canonical host-facing instructions |
| Agent contracts | [agents/architect.md](/Users/izan/Dev/Projects/lineup/agents/architect.md), [agents/developer.md](/Users/izan/Dev/Projects/lineup/agents/developer.md), [agents/reviewer.md](/Users/izan/Dev/Projects/lineup/agents/reviewer.md) | extend frontmatter with explicit input/output schema contracts |
| Current execution bridge | [cli/src/lib/tf-config.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/tf-config.ts), [cli/src/lib/tf-adapters.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/tf-adapters.ts), [TASK_MANIFEST.yaml](/Users/izan/Dev/Projects/lineup/TASK_MANIFEST.yaml) | keep as migration reference and determinism oracle, not the shipped v3 executor |

## Final Decisions

### Runtime and packaging

- The engine `MUST` be implemented in TypeScript.
- The v3 runtime `MUST` remain compatible with Node 20+ during migration.
- Bun compile `SHOULD` be added as a packaging target after the runtime boundary stabilizes.
- Node.js `MUST` remain a supported packaging/runtime fallback.
- Lineup v3 `MAY` make breaking changes relative to v2 without providing a compatibility layer.

### Execution backend

- The shipped v3 executor `MUST` be native Lineup, not Task Foundry.
- Task Foundry `MAY` be retained as a migration reference, comparison harness, or test oracle.
- v3 acceptance `MUST NOT` depend on Task Foundry for normal execution.

### Validation and persistence

- Persisted artifacts `MUST` use AJV + JSON Schema.
- Reviewable artifacts `MUST` be YAML.
- Internal state and transport artifacts `MUST` be JSON.
- Artifact reads and writes `MUST` both validate.
- Mechanical output repair `MAY` run before validation, but repaired output must still validate against schema.
- Pre-v3 caches, workflow definitions, and state `SHOULD` be invalidated rather than migrated when that reduces complexity.

### Process and git execution

- External commands `MUST` use the subprocess execution model already present in [cli/src/lib/process.ts](/Users/izan/Dev/Projects/lineup/cli/src/lib/process.ts).
- Git operations `MUST` use raw `git` subprocess calls rather than introducing a high-level git wrapper.
- Isolation tiers `MUST` prefer `index` and `full` first.
- `sparse` isolation `MUST` be feature-gated and non-default until stability is proven.

### Host integration

- Host communication `MUST` use JSON-RPC 2.0 over stdio with NDJSON framing.
- Host adapters `MUST NOT` own workflow logic.
- Generated skills remain canonical host-facing artifacts.

### Model routing and Ollama

- Model routing `MUST` live in the CLI.
- Provider access `MUST` use an OpenAI-compatible HTTP interface.
- Ollama `MUST` remain optional.
- Ollama-assisted features `MUST` degrade cleanly when unavailable.

## Architecture

```text
Host UI
  -> host adapter
    -> lineup CLI engine
      -> workflow evaluator
      -> artifact store + validators
      -> task compiler + wave scheduler
      -> native isolation layer
      -> native executor + retry engine
      -> prompt builder
      -> model router + Ollama bridge
      -> observer + status/reporting
```

### Stage model

| Stage | Owner | Output |
| --- | --- | --- |
| `triage` | CLI builtin | `Constitution` |
| `clarify` | orchestrator reasoning | updates to request/spec context |
| `research` | `researcher` | `Spec` |
| `gate` | orchestrator reasoning | resolved requirements |
| `plan` | `architect` | `Plan` |
| `approval` | user + host | approved plan state |
| `tasks` | CLI builtin | `Tasks` |
| `implement` | native executor + `developer` prompts | diffs + implementation state |
| `verify` | native executor + `reviewer` prompts | `Review` |
| `document` | `documenter` | Markdown + doc report |

### Artifact model

| Artifact | Format | Notes |
| --- | --- | --- |
| `constitution.yaml` | YAML | request normalization, scope, repo metadata |
| `spec.yaml` | YAML | research findings and clarifications |
| `plan.yaml` | YAML | approved implementation plan |
| `tasks.json` | JSON | deterministic compiled task graph |
| `pipeline-state.json` | JSON | per-run engine state |
| `review.yaml` | YAML | verification result |
| `roadmap.md` | Markdown | human aggregate tracking |
| `tasks/*.yaml` | YAML | resumable execution units |

## Artifact and Contract Rules

### Workflow contracts

- Workflow definitions `MUST` move to `apiVersion: lineup/v3`.
- Workflow DAG validation stays in the CLI and expands from the current v1 surface.
- v3 `MUST NOT` require backward parsing compatibility for v1/v2 workflow files.
- Expressions `MUST` remain explicit and deterministic.

### Agent contracts

Agent frontmatter `SHOULD` grow these fields:

```yaml
inputs:
  - name: constitution
    schema: Constitution
    required: true
outputs:
  schema: Spec
timeout: 5m
retry:
  max: 1
  on: [timeout, rate_limit]
ollama:
  compress_output: true
```

### Task tracking contracts

The RFC companion task files `MUST` use this shape:

```yaml
apiVersion: lineup/v3
kind: RfcTask
id: V3-02
title: Add v3 artifact and protocol schemas
status: todo
last_updated: 2026-04-12
depends_on: [V3-00]
parallel_wave: 1
suggested_agent: developer
rfc_sections:
  - Artifact and Contract Rules
write_scope:
  - cli/schemas/
deliverables:
  - Add persisted artifact schemas
acceptance_criteria:
  - Invalid fixtures fail with stable errors
notes:
  determinism_rules:
    - Reuse AJV and JSON Schema
```

## Rollout Strategy

### Phase 0

- Correct the RFC.
- Add roadmap and task files.
- Treat these docs as the resumable execution surface.

### Phase 1

- Add v3 schemas, config, protocol, workflow upgrades, and isolation scaffolding.
- Keep runtime Node-compatible.
- Do not make Bun compile a milestone blocker.

### Phase 2

- Add task compilation, artifact store, and run-state hashing.
- Introduce the native executor behind tests.

### Phase 3

- Migrate the canonical kick-off skill pack to thinner runtime delegation.
- Remove normal execution dependency on Task Foundry.

### Phase 4

- Add production-readiness controls around the native engine.
- Keep a transitional execution selector until native execution is proven across real task corpora.

### Phase 5

- Dogfood the native engine on Lineup and fixture repos.
- Cut over default execution only after readiness gates are met.

### Isolation rollout

- `index` ships first.
- `full` ships first.
- `sparse` is gated, non-default, and promoted only after test stability.

## Production Readiness Additions

The architecture above makes v3 feasible. The following additions make it a tool that is
safe to ship and operate.

### Transitional engine mode

- Lineup `SHOULD` support `--engine native|tf|auto` during rollout.
- `native` runs the new executor.
- `tf` keeps the current Task Foundry path available as a fallback and comparison harness.
- `auto` may prefer native only after readiness gates are met.

### Narrow GA target

The first production-ready cut `SHOULD` be narrower than the full long-term design:

- Node-compatible runtime
- `index` and `full` isolation only
- no default sparse mode
- deterministic run state, cancel, resume, and cleanup
- stable host behavior across Claude, Codex, and OpenCode

### User-journey definition of done

The tool is not considered working solely because subsystems exist. The following end-to-end
journeys must pass:

- fresh install, status, doctor, run, cancel, resume, cleanup
- clean repo and dirty repo behavior
- successful parallel tasks
- overlapping-write conflict handling
- malformed agent output recovery
- timeout and retry behavior
- host integration behavior on all supported hosts

### Differential regression harness

- Native execution `SHOULD` be compared against the current behavior on a fixed corpus of tasks.
- The harness `SHOULD` compare:
  - task compilation
  - wave ordering
  - cleanup behavior
  - end-state correctness
- Existing Task Foundry semantics and benchmark tooling may be reused as comparison references.

### Operational hardening

v3 should add these operational features in addition to the core engine:

- stale worktree detection and cleanup
- per-run directories under `.lineup/.runs/<id>/`
- lockfiles or equivalent protection against concurrent mutating runs on the same repo
- debug bundle or equivalent failure snapshot for failed executions
- explicit invalidation and cleanup rules for pre-v3 cache, state, and workflow artifacts

### Dogfood and cutover rules

- Native v3 `SHOULD` be dogfooded on the Lineup repo first.
- It `SHOULD` then be validated on multiple fixture repos with different shapes.
- The default engine `MUST NOT` switch to native until readiness metrics and regression checks pass.

## Concrete Work Breakdown

This RFC is split into the tracked tasks under [docs/rfc/tasks/](/Users/izan/Dev/Projects/lineup/docs/rfc/tasks). The canonical dependency graph is:

| ID | Title | Depends on | Wave |
| --- | --- | --- | --- |
| `V3-00` | Correct RFC and add existing-code mapping | — | 0 |
| `V3-01` | Create roadmap/task scaffolding | `V3-00` | 1 |
| `V3-02` | Add v3 artifact/protocol/state schemas | `V3-00` | 1 |
| `V3-03` | Implement artifact store, output repair, run-state hashing | `V3-02` | 2 |
| `V3-04` | Upgrade workflow/types/expression to v3 | `V3-00` | 1 |
| `V3-05` | Add config resolution, model aliases, and Ollama bridge | `V3-00` | 1 |
| `V3-06` | Add JSON-RPC transport and protocol types | `V3-00` | 1 |
| `V3-07` | Migrate Claude/Codex/OpenCode adapters to JSON-RPC | `V3-06` | 2 |
| `V3-08` | Compile `Plan` to deterministic `Tasks` and execution waves | `V3-02`, `V3-04` | 2 |
| `V3-09` | Implement native isolation layer | `V3-00` | 1 |
| `V3-10` | Implement native executor, retry, diff apply, verify hooks | `V3-03`, `V3-06`, `V3-08`, `V3-09` | 3 |
| `V3-11` | Refactor prompt builder, agent contracts, and canonical skill pack | `V3-02`, `V3-04`, `V3-05`, `V3-07`, `V3-10` | 3 |
| `V3-12` | Finish command surface, observer, tests, docs, and examples | `V3-03`, `V3-05`, `V3-07`, `V3-10`, `V3-11` | 4 |
| `V3-13` | Add transitional engine mode and GA scope guards | `V3-07`, `V3-10`, `V3-12` | 5 |
| `V3-14` | Build differential regression harness and task corpus | `V3-10`, `V3-12` | 5 |
| `V3-15` | Add operational hardening and v3 clean-break invalidation | `V3-03`, `V3-09`, `V3-10`, `V3-12` | 5 |
| `V3-16` | Dogfood, readiness metrics, and native-default cutover | `V3-13`, `V3-14`, `V3-15` | 6 |
| `V3-17` | Add run inspection commands (runs, show, logs) | `V3-16` | 7 |
| `V3-18` | Add artifact commands (validate, artifacts show/path/diff) | `V3-16` | 7 |
| `V3-19` | Expose execution controls (--max-parallel, --isolation, --resume, --cancel, --approve-plan) | `V3-16` | 7 |
| `V3-20` | Add lineup init for project bootstrap | `V3-17` | 8 |
| `V3-21` | Add workflow and tactic authoring UX | `V3-20` | 8 |
| `V3-22` | Add pause/resume and approval/gating UX | `V3-19` | 8 |
| `V3-23` | Add external-repo dogfood corpus and release hardening | `V3-17`, `V3-18`, `V3-19`, `V3-22` | 9 |
| `V3-24` | Add shell completion, notifications, DAG viz, and polish | `V3-20`, `V3-21` | 9 |

## Acceptance Criteria

The v3 initiative is complete when all of the following are true:

1. `lineup run --dry-run` evaluates a v3 workflow and prints deterministic waves.
2. Reviewable artifacts validate against JSON Schemas through AJV.
3. The same approved plan produces the same `Tasks` artifact and wave ordering.
4. Overlapping writes are separated into different waves.
5. Resume rejects stale artifacts when the repo tree hash changes.
6. JSON-RPC request, response, timeout, and cancel flows are fixture-tested for all supported hosts.
7. Normal v3 execution no longer depends on Task Foundry.
8. `index` and `full` isolation tiers are tested end to end.
9. Generated host skill outputs remain valid after kick-off refactoring.
10. `./dev check` passes once dependencies are installed.
11. The native engine can be selected explicitly without removing the TF fallback path during rollout.
12. Differential regression checks compare native behavior against the current implementation on a fixed task corpus.
13. Run locking, stale-worktree cleanup, and debug capture exist for operational failures.
14. Native is made the default only after dogfooding and readiness metrics pass.

## Feasibility Assessment

### Why this is feasible

- The repo already has:
  - workflow schema and DAG parsing
  - a run command and runtime entrypoint
  - an AJV-based validation stack
  - host packaging and generation logic
  - canonical skills and agent definitions
  - a Task Foundry bridge that provides a reference execution model

### Main risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Native executor replaces a working TF bridge | High | stage migration behind tests and keep TF as comparison harness |
| Sparse isolation behavior changes across Git versions | Medium | gate sparse mode and keep it non-default |
| Protocol migration breaks host integrations | High | fixture-test JSON-RPC flows and keep adapters thin |
| Runtime packaging drifts toward Bun-only | Medium | keep Node-compatible first and treat Bun as packaging |

### Verdict

The implementation is feasible, but it is a staged initiative. The most credible path is:

1. land the corrected RFC and execution-tracking docs
2. ship v3 schemas, protocol, config, and task compilation
3. replace the TF runtime handoff with a native executor
4. thin the canonical skill pack afterward

## Summary

Lineup v3 is a native engine effort, not a prompt rewrite and not a permanent Task Foundry bridge.
The repo already contains enough runtime and validation structure to support this direction.
The companion roadmap and task files are now part of the implementation contract so the work
can be resumed cleanly across sessions without drifting from the RFC.
