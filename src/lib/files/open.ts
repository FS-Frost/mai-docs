// Open files from disk into the library (picker, drag & drop, OS file handlers).
import { newDocContent } from '../docs/model.ts';
import { i18n, t } from '../i18n/index.svelte.ts';
import type { LostKind } from '../sheets/io/xlsx.ts';
import { toContent, type Workbook } from '../sheets/model.ts';
import { uid } from '../storage/db.ts';
import { putBlob } from '../storage/blobs.ts';
import { setHandle } from '../storage/handles.ts';
import { createFile, type FileMeta } from '../storage/library.ts';

export const ACCEPT = {
	doc: ['.docx', '.md', '.markdown', '.txt', '.html', '.htm'],
	sheet: ['.xlsx', '.csv', '.tsv'],
	slides: ['.pptx']
};
export const ACCEPT_ALL = [...ACCEPT.doc, ...ACCEPT.sheet, ...ACCEPT.slides];

const ext = (name: string) => (/\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? '');
const stem = (name: string) => name.replace(/\.[^.]+$/, '') || name;

export const isSupported = (name: string) => ACCEPT_ALL.includes(ext(name));

export type OpenResult = { meta: FileMeta; warnings: string[] };

export async function importFile(file: File, handle?: FileSystemFileHandle): Promise<OpenResult> {
	const e = ext(file.name);
	const title = stem(file.name);
	const origin = { name: file.name, type: file.type };
	const warnings: string[] = [];
	const locale = i18n.locale;
	let meta: FileMeta;
	if (!ACCEPT_ALL.includes(e)) throw new Error(t().library.unsupported(file.name));
	const { csvToSheet, docFromFile, readXlsx, readPptx } = await import('./convert.ts');
	if (ACCEPT.doc.includes(e)) {
		const id = uid();
		const { json, lossy } = await docFromFile(file, e, id);
		if (lossy) warnings.push(t().doc.importLossy);
		meta = await createFile('doc', title, newDocContent(locale, json), { origin }, id);
		// Only .docx can be written back as-is (others would lose formatting on Ctrl+S).
		if (handle && e === '.docx') await setHandle(meta.id, handle);
	} else if (ACCEPT.sheet.includes(e)) {
		let content;
		const id = uid();
		if (e === '.xlsx') {
			const res = await readXlsx(await file.arrayBuffer(), t().sheet.sheetName, (blob) => putBlob(id, blob));
			content = res.content;
			if (res.lost.length) warnings.push(t().sheet.importLossy(res.lost.map((l) => lostLabel(l)).join(', ')));
			if (res.chartsSimplified) warnings.push(t().chart.simplified);
		} else {
			const wb: Workbook = { sheets: [], active: '', styles: [{}] };
			const s = csvToSheet(wb, await file.text(), title.slice(0, 31) || t().sheet.sheetName(1), locale);
			wb.sheets.push(s);
			wb.active = s.id;
			content = toContent(wb);
		}
		meta = await createFile('sheet', title, content, { origin }, id);
		if (handle && e === '.xlsx') await setHandle(meta.id, handle);
	} else if (ACCEPT.slides.includes(e)) {
		const id = uid();
		const res = await readPptx(new Uint8Array(await file.arrayBuffer()), {
			putBlob: (data, mime) => putBlob(id, new Blob([data as BlobPart], { type: mime })),
			fontAvailable
		});
		if (res.lossy) warnings.push(t().slides.importLossy);
		if (res.fontsReplaced.length) warnings.push(t().slides.fontsReplaced(res.fontsReplaced.join(', ')));
		if (res.animsApprox) warnings.push(t().slides.importedAnims);
		meta = await createFile('slides', title, res.content, { origin }, id);
		if (handle) await setHandle(meta.id, handle);
	} else throw new Error(t().library.unsupported(file.name));
	return { meta, warnings };
}

function lostLabel(l: LostKind) {
	const s = t().sheet;
	return { images: s.lostImages, charts: s.lostCharts, validations: s.lostValidations, conditional: s.lostConditional }[l];
}

const fontCache = new Map<string, boolean>();
/** Installed-font check: text width with the family differs from every generic fallback. */
export function fontAvailable(family: string): boolean {
	if (/^(serif|sans-serif|monospace)$/.test(family)) return true;
	const hit = fontCache.get(family);
	if (hit !== undefined) return hit;
	const ctx = document.createElement('canvas').getContext('2d');
	if (!ctx) return true;
	const sample = 'mmmmmmmmmmlli WQ@#0123456789';
	let ok = false;
	for (const generic of ['monospace', 'serif', 'sans-serif']) {
		ctx.font = `72px ${generic}`;
		const a = ctx.measureText(sample).width;
		ctx.font = `72px "${family.replace(/"/g, '')}", ${generic}`;
		if (ctx.measureText(sample).width !== a) {
			ok = true;
			break;
		}
	}
	fontCache.set(family, ok);
	return ok;
}

/** Shows the open picker. Returns files with their handles when available. */
export async function pickFiles(): Promise<{ file: File; handle?: FileSystemFileHandle }[]> {
	if (typeof window.showOpenFilePicker === 'function') {
		try {
			const handles = await window.showOpenFilePicker({
				multiple: true,
				types: [
					{ description: t().kind.doc, accept: { 'application/octet-stream': ACCEPT.doc } },
					{ description: t().kind.sheet, accept: { 'application/octet-stream': ACCEPT.sheet } },
					{ description: t().kind.slides, accept: { 'application/octet-stream': ACCEPT.slides } }
				]
			});
			return Promise.all(handles.map(async (h) => ({ file: await h.getFile(), handle: h })));
		} catch (e) {
			if ((e as DOMException)?.name === 'AbortError') return [];
		}
	}
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;
		input.accept = ACCEPT_ALL.join(',');
		input.onchange = () => resolve([...(input.files ?? [])].map((file) => ({ file })));
		input.oncancel = () => resolve([]);
		input.click();
	});
}
