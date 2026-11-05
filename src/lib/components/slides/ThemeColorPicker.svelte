<script lang="ts">
	// Theme colors (stay linked to the theme) + generic palette. onpick(null) = none.
	import ColorPicker from '../ColorPicker.svelte';
	import { THEME_COLORS, type Theme } from '../../slides/model.ts';
	import { t } from '../../i18n/index.svelte.ts';

	let { theme, onpick, close, allowNone = true }: { theme: Theme; onpick: (c: string | null) => void; close: () => void; allowNone?: boolean } = $props();
	const roles = THEME_COLORS.filter((c) => c !== 'hlink');
</script>

<div class="px-2 pt-2">
	<p class="mb-1 text-xs text-muted">{t().slides.themeColors}</p>
	<div class="grid grid-cols-10 gap-1">
		{#each roles as r (r)}
			<button class="size-5 rounded-sm border border-black/15 hover:scale-110" style="background:{theme.colors[r]}" title={t().slides.colorNames[r]} aria-label={t().slides.colorNames[r]} onclick={() => (onpick(r), close())}></button>
		{/each}
	</div>
</div>
{#if allowNone}
	<ColorPicker {close} {onpick} />
{:else}
	<ColorPicker {close} onpick={(c) => c && onpick(c)} />
{/if}
