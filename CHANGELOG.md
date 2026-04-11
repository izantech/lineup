# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- OpenCode host support -- `lineup install|update|uninstall|status --host opencode` achieves full parity with Claude and Codex; skills install globally to `~/.config/opencode/skills/` as directories with `SKILL.md` (same format as Codex); config overrides and Ollama settings go to `~/.config/opencode/lineup/`; slash commands use no namespace prefix (e.g. `/lineup-kick-off`)
- Staged prompt loading -- orchestrator core split into on-demand stage files (STAGES-1-3.md, STAGES-4-5.md, STAGES-6-7.md) to reduce upfront token cost; each file is self-contained and loaded when entering that stage group
- Effort-based model selection -- triage complexity drives model assignment per agent role (haiku/sonnet/opus); user overrides act as a floor (can upgrade but not downgrade below effort level)
- Context snapshot size threshold (~2 KB) -- snapshots exceeding the threshold are compressed to key findings with file path references before passing downstream
- Stage result caching -- stage outputs cached to `.lineup/.cache/<stage>-<hash>.yaml` for re-run and rollback; supports `--from-stage N` to restart from a specific stage using cached upstream outputs
- Transient file lifecycle -- large intermediate outputs written to `.lineup/.ephemeral/` with downstream agents receiving file path references instead of inline content; cleanup runs after reviewer finishes and in Pipeline Cleanup
- Terminal width detection in kick-off initialization -- Teams mode is automatically disabled on terminals narrower than 80 columns, falling back to standard subagents to avoid layout issues with side-by-side panels
- Inter-stage progress reporting -- orchestrator now shows a one-sentence factual summary after each stage completes
- Team Preamble -- in Teams mode, all agent instruction bodies are written to a single `.lineup/.ephemeral/agent-instructions.md` file; spawn prompts reference the file instead of embedding the full body, reducing per-spawn token cost
- Tactic composition -- stages can reference other tactics via a `tactic` field, enabling composable workflows; includes cycle detection, variable scoping (parent overrides child defaults), and automatic stage count recalculation
- Custom Approval Gates documentation -- default pipeline section now points users to tactics with `gate: approval` for custom approval checkpoints at any stage
- Researcher Write tool -- researcher agents can write intermediate findings to `.lineup/.ephemeral/` when output exceeds ~2 KB, reducing inline context bloat
- Incremental memory migration -- global agent memory files over 50 KB are read incrementally by section headers instead of loading the full file into context
- Ollama integration (opt-in) -- researcher agents can delegate text summarization and context gathering to a local Ollama model; enabled via `/lineup:configure` which writes `~/.claude/lineup/ollama.yaml`; requires `rawveg/ollama-mcp` MCP server; Ollama is never used for code analysis or generation
- Digest skill (`/lineup:digest`) -- standalone codebase overview generator that spawns parallel researchers, structures findings via an architect, and writes a regenerable `DIGEST.md`; supports Ollama-assisted research when enabled
- Lazy agent loading -- orchestrator only reads agent definition files for roles the current pipeline tier will actually spawn; reduces upfront context from all 6 agents (~22 KB) to only the roles needed (as little as ~8 KB for Lightweight tier)
- Snapshot streaming -- inter-stage snapshots exceeding 500 bytes are written to `.lineup/.ephemeral/` and passed as file references instead of inline content, keeping the orchestrator conversation lean
- Conditional Ollama appendices -- researcher and architect Ollama instructions extracted into separate `*-ollama.md` files that are only appended to spawn prompts when `OLLAMA_AVAILABLE = true`; saves ~3.6 KB per agent spawn when Ollama is disabled

### Fixed
- Artifact cleanup now uses `git status` to detect ephemeral files instead of relying on vague heuristics
- Artifact cleanup runs on any pipeline exit (abort, error, or normal completion), not only at Stage 6
- Parallel architect merge now detects file-level conflicts and presents them to the user for resolution
- Developer batch failure handling -- significant issues block dependent batches, independent batches finish, user decides next step
- Memory migration enforces write-then-clean order to prevent data loss on interruption
- Terminal width detection logs a warning when `tput` fails instead of silently assuming wide terminal
- Tactic variable fallback injects a note into affected stage prompts listing unresolved variable references

## [2.1.1] - 2026-03-20

### Fixed
- Release tarball now includes `.claude-plugin` and `tactics` directories required by the Claude host installer (missing in 2.1.0, causing ENOENT on `lineup install --host claude`)

## [2.1.0] - 2026-03-18

### Added
- Claude Code Teams mode -- when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set and `TeamCreate` is available, the kick-off pipeline creates a `lineup` team and spawns all agents as teammates (visible as tmux panes) instead of subagents; falls back to the standard subagent path transparently
- Dual-mode agent spawning section in kick-off skill -- centralized instructions for team mode (read agent `.md`, embed instructions in prompt, pass `team_name`) and subagent mode (unchanged `subagent_type` path)
- `AGENTS_DIR` host adapter variable (`claude.json`, `codex.json`) so team-mode spawns can locate and embed agent definition files at runtime

