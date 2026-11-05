<script lang="ts">
	// Side panel to edit a chart's type, data range and labels. `onchange(patch)` commits each edit.
	import { untrack } from 'svelte';
	import { PALETTE } from '../../sheets/charts.ts';
	import type { ChartOptions, ChartSource, ChartType } from '../../sheets/model.ts';
	import { theme } from '../../client/theme.svelte.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import Icon from '../Icon.svelte';

	let {
		options,
		source,
		seriesNames,
		validateRange,
		onchange,
		onclose,
		ondelete,
		extra
	}: {
		options: ChartOptions;
		/** Absent for document charts (data is edited separately). */
		source?: ChartSource;
		seriesNames: string[];
		validateRange?: (r: string) => boolean;
		onchange: (patch: Partial<ChartOptions> & { source?: ChartSource }) => void;
		onclose: () => void;
		ondelete?: () => void;
		extra?: import('svelte').Snippet;
	} = $props();

	const TYPES: ChartType[] = ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter'];
	let rangeDraft = $state(untrack(() => source?.range ?? ''));
	let rangeError = $state(false);
	$effect(() => {
		rangeDraft = source?.range ?? '';
	});

	function commitRange() {
		if (!source || rangeDraft.trim() === source.range) return;
		const r = rangeDraft.trim();
		if (validateRange && !validateRange(r)) {
			rangeError = true;
			return;
		}
		rangeError = false;
		onchange({ source: { ...source, range: r } });
	}

	const stackable = $derived(['column', 'bar', 'area', 'line'].includes(options.type));
	const axes = $derived(!['pie', 'doughnut'].includes(options.type));
	const pal = $derived(PALETTE[theme.resolved === 'dark' ? 'dark' : 'light']);
	const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
</script>

