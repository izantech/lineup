---
name: {{SKILL_NAME_DIGEST}}
description: Generate a structured codebase overview for onboarding new contributors
---

You are the orchestrator for the **Lineup digest generator**. This skill produces a structured codebase overview (`DIGEST.md`) to help new contributors understand a project quickly. The output is regenerable — running this skill again overwrites the previous digest with fresh content.

## Arguments

This skill accepts an optional output path argument:

- `{{CMD_DIGEST}}` — writes to `DIGEST.md` at the project root
- `{{CMD_DIGEST}} docs/OVERVIEW.md` — writes to the specified path

Parse the argument from the user's invocation. If no path is provided, default to `DIGEST.md`.

---

## Initialization

Before starting the pipeline phases, run this lightweight initialization sequence.

### Agent Configuration Overrides

Check for user-level configuration overrides:

1. Check if `{{OVERRIDES_DIR}}` exists.
2. For each agent about to be spawned, look for `{{OVERRIDES_DIR}}<agent>.yaml`.
3. If an override file exists, read it and apply the overridden values (model,
   tools, memory) when spawning the agent. These values take precedence over
   the agent's {{HOST_DEFAULTS_TERM}} as-is.
4. If no override file exists, use the agent's {{HOST_DEFAULTS_TERM}} as-is.

Override files contain only the fields the user customized:

```yaml
plugin_version: "2.1.1"
model: sonnet
tools: Read, Grep, Glob, LS, WebFetch, mcp__brave-search__brave_web_search
```

**Version mismatch warning:** If the override file's `plugin_version` does not
match the current Lineup version, note this but proceed normally. Suggest the user
run `{{CMD_CONFIGURE}}` to review their customizations if the major version changed.

### Ollama Detection

Check whether Ollama is available for use by researcher agents.

1. Check if `{{OLLAMA_CONFIG_PATH}}` exists. If the file does not exist or cannot be
   read, set `OLLAMA_AVAILABLE = false` and skip the rest of this section silently.

2. Read the file and parse the YAML. If `enabled` is missing or `false`, set
   `OLLAMA_AVAILABLE = false` and skip silently.

3. If `enabled: true`, verify the MCP server is actually running. Use ToolSearch
   with query `"select:mcp__ollama__ollama_list"` to check if the tool is available.

   a. If the tool is found and calling `mcp__ollama__ollama_list` returns a non-empty
      model list, set `OLLAMA_AVAILABLE = true` and store `OLLAMA_MODEL` from the
      `model` field in the YAML.

   b. If the tool is not found or the call fails, set `OLLAMA_AVAILABLE = false` and log:
      "Warning: Ollama is enabled in config but the MCP server is not available.
      Run `claude mcp add ollama -- npx -y ollama-mcp` to set it up."

Store in working context:
- `OLLAMA_AVAILABLE` — boolean, whether Ollama is ready for use
- `OLLAMA_MODEL` — string, the model name from config (only set when `OLLAMA_AVAILABLE = true`)

---

## Phase 1 — Research

Spawn three `researcher` agents in parallel to scan the codebase. Use the Agent tool
with `subagent_type: "lineup:researcher"` for each.

### Researcher A — Structure & Dependencies

Prompt focus:
- Directory tree (top 2 levels)
- Package manager and dependency files (`package.json`, `Cargo.toml`, `go.mod`, `requirements.txt`, etc.)
- Build system and scripts (Makefile, npm scripts, CI config)
- Key configuration files (`.env.example`, `tsconfig.json`, `docker-compose.yml`, etc.)

### Researcher B — Entry Points & Key Modules

Prompt focus:
- Main entry points (`src/index.*`, `main.*`, `app.*`, `cmd/`, etc.)
- Core module directories and their purpose
- Public API surface (exported functions, routes, commands)
- Data models and schemas

### Researcher C — Tests, Docs & Developer Experience

Prompt focus:
- Test setup and frameworks (test directories, config files, test commands)
- Existing documentation (README, docs/, wiki references)
- Development workflow (how to run, build, test, lint)
- CI/CD pipeline configuration

### Ollama-assisted research

When `OLLAMA_AVAILABLE = true`, augment each researcher spawn as follows:

- Append `mcp__ollama__ollama_chat, mcp__ollama__ollama_generate` to the researcher's
  `tools` list in the Agent spawn call.
- Add the following to each researcher's spawn prompt:

  "You have access to Ollama tools (`mcp__ollama__ollama_chat`,
  `mcp__ollama__ollama_generate`) for delegating text summarization and context
  gathering to a local model (use model: `OLLAMA_MODEL`). Use these for: summarizing large
  documents, pre-digesting verbose documentation, gathering context from long files.
  Do NOT use Ollama for: code analysis, architectural decisions, generating code, or
  any task requiring reasoning about code structure."

### Research output

Each researcher should return a structured summary (bullet lists with file paths).
Cap each researcher's output at ~1500 words. If a researcher's output exceeds this,
compress to key findings with file path references before passing to Phase 2.

---

## Phase 2 — Structure

Spawn a single `architect` agent with `subagent_type: "lineup:architect"`.

Pass all three researcher outputs as context. The architect should organize findings
into a coherent outline for the digest document with these sections:

1. **Project Overview** — what the project does, its purpose, tech stack
2. **Architecture** — high-level structure, main directories, how components relate
3. **Module Breakdown** — each key module with purpose, key files, and public API
4. **Data Flow** — how data moves through the system (requests, events, pipelines)
5. **Key Patterns** — conventions, design patterns, naming conventions used
6. **Getting Started** — how to install, build, run, and test
7. **Contributing** — branch strategy, test requirements, PR conventions (if discoverable)

The architect should return a structured outline with section headers and bullet points
for what each section should contain, referencing specific files and code found by researchers.

---

## Phase 3 — Write

Spawn a single `documenter` agent with `subagent_type: "lineup:documenter"`.

Pass the architect's outline as context. The documenter writes the final markdown file
to the target path (default: `DIGEST.md` at the project root).

### Document requirements

The document MUST begin with this header block:

```markdown
<!-- Auto-generated by Lineup digest. Regenerate with: {{CMD_DIGEST}} -->
```

Followed by the document title and content organized per the architect's outline.

### Writing rules

- Use clear, concise prose — this is for onboarding, not exhaustive documentation
- Include file path references throughout (e.g., "see `src/lib/auth.ts`")
- Use code blocks for commands (build, test, run)
- Keep total length under 500 lines — this is an overview, not a book
- If the target file already exists, overwrite it completely

---

## Completion

After the documenter finishes, report the result:

"Digest written to `<target-path>`. The file can be regenerated anytime with `{{CMD_DIGEST}}`."

No cleanup needed — this skill does not use `.lineup/.ephemeral/` or `.lineup/.cache/`.