## [2.0.0] - 2026-02-20

### Added
- Stage 0 (Triage) -- lightweight pre-pipeline orchestrator analysis that classifies task complexity, identifies affected areas, produces targeted search directives, and detects independent areas for parallel planning
- Parallel architect spawning -- when triage detects 2+ independent areas, separate architect agents plan in parallel and the orchestrator merges outputs into a master plan
- Conditional approach analysis -- simple tasks get 1 approach directly (no multi-approach comparison), moderate/complex tasks get 2-3
- New CLI package in `cli/` using TypeScript + Node ESM + Commander
- Public `lineup` command surface:
  - `lineup install [--host claude|codex|all] [--version <tag>|latest] [--yes]`
  - `lineup update [--host claude|codex|all] [--version <tag>|latest] [--yes]`
  - `lineup uninstall [--host claude|codex|all] [--yes] [--purge]`
  - `lineup status [--host claude|codex|all] [--json]`
- Runtime release resolver with tag resolution, cache, tarball checksum verification, and extracted source validation
- Formal schemas in `cli/schemas/`:
  - JSON: host adapters, state, release manifest
  - YAML: tactic schema + agent output document contracts
- Validation tooling:
  - `npm --prefix cli run schema:check`
  - `npm --prefix cli run generate:check`
- CLI tests with Vitest for parsing, host selection, schema restrictions, and status contract shape
- CLI fixtures for sample state and release manifest validation

### Changed
- Researchers now receive triage search targets as focused directives instead of deriving scope from scratch
- Context snapshot table updated: added triage transitions (Triage -> Clarify, Triage -> Research), enriched Clarification Gate -> Plan with triage fields, trimmed Plan -> Verify to `acceptance_criteria` only
- Output compression rules added: `how_it_works` capped at ~500 words, empty YAML sections omitted between stages, structured lists preferred over prose
- Pipeline tiers (Full, Lightweight) now start with Stage 0 (Triage)
- Distribution model is now CLI-only for host installs/updates/uninstalls
- Host-generated skill outputs are install-time artifacts produced from `.lineup-core/**`
- Built-in and example explain tactics now include `verification` criteria to satisfy strict tactic schema validation
- Documentation updated for npm-based CLI installation and cross-host lifecycle management
- CI moved from committed-file drift checks to CLI package checks (typecheck, tests, schema, generation, build)

### Removed
- Committed generated host skill files from `skills/**` and `.agents/skills/**`
- Legacy root installer/generation scripts in `scripts/` (superseded by `cli/`)

## [1.5.0] - 2026-02-16

### Changed
- Default agent memory scope changed from `user` to `project` -- agents now accumulate knowledge per-project instead of globally
- All 6 agent frontmatter files updated: `memory: project`
- Agent instructions now include dual-memory guidance (project-specific vs cross-project knowledge)
- Concrete storage paths defined for all 3 memory scopes: `user` (`~/.claude/agent-memory/<agent>/`), `project` (`~/.claude/projects/<project-path>/agent-memory/<agent>/`), `local` (`.lineup/memory/<agent>/`)
- Documentation updated across all references (AGENTS.md, concepts, reference, guides, troubleshooting, skills)
- Kick-off orchestrator prompt reduced 52% (16.3KB → 7.8KB) by extracting initialization infrastructure into `skills/kick-off/INIT.md`
- Agent files reduced 25-66% each by centralizing shared "Persistent Memory" and "Document Output" sections into AGENTS.md
- Inter-stage context flow restructured with explicit snapshot definitions -- each stage now receives only the upstream YAML sections it needs, not full accumulated context
- Verbose agent prose compressed across researcher, developer, documenter, reviewer, and teacher without losing behavioral constraints
- AskUserQuestion examples removed from kick-off stages 1 and 3 (behavioral instructions retained)
- Tactic template `optional: false` and `gate: null` defaults moved to comment block

### Added
- Automatic memory migration in kick-off skill -- transparently migrates project-specific knowledge from global agent memory to project-scoped memory on first run per project
- `skills/kick-off/INIT.md` -- dedicated initialization file for agent configuration overrides, memory migration, and tactic resolution
- Context snapshot table in kick-off defining exactly what context flows between each stage transition

### Fixed
- Tactic name collision now notified at runtime -- Stage 0 Discovery reports when a project tactic overrides a built-in tactic
- Memory migration safety rules added -- prevents partial writes, duplicate content, and cascading failures during agent memory migration

## [1.4.0] - 2026-02-14

