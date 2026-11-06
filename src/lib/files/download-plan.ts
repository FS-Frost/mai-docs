// What a library download produces (pure): one file as-is, one folder as "<folder>.zip" with its contents at the
// zip root, or several items as "<zipBase>.zip" (each selected folder becomes a directory). Items in the trash are
// skipped; names repeated in one directory get " (2)", " (3)"…
import type { FileMeta, Folder, Kind } from '../storage/db.ts';
import { fileVisible, folderMap, folderVisible, parentOf } from '../storage/tree.ts';

export const OFFICE_EXT: Record<Kind, string> = { doc: '.docx', sheet: '.xlsx', slides: '.pptx' };

export type DownloadPlan =
	| { type: 'file'; id: string; name: string }
	| { type: 'zip'; name: string; files: { id: string; path: string }[]; dirs: string[] };

/** Safe file/directory name from a title (no path separators or reserved characters). */
export function safeName(title: string) {
	return title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 120) || 'untitled';
}

/** Returns `name` + `ext`, or "name (2)" + ext… when already used in this directory (case-insensitive). */
function unique(used: Set<string>, name: string, ext = '') {
	let candidate = `${name}${ext}`;
	for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})${ext}`;
	used.add(candidate.toLowerCase());
	return candidate;
}

export function planDownload(sel: { files: string[]; folders: string[] }, all: { folders: Folder[]; files: FileMeta[] }, zipBase: string): DownloadPlan | null {
	const map = folderMap(all.folders);
	const byId = new Map(all.files.map((f) => [f.id, f]));
	const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	const selFiles = sel.files.map((id) => byId.get(id)).filter((f): f is FileMeta => !!f && fileVisible(map, f));
	const selFolders = sel.folders.map((id) => map.get(id)).filter((f): f is Folder => !!f && folderVisible(map, f));

	if (selFiles.length === 1 && !selFolders.length) {
		const f = selFiles[0];
		return { type: 'file', id: f.id, name: safeName(f.title) + OFFICE_EXT[f.kind] };
	}
	if (!selFiles.length && !selFolders.length) return null;

	const files: { id: string; path: string }[] = [];
	const dirs: string[] = [];
	const used = new Map<string, Set<string>>();
	const usedIn = (dir: string) => used.get(dir) ?? (used.set(dir, new Set()), used.get(dir)!);

	/** Adds the visible contents of folder `id` under `dir` ('' = zip root). */
	function addContents(id: string, dir: string) {
		const kids = all.folders.filter((f) => !f.trashedAt && parentOf(map, f.parentId) === id).sort((a, b) => coll.compare(a.name, b.name));
		for (const k of kids) addFolder(k, dir);
		const fl = all.files.filter((f) => !f.trashedAt && parentOf(map, f.folderId) === id).sort((a, b) => coll.compare(a.title, b.title));
		for (const f of fl) files.push({ id: f.id, path: dir + unique(usedIn(dir), safeName(f.title), OFFICE_EXT[f.kind]) });
	}
	function addFolder(f: Folder, dir: string) {
		const path = `${dir}${unique(usedIn(dir), safeName(f.name))}/`;
		dirs.push(path);
		addContents(f.id, path);
	}

	if (selFolders.length === 1 && !selFiles.length) {
		const f = selFolders[0];
		addContents(f.id, '');
		return { type: 'zip', name: `${safeName(f.name)}.zip`, files, dirs };
	}
	for (const f of [...selFolders].sort((a, b) => coll.compare(a.name, b.name))) addFolder(f, '');
	for (const f of [...selFiles].sort((a, b) => coll.compare(a.title, b.title))) files.push({ id: f.id, path: unique(usedIn(''), safeName(f.title), OFFICE_EXT[f.kind]) });
	return { type: 'zip', name: `${safeName(zipBase)}.zip`, files, dirs };
}
