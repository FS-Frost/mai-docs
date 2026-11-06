// Office export of a stored library file (no editor open): document → .docx, spreadsheet → .xlsx,
// presentation → .pptx. Same writers as the editors' Export; heavy libraries load on demand.
// Also the shared blob loaders the editors pass to those writers.
import type { DocContent } from '../docs/model.ts';
import type { WorkbookContent } from '../sheets/model.ts';
import type { IconEl, SlidesContent } from '../slides/model.ts';
import { i18n } from '../i18n/index.svelte.ts';
import { getBlob } from '../storage/blobs.ts';
import type { FileMeta } from '../storage/db.ts';
import { getContent } from '../storage/library.ts';
import { officeImage } from './images.ts';

export const OFFICE_MIME = {
	doc: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	sheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	slides: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
} as const;

/** Stored image blob → { data, extension } for the xlsx/pptx writers. */
export async function loadOfficeImage(blobId: string) {
	const b = await getBlob(blobId);
	return b ? officeImage(b) : null;
}

/** Stored blob bytes (media, embedded files). */
export async function loadBlobBytes(blobId: string) {
	const b = await getBlob(blobId);
	return b ? new Uint8Array(await b.arrayBuffer()) : null;
}

/** Icon PNG for the .pptx (PowerPoint before 2016 ignores the SVG), drawn at 2× the box. */
export function renderIconPng(el: IconEl, svg: string) {
	return new Promise<Uint8Array | null>((resolve) => {
		const img = new Image();
		img.onload = () => {
			const c = document.createElement('canvas');
			c.width = Math.max(1, Math.round(el.w * 2));
			c.height = Math.max(1, Math.round(el.h * 2));
			c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
			c.toBlob(async (b) => resolve(b ? new Uint8Array(await b.arrayBuffer()) : null), 'image/png');
		};
		img.onerror = () => resolve(null);
		img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	});
}

/** Office bytes of a stored file. Throws when its content is missing. */
export async function exportOffice(meta: FileMeta): Promise<Uint8Array> {
	const content = await getContent<unknown>(meta.id);
	if (content === undefined) throw new Error('not found');
	if (meta.kind === 'doc') {
		const c = content as DocContent;
		const [{ buildDocx, docxBytes }, { loadDocxImage }, { chartImage }] = await Promise.all([import('../docs/io/docx-export.ts'), import('../docs/io/images.ts'), import('../docs/io/export.ts')]);
		return new Uint8Array(await docxBytes(await buildDocx(c.doc, c.page, loadDocxImage, meta.title, chartImage)));
	}
	if (meta.kind === 'sheet') {
		const [{ Book }, { writeXlsx }] = await Promise.all([import('../sheets/book.svelte.ts'), import('../sheets/io/xlsx.ts')]);
		const book = new Book(content as WorkbookContent);
		book.engine.recalcVolatile();
		return writeXlsx(book.wb, loadOfficeImage, (s, r, c) => book.text(s, r, c));
	}
	const { writePptx } = await import('../slides/io/pptx-write.ts');
	return writePptx(content as SlidesContent, loadOfficeImage, { title: meta.title, lang: i18n.locale, loadBlob: loadBlobBytes, renderIcon: renderIconPng });
}
