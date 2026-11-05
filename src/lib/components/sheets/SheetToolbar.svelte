<script lang="ts">
	import { promptDialog } from '../../client/dialogs.svelte.ts';
	import { dep } from '../../client/dep.ts';
	import * as A from '../../sheets/actions.ts';
	import { presetOf, type FmtPreset } from '../../sheets/format.ts';
	import type { SheetView } from '../../sheets/view.svelte.ts';
	import { i18n, t } from '../../i18n/index.svelte.ts';
	import ColorPicker from '../ColorPicker.svelte';
	import Icon, { type IconName } from '../Icon.svelte';
	import Menu from '../Menu.svelte';

	let { view }: { view: SheetView } = $props();
	const book = $derived(view.book);

	const st = $derived(dep(book.rev, dep(view.active, view.styleHere)));
	// Shallow copy per revision: the Sheet object is mutated in place, a new reference makes dependents update.
	const sheet = $derived(dep(book.rev, { ...book.active }));
	const preset = $derived(presetOf(st.numFmt, i18n.locale));

	const FONTS = ['Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Courier New'];
	const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
	const PRESETS: { id: FmtPreset; label: () => string; sample: string }[] = [
		{ id: 'general', label: () => t().sheet.fmtGeneral, sample: '' },
		{ id: 'number', label: () => t().sheet.fmtNumber, sample: i18n.locale === 'es' ? '1.000,12' : '1,000.12' },
		{ id: 'currency', label: () => t().sheet.fmtCurrency, sample: i18n.locale === 'es' ? '$1.000,12' : '$1,000.12' },
		{ id: 'percent', label: () => t().sheet.fmtPercent, sample: '10,12%'.replace(',', i18n.locale === 'es' ? ',' : '.') },
		{ id: 'date', label: () => t().sheet.fmtDate, sample: i18n.locale === 'es' ? '31/12/2025' : '12/31/2025' },
		{ id: 'time', label: () => t().sheet.fmtTime, sample: i18n.locale === 'es' ? '15:59:00' : '3:59:00 PM' },
		{ id: 'datetime', label: () => t().sheet.fmtDateTime, sample: i18n.locale === 'es' ? '31/12/2025 15:59' : '12/31/2025 3:59 PM' },
		{ id: 'text', label: () => t().sheet.fmtText, sample: 'abc' }
	];

	async function custom() {
		const code = await promptDialog(t().sheet.customFormat, st.numFmt ?? '#,##0.00');
		if (code) A.setNumFmt(view, { code });
		view.focusTick++;
	}

	type Btn = { icon: IconName; label: string; run: () => void; active?: boolean };
	const marks = $derived<Btn[]>([
		{ icon: 'bold', label: `${t().sheet.bold} (Ctrl+B)`, run: () => A.toggleStyle(view, 'bold'), active: !!st.bold },
		{ icon: 'italic', label: `${t().sheet.italic} (Ctrl+I)`, run: () => A.toggleStyle(view, 'italic'), active: !!st.italic },
		{ icon: 'underline', label: `${t().sheet.underline} (Ctrl+U)`, run: () => A.toggleStyle(view, 'underline'), active: !!st.underline },
		{ icon: 'strike', label: t().sheet.strike, run: () => A.toggleStyle(view, 'strike'), active: !!st.strike }
	]);
	const hAligns = $derived<Btn[]>([
		{ icon: 'alignLeft', label: t().sheet.alignLeft, run: () => A.setStyle(view, { hAlign: st.hAlign === 'left' ? undefined : 'left' }), active: st.hAlign === 'left' },
		{ icon: 'alignCenter', label: t().sheet.alignCenter, run: () => A.setStyle(view, { hAlign: st.hAlign === 'center' ? undefined : 'center' }), active: st.hAlign === 'center' },
		{ icon: 'alignRight', label: t().sheet.alignRight, run: () => A.setStyle(view, { hAlign: st.hAlign === 'right' ? undefined : 'right' }), active: st.hAlign === 'right' }
	]);
	const vAligns = $derived<Btn[]>([
		{ icon: 'vTop', label: t().sheet.vTop, run: () => A.setStyle(view, { vAlign: 'top' }), active: st.vAlign === 'top' },
		{ icon: 'vMiddle', label: t().sheet.vMiddle, run: () => A.setStyle(view, { vAlign: 'middle' }), active: st.vAlign === 'middle' },
		{ icon: 'vBottom', label: t().sheet.vBottom, run: () => A.setStyle(view, { vAlign: undefined }), active: !st.vAlign || st.vAlign === 'bottom' }
	]);
	const merged = $derived(sheet.merges.some((m) => m.r1 <= view.primary.r2 && view.primary.r1 <= m.r2 && m.c1 <= view.primary.c2 && view.primary.c1 <= m.c2));

	const after = (fn: () => void) => () => {
		fn();
		view.focusTick++;
	};
