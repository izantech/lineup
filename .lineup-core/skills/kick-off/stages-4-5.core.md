## Stage 4 -- Plan

> **Stage 4/7: Plan**

Before spawning the architect, generate Task Foundry adapters for the current host via Bash:

```
lineup tf generate --host <detected-host> --output .lineup/.ephemeral/<runId>/
```

This produces adapter scripts, system prompts, and a TF config file in the ephemeral run
directory. The `<runId>` is a short identifier for the current pipeline run (e.g., first 8
characters of the pipeline session hash).

Then spawn one or more `architect` agents to create an implementation plan.
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

### TaskManifest output format

Instruct each architect to output their plan as a **TaskManifest YAML** with this structure:

```yaml
version: 1
goal: "<one-line goal>"
tasks:
  - task_id: <short-kebab-id>
    description: "<what this task does>"
    depends_on: [<task_ids this depends on>]
    read_files: [<files to read>]
    write_files: [<files to create or modify>]
    steps:
      - <imperative step description>
```

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
3. Each architect produces a TaskManifest scoped to its area.
4. After all architects complete, **merge their outputs yourself** (do not spawn
   another agent). Produce a single master TaskManifest by:
   - Merging the `tasks` lists from all sub-manifests, preserving task IDs
   - Updating `depends_on` references to remain consistent across the merged manifest
   - Scanning `write_files` entries for file-level conflicts (any path that appears in
     two or more tasks from different architects)
5. **Check for file-level conflicts**: If any `write_files` overlap is found, do not
   proceed to Approval automatically. Instead, present the conflicting entries to the user:
   "Warning: The following file(s) appear in plans from multiple architects: <file list>.
   Please decide how to resolve the overlap before the plan is finalized."
   Use **{{QUESTION_PRIMITIVE}}** to let the user choose: keep one architect's version,
   merge both changes, or provide a custom resolution. Update the master TaskManifest
   accordingly before presenting it for final approval.

If only one area exists, spawn a single architect (current behavior).

### Approval

- After the architect(s) complete, write the (merged or single) TaskManifest to
  `.lineup/.ephemeral/<runId>/planner-output.yaml`.
- Present the TaskManifest to the user and **wait for explicit approval**
  before proceeding.
- **Output:** an approved TaskManifest at `.lineup/.ephemeral/<runId>/planner-output.yaml`.

## Stage 5 -- Implement

> **Stage 5/7: Implement**

Invoke Task Foundry to execute the approved TaskManifest. Stage 6 (Verify) is bundled into
this TF invocation — the validator role runs automatically after workers complete.

1. Write the user's original request to `.lineup/.ephemeral/<runId>/request.txt`.
2. Regenerate the TF config with the **passthrough planner** so TF uses the approved manifest
   instead of re-planning from scratch:

   ```
   lineup tf generate --host <detected-host> --output .lineup/.ephemeral/<runId>/ \
     --manifest-path .lineup/.ephemeral/<runId>/planner-output.yaml
   ```

   This overwrites `tf-config.yaml` with a Phase 2 config where the planner adapter simply
   reads and emits the approved manifest. Without this step, TF would invoke the real planner
   and discard the user-approved plan.

3. Run via Bash:

   ```
   task-foundry --config .lineup/.ephemeral/<runId>/tf-config.yaml --input-file .lineup/.ephemeral/<runId>/request.txt
   ```

   TF dispatches developer workers and runs the validator according to the adapter scripts.
   It handles parallelism, retries, and hazard detection internally.

4. Read `.runner-output/` for TF's execution results.
5. On TF exit status:
   - **Exit 0**: proceed to Stage 7 (Document).
   - **Non-zero**: report the failure and TF's output to the user and stop the pipeline.

**Note:** The orchestrator does not spawn individual developer or reviewer agents in this
stage. TF manages all worker dispatch, parallelism, and retry logic via the generated
adapter scripts.

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
