# Runtime Engine

The runtime engine is a `lineup run` CLI command that bridges Lineup pipelines with [Task Foundry](https://github.com/izantech/task-foundry) as its execution backend. It shifts mechanical orchestration (state management, DAG resolution, adapter generation, caching) out of the LLM's context and into the CLI, leaving the LLM responsible only for reasoning tasks.

**Why it exists:**
- The previous kick-off orchestrator was ~57% mechanical overhead — file I/O, template rendering, validation, and cleanup described as prose instructions that the LLM had to read, interpret, and execute.
- Prose orchestration is non-deterministic: stage ordering, cache keys, and snapshot compression varied per run.
- There was no persistent state model, so `--from-stage` required the user to know which stage to restart from.

The runtime engine replaces that prose with a declarative YAML workflow format and a CLI that executes it deterministically.

---

## Architecture

The pipeline is split into three zones, each handled differently:

```
lineup run
│
├── Pre-pipeline stages (host-native)
│   triage → clarify → research → gate
│   CLI emits LINEUP: protocol messages; host orchestrator handles execution
│
├── Task Foundry core (two-phase)
│   Phase 1: planner adapter → TaskManifest YAML → user approval
│   Phase 2: passthrough-planner + worker + validator via TF
│
└── Post-pipeline stages (host-native)
    document
    CLI emits LINEUP: protocol messages
```

**Pre/post stages** use host-native agents (claude, codex, opencode). The CLI emits `LINEUP:stage:*` protocol messages on stdout; the host orchestrator reads these and spawns agents or presents output.

**The TF core** (plan → implement → verify) runs through Task Foundry with Lineup-generated adapters. This is a two-phase invocation:

1. **Phase 1** — the planner adapter invokes the architect agent, which produces a `TaskManifest` YAML. The manifest is written to `.lineup/.ephemeral/<runId>/planner-output.yaml`. The CLI then emits `LINEUP:approval:plan`, which signals the host to present the plan to the user for approval.

2. **Phase 2** — after approval, the CLI generates a passthrough config that replaces the real planner with a passthrough adapter. The passthrough adapter simply reads and re-emits the approved manifest, bypassing re-planning. TF then dispatches workers and the validator normally.

### Directory layout

```
.lineup/
  .ephemeral/<runId>/       # Per-run artifacts, deleted after pipeline completes
    adapters/               # Generated adapter scripts (.sh) and system prompts
    tf-config.yaml          # Generated TF config for Phase 2
    planner-output.yaml     # TaskManifest from Phase 1
  .cache/                   # Stage output cache, deleted on successful run
.runner-output/             # Task Foundry output directory (persisted)
```

---

## `lineup run` Command

```
lineup run [options]
```

Runs the pipeline defined in the workflow YAML. Must be executed from the project root.

### Options

| Flag | Default | Description |
|---|---|---|
| `--workflow <path>` | auto-detected | Path to workflow YAML. Checks `.lineup-core/workflows/full-pipeline.yaml`, then `.lineup/workflows/full-pipeline.yaml`. |
| `--tactic <name>` | — | Run a specific tactic instead of the full pipeline. |
| `--from-stage <id>` | — | Resume from a specific stage, using cached outputs from upstream stages. |
| `--dry-run` | `false` | Parse and validate the workflow, print the execution plan, then exit without running. |
| `--force-rerun` | `false` | Ignore cached stage outputs and re-run all stages. |
| `--json` | `false` | Emit pipeline state as JSON (for tooling). |

### Examples

```bash
# Run the default full pipeline
lineup run

# Preview the execution plan without running
lineup run --dry-run

# Resume from the implement stage (e.g., after a failed run)
lineup run --from-stage implement

# Run with a custom workflow
lineup run --workflow .lineup/workflows/minimal.yaml

# Force a complete re-run, ignoring cache
lineup run --force-rerun
```

### Dry-run output

`--dry-run` prints the execution plan as waves (sets of stages that can run in parallel):

```
LINEUP:pipeline:dry-run
  Wave 1: triage (builtin)
  Wave 2: clarify (reasoning), research (agent: researcher)
  Wave 3: gate (reasoning)
  Wave 4: plan (agent: architect)
  Wave 5: plan-approval (approval)
  Wave 6: implement (agent: developer)
  Wave 7: verify (agent: reviewer)
  Wave 8: document (agent: documenter)
```

### Host detection

`lineup run` checks for supported host CLIs in this order: `claude` → `codex` → `opencode`. The first found is used for adapter generation. If none is found, the command exits with an error.

---

## Orchestrator Integration

The orchestrator is the single entry point. Users run `/lineup:kick-off <task>` — they never invoke `lineup run` or `task-foundry` directly. The kick-off skill drives the entire pipeline and calls `lineup run` via Bash tool calls at the appropriate stages.

### Flow

```
/lineup:kick-off <task>
│
├─ Stages 0-3: Host-native
│   Orchestrator spawns agents + asks questions directly
│
├─ Stage 4: Plan
│   1. Bash: lineup tf generate --host claude --output .lineup/.ephemeral/<runId>/
│   2. Orchestrator spawns architect → outputs TaskManifest YAML
│   3. Manifest written to .lineup/.ephemeral/<runId>/planner-output.yaml
│   4. User approval (AskUserQuestion)
│
├─ Stages 5-6: Task Foundry
│   1. Bash: task-foundry --config <generated-config> --input-file <request>
│   2. TF dispatches workers + validator via adapter scripts
│   3. Results in .runner-output/
│
└─ Stage 7: Host-native
    Orchestrator spawns documenter if requested
```

### `lineup tf generate` Command

```
lineup tf generate [options]
```

Generates TF adapter scripts, system prompt files, and a TF config YAML into a specified output directory. Run before invoking `task-foundry` directly (e.g. in Stage 4 of the kick-off flow).

#### Options

| Flag | Default | Description |
|---|---|---|
| `--host <name>` | auto-detected | Host CLI to generate adapters for (`claude`, `codex`, `opencode`). |
| `--output <path>` | `.lineup/.ephemeral/tf/` | Directory to write all generated files into. |
| `--workflow <path>` | auto-detected | Workflow YAML to read stage/agent definitions from. |
| `--manifest-path <path>` | — | If provided, generates a passthrough config referencing an already-approved manifest (Phase 2). Omit for Phase 1 (standard) config. |

#### Output

The command writes to `<output>/adapters/` and `<output>/tf-config.yaml`, then prints a JSON object to stdout:

```json
{
  "configPath": "/path/to/.lineup/.ephemeral/<runId>/tf-config.yaml",
  "adapters": {
    "planner": { "adapterPath": "...", "promptPath": "..." },
    "worker":  { "adapterPath": "...", "promptPath": "..." },
    "validator": { "adapterPath": "...", "promptPath": "..." }
  }
}
```

#### Example (kick-off Stage 4)

```bash
# Generate adapters + Phase 1 config
lineup tf generate --host claude --output .lineup/.ephemeral/run-abc123/

# Generate passthrough config after plan approval (Phase 2)
lineup tf generate --host claude \
  --output .lineup/.ephemeral/run-abc123/ \
  --manifest-path .lineup/.ephemeral/run-abc123/planner-output.yaml
```

### Artifact Locations

| Location | Contents | Lifecycle |
|---|---|---|
| `.lineup/.ephemeral/<runId>/` | Adapters, prompts, config, manifest | Cleaned after pipeline |
| `.runner-output/` | TF worker output, validator results | Persisted for debugging |
| `.lineup/.cache/` | Stage output cache | Cleaned on success |

---

## Workflow YAML Format

Workflows are defined in `apiVersion: lineup/v1` YAML files. The schema is at `cli/schemas/yaml/workflow.schema.json`.

### Top-level structure

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

stages: [...]

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

### Stage types

| Type | Executed by | Description |
|---|---|---|
| `builtin` | CLI | No LLM involved. Handles file I/O, detection, setup. |
| `reasoning` | Host LLM (orchestrator) | The host agent reasons inline. Used for triage, clarify, gate. |
| `agent` | Host LLM (spawned agent) | CLI builds a prompt; a dedicated agent executes it. |
| `approval` | CLI + user | CLI presents stage output; waits for user approval via the host's question primitive. |

### Stage fields

```yaml
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
      fallback: "Original user request"   # used if source stage was skipped

  outputs:
    what_found: { type: object }
    how_it_works: { type: string, max_length: 500 }
    gaps: { type: object }

  condition: "{{ stages.triage.outputs.complexity }} != simple"
  skip_if: "{{ stages.research.outputs.gaps | length }} == 0"
  optional: true
  gate: false

  parallel:
    strategy: per-area
    max: 3
    condition: "{{ stages.triage.outputs.independent_areas | length }} > 1"

  timeout: 5m

  retry:
    max_attempts: 1
    on: [timeout, rate_limit]

  on_failure:
    action: report
    block_dependents: true
```

### Inputs

Each `inputs` entry pulls typed fields from an upstream stage's outputs:

```yaml
inputs:
  - source: research
    fields: [what_found, constraints]
    via: file-reference      # force file-reference even if the value is small
    fallback: "No research"  # used if the source stage was skipped
```

`via: file-reference` writes the value to `.lineup/.ephemeral/` and passes a path reference instead of inlining the value. This is applied automatically when a value exceeds `snapshots.stream_threshold`.

### Parallelism

When `parallel.condition` evaluates to true, the CLI spawns `min(areas, max)` agents in parallel, each scoped to one independent area from `stages.triage.outputs.independent_areas`.

```yaml
parallel:
  strategy: per-area
  max: 3
  condition: "{{ stages.triage.outputs.independent_areas | length }} > 1"
```

### Retry and failure handling

```yaml
retry:
  max_attempts: 2
  on: [build_failure, test_failure]
  backoff: exponential      # optional: exponential | linear | none

on_failure:
  action: retry-from        # or: report
  stage: implement          # stage to retry from
  max_retries: 2
  block_dependents: true
```

Supported error codes: `timeout`, `rate_limit`, `build_failure`, `test_failure`, `malformed_output`, `context_overflow`, `tool_unavailable`, `agent_spawn_failed`, `data_corruption`.

### Output types

```yaml
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
  requirements:
    type: string
    max_length: 500
```

---

## Task Foundry Bridge

Task Foundry (TF) is the execution engine for the plan/implement/verify core. Lineup generates the TF configuration and adapter scripts at runtime before each invocation.

### Role mapping

Lineup agent roles map to TF roles as follows:

| Lineup agent | TF role | Adapter |
|---|---|---|
| `architect` | `planner` | `planner.sh` |
| `developer` | `worker` | `worker.sh` |
| `reviewer` | `validator` | `validator.sh` |

Each adapter is a bash script generated from templates in `.lineup-core/adapters/*.sh.template`. The system prompt for each role is generated from `.lineup-core/prompts/*.txt.template` by injecting the body of the corresponding agent markdown file (stripping YAML frontmatter).

### Generated adapter structure

For a Claude host, the generated `planner.sh` looks like:

```bash
#!/usr/bin/env bash
set -euo pipefail
SYSTEM_PROMPT=$(cat "/path/to/.ephemeral/<runId>/adapters/planner-system.txt")
PAYLOAD="$(cat)"
claude --print --output-format text --model "$MODEL" --bare -s "$SYSTEM_PROMPT" <<< "$PAYLOAD"
```

Host-specific invocation commands:

| Host | Invocation pattern |
|---|---|
| `claude` | `claude --print --output-format text --model "$MODEL" --bare -s "$SYSTEM_PROMPT" <<< "$PAYLOAD"` |
| `codex` | `codex -q --full-context -m "$MODEL" <<< "$SYSTEM_PROMPT\n\n$PAYLOAD"` |
| `opencode` | `opencode run -m "$MODEL" -s "$SYSTEM_PROMPT" <<< "$PAYLOAD"` |

### TF config (Phase 2)

The generated `tf-config.yaml` for Phase 2 uses a passthrough planner:

```yaml
runner:
  output_dir: .runner-output
  max_retries: 2
  concurrency: 4
  workspace_root: "/path/to/project"
  scope_max_files: 12
  scope_max_file_bytes: 4000
  scope_max_tree_entries: 256
  manifest_max_tasks: 32
  excluded_paths: [.git, .runner-output, .lineup, node_modules, target]
  command_hooks: []

planner:
  program: bash
  args: ["/path/to/adapters/passthrough-planner.sh"]
  env:
    APPROVED_MANIFEST_PATH: "/path/to/planner-output.yaml"

worker:
  program: bash
  args: ["/path/to/adapters/worker.sh"]
  env:
    MODEL: "claude-sonnet-4-6"
    SYSTEM_PROMPT_FILE: "/path/to/adapters/worker-system.txt"

validator:
  program: bash
  args: ["/path/to/adapters/validator.sh"]
  env:
    MODEL: "claude-sonnet-4-6"
    SYSTEM_PROMPT_FILE: "/path/to/adapters/validator-system.txt"
```

The passthrough planner ignores TF's planning input and simply re-emits the pre-approved manifest:

```bash
#!/usr/bin/env bash
set -euo pipefail
cat "$APPROVED_MANIFEST_PATH"
```

### LINEUP: protocol messages

The CLI communicates with the host orchestrator via structured messages on stdout:

| Message | When emitted |
|---|---|
| `LINEUP:pipeline:dry-run` | `--dry-run` mode, before wave listing |
| `LINEUP:stage:start id=<id> type=<type>` | Before each stage starts |
| `LINEUP:stage:builtin id=<id>` | For builtin stages |
| `LINEUP:stage:reasoning id=<id>` | For reasoning stages |
| `LINEUP:stage:spawn agent=<agent> id=<id>` | For agent stages |
| `LINEUP:stage:complete id=<id>` | After each stage completes |
| `LINEUP:planner:invoke adapter=<path>` | Before Phase 1 planner invocation |
| `LINEUP:planner:output path=<path>` | Planner manifest output path |
| `LINEUP:approval:plan` | Signals the host to present the plan for approval |
| `LINEUP:tf:invoke` | Before Phase 2 TF invocation |
| `LINEUP:tf:config path=<path>` | TF config path |
| `LINEUP:tf:command <command>` | Full TF invocation command |
| `LINEUP:tf:output dir=<path>` | TF output directory |
| `LINEUP:pipeline:complete` | After all stages complete and cleanup finishes |

### Default models

| Host | Default model |
|---|---|
| `claude` | `claude-sonnet-4-6` |
| `codex` | `codex-mini-latest` |
| `opencode` | `anthropic/claude-sonnet-4-6` |

Models can be overridden per-role via `TfGeneratorContext.modelOverrides`.

---

## Expression Language

Conditions, `skip_if`, and `parallel.condition` fields use a constrained expression language evaluated by the CLI. Expressions cannot call arbitrary code — they resolve stage output references and apply a fixed set of operators.

### Template references

```
{{ stages.<id>.outputs.<field> }}
{{ stages.<id>.outputs.<field> | length }}
```

- `stages.<id>.outputs.<field>` — resolves the named field from a completed stage's outputs.
- `| length` — pipe filter; returns array length or string length.

### Operators

| Operator | Types | Example |
|---|---|---|
| `==` | string, number | `{{ stages.triage.outputs.complexity }} == simple` |
| `!=` | string, number | `{{ stages.verify.outputs.status }} != FAIL` |
| `>` | number | `{{ stages.research.outputs.gaps \| length }} > 0` |
| `<` | number | `{{ stages.research.outputs.gaps \| length }} < 5` |
| `>=` | number | — |
| `<=` | number | — |

### Boolean operators

`and`, `or`, `not` (keyword-based, not symbolic):

```
{{ stages.triage.outputs.complexity }} != simple and {{ stages.triage.outputs.affected_areas | length }} > 1
not {{ stages.clarify.outputs.requirements }} == ""
({{ stages.triage.outputs.complexity }} == complex) or ({{ stages.triage.outputs.affected_areas | length }} > 3)
```

Operator precedence: `not` > `and` > `or`. Parentheses can override precedence.

### `contains()`

```
contains({{ stages.triage.outputs.affected_areas }}, "auth")
contains({{ stages.verify.outputs.status }}, "PASS")
```

`contains()` checks array membership (for list outputs) or substring presence (for string outputs).

### Error behavior

The expression evaluator throws on:
- Unresolved stage references (stage not found in context).
- Unresolved field references (field not in stage outputs).
- Unknown operators or filters.
- Malformed `contains()` calls.

Expressions are evaluated at runtime, immediately before each stage. A stage that hasn't yet completed cannot be referenced in a condition.

---

## Setup

### Prerequisites

- `task-foundry` binary must be on `$PATH`. The runtime engine generates configs and adapter scripts for TF but does not bundle TF itself.
- At least one supported host CLI must be installed: `claude`, `codex`, or `opencode`.

### Verify installation

```bash
lineup status
```

Output includes:

```
Task Foundry: installed (1.4.2)
TF Adapters: generated
```

If adapters are not generated, run:

```bash
lineup install
```

`lineup install` downloads the release source (which includes `.lineup-core/adapters/*.template` and `.lineup-core/prompts/*.template`) and writes generated adapters to `.lineup/.tf-adapters/`. The `lineup run` command generates per-run adapters from these templates into `.lineup/.ephemeral/<runId>/adapters/` at execution time.

### Check TF availability

```bash
which task-foundry
task-foundry --version
```

`lineup status` also reports TF install status and whether adapters have been generated. If TF is missing, `lineup run` will generate the config files but cannot invoke TF directly — the host orchestrator is responsible for the actual `task-foundry` invocation.

### Workflow file location

By default, `lineup run` looks for the workflow in this order:

1. `.lineup-core/workflows/full-pipeline.yaml`
2. `.lineup/workflows/full-pipeline.yaml`

To use a different workflow:

```bash
lineup run --workflow path/to/my-workflow.yaml
```

---

## Ollama Integration

Lineup uses a local Ollama model for lightweight text-processing tasks during the pipeline. This is **not** the model that writes code — it handles mechanical subtasks that don't require strong reasoning, freeing the primary model (Claude API or a coding-focused local model) for the work that matters.

### What the Ollama model does

| Task | Who uses it | Example |
|---|---|---|
| Snapshot compression | Orchestrator | Compress a 3KB research YAML to structured bullets between stages |
| Large file summarization | Researcher agent | Summarize a 500-line file before reporting findings |
| WebFetch post-processing | Researcher agent | Extract key facts from a >2KB documentation page |
| Prose expansion | Architect agent | Expand terse bullet notes into acceptance criteria prose |
| Web search routing | Researcher agent | Search + summarize via `ollama_web_search` + `ollama_web_fetch` |

### What it does NOT do

- Code generation or analysis (use the primary model)
- Architectural decisions or trade-off evaluation
- Any task where accuracy is critical
- Tool calling or agentic coding

### Model selection criteria

The Ollama integration model should optimize for:

| Requirement | Priority | Why |
|---|---|---|
| **Inference speed** | Critical | On the critical path — snapshot compression runs between every stage transition |
| **Instruction following** | High | Must reliably produce structured output (compress to bullets, extract facts) |
| **Small footprint** | High | Must coexist in memory alongside the primary model and the host process |
| **Context window** | Low | Inputs are capped at ~2KB (snapshot threshold) or ~200 lines |
| **Coding ability** | None | Explicitly excluded from code tasks |
| **Tool calling** | None | Called via MCP tools (`ollama_generate`), not as an agent |

### Recommended models

| Model | Params | Architecture | Size | Context | Best for |
|---|---|---|---|---|---|
| **qwen3.5:9b** | 9B | MoE | 7GB | 256K | Default recommendation. Fast, strong instruction following, tiny footprint. |
| **qwen3.5:4b** | 4B | MoE | 3.4GB | 256K | Constrained hardware (<16GB free). Faster but less reliable on complex summaries. |
| **qwen3.5:27b** | 27B | MoE | 17GB | 256K | High accuracy needs. Overkill for most pipelines but better summaries. |

Avoid dense models (non-MoE) for this role — MoE models activate only a fraction of parameters per token, giving much better speed-per-quality than dense models of similar total size.

### Configuration

```yaml
# ~/.claude/lineup/ollama.yaml
enabled: true
model: qwen3.5:9b
scope: research
```

The `scope` field controls which agents get Ollama tools appended to their spawn prompts:
- `research` — researchers and architects only (default)
- `all` — all agents (not recommended; coding agents should use the primary model)

### Hardware sizing

The Ollama model runs alongside the primary coding model. Plan memory accordingly:

| Setup | Primary model | Ollama model | Total VRAM/RAM |
|---|---|---|---|
| API-only (Claude plan) | None (API) | qwen3.5:9b (7GB) | ~10GB |
| Local coding (M3 Ultra 96GB) | qwen3-coder-next:q4_K_M (52GB) | qwen3.5:9b (7GB) | ~62GB |
| Local coding (32GB machine) | qwen3-coder:30b (19GB) | qwen3.5:4b (3.4GB) | ~25GB |
| Lightweight (16GB machine) | qwen3-coder:30b (19GB) | qwen3.5:4b (3.4GB) | ~25GB (swap likely) |

### Verify Ollama is working

```bash
# Check model is installed
ollama list | grep qwen3.5

# Verify MCP server is registered
claude mcp list | grep ollama

# If missing, register:
claude mcp add ollama -- npx -y ollama-mcp
```

`lineup status` reports Ollama availability when the MCP server is configured. During pipeline initialization, the orchestrator calls `mcp__ollama__ollama_list` to verify the model is actually available before setting `OLLAMA_AVAILABLE = true`.
