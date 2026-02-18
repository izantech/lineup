<!-- AUTO-GENERATED. Edit canonical source in .lineup-core/. -->

---
name: lineup-explain
description: Get a clear explanation of any project component, pattern, or decision
---

This skill is an alias for running the built-in `explain` tactic.

Run the kick-off pipeline with the `explain` tactic:

1. Invoke `$lineup-kick-off explain` with the user's question as the task description.
2. The kick-off skill will resolve the built-in `explain` tactic from the skill pack's
   `tactics/` directory and execute its stages (research + explain).

**Do not** implement the stages yourself -- delegate entirely to the kick-off skill.
