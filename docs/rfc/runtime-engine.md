# RFC: Lineup Runtime — Declarative Workflow Engine

**Status**: Draft — External review complete (see Appendix C)
**Author**: izantech
**Date**: 2026-04-12
**Recommended path**: Option B (Task Foundry as runtime, Lineup as bridge)

---

## Summary

Extend the existing `@izantech/lineup-cli` package with a `lineup run` command that acts as a **runtime engine** for Lineup pipelines. The CLI handles all mechanical orchestration (state management, caching, snapshot construction, agent prompt building, retries, cleanup) while the LLM handles only reasoning tasks (triage, clarification, judgment calls). Pipeline structure moves from prose instructions in markdown files to a **declarative YAML workflow format** with typed inputs/outputs, explicit DAG dependencies, and first-class retry/error recovery.

## Motivation

### Problem: Token waste on mechanical work

The current kick-off orchestrator is **~57% mechanical overhead** — file I/O, template rendering, cache management, validation, and cleanup are all described as prose instructions that the LLM must read, interpret, and execute. This burns ~3,370 instruction tokens and ~1,500-3,000 execution tokens per pipeline run on tasks that require zero intelligence.

The breakdown across 1,017 lines of orchestrator prompts:

| Classification | Share | What it covers |
|---|---|---|
| Mechanical | ~57% | Spawn scaffolding, caching, file I/O, validation, cleanup |
| Hybrid | ~28% | Snapshot compression, context management |
| Reasoning | ~15% | Triage, clarification, gate, plan merging |

### Problem: Non-deterministic orchestration

Prose instructions for pipeline orchestration lead to inconsistent behavior:
- The LLM may or may not compress a snapshot correctly
- Cache hash computation varies if the LLM paraphrases the key
- Stage ordering relies on the LLM reading all stage files correctly
- Error recovery is ad-hoc ("use your judgment")

### Problem: No formal state model

The pipeline has no persistent state between runs. `--from-stage N` requires the user to know which stage to restart from, and the cache format is loosely defined. There is no state machine — just cache files that the LLM must discover and interpret.

## Design

### Architecture

```
┌─────────────────────────────────────────────┐
│  lineup run (CLI)                            │
│                                              │
│  ┌──────────────┐    ┌────────────────────┐  │
│  │ Workflow      │    │ State Machine      │  │
│  │ Parser (YAML) │───▶│                    │  │
│  └──────────────┘    │  pending → running  │  │
│                      │  running → complete │  │
│  ┌──────────────┐    │  running → failed   │  │
│  │ Snapshot      │    │  running → skipped  │  │
│  │ Builder       │    └────────────────────┘  │
│  │              │                            │
│  │ - extract()  │    ┌────────────────────┐  │
│  │ - compress() │    │ Cache Manager      │  │
│  │ - stream()   │    │                    │  │
│  └──────────────┘    │ - computeHash()    │  │
│                      │ - read()           │  │
│  ┌──────────────┐    │ - write()          │  │
│  │ Prompt        │    │ - validate()       │  │
│  │ Builder       │    └────────────────────┘  │
│  │              │                            │
│  │ - loadAgent()│    ┌────────────────────┐  │
│  │ - injectCtx()│    │ Init Runner        │  │
│  │ - appendix() │    │                    │  │
│  └──────────────┘    │ - overrides()      │  │
│                      │ - migration()      │  │
│  ┌──────────────┐    │ - tacticResolve()  │  │
│  │ Runner        │    │ - detectTeams()   │  │
│  │              │    │ - detectOllama()   │  │
│  │ - execute()  │    └────────────────────┘  │
│  │ - retry()    │                            │
│  │ - cleanup()  │                            │
│  └──────────────┘                            │
└──────────┬──────────────────────────────────┘
           │ constructs prompt + hands off
           ▼
┌─────────────────────────────────────────────┐
│  LLM (reasoning only)                        │
│                                              │
│  Stage 0: Triage (classify, search targets)  │
│  Stage 1: Clarify (detect gaps, ask Qs)      │
│  Stage 3: Gate (resolve ambiguities)         │
│  Plan merge (when parallel architects)        │
│  Snapshot compression (fallback)              │
└─────────────────────────────────────────────┘
```

### The `lineup run` command

```
lineup run [options]

Options:
  --workflow <path>      Path to workflow YAML (default: .lineup-core/workflows/full-pipeline.yaml)
  --tactic <name>        Run a specific tactic instead of the default pipeline
  --from-stage <id>      Resume from a specific stage (uses cached upstream)
  --dry-run              Run through plan, stop before implement
  --force-rerun          Ignore cache, re-run all stages
  --json                 Output state as JSON (for tooling)
```

The command is invoked by the LLM at the start of a kick-off session. The LLM's skill prompt becomes:

```
You are the Lineup orchestrator. Run `lineup run` to start the pipeline.
The CLI will manage state, caching, and agent spawning. When the CLI
presents a task, execute it and return output. When the CLI asks for a
decision, use AskUserQuestion to consult the user.

Read your task-specific instructions from the CLI output.
```

### Workflow YAML Format

#### Schema

The workflow format is defined by a JSON Schema in `cli/schemas/yaml/workflow.schema.json`.

