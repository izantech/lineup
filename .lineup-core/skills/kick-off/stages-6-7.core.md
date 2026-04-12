## Stage 6 -- Verify

> **Stage 6/7: Verify**

Verification is handled by Task Foundry's validator role during Stage 5. The orchestrator
does not spawn a standalone reviewer agent.

After TF completes, read the validation result from
`.runner-output/<attempt>/validator-output.json`:

- If `status` is `"OK"`: proceed to Stage 7 (Document).
- If `status` is `"FAIL"`: report the validator's `reason` to the user and ask whether
  to retry (re-run TF from Stage 5) or abort. Use **{{QUESTION_PRIMITIVE}}** for this
  decision.

**Artifact cleanup**: After confirming the validation result, Stage 6-specific artifacts
in `.lineup/.ephemeral/` may be cleaned up. Do not delete `.runner-output/` — TF manages
this directory independently and the documenter (Stage 7) may read from it. Full ephemeral
cleanup of `.lineup/.ephemeral/` happens in Pipeline Cleanup.

**Output:** validation status reported to the user.

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
   spawns may still need files from earlier stages. Do not delete `.runner-output/` —
   TF manages this directory independently and Stage 7 may read from it.
2. **Pipeline Cleanup**: Delete all `.yaml` files in `.lineup/.ephemeral/`.
   On successful pipeline completion, also delete `.lineup/.cache/*.yaml`.
   On error or abort, preserve `.lineup/.cache/` to support `--from-stage` restarts.
   Never delete files outside these managed directories.

The `.runner-output/` directory is managed by Task Foundry and persists independently
from `.lineup/.ephemeral/`. It is not cleaned up by the orchestrator during Pipeline
Cleanup — TF controls its lifecycle.

Never delete transient files before validation is confirmed. Downstream agents
may still need to read them.
