<script lang="ts">
	// Right-click menu of the slides canvas: actions for the selected element(s), or for the slide (background).
	import type { Deck } from '../../slides/deck.svelte.ts';
	import { LAYOUTS, type MediaEl, type TableEl } from '../../slides/model.ts';
	import { deleteCol, deleteRow, insertCol, insertRow, merge, split, type CellRange } from '../../slides/table.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import ContextMenu, { type MenuAt } from '../ContextMenu.svelte';
	import Icon from '../Icon.svelte';

	let {
		deck,
		at,
		readonly,
		onclose,
		actions
	}: {
		deck: Deck;
		at: MenuAt | null;
		readonly: boolean;
		onclose: () => void;
		actions: { cut: () => void; copy: () => void; paste: () => void; editText: () => void; editCell: () => void; editChart: () => void; motion: () => void; theme: () => void; replaceIcon: () => void };
	} = $props();

	const sel = $derived(deck.selected);
	const one = $derived(sel.length === 1 ? sel[0] : null);
	const table = $derived(one?.kind === 'table' ? (one as TableEl) : null);
	const cells = $derived<CellRange>(deck.cellSel ?? { r1: 0, c1: 0, r2: 0, c2: 0 });
	const tbl = (fn: (tb: TableEl) => TableEl) => table && deck.updateTable(table.id, fn);
	const ALIGN = [
		['left', 'alignLeft'],
		['center', 'alignCenter'],
		['right', 'alignRight'],
		['top', 'vTop'],
		['middle', 'vMiddle'],
		['bottom', 'vBottom']
	] as const;
	const alignLabel = (k: (typeof ALIGN)[number][0]) => t().slides[`align${k[0].toUpperCase()}${k.slice(1)}` as 'alignLeft'];
</script>

