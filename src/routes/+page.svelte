<script lang="ts">
	import { onMount } from 'svelte';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Menu from '#lib/components/Menu.svelte';
	import { ago, t } from '#lib/i18n/index.svelte.ts';
	import { withBase } from '#lib/client/base.ts';
	import { goto } from '#lib/client/nav.ts';
	import { toast } from '#lib/client/toast.svelte.ts';
	import { confirmDialog, promptDialog } from '#lib/client/dialogs.svelte.ts';
	import { deleteForever, duplicateFile, emptyTrash, listFiles, onLibraryChange, renameFile, restoreFile, trashFile, type FileMeta } from '#lib/storage/library.ts';
	import { importFile, isSupported, pickFiles } from '#lib/files/open.ts';
	import { fileRoute, newOfKind } from '#lib/files/create.ts';
	import { formatBytes } from '#lib/i18n/index.svelte.ts';

	type Tab = 'all' | 'doc' | 'sheet' | 'slides' | 'trash';
	type Sort = 'updated' | 'title' | 'created';

	let files = $state<FileMeta[]>([]);
	let loaded = $state(false);
	let tab = $state<Tab>('all');
	let sort = $state<Sort>(readSort());
	let query = $state('');
	let dragging = $state(0);
	let busy = $state(false);

	function readSort(): Sort {
		try {
			const s = localStorage.getItem('mai.librarySort');
			return s === 'title' || s === 'created' ? s : 'updated';
		} catch {
			return 'updated';
		}
	}
	$effect(() => {
		try {
			localStorage.setItem('mai.librarySort', sort);
		} catch {
			/* ignore */
		}
	});

	async function refresh() {
		files = await listFiles();
		loaded = true;
	}

	onMount(() => {
		void refresh();
		const off = onLibraryChange(() => void refresh());
		return off;
	});

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const list = files.filter((f) => (tab === 'trash' ? !!f.trashedAt : !f.trashedAt && (tab === 'all' || f.kind === tab)) && (!q || f.title.toLowerCase().includes(q)));
		const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
		return list.sort((a, b) => (sort === 'title' ? coll.compare(a.title, b.title) : sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt));
	});
	const trashCount = $derived(files.filter((f) => f.trashedAt).length);

	const href = (f: FileMeta) => withBase(fileRoute(f.kind, f.id));
	const KIND_CLASS = { doc: 'bg-doc/12 text-doc', sheet: 'bg-sheet/12 text-sheet', slides: 'bg-slides/12 text-slides' } as const;

	async function create(kind: 'doc' | 'sheet' | 'slides') {
		const meta = await newOfKind(kind);
		await goto(fileRoute(kind, meta.id));
	}

	async function openFiles(list: { file: File; handle?: FileSystemFileHandle }[]) {
		if (!list.length) return;
		busy = true;
		let last: FileMeta | null = null;
		for (const { file, handle } of list) {
			if (!isSupported(file.name)) {
				toast.error(t().library.unsupported(file.name));
				continue;
			}
			try {
				const { meta, warnings } = await importFile(file, handle);
				for (const w of warnings) toast.warn(w, { detail: file.name });
				last = meta;
			} catch (e) {
				console.error(e);
				toast.error(t().library.openFailed, { detail: `${file.name}: ${(e as Error)?.message ?? e}` });
			}
		}
		busy = false;
		if (last && list.length === 1) await goto(fileRoute(last.kind, last.id));
		else if (last) toast.success(t().library.imported(last.title));
	}

	async function rename(f: FileMeta) {
		const name = await promptDialog(t().common.rename, f.title, { validate: (v) => (v.trim() ? null : t().common.name) });
		if (name?.trim()) await renameFile(f.id, name.trim());
	}

	async function trash(f: FileMeta) {
		await trashFile(f.id);
		toast.info(t().library.movedToTrash(f.title), { actions: [{ label: t().common.undo, run: () => void restoreFile(f.id) }] });
	}

	async function destroy(f: FileMeta) {
		if (await confirmDialog(t().library.confirmDeleteForever(f.title), { danger: true, confirm: t().library.deleteForever })) await deleteForever(f.id);
	}

	async function clearTrash() {
		if (await confirmDialog(t().library.confirmEmptyTrash(trashCount), { danger: true, confirm: t().library.emptyTrash })) await emptyTrash();
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = 0;
		const list = [...(e.dataTransfer?.files ?? [])].map((file) => ({ file }));
		void openFiles(list);
	}

	const tabs = $derived([
		{ id: 'all' as Tab, label: t().library.filterAll },
		{ id: 'doc' as Tab, label: t().library.filterDocs },
		{ id: 'sheet' as Tab, label: t().library.filterSheets },
		{ id: 'slides' as Tab, label: t().library.filterSlides },
		{ id: 'trash' as Tab, label: t().library.trash }
	]);
</script>

<svelte:window
	ondragenter={(e) => {
		if (e.dataTransfer?.types.includes('Files')) dragging++;
	}}
	ondragleave={() => (dragging = Math.max(0, dragging - 1))}
	ondragover={(e) => e.preventDefault()}
	ondrop={onDrop}
/>

<AppHeader />

