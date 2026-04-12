## Stage 4 -- Plan

> **Stage 4/7: Plan**

Then spawn one or more `architect` agents to create an implementation plan.
Follow the **Agent Spawning** rules in `SKILL.md` for spawn mode (team or subagent). The triage
assessment's `complexity` and `independent_areas` fields drive how this stage runs.

The CLI runtime owns adapter generation, task compilation, protocol framing, and execution
setup. Do not describe shell commands or backend mechanics in the architect prompt. The
architect should focus only on producing the approved implementation plan artifact.

### Conditional approach analysis

Include the complexity classification in each architect's spawn prompt:

- **Simple** (`complexity: simple`): Instruct the architect to produce **1 approach
  directly** -- skip the multi-approach comparison. Add to spawn prompt:
  "This task is simple. Produce a single implementation plan without competing
  approaches."
- **Moderate/Complex** (`complexity: moderate` or `complex`): Instruct the architect to
  produce **2-3 approaches** with trade-offs (current behavior). The architect chooses
  2 or 3 based on how many meaningfully different strategies exist.

### Plan artifact output format

Instruct each architect to output a `lineup/v3` **Plan YAML** artifact. The plan should
capture the recommended approach, ordered file changes, dependency edges, parallelization
guidance, acceptance criteria, and risks. The CLI runtime compiles the approved plan into
deterministic tasks and execution waves after user approval.

### Ollama-assisted planning

When `OLLAMA_AVAILABLE = true`, augment each architect spawn:

- Append `mcp__ollama__ollama_chat, mcp__ollama__ollama_generate` to the architect's
  `tools` list in the Agent spawn call.
- Read `{{AGENTS_DIR}}architect-ollama.md` and append its full contents to the
  architect's spawn prompt (after a `---` separator). This file contains all
  Ollama-specific instructions and is only included when Ollama is available.

### Parallel architects

If the triage assessment identified 2+ `independent_areas`:

1. Spawn one `architect` agent per independent area, in parallel.
2. Each architect receives only the research findings relevant to its area, plus
   the full resolved requirements for cross-cutting context.
3. Each architect produces a Plan scoped to its area.
4. After all architects complete, **merge their outputs yourself** (do not spawn
   another agent). Produce a single master Plan by:
   - Merging the ordered change lists from all sub-plans
   - Updating explicit dependency references to remain consistent across the merged plan
   - Scanning proposed file paths for overlap across architect outputs
5. **Check for file-level conflicts**: If any overlapping file targets are found, do not
   proceed to Approval automatically. Instead, present the conflicting entries to the user:
   "Warning: The following file(s) appear in plans from multiple architects: <file list>.
   Please decide how to resolve the overlap before the plan is finalized."
   Use **{{QUESTION_PRIMITIVE}}** to let the user choose: keep one architect's version,
   merge both changes, or provide a custom resolution. Update the master Plan
   accordingly before presenting it for final approval.

If only one area exists, spawn a single architect (current behavior).

### Approval

- After the architect(s) complete, present the merged or single Plan to the user and
  **wait for explicit approval** before proceeding.
- **Output:** an approved `lineup/v3` Plan artifact.

## Stage 5 -- Implement

> **Stage 5/7: Implement**

The CLI runtime owns task compilation, task-wave execution, retries, isolation, and verifier
dispatch. The orchestrator should not describe backend shell commands or manually sequence
developer/reviewer subprocesses in prompt prose.

During this stage:

1. Hand the approved Plan to the CLI runtime.
2. Let the runtime compile the plan into deterministic Tasks and execution waves.
3. Let the runtime dispatch developer work per wave and collect implementation state.
4. Report only user-relevant progress and blockers.

**Note:** Keep Stage 5 focused on implementation intent, acceptance criteria, and user-facing
status. Runtime mechanics belong to the CLI, not the skill pack.

---

## Stage Result Caching

After each stage completes, the orchestrator may cache its output to enable
re-runs and rollback.

### Cache format

Write stage output to `.lineup/.cache/<stage>-<hash>.yaml`, where:

- `<stage>` is the stage number and name (e.g., `0-triage`, `2-research`, `4-plan`)
- `<hash>` is the first 12 characters of the SHA-256 hex digest of the **cache key**

### Cache key

The cache key is computed by serializing `{prompt: <task_prompt>, triage: <triage_output>}`
as JSON in fixed field order, then taking the SHA-256 hex digest.

This produces a deterministic hash that invalidates when the task or its
classification changes but remains stable across re-runs of the same task.

### Cache lookup

Before spawning agents for a stage, check `.lineup/.cache/` for a file matching
the current stage and hash. If found:

1. Read the cached output.
2. Present a summary to the user:
   "Stage <N> (<name>) has cached results from a previous run. Use cached results
   or re-run?"
3. Use **{{QUESTION_PRIMITIVE}}** with options: "Use cached results (Recommended)",
   "Re-run this stage".
4. If the user chooses cached results, skip the stage and pass the cached output
   downstream as if the stage had just completed.

### Restart from stage

Support a `--from-stage N` argument to the kick-off command. When provided:

1. For stages 0 through N-1, load cached output from `.lineup/.cache/`. If any
   required cache file is missing, report the error:
   "Cannot restart from stage <N>: cached output for stage <M> is missing.
   Run the full pipeline first, or use --from-stage <M>."
2. Start execution at stage N using cached upstream outputs.

### Cache lifecycle

- Cache files are cleaned up on successful pipeline completion. Interrupted-run
  cache files persist until the next successful completion, supporting `--from-stage`
  restarts.
- The `.lineup/.cache/` directory is created on first use (no pre-setup required).
