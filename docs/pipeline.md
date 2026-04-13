# Pipeline

## Pipeline Tiers

Not every task runs all stages. Triage classifies complexity and selects the appropriate tier:

| Tier | Stages | When used |
|------|--------|-----------|
| Full | 0–7 | Multi-module changes, unclear requirements, unfamiliar code |
| Lightweight | 0, 4–6 | Single-module changes with understood scope |
| Direct | Inline | Single-file fixes with explicit instructions |

## Model Assignment

Triage complexity drives model selection per agent role:

| Role | Simple | Moderate | Complex |
|------|--------|----------|---------|
| Researcher | Haiku | Sonnet | Sonnet |
| Architect | Sonnet | Sonnet | Opus |
| Developer | Haiku | Haiku | Sonnet |
| Reviewer | Sonnet | Sonnet | Sonnet |

User overrides act as a floor — they can upgrade but not downgrade below the effort-assigned level.

## Triage-Driven Optimizations

Stage 0 (Triage) produces a lightweight assessment that drives downstream behavior:

- **Research scoping**: Researchers receive concrete search targets (directories, file patterns, questions) from the triage assessment instead of deriving scope from scratch.
- **Conditional approach analysis**: Simple tasks get 1 approach in the Plan stage (no multi-approach comparison); moderate/complex tasks get 2-3.
- **Parallel architects**: When 2+ independent areas are detected, separate architect agents spawn in parallel. The orchestrator merges their outputs into a single master plan.
- **Effort-based model selection**: Triage complexity drives model assignment per agent role (haiku/sonnet/opus). User overrides act as a floor — they can upgrade but not downgrade below the effort-assigned level.
- **Output compression**: `how_it_works` capped at ~500 words, empty YAML sections omitted, structured lists preferred over prose between stages. Snapshots exceeding ~2 KB are compressed to key findings with file path references.
- **Hybrid triage**: The triage stage collects deterministic project stats (`git diff --stat HEAD`, `git diff --name-only HEAD`, file count), then emits a `classify` gate to the orchestrator LLM for complexity classification and area identification. The engine parses the response into structured outputs (`complexity`, `affected_areas`, `search_targets`, `independent_areas`). If the workflow declares no triage outputs, the classify gate is skipped and only stats are returned.
- **Verification hooks**: Before the reviewer agent runs, the pipeline auto-detects test/typecheck/lint commands from `package.json` scripts and Makefile targets, executes them (120s timeout each), and feeds structured results (exit code, stdout, stderr, duration) to the reviewer as additional context.
- **Agent output validation**: After each `agent/done` message, agent outputs are validated against schemas in `cli/schemas/yaml/agent-output/`. On validation failure, a `stage/warning` is emitted and the agent is optionally retried if stage retry settings allow.

## Task Compilation

The plan-to-task compiler in `dag.ts` converts architect plans into executable task DAGs:

- **Cross-cutting detection**: Changes touching >3 files with the same extension in the same directory tree are kept as a single task instead of being split per-file
- **Read-write dependency edges**: If change A writes to a file that change B reads from, B depends on A (sequential waves). Write-write overlaps go to the same wave (serial).
- **Wave assignment**: Independent changes with no overlap run in the same wave (parallel). Read-write overlaps produce sequential waves.

## Execution Methods

The `--implement-method` flag controls how developer agents are batched during implementation:

| Method | Behavior | Use case |
|--------|----------|----------|
| `phase` (default) | One agent session per wave | Balanced context/cost |
| `task` | One agent session per task, no prior context | Maximum isolation, lowest context bloat |
| `single-session` | All tasks in one session with cumulative context | Small specs, fast iteration |

In `single-session` mode, each task prompt includes summaries of all previously completed tasks. In `task` mode, prompts contain only the current task's scope — no cross-task context leaks.

## Retry & Resume

Pipeline runs track retry state per stage. When a stage fails:

- `lineup resume <run-id> --retry-failed` retries the failed stage
- `--max-retries <n>` caps retry attempts per stage (default: 3)
- Retry count, last error, and timestamps are persisted in `pipeline-state.json`
- After exhausting retries, the resume command rejects with a clear message

Runs also track `started_at`, `finished_at`, and `duration_ms` for history reporting.

## Wave Visualization

`lineup waves` displays the compiled task execution plan:

- Shows tasks grouped by parallel execution wave
- Displays dependency edges and write scopes per task
- Reports max parallelism and sequential depth
- `--compact` for minimal output, `--json` for machine consumption

## Desktop Notifications

The pipeline sends native desktop notifications on completion or failure:

- macOS: `osascript` with Glass sound
- Linux: `notify-send`
- Auto-disabled in CI environments
- Best-effort — notification failures never block the pipeline

## Execution History

`lineup history` shows a table of all pipeline runs with status, duration, completed stages, and retry counts. Supports `--status` filtering and `--limit`.

## Stage Result Caching

Stage outputs can be cached to `.lineup/.cache/<stage>-<hash>.yaml` for re-run and rollback:

- Cache key: SHA-256 of (task prompt + triage assessment), first 12 hex chars
- On re-run with matching hash, the orchestrator offers to skip the stage
- `--from-stage N` restarts execution at stage N using cached upstream outputs
- Cache files are ephemeral — cleaned up by Pipeline Cleanup

## Transient File Lifecycle

Large intermediate outputs are written to `.lineup/.ephemeral/` instead of passed inline:

- Downstream agents receive file path references (e.g., "Read `.lineup/.ephemeral/research-auth.yaml`")
- Cleanup runs after the reviewer finishes (Stage 6) and again in Pipeline Cleanup
- Never delete transient files before the reviewer finishes

## Snapshot Streaming

Inter-stage context snapshots exceeding 500 bytes are written to `.lineup/.ephemeral/`
as `snapshot-<from>-<to>-<hash>.yaml`. Downstream agents receive a file reference
instead of inline content. Snapshots under 500 bytes remain inline (cheaper than an
extra file read). The threshold applies after compression.
