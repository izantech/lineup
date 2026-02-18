export const GENERATED_BANNER = "<!-- AUTO-GENERATED. Edit canonical source in .lineup-core/. -->";

export const LINEUP_PLUGIN_NAME = "lineup";
export const CLAUDE_LEGACY_PLUGIN = "lineup@izantech";
export const CLAUDE_LOCAL_MARKETPLACE_NAME = "lineup-local";
export const CLAUDE_LOCAL_PLUGIN = `${LINEUP_PLUGIN_NAME}@${CLAUDE_LOCAL_MARKETPLACE_NAME}`;

export const SUPPORTED_HOSTS = ["claude", "codex"] as const;

export type HostName = (typeof SUPPORTED_HOSTS)[number];

export const CODEX_SKILL_DIRS = [
  "lineup-kick-off",
  "lineup-configure",
  "lineup-explain",
  "lineup-playbook"
] as const;

export const CODEX_REQUIRED_FILES = [
  ".agents/skills/lineup-kick-off/SKILL.md",
  ".agents/skills/lineup-kick-off/INIT.md",
  ".agents/skills/lineup-configure/SKILL.md",
  ".agents/skills/lineup-explain/SKILL.md",
  ".agents/skills/lineup-playbook/SKILL.md"
] as const;

export const HOST_TEMPLATE_SPECS = [
  {
    source: ".lineup-core/skills/kick-off/core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_KICKOFF}}/SKILL.md",
      codex: ".agents/skills/{{SKILL_NAME_KICKOFF}}/SKILL.md"
    }
  },
  {
    source: ".lineup-core/skills/kick-off/init.core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_KICKOFF}}/INIT.md",
      codex: ".agents/skills/{{SKILL_NAME_KICKOFF}}/INIT.md"
    }
  },
  {
    source: ".lineup-core/skills/configure/core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_CONFIGURE}}/SKILL.md",
      codex: ".agents/skills/{{SKILL_NAME_CONFIGURE}}/SKILL.md"
    }
  },
  {
    source: ".lineup-core/skills/explain/core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_EXPLAIN}}/SKILL.md",
      codex: ".agents/skills/{{SKILL_NAME_EXPLAIN}}/SKILL.md"
    }
  },
  {
    source: ".lineup-core/skills/playbook/core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_PLAYBOOK}}/SKILL.md",
      codex: ".agents/skills/{{SKILL_NAME_PLAYBOOK}}/SKILL.md"
    }
  }
] as const;
