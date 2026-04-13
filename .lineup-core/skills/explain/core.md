---
name: {{SKILL_NAME_EXPLAIN}}
description: Get a clear explanation of any project component, pattern, or decision
---

This skill runs the built-in `explain` tactic via the CLI.

Run: `lineup run "<user question>" --tactic explain --mode host`

Handle any `gate/request` messages from the NDJSON output by presenting them
to the user via **{{QUESTION_PRIMITIVE}}** and responding with
`lineup gate respond <run-id> <request-id> --choice <value>`.

If the CLI is not available or the tactic is not found, fall back to invoking
`{{CMD_KICKOFF}} explain` with the user's question.
