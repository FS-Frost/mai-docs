<script lang="ts">
	// Library as a file explorer: nested folders (?folder=<id>), breadcrumbs, list/grid views, multi-selection,
	// drag to move, context menu and keyboard. Type filters act on the open folder; search covers the whole library.
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import ContextMenu, { type MenuAt } from '#lib/components/ContextMenu.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Menu from '#lib/components/Menu.svelte';
	import MoveDialog from '#lib/components/library/MoveDialog.svelte';
	import SlidesThumb from '#lib/components/library/SlidesThumb.svelte';
	import { ago, formatBytes, t } from '#lib/i18n/index.svelte.ts';
	import { goto } from '#lib/client/nav.ts';
	import { toast } from '#lib/client/toast.svelte.ts';
	import { confirmDialog, dialog, promptDialog } from '#lib/client/dialogs.svelte.ts';
	import {
		createFolder,
		deleteFolderForever,
		deleteForever,
		duplicateFile,
		emptyTrash,
		listFiles,
		listFolders,
		moveItems,
		onLibraryChange,
		renameFile,
		renameFolder,
		restoreFile,
		restoreFolder,
		trashFile,
		trashFolder,
		type FileMeta,
		type Folder
	} from '#lib/storage/library.ts';
	import { fileVisible, folderMap, folderVisible, isWithin, parentOf, pathOf, trashRoots } from '#lib/storage/tree.ts';
	import { importFile, isSupported, pickFiles } from '#lib/files/open.ts';
	import { fileRoute, newOfKind } from '#lib/files/create.ts';

	type Tab = 'all' | 'doc' | 'sheet' | 'slides' | 'trash';
	type Sort = 'updated' | 'title' | 'created' | 'size' | 'kind';
	type View = 'list' | 'grid';
	type Item = { key: string; name: string; updated: number; created: number; size: number; path: string } & ({ type: 'folder'; folder: Folder; count: number } | { type: 'file'; file: FileMeta });

	const DRAG_MIME = 'application/x-mai-items';

	let files = $state<FileMeta[]>([]);
	let folders = $state<Folder[]>([]);
	let loaded = $state(false);
	let tab = $state<Tab>('all');
	const sort0 = readPref<Sort>('mai.librarySort', ['updated', 'title', 'created', 'size', 'kind'], 'updated');
	let sort = $state<Sort>(sort0);
	let dir = $state<'asc' | 'desc'>(readPref('mai.librarySortDir', ['asc', 'desc'], sort0 === 'title' || sort0 === 'kind' ? 'asc' : 'desc'));
	let view = $state<View>(readPref('mai.libraryView', ['list', 'grid'], 'list'));
	let query = $state('');
	let dragging = $state(0);
	let busy = $state(false);

	const selected = new SvelteSet<string>();
	let anchor: string | null = null;
	let focusKey = $state<string | null>(null);
	let menu = $state<{ at: MenuAt; key: string | null } | null>(null);
	let moving = $state<{ files: string[]; folders: string[] } | null>(null);
	let dropKey = $state<string | null>(null);
	let dragKeys: string[] = [];
	let lastPointer = 'mouse';
	let listEl = $state<HTMLDivElement>();

	function readPref<T extends string>(key: string, allowed: T[], fallback: T): T {
		try {
			const v = localStorage.getItem(key) as T | null;
			return v && allowed.includes(v) ? v : fallback;
		} catch {
			return fallback;
		}
	}
	function savePref(key: string, v: string) {
		try {
			localStorage.setItem(key, v);
		} catch {
			/* no storage */
		}
	}
	$effect(() => savePref('mai.librarySort', sort));
	$effect(() => savePref('mai.librarySortDir', dir));
	$effect(() => savePref('mai.libraryView', view));

	async function refresh() {
		[files, folders] = await Promise.all([listFiles(), listFolders()]);
		loaded = true;
	}

	onMount(() => {
		void refresh();
		return onLibraryChange(() => void refresh());
	});

	// ---------- Derived tree ----------

	const map = $derived(folderMap(folders));
	const requested = $derived(page.url.searchParams.get('folder') ?? undefined);
	/** Open folder; a missing or trashed one falls back to the root. */
	const current = $derived(requested && map.has(requested) && folderVisible(map, map.get(requested)!) ? requested : undefined);
	const crumbs = $derived(pathOf(map, current));
	const searching = $derived(tab !== 'trash' && !!query.trim());
	const roots = $derived(trashRoots(folders, files));
	const trashCount = $derived(roots.folders.length + roots.files.length);

	const pathText = (folderId: string | undefined) => [t().library.title, ...pathOf(map, parentOf(map, folderId)).map((f) => f.name)].join(' › ');

	const fileItem = (f: FileMeta): Item => ({ key: `f:${f.id}`, type: 'file', file: f, name: f.title, updated: f.updatedAt, created: f.createdAt, size: f.size, path: pathText(f.folderId) });
	const folderItem = (f: Folder): Item => ({
		key: `d:${f.id}`,
		type: 'folder',
		folder: f,
		name: f.name,
		updated: f.updatedAt,
		created: f.createdAt,
		size: 0,
		count: folders.filter((x) => !x.trashedAt && parentOf(map, x.parentId) === f.id).length + files.filter((x) => !x.trashedAt && parentOf(map, x.folderId) === f.id).length,
		path: pathText(f.parentId)
	});

	const shown = $derived.by((): Item[] => {
		const q = query.trim().toLowerCase();
		const match = (name: string) => !q || name.toLowerCase().includes(q);
		const kindOk = (f: FileMeta) => tab === 'all' || tab === 'trash' || f.kind === tab;
		let fs: Folder[];
		let fl: FileMeta[];
		if (tab === 'trash') {
			fs = roots.folders.filter((f) => match(f.name));
			fl = roots.files.filter((f) => match(f.title));
		} else if (searching) {
			fs = tab === 'all' ? folders.filter((f) => folderVisible(map, f) && match(f.name)) : [];
			fl = files.filter((f) => fileVisible(map, f) && kindOk(f) && match(f.title));
		} else {
			fs = folders.filter((f) => !f.trashedAt && parentOf(map, f.parentId) === current);
			fl = files.filter((f) => !f.trashedAt && parentOf(map, f.folderId) === current && kindOk(f));
		}
		const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
		const sign = dir === 'asc' ? 1 : -1;
		const cmp = (a: Item, b: Item) => {
			const by =
				sort === 'title'
					? coll.compare(a.name, b.name)
					: sort === 'created'
						? a.created - b.created
						: sort === 'size'
							? (a.type === 'folder' && b.type === 'folder' ? a.count - b.count : a.size - b.size)
							: sort === 'kind'
								? coll.compare(kindLabel(a), kindLabel(b)) || coll.compare(a.name, b.name)
								: a.updated - b.updated;
			return by * sign || coll.compare(a.name, b.name);
		};
		return [...fs.map(folderItem).sort(cmp), ...fl.map(fileItem).sort(cmp)];
	});

	const byKey = $derived(new Map(shown.map((i) => [i.key, i])));
	const selItems = $derived(shown.filter((i) => selected.has(i.key)));

	// Drop selection entries that left the view (navigation, filters, other tabs).
	$effect(() => {
		for (const k of [...selected]) if (!byKey.has(k)) selected.delete(k);
		if (focusKey && !byKey.has(focusKey)) focusKey = null;
	});

	const kindLabel = (i: Item) => (i.type === 'folder' ? t().library.folder : t().kind[i.file.kind]);
	const KIND_CLASS = { doc: 'bg-doc/12 text-doc', sheet: 'bg-sheet/12 text-sheet', slides: 'bg-slides/12 text-slides' } as const;
	const iconOf = (i: Item) => (i.type === 'folder' ? 'folder' : i.file.kind);
	const tintOf = (i: Item) => (i.type === 'folder' ? 'bg-accent-soft text-accent' : KIND_CLASS[i.file.kind]);
	const metaOf = (i: Item) => (i.type === 'folder' ? t().library.items(i.count) : formatBytes(i.size));

	// ---------- Navigation ----------

	function openFolder(id: string | undefined) {
		query = '';
		selected.clear();
		anchor = null;
		focusKey = null;
		if (tab === 'trash') tab = 'all';
		void goto(id ? `/?folder=${encodeURIComponent(id)}` : '/');
	}

	function openItem(i: Item) {
		if (tab === 'trash') return;
		if (i.type === 'folder') openFolder(i.folder.id);
		else void goto(fileRoute(i.file.kind, i.file.id));
	}

	// ---------- Create / open ----------

	async function create(kind: 'doc' | 'sheet' | 'slides') {
		const meta = await newOfKind(kind, current);
		await goto(fileRoute(kind, meta.id));
	}

	async function newFolder() {
		const name = await promptDialog(t().library.folderName, t().library.untitledFolder, { validate: (v) => (v.trim() ? null : t().common.name) });
		if (!name?.trim()) return;
		const f = await createFolder(name.trim(), current);
		await refresh();
		select(`d:${f.id}`);
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
				const { meta, warnings } = await importFile(file, handle, current);
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

	// ---------- Selection ----------

	function select(key: string) {
		selected.clear();
		selected.add(key);
		anchor = key;
		focusKey = key;
	}

	function toggle(key: string) {
		if (selected.has(key)) selected.delete(key);
		else selected.add(key);
		anchor = key;
		focusKey = key;
	}

	function range(to: string) {
		const keys = shown.map((i) => i.key);
		const a = keys.indexOf(anchor ?? to);
		const b = keys.indexOf(to);
		if (a < 0 || b < 0) return select(to);
		selected.clear();
		for (const k of keys.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(k);
		focusKey = to;
	}

	function clickItem(e: MouseEvent, i: Item) {
		if (e.ctrlKey || e.metaKey) return toggle(i.key);
		if (e.shiftKey) return range(i.key);
		// Touch: tap opens, or toggles while something is selected (checkbox mode).
		if (lastPointer !== 'mouse') return selected.size ? toggle(i.key) : openItem(i);
		select(i.key);
	}

	const split = (items: Item[]) => ({ files: items.flatMap((i) => (i.type === 'file' ? [i.file.id] : [])), folders: items.flatMap((i) => (i.type === 'folder' ? [i.folder.id] : [])) });

	// ---------- Actions ----------

	async function rename(i: Item) {
		const name = await promptDialog(t().common.rename, i.name, { validate: (v) => (v.trim() ? null : t().common.name) });
		if (!name?.trim() || name.trim() === i.name) return;
		if (i.type === 'folder') await renameFolder(i.folder.id, name.trim());
		else await renameFile(i.file.id, name.trim());
	}

	async function trash(items: Item[]) {
		if (!items.length) return;
		const { files: fl, folders: fs } = split(items);
		for (const id of fs) await trashFolder(id);
		for (const id of fl) await trashFile(id);
		const undo = async () => {
			for (const id of fs) await restoreFolder(id);
			for (const id of fl) await restoreFile(id);
		};
		toast.info(items.length === 1 ? t().library.movedToTrash(items[0].name) : t().library.movedToTrashN(items.length), { actions: [{ label: t().common.undo, run: () => void undo() }] });
	}

	async function restore(items: Item[]) {
		const { files: fl, folders: fs } = split(items);
		for (const id of fs) await restoreFolder(id);
		for (const id of fl) await restoreFile(id);
	}

	async function destroy(items: Item[]) {
		if (!items.length) return;
		const msg = items.length === 1 ? (items[0].type === 'folder' ? t().library.confirmDeleteFolder(items[0].name) : t().library.confirmDeleteForever(items[0].name)) : t().library.confirmDeleteForeverN(items.length);
		if (!(await confirmDialog(msg, { danger: true, confirm: t().library.deleteForever }))) return;
		const { files: fl, folders: fs } = split(items);
		for (const id of fs) await deleteFolderForever(id);
		for (const id of fl) await deleteForever(id);
	}

	async function duplicate(items: Item[]) {
		for (const i of items) if (i.type === 'file') await duplicateFile(i.file.id, t().library.copyOf(i.file.title));
	}

	async function clearTrash() {
		if (await confirmDialog(t().library.confirmEmptyTrash(trashCount), { danger: true, confirm: t().library.emptyTrash })) await emptyTrash();
	}

	/** One file as-is, one folder as "<folder>.zip", several items as "<open folder>.zip" (Office formats). */
	async function downloadSel(items: Item[]) {
		if (!items.length) return;
		toast.info(t().library.preparingDownload, { key: 'download', duration: null });
		try {
			const { downloadItems } = await import('#lib/files/download.ts');
			const res = await downloadItems(split(items), current ? (map.get(current)?.name ?? t().library.title) : t().library.title);
			toast.dismissKey('download');
			if (!res) return;
			if (res.failed.length) toast.warn(t().library.downloadSkipped(res.failed.join(', ')));
			toast.success(t().file.downloaded(res.name));
		} catch (e) {
			console.error(e);
			toast.dismissKey('download');
			toast.error(t().library.downloadFailed, { detail: String((e as Error)?.message ?? e) });
		}
	}

	async function moveTo(items: { files: string[]; folders: string[] }, target: string | undefined) {
		const n = await moveItems(items, target);
		if (n) toast.success(t().library.moved(n, target ? (map.get(target)?.name ?? '') : t().library.title));
	}

	// ---------- Context menu ----------

	function contextItem(e: MouseEvent, i: Item) {
		e.preventDefault();
		e.stopPropagation();
		if (!selected.has(i.key)) select(i.key);
		menu = { at: { x: e.clientX, y: e.clientY }, key: i.key };
		menuItems = selItems;
	}

	function contextButton(e: MouseEvent, i: Item) {
		e.stopPropagation();
		if (!selected.has(i.key)) select(i.key);
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		menu = { at: { x: r.left, y: r.bottom + 4 }, key: i.key };
		menuItems = selItems;
	}

	function contextBackground(e: MouseEvent) {
		e.preventDefault();
		selected.clear();
		menu = { at: { x: e.clientX, y: e.clientY }, key: null };
		menuItems = [];
	}

	// ---------- Drag to move ----------

	function dragStart(e: DragEvent, i: Item) {
		if (tab === 'trash' || !e.dataTransfer) return;
		if (!selected.has(i.key)) select(i.key);
		dragKeys = selItems.map((x) => x.key);
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragKeys));
		e.dataTransfer.setData('text/plain', selItems.map((x) => x.name).join('\n'));
	}

	/** Can the dragged items go into folder `target` (undefined = root)? */
	function canDrop(target: string | undefined) {
		if (!dragKeys.length) return false;
		return dragKeys.every((k) => {
			const i = byKey.get(k);
			if (!i) return false;
			if (i.type === 'folder') return !(target && isWithin(map, target, i.folder.id)) && parentOf(map, i.folder.parentId) !== target;
			return parentOf(map, i.file.folderId) !== target;
		});
	}

	function dragOver(e: DragEvent, key: string, target: string | undefined) {
		if (!e.dataTransfer?.types.includes(DRAG_MIME) || !canDrop(target)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'move';
		dropKey = key;
	}

	function drop(e: DragEvent, target: string | undefined) {
		if (!e.dataTransfer?.types.includes(DRAG_MIME)) return;
		e.preventDefault();
		e.stopPropagation();
		const items = dragKeys.map((k) => byKey.get(k)).filter((x): x is Item => !!x);
		dropKey = null;
		dragKeys = [];
		if (items.length && canDropItems(items, target)) void moveTo(split(items), target);
	}
	const canDropItems = (items: Item[], target: string | undefined) => items.every((i) => i.type === 'file' || !(target && isWithin(map, target, i.folder.id)));

	function onWindowDrop(e: DragEvent) {
		e.preventDefault();
		dragging = 0;
		if (e.dataTransfer?.types.includes(DRAG_MIME)) return;
		void openFiles([...(e.dataTransfer?.files ?? [])].map((file) => ({ file })));
	}

	// ---------- Keyboard ----------

	function focusItem(key: string) {
		focusKey = key;
		void tick().then(() => listEl?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus());
	}

	/** Items per row in the grid (same offsetTop as the first one). */
	function columns() {
		const els = [...(listEl?.querySelectorAll<HTMLElement>('[data-key]') ?? [])];
		if (view === 'list' || !els.length) return 1;
		const top = els[0].offsetTop;
		return Math.max(1, els.filter((x) => x.offsetTop === top).length);
	}

	function listKey(e: KeyboardEvent) {
		if ((e.target as HTMLElement).closest('input,textarea,select')) return;
		const keys = shown.map((i) => i.key);
		const cur = focusKey && keys.includes(focusKey) ? keys.indexOf(focusKey) : -1;
		const mod = e.ctrlKey || e.metaKey;
		const step = { ArrowDown: columns(), ArrowUp: -columns(), ArrowRight: view === 'grid' ? 1 : 0, ArrowLeft: view === 'grid' ? -1 : 0, Home: -Infinity, End: Infinity }[e.key];
		if (step !== undefined && keys.length) {
			if (!step) return;
			e.preventDefault();
			const next = keys[Math.max(0, Math.min(keys.length - 1, cur < 0 ? 0 : cur + step))];
			if (e.shiftKey) range(next);
			else if (mod) focusKey = next;
			else select(next);
			focusItem(next);
			return;
		}
		const focused = focusKey ? byKey.get(focusKey) : undefined;
		if (e.key === ' ' && focused) {
			e.preventDefault();
			toggle(focused.key);
		} else if (e.key === 'Enter' && focused) {
			e.preventDefault();
			openItem(focused);
		} else if (e.key === 'F2' && focused && tab !== 'trash') {
			e.preventDefault();
			void rename(focused);
		} else if (e.key === 'Delete' && selItems.length) {
			e.preventDefault();
			void (tab === 'trash' ? destroy(selItems) : trash(selItems));
		} else if (mod && e.key.toLowerCase() === 'a') {
			e.preventDefault();
			for (const k of keys) selected.add(k);
		} else if (e.key === 'Escape' && selected.size) {
			e.preventDefault();
			selected.clear();
		}
	}

	function windowKey(e: KeyboardEvent) {
		if (dialog.current || moving || menu) return;
		if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
		if (e.key === 'Backspace' && current && !searching && tab !== 'trash') {
			e.preventDefault();
			openFolder(parentOf(map, map.get(current)?.parentId));
		}
	}

	const tabs = $derived([
		{ id: 'all' as Tab, label: t().library.filterAll },
		{ id: 'doc' as Tab, label: t().library.filterDocs },
		{ id: 'sheet' as Tab, label: t().library.filterSheets },
		{ id: 'slides' as Tab, label: t().library.filterSlides },
		{ id: 'trash' as Tab, label: t().library.trash }
	]);

	function sortBy(s: Sort) {
		if (sort === s) dir = dir === 'asc' ? 'desc' : 'asc';
		else {
			sort = s;
			dir = s === 'title' || s === 'kind' ? 'asc' : 'desc';
		}
	}

	// Items the open menu acts on, captured when it opens (actions run after close()).
	let menuItems = $state.raw<Item[]>([]);
</script>

<svelte:window
	ondragenter={(e) => {
		if (e.dataTransfer?.types.includes('Files')) dragging++;
	}}
	ondragleave={() => (dragging = Math.max(0, dragging - 1))}
	ondragover={(e) => e.preventDefault()}
	ondrop={onWindowDrop}
	ondragend={() => ((dragKeys = []), (dropKey = null))}
	onkeydown={windowKey}
	onpointerdown={(e) => (lastPointer = e.pointerType || 'mouse')}
/>

{#snippet sortHead(s: Sort, label: string, cls = '')}
	<button class="flex items-center gap-1 rounded px-1 py-0.5 text-left hover:text-fg {sort === s ? 'text-fg' : ''} {cls}" onclick={() => sortBy(s)} aria-pressed={sort === s}>
		{label}
		{#if sort === s}<Icon name={dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={12} />{/if}
	</button>
{/snippet}

{#snippet check(i: Item)}
	<input
		type="checkbox"
		class="size-4 shrink-0 accent-[var(--c-accent)] {selected.has(i.key) || selected.size ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(pointer:coarse)]:opacity-100'}"
		checked={selected.has(i.key)}
		aria-label={t().library.selectItem(i.name)}
		tabindex="-1"
		onclick={(e) => {
			e.stopPropagation();
			toggle(i.key);
		}}
		ondblclick={(e) => e.stopPropagation()}
	/>
{/snippet}

{#snippet dots(i: Item)}
	<button class="tb shrink-0" title={t().common.more} aria-label={t().common.more} tabindex="-1" onclick={(e) => contextButton(e, i)} ondblclick={(e) => e.stopPropagation()}><Icon name="dots" /></button>
{/snippet}

<AppHeader />

<main class="mx-auto max-w-6xl px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))]">
	<section class="mb-4 flex flex-wrap items-center gap-2">
		<Menu label={t().library.newFile} triggerClass="btn btn-primary gap-1.5">
			{#snippet icon()}<Icon name="plus" size={18} />{/snippet}
			{#snippet children(close)}
				<button class="menu-item" onclick={() => (close(), create('doc'))}><span class="text-doc"><Icon name="doc" size={16} /></span>{t().kind.doc}</button>
				<button class="menu-item" onclick={() => (close(), create('sheet'))}><span class="text-sheet"><Icon name="sheet" size={16} /></span>{t().kind.sheet}</button>
				<button class="menu-item" onclick={() => (close(), create('slides'))}><span class="text-slides"><Icon name="slides" size={16} /></span>{t().kind.slides}</button>
				<div class="my-1 border-t border-line"></div>
				<button class="menu-item" onclick={() => (close(), newFolder())}><Icon name="folderPlus" size={16} />{t().library.folder}</button>
			{/snippet}
		</Menu>
		<button class="btn gap-1.5" disabled={busy} onclick={async () => openFiles(await pickFiles())} title=".docx · .xlsx · .pptx · .csv · .md · .txt">
			<Icon name="open" size={18} />{busy ? t().common.loading : t().library.open}
		</button>
		<div class="ml-auto flex rounded-lg border border-line bg-surface p-0.5" role="radiogroup" aria-label={t().library.view}>
			<button role="radio" aria-checked={view === 'list'} class="rounded-md p-1.5 {view === 'list' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg'}" title={t().library.viewList} aria-label={t().library.viewList} onclick={() => (view = 'list')}><Icon name="viewList" size={18} /></button>
			<button role="radio" aria-checked={view === 'grid'} class="rounded-md p-1.5 {view === 'grid' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg'}" title={t().library.viewGrid} aria-label={t().library.viewGrid} onclick={() => (view = 'grid')}><Icon name="viewGrid" size={18} /></button>
		</div>
	</section>

	<nav class="mb-3 flex min-h-8 flex-wrap items-center gap-0.5 text-sm" aria-label={t().library.location}>
		{#if tab === 'trash'}
			<span class="px-1.5 font-medium">{t().library.trash}</span>
		{:else if searching}
			<span class="px-1.5 text-muted">{t().library.searchAll}</span>
		{:else}
			{#each [undefined, ...crumbs.map((c) => c.id)] as id, k (id ?? '')}
				{@const last = k === crumbs.length}
				{#if k}<Icon name="chevronRight" size={14} class="text-faint" />{/if}
				<button
					class="rounded px-1.5 py-0.5 {last ? 'font-medium' : 'text-muted hover:bg-surface-2 hover:text-fg'} {dropKey === `c:${id ?? ''}` ? 'bg-accent-soft text-accent ring-1 ring-accent' : ''}"
					aria-current={last ? 'page' : undefined}
					onclick={() => !last && openFolder(id)}
					ondragover={(e) => dragOver(e, `c:${id ?? ''}`, id)}
					ondragleave={() => dropKey === `c:${id ?? ''}` && (dropKey = null)}
					ondrop={(e) => drop(e, id)}
				>
					{id ? map.get(id)?.name : t().library.title}
				</button>
			{/each}
		{/if}
	</nav>

	<div class="mb-3 flex flex-wrap items-center gap-2">
		<div class="flex flex-wrap rounded-lg border border-line bg-surface p-0.5" role="tablist">
			{#each tabs as tb (tb.id)}
				<button role="tab" aria-selected={tab === tb.id} class="rounded-md px-3 py-1 text-sm {tab === tb.id ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-fg'}" onclick={() => ((tab = tb.id), selected.clear())}>
					{tb.label}{#if tb.id === 'trash' && trashCount}<span class="ml-1 text-xs text-faint">{trashCount}</span>{/if}
				</button>
			{/each}
		</div>
		{#if tab === 'trash' && trashCount}<button class="btn btn-ghost text-bad" onclick={clearTrash}><Icon name="trash" size={16} />{t().library.emptyTrash}</button>{/if}
		<label class="relative ml-auto flex min-w-0 flex-1 items-center sm:max-w-64">
			<Icon name="search" size={16} class="pointer-events-none absolute left-2.5 text-faint" />
			<input class="input w-full pl-8" type="search" placeholder={t().library.searchPlaceholder} bind:value={query} aria-label={t().common.search} />
		</label>
		{#if view === 'grid'}
			<select class="select" bind:value={sort} aria-label={t().library.sortBy}>
				<option value="updated">{t().library.sortUpdated}</option>
				<option value="created">{t().library.sortCreated}</option>
				<option value="title">{t().library.sortTitle}</option>
				<option value="kind">{t().library.colType}</option>
				<option value="size">{t().library.colSize}</option>
			</select>
			<button class="tb" title={dir === 'asc' ? t().library.sortAsc : t().library.sortDesc} aria-label={dir === 'asc' ? t().library.sortAsc : t().library.sortDesc} onclick={() => (dir = dir === 'asc' ? 'desc' : 'asc')}>
				<Icon name={dir === 'asc' ? 'chevronUp' : 'chevronDown'} />
			</button>
		{/if}
	</div>

	<!-- Keyboard lives on the listbox; this layer only catches background clicks and right clicks. -->
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div class="min-h-[50vh]" oncontextmenu={contextBackground} onclick={(e) => e.target === e.currentTarget && selected.clear()}>
		{#if loaded && !shown.length}
			<div class="rounded-xl border border-dashed border-line px-6 py-14 text-center">
				<p class="font-medium">{tab === 'trash' ? t().library.trashEmpty : searching ? t().library.noResults : current ? t().library.emptyFolder : t().library.empty}</p>
				{#if tab !== 'trash' && !searching}<p class="mx-auto mt-1 max-w-md text-sm text-muted">{current ? t().library.emptyFolderHint : t().library.emptyHint}</p>{/if}
			</div>
		{:else if view === 'list'}
			<div class="overflow-hidden rounded-xl border border-line bg-surface">
				<div class="hidden grid-cols-[1.5rem_minmax(0,1fr)_8rem_10rem_6rem_2rem] items-center gap-3 border-b border-line px-3 py-1.5 text-xs text-muted sm:grid">
					<span></span>
					{@render sortHead('title', t().library.colName)}
					{@render sortHead('kind', t().library.colType)}
					{@render sortHead('updated', t().library.colModified)}
					{@render sortHead('size', t().library.colSize, 'justify-self-end')}
					<span></span>
				</div>
				<div bind:this={listEl} class="divide-y divide-line" role="listbox" aria-multiselectable="true" aria-label={t().library.title} tabindex="-1" onkeydown={listKey}>
					{#each shown as i (i.key)}
						{@const sel = selected.has(i.key)}
						<!-- svelte-ignore a11y_click_events_have_key_events (keys handled by the listbox) -->
						<div
							data-key={i.key}
							role="option"
							aria-selected={sel}
							tabindex={focusKey === i.key || (!focusKey && i === shown[0]) ? 0 : -1}
							draggable={tab !== 'trash'}
							class="group grid cursor-default grid-cols-[1.5rem_minmax(0,1fr)_2rem] items-center gap-3 px-3 py-2 outline-none select-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset sm:grid-cols-[1.5rem_minmax(0,1fr)_8rem_10rem_6rem_2rem] {sel ? 'bg-accent-soft/70' : 'hover:bg-surface-2/60'} {dropKey === i.key ? 'ring-2 ring-accent ring-inset' : ''}"
							onclick={(e) => clickItem(e, i)}
							ondblclick={() => openItem(i)}
							oncontextmenu={(e) => contextItem(e, i)}
							onfocus={() => (focusKey = i.key)}
							ondragstart={(e) => dragStart(e, i)}
							ondragover={(e) => i.type === 'folder' && !selected.has(i.key) && dragOver(e, i.key, i.folder.id)}
							ondragleave={() => dropKey === i.key && (dropKey = null)}
							ondrop={(e) => i.type === 'folder' && drop(e, i.folder.id)}
						>
							{@render check(i)}
							<span class="flex min-w-0 items-center gap-3">
								<span class="grid size-9 shrink-0 place-items-center rounded-md {tintOf(i)}"><Icon name={iconOf(i)} /></span>
								<span class="min-w-0">
									<span class="block truncate font-medium {tab === 'trash' ? 'text-muted' : ''}">{i.name}</span>
									{#if searching || tab === 'trash'}<span class="block truncate text-xs text-faint">{i.path}</span>{/if}
									<span class="block truncate text-xs text-faint sm:hidden">{kindLabel(i)} · {ago(i.updated)} · {metaOf(i)}</span>
								</span>
							</span>
							<span class="hidden truncate text-sm text-muted sm:block">{kindLabel(i)}</span>
							<span class="hidden truncate text-sm text-muted sm:block" title={new Date(i.updated).toLocaleString()}>{ago(i.updated)}</span>
							<span class="hidden justify-self-end text-sm text-muted tabular-nums sm:block">{metaOf(i)}</span>
							{@render dots(i)}
						</div>
					{/each}
				</div>
			</div>
		{:else}
			<div bind:this={listEl} class="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3" role="listbox" aria-multiselectable="true" aria-label={t().library.title} tabindex="-1" onkeydown={listKey}>
				{#each shown as i (i.key)}
					{@const sel = selected.has(i.key)}
					<!-- svelte-ignore a11y_click_events_have_key_events (keys handled by the listbox) -->
					<div
						data-key={i.key}
						role="option"
						aria-selected={sel}
						tabindex={focusKey === i.key || (!focusKey && i === shown[0]) ? 0 : -1}
						draggable={tab !== 'trash'}
						class="group relative flex cursor-default flex-col overflow-hidden rounded-xl border bg-surface outline-none select-none focus-visible:ring-2 focus-visible:ring-accent {sel ? 'border-accent ring-1 ring-accent' : 'border-line hover:shadow-md'} {dropKey === i.key ? 'ring-2 ring-accent' : ''}"
						onclick={(e) => clickItem(e, i)}
						ondblclick={() => openItem(i)}
						oncontextmenu={(e) => contextItem(e, i)}
						onfocus={() => (focusKey = i.key)}
						ondragstart={(e) => dragStart(e, i)}
						ondragover={(e) => i.type === 'folder' && !selected.has(i.key) && dragOver(e, i.key, i.folder.id)}
						ondragleave={() => dropKey === i.key && (dropKey = null)}
						ondrop={(e) => i.type === 'folder' && drop(e, i.folder.id)}
					>
						<div class="relative aspect-video border-b border-line bg-surface-2/50">
							{#if i.type === 'file' && i.file.kind === 'slides'}
								<SlidesThumb id={i.file.id} rev={i.file.updatedAt} />
							{:else}
								<span class="absolute inset-0 grid place-items-center"><span class="grid size-14 place-items-center rounded-xl {tintOf(i)}"><Icon name={iconOf(i)} size={30} /></span></span>
							{/if}
							<span class="absolute top-2 left-2 flex">{@render check(i)}</span>
						</div>
						<div class="flex items-center gap-1 py-1.5 pr-1 pl-3">
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium {tab === 'trash' ? 'text-muted' : ''}">{i.name}</span>
								<span class="block truncate text-xs text-faint">{searching || tab === 'trash' ? i.path : `${kindLabel(i)} · ${ago(i.updated)}`}</span>
							</span>
							{@render dots(i)}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</main>

{#if selected.size}
	<!-- Floating, so selecting never shifts the list (a double click must land on the same item). -->
	<div class="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 mx-auto flex w-max max-w-[calc(100%-2rem)] flex-wrap items-center gap-1 rounded-xl border border-line bg-surface px-2 py-1 text-sm shadow-xl" role="toolbar" aria-label={t().library.selected(selected.size)}>
		<button class="tb" title={t().library.clearSelection} aria-label={t().library.clearSelection} onclick={() => selected.clear()}><Icon name="x" size={16} /></button>
		<span class="mr-2 px-1 whitespace-nowrap">{t().library.selected(selected.size)}</span>
		{#if tab === 'trash'}
			<button class="btn btn-ghost" onclick={() => restore(selItems)}><Icon name="restore" size={16} />{t().library.restore}</button>
			<button class="btn btn-ghost text-bad" onclick={() => destroy(selItems)}><Icon name="trash" size={16} />{t().library.deleteForever}</button>
		{:else}
			<button class="btn btn-ghost" title={t().library.download} onclick={() => downloadSel(selItems)}><Icon name="download" size={16} /><span class="hidden sm:inline">{t().library.download}</span></button>
			<button class="btn btn-ghost" onclick={() => (moving = split(selItems))}><Icon name="move" size={16} /><span class="hidden sm:inline">{t().library.moveTo}</span></button>
			{#if selItems.some((i) => i.type === 'file')}<button class="btn btn-ghost" onclick={() => duplicate(selItems)}><Icon name="copy" size={16} /><span class="hidden sm:inline">{t().common.duplicate}</span></button>{/if}
			<button class="btn btn-ghost text-bad" onclick={() => trash(selItems)}><Icon name="trash" size={16} /><span class="hidden sm:inline">{t().library.moveToTrash}</span></button>
		{/if}
	</div>
{/if}

<ContextMenu at={menu?.at ?? null} onclose={() => (menu = null)} label={t().common.more}>
	{#snippet children(close)}
		{@const one = menuItems.length === 1 ? menuItems[0] : null}
		{#if !menu?.key}
			<button class="menu-item" onclick={() => (close(), newFolder())}><Icon name="folderPlus" size={16} />{t().library.newFolder}</button>
			<button class="menu-item" onclick={() => (close(), create('doc'))}><Icon name="doc" size={16} />{t().library.newDoc}</button>
			<button class="menu-item" onclick={() => (close(), create('sheet'))}><Icon name="sheet" size={16} />{t().library.newSheet}</button>
			<button class="menu-item" onclick={() => (close(), create('slides'))}><Icon name="slides" size={16} />{t().library.newSlides}</button>
			<div class="my-1 border-t border-line"></div>
			<button class="menu-item" onclick={async () => (close(), openFiles(await pickFiles()))}><Icon name="open" size={16} />{t().library.open}</button>
		{:else if tab === 'trash'}
			<button class="menu-item" onclick={() => (close(), restore(menuItems))}><Icon name="restore" size={16} />{t().library.restore}</button>
			<button class="menu-item text-bad" onclick={() => (close(), destroy(menuItems))}><Icon name="trash" size={16} />{t().library.deleteForever}</button>
		{:else}
			<button class="menu-item" disabled={!one} onclick={() => (close(), one && openItem(one))}><Icon name="open" size={16} />{t().common.open}</button>
			{#if one?.type === 'folder' || searching}
				<button class="menu-item" disabled={!one} onclick={() => (close(), one && openFolder(one.type === 'folder' ? one.folder.id : parentOf(map, one.file.folderId)))}><Icon name="folder" size={16} />{one?.type === 'folder' ? t().library.openFolder : t().library.showInFolder}</button>
			{/if}
			<button class="menu-item" disabled={!one} onclick={() => (close(), one && rename(one))}><Icon name="rename" size={16} />{t().common.rename}</button>
			<button class="menu-item" onclick={() => (close(), downloadSel(menuItems))}><Icon name="download" size={16} />{t().library.download}</button>
			<button class="menu-item" onclick={() => (close(), (moving = split(menuItems)))}><Icon name="move" size={16} />{t().library.moveTo}</button>
			<button class="menu-item" disabled={!menuItems.some((i) => i.type === 'file')} onclick={() => (close(), duplicate(menuItems))}><Icon name="copy" size={16} />{t().common.duplicate}</button>
			<div class="my-1 border-t border-line"></div>
			<button class="menu-item text-bad" onclick={() => (close(), trash(menuItems))}><Icon name="trash" size={16} />{t().library.moveToTrash}</button>
		{/if}
	{/snippet}
</ContextMenu>

{#if moving}
	<MoveDialog
		{folders}
		moving={moving.folders}
		current={searching ? undefined : current}
		onclose={() => (moving = null)}
		onpick={(target) => {
			// Read before clearing: `moving` is reactive state.
			const items = moving;
			moving = null;
			if (items) void moveTo(items, target);
		}}
	/>
{/if}

{#if dragging}
	<div class="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-accent/10 backdrop-blur-[1px]">
		<div class="rounded-2xl border-2 border-dashed border-accent bg-surface px-10 py-8 text-lg font-medium text-accent shadow-xl">{t().library.dropHere}</div>
	</div>
{/if}