```yaml
apiVersion: lineup/v1
kind: Workflow
name: full-pipeline
description: |
  Standard pipeline for complex multi-file changes with unclear requirements.

variables:
  - name: target_scope
    description: "Which area of the codebase to focus on"
    type: string
    default: ""
    required: false

stages:
  - id: triage
    type: builtin
    description: "Classify complexity and identify affected areas"
    outputs:
      complexity:
        type: enum
        values: [simple, moderate, complex]
      affected_areas:
        type: list
        items:
          type: object
          properties:
            name: { type: string }
            coupled: { type: boolean }
      search_targets:
        type: list
        items:
          type: object
          properties:
            area: { type: string }
            targets: { type: list, items: { type: string } }
      independent_areas:
        type: list
        items:
          type: list
          items: { type: string }

  - id: clarify
    type: reasoning
    description: "Refine requirements with structured questions"
    depends_on: [triage]
    inputs:
      - source: triage
        fields: [complexity, affected_areas]
    outputs:
      requirements: { type: string }
    optional: true
    condition: "{{ stages.triage.outputs.complexity }} != simple"
    gate: false

  - id: research
    type: agent
    agent: researcher
    description: "Explore codebase and gather context"
    depends_on: [triage, clarify]
    inputs:
      - source: triage
        fields: [search_targets, affected_areas]
      - source: clarify
        fields: [requirements]
        fallback: "Original user request"
    outputs:
      what_found: { type: object }
      how_it_works: { type: string, max_length: 500 }
      constraints: { type: object }
      gaps: { type: object }
    parallel:
      strategy: per-area
      max: 3
    timeout: 5m
    retry:
      max_attempts: 1
      on: [timeout, rate_limit]

  - id: gate
    type: reasoning
    description: "Review research and resolve remaining ambiguities"
    depends_on: [research]
    inputs:
      - source: research
        fields: [what_found, constraints, gaps]
    outputs:
      resolved_requirements: { type: string }
    skip_if: "{{ stages.research.outputs.gaps | length }} == 0"

  - id: plan
    type: agent
    agent: architect
    depends_on: [gate, triage]
    inputs:
      - source: triage
        fields: [complexity, independent_areas]
      - source: gate
        fields: [resolved_requirements]
      - source: research
        fields: [what_found, constraints]
        via: file-reference
    outputs:
      summary: { type: string }
      approaches: { type: list }
      changes: { type: list }
      parallelization_strategy: { type: object }
      acceptance_criteria: { type: list }
    parallel:
      strategy: per-area
      condition: "{{ stages.triage.outputs.independent_areas | length }} > 1"
    conditional_approach:
      simple: 1
      default: 3

  - id: plan-approval
    type: approval
    depends_on: [plan]
    inputs:
      - source: plan
        fields: [summary, approaches, changes, parallelization_strategy]

  - id: implement
    type: agent
    agent: developer
    depends_on: [plan-approval]
    inputs:
      - source: plan
        fields: [changes, parallelization_strategy, acceptance_criteria]
    outputs:
      changes_made: { type: list }
      issues_encountered: { type: list }
    retry:
      max_attempts: 2
      on: [build_failure, test_failure]
    on_failure:
      action: report
      block_dependents: true

  - id: verify
    type: agent
    agent: reviewer
    depends_on: [implement]
    inputs:
      - source: plan
        fields: [acceptance_criteria]
      - source: implement
        fields: [changes_made]
        via: file-reference
    outputs:
      status: { type: enum, values: [PASS, FAIL, PASS_WITH_WARNINGS] }
      issues: { type: list }
    on_failure:
      action: retry-from
      stage: implement
      max_retries: 2

  - id: document
    type: agent
    agent: documenter
    depends_on: [verify]
    condition: "{{ stages.verify.outputs.status }} != FAIL"
    inputs:
      - source: plan
        fields: [summary, changes]
      - source: implement
        fields: [changes_made]
    optional: true
    gate: approval

snapshots:
  max_size: 2KB
  overflow: file-reference
  stream_threshold: 500B
  compression: hybrid

cache:
  dir: .lineup/.cache/
  key: "{{ task_prompt }}+{{ stages.triage.outputs_hash }}"
  format: yaml

lifecycle:
  ephemeral_dir: .lineup/.ephemeral/
  cleanup: after_verify
  persist:
    - implement (code changes)
    - document (documentation files)
```

#### Stage types

| Type | Who executes | Description |
|---|---|---|
| `builtin` | CLI | No LLM needed. File I/O, detection, setup. |
| `reasoning` | LLM (orchestrator) | The orchestrator itself reasons. Used for triage, clarify, gate. |
| `agent` | LLM (spawned agent) | CLI builds the prompt, LLM agent executes. |
| `approval` | CLI + User | CLI presents output, waits for user approval via the host's question primitive. |

#### Input sources

Each stage declares typed inputs from upstream stages:

```yaml
inputs:
  - source: triage
    fields: [complexity, search_targets]
  - source: research
    fields: [what_found, constraints]
    via: file-reference        # force file reference even if small
    fallback: "No research"    # use if source was skipped
```

The CLI extracts these fields from cached upstream outputs. If a field exceeds `stream_threshold`, it writes it to `.lineup/.ephemeral/` and constructs a file reference instead.

#### Parallelism

```yaml
parallel:
  strategy: per-area        # spawn one agent per affected area
  max: 3                    # cap parallel spawns
  condition: "{{ stages.triage.outputs.independent_areas | length }} > 1"
```

The CLI resolves `condition` expressions. If true, it spawns `min(areas, max)` agents in parallel, each scoped to one area.

#### Error recovery

```yaml
retry:
  max_attempts: 2
  on: [timeout, rate_limit, build_failure]
  backoff: exponential     # 2s, 4s, 8s

on_failure:
  action: retry-from       # restart from a specific stage
  stage: implement
  max_retries: 2
```

Error codes (matching the taxonomy from the resilience roadmap):

| Code | Category | Recovery |
|---|---|---|
| `timeout` | transient | retry with backoff |
| `rate_limit` | transient | retry with backoff |
| `build_failure` | agent output | retry same stage |
| `test_failure` | agent output | retry same stage |
| `malformed_output` | agent output | retry with schema guidance |
| `context_overflow` | system | compress + retry |
| `tool_unavailable` | system | retry without tool |
| `agent_spawn_failed` | infrastructure | retry with backoff |
| `data_corruption` | safety | abort |

#### Expression language

`condition:` and `skip_if:` use a simple expression language:

- `{{ stages.<id>.outputs.<field> }}` — reference a stage output
- `{{ stages.<id>.outputs.<field> | length }}` — array length
- `{{ hash(task_prompt + stages.triage.outputs) }}` — hash computation
- Comparisons: `==`, `!=`, `>`, `<`, `>=`, `<=`
- Boolean operators: `and`, `or`, `not`
- String contains: `contains(field, "value")`

The CLI evaluates expressions at runtime. The LLM never sees them.

### State Machine

```
                    ┌─────────┐
                    │ PENDING │
                    └────┬────┘
                         │ start
                         ▼
                    ┌─────────┐
              ┌────▶│ RUNNING │◀────┐
              │     └──┬───┬──┘     │
              │        │   │        │
              │  skip  │   │ error  │ retry
              │        ▼   ▼        │
              │  ┌────────┐ ┌───────┴──┐
              │  │SKIPPED │ │ FAILED   │
              │  └────────┘ └──────────┘
              │        │        │
              │        │        │ max retries exceeded
              │        │        ▼
              │        │   ┌─────────┐
              │        │   │ ABORTED │
              │        │   └─────────┘
              │        │
              └────────┤ complete
                       ▼
                  ┌──────────┐
                  │COMPLETE  │
                  └──────────┘
```

State is persisted to `.lineup/.cache/pipeline-state.yaml`:

```yaml
run_id: a3f2k9
task_hash: e4b2c1a8f7d3
started_at: "2026-04-12T18:30:00Z"
completed_at: null
current_stage: research
stages:
  triage:
    state: complete
    started_at: "2026-04-12T18:30:00Z"
    completed_at: "2026-04-12T18:30:02Z"
    cache_file: "0-triage-e4b2c1a8f7d3.yaml"
    output_hash: "f1a2b3c4d5e6"
  research:
    state: running
    started_at: "2026-04-12T18:30:03Z"
    parallel:
      - area: auth
        agent_id: researcher-auth-a3f2k9
        state: running
      - area: api
        agent_id: researcher-api-a3f2k9
        state: complete
        cache_file: "2-research-api-e4b2c1a8f7d3.yaml"
```

### Init Sequence (CLI-driven)

The init sequence currently in `init.core.md` (363 lines) becomes CLI code:

