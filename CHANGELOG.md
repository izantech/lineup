# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.0] - 2026-04-13

### Added
- Native-only v3 runtime -- deterministic orchestration, artifact validation, task compilation, retry state, and run persistence now live entirely in the CLI
- Lean skill wrappers -- host commands launch `lineup run --json`, consume NDJSON protocol messages, and relay gate responses via `lineup gate respond`
- Run inspection commands -- `lineup runs`, `show`, `logs`, and `replay`
- Artifact commands -- `lineup validate`, `artifacts show`, `artifacts path`, and `artifacts diff`
- Authoring commands -- `lineup init`, `workflow lint`, `workflow list`, `tactic new`, `tactic list`, and `tactic convert`
- Approval UX -- `lineup approve`, `lineup pending`, typed approval gates, and file-backed gate persistence
- Shell completion generation for bash, zsh, and fish
- Workflow and task visualization commands -- `lineup dag` and `lineup waves`
- Pipeline history command with status, duration, and retry counts
- Persistent run timing (`started_at`, `finished_at`, `duration_ms`) recorded in pipeline state
- Desktop notifications on pipeline completion and failure
- Task-level execution isolation via `lineup run --implement-method task`
- External dogfood fixture corpus for fullstack, library, and monorepo scenarios
- Interactive gates are now the default -- gate types map to readline prompts (approval Y/n, clarify free-text, verify-decision numbered menu); host skills pass `--non-tty` for JSON-RPC protocol mode
- Gate timeout (`lineup run --gate-timeout <seconds>`) -- saves pipeline state as `blocked` on timeout instead of `failed`, enabling clean resume
- Real pre-stage logic -- triage stage analyzes `git diff --stat HEAD` and file count; research stage emits `agent/spawn` protocol messages for researcher agents
- Verification hooks -- auto-detects test/typecheck/lint commands from `package.json` scripts and Makefile targets, runs them before the reviewer agent, feeds structured results (exit code, stdout, stderr, duration) as reviewer context
- Agent output validation -- validates agent outputs against schemas after `agent/done` messages; emits `stage/warning` on failure with optional retry
- Retry UX for failed verification -- `verify-decision` gate presents retry (re-runs failed tasks only within same run), accept with warnings, or abort options
- Progress dashboard (`lineup show --watch`) -- polls pipeline state every 2s with ANSI clearing, shows completed stages with checkmarks, current stage highlighted, elapsed time; exits on terminal status
- Replay command (`lineup replay <run-id>`) -- parses NDJSON protocol artifacts and formats a chronological human-readable narrative with timestamps; supports `--json` for structured output
- Task compiler improvements -- cross-cutting detection (>3 files same extension/directory kept as single task), read-write dependency edges (write scope overlapping read scope produces sequential waves), better wave assignment for parallel execution
- Tactic-to-workflow conversion test suite -- 7 test cases covering basic conversion, gate insertion, optional stages, verification auto-append, duplicate ID resolution, unknown type errors, and variable passthrough

### Changed
- Public docs moved from VitePress under `docs/` to Astro + Starlight under `site/`
- Public site copy and getting-started flows now describe the shipped native engine instead of a planned future state
- Root README now reflects the expanded native CLI surface rather than the early v3 subset

### Removed
- Task Foundry integration, reference adapters, and TF generation commands from the shipped runtime path

### Fixed
- CLI and docs now agree on the current command surface, including `lineup gate respond`
- Release-facing metadata and docs now describe OpenCode support and the native runtime accurately

## [2.2.0] - 2026-04-12

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
- Snapshot threshold terminology clarified — compression threshold (~2 KB, content size management) distinguished from streaming threshold (500 bytes, inline vs file-reference delivery)
- Cache lifecycle fixed — `.lineup/.cache/` preserved on error/abort to support `--from-stage` restarts; only deleted on successful pipeline completion
- Ephemeral file lifecycle fixed — full `.lineup/.ephemeral/` cleanup moved to Pipeline Cleanup (after Stage 7), not after Stage 6, so documenter and Teams-mode spawns can still access earlier files
- Cleanup safety improved — replaced `git status` heuristic with explicit allowlist of Lineup-managed paths (`.lineup/.ephemeral/*.yaml`, `.lineup/.cache/*.yaml`)
- Cache key construction uses structured JSON serialization instead of plain concatenation to prevent hash collisions
- Snapshot naming aligned — stages use `snapshot-<from>-<to>-<hash>.yaml` consistently (removed `implementation-<hash>.yaml` convention)
- Host adapter schema fixed — removed unsupported `gemini` from host enum
- Tactic schema fixed — `tactic` field now individually blocks both `type` and `agent` (previously only blocked the pair together)
- Host-agnostic MCP guidance — configure and digest skills use host-aware MCP setup instructions instead of hardcoded `claude mcp add`
- Template variable fix — replaced hardcoded `AskUserQuestion` with `{{QUESTION_PRIMITIVE}}` in init.core.md
- Terminal width detection fails closed — `tput` failure now disables Teams mode instead of assuming wide terminal
- Ollama config validation added — validates `enabled` (boolean), `model` (non-empty string), `scope` (present) before enabling
- Playbook YAML safety — validation and formatting rules now explicitly reject anchors, aliases, merge keys, and custom tags
- Playbook tactic composition — per-stage collection asks "Direct stage or composed tactic?" first; validation checks tactic references and cycles
- OpenCode `KICKOFF_INIT_PATH` fixed — points to `~/.config/opencode/skills/...` to match actual install location
- Release validation made host-aware — `validateExtractedSource` accepts hosts parameter so pre-OpenCode tags don't fail for Claude/Codex installs
- Ollama appendix metadata headers added to `researcher-ollama.md` and `architect-ollama.md`
- Digest skill adds ephemeral file spillover for large researcher outputs and cleanup step
- Docs: digest command added to all host command lists (Claude, Codex, OpenCode)
- Docs: host-agnostic orchestrator wording, Codex recovery commands, Ollama 4-tool list, Sonnet floor clarification, migration guide updated
- Docs: MD027 lint fixes in stage files, code block language identifier in CONTRIBUTING.md
- Docs: `--from-dir <path>` added to AGENTS.md CLI command signatures

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

[Unreleased]: https://github.com/izantech/lineup/compare/3.0.0...HEAD
[3.0.0]: https://github.com/izantech/lineup/compare/2.2.0...3.0.0
[2.2.0]: https://github.com/izantech/lineup/compare/2.1.1...2.2.0
[2.1.1]: https://github.com/izantech/lineup/compare/2.1.0...2.1.1
[2.1.0]: https://github.com/izantech/lineup/compare/2.0.0...2.1.0
[2.0.0]: https://github.com/izantech/lineup/compare/1.5.0...2.0.0
[1.5.0]: https://github.com/izantech/lineup/compare/1.4.0...1.5.0
[1.4.0]: https://github.com/izantech/lineup/compare/1.3.0...1.4.0
[1.3.0]: https://github.com/izantech/lineup/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/izantech/lineup/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/izantech/lineup/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/izantech/lineup/releases/tag/1.0.0
