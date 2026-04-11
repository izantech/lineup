## Stage 4 -- Plan

>  **Stage 4/7: Plan**

Spawn one or more `architect` agents to create an implementation plan.
Follow the **Agent Spawning** rules in `SKILL.md` for spawn mode (team or subagent). The triage
assessment's `complexity` and `independent_areas` fields drive how this stage runs.

### Conditional approach analysis

Include the complexity classification in each architect's spawn prompt:

- **Simple** (`complexity: simple`): Instruct the architect to produce **1 approach
  directly** -- skip the multi-approach comparison. Add to spawn prompt:
  "This task is simple. Produce a single implementation plan without competing
  approaches."
- **Moderate/Complex** (`complexity: moderate` or `complex`): Instruct the architect to
  produce **2-3 approaches** with trade-offs (current behavior). The architect chooses
  2 or 3 based on how many meaningfully different strategies exist.

### Parallel architects

If the triage assessment identified 2+ `independent_areas`:

1. Spawn one `architect` agent per independent area, in parallel.
2. Each architect receives only the research findings relevant to its area, plus
   the full resolved requirements for cross-cutting context.
3. Each architect produces a plan scoped to its area.
4. After all architects complete, **merge their outputs yourself** (do not spawn
   another agent). Produce a single master plan by:
   - Concatenating `changes` lists with area prefixes
   - Unifying `acceptance_criteria` from all sub-plans
   - Building a combined `parallelization_strategy` where each area's batches are
     independent of other areas' batches
   - Merging `risks` and deduplicating
5. **Check for file-level conflicts**: After merging, scan the combined `changes` list
   for any file path that appears in two or more architects' outputs. If any overlap is
   found, do not proceed to Approval automatically. Instead, present the conflicting
   entries to the user:
   "Warning: The following file(s) appear in plans from multiple architects: <file list>.
   Please decide how to resolve the overlap before the plan is finalized."
   Use **{{QUESTION_PRIMITIVE}}** to let the user choose: keep one architect's version,
   merge both changes, or provide a custom resolution. Update the master plan accordingly
   before presenting it for final approval.

If only one area exists, spawn a single architect (current behavior).

### Approval

- Present the (merged or single) plan to the user and **wait for explicit approval**
  before proceeding.
- **Output:** an approved implementation plan.

## Stage 5 -- Implement

>  **Stage 5/7: Implement**

Spawn one or more `developer` agents to execute the approved plan.
Follow the **Agent Spawning** rules in `SKILL.md` for spawn mode (team or subagent).

- Follow the architect's **Parallelization Strategy** from the approved plan:
  - Spawn developers according to the parallel batches identified in the plan
  - Run batches concurrently when they have no dependencies
  - Wait for a batch to complete before starting dependent batches
  - If no parallelization strategy is provided, run developers sequentially in the plan's change order
- **Batch failure handling**: After each batch completes, inspect the developer's output for
  `issues_encountered` entries with `impact: significant`. If any are found:
  - Do not start any new batches that depend on the failed batch.
  - Independent batches launched in the same spawn call will have already completed —
    collect their results normally.
  - After all batches from the current spawn call have returned, stop the implementation phase.
  - Report the failure and partial results to the user:
    "Implementation stopped: batch <N> encountered a significant issue — <summary>.
    The following batches were not started: <list>. Review before continuing."
  - Wait for the user to decide whether to proceed to Verify with partial results,
    retry the failed batch, or abort.
- Each developer follows the plan -- no improvising beyond the approved scope.
- **Output:** all code changes committed (or staged for user review).

---

## Stage Result Caching

After each stage completes, the orchestrator may cache its output to enable
re-runs and rollback.

### Cache format

Write stage output to `.lineup/.cache/<stage>-<hash>.yaml`, where:

- `<stage>` is the stage number and name (e.g., `0-triage`, `2-research`, `4-plan`)
- `<hash>` is the first 12 characters of the SHA-256 hex digest of the **cache key**

### Cache key

The cache key is the concatenation of:

1. The user's original task prompt (verbatim)
2. The triage assessment output (Stage 0)

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

- Cache files are **ephemeral** -- they are cleaned up by Pipeline Cleanup at
  the end of every pipeline run.
- The `.lineup/.cache/` directory is created on first use (no pre-setup required).
- Cache files from interrupted runs persist until the next successful pipeline
  completion.
