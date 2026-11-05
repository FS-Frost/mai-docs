// Markdown ⇄ Tiptap JSON without an editor instance (works in Bun tests too).
import type { JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { schemaExtensions } from '../extensions/index.ts';

let manager: MarkdownManager | undefined;
const md = () => (manager ??= new MarkdownManager({ extensions: schemaExtensions() }));

export function markdownToJSON(text: string): JSONContent {
	const doc = md().parse(text.replace(/\r\n?/g, '\n'));
	return doc.content?.length ? doc : { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function jsonToMarkdown(doc: JSONContent): string {
	return md().serialize(doc);
}

/** Plain text → paragraphs (blank lines separate paragraphs, single newlines become line breaks). */
export function textToJSON(text: string): JSONContent {
	const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
	return {
		type: 'doc',
		content: paras.map((p) => {
			const lines = p.split('\n');
			const content: JSONContent[] = [];
			lines.forEach((l, i) => {
				if (i) content.push({ type: 'hardBreak' });
				if (l) content.push({ type: 'text', text: l });
			});
			return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
		})
	};
}
