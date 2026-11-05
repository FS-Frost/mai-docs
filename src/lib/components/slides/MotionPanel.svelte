<script lang="ts">
	// Side panel: slide transition + entrance animations of the current slide (order, trigger, effect, timing).
	// Preview plays the steps in a small slide view.
	import { onDestroy } from 'svelte';
	import type { Deck } from '../../slides/deck.svelte.ts';
	import { ANIM_EFFECTS, animSteps, hiddenAt, stepTimeline, textOf, TRANSITIONS, type Anim, type El, type Transition } from '../../slides/model.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import Icon from '../Icon.svelte';
	import Menu from '../Menu.svelte';
	import SlideView from './SlideView.svelte';

	let { deck, onclose }: { deck: Deck; onclose: () => void } = $props();

	const slide = $derived(deck.slide);
	const tr = $derived<Transition>(slide.transition ?? { type: 'none', dur: 500 });
	const anims = $derived(slide.anims ?? []);
	const steps = $derived(animSteps(slide));
	const DIRS = ['l', 'r', 'u', 'd'] as const;
	const imported = $derived(!!slide.timingXml && slide.animsFrom === JSON.stringify(slide.anims ?? []));

	function label(el: El | undefined) {
		if (!el) return '—';
		const kind = el.kind === 'shape' && (el.textbox || el.ph) ? t().slides.textbox : t().slides.kinds[el.kind];
		const text = el.kind === 'shape' ? textOf(el.text).trim().slice(0, 28) : el.kind === 'icon' ? el.icon : el.kind === 'chart' ? (el.options.title ?? '') : '';
		return text ? `${kind}: ${text}` : (el.name ?? kind);
	}

	const setTr = (p: Partial<Transition>) => deck.setTransition({ ...tr, ...p });

	// ---------- Preview ----------
	let pv = $state<{ step: number; entering: Map<string, Anim> } | null>(null);
	let timers: ReturnType<typeof setTimeout>[] = [];
	function preview() {
		stop();
		const total = steps.steps;
		const run = (step: number) => {
			if (step > total) {
				timers.push(setTimeout(() => (pv = null), 900));
				return;
			}
			const { entering, length } = stepTimeline(slide, step);
			pv = { step, entering };
			timers.push(setTimeout(() => run(step + 1), length + 600));
		};
		pv = { step: 0, entering: new Map() };
		timers.push(setTimeout(() => run(1), 400));
	}
	function stop() {
		timers.forEach(clearTimeout);
		timers = [];
		pv = null;
	}
	onDestroy(stop);
	const pvScale = $derived(296 / deck.content.size.w);
</script>

