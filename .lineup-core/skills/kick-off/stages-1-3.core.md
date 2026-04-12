## Stage 1 -- Clarify

> **Stage 1/7: Clarify**

Refine the request before any work begins using **structured questions**.

- Analyze the user's request and identify gaps: missing requirements, ambiguous scope, edge cases, non-functional constraints.
- Use **{{QUESTION_PRIMITIVE}}** to present targeted, context-aware questions with predefined options. For each question:
  - Provide 3-5 concrete options covering the most likely answers
  - Always include a free-text option (e.g., "Other (please specify)") as the last choice
  - Batch related questions together -- do not ask one at a time
- If the request is already specific and unambiguous, acknowledge that and move on.
- **Output:** a concise summary of the agreed requirements.

## Stage 2 -- Research

> **Stage 2/7: Research**

Spawn one or more `researcher` agents to explore the codebase and gather context.
Follow the **Agent Spawning** rules in `SKILL.md` for spawn mode (team or subagent).

### Ollama-assisted research

When `OLLAMA_AVAILABLE = true`, augment each researcher spawn:

- Append `mcp__ollama__ollama_chat, mcp__ollama__ollama_generate, mcp__ollama__ollama_web_search, mcp__ollama__ollama_web_fetch` to the researcher's
  `tools` list in the Agent spawn call.
- Read `{{AGENTS_DIR}}researcher-ollama.md` and append its full contents to the
  researcher's spawn prompt (after a `---` separator). This file contains all
  Ollama-specific instructions and is only included when Ollama is available.

- **Use triage search targets**: The triage assessment provides specific directories,
  file patterns, and questions per affected area. Use these as the basis for each
  researcher's spawn prompt instead of deriving scope from scratch.
- Spawn one researcher per affected area when the triage identifies 2+ areas.
  Run them in **parallel** when areas are independent, **sequentially** when findings
  build on each other.
- Each researcher is read-only -- it cannot modify files.
- **Scope the research prompt**: Include the triage search targets verbatim in the
  researcher's prompt, plus any clarifications from Stage 1. Do not send vague prompts
  like "explore the codebase."
- **Set boundaries**: For large codebases, use the triage affected areas to tell each
  researcher which areas to focus on and which to skip.
- **Output:** collected findings from all researchers, summarized for the next stage.
  If a researcher's output is verbose, extract the key findings (files, patterns,
  constraints) and discard raw file contents before passing to the next stage.
  Apply **Snapshot Streaming** from `SKILL.md` — if research findings exceed 500 bytes,
  write them to `.lineup/.ephemeral/research-<area>.yaml` and pass a file reference
  to the Clarification Gate and Plan stages instead of embedding inline.

## Stage 3 -- Clarification Gate

> **Stage 3/7: Clarification Gate**

Review the research findings and identify any remaining ambiguities.

- Look for: unresolved edge cases, scope boundaries, conflicting patterns, integration decisions.
- Use **{{QUESTION_PRIMITIVE}}** to present each ambiguity as a structured question with concrete resolution options. For each ambiguity:
  - Explain the context briefly (what the research found)
  - Offer 2-4 resolution options based on the research findings
  - Always include a free-text option for custom resolution
- **Skip** this stage only if research yielded clear, complete answers with no open questions.
- **Output:** final resolved requirements, ready for planning.

---

## Effort-Based Model Selection

The orchestrator assigns an effort level to each agent based on the triage
complexity classification from Stage 0. Effort maps to model selection when
spawning agents.

### Effort mapping

| Role | simple | moderate | complex |
|------|--------|----------|---------|
| Researcher | haiku | sonnet | sonnet |
| Architect | sonnet | sonnet | opus |
| Developer | haiku | haiku | sonnet |
| Reviewer | sonnet | sonnet | sonnet |

### How to apply

When spawning an agent, select the model from the table above based on the
triage complexity. Include the effort-assigned model in the Agent tool call
(`model` parameter for team mode, `model` parameter or equivalent for subagent
mode).

### Override interaction

User overrides (from `{{OVERRIDES_DIR}}<agent>.yaml`) act as a **floor**, not a
ceiling. When an override specifies a model:

- If the override model is **higher** than the effort-assigned model, use the
  override model (user wants more capability).
- If the override model is **lower** than the effort-assigned model, use the
  effort-assigned model (effort requirements take precedence).

Model hierarchy for comparison: `haiku` < `sonnet` < `opus`.

Example: If effort assigns `sonnet` to a researcher (moderate task) and the user
override sets `model: opus`, use `opus`. If the override sets `model: haiku`,
use `sonnet` (effort floor).
