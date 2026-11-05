<script lang="ts">
	// Pick a built-in theme, then fine-tune colors and fonts; slide size 16:9 / 4:3.
	import type { Deck } from '../../slides/deck.svelte.ts';
	import { SIZES, THEME_COLORS, cssFill, type Theme } from '../../slides/model.ts';
	import { THEMES } from '../../slides/themes.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import Icon from '../Icon.svelte';

	let { deck, onclose }: { deck: Deck; onclose: () => void } = $props();

	const FONTS = ['Arial', 'Calibri', 'Cambria', 'Georgia', 'Helvetica', 'Palatino Linotype', 'Segoe UI', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Courier New'];
	const cur = $derived(deck.content.theme);
	const setTheme = (th: Theme) => deck.setTheme(structuredClone(th));
	const patch = (p: Partial<Theme>) => deck.setTheme({ ...cur, ...p, id: cur.id });
	const ratio = $derived(deck.content.size.w / deck.content.size.h > 1.5 ? '16:9' : '4:3');
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
	<div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="th-title">
		<div class="mb-4 flex items-center">
			<h2 id="th-title" class="flex-1 font-semibold">{t().slides.theme}</h2>
			<button class="tb" aria-label={t().common.close} onclick={onclose}><Icon name="x" /></button>
		</div>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each THEMES as th (th.id)}
				<button class="overflow-hidden rounded-lg border-2 text-left {cur.id === th.id ? 'border-accent' : 'border-line hover:border-faint'}" onclick={() => setTheme(th)} aria-pressed={cur.id === th.id}>
					<div class="flex aspect-video flex-col justify-center gap-1 p-2" style="background:{cssFill(th, th.background)}">
						<div class="truncate text-sm font-bold" style="color:{th.colors.dk1};font-family:'{th.fonts.major}'">Aa</div>
						<div class="flex gap-0.5">{#each ['accent1', 'accent2', 'accent3', 'accent4'] as c (c)}<span class="h-2 w-4 rounded-sm" style="background:{th.colors[c as 'accent1']}"></span>{/each}</div>
					</div>
					<div class="truncate px-2 py-1 text-xs">{th.name}</div>
				</button>
			{/each}
		</div>
		<h3 class="mt-5 mb-2 text-sm font-medium">{t().slides.editTheme}</h3>
		<div class="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
			{#each THEME_COLORS as c (c)}
				<label class="flex items-center gap-2 text-sm">
					<input type="color" class="h-6 w-8 cursor-pointer rounded border border-line bg-transparent" value={cur.colors[c]} onchange={(e) => patch({ colors: { ...cur.colors, [c]: (e.currentTarget as HTMLInputElement).value } })} />
					{t().slides.colorNames[c]}
				</label>
			{/each}
		</div>
		<div class="mt-3 grid gap-3 sm:grid-cols-2">
			<label class="text-sm">
				<span class="mb-1 block text-muted">{t().slides.headingFont}</span>
				<select class="select w-full" value={cur.fonts.major} onchange={(e) => patch({ fonts: { ...cur.fonts, major: (e.currentTarget as HTMLSelectElement).value } })}>
					{#each [...new Set([cur.fonts.major, ...FONTS])] as f (f)}<option value={f}>{f}</option>{/each}
				</select>
			</label>
			<label class="text-sm">
				<span class="mb-1 block text-muted">{t().slides.bodyFont}</span>
				<select class="select w-full" value={cur.fonts.minor} onchange={(e) => patch({ fonts: { ...cur.fonts, minor: (e.currentTarget as HTMLSelectElement).value } })}>
					{#each [...new Set([cur.fonts.minor, ...FONTS])] as f (f)}<option value={f}>{f}</option>{/each}
				</select>
			</label>
		</div>
		<h3 class="mt-5 mb-2 text-sm font-medium">{t().slides.size}</h3>
		<div class="flex gap-2">
			<button class="btn {ratio === '16:9' ? '!border-accent !bg-accent-soft !text-accent' : ''}" onclick={() => deck.setSize(SIZES['16:9'].w, SIZES['16:9'].h)}>{t().slides.size169}</button>
			<button class="btn {ratio === '4:3' ? '!border-accent !bg-accent-soft !text-accent' : ''}" onclick={() => deck.setSize(SIZES['4:3'].w, SIZES['4:3'].h)}>{t().slides.size43}</button>
		</div>
	</div>
</div>