```typescript
// cli/src/lib/init.ts

export async function runInit(ctx: RunContext): Promise<InitResult> {
  // 1. Load and validate agent overrides
  const overrides = await loadOverrides(ctx.overridesDir);

  // 2. Memory migration (pure file I/O)
  await migrateMemory(ctx.projectPath, ctx.memoryDirs);

  // 3. Tactic discovery and inlining (algorithmic)
  const tactic = await resolveTactic(ctx.tacticsDir, ctx.builtinTactics, ctx.tacticArg);
  if (tactic) {
    const expanded = inlineTacticRefs(tactic, /* cycle detection set */ new Set());
    return { workflow: expandedToWorkflow(expanded) };
  }

  // 4. Teams detection (check tool availability)
  ctx.teamsAvailable = await detectTeams();

  // 5. Ollama detection (check config + MCP server)
  ctx.ollamaAvailable = await detectOllama(ctx.ollamaConfigPath);

  return { workflow: await loadWorkflow(ctx.workflowPath) };
}
```

### Prompt Builder

The CLI constructs agent prompts instead of the LLM:

```typescript
// cli/src/lib/prompt-builder.ts

export function buildSpawnPrompt(
  role: AgentRole,
  agentDef: AgentDefinition,
  snapshot: StageSnapshot,
  config: SpawnConfig
): string {
  const parts: string[] = [];

  // Base instructions (from agents/<role>.md body)
  parts.push(agentDef.body);

  // Conditional Ollama appendix
  if (config.ollamaAvailable) {
    const appendix = readFileSync(`${config.agentsDir}/${role}-ollama.md`);
    parts.push(`---\n${appendix}`);
  }

  // Task-specific context
  if (snapshot.isFileReference) {
    parts.push(`\nRead ${snapshot.filePath} for your input context.`);
  } else {
    parts.push(`\n## Input\n${snapshot.content}`);
  }

  // Custom prompt from workflow stage
  if (config.customPrompt) {
    parts.push(`\n## Task Instructions\n${config.customPrompt}`);
  }

  return parts.join('\n\n');
}
```

### Host Integration

The `lineup run` command is host-agnostic. It outputs structured messages that the orchestrator skill reads:

```
LINEUP:stage:start id=research
LINEUP:stage:input type=file-reference path=.lineup/.ephemeral/snapshot-0-2-e4b2.yaml
LINEUP:stage:spawn agent=researcher model=haiku prompt=<built by CLI>
LINEUP:stage:output status=complete cache=.lineup/.cache/2-research-e4b2.yaml
LINEUP:stage:complete id=research duration=45s
```

The skill prompt becomes a thin adapter that reads these messages and calls the appropriate host primitives (Agent tool, AskUserQuestion, etc.).

For Claude Code Teams mode:
```
LINEUP:teams:create name=lineup-a3f2k9
LINEUP:teams:spawn team=lineup-a3f2k9 name=researcher-auth-a3f2k9 model=haiku
LINEUP:teams:shutdown name=researcher-auth-a3f2k9
```

### Relationship to Existing Architecture

```
.lineup-core/
  workflows/                     # NEW: declarative pipeline definitions
    full-pipeline.yaml           # replaces stages-*.core.md pipeline structure
    quick-fix.yaml               # lightweight workflow
  skills/
    kick-off/
      core.md                    # SIMPLIFIED: thin adapter that calls `lineup run`
      init.core.md               # REMOVED: init logic moves to CLI
      stages-1-3.core.md         # REMOVED: stage structure in workflow YAML
      stages-4-5.core.md         # REMOVED
      stages-6-7.core.md         # REMOVED: lifecycle in workflow YAML
  hosts/
    claude.json                  # EXTENDED: add workflow-related vars
    codex.json
    opencode.json

agents/
  researcher.md                  # UNCHANGED: agent instructions stay
  researcher-ollama.md           # UNCHANGED
  architect.md                   # UNCHANGED
  ...

cli/src/
  commands/
    run.ts                       # NEW: `lineup run` command handler
  lib/
    init.ts                      # NEW: init sequence (overrides, migration, tactic)
    workflow.ts                  # NEW: workflow YAML parser and validator
    state-machine.ts             # NEW: stage state machine
    snapshot.ts                  # NEW: snapshot builder, streaming, compression
    prompt-builder.ts            # NEW: agent prompt construction
    expression.ts                # NEW: condition/skip_if expression evaluator
    cache.ts                     # NEW: cache read/write/hash
    lifecycle.ts                 # NEW: ephemeral file management, cleanup
    runner.ts                    # NEW: stage execution engine
  schemas/
    yaml/
      workflow.schema.json       # NEW: workflow YAML schema
