<script lang="ts">
	// In-place rich text editor for a shape or a table cell (one at a time). Every change is written to the deck
	// with a coalescing key, so typing is undone in chunks and autosave keeps up. Escape leaves editing; Tab moves
	// to the next table cell.
	import { onDestroy, onMount, untrack } from 'svelte';
	import { Editor } from '@tiptap/core';
	import { Placeholder } from '@tiptap/extensions';
	import { schemaExtensions } from '../../docs/extensions/index.ts';
	import type { Deck } from '../../slides/deck.svelte.ts';
	import { resolveColor, resolveFont, type ShapeEl, type TableEl, type Theme } from '../../slides/model.ts';
	import { cellBox, setCell } from '../../slides/table.ts';
	import { t } from '../../i18n/index.svelte.ts';

	let { deck, el, theme, cell = null }: { deck: Deck; el: ShapeEl | TableEl; theme: Theme; cell?: string | null } = $props();

	let host = $state<HTMLDivElement>();
	let editor: Editor | null = null;
	const id = untrack(() => el.id);
	const rc = untrack(() => (cell ? cell.split(':').map(Number) : null));

	function initial() {
		if (el.kind === 'table') return (rc && el.cells[rc[0]]?.[rc[1]]?.text) || { type: 'doc', content: [{ type: 'paragraph' }] };
		return el.text ?? { type: 'doc', content: [{ type: 'paragraph' }] };
	}

	onMount(() => {
		if (!host) return;
		editor = new Editor({
			element: host,
			extensions: [...schemaExtensions(), Placeholder.configure({ placeholder: untrack(() => (el.kind === 'shape' && el.ph ? t().slides.placeholders[el.ph] : '')) })],
			content: untrack(initial),
			autofocus: 'end',
			onUpdate: ({ editor: ed }) => {
				if (rc) deck.updateTable(id, (tb) => setCell(tb, rc[0], rc[1], { text: ed.getJSON() }), `text:${id}:${cell}`);
				else deck.patch([id], { text: ed.getJSON() } as Partial<ShapeEl>, `text:${id}`);
			},
			onTransaction: () => untrack(() => deck.textVer++)
		});
		deck.textEditor = editor;
	});

	onDestroy(() => {
		if (deck.textEditor === editor) deck.textEditor = null;
		editor?.destroy();
	});

	const style = $derived(el.kind === 'table' ? el.textStyle : el.textStyle);
	const font = $derived(`'${resolveFont(theme, style.font)}', Arial, sans-serif`);
	const box = $derived.by(() => {
		if (el.kind === 'table' && rc) {
			const b = cellBox(el, rc[0], rc[1]);
			return { x: el.x + b.x, y: el.y + b.y, w: b.w, h: b.h, pad: '4px 6px', anchor: el.cells[rc[0]]?.[rc[1]]?.anchor ?? 'top' };
		}
		const s = el as ShapeEl;
		return { x: s.x, y: s.y, w: s.w, h: s.h, pad: `${s.inset}px`, anchor: s.anchor };
	});
	const color = $derived(el.kind === 'table' && el.firstRow && rc?.[0] === 0 ? resolveColor(theme, 'lt1') : resolveColor(theme, style.color));

	function nextCell(dir: 1 | -1) {
		if (el.kind !== 'table' || !rc) return;
		const tb = el;
		let r = rc[0];
		let c = rc[1];
		for (let n = 0; n < tb.rows.length * tb.cols.length; n++) {
			c += dir;
			if (c >= tb.cols.length) ((c = 0), r++);
			if (c < 0) ((c = tb.cols.length - 1), r--);
			if (r < 0 || r >= tb.rows.length) return;
			if (!tb.cells[r][c].hidden) break;
		}
		deck.stopEditing();
		queueMicrotask(() => deck.startEditing(tb.id, `${r}:${c}`));
	}
</script>

<div
	class="slide-editor absolute flex flex-col"
	style="left:{box.x}px;top:{box.y}px;width:{box.w}px;min-height:{box.h}px;{el.rot && el.kind === 'shape' ? `transform:rotate(${el.rot}deg);` : ''}padding:{box.pad};justify-content:{box.anchor === 'middle' ? 'center' : box.anchor === 'bottom' ? 'flex-end' : 'flex-start'};font-family:{font};font-size:{style.size}pt;color:{color};font-weight:{style.bold || (el.kind === 'table' && el.firstRow && rc?.[0] === 0) ? 700 : 400};text-align:{style.align ?? 'left'};cursor:text;{el.kind === 'table' ? 'outline:2px solid #3b5bdb;' : ''}"
	role="presentation"
	onpointerdown={(e) => e.stopPropagation()}
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			deck.stopEditing();
		} else if (e.key === 'Tab' && rc) {
			e.preventDefault();
			e.stopPropagation();
			nextCell(e.shiftKey ? -1 : 1);
		}
	}}
>
	<div bind:this={host} class="w-full"></div>
</div>
