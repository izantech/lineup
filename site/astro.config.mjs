// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://lineup.izantech.app',
	integrations: [
		starlight({
			title: 'Lineup',
			description: 'One pipeline. Every AI coding tool.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/izantech/lineup' }],
			sidebar: [
				{ label: 'Getting Started', slug: 'getting-started' },
				{ label: 'Examples', slug: 'examples' },
				{ label: 'How It Works', slug: 'how-it-works' },
				{ label: 'Migrating from V2', slug: 'migration' },
			],
		}),
	],
});
