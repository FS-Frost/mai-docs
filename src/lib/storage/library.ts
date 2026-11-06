// Library CRUD. Every change is announced on BroadcastChannel('mai-library') so other tabs refresh.
import { db, uid, type FileMeta, type Folder, type Kind } from './db.ts';
import { folderMap, restoreTarget, subtree, trashRoots, wouldCycle } from './tree.ts';

export type { FileMeta, Folder, Kind };

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('mai-library');

export type LibraryEvent = { type: 'changed'; id?: string; by?: string };
/** Identifies this tab in library events (to ignore our own content saves). */
export const TAB_ID = uid();

// BroadcastChannel never delivers to its own sender: listeners in this tab are called directly.
const local = new Set<(e: LibraryEvent) => void>();

function notify(id?: string) {
	const e: LibraryEvent = { type: 'changed', id, by: TAB_ID };
	channel?.postMessage(e);
	for (const cb of local) cb(e);
}
export const notifyLibrary = notify;

export function onLibraryChange(cb: (e: LibraryEvent) => void) {
	const h = (m: MessageEvent<LibraryEvent>) => cb(m.data);
	channel?.addEventListener('message', h);
	local.add(cb);
	return () => {
		channel?.removeEventListener('message', h);
		local.delete(cb);
	};
}

const sizeOf = (content: unknown) => {
	try {
		return JSON.stringify(content).length;
	} catch {
		return 0;
	}
};

let persistAsked = false;
async function askPersist() {
	if (persistAsked) return;
	persistAsked = true;
	try {
		if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist?.();
	} catch {
		/* not supported */
	}
}

