<script lang="ts">
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import { page as kitPage } from '$app/state';
	import type { Editor } from '@tiptap/core';
	import EditorHeader from '#lib/components/EditorHeader.svelte';
	import DocToolbar from '#lib/components/docs/DocToolbar.svelte';
	import DocMenu from '#lib/components/docs/DocMenu.svelte';
	import FindBar from '#lib/components/docs/FindBar.svelte';
	import PageSetupDialog from '#lib/components/docs/PageSetup.svelte';
	import DocChartPanel from '#lib/components/docs/DocChartPanel.svelte';
	import ChartFromSheet from '#lib/components/docs/ChartFromSheet.svelte';
	import { CHART_EDIT_EVENT } from '#lib/components/docs/chart-view.svelte.ts';
	import type { DocChartAttrs } from '#lib/docs/extensions/chart-node.ts';
	import Icon from '#lib/components/Icon.svelte';
	import Menu from '#lib/components/Menu.svelte';
	import { createDocEditor } from '#lib/docs/editor.ts';
	import { exportDoc, FORMATS, printDoc, type DocFormat } from '#lib/docs/io/export.ts';
	import { pageDims, type DocContent, type PageSetup } from '#lib/docs/model.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { createAutosave } from '#lib/storage/autosave.svelte.ts';
	import { blobBytes, dehydrate, hydrate, pruneBlobs } from '#lib/storage/blobs.ts';
	import { getHandle, setHandle } from '#lib/storage/handles.ts';
	import { acquireFileLock, type FileLock } from '#lib/storage/locks.ts';
	import { getContent, getMeta, renameFile, saveContent, type FileMeta } from '#lib/storage/library.ts';
	import { fileName, saveAs, writeHandle } from '#lib/files/save.ts';
	import { toast } from '#lib/client/toast.svelte.ts';
	import { withBase } from '#lib/client/base.ts';

	const id = $derived(kitPage.params.id ?? '');

	let meta = $state<FileMeta | null>(null);
	let missing = $state(false);
	let pageSetup = $state<PageSetup | null>(null);
	let editor = $state.raw<Editor | null>(null);
	let ver = $state(0);
	let host = $state<HTMLDivElement>();
	let docMenu = $state<ReturnType<typeof DocMenu>>();
	let lock: FileLock | null = null;
	let readonly = $state(false);
	let findOpen = $state(false);
	let replaceOpen = $state(false);
	let setupOpen = $state(false);
	let zoom = $state(100);
	let handleName = $state<string | null>(null);
	let imageBytes = 0;

	const autosave = createAutosave(async () => {
		if (!editor || readonly || !pageSetup) return;
		const content: DocContent = { v: 1, page: $state.snapshot(pageSetup) as PageSetup, doc: dehydrate(editor.getJSON()) };
		meta = await saveContent(id, content, imageBytes);
		void blobBytes(id).then((n) => (imageBytes = n));
	});

	onMount(async () => {
		const m = await getMeta(id);
		const content = await getContent<DocContent>(id);
		if (!m || !content || m.kind !== 'doc') {
			missing = true;
			return;
		}
		meta = m;
		pageSetup = content.page;
		lock = await acquireFileLock(id);
		readonly = lock.readonly;
		const h = await getHandle(id);
		handleName = h?.name ?? null;
		const json = await hydrate(id, content.doc);
		await tick();
		if (!host) return;
		editor = createDocEditor({
			element: host,
			docId: id,
			content: json,
			placeholder: t().doc.placeholder,
			editable: !readonly,
			onUpdate: () => autosave.schedule(),
			// untrack: transactions can be dispatched from inside effects (search), ver++ would subscribe them.
			onTransaction: () => untrack(() => ver++)
		});
		editor.commands.focus('start');
	});

	onDestroy(() => {
		autosave.destroy();
		const e = editor;
		if (e && !readonly) void autosave.flush().then(() => pruneBlobs(id, dehydrate(e.getJSON())));
		e?.destroy();
		lock?.release();
	});

	async function rename(title: string) {
		meta = (await renameFile(id, title)) ?? meta;
	}

	function applySetup(p: PageSetup) {
		pageSetup = p;
		autosave.schedule();
	}

	async function exportAs(format: DocFormat) {
		if (!editor || !pageSetup || !meta) return;
		try {
			const blob = await exportDoc(editor, format, pageSetup, meta.title);
			const { ext, mime } = FORMATS[format];
			const res = await saveAs(blob, { name: fileName(meta.title, ext), mime, ext, description: ext });
			if (res && res !== 'downloaded') {
				if (format === 'docx') {
					await setHandle(id, res);
					handleName = res.name;
				}
				toast.success(t().file.savedToDisk(res.name));
			} else if (res === 'downloaded') toast.success(t().file.downloaded(fileName(meta.title, ext)));
		} catch (e) {
			console.error(e);
			toast.error(t().file.exportFailed, { detail: String((e as Error)?.message ?? e) });
		}
	}

	/** Ctrl+S: write back to the .docx it came from (or was saved as); otherwise Save As .docx. */
	async function save() {
		if (!editor || !pageSetup || !meta) return;
		await autosave.flush();
		const h = await getHandle(id);
		if (h) {
			try {
				await writeHandle(h, await exportDoc(editor, 'docx', pageSetup, meta.title));
				toast.success(t().file.savedToDisk(h.name), { key: 'save' });
				return;
			} catch {
				/* permission denied or file gone: Save As */
			}
		}
		await exportAs('docx');
	}

	function onKey(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		if (!mod || e.altKey) return;
		const k = e.key.toLowerCase();
		if (k === 's') {
			e.preventDefault();
			void save();
		} else if (k === 'f') {
			e.preventDefault();
			findOpen = true;
			replaceOpen = false;
		} else if (k === 'h') {
			e.preventDefault();
			findOpen = true;
			replaceOpen = !readonly;
		} else if (k === 'p') {
			e.preventDefault();
			if (pageSetup) printDoc(pageSetup);
		}
	}

	// ---------- Charts ----------

	let chartEdit = $state<{ pos: number; attrs: DocChartAttrs } | null>(null);
	let fromSheetOpen = $state(false);

	function insertChart(kind: 'sheet' | 'new') {
		if (kind === 'sheet') {
			fromSheetOpen = true;
			return;
		}
		if (!editor) return;
		const attrs: DocChartAttrs = {
			options: { type: 'column', legend: 'bottom' },
			data: { labels: ['T1', 'T2', 'T3', 'T4'], series: [{ name: `${t().chart.series} 1`, values: [12, 19, 8, 15] }] },
			width: 520,
			height: 300
		};
		editor.chain().focus().insertChart(attrs).run();
		const pos = editor.state.selection.from - 1;
		const node = editor.state.doc.nodeAt(pos);
		if (node?.type.name === 'chart') chartEdit = { pos, attrs: node.attrs as DocChartAttrs };
	}

	function updateChart(attrs: DocChartAttrs) {
		if (!editor || !chartEdit) return;
		const node = editor.state.doc.nodeAt(chartEdit.pos);
		if (node?.type.name !== 'chart') return;
		editor.view.dispatch(editor.state.tr.setNodeMarkup(chartEdit.pos, undefined, attrs));
		chartEdit = { pos: chartEdit.pos, attrs };
	}

	function deleteChart() {
		if (!editor || !chartEdit) return;
		const node = editor.state.doc.nodeAt(chartEdit.pos);
		if (node?.type.name === 'chart') editor.view.dispatch(editor.state.tr.delete(chartEdit.pos, chartEdit.pos + node.nodeSize));
		chartEdit = null;
	}

	$effect(() => {
		const el = host;
		if (!el) return;
		const onEdit = (e: Event) => {
			const pos = (e as CustomEvent<number | undefined>).detail;
			const node = pos === undefined ? null : editor?.state.doc.nodeAt(pos);
			if (pos !== undefined && node?.type.name === 'chart' && !readonly) chartEdit = { pos, attrs: structuredClone(node.attrs) as DocChartAttrs };
		};
		el.addEventListener(CHART_EDIT_EVENT, onEdit);
		return () => el.removeEventListener(CHART_EDIT_EVENT, onEdit);
	});

	const dims = $derived(pageSetup ? pageDims(pageSetup) : { w: 210, h: 297 });

	// Narrow screens: fit the page width (until the user picks a zoom).
	let scrollArea = $state<HTMLDivElement>();
	let zoomTouched = $state(false);
	let reflow = $state(false);
	$effect(() => {
		if (!scrollArea) return;
		const paperPx = (dims.w / 25.4) * 96;
		const fit = () => {
			if (zoomTouched || !scrollArea) return;
			const avail = scrollArea.clientWidth - 16;
			reflow = avail < paperPx;
		};
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(scrollArea);
		return () => ro.disconnect();
	});

	const words = $derived.by(() => {
		void ver;
		const s = editor?.storage as unknown as { characterCount?: { words(): number; characters(): number } } | undefined;
		return { w: s?.characterCount?.words() ?? 0, c: s?.characterCount?.characters() ?? 0 };
	});
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>{meta?.title ?? t().kind.doc} — {t().app.name}</title></svelte:head>

