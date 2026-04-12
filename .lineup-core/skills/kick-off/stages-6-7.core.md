## Stage 6 -- Verify

> **Stage 6/7: Verify**

The CLI runtime owns verification dispatch and retry handling. The orchestrator should focus
on interpreting reviewer results, presenting failures clearly, and asking the user whether to
retry or stop when verification does not pass.

- If verification status is `PASS`: proceed to Stage 7 (Document).
- If verification status is `FAIL` or `PASS_WITH_WARNINGS`: report the reviewer summary and
  ask whether to retry or stop. Use **{{QUESTION_PRIMITIVE}}** for this decision.

**Artifact cleanup**: After confirmation of the verification result, Stage 6-specific
ephemeral artifacts may be cleaned up. Full run cleanup remains a CLI-managed concern.

**Output:** verification status reported to the user.

## Stage 7 -- Document (Optional)

> **Stage 7/7: Document (Optional)**

After verification passes, ask the user if they want documentation generated for the changes.

- Use **{{QUESTION_PRIMITIVE}}** to offer:
  1. Generate documentation for the new changes
  2. Skip documentation
- If the user chooses to generate documentation, spawn a `documenter` agent
  following the **Agent Spawning** rules in `SKILL.md`.
- Feed it the implementation plan, the implementation report, and the review report as context.
- The documenter will write documentation files directly to the project.
- **Output:** documentation report listing what files were created or updated.

After Stage 7 completes (or if the user chose to skip documentation in this stage),
proceed to **Pipeline Cleanup**.

---

## Pipeline Cleanup

Runs after the final stage completes — or when the pipeline exits early due to
user abort or error.

1. **Ephemeral cleanup**: Delete all `.yaml` files in `.lineup/.ephemeral/`
   (snapshots, research artifacts, agent instructions). Only delete files in
   `.lineup/.cache/*.yaml` on successful pipeline completion — cache files from
   interrupted runs must persist to support `--from-stage` restarts. Never delete
   files outside these managed directories. Never delete based on `git status`
   untracked files.
2. **Teammate shutdown** (skip if `TEAMS_MODE = false`): Check if any teammates are still
   running. If so, send a `shutdown_request` to each one. Do not call `TeamDelete` --
   Claude Code manages the team entity lifecycle.

---

## Transient File Lifecycle

Intermediate agent outputs (research findings, plan drafts, review reports) may be
written to disk when they are too large to pass inline between stages. These files
are **transient** — they exist only to bridge stages and must not persist after the
pipeline completes.

### Write location

All transient files are written to `.lineup/.ephemeral/`. The directory is created
on first use (no pre-setup required). File naming convention:

- `snapshot-<from>-<to>-<hash>.yaml` — compressed snapshot passed between stages
- `research-<area>.yaml` — researcher output for a specific area
- `plan-<hash>.yaml` — architect plan draft
- `review-<hash>.yaml` — reviewer report

### Downstream references

When a stage writes output to `.lineup/.ephemeral/`, the orchestrator passes a
**file path reference** to the downstream agent instead of embedding the full
content inline. Example:

Instead of embedding 5KB of research YAML in the architect's prompt, pass:
"Read `.lineup/.ephemeral/research-auth.yaml` for the full research findings
on the auth module."

The downstream agent reads the file itself. This keeps prompts focused and
reduces token cost.

### Cleanup

Transient files are cleaned up in two places:

1. **Stage 6 (Verify)**: After TF completes and the validation result is confirmed,
   remove Stage 6-specific artifacts from `.lineup/.ephemeral/` only. Do not delete
   the entire `.lineup/.ephemeral/` directory — the documenter (Stage 7) and Teams-mode
   spawns may still need files from earlier stages. Do not delete `.lineup/.runs/<runId>/`
   while the pipeline is still active — the native runtime and Stage 7 may still read from it.
2. **Pipeline Cleanup**: Delete all `.yaml` files in `.lineup/.ephemeral/`.
   On successful pipeline completion, also delete `.lineup/.cache/*.yaml`.
   On error or abort, preserve `.lineup/.cache/` to support `--from-stage` restarts.
   Never delete files outside these managed directories.

The `.lineup/.runs/<runId>/` directory is managed by the native Lineup runtime. It may
contain worktree-local request/response files and pipeline-state snapshots while the run is
active. Cleanup is a CLI-managed concern after the pipeline reaches a terminal state.

Never delete transient files before validation is confirmed. Downstream agents
may still need to read them.