```

### Migration Path

#### Phase 1: Schema and Parser (low risk)

1. Define `workflow.schema.json` in `cli/schemas/yaml/`
2. Add `parseWorkflowYaml()` to validation.ts
3. Add `generate:check` verification for workflow files
4. No behavioral changes — purely additive

#### Phase 2: Canonical Workflow (medium risk)

1. Extract the pipeline structure from `stages-*.core.md` into `.lineup-core/workflows/full-pipeline.yaml`
2. Keep the stage files as documentation (they describe *how* each stage works, not *what* the pipeline is)
3. Add `lineup run --dry-run` that parses the workflow and outputs the stage plan without executing

#### Phase 3: CLI Runtime (high effort, high impact)

1. Implement the state machine, snapshot builder, cache manager, and prompt builder in `cli/src/lib/`
2. Implement `lineup run` as a command that executes the workflow
3. The CLI outputs structured messages that the orchestrator skill reads
4. The orchestrator skill becomes a thin adapter (~50 lines) that translates CLI messages to host primitives

#### Phase 4: Orchestrator Simplification (medium effort)

1. Replace the full orchestrator prompt (~300 lines) with a thin adapter (~50 lines)
2. The adapter reads CLI messages and calls Agent/AskUserQuestion/SendMessage
3. All mechanical instructions are removed from the prompt
4. The LLM only sees task-specific prompts for reasoning stages

#### Phase 5: Tactic Migration (low effort)

1. Upgrade tactic schema to support `workflow_ref: full-pipeline` with stage selection
2. Existing tactics continue to work (backward compatible)
3. New tactics can use the full workflow format

### Token Savings Estimate

| Component | Before | After | Savings |
|---|---|---|---|
| Orchestrator core.md | 15.5 KB (~3,900 tokens) | ~1.5 KB (~375 tokens) | ~3,525 tokens |
| init.core.md | 17.6 KB (~4,400 tokens) | 0 (CLI code) | ~4,400 tokens |
| stages-1-3.core.md | 4.9 KB (~1,225 tokens) | 0 (workflow YAML) | ~1,225 tokens |
| stages-4-5.core.md | 6.9 KB (~1,725 tokens) | 0 (workflow YAML) | ~1,725 tokens |
| stages-6-7.core.md | 4.4 KB (~1,100 tokens) | 0 (workflow YAML) | ~1,100 tokens |
| Execution overhead | ~5,000 tokens | ~500 tokens | ~4,500 tokens |
| **Total per run** | **~18,875 tokens** | **~875 tokens** | **~18,000 tokens** |

The orchestrator context drops from ~47 KB of instruction text to ~1.5 KB of adapter instructions. The workflow YAML (~4 KB) is read by the CLI, never by the LLM.

### Risks

1. **Complexity in the CLI**: The runtime engine adds significant TypeScript code. Bugs in snapshot construction or expression evaluation could cause pipeline failures. Mitigation: comprehensive tests, `--dry-run` mode, fallback to prose-based execution.

2. **Host coupling**: Each host (Claude, Codex, OpenCode) has different tool primitives. The CLI must output messages that each host's adapter can translate. Mitigation: the existing host adapter system already handles this — extend it with runtime-specific message types.

3. **Workflow format churn**: The YAML format will evolve. Mitigation: `apiVersion: lineup/v1` field supports future format changes. The CLI validates against the schema before execution.

4. **Loss of flexibility**: Prose instructions allow the LLM to adapt. A rigid workflow may not handle edge cases. Mitigation: `condition:` expressions and `skip_if:` clauses cover known variations. Unknown cases fall back to LLM reasoning.

5. **Migration complexity**: Existing projects have tactics in the current format. Mitigation: Phase 5 is backward compatible — old tactics work alongside new workflows.

### Alternatives Considered

1. **Pure prompt optimization** (current approach): Continue compressing prose instructions. Rejected because the fundamental problem is that the LLM does mechanical work, not that the instructions are too long.

2. **Code-first pipeline (Dagger-style)**: Define pipelines in TypeScript instead of YAML. Rejected because YAML is more readable by LLM agents and tactic authors, and aligns with the existing tactic format.

3. **External orchestration service (Temporal-style)**: Run a separate server that manages pipeline state. Rejected because Lineup runs locally, not as a service. The CLI is the right granularity.

4. **No runtime, just better prompts**: Improve the orchestrator prompt to be more deterministic. Rejected because prose is inherently non-deterministic — the LLM will interpret instructions differently across runs.

5. **Task Foundry as the runtime engine** (see Appendix B): Instead of building a TypeScript runtime from scratch, use Task Foundry's existing Rust runtime (`task-foundry`) as the mechanical execution engine, with Lineup providing the bridge between TF's subprocess contracts and the LLM hosts. This is the most radical alternative but potentially the most efficient.

### Open Questions

1. **Expression language scope**: Should the condition language be a full expression evaluator (JMESPath, JsonPath) or a minimal DSL? Recommendation: start minimal, expand as needed.

2. **Snapshot compression**: Should the CLI attempt mechanical compression (YAML key extraction, length truncation) and only fall back to LLM when that fails? Recommendation: yes — mechanical compression handles ~70% of cases.

3. **Parallel agent output merging**: When parallel architects produce conflicting plans, should the CLI detect conflicts mechanically (file path overlap) and only involve the LLM for resolution? Recommendation: yes — mechanical detection is already described in stages-4-5.core.md.

4. **Tactic backward compatibility**: Should the CLI support both old-format tactics (`stages[]` with `type`/`agent`) and new-format workflow references? Recommendation: yes, indefinitely — old tactics are a subset of the workflow format.

5. **`lineup run` invocation model**: Should the CLI be invoked once for the entire pipeline (long-running process) or once per stage (stateless invocations)? Recommendation: long-running process with state persistence — matches the session model of Claude Code and Codex.

---

## Appendix A: Task Foundry — Reusable Components

[Task Foundry](https://github.com/izantech/task-foundry) is a sibling project: a **Rust-based orchestration runner** for manifest-driven multi-agent pipelines. It implements the same design philosophy as this RFC — mechanical runtime orchestrating LLM-driven stages — in a different domain (file-scoped diff-based code changes via subprocess LLM calls).

Both projects share a core thesis: **the runtime should be mechanical, deterministic, and typed; the LLM should only handle reasoning**. This creates direct opportunities for knowledge transfer and code reuse.

### Architecture Comparison

```
Task Foundry (Rust)                     Lineup Runtime (TypeScript, proposed)
──────────────────────                  ─────────────────────────────────────
resolve_workspace()                     runInit() (overrides, migration, tactic)
create_attempt_workspace()              .lineup/.ephemeral/ + .lineup/.cache/
scope_selector (LLM or heuristic)       triage stage (LLM builtin)
planner → TaskManifest YAML             architect → plan YAML (agent stage)
build_execution_waves()                 DAG scheduler (same algorithm)
workers → unified diffs                 developer agents → code changes
run_command_hooks()                     verify stage + project hooks
validator → OK/FAIL                     reviewer → PASS/FAIL/PASS_WITH_WARNINGS
apply_back_files()                      lifecycle persist list
retry with RetryContext                 state machine FAILED → retry with context
```

### Concept Mapping

| Task Foundry | Lineup RFC | Overlap |
|---|---|---|
| `TaskManifest` (planner output) | Workflow YAML (static definition) | Both are versioned DAGs with typed I/O. TF manifest is runtime-generated by planner; Lineup workflow is pre-defined. |
| `TaskSpec.depends_on` | Stage `depends_on` | 1:1 mapping. Both declare DAG edges by ID. |
| `TaskSpec.read_files` / `write_files` | Stage `inputs` / `outputs` with `source` refs | Same purpose, different abstraction. TF is file-centric; Lineup is data-field-centric. |
| `RetryContext` | State machine `FAILED` transition + cache | Both carry previous outputs + failure reason to the next attempt. |
| `WorkspaceSnapshot` / `ScopedFile` | Snapshot Builder + stream threshold | Both materialize context for downstream roles. TF uses string snippets; Lineup adds compression and file-referencing. |
| `ValidationResult` `{status, reason}` | Stage output `status` field | Near-identical. TF: OK/FAIL. Lineup: PASS/FAIL/PASS_WITH_WARNINGS. |
| `PipelineResult` | Pipeline state file | Both carry run_id, per-stage results, output location. |
| `AttemptFailure::Validation` vs `Fatal` | Error taxonomy (retryable vs abort) | TF distinguishes retryable from fatal. Lineup's RFC taxonomy refines this further. |

### Components to Port (Priority Order)

#### P0: Wave Scheduler (`pipeline.rs:736-811`)

The single most valuable algorithm. Topological sort of `depends_on` edges into execution waves with read/write hazard detection and concurrency limits.

**Port to**: `cli/src/lib/runner.ts`

**Adaptation**: Replace `read_files`/`write_files` hazard detection with typed `inputs`/`outputs` field conflict detection. For Lineup's `parallel.strategy: per-area`, each area gets a separate scope, so hazards are pre-resolved.

**Estimated effort**: 2-3 days.

#### P0: Attempt/Retry Loop (`pipeline.rs:36-161`)

The outer loop: plan → execute waves → validate → construct retry context → retry or finish.

**Port to**: `cli/src/lib/runner.ts`

**Key design decision**: Separate `AttemptFailure::Validation` (retryable with context) from `AttemptFailure::Fatal` (abort). Lineup's error taxonomy maps directly:
- `timeout`, `rate_limit` → retryable
- `build_failure`, `test_failure` → retryable from implement stage
- `malformed_output` → retryable with schema guidance
- `data_corruption` → fatal

**Estimated effort**: 1 day.

#### P0: Manifest/Workflow Validation (`pipeline.rs:623-734`)

Version gating, DAG integrity (cycle detection, dangling references), field validation, path safety.

**Port to**: `cli/src/lib/workflow.ts`

Lineup already has AJV validation in `cli/src/lib/validation.ts`. Extend with DAG-specific checks.

**Estimated effort**: 1-2 days.

#### P1: LLM Output YAML Repair (`pipeline.rs:509-621`)

Repairs common YAML issues from LLM output: unquoted colons, bare strings, block scalar detection.

**Port to**: `cli/src/lib/llm-output.ts` (new utility)

Lineup agents produce structured YAML outputs that may have the same formatting issues. A shared repair utility prevents validation failures on otherwise valid agent output.

**Estimated effort**: 1 day.

#### P1: Artifact Persistence Protocol

TF persists every intermediate artifact (planner input/output, worker I/O per wave, validator I/O, attempt metadata) for debugging and retry.

**Port to**: `cli/src/lib/cache.ts` + `cli/src/lib/lifecycle.ts`

Lineup's `.lineup/.cache/` and `.lineup/.ephemeral/` should follow the same discipline. Every stage input and output is persisted, not just the final result. This enables `--from-stage` resumption and post-mortem debugging.

**Adopted naming convention**: `{stage-id}-{hash}.yaml` for cache, `snapshot-{from}-{to}-{hash}.yaml` for ephemeral.

**Estimated effort**: 1 day.

#### P1: Typed Inter-Role Contracts (`docs/contracts.md`)

TF defines precise JSON/YAML schemas for each role's input and output. The planner receives `PlannerInput` JSON and emits `TaskManifest` YAML. The worker receives `TaskSpec` YAML and emits a unified diff. The validator receives `ValidationRequest` JSON and emits `ValidationResult` JSON.

**Port to**: `cli/schemas/yaml/workflow.schema.json` + stage-specific schemas

Lineup's workflow YAML already declares typed `inputs`/`outputs` per stage. The missing piece is runtime enforcement — the CLI validates that agent output matches the declared output schema before writing to cache.

**Estimated effort**: 2 days.

#### P2: Supporting Patterns

| Pattern | Source | Target | Effort |
|---|---|---|---|
| Concurrency semaphore | `pipeline.rs:820` (tokio::Semaphore) | `cli/src/lib/runner.ts` (p-limit or similar) | 0.5 days |
| Run ID generation | `pipeline.rs:500-507` | `cli/src/lib/run-context.ts` | 0.5 days |
| Lossy UTF-8 output handling | `llm.rs:113-114` | Process output reading | 0.5 days |
| Workspace inventory | `workspace.rs:31-45` | Scope selection builtin (optional) | 1 day |

### Design Decisions to Adopt from Task Foundry

1. **Manifest-validated-before-execution**: TF validates the entire manifest before starting any worker. Lineup should validate the workflow YAML + all expression references before starting any stage.

2. **Centralized result application**: TF workers never write files directly — the runner applies diffs centrally. Lineup should have the CLI centrally manage ephemeral files and cache writes, not delegate to agents.

3. **Scope selection as a first-class phase**: TF's scope selector limits context before planning. Lineup's triage stage already produces `search_targets`. The RFC could formalize this as a `builtin` stage type.

4. **Command hooks for post-stage validation**: TF runs external commands (lint, test) after changes, passes results to the validator. Lineup's verify stage could support a `command_hooks` config in the workflow YAML.

5. **Non-blocking hook failures**: TF command hook failures are evidence for the validator, not automatic blockers. Lineup's reviewer should see test/lint results as input, not as a hard gate.

6. **Retry context propagation**: TF's `RetryContext` carries the full previous attempt's outputs and the validator's reason to the next attempt. This is more structured than Lineup's current cache-based retry. Adopt the explicit context object.

### What NOT to Port

| Task Foundry Component | Why Not Applicable |
|---|---|
| Git worktree isolation (`isolation.rs`, 324 lines) | Lineup agents operate via host file tools, not subprocess patches. Host platforms provide sandboxing. |
| Diff normalization (`patch.rs`, 1,164 lines) | Lineup developers write files directly, not via diff generation and `git apply`. The entire normalization pipeline is TF-specific. |
| Subprocess execution layer (`llm.rs`) | Lineup invokes agents through host APIs (Agent tool, subagent). Different transport model. |
| Heuristic scope selection (`workspace.rs:62-126`) | Lineup's triage stage always runs with LLM reasoning. Keyword-based scoring is unnecessary. |
| `OutputFormat::UnifiedDiff` hardcode | Lineup uses structured YAML outputs with typed fields, not diffs. |
| `FailureMode` all-FAIL constraint | Lineup's error taxonomy is more nuanced with configurable per-stage retry policies. |

### Proposed Task Foundry Integration

**Option A: Knowledge transfer only (recommended for v1)**
- Port the wave scheduler, retry loop, and validation patterns as TypeScript implementations
- Adopt the design decisions listed above
- No package dependency between the two projects

**Option B: Shared library**
- Extract common patterns (DAG scheduler, typed contracts, retry logic) into a shared `@izantech/pipeline-core` package
- Both Task Foundry (via WASM or NAPI) and Lineup CLI depend on it
- Higher upfront cost, long-term consistency benefit

**Option C: Task Foundry as execution backend**
- Lineup's CLI emits workflow YAML, Task Foundry's Rust runner executes it
- Lineup provides the agent definitions and prompts, Task Foundry provides the runtime
- Highest integration, requires TF to support Lineup's agent model (not just diff-based workers)

Recommendation: **Option A for the initial implementation**. The wave scheduler and retry loop are the highest-value ports (P0). Revisit Option B once both projects have stable v1 formats.

---

## Appendix B: Task Foundry as the Runtime Engine (Alternative Architecture)

**Status**: Active investigation
**TL;DR**: Instead of building a TypeScript runtime from scratch, Task Foundry becomes the mechanical execution engine and Lineup becomes the bridge between TF's subprocess contracts and the LLM hosts.

### The Insight

The RFC proposes building a TypeScript runtime engine (~4,800 lines of equivalent logic) that does exactly what Task Foundry already does in Rust:
- DAG-based pipeline scheduling with wave execution
- Retry loop with typed retry context
- Manifest validation with version gating and cycle detection
- Artifact persistence for every stage I/O
- Concurrency control with semaphores
- Timeout enforcement
- Cleanup orchestration

**Task Foundry already IS the runtime the RFC proposes to build.** The question is not "should we port 4,800 lines of Rust to TypeScript?" but "how does Lineup become the bridge layer?"

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Lineup (bridge layer)                                           │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                    │
│  │ Host Adapters     │    │ Agent Definitions │                   │
│  │ (claude/codex/    │    │ (researcher,      │                   │
│  │  opencode JSON)   │    │  architect, etc.)  │                   │
│  └────────┬─────────┘    └────────┬─────────┘                    │
│           │                       │                               │
│           ▼                       ▼                               │
│  ┌──────────────────────────────────────────┐                    │
│  │ Prompt + Adapter Generator                │                   │
│  │                                           │                   │
│  │ Generates per-role:                       │                   │
│  │  - System prompts (from agents/*.md)      │                   │
│  │  - Host adapter scripts (shell wrappers)  │                   │
│  │  - TF config YAML (from workflow YAML)    │                   │
│  │  - Tactic → TF manifest mapping           │                   │
│  └──────────────────────────────────────────┘                    │
│           │                                                      │
│           │ generates                                            │
│           ▼                                                      │
│  ┌──────────────────┐    ┌──────────────────┐                    │
│  │ Adapter Scripts   │    │ TF Config YAML   │                   │
│  │ (per host, per    │    │ (lineup pipeline  │                   │
│  │  role)            │    │  as TF manifest)  │                   │
│  └────────┬─────────┘    └────────┬─────────┘                    │
└───────────┼───────────────────────┼──────────────────────────────┘
            │                       │
            │ invoked by            │ read by
            ▼                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Task Foundry (Rust runtime — unchanged)                          │
│                                                                  │
│  main.rs ──▶ config.rs ──▶ pipeline.rs                          │
│                          ├─ validate_manifest()                  │
│                          ├─ build_execution_waves()              │
│                          ├─ execute workers (parallel, bounded)  │
│                          ├─ run_command_hooks()                  │
│                          ├─ validate output                      │
│                          └─ retry with RetryContext              │
│                                                                  │
│  llm.rs ──▶ execute_command() ──▶ adapter scripts ──▶ LLMs      │
│  isolation.rs ──▶ worktree management                            │
│  patch.rs ──▶ diff normalization + git apply                     │
│  workspace.rs ──▶ file inventory + scope selection               │
│  models.rs ──▶ typed contracts (TaskManifest, TaskSpec, etc.)    │
└──────────────────────────────────────────────────────────────────┘
```

