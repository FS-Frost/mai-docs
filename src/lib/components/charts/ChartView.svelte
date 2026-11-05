<script lang="ts">
	// Live Chart.js chart. Recreated when the type changes, updated in place otherwise.
	import { onDestroy } from 'svelte';
	import type { Chart as ChartT } from 'chart.js';
	import { buildConfig, loadChart, PAPER, themeFromCss, type Theme as ChartTheme } from '../../charts/render.ts';
	import type { ChartData } from '../../sheets/charts.ts';
	import type { ChartOptions } from '../../sheets/model.ts';
	import { theme } from '../../client/theme.svelte.ts';
	import { i18n, t } from '../../i18n/index.svelte.ts';

	let { options, data, paper = false, label, colors, animate = true }: { options: ChartOptions; data: ChartData; paper?: boolean; label?: string; colors?: ChartTheme; animate?: boolean } = $props();

	let canvas = $state<HTMLCanvasElement>();
	let chart: ChartT | null = null;
	let chartType = '';

	$effect(() => {
		const cfg = buildConfig($state.snapshot(options) as ChartOptions, $state.snapshot(data) as ChartData, colors ?? (paper ? PAPER : themeFromCss(theme.resolved === 'dark')), i18n.locale);
		if (!animate) cfg.options = { ...cfg.options, animation: false };
		const el = canvas;
		if (!el) return;
		let cancelled = false;
		void loadChart().then((Chart) => {
			if (cancelled) return;
			const ty = `${cfg.type}|${(cfg.options as { indexAxis?: string }).indexAxis}`;
			if (chart && chartType === ty) {
				chart.data = cfg.data;
				chart.options = cfg.options as never;
				chart.update('none');
			} else {
				chart?.destroy();
				chart = new Chart(el, cfg);
				chartType = ty;
			}
		});
		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => chart?.destroy());

	const empty = $derived(data.error === 'ref' ? t().chart.badRange : data.error === 'empty' ? t().chart.noData : null);
</script>

<div class="relative h-full w-full" role="img" aria-label={label ?? options.title ?? t().chart.chart}>
	<canvas bind:this={canvas}></canvas>
	{#if empty}
		<div class="absolute inset-0 grid place-items-center p-3 text-center text-xs {paper ? 'text-[#52514e]' : 'text-muted'}">{empty}</div>
	{/if}
</div>
