<script lang="ts">
	// Editable slide. Pointer math happens in logical slide coordinates (px at 96 dpi); the view is scaled to fit.
	// Drags commit with a coalescing key, so one gesture = one undo step.
	import { onMount } from 'svelte';
	import type { Deck } from '../../slides/deck.svelte.ts';
	import { snapRect, intersects, union, type Guide, type Rect } from '../../slides/geometry.ts';
	import { uid, type ChartEl, type El, type MediaEl, type ShapeEl } from '../../slides/model.ts';
	import { cellAt, cellBox, expand, scaleTable, setCells } from '../../slides/table.ts';
	import { fitSize, prepareImage } from '../../files/images.ts';
	import { isMedia, mediaKind, mediaMime, MAX_MEDIA_BYTES, videoPoster } from '../../files/media.ts';
	import { putBlob } from '../../storage/blobs.ts';
	import { textDoc } from '../../slides/model.ts';
	import { toast } from '../../client/toast.svelte.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import SlideView from './SlideView.svelte';
	import TextEditorBox from './TextEditorBox.svelte';
	import CanvasMenu from './CanvasMenu.svelte';
	import type { MenuAt } from '../ContextMenu.svelte';

	let {
		deck,
		fileId,
		readonly = false,
		oneditchart,
		onmotion,
		ontheme,
		onreplaceicon
	}: {
		deck: Deck;
		fileId: string;
		readonly?: boolean;
		oneditchart?: (el: ChartEl) => void;
		onmotion?: () => void;
		ontheme?: () => void;
		onreplaceicon?: (id: string) => void;
	} = $props();

	let host = $state<HTMLDivElement>();
	let box = $state({ w: 800, h: 450 });
	const size = $derived(deck.content.size);
	const scale = $derived(Math.max(0.05, Math.min((box.w - 48) / size.w, (box.h - 48) / size.h)));
	const slide = $derived(deck.slide);
	const theme = $derived(deck.content.theme);

	onMount(() => {
		const ro = new ResizeObserver(() => {
			if (host) box = { w: host.clientWidth, h: host.clientHeight };
		});
		if (host) ro.observe(host);
		return () => ro.disconnect();
	});

	let surface = $state<HTMLDivElement>();
	const toLogical = (e: { clientX: number; clientY: number }) => {
		const r = surface!.getBoundingClientRect();
		return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
	};

	// ---------- Drag state ----------

	type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
	type Drag =
		| { kind: 'move'; start: { x: number; y: number }; orig: Map<string, Rect>; key: string; moved: boolean; pointer: number }
		| { kind: 'resize'; dir: Dir; start: { x: number; y: number }; orig: El; key: string; pointer: number }
		| { kind: 'rotate'; center: { x: number; y: number }; orig: number; key: string; pointer: number }
		| { kind: 'marquee'; start: { x: number; y: number }; base: string[]; pointer: number }
		| { kind: 'cells'; table: string; r: number; c: number; pointer: number };
	let drag: Drag | null = null;
	let guides = $state<Guide[]>([]);
	let marquee = $state<Rect | null>(null);

	function capture(e: PointerEvent) {
		surface?.setPointerCapture(e.pointerId);
	}

	function downElement(e: PointerEvent, el: El) {
		if (e.button !== 0) return;
		e.stopPropagation();
		host?.focus({ preventScroll: true });
		if (deck.editing === el.id) return;
		if (deck.editing) deck.stopEditing();
		// A selected table takes clicks as cell selection (drag = range, Shift = extend).
		if (el.kind === 'table' && deck.selection.length === 1 && deck.selection[0] === el.id) {
			const p = toLogical(e);
			const hit = cellAt(el, p.x - el.x, p.y - el.y);
			if (hit) {
				if (e.shiftKey && deck.cellSel) deck.cellSel = expand(el, { ...deck.cellSel, r2: hit.r, c2: hit.c });
				else deck.cellSel = { r1: hit.r, c1: hit.c, r2: hit.r, c2: hit.c };
				drag = { kind: 'cells', table: el.id, r: deck.cellSel.r1, c: deck.cellSel.c1, pointer: e.pointerId };
				capture(e);
				return;
			}
		}
		deck.cellSel = null;
		if (e.shiftKey || e.ctrlKey || e.metaKey) {
			deck.selection = deck.selection.includes(el.id) ? deck.selection.filter((s) => s !== el.id) : [...deck.selection, el.id];
			return;
		}
		if (!deck.selection.includes(el.id)) deck.selection = [el.id];
		if (readonly) return;
		const orig = new Map(deck.selected.map((s) => [s.id, { x: s.x, y: s.y, w: s.w, h: s.h }]));
		drag = { kind: 'move', start: toLogical(e), orig, key: `move:${uid()}`, moved: false, pointer: e.pointerId };
		capture(e);
	}

	function downSurface(e: PointerEvent) {
		if (e.button !== 0) return;
		host?.focus({ preventScroll: true });
		if (deck.editing) deck.stopEditing();
		deck.cellSel = null;
		const base = e.shiftKey ? [...deck.selection] : [];
		deck.selection = base;
		drag = { kind: 'marquee', start: toLogical(e), base, pointer: e.pointerId };
		capture(e);
	}

	function downHandle(e: PointerEvent, dir: Dir) {
		e.stopPropagation();
		const el = deck.selected[0];
		if (!el || readonly) return;
		drag = { kind: 'resize', dir, start: toLogical(e), orig: structuredClone($state.snapshot(el)) as El, key: `resize:${uid()}`, pointer: e.pointerId };
		capture(e);
	}

	function downRotate(e: PointerEvent) {
		e.stopPropagation();
		const el = deck.selected[0];
		if (!el || readonly) return;
		drag = { kind: 'rotate', center: { x: el.x + el.w / 2, y: el.y + el.h / 2 }, orig: el.rot, key: `rotate:${uid()}`, pointer: e.pointerId };
		capture(e);
	}

	function move(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointer) return;
		const p = toLogical(e);
		if (drag.kind === 'move') {
			let dx = p.x - drag.start.x;
			let dy = p.y - drag.start.y;
			if (!drag.moved && Math.hypot(dx, dy) * scale < 3) return;
			drag.moved = true;
			const moved = union([...drag.orig.values()].map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })));
			if (!e.altKey) {
				const ids = new Set(drag.orig.keys());
				const targets: Rect[] = [{ x: 0, y: 0, w: size.w, h: size.h }, ...slide.elements.filter((x) => !ids.has(x.id))];
				const s = snapRect(moved, targets, 6 / scale);
				dx += s.dx;
				dy += s.dy;
				guides = s.guides;
			} else guides = [];
			const orig = drag.orig;
			deck.updateElements([...orig.keys()], (el) => ({ ...el, x: Math.round(orig.get(el.id)!.x + dx), y: Math.round(orig.get(el.id)!.y + dy) }), drag.key);
		} else if (drag.kind === 'resize') {
			const o = drag.orig;
			const th = (o.rot * Math.PI) / 180;
			const cos = Math.cos(th);
			const sin = Math.sin(th);
			const gx = p.x - drag.start.x;
			const gy = p.y - drag.start.y;
			const ldx = gx * cos + gy * sin;
			const ldy = -gx * sin + gy * cos;
			const sx = drag.dir.includes('e') ? 1 : drag.dir.includes('w') ? -1 : 0;
			const sy = drag.dir.includes('s') ? 1 : drag.dir.includes('n') ? -1 : 0;
			let nw = Math.max(8, o.w + sx * ldx);
			let nh = Math.max(o.kind === 'shape' && o.geom === 'line' ? 0 : 8, o.h + sy * ldy);
			const keepRatio = (sx && sy && (e.shiftKey || o.kind === 'image')) && !(o.kind === 'image' && e.shiftKey);
			if (keepRatio) {
				const r = o.w / Math.max(1, o.h);
				if (nw / r > nh) nh = nw / r;
				else nw = nh * r;
			}
			const lcx = (sx * (nw - o.w)) / 2;
			const lcy = (sy * (nh - o.h)) / 2;
			const cx = o.x + o.w / 2 + lcx * cos - lcy * sin;
			const cy = o.y + o.h / 2 + lcx * sin + lcy * cos;
			const box = { x: Math.round(cx - nw / 2), y: Math.round(cy - nh / 2), w: Math.round(nw), h: Math.round(nh) };
			if (o.kind === 'table') deck.updateElements([o.id], () => ({ ...scaleTable(o, box.w, box.h), x: box.x, y: box.y }), drag.key);
			else deck.patch([o.id], box, drag.key);
		} else if (drag.kind === 'rotate') {
			let a = (Math.atan2(p.y - drag.center.y, p.x - drag.center.x) * 180) / Math.PI + 90;
			if (e.shiftKey) a = Math.round(a / 15) * 15;
			else if (Math.abs(((a % 360) + 360) % 360) < 3 || Math.abs((((a % 360) + 360) % 360) - 360) < 3) a = 0;
			a = Math.round(((a % 360) + 360) % 360);
			deck.patch(deck.selection, { rot: a }, drag.key);
		} else if (drag.kind === 'cells') {
			const id = drag.table;
			const tb = slide.elements.find((x) => x.id === id);
			if (tb?.kind !== 'table') return;
			const hit = cellAt(tb, p.x - tb.x, p.y - tb.y);
			if (hit) deck.cellSel = expand(tb, { r1: drag.r, c1: drag.c, r2: hit.r, c2: hit.c });
		} else {
			const r = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
			marquee = r;
			const hit = slide.elements.filter((el) => !el.locked && intersects(r, el)).map((el) => el.id);
			deck.selection = [...new Set([...drag.base, ...hit])];
		}
	}

	function up(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointer) return;
		drag = null;
		guides = [];
		marquee = null;
	}

	/** Double-click resolves the element under the pointer (pointer capture retargets the event to the surface). */
	function dblSurface(e: MouseEvent) {
		const p = toLogical(e);
		const el = [...slide.elements].reverse().find((x) => !x.locked && p.x >= x.x && p.x <= x.x + x.w && p.y >= x.y && p.y <= x.y + Math.max(x.h, 8));
		if (el) dbl(e, el);
	}

	function dbl(e: MouseEvent, el: El) {
		e.stopPropagation();
		if (readonly) return;
		if (el.kind === 'chart') return oneditchart?.(el);
		if (el.kind === 'table') {
			const p = toLogical(e);
			const hit = cellAt(el, p.x - el.x, p.y - el.y);
			if (hit) startCell(el.id, hit.r, hit.c);
			return;
		}
		if (el.kind !== 'shape' || el.geom === 'line') return;
		deck.startEditing(el.id);
	}

	function startCell(id: string, r: number, c: number) {
		deck.cellSel = { r1: r, c1: c, r2: r, c2: c };
		deck.startEditing(id, `${r}:${c}`);
	}

	// ---------- Keyboard & clipboard ----------

	const MARK = 'mai-slides:';

	function key(e: KeyboardEvent) {
		if (deck.editing) return;
		const mod = e.ctrlKey || e.metaKey;
		const k = e.key;
		if (mod && k.toLowerCase() === 'z' && !e.shiftKey) {
			e.preventDefault();
			deck.undo();
			return;
		}
		if (mod && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) {
			e.preventDefault();
			deck.redo();
			return;
		}
		if (k === 'PageDown' || (!deck.selection.length && (k === 'ArrowDown' || k === 'ArrowRight'))) {
			e.preventDefault();
			deck.go(deck.current + 1);
			return;
		}
		if (k === 'PageUp' || (!deck.selection.length && (k === 'ArrowUp' || k === 'ArrowLeft'))) {
			e.preventDefault();
			deck.go(deck.current - 1);
			return;
		}
		if (k === 'Escape') {
			deck.selection = [];
			return;
		}
		if (mod && k.toLowerCase() === 'a') {
			e.preventDefault();
			deck.selection = slide.elements.filter((x) => !x.locked).map((x) => x.id);
			return;
		}
		if (readonly) return;
		const tsel = deck.cellSel && deck.selected[0]?.kind === 'table' ? deck.selected[0] : null;
		if (tsel && deck.cellSel && (k === 'Delete' || k === 'Backspace')) {
			e.preventDefault();
			const g = deck.cellSel;
			deck.updateTable(tsel.id, (tb) => setCells(tb, g, { text: undefined }));
			return;
		}
		if (tsel && deck.cellSel && (k === 'Enter' || k === 'F2')) {
			e.preventDefault();
			startCell(tsel.id, deck.cellSel.r1, deck.cellSel.c1);
			return;
		}
		if ((k === 'Delete' || k === 'Backspace') && deck.selection.length) {
			e.preventDefault();
			deck.removeSelected();
			return;
		}
		if (mod && k.toLowerCase() === 'd') {
			e.preventDefault();
			deck.duplicateSelected();
			return;
		}
		if (k.startsWith('Arrow') && deck.selection.length) {
			e.preventDefault();
			const step = e.shiftKey ? 10 : 1;
			const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
			const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
			deck.updateElements(deck.selection, (el) => ({ ...el, x: el.x + dx, y: el.y + dy }), 'nudge');
			return;
		}
		if (k === 'Enter' && deck.selection.length === 1) {
			const el = deck.selected[0];
			if (el.kind === 'shape' && el.geom !== 'line') {
				e.preventDefault();
				deck.startEditing(el.id);
			} else if (el.kind === 'table') {
				e.preventDefault();
				startCell(el.id, 0, 0);
			} else if (el.kind === 'chart') {
				e.preventDefault();
				oneditchart?.(el);
			}
		}
	}

	/** Last elements copied in this app (the context menu pastes them when the system clipboard can't be read). */
	let copied = '';

	function onCopy(e: ClipboardEvent, cut = false) {
		if (deck.editing || !deck.selection.length) return;
		e.preventDefault();
		copied = MARK + JSON.stringify($state.snapshot(deck.selected));
		e.clipboardData?.setData('text/plain', copied);
		if (cut && !readonly) deck.removeSelected();
	}

	/** Copy/cut from the context menu (no ClipboardEvent): system clipboard when allowed + the in-app copy. */
	function menuCopy(cut = false) {
		if (!deck.selection.length) return;
		copied = MARK + JSON.stringify($state.snapshot(deck.selected));
		void navigator.clipboard?.writeText(copied).catch(() => {});
		if (cut && !readonly) deck.removeSelected();
	}

	async function menuPaste() {
		if (readonly) return;
		let text = '';
		try {
			text = (await navigator.clipboard?.readText()) ?? '';
		} catch {
			text = '';
		}
		if (!text) text = copied;
		if (!text) return toast.info(t().ctx.pasteDenied);
		pasteText(text);
	}

	function pasteText(text: string) {
		if (text.startsWith(MARK)) {
			try {
				const els = (JSON.parse(text.slice(MARK.length)) as El[]).map((el) => ({ ...el, id: uid(), ph: undefined, x: el.x + 16, y: el.y + 16 }) as El);
				deck.addMany(els);
			} catch {
				/* not ours */
			}
			return;
		}
		if (text.trim()) deck.add(textBox(Math.round(size.w * 0.2), Math.round(size.h * 0.4), Math.round(size.w * 0.6), 80, text));
	}

	// ---------- Context menu ----------

	let menuAt = $state<MenuAt | null>(null);

	/** Right click / long press: select what is under the pointer (and the table cell), then open the menu. */
	function onContext(e: MouseEvent) {
		// While typing in a box the browser menu stays (spelling, input methods).
		if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return;
		if (!surface) return;
		e.preventDefault();
		if (deck.editing) deck.stopEditing();
		const p = toLogical(e);
		const el = [...slide.elements].reverse().find((x) => !x.locked && p.x >= x.x && p.x <= x.x + x.w && p.y >= x.y && p.y <= x.y + Math.max(x.h, 8));
		if (!el) {
			deck.selection = [];
			deck.cellSel = null;
		} else {
			if (!deck.selection.includes(el.id)) {
				deck.selection = [el.id];
				deck.cellSel = null;
			}
			if (el.kind === 'table' && deck.selection.length === 1) {
				const hit = cellAt(el, p.x - el.x, p.y - el.y);
				const g = deck.cellSel;
				if (hit && !(g && hit.r >= g.r1 && hit.r <= g.r2 && hit.c >= g.c1 && hit.c <= g.c2)) deck.cellSel = { r1: hit.r, c1: hit.c, r2: hit.r, c2: hit.c };
			}
		}
		host?.focus({ preventScroll: true });
		menuAt = { x: e.clientX, y: e.clientY };
	}

	const menuActions = {
		cut: () => menuCopy(true),
		copy: () => menuCopy(),
		paste: () => void menuPaste(),
		editText: () => deck.selected[0] && deck.startEditing(deck.selected[0].id),
		editCell: () => {
			const el = deck.selected[0];
			if (el?.kind === 'table') startCell(el.id, deck.cellSel?.r1 ?? 0, deck.cellSel?.c1 ?? 0);
		},
		editChart: () => {
			const el = deck.selected[0];
			if (el?.kind === 'chart') oneditchart?.(el);
		},
		motion: () => onmotion?.(),
		theme: () => ontheme?.(),
		replaceIcon: () => deck.selected[0] && onreplaceicon?.(deck.selected[0].id)
	};

	async function onPaste(e: ClipboardEvent) {
		if (deck.editing || readonly) return;
		const text = e.clipboardData?.getData('text/plain') ?? '';
		const all = [...(e.clipboardData?.files ?? [])];
		const files = all.filter((f) => f.type.startsWith('image/'));
		const media = all.filter(isMedia);
		e.preventDefault();
		if ((files.length || media.length) && !text) {
			if (files.length) await insertImageFiles(files);
			if (media.length) await insertMediaFiles(media);
			return;
		}
		pasteText(text);
	}

	function textBox(x: number, y: number, w: number, h: number, text = ''): ShapeEl {
		return { id: uid(), kind: 'shape', geom: 'rect', x, y, w, h, rot: 0, fill: { type: 'none' }, line: null, textbox: true, inset: 8, anchor: 'top', textStyle: { font: 'minor', size: 20, color: 'dk1' }, text: text ? textDoc(text) : undefined };
	}

	export async function insertImageFiles(files: File[], at?: { x: number; y: number }) {
		let off = 0;
		const added: El[] = [];
		for (const f of files) {
			const p = await prepareImage(f);
			if (p.reencoded) toast.info(t().object.reencoded(f.name));
			const blobId = await putBlob(fileId, p.blob);
			const { w, h } = fitSize(p.width, p.height, size.w * 0.6, size.h * 0.6);
			const x = at ? Math.round(at.x - w / 2) : Math.round((size.w - w) / 2);
			const y = at ? Math.round(at.y - h / 2) : Math.round((size.h - h) / 2);
			added.push({ id: uid(), kind: 'image', blobId, x: x + off, y: y + off, w, h, rot: 0, alt: f.name.replace(/\.[^.]+$/, '') });
			off += 20;
		}
		deck.addMany(added);
	}

	export async function insertMediaFiles(files: File[], at?: { x: number; y: number }) {
		const added: El[] = [];
		for (const f of files) {
			if (f.size > MAX_MEDIA_BYTES) {
				toast.warn(t().slides.mediaTooBig(f.name));
				continue;
			}
			const kind = mediaKind(f);
			const blobId = await putBlob(fileId, f);
			let posterBlobId: string | undefined;
			let w = 160;
			let h = 160;
			if (kind === 'video') {
				const poster = await videoPoster(f);
				if (poster) posterBlobId = await putBlob(fileId, poster.blob);
				({ w, h } = fitSize(poster?.width ?? 1280, poster?.height ?? 720, size.w * 0.6, size.h * 0.6));
			}
			const x = at ? Math.round(at.x - w / 2) : Math.round((size.w - w) / 2);
			const y = at ? Math.round(at.y - h / 2) : Math.round((size.h - h) / 2);
			const el: MediaEl = { id: uid(), kind: 'media', media: kind, blobId, mime: mediaMime(f), fileName: f.name, posterBlobId, x, y, w, h, rot: 0 };
			added.push(el);
		}
		deck.addMany(added);
	}

	async function onDrop(e: DragEvent) {
		const all = [...(e.dataTransfer?.files ?? [])];
		const files = all.filter((f) => f.type.startsWith('image/'));
		const media = all.filter(isMedia);
		if ((!files.length && !media.length) || readonly) return;
		e.preventDefault();
		if (files.length) await insertImageFiles(files, toLogical(e));
		if (media.length) await insertMediaFiles(media, toLogical(e));
	}

	const sel = $derived(deck.selected);
	const single = $derived(sel.length === 1 ? sel[0] : null);
	const selBox = $derived(sel.length > 1 ? union(sel) : null);
	const DIRS: Dir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
	const CURSOR: Record<Dir, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
	const hpos = (d: Dir) => `left:${d.includes('w') ? 0 : d.includes('e') ? 100 : 50}%;top:${d.includes('n') ? 0 : d.includes('s') ? 100 : 50}%`;
	const tf = (el: El) => `${el.rot ? `rotate(${el.rot}deg)` : ''}`;
	const inv = $derived(1 / scale);