### Role Mapping: Task Foundry → Lineup

| Task Foundry Role | Lineup Equivalent | TF stdin → Lineup prompt | TF stdout ← Lineup output |
|---|---|---|---|
| **Scope Selector** | Stage 0: Triage (builtin) | `ScopeSelectorInput` JSON → triage prompt with workspace tree | `{"selected_files": [...]}` from triage `search_targets` |
| **Planner** | Stage 4: Plan (architect agent) | `PlannerInput` JSON → architect prompt with research findings | `TaskManifest` YAML from architect plan output |
| **Worker** | Stage 5: Implement (developer agent) | `TaskSpec` YAML → developer prompt with plan changes | Unified diff from developer implementation |
| **Validator** | Stage 6: Verify (reviewer agent) | `ValidationRequest` JSON → reviewer prompt with plan + diffs | `{"status":"OK/FAIL","reason":"..."}` from review |

Lineup stages that don't map to TF roles (Clarify, Clarification Gate, Document) would be **pre/post-pipeline phases** managed by the Lineup bridge, not by TF's runner.

### The Bridge: How Lineup Generates TF Adapters

Instead of TF's hand-maintained shell scripts (`scripts/run_model_adapter.sh`, `scripts/claude_planner.sh`), Lineup generates them at install time using the existing canonical + adapter model:

