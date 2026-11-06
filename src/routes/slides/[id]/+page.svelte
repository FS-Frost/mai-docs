<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { page as kitPage } from '$app/state';
	import EditorHeader from '#lib/components/EditorHeader.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Menu from '#lib/components/Menu.svelte';
	import Canvas from '#lib/components/slides/Canvas.svelte';
	import Thumbs from '#lib/components/slides/Thumbs.svelte';
	import SlidesToolbar from '#lib/components/slides/SlidesToolbar.svelte';
	import ThemeDialog from '#lib/components/slides/ThemeDialog.svelte';
	import Present from '#lib/components/slides/Present.svelte';
	import SlideView from '#lib/components/slides/SlideView.svelte';
	import MotionPanel from '#lib/components/slides/MotionPanel.svelte';
	import IconPicker from '#lib/components/slides/IconPicker.svelte';
	import ChartFromSheet from '#lib/components/docs/ChartFromSheet.svelte';
	import DocChartPanel from '#lib/components/docs/DocChartPanel.svelte';
	import type { DocChartAttrs } from '#lib/docs/extensions/chart-node.ts';
	import type { IconNode } from '#lib/slides/icons.ts';
	import { uid, type ChartEl, type IconEl } from '#lib/slides/model.ts';
	import { Deck } from '#lib/slides/deck.svelte.ts';
	import type { SlidesContent } from '#lib/slides/model.ts';
	import { writePptx, type LoadImage } from '#lib/slides/io/pptx-write.ts';
	import { loadBlobBytes, loadOfficeImage, renderIconPng } from '#lib/files/office.ts';
	import { fileName, saveAs, writeHandle } from '#lib/files/save.ts';
	import { createAutosave } from '#lib/storage/autosave.svelte.ts';
	import { pruneBlobs } from '#lib/storage/blobs.ts';
	import { getHandle, setHandle } from '#lib/storage/handles.ts';
	import { acquireFileLock, type FileLock } from '#lib/storage/locks.ts';
	import { getContent, getMeta, renameFile, saveContent, type FileMeta } from '#lib/storage/library.ts';
	import { i18n, t } from '#lib/i18n/index.svelte.ts';
	import { toast } from '#lib/client/toast.svelte.ts';
	import { withBase } from '#lib/client/base.ts';

	const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
	const id = $derived(kitPage.params.id ?? '');

	let meta = $state<FileMeta | null>(null);
	let missing = $state(false);
	let deck = $state.raw<Deck | null>(null);
	let lock: FileLock | null = null;
	let readonly = $state(false);
	let handleName = $state<string | null>(null);
	let themeOpen = $state(false);
	let presenting = $state<number | null>(null);
	let canvas = $state<ReturnType<typeof Canvas>>();
	let motionOpen = $state(false);
	let iconOpen = $state(false);
	/** Icon element being replaced from the canvas menu (null = insert a new one). */
	let iconReplace = $state<string | null>(null);
	let fromSheetOpen = $state(false);
	let chartEdit = $state<string | null>(null);

	const autosave = createAutosave(async () => {
		if (!deck || readonly) return;
		meta = await saveContent(id, deck.content);
	});

	onMount(async () => {
		const m = await getMeta(id);
		const content = await getContent<SlidesContent>(id);
		if (!m || !content || m.kind !== 'slides') {
			missing = true;
			return;
		}
		meta = m;
		lock = await acquireFileLock(id);
		readonly = lock.readonly;
		handleName = (await getHandle(id))?.name ?? null;
		const d = new Deck(content);
		d.onChange = () => autosave.schedule();
		deck = d;
		if (kitPage.url.searchParams.has('present')) presenting = 0;
	});

	onDestroy(() => {
		autosave.destroy();
		const d = deck;
		if (d && !readonly) void autosave.flush().then(() => pruneBlobs(id, d.content));
		lock?.release();
	});

	async function rename(title: string) {
		meta = (await renameFile(id, title)) ?? meta;
	}

	const loadImage: LoadImage = loadOfficeImage;
	const loadBlob = loadBlobBytes;
	const renderIcon = renderIconPng;
	const pptxBlob = async () => new Blob([(await writePptx(deck!.content, loadImage, { title: meta?.title, lang: i18n.locale, loadBlob, renderIcon })) as BlobPart], { type: PPTX_MIME });

	async function exportPptx() {
		if (!deck || !meta) return;
		try {
			const res = await saveAs(await pptxBlob(), { name: fileName(meta.title, '.pptx'), mime: PPTX_MIME, ext: '.pptx', description: '.pptx' });
			if (res && res !== 'downloaded') {
				await setHandle(id, res);
				handleName = res.name;
				toast.success(t().file.savedToDisk(res.name));
			} else if (res === 'downloaded') toast.success(t().file.downloaded(fileName(meta.title, '.pptx')));
		} catch (e) {
			console.error(e);
			toast.error(t().file.exportFailed, { detail: String((e as Error)?.message ?? e) });
		}
	}

	async function save() {
		if (!deck) return;
		await autosave.flush();
		const h = await getHandle(id);
		if (h) {
			try {
				await writeHandle(h, await pptxBlob());
				toast.success(t().file.savedToDisk(h.name), { key: 'save' });
				return;
			} catch {
				/* Save As */
			}
		}
		await exportPptx();
	}

	async function printPdf() {
		if (!deck) return;
		deck.stopEditing();
		const { w, h } = deck.content.size;
		let style = document.getElementById('mai-print-page') as HTMLStyleElement | null;
		if (!style) {
			style = document.createElement('style');
			style.id = 'mai-print-page';
			document.head.append(style);
		}
		style.textContent = `@page { size: ${w / 96}in ${h / 96}in; margin: 0; }`;
		printing = true;
		await tick();
		await new Promise((r) => setTimeout(r, 300)); // images
		window.print();
		printing = false;
	}
	let printing = $state(false);

	function pickImage() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.multiple = true;
		input.onchange = () => void canvas?.insertImageFiles([...(input.files ?? [])]);
		input.click();
	}

	function pickMedia() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'video/*,audio/*,.mp4,.m4v,.webm,.mov,.mp3,.m4a,.wav,.ogg,.aac';
		input.multiple = true;
		input.onchange = () => void canvas?.insertMediaFiles([...(input.files ?? [])]);
		input.click();
	}

	function centered(w: number, h: number) {
		const s = deck!.content.size;
		return { x: Math.round((s.w - w) / 2), y: Math.round((s.h - h) / 2) };
	}

	function addChart(a: Pick<DocChartAttrs, 'options' | 'data' | 'origin'>, edit: boolean) {
		if (!deck) return;
		const w = Math.round(deck.content.size.w * 0.55);
		const h = Math.round(w * 0.58);
		const el: ChartEl = { id: uid(), kind: 'chart', options: a.options, data: a.data, origin: a.origin, ...centered(w, h), w, h, rot: 0 };
		deck.add(el);
		if (edit) chartEdit = el.id;
	}

	function addIcon(name: string, nodes: IconNode) {
		iconOpen = false;
		if (!deck) return;
		const copy = nodes.map(([tag, attrs]) => [tag, Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)]))]) as IconEl['nodes'];
		if (iconReplace) {
			deck.patch([iconReplace], { icon: name, nodes: copy } as Partial<IconEl>);
			iconReplace = null;
			return;
		}
		const el: IconEl = { id: uid(), kind: 'icon', icon: name, nodes: copy, color: 'accent1', stroke: 2, ...centered(120, 120), w: 120, h: 120, rot: 0 };
		deck.add(el);
	}

	function oninsert(what: 'chartSheet' | 'chartNew' | 'media' | 'icon') {
		if (what === 'chartSheet') fromSheetOpen = true;
		else if (what === 'chartNew') addChart({ options: { type: 'column', legend: 'bottom' }, data: { labels: ['T1', 'T2', 'T3', 'T4'], series: [{ name: `${t().chart.series} 1`, values: [12, 19, 8, 15] }] } }, true);
		else if (what === 'media') pickMedia();
		else iconOpen = true;
	}

	const editedChart = $derived(chartEdit && deck ? (deck.slide.elements.find((e) => e.id === chartEdit && e.kind === 'chart') as ChartEl | undefined) : undefined);

	function onKey(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && !e.altKey && e.key.toLowerCase() === 's') {
			e.preventDefault();
			void save();
		} else if (e.key === 'F5' || (mod && e.key === 'Enter')) {
			e.preventDefault();
			presenting = e.shiftKey || mod ? (deck?.current ?? 0) : 0;
		} else if (mod && e.key.toLowerCase() === 'p') {
			e.preventDefault();
			void printPdf();
		}
	}

	const notesValue = $derived(deck?.slide.notes ?? '');
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>{meta?.title ?? t().kind.slides} — {t().app.name}</title></svelte:head>