</script>

{#snippet btn(b: Btn)}
	<button class="tb" title={b.label} aria-label={b.label} aria-pressed={b.active ?? undefined} onmousedown={(e) => e.preventDefault()} onclick={after(b.run)}><Icon name={b.icon} /></button>
{/snippet}

<div class="no-print flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 py-1 [scrollbar-width:thin] md:flex-wrap md:overflow-visible" role="toolbar" aria-label={t().doc.format}>
	<button class="tb" title="{t().sheet.undo} (Ctrl+Z)" aria-label={t().sheet.undo} disabled={!book.canUndo} onclick={after(() => book.undo())}><Icon name="undo" /></button>
	<button class="tb" title="{t().sheet.redo} (Ctrl+Y)" aria-label={t().sheet.redo} disabled={!book.canRedo} onclick={after(() => book.redo())}><Icon name="redo" /></button>
	<span class="tb-sep"></span>
	{@render btn({ icon: 'currency', label: t().sheet.fmtCurrency, run: () => A.setNumFmt(view, 'currency'), active: preset === 'currency' })}
	{@render btn({ icon: 'percent', label: t().sheet.fmtPercent, run: () => A.setNumFmt(view, 'percent'), active: preset === 'percent' })}
	{@render btn({ icon: 'decDec', label: t().sheet.decimalsDec, run: () => A.decimals(view, -1) })}
	{@render btn({ icon: 'decInc', label: t().sheet.decimalsInc, run: () => A.decimals(view, 1) })}
	<Menu label="123" title={t().sheet.numFmt} triggerClass="tb gap-0.5 px-1.5 font-mono text-xs">
		{#snippet children(close)}
			{#each PRESETS as p (p.id)}
				<button class="menu-item" aria-pressed={preset === p.id} onclick={() => (close(), A.setNumFmt(view, p.id), view.focusTick++)}>
					<span class="w-4">{#if preset === p.id}<Icon name="check" size={14} />{/if}</span>
					<span class="flex-1">{p.label()}</span>
					<span class="text-xs text-faint">{p.sample}</span>
				</button>
			{/each}
			<button class="menu-item" onclick={() => (close(), custom())}>
				<span class="w-4">{#if preset === 'custom'}<Icon name="check" size={14} />{/if}</span>{t().sheet.fmtCustom}
				{#if preset === 'custom'}<span class="ml-auto font-mono text-xs text-faint">{st.numFmt}</span>{/if}
			</button>
		{/snippet}
	</Menu>
	<span class="tb-sep"></span>
	<select
		class="select w-28 shrink-0"
		aria-label={t().sheet.font}
		title={t().sheet.font}
		value={st.font ?? ''}
		onchange={(e) => {
			A.setStyle(view, { font: (e.currentTarget as HTMLSelectElement).value || undefined });
			view.focusTick++;
		}}
	>
		<option value="">Arial</option>
		{#each FONTS.slice(1) as f (f)}<option value={f}>{f}</option>{/each}
	</select>
	<select
		class="select w-14 shrink-0"
		aria-label={t().sheet.size}
		title={t().sheet.size}
		value={String(st.size ?? '')}
		onchange={(e) => {
			const v = Number((e.currentTarget as HTMLSelectElement).value);
			A.setStyle(view, { size: v && v !== 10 ? v : undefined });
			view.focusTick++;
		}}
	>
		<option value="">10</option>
		{#each SIZES.filter((s) => s !== 10) as s (s)}<option value={String(s)}>{s}</option>{/each}
	</select>
	<span class="tb-sep"></span>
	{#each marks as b (b.icon)}{@render btn(b)}{/each}
	<Menu title={t().sheet.textColor} triggerClass="tb gap-0">
		{#snippet icon()}<span class="flex flex-col items-center"><Icon name="color" size={16} /><span class="-mt-0.5 h-1 w-4 rounded-sm" style="background:{st.color ?? 'currentColor'}"></span></span>{/snippet}
		{#snippet children(close)}<ColorPicker
				close={() => (close(), view.focusTick++)}
				onpick={(c) => A.setStyle(view, { color: c ?? undefined })}
			/>{/snippet}
	</Menu>
	<Menu title={t().sheet.fill} triggerClass="tb gap-0">
		{#snippet icon()}<span class="flex flex-col items-center"><Icon name="fill" size={16} /><span class="-mt-0.5 h-1 w-4 rounded-sm border border-line" style="background:{st.fill ?? 'transparent'}"></span></span>{/snippet}
		{#snippet children(close)}<ColorPicker close={() => (close(), view.focusTick++)} onpick={(c) => A.setStyle(view, { fill: c ?? undefined })} />{/snippet}
	</Menu>
	<Menu title={t().sheet.borders} triggerClass="tb gap-0">
		{#snippet icon()}<Icon name="border" />{/snippet}
		{#snippet children(close)}
			{#each [['all', t().sheet.borderAll], ['outer', t().sheet.borderOuter], ['top', t().sheet.borderTop], ['bottom', t().sheet.borderBottom], ['left', t().sheet.borderLeft], ['right', t().sheet.borderRight], ['none', t().sheet.borderNone]] as [id, label] (id)}
				<button class="menu-item" onclick={() => (close(), A.borders(view, id as A.BorderPreset), view.focusTick++)}><Icon name={id === 'none' ? 'borderNone' : 'border'} size={16} />{label}</button>
			{/each}
		{/snippet}
	</Menu>
	<span class="tb-sep"></span>
	{#each hAligns as b (b.icon)}{@render btn(b)}{/each}
	{#each vAligns as b (b.icon)}{@render btn(b)}{/each}
	{@render btn({ icon: 'wrap', label: t().sheet.wrap, run: () => A.toggleStyle(view, 'wrap'), active: !!st.wrap })}
	{@render btn({ icon: 'merge', label: merged ? t().sheet.unmerge : t().sheet.merge, run: () => A.mergeToggle(view), active: merged })}
	<span class="tb-sep"></span>
	<Menu title={t().sheet.freeze} triggerClass="tb gap-0 {sheet.freeze.rows || sheet.freeze.cols ? 'text-accent' : ''}">
		{#snippet icon()}<Icon name="freeze" />{/snippet}
		{#snippet children(close)}
			<button class="menu-item" onclick={() => (close(), A.freeze(view, 0, 0), view.focusTick++)}>{t().sheet.freezeNone}</button>
			{#each [1, 2] as n (n)}
				<button class="menu-item" aria-pressed={sheet.freeze.rows === n} onclick={() => (close(), A.freeze(view, n, sheet.freeze.cols), view.focusTick++)}>{t().sheet.freezeRows(n)}</button>
			{/each}
			{#each [1, 2] as n (n)}
				<button class="menu-item" aria-pressed={sheet.freeze.cols === n} onclick={() => (close(), A.freeze(view, sheet.freeze.rows, n), view.focusTick++)}>{t().sheet.freezeCols(n)}</button>
			{/each}
			<button class="menu-item" onclick={() => (close(), A.freeze(view, view.active.r, view.active.c), view.focusTick++)}>{t().sheet.freezeHere}</button>
		{/snippet}
	</Menu>
	{@render btn({ icon: 'sortAsc', label: t().sheet.sortAsc, run: () => A.sort(view, false) })}
	{@render btn({ icon: 'sortDesc', label: t().sheet.sortDesc, run: () => A.sort(view, true) })}
	{@render btn({ icon: 'filter', label: sheet.filter ? t().sheet.removeFilter : t().sheet.filter, run: () => A.toggleFilter(view), active: !!sheet.filter })}
	{@render btn({ icon: 'clear', label: t().sheet.clearFormats, run: () => book.clear(sheet.id, view.ranges, 'formats') })}
</div>
