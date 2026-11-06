<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page as kitPage } from '$app/state';
	import EditorHeader from '#lib/components/EditorHeader.svelte';
	import Grid from '#lib/components/sheets/Grid.svelte';
	import FormulaBar from '#lib/components/sheets/FormulaBar.svelte';
	import SheetToolbar from '#lib/components/sheets/SheetToolbar.svelte';
	import SheetTabs from '#lib/components/sheets/SheetTabs.svelte';
	import FilterMenu from '#lib/components/sheets/FilterMenu.svelte';
	import ChartPanel from '#lib/components/charts/ChartPanel.svelte';
	import { chartData, resolveRange } from '#lib/sheets/charts.ts';
	import Icon from '#lib/components/Icon.svelte';
	import Menu from '#lib/components/Menu.svelte';
	import { Book } from '#lib/sheets/book.svelte.ts';
	import { SheetView } from '#lib/sheets/view.svelte.ts';
	import * as A from '#lib/sheets/actions.ts';
	import { sheetToCSV } from '#lib/sheets/io/csv.ts';
	import { writeXlsx, type LoadImage } from '#lib/sheets/io/xlsx.ts';
	import { loadOfficeImage } from '#lib/files/office.ts';
	import type { CellImage, WorkbookContent } from '#lib/sheets/model.ts';
	import { promptDialog } from '#lib/client/dialogs.svelte.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { createAutosave } from '#lib/storage/autosave.svelte.ts';
	import { pruneBlobs } from '#lib/storage/blobs.ts';
	import { getHandle, setHandle } from '#lib/storage/handles.ts';
	import { acquireFileLock, type FileLock } from '#lib/storage/locks.ts';
	import { getContent, getMeta, renameFile, saveContent, type FileMeta } from '#lib/storage/library.ts';
	import { fileName, saveAs, writeHandle } from '#lib/files/save.ts';
	import { toast } from '#lib/client/toast.svelte.ts';
	import { withBase } from '#lib/client/base.ts';

	const id = $derived(kitPage.params.id ?? '');

	let meta = $state<FileMeta | null>(null);
	let missing = $state(false);
	let view = $state.raw<SheetView | null>(null);
	let lock: FileLock | null = null;
	let readonly = $state(false);
	let handleName = $state<string | null>(null);
	let ctxMenu = $state<{ x: number; y: number; kind: 'cell' | 'row' | 'col' } | null>(null);
	let filterMenu = $state<{ col: number; x: number; y: number } | null>(null);

	const editing = $derived.by(() => {
		if (!view?.editingChart) return null;
		void view.book.rev;
		const o = view.book.object(view.sheet.id, view.editingChart);
		return o?.kind === 'chart' ? { ...o } : null;
	});

	const loadImage: LoadImage = loadOfficeImage;
	const xlsxBytes = (v: SheetView) => writeXlsx(v.book.wb, loadImage, (s, r, c) => v.book.text(s, r, c));

	const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

	const autosave = createAutosave(async () => {
		if (!view || readonly) return;
		meta = await saveContent(id, view.book.content());
	});

	onMount(async () => {
		const m = await getMeta(id);
		const content = await getContent<WorkbookContent>(id);
		if (!m || !content || m.kind !== 'sheet') {
			missing = true;
			return;
		}
		meta = m;
		lock = await acquireFileLock(id);
		readonly = lock.readonly;
		handleName = (await getHandle(id))?.name ?? null;
		const book = new Book(content);
		book.engine.recalcVolatile();
		book.onChange = () => autosave.schedule();
		view = new SheetView(book, id);
		view.focusTick++;
	});

	onDestroy(() => {
		autosave.destroy();
		const v = view;
		if (v && !readonly) void autosave.flush().then(() => pruneBlobs(id, v.book.content()));
		lock?.release();
	});

	async function rename(title: string) {
		meta = (await renameFile(id, title)) ?? meta;
	}

	async function exportAs(kind: 'xlsx' | 'csv') {
		if (!view || !meta) return;
		view.commit();
		try {
			const blob =
				kind === 'xlsx'
					? new Blob([(await xlsxBytes(view)) as BlobPart], { type: XLSX_MIME })
					: new Blob(['﻿' + sheetToCSV(view.book.active)], { type: 'text/csv;charset=utf-8' });
			const ext = kind === 'xlsx' ? '.xlsx' : '.csv';
			const name = kind === 'csv' && view.book.wb.sheets.length > 1 ? `${meta.title} - ${view.book.active.name}` : meta.title;
			const res = await saveAs(blob, { name: fileName(name, ext), mime: kind === 'xlsx' ? XLSX_MIME : 'text/csv', ext, description: ext });
			if (res && res !== 'downloaded') {
				if (kind === 'xlsx') {
					await setHandle(id, res);
					handleName = res.name;
				}
				toast.success(t().file.savedToDisk(res.name));
			} else if (res === 'downloaded') toast.success(t().file.downloaded(fileName(name, ext)));
		} catch (e) {
			console.error(e);
			toast.error(t().file.exportFailed, { detail: String((e as Error)?.message ?? e) });
		}
		view.focusTick++;
	}

	async function save() {
		if (!view) return;
		view.commit();
		await autosave.flush();
		const h = await getHandle(id);
		if (h) {
			try {
				await writeHandle(h, new Blob([(await xlsxBytes(view)) as BlobPart], { type: XLSX_MIME }));
				toast.success(t().file.savedToDisk(h.name), { key: 'save' });
				view.focusTick++;
				return;
			} catch {
				/* fall back to Save As */
			}
		}
		await exportAs('xlsx');
	}

	function onKey(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
			e.preventDefault();
			void save();
		}
	}

	async function clipboardAction(kind: 'cut' | 'copy' | 'paste' | 'pasteValues') {
		if (!view) return;
		ctxMenu = null;
		try {
			if (kind === 'paste' || kind === 'pasteValues') {
				let text: string | undefined;
				let html: string | undefined;
				try {
					const items = await navigator.clipboard.read();
					for (const it of items) {
						if (it.types.includes('text/html')) html = await (await it.getType('text/html')).text();
						if (it.types.includes('text/plain')) text = await (await it.getType('text/plain')).text();
					}
				} catch {
					text = await navigator.clipboard.readText();
				}
				view.paste({ text, html }, kind === 'pasteValues');
			} else {
				const { text, html } = view.copy(kind === 'cut');
				try {
					await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
				} catch {
					await navigator.clipboard.writeText(text);
				}
			}
		} catch {
			/* clipboard permission denied: keyboard shortcuts still work */
		}
		view.focusTick++;
	}

	const cellImg = (v: SheetView) => v.book.cell(v.sheet, v.active.r, v.active.c)?.img;
	function setCellImg(v: SheetView, img: CellImage | undefined) {
		const { r, c } = v.active;
		const prev = v.book.cell(v.sheet, r, c);
		v.book.setCells(v.sheet.id, [[r * 16384 + c, { ...prev, img }]]);
	}

	function act(fn: () => void) {
		ctxMenu = null;
		fn();
		if (view) view.focusTick++;
	}
