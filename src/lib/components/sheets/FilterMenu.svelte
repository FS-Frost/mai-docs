<script lang="ts">
	import { untrack } from 'svelte';
	import { distinctValues } from '../../sheets/filter.ts';
	import type { CondOp } from '../../sheets/model.ts';
	import type { SheetView } from '../../sheets/view.svelte.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import Icon from '../Icon.svelte';

	let { view, col, x, y, onclose }: { view: SheetView; col: number; x: number; y: number; onclose: () => void } = $props();

	const book = untrack(() => view.book);
	const sheet = untrack(() => book.active);
	const values = untrack(() => distinctValues(sheet, col, (r, c) => book.text(sheet, r, c)));
	const current = untrack(() => sheet.filter?.criteria[col]);

	let checked = $state(new Set(current?.values ?? values));
	let search = $state('');
	let op = $state<CondOp | ''>(current?.cond?.op ?? '');
	let condValue = $state(current?.cond?.value ?? '');

	const shown = $derived(values.filter((v) => !search || v.toLowerCase().includes(search.toLowerCase())));
	const allOn = $derived(shown.every((v) => checked.has(v)));

	const OPS: { id: CondOp | ''; label: () => string }[] = [
		{ id: '', label: () => t().sheet.condNone },
		{ id: 'empty', label: () => t().sheet.condEmpty },
		{ id: 'notEmpty', label: () => t().sheet.condNotEmpty },
		{ id: 'contains', label: () => t().sheet.condContains },
		{ id: 'notContains', label: () => t().sheet.condNotContains },
		{ id: 'eq', label: () => t().sheet.condEq },
		{ id: 'ne', label: () => t().sheet.condNe },
		{ id: 'gt', label: () => t().sheet.condGt },
		{ id: 'gte', label: () => t().sheet.condGte },
		{ id: 'lt', label: () => t().sheet.condLt },
		{ id: 'lte', label: () => t().sheet.condLte }
	];

	function toggle(v: string) {
		const n = new Set(checked);
		if (n.has(v)) n.delete(v);
		else n.add(v);
		checked = n;
	}

	function toggleAll() {
		const n = new Set(checked);
		for (const v of shown) {
			if (allOn) n.delete(v);
			else n.add(v);
		}
		checked = n;
	}

	function apply() {
		const all = values.every((v) => checked.has(v));
		book.setFilterCriterion(sheet.id, col, {
			values: all ? undefined : values.filter((v) => checked.has(v)),
			cond: op ? { op, value: condValue } : undefined
		});
		onclose();
	}

	function sort(desc: boolean) {
		const f = sheet.filter;
		if (!f) return;
		book.sort(sheet.id, f.range, col, desc, true);
		onclose();
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-40" role="presentation" onpointerdown={onclose}></div>
<div class="menu fixed z-50 w-64 p-2" style="left:{Math.min(x, innerWidth - 264)}px;top:{Math.min(y + 2, innerHeight - 420)}px" role="dialog" aria-label={t().sheet.filter}>
	<button class="menu-item rounded" onclick={() => sort(false)}><Icon name="sortAsc" size={16} />{t().sheet.sortAsc}</button>
	<button class="menu-item rounded" onclick={() => sort(true)}><Icon name="sortDesc" size={16} />{t().sheet.sortDesc}</button>
	<div class="my-2 border-t border-line"></div>
	<p class="mb-1 text-xs font-medium text-muted">{t().sheet.filterCondition}</p>
	<select class="select mb-1 w-full" bind:value={op}>
		{#each OPS as o (o.id)}<option value={o.id}>{o.label()}</option>{/each}
	</select>
	{#if op && op !== 'empty' && op !== 'notEmpty'}
		<input class="input mb-1 w-full" bind:value={condValue} placeholder={t().common.value} />
	{/if}
	<p class="mt-2 mb-1 text-xs font-medium text-muted">{t().sheet.filterValues}</p>
	<input class="input mb-1 w-full !py-1" type="search" placeholder={t().common.search} bind:value={search} />
	<label class="flex items-center gap-2 px-1 py-0.5 text-sm"><input type="checkbox" checked={allOn} onchange={toggleAll} />{t().sheet.selectAll}</label>
	<div class="max-h-44 overflow-y-auto">
		{#each shown as v (v)}
			<label class="flex items-center gap-2 px-1 py-0.5 text-sm"><input type="checkbox" checked={checked.has(v)} onchange={() => toggle(v)} /><span class="truncate">{v || t().sheet.blank}</span></label>
		{/each}
	</div>
	<div class="mt-2 flex justify-end gap-2">
		<button class="btn" onclick={onclose}>{t().common.cancel}</button>
		<button class="btn btn-primary" onclick={apply}>{t().common.apply}</button>
	</div>
</div>
