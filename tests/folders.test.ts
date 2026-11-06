// Library folders: pure tree logic + the IndexedDB API (fake-indexeddb) + backup round trip.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'bun:test';
import { unzipSync, strFromU8 } from 'fflate';
import type { FileMeta, Folder } from '../src/lib/storage/db.ts';
import { fileVisible, flatTree, folderMap, folderVisible, isWithin, pathOf, restoreTarget, subtree, trashRoots, wouldCycle } from '../src/lib/storage/tree.ts';
import {
	createFile,
	createFolder,
	deleteFolderForever,
	emptyTrash,
	listFiles,
	listFolders,
	moveItems,
	restoreFile,
	restoreFolder,
	trashFile,
	trashFolder
} from '../src/lib/storage/library.ts';
import { exportLibrary, importLibrary } from '../src/lib/files/backup.ts';
import { db } from '../src/lib/storage/db.ts';

const F = (id: string, parentId?: string, trashedAt?: number): Folder => ({ id, name: id.toUpperCase(), parentId, createdAt: 1, updatedAt: 1, trashedAt });
const M = (id: string, folderId?: string, trashedAt?: number): FileMeta => ({ id, kind: 'doc', title: id, createdAt: 1, updatedAt: 1, size: 1, folderId, trashedAt });

describe('tree (pure)', () => {
	// a ─ b ─ c ; d (trashed) ─ e
	const folders = [F('a'), F('b', 'a'), F('c', 'b'), F('d', undefined, 5), F('e', 'd')];
	const map = folderMap(folders);

	test('paths and containment', () => {
		expect(pathOf(map, 'c').map((f) => f.id)).toEqual(['a', 'b', 'c']);
		expect(isWithin(map, 'c', 'a')).toBe(true);
		expect(isWithin(map, 'a', 'c')).toBe(false);
		expect(pathOf(map, undefined)).toEqual([]);
	});

	test('cycles are rejected; root and siblings are fine', () => {
		expect(wouldCycle(map, 'a', 'c')).toBe(true);
		expect(wouldCycle(map, 'a', 'a')).toBe(true);
		expect(wouldCycle(map, 'c', 'a')).toBe(false);
		expect(wouldCycle(map, 'a', undefined)).toBe(false);
	});

	test('cyclic data does not loop', () => {
		const bad = folderMap([F('x', 'y'), F('y', 'x')]);
		expect(pathOf(bad, 'x').length).toBe(2);
	});

	test('a trashed folder hides its subtree; missing parents count as root', () => {
		expect(folderVisible(map, map.get('e')!)).toBe(false);
		expect(fileVisible(map, M('f1', 'e'))).toBe(false);
		expect(fileVisible(map, M('f2', 'c'))).toBe(true);
		expect(fileVisible(map, M('f3', 'gone'))).toBe(true);
		expect(restoreTarget(map, 'e')).toBeUndefined();
		expect(restoreTarget(map, 'b')).toBe('b');
	});

	test('trash roots skip items inside trashed folders', () => {
		const files = [M('in-d', 'e', 9), M('loose', 'c', 9), M('alive', 'c')];
		const r = trashRoots(folders, files);
		expect(r.folders.map((f) => f.id)).toEqual(['d']);
		expect(r.files.map((f) => f.id)).toEqual(['loose']);
	});

	test('subtree and flat tree', () => {
		const s = subtree(folders, [M('x', 'c'), M('y')], 'a');
		expect(s.folderIds.sort()).toEqual(['a', 'b', 'c']);
		expect(s.fileIds).toEqual(['x']);
		expect(flatTree(folders).map((n) => [n.folder.id, n.depth])).toEqual([
			['a', 0],
			['b', 1],
			['c', 2]
		]);
	});
});

describe('library folders (IndexedDB)', () => {
	beforeEach(async () => {
		const d = await db();
		for (const s of ['files', 'contents', 'blobs', 'handles', 'folders'] as const) await d.clear(s);
	});

	test('move, cycle guard, trash and restore a folder as a unit', async () => {
		const a = await createFolder('A');
		const b = await createFolder('B', a.id);
		const doc = await createFile('doc', 'Doc', { v: 1 }, { folderId: b.id });
		const top = await createFile('doc', 'Top', { v: 1 });

		expect(await moveItems({ files: [], folders: [a.id] }, b.id)).toBe(0);
		expect(await moveItems({ files: [top.id], folders: [] }, a.id)).toBe(1);
		expect((await listFiles()).find((f) => f.id === top.id)?.folderId).toBe(a.id);

		await trashFolder(a.id);
		let folders = await listFolders();
		let files = await listFiles();
		const map = folderMap(folders);
		expect(files.filter((f) => fileVisible(map, f))).toEqual([]);
		expect(trashRoots(folders, files).folders.map((f) => f.id)).toEqual([a.id]);

		await restoreFolder(a.id);
		folders = await listFolders();
		files = await listFiles();
		expect(files.filter((f) => fileVisible(folderMap(folders), f)).map((f) => f.title).sort()).toEqual(['Doc', 'Top']);
		expect(files.find((f) => f.id === doc.id)?.folderId).toBe(b.id);
	});

	test('restoring a file whose folder is gone puts it in the root', async () => {
		const a = await createFolder('A');
		const f = await createFile('doc', 'X', {}, { folderId: a.id });
		await trashFile(f.id);
		await trashFolder(a.id);
		await restoreFile(f.id);
		expect((await listFiles())[0].folderId).toBeUndefined();
	});

	test('delete forever removes the whole subtree; empty trash removes everything trashed', async () => {
		const a = await createFolder('A');
		const b = await createFolder('B', a.id);
		await createFile('doc', 'In B', {}, { folderId: b.id });
		const keep = await createFile('doc', 'Keep', {});
		await deleteFolderForever(a.id);
		expect((await listFolders()).length).toBe(0);
		expect((await listFiles()).map((f) => f.id)).toEqual([keep.id]);

		const c = await createFolder('C');
		await createFile('doc', 'In C', {}, { folderId: c.id });
		await trashFolder(c.id);
		await trashFile(keep.id);
		await emptyTrash();
		expect(await listFolders()).toEqual([]);
		expect(await listFiles()).toEqual([]);
	});

	test('backup keeps the tree (new ids) and v1 backups land in the root', async () => {
		const a = await createFolder('A');
		const b = await createFolder('B', a.id);
		await createFile('doc', 'Deep', { v: 1 }, { folderId: b.id });
		const zip = await exportLibrary();
		const manifest = JSON.parse(strFromU8(unzipSync(new Uint8Array(await zip.arrayBuffer()))['manifest.json']));
		expect(manifest.v).toBe(2);
		expect(manifest.folders.length).toBe(2);

		const d = await db();
		for (const s of ['files', 'contents', 'folders'] as const) await d.clear(s);
		expect(await importLibrary(zip)).toBe(1);
		const folders = await listFolders();
		const [deep] = await listFiles();
		const path = pathOf(folderMap(folders), deep.folderId).map((f) => f.name);
		expect(path).toEqual(['A', 'B']);
		expect(folders.some((f) => f.id === a.id || f.id === b.id)).toBe(false);
	});
});
