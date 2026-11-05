// Image layout for documents: alignment and text wrapping (attributes rendered on the <img>, styled through the
// resize container with :has()), and captions as paragraphs with `caption: true` (Word's "Caption" style).
import { Extension } from '@tiptap/core';

export type ImageAlign = 'left' | 'center' | 'right';
export type ImageWrap = 'inline' | 'left' | 'right';

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		imageExtras: {
			setImageAlign: (align: ImageAlign) => ReturnType;
			setImageWrap: (wrap: ImageWrap) => ReturnType;
			setImageAlt: (alt: string) => ReturnType;
			addImageCaption: (placeholder: string) => ReturnType;
		};
	}
}

export const ImageExtras = Extension.create({
	name: 'imageExtras',
	addGlobalAttributes() {
		return [
			{
				types: ['image'],
				attributes: {
					align: {
						default: null,
						parseHTML: (el) => el.getAttribute('data-align'),
						renderHTML: (a) => (a.align ? { 'data-align': a.align } : {})
					},
					wrap: {
						default: null,
						parseHTML: (el) => el.getAttribute('data-wrap'),
						renderHTML: (a) => (a.wrap && a.wrap !== 'inline' ? { 'data-wrap': a.wrap } : {})
					}
				}
			},
			{
				types: ['paragraph'],
				attributes: {
					caption: {
						default: false,
						parseHTML: (el) => el.hasAttribute('data-caption') || el.classList.contains('caption') || el.tagName === 'FIGCAPTION',
						renderHTML: (a) => (a.caption ? { 'data-caption': '', class: 'caption' } : {})
					}
				}
			}
		];
	},
	addCommands() {
		return {
			setImageAlign:
				(align) =>
				({ commands }) =>
					commands.updateAttributes('image', { align, wrap: null }),
			setImageWrap:
				(wrap) =>
				({ commands }) =>
					commands.updateAttributes('image', { wrap: wrap === 'inline' ? null : wrap, align: null }),
			setImageAlt:
				(alt) =>
				({ commands }) =>
					commands.updateAttributes('image', { alt }),
			addImageCaption:
				(placeholder) =>
				({ state, chain }) => {
					const { from } = state.selection;
					const node = state.doc.nodeAt(from);
					if (!node || node.type.name !== 'image') return false;
					const after = from + node.nodeSize;
					const next = state.doc.nodeAt(after);
					if (next?.type.name === 'paragraph' && next.attrs.caption) return chain().setTextSelection(after + 1).run();
					const align = node.attrs.align ?? (node.attrs.wrap ? null : 'center');
					return chain()
						.insertContentAt(after, { type: 'paragraph', attrs: { caption: true, textAlign: align }, content: [{ type: 'text', text: placeholder }] })
						.setTextSelection({ from: after + 1, to: after + 1 + placeholder.length })
						.run();
				}
		};
	}
});
