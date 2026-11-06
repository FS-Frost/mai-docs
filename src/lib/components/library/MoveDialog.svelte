<script lang="ts">
	// "Move to…": pick a destination folder in the live tree. Folders being moved (and their subtrees) are disabled.
	import { t } from '../../i18n/index.svelte.ts';
	import type { Folder } from '../../storage/db.ts';
	import { flatTree, folderMap, isWithin } from '../../storage/tree.ts';
	import Icon from '../Icon.svelte';

	let {
		folders,
		moving,
		current,
		onpick,
		onclose
	}: { folders: Folder[]; moving: string[]; current: string | undefined; onpick: (target: string | undefined) => void; onclose: () => void } = $props();

	const tree = $derived(flatTree(folders));
	const map = $derived(folderMap(folders));
	const blocked = (id: string) => moving.some((m) => isWithin(map, id, m));
	// '' = root
	let target = $state<string>('');
	$effect(() => {
		target = current ?? '';
	});
	let dlg = $state<HTMLDivElement>();
	$effect(() => {
		queueMicrotask(() => dlg?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (e.preventDefault(), onclose())} />

<div class="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
	<div bind:this={dlg} class="flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl border border-line bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="move-title">
		<h2 id="move-title" class="px-5 pt-4 pb-2 font-medium">{t().library.moveTo}</h2>
		<div class="min-h-0 flex-1 overflow-y-auto px-2" role="radiogroup" aria-labelledby="move-title">
			<button role="radio" aria-checked={target === ''} class="menu-item w-full {target === '' ? 'bg-accent-soft text-accent' : ''}" onclick={() => (target = '')} ondblclick={() => onpick(undefined)}>
				<Icon name="open" size={16} />{t().library.title}
			</button>
			{#each tree as { folder, depth } (folder.id)}
				<button
					role="radio"
					aria-checked={target === folder.id}
					disabled={blocked(folder.id)}
					class="menu-item w-full {target === folder.id ? 'bg-accent-soft text-accent' : ''}"
					style="padding-left:{0.75 + (depth + 1) * 1.1}rem"
					onclick={() => (target = folder.id)}
					ondblclick={() => onpick(folder.id)}
				>
					<Icon name="folder" size={16} /><span class="truncate">{folder.name}</span>
				</button>
			{/each}
		</div>
		<div class="flex justify-end gap-2 border-t border-line px-5 py-3">
			<button type="button" class="btn" onclick={onclose}>{t().common.cancel}</button>
			<button type="button" class="btn btn-primary" disabled={(target || undefined) === current} onclick={() => onpick(target || undefined)}>{t().library.moveHere}</button>
		</div>
	</div>
</div>
