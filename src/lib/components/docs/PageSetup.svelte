<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageSetup, PageSize } from '../../docs/model.ts';
	import { t } from '../../i18n/index.svelte.ts';

	let { page, onapply, onclose }: { page: PageSetup; onapply: (p: PageSetup) => void; onclose: () => void } = $props();

	let draft = $state<PageSetup>(untrack(() => structuredClone($state.snapshot(page)) as PageSetup));
	const SIZES: PageSize[] = ['A4', 'Letter', 'Legal'];
	const SIDES = ['top', 'bottom', 'left', 'right'] as const;

	function submit(e: Event) {
		e.preventDefault();
		for (const s of SIDES) draft.margins[s] = Math.max(0, Math.min(100, Number(draft.margins[s]) || 0));
		onapply(draft);
		onclose();
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
	<div class="w-full max-w-sm" role="dialog" aria-modal="true" aria-labelledby="ps-title">
		<form class="rounded-xl border border-line bg-surface p-5 shadow-2xl" onsubmit={submit}>
			<h2 id="ps-title" class="mb-4 font-semibold">{t().doc.pageSetup}</h2>
			<label class="mb-3 block text-sm">
				<span class="mb-1 block text-muted">{t().doc.pageSize}</span>
				<select class="select w-full" bind:value={draft.size}>
					{#each SIZES as s (s)}<option value={s}>{s === 'Letter' ? 'Letter / Carta' : s === 'Legal' ? 'Legal / Oficio' : s}</option>{/each}
				</select>
			</label>
			<fieldset class="mb-3 text-sm">
				<legend class="mb-1 text-muted">{t().doc.orientation}</legend>
				<div class="flex gap-4">
					<label class="flex items-center gap-1.5"><input type="radio" bind:group={draft.orientation} value="portrait" />{t().doc.portrait}</label>
					<label class="flex items-center gap-1.5"><input type="radio" bind:group={draft.orientation} value="landscape" />{t().doc.landscape}</label>
				</div>
			</fieldset>
			<fieldset class="text-sm">
				<legend class="mb-1 text-muted">{t().doc.margins}</legend>
				<div class="grid grid-cols-2 gap-2">
					{#each SIDES as s (s)}
						<label class="flex items-center justify-between gap-2">
							<span>{t().doc[s]}</span>
							<input class="input w-20 text-right" type="number" min="0" max="100" step="0.1" bind:value={draft.margins[s]} />
						</label>
					{/each}
				</div>
			</fieldset>
			<div class="mt-5 flex justify-end gap-2">
				<button type="button" class="btn" onclick={onclose}>{t().common.cancel}</button>
				<button type="submit" class="btn btn-primary">{t().common.apply}</button>
			</div>
		</form>
	</div>
</div>
