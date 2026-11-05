// Save bytes to disk: write back to a remembered handle (Chromium), Save As picker, or download fallback.
import { canWrite } from '../storage/handles.ts';

export type SaveTarget = { name: string; mime: string; ext: string; description: string };

export function download(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function writeHandle(handle: FileSystemFileHandle, blob: Blob) {
	if (!(await canWrite(handle))) throw new Error('permission');
	const w = await handle.createWritable();
	await w.write(blob);
	await w.close();
}

export const canPickSave = () => typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

/**
 * Save As. Returns the handle when the picker was used (to remember for Ctrl+S), 'downloaded' for the
 * fallback, or null when the user cancelled.
 */
export async function saveAs(blob: Blob, target: SaveTarget): Promise<FileSystemFileHandle | 'downloaded' | null> {
	if (canPickSave()) {
		try {
			const handle = await window.showSaveFilePicker!({
				suggestedName: target.name,
				types: [{ description: target.description, accept: { [target.mime]: [target.ext] } }]
			});
			await writeHandle(handle, blob);
			return handle;
		} catch (e) {
			if ((e as DOMException)?.name === 'AbortError') return null;
			// Picker unavailable in this context (iframe, permissions): fall back to download.
		}
	}
	download(blob, target.name);
	return 'downloaded';
}

/** Safe file name from a title. */
export function fileName(title: string, ext: string) {
	const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 120) || 'untitled';
	return `${base}${ext}`;
}
