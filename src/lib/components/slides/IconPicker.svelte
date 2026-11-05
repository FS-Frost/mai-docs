<script lang="ts">
	// Lucide icon picker (set loaded on open; works offline because the chunk is precached).
	import { onMount } from 'svelte';
	import { iconInner, iconWords, loadIcons, type IconNode } from '../../slides/icons.ts';
	import { t } from '../../i18n/index.svelte.ts';

	let { onpick, onclose }: { onpick: (name: string, nodes: IconNode) => void; onclose: () => void } = $props();

	let icons = $state.raw<Record<string, IconNode> | null>(null);
	let q = $state('');
	let input = $state<HTMLInputElement>();
	const LIMIT = 240;

	onMount(() => {
		void loadIcons().then((m) => (icons = m));
		input?.focus();
	});

	const names = $derived(icons ? Object.keys(icons).filter((n) => /^[A-Z]/.test(n) && !n.endsWith('Icon') && !n.startsWith('Lucide')) : []);
	const matches = $derived.by(() => {
		const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const list = words.length ? names.filter((n) => words.every((w) => iconWords(n).includes(w))) : names;
		return list.slice(0, LIMIT);
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
	<div class="flex max-h-[80dvh] w-full max-w-xl flex-col rounded-xl border border-line bg-surface p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ip-title">
		<h2 id="ip-title" class="mb-3 font-semibold">{t().slides.icon}</h2>
		<input bind:this={input} class="input mb-3 w-full" type="search" placeholder={t().slides.iconSearch} aria-label={t().slides.iconSearch} bind:value={q} />
		<div class="min-h-40 flex-1 overflow-y-auto">
			{#if !icons}
				<p class="p-4 text-center text-sm text-muted">{t().common.loading}</p>
			{:else if !matches.length}
				<p class="p-4 text-center text-sm text-muted">{t().slides.iconNoResults}</p>
			{:else}
				<div class="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1">
					{#each matches as n (n)}
						<button class="grid aspect-square place-items-center rounded text-fg hover:bg-surface-2" title={iconWords(n)} aria-label={iconWords(n)} onclick={() => onpick(n, icons![n])}>
							<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html iconInner(icons![n] as [string, Record<string, string>][])}</svg>
						</button>
					{/each}
				</div>
			{/if}
		</div>
		<div class="mt-3 flex justify-end"><button class="btn" onclick={onclose}>{t().common.cancel}</button></div>
	</div>
</div>