<main class="mx-auto max-w-6xl px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
	<section class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<button class="group flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-left transition hover:border-doc hover:shadow-md" onclick={() => create('doc')}>
			<span class="grid size-11 place-items-center rounded-lg bg-doc/12 text-doc"><Icon name="doc" size={24} /></span>
			<span class="font-medium">{t().library.newDoc}</span>
		</button>
		<button class="group flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-left transition hover:border-sheet hover:shadow-md" onclick={() => create('sheet')}>
			<span class="grid size-11 place-items-center rounded-lg bg-sheet/12 text-sheet"><Icon name="sheet" size={24} /></span>
			<span class="font-medium">{t().library.newSheet}</span>
		</button>
		<button class="group flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-left transition hover:border-slides hover:shadow-md" onclick={() => create('slides')}>
			<span class="grid size-11 place-items-center rounded-lg bg-slides/12 text-slides"><Icon name="slides" size={24} /></span>
			<span class="font-medium">{t().library.newSlides}</span>
		</button>
		<button class="group flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface p-4 text-left transition hover:border-accent hover:shadow-md disabled:opacity-60" disabled={busy} onclick={async () => openFiles(await pickFiles())}>
			<span class="grid size-11 place-items-center rounded-lg bg-accent-soft text-accent"><Icon name="open" size={24} /></span>
			<span>
				<span class="block font-medium">{busy ? t().common.loading : t().library.open}</span>
				<span class="block text-xs text-muted">.docx · .xlsx · .csv · .md · .txt</span>
			</span>
		</button>
	</section>

	<div class="mb-3 flex flex-wrap items-center gap-2">
		<div class="flex rounded-lg border border-line bg-surface p-0.5" role="tablist">
			{#each tabs as tb (tb.id)}
				<button role="tab" aria-selected={tab === tb.id} class="rounded-md px-3 py-1 text-sm {tab === tb.id ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-fg'}" onclick={() => (tab = tb.id)}>
					{tb.label}{#if tb.id === 'trash' && trashCount}<span class="ml-1 text-xs text-faint">{trashCount}</span>{/if}
				</button>
			{/each}
		</div>
		<label class="relative ml-auto flex min-w-0 flex-1 items-center sm:max-w-64">
			<Icon name="search" size={16} class="pointer-events-none absolute left-2.5 text-faint" />
			<input class="input w-full pl-8" type="search" placeholder={t().library.searchPlaceholder} bind:value={query} aria-label={t().common.search} />
		</label>
		<select class="select" bind:value={sort} aria-label="Sort">
			<option value="updated">{t().library.sortUpdated}</option>
			<option value="created">{t().library.sortCreated}</option>
			<option value="title">{t().library.sortTitle}</option>
		</select>
	</div>

	{#if tab === 'trash' && trashCount}
		<div class="mb-3 flex justify-end">
			<button class="btn btn-ghost text-bad" onclick={clearTrash}><Icon name="trash" size={16} />{t().library.emptyTrash}</button>
		</div>
	{/if}

	{#if loaded && !shown.length}
		<div class="rounded-xl border border-dashed border-line px-6 py-14 text-center">
			<p class="font-medium">{tab === 'trash' ? t().library.trashEmpty : t().library.empty}</p>
			{#if tab !== 'trash'}<p class="mx-auto mt-1 max-w-md text-sm text-muted">{t().library.emptyHint}</p>{/if}
		</div>
	{:else}
		<ul class="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
			{#each shown as f (f.id)}
				<li class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2/60">
					<span class="grid size-9 shrink-0 place-items-center rounded-md {KIND_CLASS[f.kind]}">
						<Icon name={f.kind} />
					</span>
					{#if f.trashedAt}
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium text-muted">{f.title}</span>
							<span class="block text-xs text-faint">{t().kind[f.kind]} · {formatBytes(f.size)}</span>
						</span>
						<button class="btn btn-ghost" onclick={() => restoreFile(f.id)}><Icon name="restore" size={16} /><span class="hidden sm:inline">{t().library.restore}</span></button>
						<button class="btn btn-ghost text-bad" onclick={() => destroy(f)} title={t().library.deleteForever} aria-label={t().library.deleteForever}><Icon name="trash" size={16} /></button>
					{:else}
						<a href={href(f)} class="min-w-0 flex-1">
							<span class="block truncate font-medium">{f.title}</span>
							<span class="block text-xs text-faint">{t().kind[f.kind]} · {t().library.edited(ago(f.updatedAt))} · {formatBytes(f.size)}</span>
						</a>
						<Menu title={t().common.more} align="right" triggerClass="tb gap-0">
							{#snippet icon()}<Icon name="dots" />{/snippet}
							{#snippet children(close)}
								<a class="menu-item" href={href(f)} onclick={close}><Icon name="open" size={16} />{t().common.open}</a>
								<button class="menu-item" onclick={() => (close(), rename(f))}><Icon name="rename" size={16} />{t().common.rename}</button>
								<button class="menu-item" onclick={() => (close(), duplicateFile(f.id, t().library.copyOf(f.title)))}><Icon name="copy" size={16} />{t().common.duplicate}</button>
								<button class="menu-item text-bad" onclick={() => (close(), trash(f))}><Icon name="trash" size={16} />{t().library.moveToTrash}</button>
							{/snippet}
						</Menu>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

{#if dragging}
	<div class="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-accent/10 backdrop-blur-[1px]">
		<div class="rounded-2xl border-2 border-dashed border-accent bg-surface px-10 py-8 text-lg font-medium text-accent shadow-xl">{t().library.dropHere}</div>
	</div>
{/if}