<aside class="no-print flex h-full w-80 shrink-0 flex-col border-l border-line bg-surface" aria-label={t().chart.edit}>
	<div class="flex items-center gap-2 border-b border-line px-3 py-2">
		<Icon name="chart" size={16} />
		<h2 class="flex-1 text-sm font-semibold">{t().chart.edit}</h2>
		<button class="tb" aria-label={t().common.close} title={t().common.close} onclick={onclose}><Icon name="x" size={16} /></button>
	</div>
	<div class="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
		<fieldset>
			<legend class="mb-1.5 text-xs font-medium text-muted">{t().chart.type}</legend>
			<div class="grid grid-cols-4 gap-1">
				{#each TYPES as ty (ty)}
					<button class="rounded border px-1 py-1.5 text-xs {options.type === ty ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:bg-surface-2'}" aria-pressed={options.type === ty} onclick={() => onchange({ type: ty })}>{t().chart.types[ty]}</button>
				{/each}
			</div>
		</fieldset>
		{#if stackable}
			<label class="block">
				<span class="mb-1 block text-xs font-medium text-muted">{t().chart.stacking}</span>
				<select class="select w-full" value={options.stacked === 'percent' ? 'percent' : options.stacked ? 'normal' : 'none'} onchange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					onchange({ stacked: v === 'percent' ? 'percent' : v === 'normal' ? true : undefined });
				}}>
					<option value="none">{t().chart.stackNone}</option>
					<option value="normal">{t().chart.stackNormal}</option>
					<option value="percent">{t().chart.stackPercent}</option>
				</select>
			</label>
		{/if}
		{#if source}
			<label class="block">
				<span class="mb-1 block text-xs font-medium text-muted">{t().chart.range}</span>
				<input class="input w-full font-mono text-xs" bind:value={rangeDraft} aria-invalid={rangeError} onblur={commitRange} onkeydown={(e) => e.key === 'Enter' && commitRange()} />
				{#if rangeError}<span class="mt-1 block text-xs text-bad">{t().chart.rangeInvalid}</span>{/if}
			</label>
			<div class="flex items-center gap-2">
				<span class="text-xs font-medium text-muted">{t().chart.seriesIn}</span>
				{#each [['cols', t().chart.seriesCols], ['rows', t().chart.seriesRows]] as [id, label] (id)}
					<button class="rounded border px-2 py-0.5 text-xs {source.seriesIn === id ? 'border-accent bg-accent-soft text-accent' : 'border-line'}" onclick={() => onchange({ source: { ...source, seriesIn: id as 'cols' | 'rows' } })}>{label}</button>
				{/each}
			</div>
			<label class="flex items-center gap-2"><input type="checkbox" checked={source.headerRow} onchange={(e) => onchange({ source: { ...source, headerRow: (e.currentTarget as HTMLInputElement).checked } })} />{t().chart.headerRow}</label>
			<label class="flex items-center gap-2"><input type="checkbox" checked={source.headerCol} onchange={(e) => onchange({ source: { ...source, headerCol: (e.currentTarget as HTMLInputElement).checked } })} />{t().chart.headerCol}</label>
		{/if}
		<label class="block">
			<span class="mb-1 block text-xs font-medium text-muted">{t().chart.titleLabel}</span>
			<input class="input w-full" value={options.title ?? ''} onchange={(e) => onchange({ title: (e.currentTarget as HTMLInputElement).value || undefined })} />
		</label>
		<label class="block">
			<span class="mb-1 block text-xs font-medium text-muted">{t().chart.legend}</span>
			<select class="select w-full" value={options.legend} onchange={(e) => onchange({ legend: (e.currentTarget as HTMLSelectElement).value as ChartOptions['legend'] })}>
				<option value="bottom">{t().chart.legendBottom}</option>
				<option value="top">{t().chart.legendTop}</option>
				<option value="right">{t().chart.legendRight}</option>
				<option value="none">{t().chart.legendNone}</option>
			</select>
		</label>
		{#if axes}
			<label class="block">
				<span class="mb-1 block text-xs font-medium text-muted">{t().chart.xTitle}</span>
				<input class="input w-full" value={options.xTitle ?? ''} onchange={(e) => onchange({ xTitle: (e.currentTarget as HTMLInputElement).value || undefined })} />
			</label>
			<label class="block">
				<span class="mb-1 block text-xs font-medium text-muted">{t().chart.yTitle}</span>
				<input class="input w-full" value={options.yTitle ?? ''} onchange={(e) => onchange({ yTitle: (e.currentTarget as HTMLInputElement).value || undefined })} />
			</label>
			<div class="grid grid-cols-2 gap-2">
				<label>
					<span class="mb-1 block text-xs font-medium text-muted">{t().chart.yMin}</span>
					<input class="input w-full" placeholder={t().chart.auto} value={options.yMin ?? ''} onchange={(e) => onchange({ yMin: num((e.currentTarget as HTMLInputElement).value) })} />
				</label>
				<label>
					<span class="mb-1 block text-xs font-medium text-muted">{t().chart.yMax}</span>
					<input class="input w-full" placeholder={t().chart.auto} value={options.yMax ?? ''} onchange={(e) => onchange({ yMax: num((e.currentTarget as HTMLInputElement).value) })} />
				</label>
			</div>
		{/if}
		{#if seriesNames.length}
			<fieldset>
				<legend class="mb-1.5 text-xs font-medium text-muted">{t().chart.colors}</legend>
				<div class="space-y-1">
					{#each seriesNames as name, i (i)}
						<label class="flex items-center gap-2">
							<input
								type="color"
								class="h-6 w-8 cursor-pointer rounded border border-line bg-transparent"
								value={options.colors?.[i] || pal[i % pal.length]}
								onchange={(e) => {
									const colors = [...(options.colors ?? [])];
									colors[i] = (e.currentTarget as HTMLInputElement).value;
									onchange({ colors });
								}}
							/>
							<span class="truncate">{name}</span>
						</label>
					{/each}
				</div>
				{#if options.colors?.length}<button class="btn btn-ghost mt-1 !px-1 text-xs" onclick={() => onchange({ colors: undefined })}>{t().chart.resetColors}</button>{/if}
			</fieldset>
		{/if}
		{#if extra}{@render extra()}{/if}
		{#if ondelete}
			<button class="btn w-full text-bad" onclick={ondelete}><Icon name="trash" size={16} />{t().object.delete}</button>
		{/if}
	</div>
</aside>
