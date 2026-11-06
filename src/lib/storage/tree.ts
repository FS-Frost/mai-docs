// Folder tree logic (pure, no IndexedDB): paths, cycles, what is visible, what is in the trash.
// A trashed folder hides its whole subtree; items inside it are not marked one by one.
import type { FileMeta, Folder } from './db.ts';

export type FolderMap = Map<string, Folder>;

export const folderMap = (folders: Folder[]): FolderMap => new Map(folders.map((f) => [f.id, f]));

/** Folders from the root down to `id` (inclusive). Stops on missing parents and on cycles. */
export function pathOf(map: FolderMap, id: string | undefined): Folder[] {
	const out: Folder[] = [];
	const seen = new Set<string>();
	let cur = id ? map.get(id) : undefined;
	while (cur && !seen.has(cur.id)) {
		seen.add(cur.id);
		out.unshift(cur);
		cur = cur.parentId ? map.get(cur.parentId) : undefined;
	}
	return out;
}

/** True when `id` is `ancestor` or lies below it. */
export function isWithin(map: FolderMap, id: string | undefined, ancestor: string): boolean {
	return pathOf(map, id).some((f) => f.id === ancestor);
}

/** A folder (or the folder of a file) counts as gone when it is missing or it or an ancestor is in the trash. */
export function folderGone(map: FolderMap, id: string | undefined): boolean {
	if (!id) return false;
	const p = pathOf(map, id);
	return !p.length || p.some((f) => f.trashedAt);
}

/** Effective parent: a missing parent (broken data) counts as the root, so nothing becomes unreachable. */
export const parentOf = (map: FolderMap, parentId: string | undefined) => (parentId && map.has(parentId) ? parentId : undefined);

export const fileVisible = (map: FolderMap, f: FileMeta) => !f.trashedAt && !folderGone(map, parentOf(map, f.folderId));
export const folderVisible = (map: FolderMap, f: Folder) => !folderGone(map, f.id);

/** Where a file or folder lands when restored: its parent if still there, else the root. */
export const restoreTarget = (map: FolderMap, parentId: string | undefined) => (parentId && !folderGone(map, parentId) ? parentId : undefined);

/** Moving folder `id` into `target` (undefined = root) would create a cycle. */
export const wouldCycle = (map: FolderMap, id: string, target: string | undefined) => !!target && isWithin(map, target, id);

/** Entries of the trash view: trashed items whose container is still alive (not inside another trashed folder). */
export function trashRoots(folders: Folder[], files: FileMeta[]) {
	const map = folderMap(folders);
	const aliveParent = (p: string | undefined) => !folderGone(map, parentOf(map, p));
	return {
		folders: folders.filter((f) => f.trashedAt && aliveParent(f.parentId)),
		files: files.filter((f) => f.trashedAt && aliveParent(f.folderId))
	};
}

/** Every folder id and file id under `id` (the folder itself included). */
export function subtree(folders: Folder[], files: FileMeta[], id: string) {
	const map = folderMap(folders);
	const folderIds = folders.filter((f) => isWithin(map, f.id, id)).map((f) => f.id);
	const set = new Set(folderIds);
	return { folderIds, fileIds: files.filter((f) => f.folderId && set.has(f.folderId)).map((f) => f.id) };
}

/** Folders ordered parents first (for imports that recreate a tree). */
export function parentsFirst(folders: Folder[]): Folder[] {
	const map = folderMap(folders);
	return [...folders].sort((a, b) => pathOf(map, a.id).length - pathOf(map, b.id).length);
}

/** Depth-first list of the live tree, for the "Move to…" dialog. */
export function flatTree(folders: Folder[]): { folder: Folder; depth: number }[] {
	const map = folderMap(folders);
	const live = folders.filter((f) => folderVisible(map, f));
	const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	const kids = (p: string | undefined) => live.filter((f) => parentOf(map, f.parentId) === p).sort((a, b) => coll.compare(a.name, b.name));
	const out: { folder: Folder; depth: number }[] = [];
	const walk = (p: string | undefined, depth: number) => {
		for (const f of kids(p)) {
			out.push({ folder: f, depth });
			walk(f.id, depth + 1);
		}
	};
	walk(undefined, 0);
	return out;
}
