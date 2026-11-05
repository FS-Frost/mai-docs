<script lang="ts">
	// Dropdown menu anchored to its trigger. Closes on outside click, Escape, or after choosing an item.
	// Usage: <Menu label="File">{#snippet children(close)} <button class="menu-item" onclick={...}>…</button> {/snippet}</Menu>
	import type { Snippet } from 'svelte';

	let {
		label,
		title,
		children,
		align = 'left',
		triggerClass = 'tb gap-1 px-2',
		disabled = false,
		icon
	}: {
		label?: string;
		title?: string;
		children: Snippet<[() => void]>;
		align?: 'left' | 'right';
		triggerClass?: string;
		disabled?: boolean;
		icon?: Snippet;
	} = $props();

	let open = $state(false);
	let root = $state<HTMLDivElement>();
	let panel = $state<HTMLDivElement>();
	let pos = $state({ top: 0, left: 0, maxH: 400 });

	const close = () => (open = false);

	function toggle() {
		open = !open;
		if (open) queueMicrotask(place);
	}

	function place() {
		if (!root) return;
		const r = root.getBoundingClientRect();
		const w = panel?.offsetWidth ?? 200;
		let left = align === 'right' ? r.right - w : r.left;
		left = Math.max(8, Math.min(left, innerWidth - w - 8));
		const top = r.bottom + 4;
		pos = { top, left, maxH: Math.max(160, innerHeight - top - 8) };
		(panel?.querySelector('button:not([disabled]),input,select') as HTMLElement | null)?.focus();
	}

	$effect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			if (!root?.contains(e.target as Node) && !panel?.contains(e.target as Node)) close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				close();
				(root?.querySelector('button') as HTMLElement | null)?.focus();
			}
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				const items = [...(panel?.querySelectorAll<HTMLElement>('.menu-item:not([disabled])') ?? [])];
				if (!items.length) return;
				e.preventDefault();
				const i = items.indexOf(document.activeElement as HTMLElement);
				items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
			}
		};
		addEventListener('pointerdown', onDown, true);
		addEventListener('keydown', onKey);
		addEventListener('resize', close);
		return () => {
			removeEventListener('pointerdown', onDown, true);
			removeEventListener('keydown', onKey);
			removeEventListener('resize', close);
		};
	});
</script>

<div bind:this={root} class="relative inline-flex">
	<button type="button" class={triggerClass} aria-haspopup="menu" aria-expanded={open} {title} aria-label={title ?? label} {disabled} onclick={toggle} onmousedown={(e) => e.preventDefault()}>
		{#if icon}{@render icon()}{/if}
		{#if label}<span>{label}</span>{/if}
		<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" class="opacity-60"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
	</button>
</div>
{#if open}
	<div
		bind:this={panel}
		class="menu fixed overflow-y-auto"
		role="menu"
		tabindex="-1"
		style="top:{pos.top}px;left:{pos.left}px;max-height:{pos.maxH}px"
		onmousedown={(e) => {
			// Keep editor selection: only inputs may take focus.
			if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) e.preventDefault();
		}}
	>
		{@render children(close)}
	</div>
{/if}
