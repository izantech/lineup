import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  title: 'Lineup',
  description: 'Structured multi-agent workflow for Claude Code and Codex CLI',
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]
  ],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started/installation' },
      { text: 'Reference', link: '/reference/agents' },
      { text: 'Changelog', link: 'https://github.com/izantech/lineup/blob/main/CHANGELOG.md' }
    ],

    sidebar: {
      '/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Your First Task', link: '/getting-started/first-task' },
            { text: 'Next Steps', link: '/getting-started/next-steps' }
          ]
        },
        {
          text: 'Concepts',
          items: [
            { text: 'The Pipeline', link: '/concepts/pipeline' },
            { text: 'Agents', link: '/concepts/agents' },
            { text: 'Skills', link: '/concepts/skills' },
            { text: 'Tactics', link: '/concepts/tactics' },
            { text: 'Built-in Tactics', link: '/concepts/built-in-tactics' },
            { text: 'Pipeline Tiers', link: '/concepts/pipeline-tiers' },
            { text: 'Ephemeral Documents', link: '/concepts/ephemeral-documents' },
            { text: 'Context Efficiency', link: '/concepts/context-efficiency' }
          ]
        },
        {
          text: 'How-To Guides',
          items: [
            { text: 'Run Kick-off', link: '/guides/run-kick-off' },
            { text: 'Create a Tactic', link: '/guides/create-tactic' },
            { text: 'Customize Agents', link: '/guides/customize-agents' },
            { text: 'Use Explain', link: '/guides/use-explain' },
            { text: 'Use Playbook', link: '/guides/use-playbook' },
            { text: 'Choose a Pipeline Tier', link: '/guides/choose-tier' }
          ]
        },
        {
          text: 'Reference',
          items: [
            { text: 'CLI Manager', link: '/reference/cli' },
            { text: 'Agent Configuration', link: '/reference/agents' },
            { text: 'Tactic Schema', link: '/reference/tactic-schema' },
            { text: 'Skill Commands', link: '/reference/skills' },
            { text: 'Document Templates', link: '/reference/templates' },
            { text: 'Plugin Manifest', link: '/reference/plugin-manifest' },
            { text: 'Host File Generation', link: '/reference/host-file-generation' },
            { text: 'Stage Output Styling', link: '/reference/stage-output-styling' }
          ]
        },
        {
          text: 'Examples',
          items: [
            { text: 'Feature Development', link: '/examples/feature-development' },
            { text: 'Bug Triage', link: '/examples/bug-triage' },
            { text: 'Documentation Generation', link: '/examples/documentation-generation' },
            { text: 'Codebase Explanation', link: '/examples/codebase-explanation' },
            { text: 'API Feature', link: '/examples/api-feature' },
            { text: 'Targeted Refactor', link: '/examples/targeted-refactor' },
            { text: 'Security Audit', link: '/examples/security-audit' },
            { text: 'Performance Optimization', link: '/examples/performance-optimization' },
            { text: 'Test Coverage', link: '/examples/test-coverage' }
          ]
        },
        {
          text: 'Troubleshooting',
          link: '/troubleshooting'
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/izantech/lineup' }
    ],

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/izantech/lineup/edit/main/docs/:path'
    }
  },

  mermaid: {},
  mermaidPlugin: {
    class: 'mermaid'
  }
}))
