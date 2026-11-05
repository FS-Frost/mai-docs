<script lang="ts">
	// Floating images and charts of one grid pane, in content coordinates (the pane translates for scroll).
	// Drag to move, handles to resize (corners keep the aspect ratio of images; Shift frees it),
	// double-click a chart to edit it. Changes are committed on pointerup (one undo step).
	import type { SvelteMap } from 'svelte/reactivity';
	import type { Axis } from '../../sheets/layout.ts';
	import type { ChartData } from '../../sheets/charts.ts';
	import type { SheetObject } from '../../sheets/model.ts';
	import { anchorXY, xyAnchor } from '../../sheets/objects.ts';
	import type { SheetView } from '../../sheets/view.svelte.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import ChartView from '../charts/ChartView.svelte';

	let {
		view,
		objects,
		rows,
		cols,
		readonly,
		urls,
		dataFor
	}: { view: SheetView; objects: SheetObject[]; rows: Axis; cols: Axis; readonly: boolean; urls: SvelteMap<string, string>; dataFor: (o: SheetObject) => ChartData } = $props();

	type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
	type Drag = { id: string; mode: 'move' | Dir; x0: number; y0: number; moved: boolean; shift: boolean; ratio: number; pointer: number };
	let drag = $state<{ id: string; dx: number; dy: number; dw: number; dh: number } | null>(null);
	let d: Drag | null = null;

	const MIN = 16;

	function start(e: PointerEvent, o: SheetObject, mode: Drag['mode']) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		if (view.edit) view.commit();
		view.object = o.id;
		view.focusTick++;
		if (readonly) return;
		d = { id: o.id, mode, x0: e.clientX, y0: e.clientY, moved: false, shift: e.shiftKey, ratio: o.w / Math.max(1, o.h), pointer: e.pointerId };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { id: o.id, dx: 0, dy: 0, dw: 0, dh: 0 };
	}

	function move(e: PointerEvent, o: SheetObject) {
		if (!d || d.pointer !== e.pointerId || d.id !== o.id) return;
		let dx = e.clientX - d.x0;
		let dy = e.clientY - d.y0;
		if (!d.moved && Math.hypot(dx, dy) < 3) return;
		d.moved = true;
		if (d.mode === 'move') {
			drag = { id: o.id, dx, dy, dw: 0, dh: 0 };
			return;
		}
		const m = d.mode;
		let nx = 0;
		let ny = 0;
		let dw = 0;
		let dh = 0;
		if (m.includes('e')) dw = dx;
		if (m.includes('w')) {
			dw = -dx;
			nx = dx;
		}
		if (m.includes('s')) dh = dy;
		if (m.includes('n')) {
			dh = -dy;
			ny = dy;
		}
		// Clamp to a minimum size.
		if (o.w + dw < MIN) {
			if (m.includes('w')) nx -= MIN - (o.w + dw);
			dw = MIN - o.w;
		}
		if (o.h + dh < MIN) {
			if (m.includes('n')) ny -= MIN - (o.h + dh);
			dh = MIN - o.h;
		}
		// Corners keep the ratio for images (Shift frees it).
		if (o.kind === 'image' && m.length === 2 && !e.shiftKey) {
			const w = o.w + dw;
			const h = Math.round(w / d.ratio);
			if (m.includes('n')) ny += o.h + dh - h;
			dh = h - o.h;
		}
		drag = { id: o.id, dx: nx, dy: ny, dw, dh };
	}

	function end(e: PointerEvent, o: SheetObject) {
		if (!d || d.pointer !== e.pointerId) return;
		const moved = d.moved;
		d = null;
		const g = drag;
		drag = null;
		if (!moved || !g) return;
		const p = anchorXY(o.anchor, rows, cols);
		view.book.updateObject(view.sheet.id, o.id, { anchor: xyAnchor(p.x + g.dx, p.y + g.dy, rows, cols), w: Math.round(o.w + g.dw), h: Math.round(o.h + g.dh) });
	}

	const DIRS: Dir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
	const handlePos = (dir: Dir) => {
		const x = dir.includes('w') ? '0%' : dir.includes('e') ? '100%' : '50%';
		const y = dir.includes('n') ? '0%' : dir.includes('s') ? '100%' : '50%';
		return `left:${x};top:${y}`;
	};
	const CURSOR: Record<Dir, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
</script>

{#each objects as o (o.id)}
	{@const p = anchorXY(o.anchor, rows, cols)}
	{@const g = drag?.id === o.id ? drag : null}
	{@const sel = view.object === o.id}
	<div
		data-object
		class="absolute z-[5] {readonly ? '' : 'cursor-move'} {sel ? 'outline-2 outline-sel' : ''}"
		style="left:{p.x + (g?.dx ?? 0)}px;top:{p.y + (g?.dy ?? 0)}px;width:{o.w + (g?.dw ?? 0)}px;height:{o.h + (g?.dh ?? 0)}px"
		role={o.kind === 'image' ? 'img' : 'figure'}
		aria-label={o.kind === 'image' ? o.alt || t().object.image : o.title || t().chart.chart}
		onpointerdown={(e) => start(e, o, 'move')}
		onpointermove={(e) => move(e, o)}
		onpointerup={(e) => end(e, o)}
		onpointercancel={(e) => end(e, o)}
		ondblclick={(e) => {
			e.stopPropagation();
			if (o.kind === 'chart' && !readonly) view.editingChart = o.id;
		}}
	>
		{#if o.kind === 'image'}
			{@const url = urls.get(o.blobId)}
			{#if url}<img src={url} alt={o.alt ?? ''} draggable="false" class="pointer-events-none h-full w-full select-none" />{:else}<div class="h-full w-full bg-surface-2"></div>{/if}
		{:else}
			<div class="pointer-events-none h-full w-full rounded border border-line bg-surface shadow-sm">
				<ChartView options={o} data={dataFor(o)} />
			</div>
		{/if}
		{#if sel && !readonly}
			{#each DIRS as dir (dir)}
				<span
					class="absolute z-[6] size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface bg-sel"
					style="{handlePos(dir)};cursor:{CURSOR[dir]}"
					onpointerdown={(e) => start(e, o, dir)}
					onpointermove={(e) => move(e, o)}
					onpointerup={(e) => end(e, o)}
					onpointercancel={(e) => end(e, o)}
					role="presentation"
				></span>
			{/each}
		{/if}
	</div>
{/each}
