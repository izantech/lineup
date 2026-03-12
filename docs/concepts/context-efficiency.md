# Context Efficiency

Every Lineup pipeline run operates within a finite context window. The agents, orchestrator, and all their outputs share this space. When context runs out mid-pipeline, downstream stages produce incomplete results or fail entirely.

Lineup's agents include built-in strategies to use context efficiently -- structured tool selection, a phased research protocol, and output compression rules. These work automatically. You do not need to configure anything to benefit from them.

## Why context efficiency matters

A full pipeline run involves multiple agents producing structured output at each stage. Research findings feed into plans, plans feed into implementation, and implementation feeds into review. Each stage adds to the cumulative context. If the researcher consumes 80% of the context window exploring files, the architect, developer, and reviewer have to share the remaining 20%.

The most common cause of context exhaustion is a researcher reading too many files verbatim. A single large codebase exploration can easily fill the window before planning even starts.

## Tool usage priorities

Every agent has a **Tool Usage Priorities** section in its instructions that establishes which tools to reach for first. These are not arbitrary preferences -- they are ordered to minimize context consumption.

The general principle across all agents:

1. **Search before reading.** Grep and Glob produce compact results (file paths, line numbers, matched lines). Reading entire files produces large blocks that fill context quickly.
2. **Read targeted sections, not whole files.** Use line offsets to read specific functions or classes, not 500-line files.
3. **Use the right tool for the job.** Each tool has a context cost. Bash output from `git diff --stat` is cheaper than reading every changed file.

Each agent's priorities are tailored to its role:

| Agent | Priority order | Rationale |
| ----- | -------------- | --------- |
| **Researcher** | Glob/LS, then Grep, then targeted Read | Map the structure cheaply, scan for specifics, read only what matters |
| **Architect** | Grep first, then targeted Read, then Glob | Verify research findings with search, read only to fill gaps |
| **Developer** | Read (before edit), Edit (not Write for existing files), Grep, Bash | Always read before modifying; use Edit for targeted changes |
| **Reviewer** | Bash (`git diff`), Grep, targeted Read, Bash (tests) | Start with the diff, verify consistency with search, read only when needed |
| **Documenter** | Grep, Read, Write, Glob | Search for existing docs first to avoid duplication |
| **Teacher** | Grep, targeted Read, Glob, WebFetch | Find code examples with search, read specific sections to explain |

## The research protocol

The researcher agent follows a three-phase protocol designed to maximize codebase coverage while minimizing token consumption. This is the most impactful efficiency measure in the pipeline because research output directly determines how much context downstream agents receive.

### Phase 1: Map (cheap, broad)

Build a structural overview of the relevant area without reading any file contents.

- **Glob** discovers file structure: `**/*.ts`, `src/auth/**/*`
- **LS** reveals directory layout and module organization
- No file reads yet -- the goal is a mental map of what exists and where

This phase is nearly free in context terms. A Glob result listing 50 files costs a fraction of reading even one of those files.

### Phase 2: Scan (targeted, selective)

Identify the specific locations that matter using search.

- **Grep** with precise patterns finds definitions, usages, configuration keys, and import chains
- Multiple focused Grep calls are cheaper than reading files hoping to find what you need
- The output is file paths and line numbers -- your read targets for Phase 3

### Phase 3: Read (precise, minimal)

Read only what the scan phase identified as relevant.

- Use **Read with line offsets** for large files -- read the specific function or class, not the whole file
- Files under ~100 lines can be read in full
- Files over ~200 lines should always use offset and limit
- Extract key information and move on -- do not re-read the same file

### Output discipline

The research protocol also governs how findings are expressed:

- **Summarize, do not quote.** Describe what code does in your own words. Only include literal snippets when exact syntax matters (API signatures, regex patterns, configuration formats).
- **Reference, do not reproduce.** Write `src/auth/middleware.ts:45-67` instead of pasting the 22-line block. Downstream agents can read the file themselves.
- **Compress incrementally.** After exploring a batch of files, summarize findings before moving to the next batch. Do not accumulate raw content and summarize at the end.

## Orchestrator context management

The orchestrator applies several measures to keep context lean across the full pipeline:

1. **Triage-driven scoping.** Stage 0 (Triage) produces an assessment with concrete search targets -- specific directories, file patterns, and questions per affected area. Researchers receive these as focused directives instead of deriving scope from scratch. This eliminates the broad "explore the codebase" pattern that historically consumed the most context.

2. **Conditional approach analysis.** The triage assessment classifies task complexity as `simple`, `moderate`, or `complex`. Simple tasks skip the multi-approach comparison in the Plan stage entirely -- the architect produces 1 approach directly. This saves the token cost of generating and evaluating 2-3 alternatives when there is only one sensible path.

3. **Parallel architects.** When triage detects 2+ independent areas, separate architect agents spawn in parallel, each scoped to its area. The orchestrator merges outputs into a master plan. This reduces wall-clock time on multi-area tasks without increasing per-architect context load.

4. **Active compression.** Between stages, the orchestrator reviews upstream output before passing it downstream. If the output contains raw file contents, long code blocks, or verbose exploration logs, it compresses them to structured summaries with file path references. The [context snapshot](/concepts/pipeline#context-snapshots) table defines *which* sections to pass; active compression controls the density *within* those sections.

5. **Output compression rules.** Three specific rules constrain inter-stage output size:
   - Cap `how_it_works` sections at ~500 words -- compress to essential execution flow, data flow, and pattern descriptions
   - Omit empty YAML sections (`gaps: []`, `risks: null`) -- pass only sections with substantive content
   - Prefer structured bullet-point lists over prose paragraphs -- downstream agents parse lists faster and more accurately

## How you benefit

These improvements are invisible to your workflow. Existing pipelines benefit automatically because the strategies are embedded in agent instructions, not in configuration or user-facing settings.

That said, you can amplify the effect by scoping your requests:

```bash
# Broad -- researcher explores broadly, consuming more context
/lineup:kick-off Refactor the backend

# Scoped -- researcher focuses on one module, preserving context for later stages
/lineup:kick-off Refactor the authentication middleware in src/auth/
```

For very large codebases, additional strategies are covered in the [context window exhaustion](/troubleshooting#context-window-exhaustion-on-large-codebases) troubleshooting entry.

## Tool pattern examples

Agent instructions include concrete, annotated examples of effective tool call sequences. These serve as few-shot demonstrations that guide agents toward efficient patterns. For instance, the researcher's instructions show how to trace a dependency chain:

```
Grep: pattern="import.*from.*target-module"  -- find all consumers
Grep: pattern="require.*target-module"       -- CommonJS consumers too
```

Then read only the import sites (not full files) to understand usage patterns.

The developer's instructions demonstrate editing an existing function:

```
Read: file_path="src/auth.ts" offset=45 limit=30   -- read just the function
Edit: file_path="src/auth.ts" old_string="..." new_string="..."
```

Not: Write the entire file with the change embedded.

These examples are part of the agent definition files and are maintained alongside the agent instructions. They teach the pattern by showing it, which is more effective than describing it abstractly.
