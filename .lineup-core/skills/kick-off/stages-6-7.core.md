## Stage 6 -- Verify

>  **Stage 6/7: Verify**

Spawn a `reviewer` agent to validate the implementation.
Follow the **Agent Spawning** rules in `SKILL.md` for spawn mode (team or subagent).

- Run tests, review the diff against the plan, check for regressions.
- Flag any issues found -- do not silently pass a broken implementation.
- Apply **Snapshot Streaming** from `SKILL.md` — if the implementation report exceeds
  500 bytes, the developer should have already written it to
  `.lineup/.ephemeral/implementation-<hash>.yaml`. Pass a file reference to the
  reviewer along with the inline acceptance criteria from the plan.
- **Artifact cleanup**: After the reviewer completes, run `git status` to identify untracked
  or modified files not produced by Stage 5 implementation. Delete any ephemeral artifacts
  found this way — files in `.lineup/.ephemeral/`, `.lineup/.cache/`, YAML reports, research
  files, plan drafts, and similar intermediate files written by agents during Stages 0-5.
  Keep all files that are part of the implementation (code changes from Stage 5) and leave
  tracked files untouched. This ensures the documenter (if Stage 7 runs) starts with a clean
  working tree.
- **Output:** verification report presented to the user.

## Stage 7 -- Document (Optional)

>  **Stage 7/7: Document (Optional)**

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

1. **Artifact cleanup**: Run `git status` and delete any ephemeral artifacts — files in
   `.lineup/.ephemeral/`, `.lineup/.cache/`, YAML reports, research files, plan drafts —
   that are not part of Stage 5 implementation or Stage 7 documentation. This is the
   same procedure as Stage 6 artifact cleanup, applied here as a safety net for early exits.
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

- `research-<area>.yaml` — researcher output for a specific area
- `plan-<hash>.yaml` — architect plan draft
- `review-<hash>.yaml` — reviewer report
- `implementation-<hash>.yaml` — developer implementation report

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

1. **Stage 6 (Verify)**: After the reviewer completes, delete all files in
   `.lineup/.ephemeral/`. The reviewer has already read everything it needs.
2. **Pipeline Cleanup**: Safety net — delete `.lineup/.ephemeral/` contents on
   any pipeline exit (normal, abort, or error).

Never delete transient files before the reviewer finishes. Downstream agents
may still need to read them.
