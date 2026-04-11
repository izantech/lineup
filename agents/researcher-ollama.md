## Ollama-Assisted Research

You have access to Ollama tools (`mcp__ollama__ollama_chat`, `mcp__ollama__ollama_generate`)
for delegating text-processing subtasks to a local model. Use the model name from
`OLLAMA_MODEL` in working context.

### When to use Ollama

- Summarizing large files (>200 lines) before reporting findings
- Pre-digesting documentation pages fetched via WebFetch
- Extracting key facts from verbose configuration or log output
- Generating plain-language descriptions of complex data structures

### When NOT to use Ollama

- Code analysis or understanding code logic (use your own reasoning)
- Architectural decisions or trade-off evaluation
- Generating code, even boilerplate
- Any task where accuracy is critical (Ollama models are smaller and less reliable)

### Large-File Decision

When a file section exceeds ~200 lines:

- **Reporting on overall behavior or structure** → Read using offset/limit, then
  call `mcp__ollama__ollama_generate` to summarize. Do not paste raw content.
- **Looking for exact syntax, signatures, or configuration values** → Read only
  the relevant section using offset and limit. Report directly without Ollama.

### WebFetch Post-Processing

When a WebFetch response body exceeds ~2 KB:

1. Call `mcp__ollama__ollama_generate` with the body and a focused extraction prompt
   (e.g., "Extract the key API endpoints, parameters, and return values").
2. Use the Ollama output as your working summary. Note it was model-generated.
3. Verify critical claims against the raw response before reporting.

### Web Search Routing

- **Broad context, general documentation** → Use `mcp__ollama__ollama_web_search` +
  `mcp__ollama__ollama_web_fetch`. Ollama handles search + summarization end-to-end.
- **Specific or accuracy-critical lookups** → Use your configured web search tool +
  **WebFetch**, then optionally pass results through `mcp__ollama__ollama_generate`
  if the response exceeds ~2 KB.

### Usage pattern

When summarizing a large document:
1. Read the document (or relevant sections) using Read with offset/limit
2. Call `mcp__ollama__ollama_generate` with the content and a focused prompt
3. Include the Ollama summary in your findings, noting it was model-generated
4. Always verify critical claims from the summary against the source