export async function listFiles(): Promise<FileMeta[]> {
	const d = await db();
	return (await d.getAll('files')).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMeta(id: string) {
	return (await db()).get('files', id);
}

export async function getContent<T>(id: string): Promise<T | undefined> {
	return (await (await db()).get('contents', id)) as T | undefined;
}

export async function createFile(kind: Kind, title: string, content: unknown, extra: Partial<FileMeta> = {}, id = uid()): Promise<FileMeta> {
	const now = Date.now();
	const meta: FileMeta = { id, kind, title, createdAt: now, updatedAt: now, size: sizeOf(content), ...extra };
	const d = await db();
	const tx = d.transaction(['files', 'contents'], 'readwrite');
	await Promise.all([tx.objectStore('files').put(meta), tx.objectStore('contents').put(content, id), tx.done]);
	notify(id);
	void askPersist();
	return meta;
}

/**
 * Saves content and bumps updatedAt. `extraSize` = bytes of images (docs).
 * The content put is issued synchronously inside the transaction (before any await on reads): during page
 * unload continuations after an await may never run, but already-issued requests still commit.
 */
export async function saveContent(id: string, content: unknown, extraSize = 0) {
	const d = await db();
	const tx = d.transaction(['files', 'contents'], 'readwrite');
	const put = tx.objectStore('contents').put(content, id);
	const files = tx.objectStore('files');
	const meta = await files.get(id);
	if (!meta) {
		tx.abort();
		throw new Error('not found');
	}
	meta.updatedAt = Date.now();
	meta.size = sizeOf(content) + extraSize;
	await Promise.all([files.put(meta), put, tx.done]);
	notify(id);
	void askPersist();
	return meta;
}

export async function updateMeta(id: string, patch: Partial<Omit<FileMeta, 'id' | 'kind'>>) {
	const d = await db();
	const meta = await d.get('files', id);
	if (!meta) return;
	const next = { ...meta, ...patch };
	await d.put('files', next);
	notify(id);
	return next;
}

export const renameFile = (id: string, title: string) => updateMeta(id, { title, updatedAt: Date.now() });
export const trashFile = (id: string) => updateMeta(id, { trashedAt: Date.now() });
export async function restoreFile(id: string) {
	const meta = await getMeta(id);
	if (!meta) return;
	const map = folderMap(await listFolders());
	return updateMeta(id, { trashedAt: undefined, folderId: restoreTarget(map, meta.folderId) });
}

export async function duplicateFile(id: string, title: string) {
	const d = await db();
	const meta = await d.get('files', id);
	const content = await d.get('contents', id);
	if (!meta || content === undefined) return;
	const newId = uid();
	let copy = content;
	{
		// Images belong to a file (doc or sheet): copy them with new ids and rewrite the references (ids are UUIDs).
		const blobs = await d.getAllFromIndex('blobs', 'docId', id);
		let json = JSON.stringify(content);
		for (const b of blobs) {
			const nb = uid();
			await d.put('blobs', { ...b, id: nb, docId: newId });
			json = json.split(b.id).join(nb);
		}
		copy = JSON.parse(json);
	}
	return createFile(meta.kind, title, copy, { size: meta.size, origin: undefined, folderId: meta.folderId }, newId);
}

export async function deleteForever(id: string) {
	const d = await db();
	const tx = d.transaction(['files', 'contents', 'blobs', 'handles'], 'readwrite');
	const blobKeys = await tx.objectStore('blobs').index('docId').getAllKeys(id);
	await Promise.all([
		tx.objectStore('files').delete(id),
		tx.objectStore('contents').delete(id),
		tx.objectStore('handles').delete(id),
		...blobKeys.map((k) => tx.objectStore('blobs').delete(k)),
		tx.done
	]);
	notify(id);
}

export async function emptyTrash() {
	const [folders, files] = await Promise.all([listFolders(), listFiles()]);
	const roots = trashRoots(folders, files);
	for (const f of roots.folders) await deleteFolderForever(f.id);
	for (const f of roots.files) await deleteForever(f.id);
	// Trashed items left inside trashed folders were removed with them; stragglers (broken data) go too.
	for (const f of (await listFiles()).filter((x) => x.trashedAt)) await deleteForever(f.id);
	for (const f of (await listFolders()).filter((x) => x.trashedAt)) await deleteFolderForever(f.id);
}

// ---------- Folders ----------

export async function listFolders(): Promise<Folder[]> {
	return (await db()).getAll('folders');
}

export async function createFolder(name: string, parentId?: string): Promise<Folder> {
	const now = Date.now();
	const f: Folder = { id: uid(), name, parentId, createdAt: now, updatedAt: now };
	await (await db()).put('folders', f);
	notify(f.id);
	return f;
}

async function patchFolder(id: string, patch: Partial<Omit<Folder, 'id'>>) {
	const d = await db();
	const f = await d.get('folders', id);
	if (!f) return;
	const next = { ...f, ...patch };
	await d.put('folders', next);
	notify(id);
	return next;
}

export const renameFolder = (id: string, name: string) => patchFolder(id, { name, updatedAt: Date.now() });
export const trashFolder = (id: string) => patchFolder(id, { trashedAt: Date.now() });

export async function restoreFolder(id: string) {
	const folders = await listFolders();
	const f = folders.find((x) => x.id === id);
	if (!f) return;
	return patchFolder(id, { trashedAt: undefined, parentId: restoreTarget(folderMap(folders), f.parentId) });
}

/** Moves files and folders into `target` (undefined = root). Folders that would end inside themselves are skipped. Returns how many moved. */
export async function moveItems(items: { files: string[]; folders: string[] }, target: string | undefined): Promise<number> {
	const d = await db();
	const map = folderMap(await d.getAll('folders'));
	if (target && !map.has(target)) return 0;
	const tx = d.transaction(['files', 'folders'], 'readwrite');
	let n = 0;
	const now = Date.now();
	for (const id of items.folders) {
		const f = map.get(id);
		if (!f || wouldCycle(map, id, target) || f.parentId === target) continue;
		await tx.objectStore('folders').put({ ...f, parentId: target, updatedAt: now });
		n++;
	}
	for (const id of items.files) {
		const m = await tx.objectStore('files').get(id);
		if (!m || m.folderId === target) continue;
		await tx.objectStore('files').put({ ...m, folderId: target });
		n++;
	}
	await tx.done;
	if (n) notify();
	return n;
}

/** Deletes a folder, every subfolder and every file inside (contents, images, handles). */
export async function deleteFolderForever(id: string) {
	const [folders, files] = await Promise.all([listFolders(), listFiles()]);
	const { folderIds, fileIds } = subtree(folders, files, id);
	for (const f of fileIds) await deleteForever(f);
	const d = await db();
	const tx = d.transaction('folders', 'readwrite');
	await Promise.all([...folderIds.map((f) => tx.store.delete(f)), tx.done]);
	notify(id);
}
