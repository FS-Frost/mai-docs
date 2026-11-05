<script lang="ts">
	// Slide strip: click to select, drag to reorder, context menu (duplicate / skip / delete), keyboard ↑↓.
	import type { Deck } from '../../slides/deck.svelte.ts';
	import { LAYOUTS } from '../../slides/model.ts';
	import { toast } from '../../client/toast.svelte.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import Icon from '../Icon.svelte';
	import Menu from '../Menu.svelte';
	import SlideView from './SlideView.svelte';

	let { deck, readonly = false }: { deck: Deck; readonly?: boolean } = $props();

	const W = 168;
	const scale = $derived(W / deck.content.size.w);
	let dragFrom = $state<number | null>(null);
	let dropAt = $state<number | null>(null);
	let menu = $state<{ i: number; x: number; y: number } | null>(null);

	function remove(i: number) {
		if (!deck.deleteSlide(i)) toast.warn(t().slides.lastSlide);
	}

	function key(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
			e.preventDefault();
			deck.go(deck.current + 1);
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
			e.preventDefault();
			deck.go(deck.current - 1);
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && !readonly) {
			e.preventDefault();
			remove(deck.current);
		} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !readonly) {
			e.preventDefault();
			deck.duplicateSlide();
		}
	}

	$effect(() => {
		void deck.current;
		document.querySelector(`[data-thumb="${deck.current}"]`)?.scrollIntoView({ block: 'nearest' });
	});
</script>

<svelte:window onpointerdown={(e) => menu && !(e.target as HTMLElement).closest('[data-thumb-menu]') && (menu = null)} />

<nav class="no-print flex h-full w-52 shrink-0 flex-col border-r border-line bg-surface" aria-label={t().slides.thumbnails}>
	<!-- Arrow keys move between slides; each item has its own button. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<ol class="flex-1 space-y-2 overflow-x-hidden overflow-y-auto p-2 outline-none [scrollbar-width:thin]" tabindex="0" onkeydown={key}>
		{#each deck.content.slides as s, i (s.id)}
			<li
				data-thumb={i}
				class="flex gap-1.5 {dropAt === i && dragFrom !== null && dragFrom !== i ? 'border-t-2 border-accent pt-1' : ''}"
				draggable={!readonly}
				ondragstart={(e) => {
					dragFrom = i;
					e.dataTransfer?.setData('text/plain', String(i));
				}}
				ondragover={(e) => {
					if (dragFrom === null) return;
					e.preventDefault();
					dropAt = i;
				}}
				ondragend={() => ((dragFrom = null), (dropAt = null))}
				ondrop={(e) => {
					e.preventDefault();
					if (dragFrom !== null) deck.moveSlide(dragFrom, i);
					dragFrom = null;
					dropAt = null;
				}}
			>
				<span class="w-5 pt-1 text-right text-xs text-faint tabular-nums">{i + 1}</span>
				<button
					class="relative block rounded border-2 {i === deck.current ? 'border-accent' : 'border-transparent hover:border-line'} {s.hidden ? 'opacity-50' : ''}"
					aria-label={t().slides.slideOf(i + 1, deck.content.slides.length)}
					aria-current={i === deck.current}
					onclick={() => deck.go(i)}
					oncontextmenu={(e) => {
						e.preventDefault();
						deck.go(i);
						menu = { i, x: e.clientX, y: e.clientY };
					}}
				>
					<div class="pointer-events-none overflow-hidden rounded-sm ring-1 ring-line">
						<SlideView content={deck.content} slide={s} {scale} thumb />
					</div>
					{#if s.hidden}<span class="absolute right-1 bottom-1 rounded bg-black/60 p-0.5 text-white" title={t().slides.hidden}><Icon name="eyeOff" size={12} /></span>{/if}
				</button>
			</li>
		{/each}
	</ol>
	{#if !readonly}
		<div class="border-t border-line p-2">
			<Menu label={t().slides.newSlide} triggerClass="btn w-full justify-center">
				{#snippet icon()}<Icon name="plus" size={16} />{/snippet}
				{#snippet children(close)}
					{#each LAYOUTS as k (k)}
						<button class="menu-item" onclick={() => (close(), deck.addSlide(k))}>{t().slides.layouts[k]}</button>
					{/each}
				{/snippet}
			</Menu>
		</div>
	{/if}
</nav>

{#if menu}
	{@const i = menu.i}
	<div data-thumb-menu class="menu fixed" style="left:{Math.min(menu.x, innerWidth - 220)}px;top:{Math.min(menu.y, innerHeight - 200)}px" role="menu">
		<button class="menu-item" disabled={readonly} onclick={() => ((menu = null), deck.addSlide('titleBody', i))}>{t().slides.newSlide}</button>
		<button class="menu-item" disabled={readonly} onclick={() => ((menu = null), deck.duplicateSlide(i))}>{t().slides.duplicateSlide}</button>
		<button class="menu-item" disabled={readonly} onclick={() => ((menu = null), deck.updateSlide((s) => ({ ...s, hidden: !s.hidden }), undefined, i))}>
			{deck.content.slides[i]?.hidden ? t().slides.showSlide : t().slides.hideSlide}
		</button>
		<button class="menu-item text-bad" disabled={readonly} onclick={() => ((menu = null), remove(i))}>{t().slides.deleteSlide}</button>
	</div>
{/if}
