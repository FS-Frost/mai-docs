// Whole-library backup as .zip: manifest.json + contents/<id>.json + blobs/<blobId>. Import always creates new ids.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { BLOB_PREFIX } from '../storage/blobs.ts';
import { db, uid, type FileMeta } from '../storage/db.ts';
import { createFile } from '../storage/library.ts';

const FORMAT = 'mai-docs-backup';

type Manifest = { format: typeof FORMAT; v: 1; exportedAt: number; files: FileMeta[]; blobs: { id: string; docId: string; type: string }[] };

export async function exportLibrary(): Promise<Blob> {
	const d = await db();
	const files = (await d.getAll('files')).filter((f) => !f.trashedAt);
	const entries: Record<string, Uint8Array> = {};
	const blobs: Manifest['blobs'] = [];
	for (const f of files) {
		entries[`contents/${f.id}.json`] = strToU8(JSON.stringify(await d.get('contents', f.id)));
		for (const b of await d.getAllFromIndex('blobs', 'docId', f.id)) {
			entries[`blobs/${b.id}`] = new Uint8Array(await b.blob.arrayBuffer());
			blobs.push({ id: b.id, docId: b.docId, type: b.type });
		}
	}
	const manifest: Manifest = { format: FORMAT, v: 1, exportedAt: Date.now(), files, blobs };
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
			json = json.split(BLOB_PREFIX + b.id).join(BLOB_PREFIX + nb);
		}
		await createFile(f.kind, f.title, JSON.parse(json), { createdAt: f.createdAt, updatedAt: f.updatedAt, size: f.size }, newId);
		n++;
	}
	return n;
}