</script>

<!-- Keyboard-driven editing surface (application widget): focusable so shortcuts and clipboard work. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={host}
	class="relative grid h-full min-h-0 w-full place-items-center overflow-hidden bg-bg outline-none focus-visible:outline-none"
	tabindex="0"
	role="application"
	aria-label={t().slides.slideOf(deck.current + 1, deck.content.slides.length)}
	onkeydown={key}
	oncopy={(e) => onCopy(e)}
	oncut={(e) => onCopy(e, true)}
	onpaste={onPaste}
	ondragover={(e) => e.dataTransfer?.types.includes('Files') && e.preventDefault()}
	ondrop={onDrop}
	oncontextmenu={onContext}
>
	<div class="shadow-[0_1px_3px_rgb(0_0_0/0.2),0_6px_24px_rgb(0_0_0/0.12)]">
		<SlideView content={deck.content} {slide} {scale} placeholders hideTextOf={deck.editing} hideCell={deck.editingCell}>
			<div
				bind:this={surface}
				class="absolute inset-0"
				role="presentation"
				onpointerdown={downSurface}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
				ondblclick={dblSurface}
			>
				{#each slide.elements.filter((x) => !x.locked) as el (el.id)}
					<div
						class="absolute {readonly ? '' : 'cursor-move'}"
						style="left:{el.x}px;top:{el.y}px;width:{Math.max(el.w, 8 * inv)}px;height:{Math.max(el.h, 8 * inv)}px;transform:{tf(el)}"
						role="presentation"
						onpointerdown={(e) => downElement(e, el)}
					></div>
				{/each}
				{#if deck.editing}
					{@const ed = slide.elements.find((x) => x.id === deck.editing)}
					{#key `${deck.editing}|${deck.editingCell}`}
						{#if ed && (ed.kind === 'shape' || ed.kind === 'table')}<TextEditorBox {deck} el={ed} {theme} cell={deck.editingCell} />{/if}
					{/key}
				{/if}
				{#if single?.kind === 'table' && deck.cellSel && !deck.editingCell}
					{@const g = deck.cellSel}
					{@const a = cellBox(single, g.r1, g.c1)}
					{@const b = cellBox(single, g.r2, g.c2)}
					<div class="pointer-events-none absolute bg-[#3b5bdb]/15" style="left:{single.x + a.x}px;top:{single.y + a.y}px;width:{b.x + b.w - a.x}px;height:{b.y + b.h - a.y}px;outline:{2 * inv}px solid #3b5bdb"></div>
				{/if}
				{#each sel as el (el.id)}
					<div class="pointer-events-none absolute" style="left:{el.x}px;top:{el.y}px;width:{el.w}px;height:{el.h}px;transform:{tf(el)};outline:{2 * inv}px solid #3b5bdb;outline-offset:{inv}px"></div>
				{/each}
				{#if selBox}
					<div class="pointer-events-none absolute" style="left:{selBox.x}px;top:{selBox.y}px;width:{selBox.w}px;height:{selBox.h}px;outline:{inv}px dashed #3b5bdb"></div>
				{/if}
				{#if single && !readonly && deck.editing !== single.id}
					<div class="pointer-events-none absolute" style="left:{single.x}px;top:{single.y}px;width:{single.w}px;height:{single.h}px;transform:{tf(single)}">
						{#each DIRS as d (d)}
							<span
								class="pointer-events-auto absolute rounded-full border-white bg-[#3b5bdb]"
								style="{hpos(d)};width:{10 * inv}px;height:{10 * inv}px;margin:{-5 * inv}px;border-width:{1.5 * inv}px;cursor:{CURSOR[d]}"
								onpointerdown={(e) => downHandle(e, d)}
								role="presentation"
							></span>
						{/each}
						<span class="absolute left-1/2 bg-[#3b5bdb]" style="top:{-22 * inv}px;width:{inv}px;height:{17 * inv}px"></span>
						<span
							class="pointer-events-auto absolute left-1/2 cursor-grab rounded-full border-white bg-[#3b5bdb]"
							style="top:{-28 * inv}px;width:{12 * inv}px;height:{12 * inv}px;margin-left:{-6 * inv}px;border-width:{1.5 * inv}px"
							title={t().slides.rotate}
							onpointerdown={downRotate}
							role="presentation"
						></span>
					</div>
				{/if}
				{#each guides as g, i (i)}
					<div class="pointer-events-none absolute bg-[#e8590c]" style={g.axis === 'x' ? `left:${g.at}px;top:0;width:${inv}px;height:${size.h}px` : `top:${g.at}px;left:0;height:${inv}px;width:${size.w}px`}></div>
				{/each}
				{#if marquee}
					<div class="pointer-events-none absolute bg-[#3b5bdb]/10" style="left:{marquee.x}px;top:{marquee.y}px;width:{marquee.w}px;height:{marquee.h}px;outline:{inv}px solid #3b5bdb"></div>
				{/if}
			</div>
		</SlideView>
	</div>
</div>

<CanvasMenu {deck} at={menuAt} {readonly} onclose={() => (menuAt = null)} actions={menuActions} />
