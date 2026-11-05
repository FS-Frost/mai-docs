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
import { SearchReplace } from './search.ts';

export function schemaExtensions(): AnyExtension[] {
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
		Indent
	];
}

/** Full editor set (adds UI-only extensions). */
export function editorExtensions(placeholder: string): AnyExtension[] {
	return [...schemaExtensions(), Markdown, SearchReplace, Placeholder.configure({ placeholder }), CharacterCount];
}
