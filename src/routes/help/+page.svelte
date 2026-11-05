<script lang="ts">
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { t } from '#lib/i18n/index.svelte.ts';

	const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
	const k = $derived(t().help.keys);
	const general = $derived([
		[`${mod}+S`, k.save],
		[`${mod}+F / ${mod}+H`, k.find],
		[`${mod}+P`, k.print],
		[`${mod}+Z / ${mod}+Y`, k.undoRedo]
	]);
	const docs = $derived([
		[`${mod}+B / I / U`, k.bold],
		[`${mod}+Alt+1–3 / ${mod}+Alt+0`, k.heading],
		[`${mod}+Shift+8 / 7`, k.lists]
	]);
	const sheets = $derived([
		['← ↑ → ↓', k.move],
		[`${mod}+←↑→↓`, k.jump],
		['Shift+←↑→↓', k.select],
		['F2 / Enter', k.edit],
		['Enter / Tab', k.commit],
		['Esc', k.cancel],
		['Delete / Backspace', k.clear],
		[`${mod}+C / X / V`, k.copy],
		[`${mod}+A`, k.selectAll],
		[`${mod}+B / I / U`, k.bold]
	]);
</script>

<AppHeader />

<main class="mx-auto max-w-3xl space-y-5 px-4 pt-6 pb-10">
	<h1 class="text-xl font-semibold">{t().help.title}</h1>
	<p class="text-sm text-muted">{t().help.storageText}</p>
	{#each [{ title: t().help.general, rows: general }, { title: t().help.docs, rows: docs }, { title: t().help.sheets, rows: sheets }] as sec (sec.title)}
		<section class="rounded-xl border border-line bg-surface p-4">
			<h2 class="mb-2 font-medium">{sec.title}</h2>
			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
				{#each sec.rows as [keys, desc] (keys)}
					<dt><kbd class="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">{keys}</kbd></dt>
					<dd class="text-muted">{desc}</dd>
				{/each}
			</dl>
		</section>
	{/each}
	<section class="rounded-xl border border-line bg-surface p-4">
		<h2 class="mb-2 font-medium">{t().help.formulas}</h2>
		<p class="text-sm text-muted">{t().help.formulasText}</p>
	</section>
</main>
