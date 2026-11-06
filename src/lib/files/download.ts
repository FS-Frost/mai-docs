// Library downloads (browser): plan (download-plan.ts) → export each file to Office → single file or .zip.
// A file that fails is left out and reported; the rest still downloads.
import { zipSync, type Zippable } from 'fflate';
import { listFiles, listFolders } from '../storage/library.ts';
import { planDownload } from './download-plan.ts';
import { exportOffice, OFFICE_MIME } from './office.ts';
import { download } from './save.ts';

export type DownloadResult = { name: string; failed: string[] } | null;

export async function downloadItems(sel: { files: string[]; folders: string[] }, zipBase: string): Promise<DownloadResult> {
	const [folders, files] = await Promise.all([listFolders(), listFiles()]);
	const plan = planDownload(sel, { folders, files }, zipBase);
	if (!plan) return null;
	const byId = new Map(files.map((f) => [f.id, f]));
	if (plan.type === 'file') {
		const meta = byId.get(plan.id)!;
		const bytes = await exportOffice(meta);
		download(new Blob([bytes as BlobPart], { type: OFFICE_MIME[meta.kind] }), plan.name);
		return { name: plan.name, failed: [] };
	}
	const entries: Zippable = {};
	// fflate: an empty object is a directory; the key goes without the trailing slash (it adds one).
	for (const d of plan.dirs) entries[d.slice(0, -1)] = {};
	const failed: string[] = [];
	for (const f of plan.files) {
		try {
			// Office files are already deflated: store them as-is.
			entries[f.path] = [await exportOffice(byId.get(f.id)!), { level: 0 }];
		} catch (e) {
			console.error(e);
			failed.push(f.path);
		}
	}
	download(new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' }), plan.name);
	return { name: plan.name, failed };
}
