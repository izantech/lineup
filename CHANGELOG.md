# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.3.0]: https://github.com/izantech/lineup/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/izantech/lineup/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/izantech/lineup/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/izantech/lineup/releases/tag/1.0.0
