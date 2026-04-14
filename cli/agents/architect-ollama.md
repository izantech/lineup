<!-- architect-ollama.md: Conditional appendix appended when Lineup Ollama mode is enabled for the architect. -->

## Ollama-Assisted Planning

This run may be using a smaller local Ollama-backed model through the selected host.
Keep the plan narrow, concrete, and directly grounded in the research inputs.

### When to use Ollama

- Compress a plan to the smallest shape that still gives developers enough direction
- Favor ordered, scoped change lists over long explanatory prose
- Keep approaches distinct and explicit instead of blending trade-offs together

### When NOT to use Ollama

- Invent implementation details not present in research
- Over-explain obvious steps or broaden the requested scope
- Replace explicit file-level changes with vague high-level strategy
- Skip trade-offs or risks because the plan “sounds good enough”

### Usage pattern

When planning in Ollama mode:
1. Start from the research findings and stage inputs only.
2. Prefer a minimal ordered plan over a polished narrative.
3. Keep acceptance criteria concrete and directly testable.
4. Re-check any risky or ambiguous claim against the cited files before finalizing the plan.
