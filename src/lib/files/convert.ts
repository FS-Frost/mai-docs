// Heavy converters used when opening files (loaded on demand so the library page stays light).
import { generateJSON, type JSONContent } from '@tiptap/core';
import { schemaExtensions } from '../docs/extensions/index.ts';
import { docxToHtml } from '../docs/io/docx-import.ts';
import { markdownToJSON, textToJSON } from '../docs/io/markdown.ts';
import { putBlob } from '../storage/blobs.ts';

export { csvToSheet } from '../sheets/io/csv.ts';
export { readXlsx } from '../sheets/io/xlsx.ts';
export { readPptx } from '../slides/io/pptx-read.ts';

export async function docFromFile(file: File, ext: string, docId: string): Promise<{ json: JSONContent; lossy: boolean }> {
	if (ext === '.docx') {
		const { html, lossy } = await docxToHtml(await file.arrayBuffer(), (blob) => putBlob(docId, blob));
		return { json: generateJSON(html || '<p></p>', schemaExtensions()), lossy };
	}
	if (ext === '.md' || ext === '.markdown') return { json: markdownToJSON(await file.text()), lossy: false };
	if (ext === '.html' || ext === '.htm') return { json: generateJSON(await file.text(), schemaExtensions()), lossy: false };
	return { json: textToJSON(await file.text()), lossy: false };
}
