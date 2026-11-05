// Browser exports from a live editor: docx, md, html, txt.
import type { Editor } from '@tiptap/core';
import { blobToDataUrl, dehydrate, resolveSrc } from '../../storage/blobs.ts';
import { pageDims, type PageSetup } from '../model.ts';
import { buildDocx, docxBytes } from './docx-export.ts';
import { loadDocxImage } from './images.ts';

export type DocFormat = 'docx' | 'md' | 'html' | 'txt';

export const FORMATS: Record<DocFormat, { ext: string; mime: string }> = {
	docx: { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
	md: { ext: '.md', mime: 'text/markdown' },
	html: { ext: '.html', mime: 'text/html' },
	txt: { ext: '.txt', mime: 'text/plain' }
};

/** Replaces blob:/mai-blob: image URLs in text with data: URLs (self-contained exports). */
async function inlineImages(text: string): Promise<string> {
	const urls = [...new Set(text.match(/(?:blob:[^"')\s]+|mai-blob:[\w-]+)/g) ?? [])];
	for (const u of urls) {
		const blob = await resolveSrc(u);
		if (blob) text = text.split(u).join(await blobToDataUrl(blob));
	}
	return text;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function exportDoc(editor: Editor, format: DocFormat, page: PageSetup, title: string): Promise<Blob> {
	const { mime } = FORMATS[format];
	switch (format) {
		case 'docx': {
			const doc = await buildDocx(dehydrate(editor.getJSON()), page, loadDocxImage, title);
			return new Blob([await docxBytes(doc)], { type: mime });
		}
		case 'md': {
			const md = (editor as unknown as { getMarkdown(): string }).getMarkdown();
			return new Blob([await inlineImages(md)], { type: mime });
		}
		case 'html': {
			const d = pageDims(page);
			const m = page.margins;
			const body = await inlineImages(editor.getHTML());
			const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@page{size:${d.w}mm ${d.h}mm;margin:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm}
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;color:#1a1a1a;max-width:${d.w - m.left - m.right}mm;margin:2rem auto;padding:0 1rem}
h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #9a9a9a;padding:.3em .5em;vertical-align:top}th{background:#f2f2f2;text-align:left}
td>p,th>p,li>p{margin:0}img{max-width:100%;height:auto}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1em;color:#555}
pre{background:#f5f5f5;padding:.7em .9em;border-radius:4px;white-space:pre-wrap}code{font-family:Consolas,monospace}
ul[data-type=taskList]{list-style:none;padding-left:.2em}ul[data-type=taskList] li{display:flex;gap:.5em}
</style></head><body>
${body}
</body></html>`;
			return new Blob([html], { type: mime });
		}
		case 'txt':
			return new Blob([editor.getText({ blockSeparator: '\n\n' })], { type: `${mime};charset=utf-8` });
	}
}

/** Applies the document's page setup to printing (@page) and opens the print dialog. */
export function printDoc(page: PageSetup) {
	const d = pageDims(page);
	const m = page.margins;
	let style = document.getElementById('mai-print-page') as HTMLStyleElement | null;
	if (!style) {
		style = document.createElement('style');
		style.id = 'mai-print-page';
		document.head.append(style);
	}
	style.textContent = `@page { size: ${d.w}mm ${d.h}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }`;
	window.print();
}
