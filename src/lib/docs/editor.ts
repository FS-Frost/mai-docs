// Creates the Tiptap editor for a document: extensions, image paste/drop into the blob store.
import { Editor, type JSONContent } from '@tiptap/core';
import { putBlob, urlFor } from '../storage/blobs.ts';
import { editorExtensions } from './extensions/index.ts';

export type DocEditorOpts = {
	element: HTMLElement;
	docId: string;
	content: JSONContent;
	placeholder: string;
	editable: boolean;
	onUpdate: () => void;
	onTransaction: () => void;
};

const isImage = (f: File) => f.type.startsWith('image/');

export async function insertImages(editor: Editor, docId: string, files: File[], pos?: number) {
	for (const f of files.filter(isImage)) {
		const id = await putBlob(docId, f);
		const src = await urlFor(id);
		if (!src) continue;
		const node = { type: 'image', attrs: { src, alt: f.name } };
		if (pos !== undefined) editor.chain().focus().insertContentAt(pos, node).run();
		else editor.chain().focus().insertContent(node).run();
	}
}

export function createDocEditor(o: DocEditorOpts): Editor {
	const editor: Editor = new Editor({
		element: o.element,
		extensions: editorExtensions(o.placeholder),
		content: o.content,
		editable: o.editable,
		autofocus: false,
		editorProps: {
			attributes: { spellcheck: 'true', 'aria-multiline': 'true', role: 'textbox' },
			handlePaste(_view, event) {
				const files = [...(event.clipboardData?.files ?? [])].filter(isImage);
				if (!files.length) return false;
				event.preventDefault();
				void insertImages(editor, o.docId, files);
				return true;
			},
			handleDrop(view, event, _slice, moved) {
				if (moved) return false;
				const files = [...(event.dataTransfer?.files ?? [])].filter(isImage);
				if (!files.length) return false;
				event.preventDefault();
				const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
				void insertImages(editor, o.docId, files, pos);
				return true;
			}
		},
		onUpdate: o.onUpdate,
		onTransaction: o.onTransaction
	});
	return editor;
}