{#if missing}
	<div class="grid h-dvh place-items-center p-6 text-center">
		<div>
			<p class="mb-4 text-muted">{t().file.notFound}</p>
			<a class="btn btn-primary" href={withBase('/')}>{t().file.backToLibrary}</a>
		</div>
	</div>
{:else}
	<div class="no-print flex h-dvh flex-col">
		<EditorHeader title={meta?.title ?? ''} kind="slides" status={autosave.state.status} {readonly} onrename={rename}>
			{#snippet menus()}
				<Menu label={t().file.menuFile} align="right" disabled={!deck}>
					{#snippet children(close)}
						<button class="menu-item" onclick={() => (close(), save())}><Icon name="save" size={16} />{t().file.saveToDisk}{#if handleName}<span class="ml-auto pl-3 text-xs text-faint">{handleName}</span>{/if}</button>
						<div class="my-1 border-t border-line"></div>
						<p class="px-3 pt-1 pb-0.5 text-xs text-faint">{t().doc.exportAs}</p>
						<button class="menu-item" onclick={() => (close(), exportPptx())}><Icon name="download" size={16} />{t().slides.fmtPptx}</button>
						<button class="menu-item" onclick={() => (close(), printPdf())}><Icon name="print" size={16} />{t().slides.fmtPdf}</button>
						<div class="my-1 border-t border-line"></div>
						<button class="menu-item" onclick={() => (close(), (presenting = 0))}><Icon name="present" size={16} />{t().slides.presentFromStart}<span class="ml-auto text-xs text-faint">F5</span></button>
					{/snippet}
				</Menu>
			{/snippet}
			{#snippet actions()}
				<button class="btn btn-primary ml-1 !py-1" disabled={!deck} onclick={() => (presenting = deck?.current ?? 0)}><Icon name="present" size={16} /><span class="hidden sm:inline">{t().slides.present}</span></button>
			{/snippet}
		</EditorHeader>
		{#if deck}
			{#if !readonly}<SlidesToolbar {deck} onimage={pickImage} ontheme={() => (themeOpen = true)} {oninsert} {motionOpen} onmotion={() => ((motionOpen = !motionOpen), (chartEdit = null))} />{/if}
			{#if readonly}
				<div class="border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-sm text-warn">{t().file.readOnlyDetail}</div>
			{/if}
			<div class="flex min-h-0 flex-1">
				<div class="hidden md:flex"><Thumbs {deck} {readonly} /></div>
				<div class="flex min-w-0 flex-1 flex-col">
					<div class="min-h-0 flex-1"><Canvas bind:this={canvas} {deck} fileId={id} {readonly} oneditchart={(el) => ((chartEdit = el.id), (motionOpen = false))}
							onmotion={() => ((motionOpen = true), (chartEdit = null))}
							ontheme={() => (themeOpen = true)}
							onreplaceicon={(elId) => ((iconReplace = elId), (iconOpen = true))}
						/></div>
					<div class="flex items-center gap-2 border-t border-line bg-surface px-2 py-1 md:hidden">
						<button class="tb" aria-label={t().slides.previous} onclick={() => deck?.go(deck.current - 1)}><Icon name="chevronLeft" /></button>
						<span class="text-sm tabular-nums">{deck.current + 1} / {deck.content.slides.length}</span>
						<button class="tb" aria-label={t().slides.next} onclick={() => deck?.go(deck.current + 1)}><Icon name="chevronRight" /></button>
					</div>
					<textarea
						class="h-24 shrink-0 resize-y border-t border-line bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-faint"
						placeholder={t().slides.notesPlaceholder}
						aria-label={t().slides.notes}
						value={notesValue}
						readonly={readonly}
						oninput={(e) => deck?.setNotes((e.currentTarget as HTMLTextAreaElement).value)}
						></textarea>
					</div>
					{#if motionOpen && !readonly}<MotionPanel {deck} onclose={() => (motionOpen = false)} />{/if}
					{#if editedChart && !readonly}
						{@const ch = editedChart}
						<DocChartPanel
						attrs={{ options: ch.options, data: ch.data, origin: ch.origin, width: ch.w, height: ch.h }}
						onchange={(a) => deck?.patch([ch.id], { options: a.options, data: a.data } as Partial<ChartEl>, `chart:${ch.id}`)}
						onclose={() => (chartEdit = null)}
						ondelete={() => {
							deck!.selection = [ch.id];
							deck!.removeSelected();
							chartEdit = null;
						}}
						/>
					{/if}
			</div>
		{:else}
			<div class="grid flex-1 place-items-center text-muted">{t().common.loading}</div>
		{/if}
	</div>
{/if}

{#if iconOpen}
	<IconPicker onpick={addIcon} onclose={() => ((iconOpen = false), (iconReplace = null))} />
{/if}

{#if fromSheetOpen}
	<ChartFromSheet onpick={(a) => ((fromSheetOpen = false), addChart(a, false))} onclose={() => (fromSheetOpen = false)} />
{/if}

{#if themeOpen && deck}
	<ThemeDialog {deck} onclose={() => (themeOpen = false)} />
{/if}

{#if presenting !== null && deck}
	<Present content={deck.content} fileId={id} start={presenting} onexit={(i) => ((presenting = null), deck?.go(i))} />
{/if}

{#if printing && deck}
	<div class="print-slides">
		{#each deck.content.slides.filter((s) => !s.hidden) as s (s.id)}
			<div class="print-slide"><SlideView content={deck.content} slide={s} scale={1} /></div>
		{/each}
	</div>
{/if}

<style>
	.print-slides {
		display: none;
	}
	@media print {
		.print-slides {
			display: block;
		}
		.print-slide {
			break-after: page;
			page-break-after: always;
			print-color-adjust: exact;
			-webkit-print-color-adjust: exact;
		}
		.print-slide:last-child {
			break-after: auto;
			page-break-after: auto;
		}
	}
</style>
