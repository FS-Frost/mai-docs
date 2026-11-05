// Document content as stored in the library.
import type { JSONContent } from '@tiptap/core';
import type { Locale } from '../i18n/detect.ts';

export type PageSize = 'A4' | 'Letter' | 'Legal';
export type Orientation = 'portrait' | 'landscape';
export type Margins = { top: number; right: number; bottom: number; left: number }; // mm
export type PageSetup = { size: PageSize; orientation: Orientation; margins: Margins };

export type DocContent = { v: 1; page: PageSetup; doc: JSONContent };

/** Paper sizes in mm (portrait). */
export const PAGE_MM: Record<PageSize, [number, number]> = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };

export const defaultPage = (locale: Locale): PageSetup => ({
	size: locale === 'es' ? 'A4' : 'Letter',
	orientation: 'portrait',
	margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 }
});

export const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });

export const newDocContent = (locale: Locale, doc: JSONContent = emptyDoc()): DocContent => ({ v: 1, page: defaultPage(locale), doc });

export function pageDims(p: PageSetup): { w: number; h: number } {
	const [w, h] = PAGE_MM[p.size];
	return p.orientation === 'portrait' ? { w, h } : { w: h, h: w };
}

/** Plain text of a Tiptap JSON tree (for counts, txt export without an editor). */
export function plainText(node: JSONContent, sep = '\n\n'): string {
	if (node.type === 'text') return node.text ?? '';
	if (node.type === 'hardBreak') return '\n';
	const parts = (node.content ?? []).map((c) => plainText(c, sep));
	const block = ['doc', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'table', 'tableRow', 'listItem', 'taskItem', 'tableCell', 'tableHeader'];
	if (node.type === 'tableRow') return parts.join('\t');
	return parts.join(block.includes(node.type ?? '') ? (node.type === 'doc' ? sep : '\n') : '');
}
