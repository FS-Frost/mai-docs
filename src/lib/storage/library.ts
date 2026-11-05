// Library CRUD. Every change is announced on BroadcastChannel('mai-library') so other tabs refresh.
import { db, uid, type FileMeta, type Kind } from './db.ts';

export type { FileMeta, Kind };

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('mai-library');

export type LibraryEvent = { type: 'changed'; id?: string; by?: string };
/** Identifies this tab in library events (to ignore our own content saves). */
export const TAB_ID = uid();

function notify(id?: string) {
	channel?.postMessage({ type: 'changed', id, by: TAB_ID } satisfies LibraryEvent);
}

export function onLibraryChange(cb: (e: LibraryEvent) => void) {
	const h = (m: MessageEvent<LibraryEvent>) => cb(m.data);
	channel?.addEventListener('message', h);
	return () => channel?.removeEventListener('message', h);
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
export const restoreFile = (id: string) => updateMeta(id, { trashedAt: undefined });

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
	return createFile(meta.kind, title, copy, { size: meta.size, origin: undefined }, newId);
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
	const files = await listFiles();
	for (const f of files.filter((x) => x.trashedAt)) await deleteForever(f.id);
}
