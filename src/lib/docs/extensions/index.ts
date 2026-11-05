// Tiptap extension set. The same list builds the editor, the markdown manager and HTML → JSON conversion,
// so stored JSON, imports and exports share one schema.
import type { AnyExtension } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Indent } from './indent.ts';
import { ImageExtras } from './image-extras.ts';
import { ChartNode } from './chart-node.ts';
import { SearchReplace } from './search.ts';

/** `chart` = node to use for charts (the editor passes one with a node view). */
export function schemaExtensions(chart: AnyExtension = ChartNode): AnyExtension[] {
	return [
		StarterKit.configure({
			heading: { levels: [1, 2, 3] },
			link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
			undoRedo: { depth: 300 }
		}),
		TextStyleKit,
		TextAlign.configure({ types: ['heading', 'paragraph'] }),
		Highlight.configure({ multicolor: true }),
		TaskList,
		TaskItem.configure({ nested: true }),
		TableKit.configure({ table: { resizable: true, cellMinWidth: 40 } }),
		Image.configure({ inline: false, allowBase64: true, resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 32, minHeight: 16 } }),
		Indent,
		ImageExtras,
		chart
	];
}

/** Full editor set (adds UI-only extensions). */
export function editorExtensions(placeholder: string, chart?: AnyExtension): AnyExtension[] {
	return [...schemaExtensions(chart), Markdown, SearchReplace, Placeholder.configure({ placeholder }), CharacterCount];
}
