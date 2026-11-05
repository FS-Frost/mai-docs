<script lang="ts">
	// Palette + custom color, used inside a Menu. `onpick(null)` = remove color.
	import { t } from '../i18n/index.svelte.ts';

	let { onpick, close }: { onpick: (c: string | null) => void; close: () => void } = $props();

	const PALETTE = [
		'#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#d9d9d9', '#efefef', '#ffffff',
		'#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff',
		'#9900ff', '#ff00ff', '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3',
		'#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc', '#cc4125', '#e06666', '#f6b26b', '#ffd966',
		'#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0', '#a61c00', '#cc0000',
		'#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'
	];

	const pick = (c: string | null) => {
		onpick(c);
		close();
	};
</script>

<div class="p-2">
	<button class="menu-item mb-1 rounded" onclick={() => pick(null)}>
		<span class="inline-block size-4 rounded border border-line bg-[linear-gradient(135deg,transparent_45%,#d33_45%,#d33_55%,transparent_55%)]"></span>
		{t().doc.noColor}
	</button>
	<div class="grid grid-cols-8 gap-1">
		{#each PALETTE as c (c)}
			<button class="size-5 rounded-sm border border-black/10 hover:scale-110" style="background:{c}" title={c} aria-label={c} onclick={() => pick(c)}></button>
		{/each}
	</div>
	<label class="mt-2 flex items-center gap-2 text-xs text-muted">
		<input type="color" class="h-6 w-10 cursor-pointer rounded border border-line bg-transparent" onchange={(e) => pick((e.currentTarget as HTMLInputElement).value)} />
		…
	</label>
</div>