```
.lineup-core/
  adapters/                          # NEW: TF adapter templates
    run-model-adapter.sh.core        # Shared adapter template with {{HOST}} vars
    scope-selector.sh.core           # Per-role wrapper template
    planner.sh.core
    worker.sh.core
    validator.sh.core
  prompts/                           # NEW: TF system prompt templates
    scope-selector-system.core.txt   # Triage prompt template
    planner-system.core.txt          # Architect prompt template  
    worker-system.core.txt           # Developer prompt template
    validator-system.core.txt        # Reviewer prompt template
```

`lineup install --host claude` generates:
- Adapter scripts with Claude-specific invocation (`claude --print --bare`)
- System prompts with agent body from `agents/*.md` + conditional Ollama appendices
- A TF config YAML tailored to the host

### Workflow YAML → Task Foundry Config

The Lineup workflow YAML becomes a TF config generator:

```yaml
# Lineup workflow YAML (what the user sees)
apiVersion: lineup/v1
kind: Workflow
name: full-pipeline

stages:
  - id: triage
    type: builtin          # Maps to TF scope_selector
  - id: clarify
    type: reasoning        # Pre-pipeline: Lineup handles directly
  - id: research
    type: agent
    agent: researcher      # Pre-pipeline: Lineup handles directly
  - id: gate
    type: reasoning        # Pre-pipeline: Lineup handles directly
  - id: plan
    type: agent
    agent: architect       # Maps to TF planner
  - id: implement
    type: agent
    agent: developer       # Maps to TF worker
  - id: verify
    type: agent
    agent: reviewer        # Maps to TF validator
  - id: document
    type: agent
    agent: documenter      # Post-pipeline: Lineup handles directly
```

Lineup's `lineup run` command would:
1. Run pre-pipeline stages (triage, clarify, research, gate) using host-native agent spawning
2. Generate a TF config YAML mapping plan/implement/verify to TF roles
3. Invoke `task-foundry --config <generated-config.yaml> --input-file <request.txt>`
4. TF executes the core pipeline with Lineup-generated adapter scripts
5. Run post-pipeline stages (document) using host-native agent spawning
6. Clean up

### What Lineup Gains

| Gain | Detail |
|---|---|
| **No runtime to build** | ~4,800 lines of Rust already implement the wave scheduler, retry loop, validation, artifact persistence, isolation, and cleanup. No TypeScript port needed. |
| **Proven isolation** | TF's git worktree model provides hard isolation for implementation. Failed attempts leave the canonical workspace untouched. This is stronger than Lineup's current "trust the agent" model. |
| **OS-level timeout enforcement** | TF kills subprocesses after `timeout_secs`. No reliance on prompt engineering to limit agent runtime. |
| **Deterministic testability** | TF's mock adapters provide instant, deterministic responses. The entire pipeline can be tested end-to-end without an LLM. |
| **Diff-based safety** | Workers produce diffs, not direct file mutations. The runner applies diffs centrally with `git apply`. Malformed output is rejected before touching the workspace. |
| **Artifact forensics** | TF persists every intermediate artifact (planner input/output, worker I/O per wave, validator I/O) to `.runner-output/`. Full post-mortem debugging. |
| **Hazard detection** | TF's read/write hazard analysis prevents parallel workers from clobbering the same files. Lineup currently relies on the architect's parallelization strategy being correct. |
| **Typed contracts** | Every role has a strict stdin/stdout schema enforced by the Rust core. No "the agent output was slightly wrong" failures. |

