<script lang="ts">
	// A slide at a given scale. Children (interaction overlays) are drawn in logical coordinates on top.
	import type { Snippet } from 'svelte';
	import { cssFill, slideBackground, type Slide, type SlidesContent } from '../../slides/model.ts';
	import ElementView from './ElementView.svelte';

	let {
		content,
		slide,
		scale,
		placeholders = false,
		hideTextOf = null,
		children
	}: { content: SlidesContent; slide: Slide; scale: number; placeholders?: boolean; hideTextOf?: string | null; children?: Snippet } = $props();

	const bg = $derived(slideBackground(content, slide));
</script>

<div class="relative overflow-hidden" style="width:{content.size.w * scale}px;height:{content.size.h * scale}px">
	<div class="slide-surface absolute top-0 left-0 origin-top-left" style="width:{content.size.w}px;height:{content.size.h}px;transform:scale({scale});background:{cssFill(content.theme, bg)}">
		{#each slide.elements as el (el.id)}
			<ElementView {el} theme={content.theme} {placeholders} hideText={hideTextOf === el.id} />
		{/each}
		{#if children}{@render children()}{/if}
	</div>
</div>
