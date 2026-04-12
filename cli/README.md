# @izantech/lineup-cli

CLI manager for installing, updating, checking, and running Lineup across Claude Code, Codex, and OpenCode.

## Commands

- `lineup install [--host claude|codex|all] [--version <tag>|latest] [--yes]`
- `lineup update [--host claude|codex|all] [--version <tag>|latest] [--yes]`
- `lineup uninstall [--host claude|codex|all] [--yes] [--purge]`
- `lineup status [--host claude|codex|opencode|all] [--artifacts] [--json]`
- `lineup doctor [--json]`
- `lineup run [--workflow <path>] [--engine auto|native|tf] [--dry-run] [--json]`
