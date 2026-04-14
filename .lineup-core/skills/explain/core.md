---
name: {{SKILL_NAME_EXPLAIN}}
description: Get a clear explanation of any project component, pattern, or decision
---

This skill runs the built-in `explain` tactic via the CLI.

Run: `lineup bridge start "<user question>" --tactic explain --executor-host {{EXECUTOR_HOST}}`

Handle any `question` events or `pendingQuestion` from `lineup bridge events` by
presenting them to the user via **{{QUESTION_PRIMITIVE}}** and responding with
`lineup bridge answer <run-id> <request-id> --choice <value>`.

If `recovery.action` is `resume`, surface the timeout state and use the provided
resume command instead of sending another bridge answer.

If the CLI is not available or the tactic is not found, fall back to invoking
`{{CMD_KICKOFF}} explain` with the user's question.
