// Whole-library backup as .zip: manifest.json + contents/<id>.json + blobs/<blobId>. Import always creates new ids.
// v2 adds the folder tree (manifest.folders + FileMeta.folderId); v1 backups import into the root.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { BLOB_PREFIX } from '../storage/blobs.ts';
import { db, uid, type FileMeta, type Folder } from '../storage/db.ts';
import { createFile, notifyLibrary } from '../storage/library.ts';
import { fileVisible, folderMap, folderVisible, parentOf, parentsFirst } from '../storage/tree.ts';

const FORMAT = 'mai-docs-backup';

type Manifest = { format: typeof FORMAT; v: 1 | 2; exportedAt: number; files: FileMeta[]; folders?: Folder[]; blobs: { id: string; docId: string; type: string }[] };

export async function exportLibrary(): Promise<Blob> {
	const d = await db();
	const allFolders = await d.getAll('folders');
	const map = folderMap(allFolders);
	const folders = allFolders.filter((f) => folderVisible(map, f));
	const files = (await d.getAll('files')).filter((f) => fileVisible(map, f)).map((f) => ({ ...f, folderId: parentOf(map, f.folderId) }));
	const entries: Record<string, Uint8Array> = {};
	const blobs: Manifest['blobs'] = [];
	for (const f of files) {
		entries[`contents/${f.id}.json`] = strToU8(JSON.stringify(await d.get('contents', f.id)));
		for (const b of await d.getAllFromIndex('blobs', 'docId', f.id)) {
			entries[`blobs/${b.id}`] = new Uint8Array(await b.blob.arrayBuffer());
			blobs.push({ id: b.id, docId: b.docId, type: b.type });
		}
	}
	const manifest: Manifest = { format: FORMAT, v: 2, exportedAt: Date.now(), files, folders, blobs };
	entries['manifest.json'] = strToU8(JSON.stringify(manifest));
	return new Blob([zipSync(entries, { level: 6 }) as BlobPart], { type: 'application/zip' });
}

/** Returns the number of imported files; throws if the zip is not a backup. */
export async function importLibrary(file: Blob): Promise<number> {
	const z = unzipSync(new Uint8Array(await file.arrayBuffer()));
	const raw = z['manifest.json'];
	if (!raw) throw new Error('invalid');
	const m = JSON.parse(strFromU8(raw)) as Manifest;
	if (m.format !== FORMAT) throw new Error('invalid');
	const d = await db();
	// Folders first, parents before children, with new ids.
	const ids = new Map<string, string>();
	for (const f of parentsFirst(m.folders ?? [])) {
		const id = uid();
		ids.set(f.id, id);
		await d.put('folders', { id, name: f.name, parentId: f.parentId ? ids.get(f.parentId) : undefined, createdAt: f.createdAt, updatedAt: f.updatedAt });
	}
	if (ids.size) notifyLibrary();
	let n = 0;
	for (const f of m.files) {
		const data = z[`contents/${f.id}.json`];
		if (!data) continue;
		const newId = uid();
		let json = strFromU8(data);
		for (const b of m.blobs.filter((x) => x.docId === f.id)) {
			const bytes = z[`blobs/${b.id}`];
			if (!bytes) continue;
			const nb = uid();
			await d.put('blobs', { id: nb, docId: newId, blob: new Blob([bytes as BlobPart], { type: b.type }), type: b.type });
			json = json.split(b.id).join(nb);
		}
		await createFile(f.kind, f.title, JSON.parse(json), { createdAt: f.createdAt, updatedAt: f.updatedAt, size: f.size, folderId: f.folderId ? ids.get(f.folderId) : undefined }, newId);
		n++;
	}
	return n;
}
