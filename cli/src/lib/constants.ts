export const GENERATED_BANNER = "<!-- AUTO-GENERATED. Edit canonical source in .lineup-core/. -->";

export const LINEUP_PLUGIN_NAME = "lineup";
export const CLAUDE_LEGACY_PLUGIN = "lineup@izantech";
export const CLAUDE_LOCAL_MARKETPLACE_NAME = "lineup-local";
export const CLAUDE_LOCAL_PLUGIN = `${LINEUP_PLUGIN_NAME}@${CLAUDE_LOCAL_MARKETPLACE_NAME}`;

export const SUPPORTED_HOSTS = ["claude", "codex", "opencode"] as const;

export type HostName = (typeof SUPPORTED_HOSTS)[number];

export const CODEX_SKILL_DIRS = [
  "lineup-kick-off",
  "lineup-configure",
  "lineup-explain",
  "lineup-playbook",
  "lineup-digest"
] as const;

export const CODEX_REQUIRED_FILES = [
  ".agents/skills/lineup-kick-off/SKILL.md",
  ".agents/skills/lineup-kick-off/INIT.md",
  ".agents/skills/lineup-kick-off/STAGES-1-3.md",
  ".agents/skills/lineup-kick-off/STAGES-4-5.md",
  ".agents/skills/lineup-kick-off/STAGES-6-7.md",
  ".agents/skills/lineup-configure/SKILL.md",
  ".agents/skills/lineup-explain/SKILL.md",
  ".agents/skills/lineup-playbook/SKILL.md",
  ".agents/skills/lineup-digest/SKILL.md"
] as const;

export const OPENCODE_SKILL_DIRS = [
  "lineup-kick-off",
  "lineup-configure",
  "lineup-explain",
  "lineup-playbook",
  "lineup-digest"
] as const;

export const OPENCODE_REQUIRED_FILES = [
  ".opencode/skills/lineup-kick-off/SKILL.md",
  ".opencode/skills/lineup-kick-off/INIT.md",
  ".opencode/skills/lineup-kick-off/STAGES-1-3.md",
  ".opencode/skills/lineup-kick-off/STAGES-4-5.md",
  ".opencode/skills/lineup-kick-off/STAGES-6-7.md",
  ".opencode/skills/lineup-configure/SKILL.md",
  ".opencode/skills/lineup-explain/SKILL.md",
  ".opencode/skills/lineup-playbook/SKILL.md",
  ".opencode/skills/lineup-digest/SKILL.md"
] as const;

export const HOST_TEMPLATE_SPECS = [
  {
    source: ".lineup-core/skills/kick-off/core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_KICKOFF}}/SKILL.md",
      codex: ".agents/skills/{{SKILL_NAME_KICKOFF}}/SKILL.md",
      opencode: ".opencode/skills/{{SKILL_NAME_KICKOFF}}/SKILL.md"
    }
  },
  {
    source: ".lineup-core/skills/kick-off/init.core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_KICKOFF}}/INIT.md",
      codex: ".agents/skills/{{SKILL_NAME_KICKOFF}}/INIT.md",
      opencode: ".opencode/skills/{{SKILL_NAME_KICKOFF}}/INIT.md"
    }
  },
  {
    source: ".lineup-core/skills/kick-off/stages-1-3.core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_KICKOFF}}/STAGES-1-3.md",
      codex: ".agents/skills/{{SKILL_NAME_KICKOFF}}/STAGES-1-3.md",
      opencode: ".opencode/skills/{{SKILL_NAME_KICKOFF}}/STAGES-1-3.md"
    }
  },
  {
    source: ".lineup-core/skills/kick-off/stages-4-5.core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_KICKOFF}}/STAGES-4-5.md",
      codex: ".agents/skills/{{SKILL_NAME_KICKOFF}}/STAGES-4-5.md",
      opencode: ".opencode/skills/{{SKILL_NAME_KICKOFF}}/STAGES-4-5.md"
    }
  },
  {
    source: ".lineup-core/skills/kick-off/stages-6-7.core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_KICKOFF}}/STAGES-6-7.md",
      codex: ".agents/skills/{{SKILL_NAME_KICKOFF}}/STAGES-6-7.md",
      opencode: ".opencode/skills/{{SKILL_NAME_KICKOFF}}/STAGES-6-7.md"
    }
  },
  {
    source: ".lineup-core/skills/configure/core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_CONFIGURE}}/SKILL.md",
      codex: ".agents/skills/{{SKILL_NAME_CONFIGURE}}/SKILL.md",
      opencode: ".opencode/skills/{{SKILL_NAME_CONFIGURE}}/SKILL.md"
    }
  },
  {
    source: ".lineup-core/skills/explain/core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_EXPLAIN}}/SKILL.md",
      codex: ".agents/skills/{{SKILL_NAME_EXPLAIN}}/SKILL.md",
      opencode: ".opencode/skills/{{SKILL_NAME_EXPLAIN}}/SKILL.md"
    }
  },
  {
    source: ".lineup-core/skills/playbook/core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_PLAYBOOK}}/SKILL.md",
      codex: ".agents/skills/{{SKILL_NAME_PLAYBOOK}}/SKILL.md",
      opencode: ".opencode/skills/{{SKILL_NAME_PLAYBOOK}}/SKILL.md"
    }
  },
  {
    source: ".lineup-core/skills/digest/core.md",
    targetFor: {
      claude: "skills/{{SKILL_NAME_DIGEST}}/SKILL.md",
      codex: ".agents/skills/{{SKILL_NAME_DIGEST}}/SKILL.md",
      opencode: ".opencode/skills/{{SKILL_NAME_DIGEST}}/SKILL.md"
    }
  }
] as const;
