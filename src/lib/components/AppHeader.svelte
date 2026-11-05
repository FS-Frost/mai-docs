<script lang="ts">
	import { page } from '$app/state';
	import { routePath, withBase } from '../client/base.ts';
	import { t } from '../i18n/index.svelte.ts';
	import Icon from './Icon.svelte';
	import Logo from './Logo.svelte';

	const path = $derived(routePath(page.url.pathname));
	const links = $derived([
		{ href: '/', label: t().nav.library, icon: 'open' as const },
		{ href: '/help', label: t().nav.help, icon: 'help' as const },
		{ href: '/settings', label: t().nav.settings, icon: 'settings' as const }
	]);
</script>

<header class="sticky top-0 z-30 border-b border-line bg-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur">
	<div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
		<a href={withBase('/')} class="flex items-center gap-2 font-semibold text-fg">
			<Logo size={28} />
			<span class="text-[1.05rem]">{t().app.name}</span>
		</a>
		<nav class="ml-auto flex items-center gap-1">
			{#each links as l (l.href)}
				<a href={withBase(l.href)} class="tb gap-1.5 px-2.5 {path === l.href ? 'bg-accent-soft text-accent' : ''}" aria-current={path === l.href ? 'page' : undefined}>
					<Icon name={l.icon} />
					<span class="hidden sm:inline">{l.label}</span>
				</a>
			{/each}
		</nav>
	</div>
</header>
