<script lang="ts">
	// Presenter view (second window): current and next slide, notes, timer; controls the presentation window.
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import SlideView from '#lib/components/slides/SlideView.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import type { SlidesContent } from '#lib/slides/model.ts';
	import { formatClock, nextVisible, presentChannel, type PresentMsg, type Screen } from '#lib/slides/present.ts';
	import { getContent, getMeta } from '#lib/storage/library.ts';
	import { t } from '#lib/i18n/index.svelte.ts';

	const id = $derived(page.params.id ?? '');
	let content = $state.raw<SlidesContent | null>(null);
	let title = $state('');
	let index = $state(0);
	let screen = $state<Screen>('normal');
	let ended = $state(false);
	let startedAt = $state(Date.now());
	let now = $state(Date.now());
	let vw = $state(innerWidth);
	let ch: BroadcastChannel | null = null;
	let tick: ReturnType<typeof setInterval> | undefined;

	const onResize = () => (vw = innerWidth);
	onMount(() => {
		addEventListener('resize', onResize);
		void init();
		return () => removeEventListener('resize', onResize);
	});

	async function init() {
		content = (await getContent<SlidesContent>(id)) ?? null;
		title = (await getMeta(id))?.title ?? '';
		ch = presentChannel(id);
		if (ch) {
			ch.onmessage = (m: MessageEvent<PresentMsg>) => {
				const d = m.data;
				if (d.type === 'state') {
					index = d.index;
					screen = d.screen;
					ended = false;
				} else if (d.type === 'end') ended = true;
			};
			ch.postMessage({ type: 'hello' } satisfies PresentMsg);
		}
		tick = setInterval(() => (now = Date.now()), 500);
	}
	onDestroy(() => {
		clearInterval(tick);
		ch?.close();
	});

	const send = (m: PresentMsg) => ch?.postMessage(m);
	const next = $derived(content ? nextVisible(content.slides, index, 1) : null);
	const bigScale = $derived(content ? Math.min((vw * 0.58) / content.size.w, 0.75) : 0.5);
	const smallScale = $derived(content ? Math.min((vw * 0.32) / content.size.w, 0.45) : 0.3);

	function key(e: KeyboardEvent) {
		if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) send({ type: 'step', dir: 1 });
		else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) send({ type: 'step', dir: -1 });
		else if (e.key === 'b' || e.key === 'B') send({ type: 'screen', screen: screen === 'black' ? 'normal' : 'black' });
		else if (e.key === 'w' || e.key === 'W') send({ type: 'screen', screen: screen === 'white' ? 'normal' : 'white' });
		else return;
		e.preventDefault();
	}
</script>

<svelte:window onkeydown={key} />
<svelte:head><title>{t().slides.presenterView} — {title}</title></svelte:head>

<div class="flex min-h-dvh flex-col bg-[#15171c] p-4 text-[#e7e8eb]">
	<header class="mb-3 flex items-center gap-3">
		<h1 class="flex-1 truncate font-medium">{title}</h1>
		<span class="flex items-center gap-1.5 text-2xl font-semibold tabular-nums"><Icon name="timer" />{formatClock(now - startedAt)}</span>
		<button class="rounded border border-white/20 px-2 py-1 text-sm hover:bg-white/10" onclick={() => (startedAt = Date.now())}>{t().slides.resetTimer}</button>
		<span class="text-sm text-white/60 tabular-nums">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
	</header>
	{#if content}
		<div class="flex flex-1 flex-wrap gap-4">
			<section class="flex flex-col gap-2">
				<div class="text-sm text-white/60">{ended ? t().slides.end : t().slides.slideOf(index + 1, content.slides.length)}</div>
				<div class="overflow-hidden rounded ring-2 ring-[#7d97ff]">
					<SlideView {content} slide={content.slides[index]} scale={bigScale} />
				</div>
				<div class="flex gap-2">
					<button class="flex items-center gap-1 rounded border border-white/20 px-3 py-1.5 hover:bg-white/10" onclick={() => send({ type: 'step', dir: -1 })}><Icon name="chevronLeft" />{t().slides.previous}</button>
					<button class="flex items-center gap-1 rounded bg-[#3b5bdb] px-3 py-1.5 hover:bg-[#3b5bdb]/90" onclick={() => send({ type: 'step', dir: 1 })}>{t().slides.next}<Icon name="chevronRight" /></button>
					<button class="rounded border border-white/20 px-3 py-1.5 hover:bg-white/10 {screen === 'black' ? 'bg-white/20' : ''}" onclick={() => send({ type: 'screen', screen: screen === 'black' ? 'normal' : 'black' })}>{t().slides.black}</button>
				</div>
			</section>
			<section class="flex min-w-64 flex-1 flex-col gap-2">
				<div class="text-sm text-white/60">{t().slides.nextSlide}</div>
				{#if next !== null}
					<div class="w-fit overflow-hidden rounded opacity-90 ring-1 ring-white/20"><SlideView {content} slide={content.slides[next]} scale={smallScale} /></div>
				{:else}
					<div class="text-sm text-white/50">{t().slides.end}</div>
				{/if}
				<div class="mt-2 text-sm text-white/60">{t().slides.notes}</div>
				<div class="flex-1 overflow-y-auto rounded bg-white/5 p-3 text-lg leading-relaxed whitespace-pre-wrap">{content.slides[index]?.notes ?? ''}</div>
			</section>
		</div>
	{/if}
</div>