{#if missing}
	<div class="grid h-dvh place-items-center p-6 text-center">
		<div>
			<p class="mb-4 text-muted">{t().file.notFound}</p>
			<a class="btn btn-primary" href={withBase('/')}>{t().file.backToLibrary}</a>
		</div>
	</div>
{:else}
	<div class="flex h-dvh flex-col">
		<EditorHeader title={meta?.title ?? ''} kind="doc" status={autosave.state.status} {readonly} onrename={rename}>
			{#snippet menus()}
				<Menu label={t().file.menuFile} align="right" triggerClass="tb gap-1 px-2" disabled={!editor}>
					{#snippet children(close)}
						<button class="menu-item" onclick={() => (close(), save())}><Icon name="save" size={16} />{t().file.saveToDisk}{#if handleName}<span class="ml-auto pl-3 text-xs text-faint">{handleName}</span>{/if}</button>
						<div class="my-1 border-t border-line"></div>
						<p class="px-3 pt-1 pb-0.5 text-xs text-faint">{t().doc.exportAs}</p>
						<button class="menu-item" onclick={() => (close(), exportAs('docx'))}><Icon name="download" size={16} />{t().doc.fmtDocx}</button>
						<button class="menu-item" onclick={() => (close(), exportAs('md'))}><Icon name="download" size={16} />{t().doc.fmtMd}</button>
						<button class="menu-item" onclick={() => (close(), exportAs('html'))}><Icon name="download" size={16} />{t().doc.fmtHtml}</button>
						<button class="menu-item" onclick={() => (close(), exportAs('txt'))}><Icon name="download" size={16} />{t().doc.fmtTxt}</button>
						<div class="my-1 border-t border-line"></div>
						<button class="menu-item" onclick={() => (close(), pageSetup && printDoc(pageSetup))}><Icon name="print" size={16} />{t().file.print}</button>
						<button class="menu-item" disabled={readonly} onclick={() => (close(), (setupOpen = true))}><Icon name="page" size={16} />{t().doc.pageSetup}</button>
					{/snippet}
				</Menu>
			{/snippet}
			{#snippet actions()}
				<button class="tb" title="{t().doc.find} (Ctrl+F)" aria-label={t().doc.find} onclick={() => (findOpen = !findOpen)} aria-pressed={findOpen}><Icon name="search" /></button>
			{/snippet}
		</EditorHeader>

		{#if editor && !readonly}
			<DocToolbar {editor} {ver} docId={id} bind:zoom onzoom={() => ((zoomTouched = true), (reflow = false))} oninsertchart={insertChart} />
		{/if}
		{#if readonly}
			<div class="no-print border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-sm text-warn">{t().file.readOnlyDetail}</div>
		{/if}

		<div class="flex min-h-0 flex-1">
		<div bind:this={scrollArea} class="print-root relative min-w-0 flex-1 overflow-auto bg-bg px-2 py-6 sm:px-6">
			{#if findOpen && editor}
				<FindBar {editor} {ver} bind:replace={replaceOpen} {readonly} onclose={() => ((findOpen = false), editor?.commands.focus())} />
			{/if}
			<div
				class="paper mx-auto shadow-[0_1px_3px_rgb(0_0_0/0.15),0_4px_16px_rgb(0_0_0/0.08)]"
				style={reflow && !zoomTouched
					? `width:100%;min-height:70vh;padding:16px;zoom:1`
					: `width:${dims.w}mm;min-height:${dims.h}mm;padding:${pageSetup?.margins.top ?? 25}mm ${pageSetup?.margins.right ?? 25}mm ${pageSetup?.margins.bottom ?? 25}mm ${pageSetup?.margins.left ?? 25}mm;zoom:${zoom / 100}`}
			>
				<div
					bind:this={host}
					class="h-full min-h-[50mm]"
					onclick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}
					oncontextmenu={(e) => docMenu?.open(e)}
					onkeydown={(e) => docMenu?.keydown(e)}
					role="presentation"
				></div>
			</div>
		</div>
		{#if editor}<DocMenu bind:this={docMenu} {editor} docId={id} {readonly} />{/if}
		{#if chartEdit && editor}
			<DocChartPanel attrs={chartEdit.attrs} onchange={updateChart} onclose={() => ((chartEdit = null), editor?.commands.focus())} ondelete={deleteChart} />
		{/if}
		</div>

		<footer class="no-print flex items-center gap-3 border-t border-line bg-surface px-3 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-xs text-faint">
			<span>{t().doc.words(words.w)}</span>
			<span>{t().doc.chars(words.c)}</span>
			<span class="ml-auto">{pageSetup?.size ?? ''} · {pageSetup ? (pageSetup.orientation === 'portrait' ? t().doc.portrait : t().doc.landscape) : ''}</span>
		</footer>
	</div>
{/if}

{#if fromSheetOpen}
	<ChartFromSheet onpick={(a) => ((fromSheetOpen = false), editor?.chain().focus().insertChart(a).run())} onclose={() => (fromSheetOpen = false)} />
{/if}

{#if setupOpen && pageSetup}
	<PageSetupDialog page={pageSetup} onapply={applySetup} onclose={() => (setupOpen = false)} />
{/if}
