<script lang="ts">
	// Chart block inside the document (node view). Double-click edits; the corner handle resizes.
	import ChartView from '../charts/ChartView.svelte';
	import type { DocChartAttrs } from '../../docs/extensions/chart-node.ts';
	import { t } from '../../i18n/index.svelte.ts';

	let { box, editable, onedit, onresize }: { box: { attrs: DocChartAttrs; selected: boolean }; editable: boolean; onedit: () => void; onresize: (w: number, h: number) => void } = $props();

	let live = $state<{ w: number; h: number } | null>(null);
	let start: { x: number; y: number; w: number; h: number; id: number } | null = null;

	function down(e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
		start = { x: e.clientX, y: e.clientY, w: box.attrs.width, h: box.attrs.height, id: e.pointerId };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		live = { w: Math.max(160, Math.round(start.w + e.clientX - start.x)), h: Math.max(120, Math.round(start.h + e.clientY - start.y)) };
	}
	function up(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		start = null;
		if (live) onresize(live.w, live.h);
		live = null;
	}

	const w = $derived(live?.w ?? box.attrs.width);
	const h = $derived(live?.h ?? box.attrs.height);
</script>

<div
	class="relative my-2 max-w-full rounded border bg-white {box.selected ? 'border-[#3b5bdb] outline-2 outline-[#3b5bdb]' : 'border-[#e2e2e2]'}"
	style="width:{w}px;height:{h}px"
	role="figure"
	aria-label={box.attrs.options.title || t().chart.chart}
	ondblclick={() => editable && onedit()}
>
	<ChartView options={box.attrs.options} data={box.attrs.data} paper />
	{#if editable && box.selected}
		<span
			data-chart-handle
			class="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-full border-2 border-white bg-[#3b5bdb]"
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
			role="presentation"
		></span>
		<button data-chart-handle class="absolute top-1 right-1 rounded bg-[#3b5bdb] px-2 py-0.5 text-xs text-white" onclick={onedit}>{t().chart.edit}</button>
	{/if}
</div>
