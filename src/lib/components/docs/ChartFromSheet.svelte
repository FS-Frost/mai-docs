<script lang="ts">
	// Picks a chart from a spreadsheet in the library and returns a copy (options + current data) for a document.
	import { onMount } from 'svelte';
	import ChartView from '../charts/ChartView.svelte';
	import type { DocChartAttrs } from '../../docs/extensions/chart-node.ts';
	import { chartData } from '../../sheets/charts.ts';
	import { displayText } from '../../sheets/format.ts';
	import { fromContent, styleOf, type ChartObject, type Workbook, type WorkbookContent } from '../../sheets/model.ts';
	import { cellKey } from '../../sheets/addr.ts';
	import { getContent, listFiles, type FileMeta } from '../../storage/library.ts';
	import { i18n, t } from '../../i18n/index.svelte.ts';

	let { onpick, onclose }: { onpick: (a: DocChartAttrs) => void; onclose: () => void } = $props();

	let sheets = $state<FileMeta[]>([]);
	let loaded = $state(false);
	let fileId = $state('');
	let wb = $state.raw<Workbook | null>(null);
	let charts = $state.raw<{ sheet: string; chart: ChartObject }[]>([]);
	let chosen = $state<string>('');

	onMount(async () => {
		sheets = (await listFiles()).filter((f) => f.kind === 'sheet' && !f.trashedAt);
		loaded = true;
		if (sheets[0]) void pickFile(sheets[0].id);
	});

	async function pickFile(id: string) {
		fileId = id;
		const c = await getContent<WorkbookContent>(id);
		wb = c ? fromContent(c) : null;
		charts = wb ? wb.sheets.flatMap((s) => s.objects.filter((o): o is ChartObject => o.kind === 'chart').map((chart) => ({ sheet: s.name, chart }))) : [];
		chosen = charts[0]?.chart.id ?? '';
	}

	const text = (s: Parameters<Parameters<typeof chartData>[2]>[0], r: number, c: number) => {
		const cell = s.cells.get(cellKey(r, c));
		return displayText(cell?.v, styleOf(wb!, cell).numFmt, i18n.locale);
	};

	const current = $derived(charts.find((c) => c.chart.id === chosen)?.chart);
	const data = $derived(current && wb ? chartData(wb, current, text) : null);

	function insert() {
		if (!current || !data) return;
		const { type, stacked, title, legend, xTitle, yTitle, yMin, yMax, colors } = current;
		const options = JSON.parse(JSON.stringify({ type, stacked, title, legend, xTitle, yTitle, yMin, yMax, colors }));
		const origin = sheets.find((f) => f.id === fileId)?.title;
		onpick({ options, data: JSON.parse(JSON.stringify(data)), width: Math.min(640, current.w), height: current.h, origin });
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
	<div class="w-full max-w-lg rounded-xl border border-line bg-surface p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="cfs-title">
		<h2 id="cfs-title" class="mb-4 font-semibold">{t().chart.fromSheet}</h2>
		{#if loaded && !sheets.length}
			<p class="text-sm text-muted">{t().chart.noSheets}</p>
		{:else}
			<label class="mb-3 block text-sm">
				<span class="mb-1 block text-muted">{t().chart.pickSheet}</span>
				<select class="select w-full" value={fileId} onchange={(e) => pickFile((e.currentTarget as HTMLSelectElement).value)}>
					{#each sheets as f (f.id)}<option value={f.id}>{f.title}</option>{/each}
				</select>
			</label>
			{#if wb && !charts.length}
				<p class="text-sm text-muted">{t().chart.noCharts}</p>
			{:else if charts.length}
				<label class="mb-3 block text-sm">
					<span class="mb-1 block text-muted">{t().chart.pickChart}</span>
					<select class="select w-full" bind:value={chosen}>
						{#each charts as c, i (c.chart.id)}<option value={c.chart.id}>{c.chart.title || `${t().chart.types[c.chart.type]} ${i + 1}`} — {c.sheet}</option>{/each}
					</select>
				</label>
				{#if current && data}
					<div class="h-56 rounded border border-line bg-white"><ChartView options={current} {data} paper /></div>
				{/if}
			{/if}
		{/if}
		<div class="mt-5 flex justify-end gap-2">
			<button class="btn" onclick={onclose}>{t().common.cancel}</button>
			<button class="btn btn-primary" disabled={!current} onclick={insert}>{t().doc.insert}</button>
		</div>
	</div>
</div>
