// Find & replace: ProseMirror plugin with decorations. Matches never span blocks.
import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type SearchOpts = { caseSensitive: boolean; wholeWord: boolean };
export type Match = { from: number; to: number };
type State = { query: string; opts: SearchOpts; matches: Match[]; index: number; deco: DecorationSet };

export const searchKey = new PluginKey<State>('search');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** All matches of `query` in the document (pure; tested). */
export function findMatches(doc: PMNode, query: string, opts: SearchOpts): Match[] {
	if (!query) return [];
	const out: Match[] = [];
	const src = escape(query);
	const re = new RegExp(opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])` : src, opts.caseSensitive ? 'gu' : 'giu');
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		let text = '';
		const map: number[] = [];
		node.forEach((child, offset) => {
			const start = pos + 1 + offset;
			if (child.isText) {
				for (let i = 0; i < child.text!.length; i++) map.push(start + i);
				text += child.text;
			} else {
				map.push(start);
				text += '￼';
			}
		});
		map.push(pos + 1 + node.content.size);
		for (const m of text.matchAll(re)) {
			if (!m[0].length) continue;
			const i = m.index!;
			out.push({ from: map[i], to: map[i + m[0].length - 1] + 1 });
		}
		return false;
	});
	return out;
}

function decorate(doc: PMNode, matches: Match[], index: number) {
	return DecorationSet.create(
		doc,
		matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === index ? 'search-match current' : 'search-match' }))
	);
}

const empty = (): State => ({ query: '', opts: { caseSensitive: false, wholeWord: false }, matches: [], index: -1, deco: DecorationSet.empty });

type Meta = { query: string; opts: SearchOpts; index?: number } | { index: number };

export const SearchReplace = Extension.create({
	name: 'searchReplace',
	addProseMirrorPlugins() {
		return [
			new Plugin<State>({
				key: searchKey,
				state: {
					init: empty,
					apply(tr, prev, _old, state) {
						const meta = tr.getMeta(searchKey) as Meta | undefined;
						if (!meta && !tr.docChanged) return prev;
						let { query, opts, index } = prev;
						if (meta && 'query' in meta) {
							query = meta.query;
							opts = meta.opts;
							index = meta.index ?? 0;
						} else if (meta) index = meta.index;
						if (!query) return { ...empty(), opts };
						const matches = findMatches(state.doc, query, opts);
						if (!meta && tr.docChanged) {
							// Keep the current match near where it was.
							const at = prev.matches[prev.index]?.from;
							const mapped = at === undefined ? 0 : tr.mapping.map(at);
							index = Math.max(0, matches.findIndex((m) => m.from >= mapped));
						}
						if (matches.length) index = ((index % matches.length) + matches.length) % matches.length;
						else index = -1;
						return { query, opts, matches, index, deco: decorate(state.doc, matches, index) };
					}
				},
				props: {
					decorations(state) {
						return searchKey.getState(state)?.deco ?? DecorationSet.empty;
					}
				}
			})
		];
	}
});

export const searchState = (state: EditorState) => searchKey.getState(state) ?? empty();

function reveal(editor: Editor) {
	const st = searchState(editor.state);
	const m = st.matches[st.index];
	if (!m) return;
	editor.commands.setTextSelection(m);
	const dom = editor.view.domAtPos(m.from).node as HTMLElement;
	(dom.nodeType === 3 ? dom.parentElement : dom)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function setSearch(editor: Editor, query: string, opts: SearchOpts) {
	const sel = editor.state.selection.from;
	const matches = findMatches(editor.state.doc, query, opts);
	const index = Math.max(0, matches.findIndex((m) => m.from >= sel));
	editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query, opts, index }));
}

export function stepSearch(editor: Editor, dir: 1 | -1) {
	const st = searchState(editor.state);
	if (!st.matches.length) return;
	editor.view.dispatch(editor.state.tr.setMeta(searchKey, { index: st.index + dir }));
	reveal(editor);
}

export function replaceCurrent(editor: Editor, text: string) {
	const st = searchState(editor.state);
	const m = st.matches[st.index];
	if (!m) return;
	editor.chain().focus().insertContentAt(m, text ? { type: 'text', text } : []).run();
	reveal(editor);
}

export function replaceAll(editor: Editor, text: string) {
	const st = searchState(editor.state);
	if (!st.matches.length) return 0;
	const tr = editor.state.tr;
	for (const m of [...st.matches].reverse()) {
		if (text) tr.replaceWith(m.from, m.to, editor.state.schema.text(text, editor.state.doc.resolve(m.from).marks()));
		else tr.delete(m.from, m.to);
	}
	editor.view.dispatch(tr);
	return st.matches.length;
}

export function clearSearch(editor: Editor) {
	if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query: '', opts: searchState(editor.state).opts }));
}
