<script lang="ts">
	// A slide at a given scale. Children (interaction overlays) are drawn in logical coordinates on top.
	// Presenting passes the elements still hidden by entrance animations and the ones entering now.
	import type { Snippet } from 'svelte';
	import { cssFill, fillColor, slideBackground, type Anim, type Slide, type SlidesContent } from '../../slides/model.ts';
	import { mediaUrl } from '../../slides/render.svelte.ts';
	import ElementView from './ElementView.svelte';

	let {
		content,
		slide,
		scale,
		placeholders = false,
		hideTextOf = null,
		hideCell = null,
		live = false,
		hiddenIds = null,
		entering = null,
		thumb = false,
		children
	}: {
		content: SlidesContent;
		slide: Slide;
		scale: number;
		placeholders?: boolean;
		hideTextOf?: string | null;
		hideCell?: string | null;
		live?: boolean;
		hiddenIds?: Set<string> | null;
		entering?: Map<string, Anim> | null;
		thumb?: boolean;
		children?: Snippet;
	} = $props();

	const bg = $derived(slideBackground(content, slide));
	const bgColor = $derived(fillColor(content.theme, bg) ?? '#ffffff');
</script>

<div class="relative overflow-hidden" style="width:{content.size.w * scale}px;height:{content.size.h * scale}px">
	<div class="slide-surface slide-anim absolute top-0 left-0 origin-top-left" style="width:{content.size.w}px;height:{content.size.h}px;transform:scale({scale});background:{cssFill(content.theme, bg, mediaUrl)}">
		{#each slide.elements as el (el.id)}
			<ElementView
				{el}
				theme={content.theme}
				bg={bgColor}
				size={content.size}
				{placeholders}
				{live}
				{thumb}
				hideText={hideTextOf === el.id && !hideCell}
				hideCell={hideTextOf === el.id ? hideCell : null}
				hidden={!!hiddenIds?.has(el.id)}
				enter={entering?.get(el.id) ?? null}
			/>
		{/each}
		{#if children}{@render children()}{/if}
	</div>
</div>
