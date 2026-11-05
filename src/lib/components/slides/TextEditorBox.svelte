<script lang="ts">
	// In-place rich text editor for a shape (one at a time). Every change is written to the deck with a coalescing
	// key, so typing is undone in chunks and autosave keeps up. Escape leaves editing.
	import { onDestroy, onMount, untrack } from 'svelte';
	import { Editor } from '@tiptap/core';
	import { Placeholder } from '@tiptap/extensions';
	import { schemaExtensions } from '../../docs/extensions/index.ts';
	import type { Deck } from '../../slides/deck.svelte.ts';
	import { resolveColor, resolveFont, type ShapeEl, type Theme } from '../../slides/model.ts';
	import { t } from '../../i18n/index.svelte.ts';

	let { deck, el, theme }: { deck: Deck; el: ShapeEl; theme: Theme } = $props();

	let host = $state<HTMLDivElement>();
	let editor: Editor | null = null;
	const id = untrack(() => el.id);

	onMount(() => {
		if (!host) return;
		editor = new Editor({
			element: host,
			extensions: [...schemaExtensions(), Placeholder.configure({ placeholder: untrack(() => (el.ph ? t().slides.placeholders[el.ph] : '')) })],
			content: untrack(() => el.text ?? { type: 'doc', content: [{ type: 'paragraph' }] }),
			autofocus: 'end',
			onUpdate: ({ editor: ed }) => deck.patch([id], { text: ed.getJSON() } as Partial<ShapeEl>, `text:${id}`),
			onTransaction: () => untrack(() => deck.textVer++)
		});
		deck.textEditor = editor;
	});

	onDestroy(() => {
		if (deck.textEditor === editor) deck.textEditor = null;
		editor?.destroy();
	});

	const font = $derived(`'${resolveFont(theme, el.textStyle.font)}', Arial, sans-serif`);
</script>

<div
	class="slide-editor absolute flex flex-col"
	style="left:{el.x}px;top:{el.y}px;width:{el.w}px;height:{el.h}px;{el.rot ? `transform:rotate(${el.rot}deg);` : ''}padding:{el.inset}px;justify-content:{el.anchor === 'middle' ? 'center' : el.anchor === 'bottom' ? 'flex-end' : 'flex-start'};font-family:{font};font-size:{el.textStyle.size}pt;color:{resolveColor(theme, el.textStyle.color)};font-weight:{el.textStyle.bold ? 700 : 400};text-align:{el.textStyle.align ?? 'left'};cursor:text"
	role="presentation"
	onpointerdown={(e) => e.stopPropagation()}
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			deck.stopEditing();
		}
	}}
>
	<div bind:this={host} class="w-full"></div>
</div>
