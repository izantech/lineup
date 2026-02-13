# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-02-13

### Added
- Tactics: per-project reusable workflows in `.lineup/tactics/` (YAML)
- Tactic schema template (`templates/tactic.yaml`)
- Stage 0 (Tactic Resolution) in kick-off skill -- auto-discovers and presents tactics
- Variable prompting for parameterized tactics
- Custom verification criteria support in tactics
- AskUserQuestion-based tactic selection when multiple tactics exist
- brownfield-docs example tactic in README
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

[1.2.0]: https://github.com/izantech/lineup/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/izantech/lineup/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/izantech/lineup/releases/tag/1.0.0
