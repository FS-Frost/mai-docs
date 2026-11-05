// Document images. Content JSON stores `mai-blob:<id>`; while editing, the editor sees `blob:` URLs.
// hydrate() swaps refs → object URLs before loading into the editor, dehydrate() swaps back before saving.
import { db, uid } from './db.ts';

export const BLOB_PREFIX = 'mai-blob:';

const urlById = new Map<string, string>();
const idByUrl = new Map<string, string>();

export async function putBlob(docId: string, blob: Blob): Promise<string> {
	const id = uid();
	await (await db()).put('blobs', { id, docId, blob, type: blob.type });
	register(id, blob);
	return id;
}

function register(id: string, blob: Blob) {
	if (urlById.has(id)) return urlById.get(id)!;
	const url = URL.createObjectURL(blob);
	urlById.set(id, url);
	idByUrl.set(url, id);
	return url;
}

export async function getBlob(id: string) {
	return (await (await db()).get('blobs', id))?.blob;
}

export async function blobsOf(docId: string) {
	return (await db()).getAllFromIndex('blobs', 'docId', docId);
}

/** Total image bytes of a document. */
export async function blobBytes(docId: string) {
	return (await blobsOf(docId)).reduce((n, b) => n + b.blob.size, 0);
}

/** Object URL for an image id (loads the blob once). */
export async function urlFor(id: string) {
	const hit = urlById.get(id);
	if (hit) return hit;
	const blob = await getBlob(id);
	return blob ? register(id, blob) : undefined;
}

/** Deep-replaces string values in a JSON tree. */
function mapStrings<T>(node: T, fn: (s: string) => string): T {
	if (typeof node === 'string') return fn(node) as T;
	if (Array.isArray(node)) return node.map((x) => mapStrings(x, fn)) as T;
	if (node && typeof node === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(node)) out[k] = mapStrings(v, fn);
		return out as T;
	}
	return node;
}

export async function hydrate<T>(docId: string, json: T): Promise<T> {
	for (const b of await blobsOf(docId)) register(b.id, b.blob);
	return mapStrings(json, (s) => (s.startsWith(BLOB_PREFIX) ? (urlById.get(s.slice(BLOB_PREFIX.length)) ?? s) : s));
}

export function dehydrate<T>(json: T): T {
	return mapStrings(json, (s) => (s.startsWith('blob:') && idByUrl.has(s) ? BLOB_PREFIX + idByUrl.get(s) : s));
}

/** Removes images no longer referenced by the document content. */
export async function pruneBlobs(docId: string, json: unknown) {
	const text = JSON.stringify(json);
	const d = await db();
	for (const b of await blobsOf(docId)) if (!text.includes(BLOB_PREFIX + b.id)) await d.delete('blobs', b.id);
}

/** For exports: blob: or mai-blob: src → Blob. */
export async function resolveSrc(src: string): Promise<Blob | undefined> {
	if (src.startsWith(BLOB_PREFIX)) return getBlob(src.slice(BLOB_PREFIX.length));
	if (src.startsWith('blob:') || src.startsWith('data:')) {
		try {
			return await (await fetch(src)).blob();
		} catch {
			return undefined;
		}
	}
	return undefined;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result));
		r.onerror = () => reject(r.error);
		r.readAsDataURL(blob);
	});
}
