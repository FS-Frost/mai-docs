<script lang="ts">
	// Fullscreen presentation. Keys: → ↓ Space PgDn Enter next · ← ↑ PgUp Backspace previous · Home/End · number+Enter
	// go to · B/W black/white · L laser · Esc exit. Click = next, swipe on touch. Syncs with the presenter window.
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { SlidesContent } from '../../slides/model.ts';
	import { nextVisible, presentChannel, type PresentMsg, type Screen } from '../../slides/present.ts';
	import { withBase } from '../../client/base.ts';
	import { toast } from '../../client/toast.svelte.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import Icon from '../Icon.svelte';
	import SlideView from './SlideView.svelte';

	let { content, fileId, start, onexit }: { content: SlidesContent; fileId: string; start: number; onexit: (index: number) => void } = $props();

	let root = $state<HTMLDivElement>();
	let index = $state(0);
	let screen = $state<Screen>('normal');
	let laser = $state(false);
	let pointer = $state<{ x: number; y: number } | null>(null);
	let vw = $state(innerWidth);
	let vh = $state(innerHeight);
	let typed = '';
	let ended = $state(false);
	let controls = $state(true);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	const ch = presentChannel(untrack(() => fileId));

	const scale = $derived(Math.min(vw / content.size.w, vh / content.size.h));
	const slide = $derived(content.slides[index]);

	function post() {
		ch?.postMessage({ type: 'state', index, screen, running: true } satisfies PresentMsg);
	}

	function go(i: number) {
		ended = false;
		index = Math.max(0, Math.min(content.slides.length - 1, i));
		screen = 'normal';
		post();
	}
	function step(dir: 1 | -1) {
		if (ended && dir === -1) {
			ended = false;
			post();
			return;
		}
		const n = nextVisible(content.slides, index, dir);
		if (n === null) {
			if (dir === 1) ended = true;
			return;
		}
		go(n);
	}

	let exited = false;
	function exit() {
		if (exited) return;
		exited = true;
		ch?.postMessage({ type: 'end' } satisfies PresentMsg);
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
		onexit(index);
	}

	function key(e: KeyboardEvent) {
		const k = e.key;
		if (/^\d$/.test(k)) {
			typed += k;
			return;
		}
		if (k === 'Enter' && typed) {
			go(Number(typed) - 1);
			typed = '';
			return;
		}
		typed = '';
		if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n'].includes(k)) step(1);
		else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) step(-1);
		else if (k === 'Home') go(nextVisible(content.slides, -1, 1) ?? 0);
		else if (k === 'End') go(nextVisible(content.slides, content.slides.length, -1) ?? content.slides.length - 1);
		else if (k === 'b' || k === 'B' || k === '.') setScreen(screen === 'black' ? 'normal' : 'black');
		else if (k === 'w' || k === 'W' || k === ',') setScreen(screen === 'white' ? 'normal' : 'white');
		else if (k === 'l' || k === 'L') laser = !laser;
		else if (k === 'Escape') exit();
		else return;
		e.preventDefault();
	}

	function setScreen(s: Screen) {
		screen = s;
		post();
	}

	function openPresenter() {
		const w = window.open(withBase(`/slides/${fileId}/presenter`), `mai-presenter-${fileId}`, 'width=1100,height=720');
		if (!w) toast.warn(t().slides.popupBlocked);
	}

	let touch: { x: number; y: number } | null = null;

	function poke() {
		controls = true;
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => (controls = false), 2500);
	}

	onMount(() => {
		index = content.slides[start]?.hidden ? (nextVisible(content.slides, start, 1) ?? start) : start;
		void root?.requestFullscreen?.().catch(() => {});
		const onFs = () => {
			if (!document.fullscreenElement) exit();
		};
		document.addEventListener('fullscreenchange', onFs);
		const onResize = () => {
			vw = innerWidth;
			vh = innerHeight;
		};
		addEventListener('resize', onResize);
		if (ch)
			ch.onmessage = (m: MessageEvent<PresentMsg>) => {
				const d = m.data;
				if (d.type === 'goto') go(d.index);
				else if (d.type === 'step') step(d.dir);
				else if (d.type === 'screen') setScreen(d.screen);
				else if (d.type === 'hello') post();
			};
		post();
		poke();
		root?.focus();
		return () => {
			document.removeEventListener('fullscreenchange', onFs);
			removeEventListener('resize', onResize);
		};
	});

	onDestroy(() => {
		clearTimeout(hideTimer);
		ch?.close();
	});
</script>

<!-- Fullscreen presentation surface: takes keys, clicks and swipes to navigate. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={root}
	class="fixed inset-0 z-[90] grid place-items-center bg-black outline-none select-none {laser ? 'cursor-none' : controls ? '' : 'cursor-none'}"
	tabindex="-1"
	role="application"
	aria-label={t().slides.slideOf(index + 1, content.slides.length)}
	onkeydown={key}
	onpointermove={(e) => {
		poke();
		if (laser) pointer = { x: e.clientX, y: e.clientY };
	}}
	onclick={(e) => {
		if ((e.target as HTMLElement).closest('[data-present-controls]')) return;
		step(1);
	}}
	ontouchstart={(e) => (touch = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
	ontouchend={(e) => {
		if (!touch) return;
		const dx = e.changedTouches[0].clientX - touch.x;
		if (Math.abs(dx) > 50) {
			e.preventDefault();
			step(dx < 0 ? 1 : -1);
		}
		touch = null;
	}}
>
	{#if slide && !ended}
		<SlideView {content} {slide} {scale} />
	{/if}
	{#if ended}
		<p class="text-lg text-white/70">{t().slides.end}</p>
	{/if}
	{#if screen !== 'normal'}
		<div class="absolute inset-0 {screen === 'black' ? 'bg-black' : 'bg-white'}"></div>
	{/if}
	{#if laser && pointer}
		<div class="pointer-events-none fixed size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_12px_4px_rgb(255_0_0/0.6)]" style="left:{pointer.x}px;top:{pointer.y}px"></div>
	{/if}
	<div data-present-controls class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-white transition-opacity {controls ? 'opacity-100' : 'pointer-events-none opacity-0'}">
		<button class="rounded-full p-1.5 hover:bg-white/15" aria-label={t().slides.previous} title={t().slides.previous} onclick={() => step(-1)}><Icon name="chevronLeft" /></button>
		<span class="px-1 text-sm tabular-nums">{index + 1} / {content.slides.length}</span>
		<button class="rounded-full p-1.5 hover:bg-white/15" aria-label={t().slides.next} title={t().slides.next} onclick={() => step(1)}><Icon name="chevronRight" /></button>
		<button class="rounded-full p-1.5 hover:bg-white/15 {laser ? 'text-red-400' : ''}" aria-label={t().slides.laser} title={t().slides.laser} onclick={() => (laser = !laser)}><Icon name="laser" /></button>
		<button class="rounded-full p-1.5 hover:bg-white/15" aria-label={t().slides.presenterView} title={t().slides.presenterView} onclick={openPresenter}><Icon name="monitor" /></button>
		<button class="rounded-full p-1.5 hover:bg-white/15" aria-label={t().slides.exit} title={t().slides.exit} onclick={exit}><Icon name="x" /></button>
	</div>
</div>