</script>

<svelte:window onkeydown={onKey} onpointerdown={(e) => ctxMenu && !(e.target as HTMLElement).closest('[data-ctx-menu]') && (ctxMenu = null)} />
<svelte:head><title>{meta?.title ?? t().kind.sheet} — {t().app.name}</title></svelte:head>

{#if missing}
	<div class="grid h-dvh place-items-center p-6 text-center">
		<div>
			<p class="mb-4 text-muted">{t().file.notFound}</p>
			<a class="btn btn-primary" href={withBase('/')}>{t().file.backToLibrary}</a>
		</div>
	</div>
{:else}
	<div class="flex h-dvh flex-col">
		<EditorHeader title={meta?.title ?? ''} kind="sheet" status={autosave.state.status} {readonly} onrename={rename}>
			{#snippet menus()}
				<Menu label={t().file.menuFile} align="right" disabled={!view}>
					{#snippet children(close)}
						<button class="menu-item" onclick={() => (close(), save())}><Icon name="save" size={16} />{t().file.saveToDisk}{#if handleName}<span class="ml-auto pl-3 text-xs text-faint">{handleName}</span>{/if}</button>
						<div class="my-1 border-t border-line"></div>
						<p class="px-3 pt-1 pb-0.5 text-xs text-faint">{t().doc.exportAs}</p>
						<button class="menu-item" onclick={() => (close(), exportAs('xlsx'))}><Icon name="download" size={16} />{t().sheet.fmtXlsx}</button>
						<button class="menu-item" onclick={() => (close(), exportAs('csv'))}><Icon name="download" size={16} />{t().sheet.fmtCsv}</button>
					{/snippet}
				</Menu>
			{/snippet}
		</EditorHeader>
		{#if view}
			{#if !readonly}<SheetToolbar {view} />{/if}
			{#if readonly}
				<div class="no-print border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-sm text-warn">{t().file.readOnlyDetail}</div>
			{/if}
			<FormulaBar {view} {readonly} />
			<div class="flex min-h-0 flex-1">
				<div class="flex min-w-0 flex-1 flex-col">
					<Grid
						{view}
						{readonly}
						oncontext={(e, kind) => (ctxMenu = { x: e.clientX, y: e.clientY, kind })}
						onfilter={(col, x, y) => (filterMenu = { col, x, y })}
						onshortcut={(e) => (view ? A.shortcut(view, e, readonly) : false)}
					/>
				</div>
				{#if editing && view}
					{@const v = view}
					{@const ch = editing}
					<ChartPanel
						options={ch}
						source={ch.source}
						seriesNames={chartData(v.book.wb, ch, (s, r, c) => v.book.text(s, r, c)).series.map((s) => s.name)}
						validateRange={(r) => !!resolveRange(v.book.wb, r)}
						onchange={(patch) => v.book.updateObject(v.sheet.id, ch.id, patch)}
						onclose={() => ((v.editingChart = null), v.focusTick++)}
						ondelete={() => {
							v.book.removeObject(v.sheet.id, ch.id);
							v.editingChart = null;
							v.object = null;
							v.focusTick++;
						}}
					/>
				{/if}
			</div>
			<SheetTabs {view} {readonly} />
		{:else}
			<div class="grid flex-1 place-items-center text-muted">{t().common.loading}</div>
		{/if}
	</div>
{/if}

{#if ctxMenu && view}
	{@const v = view}
	<div data-ctx-menu class="menu fixed" style="left:{Math.min(ctxMenu.x, innerWidth - 230)}px;top:{Math.min(ctxMenu.y, innerHeight - 380)}px" role="menu">
		<button class="menu-item" disabled={readonly} onclick={() => clipboardAction('cut')}>{t().sheet.cut}<span class="ml-auto text-xs text-faint">Ctrl+X</span></button>
		<button class="menu-item" onclick={() => clipboardAction('copy')}>{t().sheet.copy}<span class="ml-auto text-xs text-faint">Ctrl+C</span></button>
		<button class="menu-item" disabled={readonly} onclick={() => clipboardAction('paste')}>{t().sheet.paste}<span class="ml-auto text-xs text-faint">Ctrl+V</span></button>
		<button class="menu-item" disabled={readonly} onclick={() => clipboardAction('pasteValues')}>{t().sheet.pasteValues}</button>
		{#if !readonly}
			<div class="my-1 border-t border-line"></div>
			{#if ctxMenu.kind !== 'col'}
				<button class="menu-item" onclick={() => act(() => A.insert(v, 'row', false))}><Icon name="rowAdd" size={16} />{t().sheet.insertRowAbove}</button>
				<button class="menu-item" onclick={() => act(() => A.insert(v, 'row', true))}><Icon name="rowAdd" size={16} />{t().sheet.insertRowBelow}</button>
			{/if}
			{#if ctxMenu.kind !== 'row'}
				<button class="menu-item" onclick={() => act(() => A.insert(v, 'col', false))}><Icon name="colAdd" size={16} />{t().sheet.insertColLeft}</button>
				<button class="menu-item" onclick={() => act(() => A.insert(v, 'col', true))}><Icon name="colAdd" size={16} />{t().sheet.insertColRight}</button>
			{/if}
			{#if ctxMenu.kind !== 'col'}<button class="menu-item text-bad" onclick={() => act(() => A.remove(v, 'row'))}>{t().sheet.deleteRows}</button>{/if}
			{#if ctxMenu.kind !== 'row'}<button class="menu-item text-bad" onclick={() => act(() => A.remove(v, 'col'))}>{t().sheet.deleteCols}</button>{/if}
			<div class="my-1 border-t border-line"></div>
			<button class="menu-item" onclick={() => act(() => v.book.clear(v.sheet.id, v.ranges, 'contents'))}>{t().sheet.clearContents}</button>
			<button class="menu-item" onclick={() => act(() => v.book.clear(v.sheet.id, v.ranges, 'formats'))}>{t().sheet.clearFormats}</button>
			{#if ctxMenu.kind === 'cell' && cellImg(v)}
				{@const img = cellImg(v)!}
				<div class="my-1 border-t border-line"></div>
				<button class="menu-item" onclick={() => act(() => setCellImg(v, { ...img, fit: img.fit === 'contain' ? 'cover' : 'contain' }))}>{img.fit === 'contain' ? t().object.fitCover : t().object.fitContain}</button>
				<button class="menu-item" onclick={async () => {
					ctxMenu = null;
					const alt = await promptDialog(t().object.altPrompt, img.alt ?? '');
					if (alt !== null) setCellImg(v, { ...img, alt });
					v.focusTick++;
				}}>{t().object.alt}</button>
				<button class="menu-item text-bad" onclick={() => act(() => setCellImg(v, undefined))}>{t().object.removeImage}</button>
			{/if}
			{#if ctxMenu.kind === 'col'}
				<button class="menu-item" onclick={() => act(() => v.book.resize(v.sheet.id, 'col', v.indices('col'), undefined))}>{t().sheet.autofit}</button>
			{/if}
		{/if}
	</div>
{/if}

{#if filterMenu && view}
	<FilterMenu {view} col={filterMenu.col} x={filterMenu.x} y={filterMenu.y} onclose={() => ((filterMenu = null), view && view.focusTick++)} />
{/if}
