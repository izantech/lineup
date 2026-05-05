## Stage 6 -- Verify

> **Stage 6/7: Verify**

Spawn a `reviewer` agent to validate the implementation.
Follow the **Agent Spawning** rules in `SKILL.md` for spawn mode (team or subagent).

- Run tests, review the diff against the plan, check for regressions.
- Flag any issues found -- do not silently pass a broken implementation.
- Apply **Snapshot Streaming** from `SKILL.md` — if the implementation report exceeds
  500 bytes, the developer should have already written it to
  `.lineup/.ephemeral/snapshot-5-6-<hash>.yaml`. Pass a file reference to the
  reviewer along with the inline acceptance criteria from the plan.
- **Artifact cleanup**: After the reviewer completes, remove Stage 6-specific
  artifacts from `.lineup/.ephemeral/` only. Do not delete the entire directory —
  the documenter (Stage 7) and Teams-mode spawns may still need files from earlier
  stages. Full ephemeral cleanup happens in Pipeline Cleanup.
- **Output:** verification report presented to the user.

## Stage 7 -- Document (Optional)

> **Stage 7/7: Document (Optional)**

After verification passes, ask the user if they want documentation generated for the changes.

- Use **{{QUESTION_PRIMITIVE}}** to offer:
  1. Generate documentation for the new changes
  2. Skip documentation
- If the user chooses to generate documentation, spawn a `documenter` agent
  following the **Agent Spawning** rules in `SKILL.md`.
- Documenter model selection defaults to Haiku tier. Escalate to Sonnet tier
  only for unusually complex documentation work, such as broad cross-module docs,
  migration guides, or documentation that requires reconciling multiple
  architectural narratives.
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

1. **Stage 6 (Verify)**: After the reviewer completes, remove Stage 6-specific
   artifacts only (e.g., `review-<hash>.yaml`). Do not delete the entire
   `.lineup/.ephemeral/` directory — the documenter (Stage 7) and Teams-mode
   spawns may still need files from earlier stages.
2. **Pipeline Cleanup**: Delete all `.yaml` files in `.lineup/.ephemeral/`.
   On successful pipeline completion, also delete `.lineup/.cache/*.yaml`.
   On error or abort, preserve `.lineup/.cache/` to support `--from-stage` restarts.
   Never delete files outside these managed directories.

Never delete transient files before the reviewer finishes. Downstream agents
may still need to read them.
