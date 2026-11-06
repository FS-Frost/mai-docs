<script lang="ts">
	// Fullscreen presentation. Keys: → ↓ Space PgDn Enter next · ← ↑ PgUp Backspace previous · Home/End · number+Enter
	// go to · B/W black/white · L laser · Esc exit. Click = next, swipe on touch. Syncs with the presenter window.
	// "Next" plays the slide's entrance animations step by step before moving on (with the slide transition).
	import { onDestroy, onMount, untrack } from 'svelte';
	import { animSteps, hiddenAt, stepTimeline, type Anim, type Slide, type SlidesContent, type Transition } from '../../slides/model.ts';
	import { advance, nextVisible, openPresenterWindow, presentChannel, type PresentMsg, type Screen } from '../../slides/present.ts';
	import { withBase } from '../../client/base.ts';
	import { toast } from '../../client/toast.svelte.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import Icon from '../Icon.svelte';
	import SlideView from './SlideView.svelte';

	// windowed = present in the tab without fullscreen (presenter view on the same screen, or a second window).
	let { content, fileId, start, onexit, windowed = false }: { content: SlidesContent; fileId: string; start: number; onexit: (index: number) => void; windowed?: boolean } = $props();

	let root = $state<HTMLDivElement>();
	let index = $state(0);
	let step = $state(0);
	let entering = $state.raw<Map<string, Anim> | null>(null);
	let screen = $state<Screen>('normal');
	let laser = $state(false);
	let pointer = $state<{ x: number; y: number } | null>(null);
	let vw = $state(innerWidth);
	let vh = $state(innerHeight);
	let typed = '';
	let ended = $state(false);
	let controls = $state(true);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	/** Outgoing slide while a transition plays. */
	let leaving = $state.raw<{ slide: Slide; step: number; tr: Transition; dirSign: 1 | -1; key: number } | null>(null);
	let trKey = $state(0);
	let trTimer: ReturnType<typeof setTimeout> | undefined;
	const ch = presentChannel(untrack(() => fileId));
	let isFs = $state(false);
	/** Leaving fullscreen ends the show (Esc is taken by the browser), unless a presenter window is in use: opening
	 * a pop-up makes the browser leave fullscreen, and the show must go on in the tab. */
	let keepWindowed = untrack(() => windowed);

	const scale = $derived(Math.min(vw / content.size.w, vh / content.size.h));
	const slide = $derived(content.slides[index]);
	const hiddenIds = $derived(slide ? hiddenAt(slide, step) : null);
	const W = $derived(content.size.w * scale);
	const H = $derived(content.size.h * scale);

	function post() {
		ch?.postMessage({ type: 'state', index, step, screen, running: true, ended } satisfies PresentMsg);
	}

	function show(i: number, s: number, animate: boolean, dir: 1 | -1 = 1) {
		const prev = content.slides[index];
		const changed = i !== index;
		const tr = content.slides[i]?.transition;
		if (changed && animate && prev && tr && tr.type !== 'none' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
			leaving = { slide: prev, step: animSteps(prev).steps, tr, dirSign: dir, key: ++trKey };
			clearTimeout(trTimer);
			trTimer = setTimeout(() => (leaving = null), tr.dur + 50);
		} else if (changed) leaving = null;
		ended = false;
		index = Math.max(0, Math.min(content.slides.length - 1, i));
		step = s;
		entering = null;
		screen = 'normal';
		post();
	}

	function go(i: number) {
		const n = Math.max(0, Math.min(content.slides.length - 1, i));
		show(n, 0, true);
	}

	function move(dir: 1 | -1) {
		if (ended && dir === -1) {
			ended = false;
			post();
			return;
		}
		if (ended) return;
		const p = advance(content.slides, { index, step }, dir);
		if (!p) {
			if (dir === 1) {
				ended = true;
				post();
			}
			return;
		}
		if (p.index === index) {
			step = p.step;
			entering = dir === 1 ? stepTimeline(slide, p.step).entering : null;
			post();
			return;
		}
		show(p.index, p.step, dir === 1, dir);
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
		if ((e.target as HTMLElement).closest('video,audio')) return;
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
		if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n'].includes(k)) move(1);
		else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) move(-1);
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
		keepWindowed = true;
		if (!openPresenterWindow(withBase(`/slides/${fileId}/presenter`), fileId)) toast.warn(t().slides.popupBlocked);
	}

	function toggleFullscreen() {
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
		else void root?.requestFullscreen?.().catch(() => {});
		root?.focus();
	}

	let touch: { x: number; y: number } | null = null;

	function poke() {
		controls = true;
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => (controls = false), 2500);
	}

	onMount(() => {
		index = content.slides[start]?.hidden ? (nextVisible(content.slides, start, 1) ?? start) : start;
		if (!windowed) void root?.requestFullscreen?.().catch(() => {});
		const onFs = () => {
			isFs = !!document.fullscreenElement;
			if (!isFs && !keepWindowed) exit();
			else root?.focus();
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
				else if (d.type === 'step') move(d.dir);
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
		clearTimeout(trTimer);
		ch?.close();
	});

	/** Offset (px) of the side a transition comes from. */
	function from(tr: Transition, sign: 1 | -1) {
		const d = tr.dir ?? 'r';
		const k = sign;
		return { x: (d === 'r' ? W : d === 'l' ? -W : 0) * k, y: (d === 'd' ? H : d === 'u' ? -H : 0) * k };
	}
	function inStyle(tr: Transition, sign: 1 | -1) {
		const f = from(tr, sign);
		const dur = `${tr.dur}ms`;
		if (tr.type === 'fade') return `animation:mai-fade ${dur} ease both`;
		if (tr.type === 'zoom') return `animation:mai-zoom ${dur} ease-out both`;
		if (tr.type === 'wipe') return `animation:mai-wipe-${sign === 1 ? (tr.dir ?? 'r') : ({ l: 'r', r: 'l', u: 'd', d: 'u' } as const)[tr.dir ?? 'r']} ${dur} ease both`;
		return `--tx:${f.x}px;--ty:${f.y}px;animation:mai-slide-in ${dur} ease-out both`;
	}
	function outStyle(tr: Transition, sign: 1 | -1) {
		const f = from(tr, sign);
		if (tr.type === 'push') return `--tx:${-f.x}px;--ty:${-f.y}px;animation:mai-slide-out ${tr.dur}ms ease-out both`;
		return '';
	}
	const onSlideClick = (e: MouseEvent) => !(e.target as HTMLElement).closest('[data-present-controls],[data-media]');
</script>

<!-- Fullscreen presentation surface: takes keys, clicks and swipes to navigate. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={root}
	class="fixed inset-0 z-[90] grid place-items-center overflow-hidden bg-black outline-none select-none {laser ? 'cursor-none' : controls ? '' : 'cursor-none'}"
	tabindex="-1"
	role="application"
	aria-label={t().slides.slideOf(index + 1, content.slides.length)}
	onkeydown={key}
	onpointermove={(e) => {
		poke();
		if (laser) pointer = { x: e.clientX, y: e.clientY };
	}}
	onclick={(e) => {
		if (onSlideClick(e)) move(1);
	}}
	ontouchstart={(e) => (touch = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
	ontouchend={(e) => {
		if (!touch) return;
		const dx = e.changedTouches[0].clientX - touch.x;
		if (Math.abs(dx) > 50) {
			e.preventDefault();
			move(dx < 0 ? 1 : -1);
		}
		touch = null;
	}}
>
	{#if slide && !ended}
		<div class="relative" style="width:{W}px;height:{H}px">
			{#if leaving}
				{#key leaving.key}
					<div class="slide-anim absolute inset-0" style={outStyle(leaving.tr, leaving.dirSign)}>
						<SlideView {content} slide={leaving.slide} {scale} />
					</div>
				{/key}
			{/if}
			{#key `${index}|${leaving?.key ?? 0}`}
				<div class="slide-anim absolute inset-0" style={leaving ? inStyle(leaving.tr, leaving.dirSign) : ''}>
					<SlideView {content} {slide} {scale} live {hiddenIds} {entering} />
				</div>
			{/key}
		</div>
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
		<button class="rounded-full p-1.5 hover:bg-white/15" aria-label={t().slides.previous} title={t().slides.previous} onclick={() => move(-1)}><Icon name="chevronLeft" /></button>
		<span class="px-1 text-sm tabular-nums">{index + 1} / {content.slides.length}</span>
		<button class="rounded-full p-1.5 hover:bg-white/15" aria-label={t().slides.next} title={t().slides.next} onclick={() => move(1)}><Icon name="chevronRight" /></button>
		<button class="rounded-full p-1.5 hover:bg-white/15 {laser ? 'text-red-400' : ''}" aria-label={t().slides.laser} title={t().slides.laser} onclick={() => (laser = !laser)}><Icon name="laser" /></button>
		<button class="rounded-full p-1.5 hover:bg-white/15" aria-label={t().slides.presenterView} title={t().slides.presenterView} onclick={openPresenter}><Icon name="monitor" /></button>
		<button class="rounded-full p-1.5 hover:bg-white/15" aria-label={isFs ? t().slides.exitFullscreen : t().slides.fullscreen} title={isFs ? t().slides.exitFullscreen : t().slides.fullscreen} onclick={toggleFullscreen}><Icon name="fullscreen" /></button>
		<button class="rounded-full p-1.5 hover:bg-white/15" aria-label={t().slides.exit} title={t().slides.exit} onclick={exit}><Icon name="x" /></button>
	</div>
</div>
