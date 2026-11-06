// IndexedDB "mai-docs": the local library. One record per file in `files` (metadata) and `contents` (JSON),
// document images in `blobs`, File System Access handles in `handles` (Chromium only), library folders in `folders` (v2).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type Kind = 'doc' | 'sheet' | 'slides';

export type FileMeta = {
	id: string;
	kind: Kind;
	title: string;
	createdAt: number;
	updatedAt: number;
	/** Approximate size in bytes (JSON content + images). */
	size: number;
	trashedAt?: number;
	/** Where it came from, when opened from disk. */
	origin?: { name: string; type: string };
	/** Containing folder; absent = library root. */
	folderId?: string;
};

export type Folder = { id: string; name: string; parentId?: string; createdAt: number; updatedAt: number; trashedAt?: number };

export type BlobRecord = { id: string; docId: string; blob: Blob; type: string };
export type HandleRecord = { id: string; handle: FileSystemFileHandle; name: string };

interface Schema extends DBSchema {
	files: { key: string; value: FileMeta; indexes: { updatedAt: number } };
	contents: { key: string; value: unknown };
	blobs: { key: string; value: BlobRecord; indexes: { docId: string } };
	handles: { key: string; value: HandleRecord };
	folders: { key: string; value: Folder };
}

export type DB = IDBPDatabase<Schema>;

let dbp: Promise<DB> | undefined;

export function db(): Promise<DB> {
	return (dbp ??= openDB<Schema>('mai-docs', 2, {
		upgrade(d, old) {
			// Additive versions: v1 = files/contents/blobs/handles, v2 = folders.
			if (old < 2) d.createObjectStore('folders', { keyPath: 'id' });
			if (old >= 1) return;
			const files = d.createObjectStore('files', { keyPath: 'id' });
			files.createIndex('updatedAt', 'updatedAt');
			d.createObjectStore('contents');
			const blobs = d.createObjectStore('blobs', { keyPath: 'id' });
			blobs.createIndex('docId', 'docId');
			d.createObjectStore('handles', { keyPath: 'id' });
		},
		blocking() {
			// A newer version was opened in another tab: let it upgrade.
			void dbp?.then((x) => x.close());
			dbp = undefined;
		}
	}));
}

export const uid = () => crypto.randomUUID();