<aside class="no-print flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface" aria-label={t().slides.motion}>
	<div class="flex items-center gap-2 border-b border-line px-3 py-2">
		<h2 class="flex-1 text-sm font-semibold">{t().slides.motion}</h2>
		<button class="tb" aria-label={t().common.close} title={t().common.close} onclick={onclose}><Icon name="x" /></button>
	</div>

	<div class="p-3">
		<div class="overflow-hidden rounded ring-1 ring-line">
			<SlideView content={deck.content} {slide} scale={pvScale} thumb hiddenIds={pv ? hiddenAt(slide, pv.step) : null} entering={pv?.entering ?? null} />
		</div>
		<button class="btn mt-2 w-full justify-center" disabled={!anims.length} onclick={() => (pv ? stop() : preview())}><Icon name="play" size={14} />{t().slides.preview}</button>
	</div>

	<section class="border-t border-line p-3 text-sm">
		<h3 class="mb-2 text-xs font-medium text-muted">{t().slides.transition}</h3>
		<div class="grid grid-cols-2 gap-2">
			<select class="select col-span-2" aria-label={t().slides.transition} value={tr.type} onchange={(e) => setTr({ type: (e.currentTarget as HTMLSelectElement).value as Transition['type'] })}>
				{#each TRANSITIONS as k (k)}<option value={k}>{t().slides.transitions[k]}</option>{/each}
			</select>
			{#if tr.type === 'push' || tr.type === 'wipe' || tr.type === 'cover'}
				<label class="col-span-2 flex items-center gap-2"
					><span class="w-24 text-muted">{t().slides.direction}</span>
					<select class="select flex-1" value={tr.dir ?? 'r'} onchange={(e) => setTr({ dir: (e.currentTarget as HTMLSelectElement).value as 'l' })}>
						{#each DIRS as d (d)}<option value={d}>{t().slides.dirs[d]}</option>{/each}
					</select></label
				>
			{/if}
			{#if tr.type !== 'none'}
				<label class="col-span-2 flex items-center gap-2"
					><span class="w-24 text-muted">{t().slides.duration}</span>
					<input class="input w-20" type="number" min="0.1" max="10" step="0.1" value={tr.dur / 1000} onchange={(e) => setTr({ dur: Math.round(Math.max(0.1, Number((e.currentTarget as HTMLInputElement).value) || 0.5) * 1000) })} /></label
				>
			{/if}
			<button class="btn col-span-2 justify-center" onclick={() => deck.setTransition(tr.type === 'none' ? undefined : tr, true)}>{t().slides.applyAll}</button>
		</div>
	</section>

	<section class="border-t border-line p-3 text-sm">
		<div class="mb-2 flex items-center gap-2">
			<h3 class="flex-1 text-xs font-medium text-muted">{t().slides.animations}</h3>
			<Menu label={t().slides.addAnim} triggerClass="btn !py-0.5 text-xs" disabled={!deck.selection.length}>
				{#snippet children(close)}
					{#each ANIM_EFFECTS as k (k)}<button class="menu-item" onclick={() => (close(), deck.addAnim(k))}>{t().slides.anims[k]}</button>{/each}
				{/snippet}
			</Menu>
		</div>
		{#if imported}<p class="mb-2 rounded bg-surface-2 p-2 text-xs text-muted">{t().slides.importedAnims}</p>{/if}
		{#if !anims.length}
			<p class="text-xs text-muted">{deck.selection.length ? t().slides.noAnims : t().slides.selectToAnimate}</p>
		{/if}
		<ol class="space-y-2">
			{#each anims as a, i (a.id)}
				{@const el = slide.elements.find((e) => e.id === a.el)}
				<li class="rounded border p-2 {deck.selection.includes(a.el) ? 'border-accent' : 'border-line'}">
					<div class="mb-1.5 flex items-center gap-1">
						<span class="w-5 text-xs text-faint tabular-nums">{a.trigger === 'click' || i === 0 ? steps.stepOf.get(a.id) : ''}</span>
						<button class="min-w-0 flex-1 truncate text-left text-xs font-medium hover:underline" onclick={() => (deck.selection = [a.el])}>{label(el)}</button>
						<button class="tb !p-0.5" aria-label={t().slides.moveUp} title={t().slides.moveUp} disabled={i === 0} onclick={() => deck.moveAnim(a.id, -1)}><Icon name="chevronUp" size={14} /></button>
						<button class="tb !p-0.5" aria-label={t().slides.moveDown} title={t().slides.moveDown} disabled={i === anims.length - 1} onclick={() => deck.moveAnim(a.id, 1)}><Icon name="chevronDown" size={14} /></button>
						<button class="tb !p-0.5 hover:text-bad" aria-label={t().common.delete} title={t().common.delete} onclick={() => deck.removeAnim(a.id)}><Icon name="x" size={14} /></button>
					</div>
					<div class="grid grid-cols-2 gap-1.5">
						<select class="select text-xs" aria-label={t().slides.addAnim} value={a.effect} onchange={(e) => deck.updateAnim(a.id, { effect: (e.currentTarget as HTMLSelectElement).value as Anim['effect'] })}>
							{#each ANIM_EFFECTS as k (k)}<option value={k}>{t().slides.anims[k]}</option>{/each}
						</select>
						<select class="select text-xs" aria-label={t().slides.trigger} value={a.trigger} onchange={(e) => deck.updateAnim(a.id, { trigger: (e.currentTarget as HTMLSelectElement).value as Anim['trigger'] })}>
							{#each ['click', 'with', 'after'] as const as k (k)}<option value={k}>{t().slides.triggers[k]}</option>{/each}
						</select>
						{#if a.effect === 'fly' || a.effect === 'wipe'}
							<select class="select col-span-2 text-xs" aria-label={t().slides.direction} value={a.dir ?? 'd'} onchange={(e) => deck.updateAnim(a.id, { dir: (e.currentTarget as HTMLSelectElement).value as 'l' })}>
								{#each DIRS as d (d)}<option value={d}>{t().slides.dirs[d]}</option>{/each}
							</select>
						{/if}
						{#if a.effect !== 'appear'}
							<label class="flex items-center gap-1 text-xs text-muted"
								>{t().slides.duration}<input class="input w-full !px-1 text-xs" type="number" min="0.1" max="20" step="0.1" value={a.dur / 1000} onchange={(e) => deck.updateAnim(a.id, { dur: Math.round(Math.max(0.1, Number((e.currentTarget as HTMLInputElement).value) || 0.5) * 1000) })} /></label
							>
						{/if}
						<label class="flex items-center gap-1 text-xs text-muted"
							>{t().slides.delay}<input class="input w-full !px-1 text-xs" type="number" min="0" max="60" step="0.1" value={(a.delay ?? 0) / 1000} onchange={(e) => deck.updateAnim(a.id, { delay: Math.round(Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0) * 1000) })} /></label
						>
					</div>
				</li>
			{/each}
		</ol>
	</section>
</aside>
