<script lang="ts">
	import { confirmDialog, promptDialog } from '../../client/dialogs.svelte.ts';
	import { toast } from '../../client/toast.svelte.ts';
	import { formatGeneral } from '../../sheets/values.ts';
	import { sheetByName, uniqueSheetName, validSheetName } from '../../sheets/model.ts';
	import type { SheetView } from '../../sheets/view.svelte.ts';
	import { intlLocale, t } from '../../i18n/index.svelte.ts';
	import Icon from '../Icon.svelte';
	import { dep } from '../../client/dep.ts';

	let { view, readonly = false }: { view: SheetView; readonly?: boolean } = $props();
	const book = $derived(view.book);

	let menu = $state<{ id: string; x: number; y: number } | null>(null);

	const sheets = $derived(dep(book.rev, book.wb.sheets.map((s) => ({ id: s.id, name: s.name }))));
	const activeId = $derived(dep(book.rev, book.wb.active));

	const stats = $derived.by(() => {
		void book.rev;
		const r = view.ranges;
		const g = view.primary;
		if (r.length === 1 && g.r1 === g.r2 && g.c1 === g.c2) return null;
		return book.stats(book.active, r);
	});
	const fmt = (n: number) => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 6 }).format(Number(formatGeneral(n).replace(',', '.')) || n);

	function select(id: string) {
		if (view.edit) view.commit();
		book.setActive(id);
		view.selectRange({ r1: 0, c1: 0, r2: 0, c2: 0 });
		view.focusTick++;
	}

	function add() {
		if (readonly) return;
		const id = book.addSheet(uniqueSheetName(book.wb, t().sheet.sheetName));
		book.setActive(id);
		view.selectRange({ r1: 0, c1: 0, r2: 0, c2: 0 });
		view.focusTick++;
	}

	const validate = (current: string) => (v: string) => {
		if (!validSheetName(v)) return t().sheet.sheetNameInvalid;
		const other = sheetByName(book.wb, v.trim());
		if (other && other.name !== current) return t().sheet.sheetNameTaken;
		return null;
	};

	async function rename(id: string) {
		const s = book.sheet(id);
		if (!s || readonly) return;
		const name = await promptDialog(t().sheet.renameSheet, s.name, { validate: validate(s.name) });
		if (name && name.trim() !== s.name) book.renameSheet(id, name.trim());
		view.focusTick++;
	}

	async function remove(id: string) {
		const s = book.sheet(id);
		if (!s) return;
		if (book.wb.sheets.length <= 1) {
			toast.warn(t().sheet.lastSheet);
			return;
		}
		if (await confirmDialog(t().sheet.confirmDeleteSheet(s.name), { danger: true, confirm: t().common.delete })) book.deleteSheet(id);
		view.focusTick++;
	}

	function duplicate(id: string) {
		const s = book.sheet(id);
		if (!s) return;
		let name = t().library.copyOf(s.name).slice(0, 31);
		for (let i = 2; sheetByName(book.wb, name); i++) name = `${s.name.slice(0, 26)} (${i})`;
		book.duplicateSheet(id, name);
	}

	function moveBy(id: string, d: number) {
		const i = book.wb.sheets.findIndex((s) => s.id === id);
		book.moveSheet(id, i + d);
	}
</script>

<svelte:window onpointerdown={(e) => menu && !(e.target as HTMLElement).closest('[data-tab-menu]') && (menu = null)} />

<div class="no-print flex h-9 items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] text-sm">
	<button class="tb m-0.5 shrink-0" title={t().sheet.addSheet} aria-label={t().sheet.addSheet} disabled={readonly} onclick={add}><Icon name="plus" size={16} /></button>
	<div class="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]" role="tablist">
		{#each sheets as s (s.id)}
			<button
				role="tab"
				aria-selected={s.id === activeId}
				class="shrink-0 border-r border-line px-3 whitespace-nowrap {s.id === activeId ? 'border-t-2 border-t-sheet bg-bg font-medium text-sheet' : 'text-muted hover:bg-surface-2'}"
				onclick={() => select(s.id)}
				ondblclick={() => rename(s.id)}
				oncontextmenu={(e) => {
					e.preventDefault();
					select(s.id);
					menu = { id: s.id, x: e.clientX, y: e.clientY };
				}}>{s.name}</button
			>
		{/each}
	</div>
	{#if stats && stats.count}
		<div class="hidden shrink-0 items-center gap-3 px-3 text-xs text-muted md:flex" aria-live="polite">
			{#if stats.nums}
				<span>{t().sheet.sum}: <b class="font-medium text-fg">{fmt(stats.sum)}</b></span>
				<span>{t().sheet.average}: <b class="font-medium text-fg">{fmt(stats.avg)}</b></span>
			{/if}
			<span>{t().sheet.count}: <b class="font-medium text-fg">{stats.count}</b></span>
		</div>
	{/if}
	{#if dep(book.rev, book.active.hidden.size)}
		<div class="hidden shrink-0 items-center px-3 text-xs text-accent sm:flex">{t().sheet.hiddenByFilter(book.active.hidden.size)}</div>
	{/if}
</div>

{#if menu}
	{@const id = menu.id}
	<div data-tab-menu class="menu fixed" style="left:{Math.min(menu.x, innerWidth - 200)}px;bottom:{innerHeight - menu.y + 4}px" role="menu">
		<button class="menu-item" disabled={readonly} onclick={() => ((menu = null), rename(id))}>{t().sheet.renameSheet}</button>
		<button class="menu-item" disabled={readonly} onclick={() => ((menu = null), duplicate(id))}>{t().sheet.duplicateSheet}</button>
		<button class="menu-item" disabled={readonly} onclick={() => ((menu = null), moveBy(id, -1))}>{t().sheet.moveLeft}</button>
		<button class="menu-item" disabled={readonly} onclick={() => ((menu = null), moveBy(id, 1))}>{t().sheet.moveRight}</button>
		<button class="menu-item text-bad" disabled={readonly} onclick={() => ((menu = null), remove(id))}>{t().sheet.deleteSheet}</button>
	</div>
{/if}