### What Lineup Gives Up (and Mitigations)

| Loss | Mitigation |
|---|---|
| **Host-native agent spawning** (Agent tool, teams mode) | Use TF's subprocess model for plan/implement/verify. Keep host-native spawning for triage, clarify, research, gate, document (where tool access matters more than isolation). |
| **Memory continuity** (per-agent project/user memory) | Pass relevant memory as context in the adapter system prompt. TF's scope selector can pre-load agent memory for the task. |
| **Effort-based model selection** | Map Lineup's triage complexity to TF's `MODEL` and `REASONING` env vars. The adapter script receives effort level from the config. |
| **Lazy agent loading** | Only generate adapter scripts for roles the pipeline tier actually uses. Lineup's generator handles this at install time. |
| **Snapshot streaming** | TF already materializes context via `ScopedFile` snippets. The workspace scope selector replaces Lineup's snapshot builder for the TF-managed stages. |
| **In-process state** | TF's state lives in `.runner-output/` and the Rust process. The Lineup bridge reads TF's artifact files for post-pipeline stages. |
| **Teams mode** (tmux panes) | Not applicable to TF's subprocess model. Parallel workers are managed by TF's semaphore, not by team teammates. |

### Implementation Path

#### Phase 1: Bridge Proof of Concept (1-2 weeks)

1. Create `.lineup-core/adapters/` with templates for the 4 TF roles
2. Create `.lineup-core/prompts/` with system prompt templates derived from `agents/*.md`
3. Add a `lineup generate-adapters` command that produces TF-compatible adapter scripts + config YAML
4. Test: `task-foundry --config <lineup-generated-config.yaml>` runs successfully with Lineup's adapter scripts

#### Phase 2: Workflow YAML → TF Config Generator (1-2 weeks)

1. Add a `lineup run` command that:
   - Parses the workflow YAML
   - Runs pre-pipeline stages (triage, clarify, research, gate) via host-native agents
   - Generates a TF config from the plan/implement/verify stages
   - Invokes `task-foundry`
   - Runs post-pipeline stages (document) via host-native agents
2. Map Lineup's agent definitions to TF system prompts at generation time

#### Phase 3: Integrated Install Flow (1 week)

1. `lineup install --host claude` generates TF adapter scripts alongside host skill files
2. `lineup install` optionally installs `task-foundry` binary (via `cargo install` or pre-built binary)
3. `lineup status` reports TF availability

#### Phase 4: Tactic Migration (1 week)

1. Lineup tactics generate TF configs with scoped stages
2. The `workflow_ref` concept maps to TF config composition
3. Backward compatible with existing tactics

### Comparison: Build vs Bridge

| Dimension | Build TypeScript Runtime (RFC main) | Bridge to Task Foundry (Appendix B) |
|---|---|---|
| **Implementation effort** | ~3-4 months (Phases 1-5) | ~5-8 weeks (Phases 1-4) |
| **Lines of new code** | ~4,000-5,000 TypeScript | ~1,000-1,500 TypeScript (bridge) + templates |
| **Runtime maturity** | New, unproven | TF's Rust runtime has integration tests, mock adapters, proven retry logic |
| **Isolation model** | `.lineup/.ephemeral/` files | Git worktrees with `git apply` (stronger) |
| **Parallel execution** | Must implement wave scheduler | TF already has DAG-based wave scheduling with hazard detection |
| **Testability** | Must build mock layer | TF's mock adapters already exist |
| **Host integration** | Deep (native agent spawning) | Hybrid (native for reasoning, subprocess for execution) |
| **Memory/effort/caching** | Full Lineup feature set | Must bridge via adapter scripts |
| **Distribution** | Single package | Two packages (`lineup` + `task-foundry`) |
| **Maintenance** | Lineup team owns runtime | Lineup team owns bridge; TF team owns runtime |

### Open Questions (specific to this alternative)

1. **TF distribution**: Should `task-foundry` be a dependency of `@izantech/lineup-cli` (installed automatically) or an optional peer dependency? Recommendation: optional, with `lineup run` detecting TF availability and falling back to the TypeScript runtime (RFC main) if not installed.

2. **Pre/post-pipeline stages**: How should Lineup manage stages that don't map to TF roles (clarify, research, gate, document)? Recommendation: Lineup runs these directly via host-native agent spawning, using TF only for the plan→implement→verify core.

3. **Tactic compatibility**: Should all tactics be convertible to TF configs, or only those with plan/implement/verify stages? Recommendation: start with the standard pipeline mapping. Tactics with non-standard stages remain Lineup-native.

4. **Diff-based output model**: TF workers produce unified diffs. Lineup developers currently write files directly. Should the Lineup adapter instruct developers to output diffs instead? Recommendation: yes for TF-managed stages. The developer agent prompt would include "output your changes as a unified diff" when running under TF.

5. **Error taxonomy alignment**: TF has `AttemptFailure::Validation` vs `Fatal`. Lineup's RFC proposes a richer taxonomy. Should TF's error model be extended, or should the bridge translate between the two? Recommendation: bridge translates. TF's binary classification is sufficient for the subprocess layer; Lineup's richer taxonomy lives in the bridge.

---

## Appendix C: External Architectural Review

**Reviewer**: ChatGPT (o3)
**Date**: 2026-04-12
**Verdict**: Prefer Option B (TF as runtime, Lineup as bridge) with unified run model

### Diagnosis Confirmation

The RFC's diagnosis is correct: too much pipeline behavior is executed "in prompt space." The `izan/improvements` branch is evidence of pressure in that direction — snapshot streaming, caching, cleanup, and effort-based model selection are all runtime responsibilities encoded as prose.

The hard truth: **we are already paying the complexity cost of a workflow engine** — just in the least testable, least deterministic form (LLM-followed prose). The stage caching rules already show contradictions: `--from-stage` restarts rely on cached outputs, but cache is marked "ephemeral" and cleaned at the end of every run. These two are in direct tension and will cause operational failures unless lifecycle semantics are formalized in code.

### Recommendation: Option B

**Prefer Option B as the primary path** with one constraint: **define and enforce a single canonical run model and artifact model across both halves from day one.**

Rationale:

1. **Implementation risk and calendar time**: Building a runtime engine for real-world orchestrations is about hard edges — retries, partial failures, artifacting, isolation, determinism, and debugging. TF already has these. Option A means rebuilding wave scheduling, hazard detection, retry envelopes, isolation, output normalization, and forensic artifacts in TypeScript. The moment you ship an executor without these properties, the runtime becomes "a faster way to get stuck."

2. **Maintenance burden and duplication**: Maintaining two workflow engines in parallel (TypeScript + Rust) is the highest-cost outcome. Option B consolidates the engine in one place and uses Lineup as the templating/bridge layer.