{#snippet sep()}<div class="my-1 border-t border-line"></div>{/snippet}

<ContextMenu {at} {onclose} label={t().ctx.label}>
	{#snippet children(close)}
		{@const run = (fn: () => void) => () => (close(), fn())}
		{#if !sel.length}
			{#if !readonly}<button class="menu-item" onclick={run(actions.paste)}>{t().ctx.paste}</button>{/if}
			<button class="menu-item" onclick={run(() => (deck.selection = deck.slide.elements.filter((x) => !x.locked).map((x) => x.id)))}>{t().ctx.selectAll}</button>
			{#if !readonly}
				{@render sep()}
				<button class="menu-item" onclick={run(() => deck.addSlide('titleBody'))}><Icon name="plus" size={16} />{t().slides.newSlide}</button>
				<div class="px-3 pt-1 pb-0.5 text-xs text-faint">{t().slides.layout}</div>
				{#each LAYOUTS as k (k)}
					<button class="menu-item" aria-pressed={deck.slide.layout === k} onclick={run(() => deck.setLayout(k))}>
						<span class="w-4">{#if deck.slide.layout === k}<Icon name="check" size={14} />{/if}</span>{t().slides.layouts[k]}
					</button>
				{/each}
				{@render sep()}
				<button class="menu-item" onclick={run(actions.theme)}><Icon name="palette" size={16} />{t().slides.theme}</button>
			{/if}
		{:else if readonly}
			<button class="menu-item" onclick={run(actions.copy)}><Icon name="copy" size={16} />{t().ctx.copy}</button>
			<button class="menu-item" onclick={run(() => (deck.selection = deck.slide.elements.filter((x) => !x.locked).map((x) => x.id)))}>{t().ctx.selectAll}</button>
		{:else}
			{#if one?.kind === 'shape' && one.geom !== 'line'}
				<button class="menu-item" onclick={run(actions.editText)}><Icon name="textbox" size={16} />{t().ctx.editText}</button>
				{@render sep()}
			{:else if table}
				<button class="menu-item" onclick={run(actions.editCell)}><Icon name="textbox" size={16} />{t().ctx.editCell}</button>
				{@render sep()}
				<button class="menu-item" onclick={run(() => tbl((tb) => insertRow(tb, cells.r1)))}>{t().slides.insertRowAbove}</button>
				<button class="menu-item" onclick={run(() => tbl((tb) => insertRow(tb, cells.r2 + 1)))}>{t().slides.insertRowBelow}</button>
				<button class="menu-item" onclick={run(() => tbl((tb) => insertCol(tb, cells.c1)))}>{t().slides.insertColLeft}</button>
				<button class="menu-item" onclick={run(() => tbl((tb) => insertCol(tb, cells.c2 + 1)))}>{t().slides.insertColRight}</button>
				<button class="menu-item" disabled={table.rows.length <= 1} onclick={run(() => tbl((tb) => deleteRow(tb, cells.r1)))}>{t().slides.deleteRow}</button>
				<button class="menu-item" disabled={table.cols.length <= 1} onclick={run(() => tbl((tb) => deleteCol(tb, cells.c1)))}>{t().slides.deleteCol}</button>
				<button class="menu-item" disabled={cells.r1 === cells.r2 && cells.c1 === cells.c2} onclick={run(() => tbl((tb) => merge(tb, cells)))}>{t().slides.mergeCells}</button>
				<button class="menu-item" onclick={run(() => tbl((tb) => split(tb, cells.r1, cells.c1)))}>{t().slides.splitCell}</button>
				{@render sep()}
			{:else if one?.kind === 'chart'}
				<button class="menu-item" onclick={run(actions.editChart)}><Icon name="chart" size={16} />{t().chart.edit}</button>
				{@render sep()}
			{:else if one?.kind === 'media'}
				{@const m = one as MediaEl}
				<button class="menu-item" aria-pressed={!!m.autoplay} onclick={run(() => deck.patch([m.id], { autoplay: !m.autoplay } as Partial<MediaEl>))}>
					<Icon name={m.autoplay ? 'check' : 'play'} size={16} />{t().slides.autoplay}
				</button>
				{@render sep()}
			{:else if one?.kind === 'icon'}
				<button class="menu-item" onclick={run(actions.replaceIcon)}><Icon name="sparkle" size={16} />{t().ctx.changeIcon}</button>
				{@render sep()}
			{/if}
			<button class="menu-item" onclick={run(actions.cut)}>{t().ctx.cut}</button>
			<button class="menu-item" onclick={run(actions.copy)}><Icon name="copy" size={16} />{t().ctx.copy}</button>
			<button class="menu-item" onclick={run(actions.paste)}>{t().ctx.paste}</button>
			<button class="menu-item" onclick={run(() => deck.duplicateSelected())}>{t().common.duplicate}</button>
			<button class="menu-item text-bad" onclick={run(() => deck.removeSelected())}><Icon name="trash" size={16} />{t().common.delete}</button>
			{@render sep()}
			<button class="menu-item" onclick={run(() => deck.arrange('front'))}>{t().slides.front}</button>
			<button class="menu-item" onclick={run(() => deck.arrange('forward'))}>{t().slides.forward}</button>
			<button class="menu-item" onclick={run(() => deck.arrange('backward'))}>{t().slides.backward}</button>
			<button class="menu-item" onclick={run(() => deck.arrange('back'))}>{t().slides.back}</button>
			{#if sel.length > 1}
				{@render sep()}
				<div class="px-3 pt-1 pb-0.5 text-xs text-faint">{t().ctx.align}</div>
				<div class="flex px-1">
					{#each ALIGN as [k, icon] (k)}
						<button class="menu-item !w-auto !px-2" title={alignLabel(k)} aria-label={alignLabel(k)} onclick={run(() => deck.align(k))}><Icon name={icon} size={16} /></button>
					{/each}
				</div>
				<button class="menu-item" disabled={sel.length < 3} onclick={run(() => deck.distribute('h'))}>{t().slides.distributeH}</button>
				<button class="menu-item" disabled={sel.length < 3} onclick={run(() => deck.distribute('v'))}>{t().slides.distributeV}</button>
			{/if}
			{@render sep()}
			<button class="menu-item" onclick={run(actions.motion)}><Icon name="animation" size={16} />{t().ctx.animate}</button>
		{/if}
	{/snippet}
</ContextMenu>
