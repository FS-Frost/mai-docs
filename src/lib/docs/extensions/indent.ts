// Paragraph/heading indentation (levels 0-8, 1 level = 12.7 mm like Word's default tab). Inside lists,
// indent/outdent nest/unnest the list item instead.
import { Extension } from '@tiptap/core';

export const INDENT_STEP_MM = 12.7;
const MAX = 8;
const TYPES = ['paragraph', 'heading'];

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		indent: {
			indent: () => ReturnType;
			outdent: () => ReturnType;
		};
	}
}

export const Indent = Extension.create({
	name: 'indent',
	addGlobalAttributes() {
		return [
			{
				types: TYPES,
				attributes: {
					indent: {
						default: 0,
						parseHTML: (el) => {
							const ml = (el as HTMLElement).style?.marginLeft ?? '';
							const m = /([\d.]+)(mm|pt|px|em|cm|in)/.exec(ml);
							if (!m) return Number((el as HTMLElement).dataset?.indent ?? 0) || 0;
							const n = Number(m[1]);
							const mm = m[2] === 'mm' ? n : m[2] === 'cm' ? n * 10 : m[2] === 'in' ? n * 25.4 : m[2] === 'pt' ? (n * 25.4) / 72 : m[2] === 'px' ? (n * 25.4) / 96 : n * 4.2;
							return Math.max(0, Math.min(MAX, Math.round(mm / INDENT_STEP_MM)));
						},
						renderHTML: (attrs) => (attrs.indent ? { style: `margin-left: ${attrs.indent * INDENT_STEP_MM}mm`, 'data-indent': attrs.indent } : {})
					}
				}
			}
		];
	},
	addCommands() {
		const change =
			(delta: number) =>
			({ editor, tr, state, dispatch }: { editor: import('@tiptap/core').Editor; tr: import('@tiptap/pm/state').Transaction; state: import('@tiptap/pm/state').EditorState; dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void }) => {
				if (editor.isActive('listItem') || editor.isActive('taskItem')) {
					const item = editor.isActive('taskItem') ? 'taskItem' : 'listItem';
					return delta > 0 ? editor.commands.sinkListItem(item) : editor.commands.liftListItem(item);
				}
				const { from, to } = state.selection;
				let changed = false;
				state.doc.nodesBetween(from, to, (node, pos) => {
					if (!TYPES.includes(node.type.name)) return;
					const cur = (node.attrs.indent as number) ?? 0;
					const next = Math.max(0, Math.min(MAX, cur + delta));
					if (next !== cur) {
						tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
						changed = true;
					}
				});
				if (changed && dispatch) dispatch(tr);
				return changed;
			};
		return {
			indent: () => (props) => change(1)(props),
			outdent: () => (props) => change(-1)(props)
		};
	},
	addKeyboardShortcuts() {
		return {
			Tab: () => (this.editor.isActive('listItem') || this.editor.isActive('taskItem') ? false : this.editor.isActive('table') ? false : this.editor.commands.indent()),
			'Shift-Tab': () => (this.editor.isActive('listItem') || this.editor.isActive('taskItem') || this.editor.isActive('table') ? false : this.editor.commands.outdent())
		};
	}
});
