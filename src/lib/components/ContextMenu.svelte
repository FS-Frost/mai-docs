<script lang="ts" module>
	export type MenuAt = { x: number; y: number };
</script>

<script lang="ts">
	// Context menu at a point (right click / long press). Kept inside the viewport; closes on outside pointer,
	// Escape, scroll, resize, blur, or after an item runs (call close()). Arrow keys move between items.
	import type { Snippet } from 'svelte';

	let { at, onclose, children, label }: { at: MenuAt | null; onclose: () => void; children: Snippet<[() => void]>; label?: string } = $props();

	let panel = $state<HTMLDivElement>();
	let pos = $state({ left: 0, top: 0, maxH: 400 });
	let opener: HTMLElement | null = null;

	function close() {
		onclose();
		opener?.focus({ preventScroll: true });
	}

	$effect(() => {
		if (!at) return;
		opener = document.activeElement as HTMLElement | null;
		const { x, y } = at;
		pos = { left: x, top: y, maxH: innerHeight - 16 };
		// Place after layout: flip left/up when the panel would leave the viewport.
		queueMicrotask(() => {
			if (!panel) return;
			const w = panel.offsetWidth;
			const h = panel.offsetHeight;
			const left = x + w + 8 > innerWidth ? Math.max(8, x - w) : x;
			const top = y + h + 8 > innerHeight ? Math.max(8, Math.min(y - h, innerHeight - h - 8)) : y;
			pos = { left, top, maxH: innerHeight - 16 };
			panel.querySelector<HTMLElement>('.menu-item:not([disabled])')?.focus({ preventScroll: true });
		});
		const onDown = (e: PointerEvent) => {
			if (!panel?.contains(e.target as Node)) onclose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				close();
				return;
			}
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
				const items = [...(panel?.querySelectorAll<HTMLElement>('.menu-item:not([disabled])') ?? [])];
				if (!items.length) return;
				e.preventDefault();
				const i = items.indexOf(document.activeElement as HTMLElement);
				const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
				items[next].focus();
			}
		};
		const onScroll = (e: Event) => {
			if (!panel?.contains(e.target as Node)) onclose();
		};
		addEventListener('pointerdown', onDown, true);
		addEventListener('keydown', onKey, true);
		addEventListener('scroll', onScroll, true);
		addEventListener('resize', onclose);
		addEventListener('blur', onclose);
		return () => {
			removeEventListener('pointerdown', onDown, true);
			removeEventListener('keydown', onKey, true);
			removeEventListener('scroll', onScroll, true);
			removeEventListener('resize', onclose);
			removeEventListener('blur', onclose);
		};
	});
</script>

{#if at}
	<div
		bind:this={panel}
		class="menu fixed z-50 overflow-y-auto"
		role="menu"
		tabindex="-1"
		aria-label={label}
		style="left:{pos.left}px;top:{pos.top}px;max-height:{pos.maxH}px"
		oncontextmenu={(e) => e.preventDefault()}
		onmousedown={(e) => {
			// Keep the editor selection: only inputs may take focus.
			if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) e.preventDefault();
		}}
	>
		{@render children(close)}
	</div>
{/if}
