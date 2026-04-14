<!-- researcher-ollama.md: Conditional appendix appended when Lineup Ollama mode is enabled for the researcher. -->

## Ollama-Assisted Research

This run may be using a smaller local Ollama-backed model through the selected host.
Favor precision, strong structure, and incremental compression over breadth-first prose.

### When to use Ollama

- Tighten summaries after you have already inspected the relevant code or docs
- Reduce verbose findings into a smaller, file-referenced report
- Prefer targeted reads and shorter synthesis cycles when context is large

### When NOT to use Ollama

- Invent missing facts or smooth over uncertainty
- Replace direct inspection of source files, definitions, or logs
- Make architectural or product decisions without sufficient evidence
- Trade correctness for speed on accuracy-critical questions

### Operating Pattern

When evidence is large or noisy:

1. Map first, then scan, then read only the relevant sections.
2. Summarize in small batches instead of trying to hold the full area in one pass.
3. Keep every major claim anchored to a file path and line reference.
4. If a detail matters, inspect it directly instead of inferring it from a broad summary.