### Added
- Playbook skill (`/lineup:playbook`) -- interactive wizard for creating and editing tactics
- Playbook modes: Create from scratch, Import from examples, Edit existing, Delete
- Full tactic validation: YAML syntax, schema compliance, agent verification, variable cross-references
- Example tactic: `explain-codebase.yaml` -- demonstrates teacher agent and explain stage type
- Example tactic: `dependency-security-audit.yaml` -- security workflows with 2 variables and 2 gates
- Example tactic: `performance-profiling-cycle.yaml` -- performance optimization with 3 variables
- Example tactic: `add-missing-test-coverage.yaml` -- test coverage improvement workflows
- Documentation walkthroughs for all 4 new example tactics
- Playbook skill guide with full wizard walkthrough

### Changed
- Example tactics count: 5 → 9 total
- Agent coverage in examples: 83% → 100% (teacher agent now demonstrated)
- Domains covered: added security, performance, testing, and learning workflows

## [1.3.0] - 2026-02-13

### Added
- Built-in tactics: plugin-shipped tactics available in every project (zero setup)
- Built-in `explain` tactic (`tactics/explain.yaml`) -- consolidates /lineup:explain under the tactic system
- Persistent agent configuration: customizations survive plugin updates
- User override files stored in `~/.claude/lineup/agents/` (YAML, frontmatter-only)
- Version tracking in override files for forward-compatibility
- Override status indicators in configure summary table

### Changed
- /lineup:explain now routes to the built-in `explain` tactic via kick-off
- Tactic resolution checks both project `.lineup/tactics/` and plugin `tactics/` (project wins)
- /lineup:configure writes to user directory instead of editing plugin agent files
- /lineup:kick-off reads user overrides before spawning agents
- Plugin agent .md files are now immutable at runtime
- Reset in configure deletes override files instead of rewriting plugin frontmatter

## [1.2.0] - 2026-02-13

### Added
- Tactics: per-project reusable workflows in `.lineup/tactics/` (YAML)
- Tactic schema template (`templates/tactic.yaml`)
- Stage 0 (Tactic Resolution) in kick-off skill -- auto-discovers and presents tactics
- Variable prompting for parameterized tactics
- Custom verification criteria support in tactics
- AskUserQuestion-based tactic selection when multiple tactics exist
- Tactic orchestration controls: `optional` (ask before running stage) and `gate: approval` (pause after stage)
- Example tactics: brownfield-docs, api-feature, targeted-refactor, bug-triage, full-feature
- Documenter agent (cyan, Opus) -- generates project documentation after implementation
- Teacher agent (magenta, Opus) -- explains codebase components pedagogically
- /lineup:explain skill -- standalone explanation workflow (researcher + teacher)
- Optional Stage 7 (Document) in the main pipeline with user confirmation gate
- Documentation report template (templates/documenter.yaml)
- Explanation template (templates/teacher.yaml)

### Changed
- kick-off skill description updated to mention tactics
- AGENTS.md updated with Tactics architecture section
- Pipeline expanded from 6 to 7 stages (Stage 7 is optional, user-prompted)
- Configure skill now manages 6 agents (was 4)
- Plugin description updated to include Document stage

### Removed
- agentic-workflow.md -- redundant with AGENTS.md and kick-off/SKILL.md

## [1.1.0] - 2026-02-12

### Added
- Color-coded agent visual identification (blue/red/yellow/green)
- AskUserQuestion integration in clarification stages (Stages 1 & 3)
- Parallelization Strategy section in architect agent's plan template
- Architect-driven parallelization decisions (no user prompt needed)
- Clean stage separators using horizontal rules

### Changed
- Stage transitions simplified to match feature-dev style (removed explicit completion messages)
- Agent references in skill instructions use simple backticks without emojis or ANSI codes
- Architect now determines execution strategy (parallel/sequential) in the plan itself

### Fixed
- Agent schema documentation updated to include color field

## [1.0.0] - 2026-02-12

### Added
- Initial Lineup plugin with structured multi-agent workflow
- Four specialized agents: researcher, architect, developer, reviewer
- Two skills: /lineup:kick-off (full pipeline) and /lineup:configure (agent customization)
- Six-stage pipeline: Clarify → Research → Clarification Gate → Plan → Implement → Verify
- Plugin-based architecture with lineup: namespace
- Persistent user-level memory for all agents
- Interactive agent configurator via /lineup:configure skill
- Marketplace distribution via izantech marketplace

[Unreleased]: https://github.com/izantech/lineup/compare/2.1.1...HEAD
[2.1.1]: https://github.com/izantech/lineup/compare/2.1.0...2.1.1
[2.1.0]: https://github.com/izantech/lineup/compare/2.0.0...2.1.0
[2.0.0]: https://github.com/izantech/lineup/compare/1.5.0...2.0.0
[1.5.0]: https://github.com/izantech/lineup/compare/1.4.0...1.5.0
[1.4.0]: https://github.com/izantech/lineup/compare/1.3.0...1.4.0
[1.3.0]: https://github.com/izantech/lineup/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/izantech/lineup/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/izantech/lineup/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/izantech/lineup/releases/tag/1.0.0