3. **User experience**: Option A can be "one CLI, one mental model." Option B introduces "TF does the mid-pipeline work." But that UX benefit is not worth the engineering and long-term correctness cost of building a second orchestrator for a small team. Option B's UX can be made coherent by presenting it as "Lineup Run = one pipeline; internally it delegates the execution engine for the heavy stages." TF's debug story (exact role payloads, normalized diffs, command hooks, validation records, apply-back records by attempt and wave) is far stronger than anything prompt-driven.

4. **Extensibility**: TF already validates manifests, normalizes diffs, enforces concurrency and hazard exclusion, and maintains a simple contract boundary for provider adapters. This is a better long-term base for real orchestration than a TypeScript runtime that still depends on an LLM to properly enact host primitives.

### Critical Findings

#### 1. The LLM/CLI control-plane boundary is the hard part

In host environments (Claude Code, Codex CLI, OpenCode), the CLI cannot directly "spawn an agent" or "ask a question." The LLM orchestrator must still act as the host-primitive dispatcher. Option A replaces "LLM follows large prose instructions" with "LLM follows a smaller protocol" — an improvement, but not determinism. Option B avoids this for the core stages by using TF's subprocess model, where the Rust runner invokes adapter scripts with hard stdin/stdout contracts.

#### 2. The seam in Option B is a product boundary, not just an implementation detail

Users will experience it through different logs, artifacts, and failure modes. This is manageable only if designed intentionally:

- **Single run ID** across both halves. TF already generates a `run_id` and writes output under a run directory. Lineup must adopt that run ID for everything in that pipeline execution.
- **Single artifact location.** Do not tolerate split conventions (`.lineup/.cache` vs `.runner-output`). Lineup should write pre-pipeline artifacts into TF's run directory.
- **Unified approval semantics.** Lineup waits for user approval after Plan. TF applies to canonical workspace on validation OK. Without reconciliation, TF will surprise users by applying before approval. Solution: add a "no-apply-back until approval" mode to TF, or run TF in a mode where apply-back is deferred.
- **Data model at the boundary.** Do not concatenate structured triage/research output into a string field for TF's `PlannerInput`. Either extend TF's input contract to accept structured Lineup artifacts, or pass a file reference that TF's planner adapter reads.

#### 3. The workflow YAML expression language is a slippery slope

GitHub Actions expressions started small and grew into a complex DSL with many edge cases. If Lineup needs only a small subset of conditions (`==`, `!=`, `>`, `length`, `contains`), keep it small and formalize it early. Do not let it become an undocumented DSL that users depend on.

The workflow YAML should also:
- **Subsume or explicitly map tactics.** Otherwise we maintain two declarative languages with overlapping capabilities.
- **Reference existing schemas rather than redeclaring types inline.** The CLI already has agent-output schemas. The workflow YAML should reference them, not duplicate them.
- **Define "stage skipped" semantics explicitly.** What does `inputs` see if the upstream stage is skipped? This must be specified, not left to the orchestrator's judgment (Windmill-style).
- **Represent fanout results.** The format must express "N subruns" and their structured outputs (parallel researchers, parallel architects).

#### 4. Concurrency will race under prompt-driven cleanup

`.lineup/.cache` and `.lineup/.ephemeral` with prompt-driven cleanup will break under concurrent runs. TF's per-run worktrees and per-run output directories already solve this. Any runtime we build must have the same.

#### 5. Token savings estimate is directionally correct but fragile

The ~18,000 token claim is plausible as a best-case reduction in orchestrator prompt overhead, but:

**Deflators (save less than expected):**
- Agent prompts don't disappear — spawned agents still need goal context, snapshots, and scaffolding.
- Some savings are already baked in by current snapshot discipline (Plan → Verify forwarding only acceptance criteria already saves 8-12k tokens).
- File references shift token load to downstream agents' context windows, they don't eliminate it.

**Inflators (save more than expected):**
- Eliminating whole mechanical instruction blocks (init sequence, memory migration, tactic discovery) removes both input tokens and reduces opportunities for LLM procedural drift.
- Structured artifacts and retry envelopes reduce "redo everything" loops on stage failure, with second-order token savings.

**Bottom line**: expect large savings in orchestrator overhead, but don't treat "18k per run" as a stable number. It varies by tier, host, and how much content is streamed to disk and re-ingested by agents.

### Missing Considerations the RFC Must Address

| Area | Gap | Required Action |
|---|---|---|
| **Testing strategy** | No testing plan for the runtime | Separate deterministic runtime logic tests (expression evaluator, cache keys, state transitions) from mock-LLM integration tests. Follow TF's mock adapter pattern. |
| **Operational CLI UX** | No CLI surface for debugging | Add `--resume`, `--rerun-stage`, `--show-artifacts`, and a way to view/validate intermediate outputs. Windmill's "test up to step" / "restart from step" is the benchmark. |
| **Unified artifact model** | Two separate artifact conventions | If Option B: Lineup writes pre-pipeline artifacts into TF's run directory. One place to look for everything. |
| **Model/tool selection policy** | No first-class stage-level config | The workflow YAML needs a way to express which model/tool profile a stage uses, with explicit defaults and override precedence. |
| **Security boundaries for cleanup** | Prompt-driven cleanup deletes files based on heuristics | TF's approach (isolated workspace + apply-back of explicitly declared files) should be the standard. |
| **Replay and determinism semantics** | No definition of "replay" in an LLM pipeline | Follow Temporal's model: deterministic orchestration + nondeterministic side effects via agents. Define what "retry" means: same prompt? cached output? record "what the model saw"? |
| **Schema governance** | Tactic schema requires `verification` but docs say it's optional | Once workflow YAML becomes "the contract," schema/doc drift becomes a major problem. Include a versioning policy and compatibility guarantees. |

### Amendments to the RFC

Based on this review, the following amendments should be applied:

1. **Recommend Option B as the primary path.** Option A remains a valid fallback if TF integration proves impractical, but should not be the default investment.

2. **Add "Unified Run Model" as a hard requirement.** Before any implementation:
   - Define the canonical run directory structure (one location for all artifacts across both halves)
   - Define run ID generation and propagation
   - Define approval semantics (no apply-back without explicit user approval)
   - Define data model at the Lineup/TF boundary (structured, not string-concatenated)

3. **Add "Testing Strategy" section.** Separate deterministic tests from mock-LLM integration tests. Require mock adapters for all roles before shipping.

4. **Add "Operational UX" section.** Define the CLI surface for debugging, resumption, and artifact inspection.

5. **Constrain the expression language.** Start with 5 operators (`==`, `!=`, `>`, `length`, `contains`). Document as a stable subset. Require RFC amendment to expand.

6. **Add concurrency safety as a hard requirement.** Per-run directories, collision-proof IDs, no shared mutable state between concurrent runs. TF's model is the baseline.

7. **Add security threat model.** Path traversal, symlink attacks, environment leakage, artifact poisoning, cleanup safety. The existing restricted YAML parsing is a good start but not sufficient for a runtime executor.

8. **Downgrade token savings from headline to estimate.** Replace "~18,000 tokens per run" with "significant orchestrator overhead reduction; actual savings vary by tier, host, and pipeline complexity."
