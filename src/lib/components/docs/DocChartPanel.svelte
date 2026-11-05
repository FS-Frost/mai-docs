<script lang="ts">
	// Edits a document chart: options (shared ChartPanel) + its copied data as a small table.
	import ChartPanel from '../charts/ChartPanel.svelte';
	import type { DocChartAttrs } from '../../docs/extensions/chart-node.ts';
	import type { ChartData } from '../../sheets/charts.ts';
	import { intlLocale, t } from '../../i18n/index.svelte.ts';
	import Icon from '../Icon.svelte';

	let { attrs, onchange, onclose, ondelete }: { attrs: DocChartAttrs; onchange: (a: DocChartAttrs) => void; onclose: () => void; ondelete: () => void } = $props();

	const data = $derived(attrs.data);
	const setData = (d: ChartData) => onchange({ ...attrs, data: d });
	const parse = (s: string) => {
		const n = Number(s.trim().replace(/\s/g, '').replace(intlLocale() === 'es' ? /\./g : /,/g, '').replace(',', '.'));
		return s.trim() === '' || !Number.isFinite(n) ? null : n;
	};
	const show = (v: number | null) => (v === null ? '' : new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 10, useGrouping: false }).format(v));

	function setLabel(i: number, v: string) {
		const labels = [...data.labels];
		labels[i] = v;
		setData({ ...data, labels });
	}
	function setName(j: number, v: string) {
		setData({ ...data, series: data.series.map((s, k) => (k === j ? { ...s, name: v } : s)) });
	}
	function setValue(j: number, i: number, v: string) {
		setData({ ...data, series: data.series.map((s, k) => (k === j ? { ...s, values: s.values.map((x, m) => (m === i ? parse(v) : x)) } : s)) });
	}
	function addRow() {
		setData({ ...data, labels: [...data.labels, String(data.labels.length + 1)], series: data.series.map((s) => ({ ...s, values: [...s.values, null] })) });
	}
	function removeRow(i: number) {
		setData({ ...data, labels: data.labels.filter((_, k) => k !== i), series: data.series.map((s) => ({ ...s, values: s.values.filter((_, k) => k !== i) })) });
	}
	function addSeries() {
		setData({ ...data, series: [...data.series, { name: `${t().chart.series} ${data.series.length + 1}`, values: data.labels.map(() => null) }] });
	}
	function removeSeries(j: number) {
		setData({ ...data, series: data.series.filter((_, k) => k !== j) });
	}
</script>

<ChartPanel options={attrs.options} seriesNames={data.series.map((s) => s.name)} onchange={(patch) => onchange({ ...attrs, options: { ...attrs.options, ...patch } })} {onclose} {ondelete}>
	{#snippet extra()}
		<fieldset>
			<legend class="mb-1.5 text-xs font-medium text-muted">{t().chart.data}{#if attrs.origin}<span class="font-normal"> · {t().chart.copied} «{attrs.origin}»</span>{/if}</legend>
			<div class="overflow-x-auto rounded border border-line">
				<table class="w-full text-xs">
					<thead>
						<tr class="bg-surface-2">
							<th class="px-1 py-1 text-left font-medium">{t().chart.labels}</th>
							{#each data.series as s, j (j)}
								<th class="min-w-20 px-1 py-1">
									<div class="flex items-center gap-0.5">
										<input class="w-full rounded border border-transparent bg-transparent px-1 font-medium hover:border-line focus:border-accent" value={s.name} aria-label={t().chart.series} onchange={(e) => setName(j, (e.currentTarget as HTMLInputElement).value)} />
										<button class="text-faint hover:text-bad" title={t().chart.removeSeries} aria-label={t().chart.removeSeries} onclick={() => removeSeries(j)}><Icon name="x" size={12} /></button>
									</div>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each data.labels as label, i (i)}
							<tr class="border-t border-line">
								<td class="px-1 py-0.5">
									<div class="flex items-center gap-0.5">
										<button class="text-faint hover:text-bad" title={t().chart.removeRow} aria-label={t().chart.removeRow} onclick={() => removeRow(i)}><Icon name="x" size={12} /></button>
										<input class="w-full rounded border border-transparent bg-transparent px-1 hover:border-line focus:border-accent" value={label} aria-label={t().chart.labels} onchange={(e) => setLabel(i, (e.currentTarget as HTMLInputElement).value)} />
									</div>
								</td>
								{#each data.series as s, j (j)}
									<td class="px-1 py-0.5"><input class="w-full rounded border border-transparent bg-transparent px-1 text-right tabular-nums hover:border-line focus:border-accent" value={show(s.values[i] ?? null)} inputmode="decimal" aria-label="{s.name} {label}" onchange={(e) => setValue(j, i, (e.currentTarget as HTMLInputElement).value)} /></td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="mt-1 flex gap-2">
				<button class="btn !px-2 !py-0.5 text-xs" onclick={addRow}><Icon name="plus" size={12} />{t().chart.addRow}</button>
				<button class="btn !px-2 !py-0.5 text-xs" onclick={addSeries}><Icon name="plus" size={12} />{t().chart.addSeries}</button>
			</div>
		</fieldset>
	{/snippet}
</ChartPanel>
