<script lang="ts">
	// First slide of a presentation, drawn live (nothing stored). Content loads when the card scrolls into view
	// and again when the file changes.
	import type { SlidesContent } from '../../slides/model.ts';
	import { getContent } from '../../storage/library.ts';
	import SlideView from '../slides/SlideView.svelte';

	let { id, rev }: { id: string; rev: number } = $props();

	let host = $state<HTMLDivElement>();
	let width = $state(0);
	let visible = $state(false);
	let content = $state<SlidesContent | null>(null);

	$effect(() => {
		if (!host) return;
		const io = new IntersectionObserver((es) => {
			if (es.some((e) => e.isIntersecting)) {
				visible = true;
				io.disconnect();
			}
		});
		io.observe(host);
		return () => io.disconnect();
	});

	$effect(() => {
		if (!visible) return;
		void rev;
		let alive = true;
		void getContent<SlidesContent>(id).then((c) => {
			if (alive) content = c ?? null;
		});
		return () => {
			alive = false;
		};
	});

	const slide = $derived(content?.slides.find((s) => !s.hidden) ?? content?.slides[0]);
</script>

<div bind:this={host} bind:clientWidth={width} class="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
	{#if content && slide && width}
		<SlideView {content} {slide} scale={Math.min(width / content.size.w, (width * 9) / 16 / content.size.h)} thumb />
	{/if}
</div>
