<script lang="ts">
	// Virtualized DOM grid. A native scroll container provides scrollbars; a sticky viewport on top of it draws
	// headers and up to four panes (frozen corner / frozen rows / frozen columns / body), each translated by the
	// scroll offset. Only visible rows/columns are rendered.
	// Input goes through one textarea ("sink") that is always focused: typing starts editing (IME-safe),
	// arrows navigate, copy/paste events carry clipboard data.
	import { tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import ObjectLayer from './ObjectLayer.svelte';
	import { chartData, type ChartData } from '../../sheets/charts.ts';
	import { anchorXY, insertImages, isImageFile, xyAnchor } from '../../sheets/objects.ts';
	import { urlFor } from '../../storage/blobs.ts';
	import type { CellImage, SheetObject } from '../../sheets/model.ts';
	import { cellKey, colName, keyCol, type Range } from '../../sheets/addr.ts';
	import type { Display } from '../../sheets/book.svelte.ts';
	import { formulaRefs } from '../../sheets/formula/refs.ts';
	import { FUNCTION_NAMES } from '../../sheets/formula/functions.ts';
	import { callAt, signature, signatureParts } from '../../sheets/formula/signatures.ts';
	import { Axis } from '../../sheets/layout.ts';
	import { DEFAULT_COL_W, DEFAULT_ROW_H, sheetByName, type CellStyle } from '../../sheets/model.ts';
	import type { SheetView } from '../../sheets/view.svelte.ts';
	import { i18n, t } from '../../i18n/index.svelte.ts';
	import { dep } from '../../client/dep.ts';

	let {
		view,
		readonly = false,
		oncontext,
		onfilter,
		onshortcut
	}: {
		view: SheetView;
		readonly?: boolean;
		oncontext: (e: MouseEvent, kind: 'cell' | 'row' | 'col') => void;
		onfilter: (col: number, x: number, y: number) => void;
		onshortcut: (e: KeyboardEvent) => boolean;
	} = $props();

	const HW = 46;
	const HH = 24;
	const book = $derived(view.book);

	let scroller = $state<HTMLDivElement>();
	let sink = $state<HTMLTextAreaElement>();
	let vw = $state(800);
	let vh = $state(600);
	let sx = $state(0);
	let sy = $state(0);

	type Live = { axis: 'row' | 'col'; index: number; size: number };
	let live = $state<Live | null>(null);

	// Shallow copy per revision: the Sheet object is mutated in place, a new reference makes dependents update.
	const sheet = $derived(dep(book.rev, { ...book.active }));
	const rows = $derived.by(() => {
		void book.rev;
		const sizes = live?.axis === 'row' ? new Map(sheet.rowHeights).set(live.index, live.size) : sheet.rowHeights;
		return new Axis(sheet.rows, DEFAULT_ROW_H, sizes, sheet.hidden);
	});
	const cols = $derived.by(() => {
		void book.rev;
		const sizes = live?.axis === 'col' ? new Map(sheet.colWidths).set(live.index, live.size) : sheet.colWidths;
		return new Axis(sheet.cols, DEFAULT_COL_W, sizes);
	});
	const fr = $derived(Math.min(sheet.freeze.rows, sheet.rows - 1));
	const fc = $derived(Math.min(sheet.freeze.cols, sheet.cols - 1));
	const fh = $derived(rows.offset(fr));
	const fw = $derived(cols.offset(fc));

	const EXTRA = 48; // room below the last row for "add rows"

	function range(a: number, b: number, axis: Axis) {
		const out: number[] = [];
		for (let i = a; i <= b; i++) if (!axis.isHidden(i)) out.push(i);
		return out;
	}
	// Visible window snapped to blocks: the cell lists are rebuilt only when scrolling crosses a block,
	// in between only the panes' transforms change (cheap).
	const RB = 8;
	const CB = 4;
	const r0 = $derived(Math.max(fr, Math.floor(rows.indexAt(fh + sy) / RB) * RB));
	const r1 = $derived(Math.min(rows.count - 1, (Math.floor(rows.indexAt(sy + vh - HH) / RB) + 1) * RB + RB));
	const c0 = $derived(Math.max(fc, Math.floor(cols.indexAt(fw + sx) / CB) * CB));
	const c1 = $derived(Math.min(cols.count - 1, (Math.floor(cols.indexAt(sx + vw - HW) / CB) + 1) * CB + CB));
	const bodyRows = $derived(range(r0, r1, rows));
	const bodyCols = $derived(range(c0, c1, cols));
	const frozenRows = $derived(range(0, fr - 1, rows));
	const frozenCols = $derived(range(0, fc - 1, cols));

	// ---------- Cells ----------

	/** `ow` = width the text may spill into (left-aligned text over empty neighbours); `nr` = hide right gridline. */
	type CellBox = { key: number; r: number; c: number; x: number; y: number; w: number; h: number; d: Display; filterBtn: boolean; ow?: number; nr?: boolean; img?: CellImage };

	let measureCtx: CanvasRenderingContext2D | null = null;
	const widthCache = new Map<string, number>();
	function textWidth(text: string, s: CellStyle) {
		const font = `${s.italic ? 'italic ' : ''}${s.bold ? '700 ' : ''}${s.size ? `${s.size}pt` : '10pt'} ${s.font ? `'${s.font}',` : ''}Arial, sans-serif`;
		const k = `${font}|${text}`;
		let w = widthCache.get(k);
		if (w === undefined) {
			measureCtx ??= document.createElement('canvas').getContext('2d');
			if (!measureCtx) return 0;
			measureCtx.font = font;
			w = measureCtx.measureText(text).width + 8;
			if (widthCache.size > 20_000) widthCache.clear();
			widthCache.set(k, w);
		}
		return w;
	}

	// Box objects are reused across block rebuilds while nothing changed (same revision and geometry), so the
	// keyed {#each} leaves existing cell DOM untouched.
	let cache = new Map<number, CellBox>();
	let cacheTag: unknown[] = [];
	function cached(key: number, r: number, c: number, filterBtn: boolean): CellBox {
		const hit = cache.get(key);
		if (hit && hit.filterBtn === filterBtn) return hit;
		const b: CellBox = { key, r, c, x: cols.offset(c), y: rows.offset(r), w: cols.size(c), h: rows.size(r), d: book.display(sheet, r, c), filterBtn, img: sheet.cells.get(key)?.img };
		cache.set(key, b);
		return b;
	}

	function boxes(rs: number[], cs: number[]): CellBox[] {
		const tag = [book.rev, rows, cols, sheet.id, i18n.locale];
		if (tag.some((x, i) => x !== cacheTag[i])) {
			cache = new Map();
			cacheTag = tag;
		}
		if (cache.size > 20_000) cache = new Map();
		const s = sheet;
		const out: CellBox[] = [];
		if (!rs.length || !cs.length) return out;
		const merges = s.merges.filter((m) => m.r1 <= rs[rs.length - 1] && m.r2 >= rs[0] && m.c1 <= cs[cs.length - 1] && m.c2 >= cs[0]);
		const covered = new Set<number>();
		for (const m of merges) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) covered.add(cellKey(r, c));
		const f = s.filter;
		const empty = (r: number, c: number) => {
			const cell = s.cells.get(cellKey(r, c));
			return !covered.has(cellKey(r, c)) && (!cell || ((cell.v === undefined || cell.v === null || cell.v === '') && !cell.f && !book.styleAt(s, r, c).fill));
		};
		for (const r of rs) {
			const row: CellBox[] = [];
			for (const c of cs) {
				const key = cellKey(r, c);
				if (covered.has(key)) continue;
				row.push(cached(key, r, c, !!f && r === f.range.r1 && c >= f.range.c1 && c <= f.range.c2));
			}
			// Text overflow into empty cells to the right (like Excel/Sheets).
			const ows: (number | undefined)[] = row.map(() => undefined);
			const nrs: boolean[] = row.map(() => false);
			for (let i = 0; i < row.length; i++) {
				const b = row[i];
				if (!b.d.text || b.d.align !== 'left' || b.d.style.wrap || b.filterBtn || typeof book.cell(s, b.r, b.c)?.v !== 'string') continue;
				const need = textWidth(b.d.text, b.d.style);
				if (need <= b.w) continue;
				let ow = b.w;
				let j = i + 1;
				while (ow < need && j < row.length && row[j].c === row[j - 1].c + 1 && empty(b.r, row[j].c) && !(f && b.r === f.range.r1)) {
					ow += row[j].w;
					nrs[j - 1] = true;
					j++;
				}
				if (ow > b.w) ows[i] = ow;
			}
			for (let i = 0; i < row.length; i++) {
				const b = row[i];
				if (b.ow !== ows[i] || !!b.nr !== nrs[i]) {
					row[i] = { ...b, ow: ows[i], nr: nrs[i] || undefined };
					cache.set(b.key, row[i]);
				}
			}
			out.push(...row);
		}
		for (const m of merges) {
			const key = cellKey(m.r1, m.c1);
			out.push({
				key,
				r: m.r1,
				c: m.c1,
				x: cols.offset(m.c1),
				y: rows.offset(m.r1),
				w: cols.offset(m.c2 + 1) - cols.offset(m.c1),
				h: rows.offset(m.r2 + 1) - rows.offset(m.r1),
				d: book.display(s, m.r1, m.c1),
				filterBtn: false,
				img: s.cells.get(key)?.img
			});
		}
		return out;
	}

	const bodyBoxes = $derived(boxes(bodyRows, bodyCols));
	const topBoxes = $derived(boxes(frozenRows, bodyCols));
	const leftBoxes = $derived(boxes(bodyRows, frozenCols));
	const cornerBoxes = $derived(boxes(frozenRows, frozenCols));

	// ---------- Floating objects and cell images ----------

	/** blobId → object URL (loaded on demand from IndexedDB). */
	const urls = new SvelteMap<string, string>();
	const loading = new Set<string>();
	function want(blobId: string) {
		if (urls.has(blobId) || loading.has(blobId)) return;
		loading.add(blobId);
		void urlFor(blobId).then((u) => {
			loading.delete(blobId);
			if (u) urls.set(blobId, u);
		});
	}
	$effect(() => {
		void book.rev;
		for (const o of sheet.objects) if (o.kind === 'image') want(o.blobId);
		for (const list of [bodyBoxes, topBoxes, leftBoxes, cornerBoxes]) for (const b of list) if (b.img) want(b.img.blobId);
	});

	/** Objects drawn in each pane: by where their anchor cell is (frozen rows/cols stay frozen). */
	const paneObjects = $derived.by(() => {
		void book.rev;
		const out: Record<string, SheetObject[]> = { body: [], top: [], left: [], corner: [] };
		for (const o of sheet.objects) {
			const top = o.anchor.r < fr;
			const left = o.anchor.c < fc;
			out[top && left ? 'corner' : top ? 'top' : left ? 'left' : 'body'].push(o);
		}
		return out;
	});

	const dataCache = new Map<string, { rev: number; data: ChartData }>();
	function dataFor(o: SheetObject): ChartData {
		if (o.kind !== 'chart') return { labels: [], series: [] };
		const key = `${o.id}|${o.type}|${JSON.stringify(o.source)}|${i18n.locale}`;
		const hit = dataCache.get(key);
		if (hit && hit.rev === book.rev) return hit.data;
		const data = chartData(book.wb, o, (s, r, c) => book.text(s, r, c));
		// Same values as before → same object, so the chart does not redraw.
		const same = hit && JSON.stringify(hit.data) === JSON.stringify(data);
		const out = same ? hit!.data : data;
		dataCache.set(key, { rev: book.rev, data: out });
		return out;
	}

	function moveObject(id: string, dx: number, dy: number) {
		const o = book.object(sheet.id, id);
		if (!o) return;
		const p = anchorXY(o.anchor, rows, cols);
		book.updateObject(sheet.id, id, { anchor: xyAnchor(p.x + dx, p.y + dy, rows, cols) });
	}

	function cloneObject(o: SheetObject, at: { r: number; c: number }): SheetObject {
		const c = structuredClone($state.snapshot(o)) as SheetObject;
		c.id = crypto.randomUUID();
		c.anchor = { r: at.r, c: at.c, dx: 8, dy: 8 };
		return c;
	}

	function onDrop(e: DragEvent) {
		const files = [...(e.dataTransfer?.files ?? [])].filter(isImageFile);
		if (!files.length || readonly) return;
		e.preventDefault();
		e.stopPropagation();
		const h = hit(e.clientX, e.clientY);
		void insertImages(view, files, h.area === 'cell' ? { r: h.r, c: h.c } : undefined);
	}

	const panes = $derived(
		[
			{ id: 'body', list: bodyBoxes, left: HW + fw, top: HH + fh, w: Math.max(0, vw - HW - fw), h: Math.max(0, vh - HH - fh), tx: -(fw + sx), ty: -(fh + sy) },
			{ id: 'top', list: topBoxes, left: HW + fw, top: HH, w: Math.max(0, vw - HW - fw), h: fh, tx: -(fw + sx), ty: 0 },
			{ id: 'left', list: leftBoxes, left: HW, top: HH + fh, w: fw, h: Math.max(0, vh - HH - fh), tx: 0, ty: -(fh + sy) },
			{ id: 'corner', list: cornerBoxes, left: HW, top: HH, w: fw, h: fh, tx: 0, ty: 0 }
		].filter((p) => p.w > 0 && p.h > 0)
	);

	const BORDER_W: Record<string, string> = { thin: '1px solid', medium: '2px solid', thick: '3px solid', dashed: '1px dashed', dotted: '1px dotted', double: '3px double' };
	const borderCss = (b: { style: string; color?: string } | undefined) => (b ? `${BORDER_W[b.style] ?? '1px solid'} ${b.color ?? '#000'}` : '');

	const cssCache = new Map<string, string>();
	function styleCss(s: CellStyle, align: string, color: string | undefined): string {
		const key = `${JSON.stringify(s)}|${align}|${color ?? ''}`;
		const hit = cssCache.get(key);
		if (hit) return hit;
		const p: string[] = [];
		if (s.bold) p.push('font-weight:700');
		if (s.italic) p.push('font-style:italic');
		const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
		if (deco) p.push(`text-decoration:${deco}`);
		if (color ?? s.color) p.push(`color:${color ?? s.color}`);
		if (s.fill) p.push(`background:${s.fill}`);
		if (s.font) p.push(`font-family:'${s.font}',Arial,sans-serif`);
		if (s.size) p.push(`font-size:${s.size}pt`);
		p.push(`justify-content:${align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'}`);
		p.push(`text-align:${align}`);
		p.push(`align-items:${s.vAlign === 'top' ? 'flex-start' : s.vAlign === 'middle' ? 'center' : 'flex-end'}`);
		if (s.wrap) p.push('white-space:pre-wrap;word-break:break-word');
		if (s.border?.top) p.push(`border-top:${borderCss(s.border.top)}`);
		if (s.border?.left) p.push(`border-left:${borderCss(s.border.left)}`);
		if (s.border?.right) p.push(`border-right:${borderCss(s.border.right)}`);
		if (s.border?.bottom) p.push(`border-bottom:${borderCss(s.border.bottom)}`);
		const css = p.join(';');
		cssCache.set(key, css);
		return css;
	}

	// ---------- Selection geometry ----------

	function rectOf(g: Range) {
		const r2 = Math.min(g.r2, rows.count - 1);
		const c2 = Math.min(g.c2, cols.count - 1);
		return { x: cols.offset(g.c1), y: rows.offset(g.r1), w: cols.offset(c2 + 1) - cols.offset(g.c1), h: rows.offset(r2 + 1) - rows.offset(g.r1) };
	}

	const activeRect = $derived.by(() => {
		void book.rev;
		const { r, c } = view.active;
		const m = book.mergeAt(sheet, r, c);
		return rectOf(m ?? { r1: r, c1: c, r2: r, c2: c });
	});
	const selRects = $derived(view.ranges.map((g) => rectOf(g)));
	const primaryRect = $derived(selRects[selRects.length - 1]);
	const multi = $derived(view.ranges.length > 1 || view.primary.r1 !== view.primary.r2 || view.primary.c1 !== view.primary.c2);

	const REF_COLORS = ['#3b82f6', '#e8590c', '#2f9e44', '#ae3ec9', '#f59f00', '#0c8599', '#e03131'];
	const refRects = $derived.by(() => {
		const e = view.edit;
		if (!e || !e.text.startsWith('=') || e.sheetId !== sheet.id) return [];
		return formulaRefs(e.text.slice(1))
			.map((g, i) => ({ g, color: REF_COLORS[i % REF_COLORS.length] }))
			.filter(({ g }) => !g.sheet || sheetByName(book.wb, g.sheet)?.id === sheet.id)
			.map(({ g, color }) => ({ ...rectOf(g), color }));
	});

	let fillTarget = $state<Range | null>(null);
	const fillRect = $derived(fillTarget ? rectOf(fillTarget) : null);

	const inSel = (axis: 'row' | 'col', i: number) => view.ranges.some((g) => (axis === 'row' ? i >= g.r1 && i <= g.r2 : i >= g.c1 && i <= g.c2));
	const fullSel = (axis: 'row' | 'col', i: number) => view.ranges.some((g) => (axis === 'row' ? view.isWholeRows(g) && i >= g.r1 && i <= g.r2 : view.isWholeCols(g) && i >= g.c1 && i <= g.c2));

	// Screen position of a content coordinate (accounts for frozen panes).
	const screenX = (c: number, x: number) => HW + x - (c >= fc ? sx : 0);
	const screenY = (r: number, y: number) => HH + y - (r >= fr ? sy : 0);

	// ---------- Scrolling ----------

	let raf = 0;
	function onScroll() {
		if (raf) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			if (!scroller) return;
			sx = scroller.scrollLeft;
			sy = scroller.scrollTop;
		});
	}

	$effect(() => {
		if (!scroller) return;
		const ro = new ResizeObserver(() => {
			vw = scroller!.clientWidth;
			vh = scroller!.clientHeight;
		});
		ro.observe(scroller);
		return () => ro.disconnect();
	});

	// Scroll the active cell into view when asked.
	$effect(() => {
		void view.reveal;
		void tick().then(() => {
			if (!scroller) return;
			const { r, c } = view.edit ? view.edit : view.active;
			const x = cols.offset(c);
			const y = rows.offset(r);
			const w = cols.size(c);
			const h = rows.size(r);
			if (c >= fc) {
				const left = x - fw;
				const viewW = vw - HW - fw;
				if (left < scroller.scrollLeft) scroller.scrollLeft = left;
				else if (left + w > scroller.scrollLeft + viewW) scroller.scrollLeft = left + w - viewW;
			}
			if (r >= fr) {
				const top = y - fh;
				const viewH = vh - HH - fh;
				if (top < scroller.scrollTop) scroller.scrollTop = top;
				else if (top + h > scroller.scrollTop + viewH) scroller.scrollTop = top + h - viewH;
			}
		});
	});

	// ---------- Focus / editor sink ----------

	$effect(() => {
		void view.focusTick;
		queueMicrotask(() => sink?.focus({ preventScroll: true }));
	});

	// Keep the textarea content in sync with the edit text when it changes elsewhere (formula bar, F2).
	$effect(() => {
		const e = view.edit;
		if (!sink) return;
		if (!e) {
			if (sink.value) sink.value = '';
			return;
		}
		if (sink.value !== e.text && document.activeElement !== sink) sink.value = e.text;
		else if (sink.value !== e.text && e.from === 'cell' && !composing) {
			sink.value = e.text;
			sink.setSelectionRange(e.text.length, e.text.length);
		}
	});

	let composing = false;

	const editRect = $derived.by(() => {
		const e = view.edit;
		const { r, c } = e ?? view.active;
		const m = book.mergeAt(sheet, r, c);
		const g = rectOf(m ?? { r1: r, c1: c, r2: r, c2: c });
		return { x: screenX(c, g.x), y: screenY(r, g.y), w: g.w, h: g.h };
	});
	// Editor grows with its text: CSS field-sizing where supported (Chromium), measured width/height elsewhere (Firefox, Safari).
	const fieldSizing = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');
	const editSize = $derived.by(() => {
		const e = view.edit;
		if (!e) return '';
		if (fieldSizing) return 'field-sizing:content;';
		const s = book.styleAt(sheet, e.r, e.c);
		const lines = e.text.split('\n');
		const w = Math.max(editRect.w + 1, ...lines.map((l) => textWidth(l, s) + 6));
		const lineH = (((s.size ?? 10) * 96) / 72) * 1.25;
		const h = Math.max(editRect.h + 1, lines.length * lineH + 6);
		return `width:${Math.ceil(w)}px;height:${Math.ceil(h)}px;`;
	});

	const editStyle = $derived.by(() => {
		void book.rev;
		const e = view.edit;
		if (!e) return '';
		const s = book.styleAt(sheet, e.r, e.c);
		const p: string[] = [];
		if (s.bold) p.push('font-weight:700');
		if (s.italic) p.push('font-style:italic');
		if (s.font) p.push(`font-family:'${s.font}',Arial,sans-serif`);
		if (s.size) p.push(`font-size:${s.size}pt`);
		if (s.fill) p.push(`background:${s.fill}`);
		if (s.color) p.push(`color:${s.color}`);
		return p.join(';');
	});

	// Function name autocomplete while typing "=SU".
	const fnQuery = $derived.by(() => {
		const e = view.edit;
		if (!e || !e.text.startsWith('=')) return null;
		const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(e.text);
		if (!m || m[1].length < 1) return null;
		const before = e.text.slice(0, e.text.length - m[1].length);
		if (!/[=(,+\-*/^&<>:;\s]$/.test(before)) return null;
		const q = m[1].toUpperCase();
		const list = FUNCTION_NAMES.filter((n) => n.startsWith(q)).slice(0, 8);
		return list.length && !(list.length === 1 && list[0] === q) ? { q, list } : null;
	});
	let fnIndex = $state(0);
	let caret = $state(0);
	const sigHint = $derived.by(() => {
		const e = view.edit;
		if (!e || !e.text.startsWith('=') || fnQuery) return null;
		const call = callAt(e.text, e.from === 'cell' ? caret : e.text.length);
		if (!call) return null;
		const sig = signature(call.name);
		if (sig === undefined) return { name: call.name, ...signatureParts('', 0) };
		return { name: call.name, ...signatureParts(sig, call.arg) };
	});
	const trackCaret = () => sink && (caret = sink.selectionStart ?? 0);
	$effect(() => {
		void fnQuery;
		fnIndex = 0;
	});

	function acceptFn(name: string) {
		const e = view.edit;
		if (!e || !fnQuery) return;
		e.text = e.text.slice(0, e.text.length - fnQuery.q.length) + name + '(';
		if (sink) {
			sink.value = e.text;
			sink.setSelectionRange(e.text.length, e.text.length);
		}
	}

	// ---------- Hit testing ----------

	type Hit = { area: 'corner' | 'col' | 'row' | 'cell' | 'none'; r: number; c: number; edge: boolean };

	function hit(clientX: number, clientY: number): Hit {
		const rect = scroller!.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		if (x > vw || y > vh) return { area: 'none', r: 0, c: 0, edge: false };
		const cx = x - HW < fw ? x - HW : x - HW + sx;
		const cy = y - HH < fh ? y - HH : y - HH + sy;
		const c = cols.indexAt(cx);
		const r = rows.indexAt(cy);
		if (x < HW && y < HH) return { area: 'corner', r: 0, c: 0, edge: false };
		if (y < HH) {
			// Near the right edge of a column (or left edge = previous column's right edge)?
			const right = cols.offset(c + 1);
			const left = cols.offset(c);
			if (Math.abs(cx - right) <= 4) return { area: 'col', r: 0, c, edge: true };
			if (c > 0 && Math.abs(cx - left) <= 4) return { area: 'col', r: 0, c: c - 1, edge: true };
			return { area: 'col', r: 0, c, edge: false };
		}
		if (x < HW) {
			const bottom = rows.offset(r + 1);
			const top = rows.offset(r);
			if (Math.abs(cy - bottom) <= 3) return { area: 'row', r, c: 0, edge: true };
			if (r > 0 && Math.abs(cy - top) <= 3) return { area: 'row', r: prevVisible(r), c: 0, edge: true };
			return { area: 'row', r, c: 0, edge: false };
		}
		return { area: 'cell', r, c, edge: false };
	}

	function prevVisible(r: number) {
		let p = r - 1;
		while (p > 0 && rows.isHidden(p)) p--;
		return Math.max(0, p);
	}

	// ---------- Pointer interaction ----------

	type Drag =
		| { kind: 'select'; pointerId: number }
		| { kind: 'rows' | 'cols'; pointerId: number }
		| { kind: 'resize'; axis: 'row' | 'col'; index: number; start: number; startSize: number; pointerId: number }
		| { kind: 'fill'; source: Range; pointerId: number }
		| { kind: 'pick'; start: { r: number; c: number }; insertAt: number; insertLen: number; pointerId: number }
		| { kind: 'touch'; x: number; y: number; hit: Hit; pointerId: number };

	let drag = $state.raw<Drag | null>(null);
	let lastPointer = { x: 0, y: 0 };
	let autoTimer: ReturnType<typeof setInterval> | undefined;

	function down(e: PointerEvent) {
		if (e.button === 2) return; // context menu handles it
		const target = e.target as HTMLElement;
		if (target.closest('[data-filter-btn]') || target.closest('[data-add-rows]') || target.closest('[data-fn-list]') || target.closest('[data-object]')) return;
		view.object = null;
		const h = hit(e.clientX, e.clientY);
		if (h.area === 'none') return;
		lastPointer = { x: e.clientX, y: e.clientY };
		if (e.pointerType === 'touch' && h.area === 'cell') {
			drag = { kind: 'touch', x: e.clientX, y: e.clientY, hit: h, pointerId: e.pointerId };
			return; // let the browser scroll; select on pointerup if it was a tap
		}
		e.preventDefault();
		// Picking a reference while typing a formula.
		if (view.edit && h.area === 'cell' && sink && view.canPickRef(sink.value.slice(0, sink.selectionStart ?? sink.value.length))) {
			const ref = refText(h.r, h.c);
			const pos = sink.selectionStart ?? sink.value.length;
			insertRef(pos, 0, ref);
			drag = { kind: 'pick', start: { r: h.r, c: h.c }, insertAt: pos, insertLen: ref.length, pointerId: e.pointerId };
			view.pick = { r1: h.r, c1: h.c, r2: h.r, c2: h.c };
			capture(e);
			return;
		}
		if (view.edit) {
			if (h.area === 'cell' && h.r === view.edit.r && h.c === view.edit.c) return;
			view.commit();
		}
		if (h.area === 'corner') {
			view.selectAll();
			view.focusTick++;
			return;
		}
		if (h.area === 'col') {
			if (h.edge && !readonly) {
				drag = { kind: 'resize', axis: 'col', index: h.c, start: e.clientX, startSize: cols.size(h.c), pointerId: e.pointerId };
				live = { axis: 'col', index: h.c, size: cols.size(h.c) };
			} else {
				view.selectCols(h.c, h.c, e.shiftKey);
				drag = { kind: 'cols', pointerId: e.pointerId };
			}
			capture(e);
			view.focusTick++;
			return;
		}
		if (h.area === 'row') {
			if (h.edge && !readonly) {
				drag = { kind: 'resize', axis: 'row', index: h.r, start: e.clientY, startSize: rows.size(h.r), pointerId: e.pointerId };
				live = { axis: 'row', index: h.r, size: rows.size(h.r) };
			} else {
				view.selectRows(h.r, h.r, e.shiftKey);
				drag = { kind: 'rows', pointerId: e.pointerId };
			}
			capture(e);
			view.focusTick++;
			return;
		}
		view.select({ r: h.r, c: h.c }, { extend: e.shiftKey, add: e.ctrlKey || e.metaKey });
		drag = { kind: 'select', pointerId: e.pointerId };
		capture(e);
		view.focusTick++;
	}

	function capture(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		clearInterval(autoTimer);
		autoTimer = setInterval(autoScroll, 50);
	}

	function autoScroll() {
		if (!drag || !scroller || drag.kind === 'resize' || drag.kind === 'touch') return;
		const rect = scroller.getBoundingClientRect();
		const { x, y } = lastPointer;
		let dx = 0;
		let dy = 0;
		if (drag.kind !== 'rows') {
			if (x > rect.left + vw - 10) dx = Math.min(60, x - (rect.left + vw - 10));
			else if (x < rect.left + HW + fw && sx > 0) dx = -Math.min(60, rect.left + HW + fw - x);
		}
		if (drag.kind !== 'cols') {
			if (y > rect.top + vh - 10) dy = Math.min(60, y - (rect.top + vh - 10));
			else if (y < rect.top + HH + fh && sy > 0) dy = -Math.min(60, rect.top + HH + fh - y);
		}
		if (dx || dy) {
			scroller.scrollLeft += dx;
			scroller.scrollTop += dy;
			moveTo(x, y);
		}
	}

	function move(e: PointerEvent) {
		lastPointer = { x: e.clientX, y: e.clientY };
		if (!drag) {
			// Cursor feedback for resize edges.
			const h = hit(e.clientX, e.clientY);
			const el = e.currentTarget as HTMLElement;
			el.style.cursor = h.edge && !readonly ? (h.area === 'col' ? 'col-resize' : 'row-resize') : h.area === 'cell' ? 'cell' : 'default';
			return;
		}
		if (drag.kind === 'touch') return;
		moveTo(e.clientX, e.clientY);
	}

	function moveTo(clientX: number, clientY: number) {
		if (!drag) return;
		if (drag.kind === 'resize') {
			const delta = drag.axis === 'col' ? clientX - drag.start : clientY - drag.start;
			live = { axis: drag.axis, index: drag.index, size: Math.max(drag.axis === 'col' ? 20 : 12, drag.startSize + delta) };
			return;
		}
		const h = hit(Math.min(clientX, scroller!.getBoundingClientRect().left + vw - 2), Math.min(clientY, scroller!.getBoundingClientRect().top + vh - 2));
		if (drag.kind === 'select') view.select({ r: h.r, c: h.c }, { extend: true });
		else if (drag.kind === 'rows') view.selectRows(view.anchor.r, h.r, true);
		else if (drag.kind === 'cols') view.selectCols(view.anchor.c, h.c, true);
		else if (drag.kind === 'fill') {
			const s = drag.source;
			const dr = h.r > s.r2 ? h.r - s.r2 : h.r < s.r1 ? h.r - s.r1 : 0;
			const dc = h.c > s.c2 ? h.c - s.c2 : h.c < s.c1 ? h.c - s.c1 : 0;
			if (!dr && !dc) fillTarget = null;
			else if (Math.abs(dr) >= Math.abs(dc)) fillTarget = dr > 0 ? { ...s, r2: h.r } : { ...s, r1: h.r };
			else fillTarget = dc > 0 ? { ...s, c2: h.c } : { ...s, c1: h.c };
		} else if (drag.kind === 'pick') {
			const g = { r1: Math.min(drag.start.r, h.r), c1: Math.min(drag.start.c, h.c), r2: Math.max(drag.start.r, h.r), c2: Math.max(drag.start.c, h.c) };
			view.pick = g;
			const ref = g.r1 === g.r2 && g.c1 === g.c2 ? refText(g.r1, g.c1) : `${refText(g.r1, g.c1)}:${colName(g.c2)}${g.r2 + 1}`;
			insertRef(drag.insertAt, drag.insertLen, ref);
			drag.insertLen = ref.length;
		}
	}

	function up(e: PointerEvent) {
		clearInterval(autoTimer);
		const d = drag;
		drag = null;
		if (!d) return;
		if (d.kind === 'touch') {
			if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) {
				if (view.edit) view.commit();
				view.select({ r: d.hit.r, c: d.hit.c });
				view.focusTick++;
			}
			return;
		}
		if (d.kind === 'resize') {
			const size = live?.size;
			live = null;
			if (size !== undefined) {
				const sel = d.axis === 'col' ? view.isWholeCols() && view.indices('col').includes(d.index) : view.isWholeRows() && view.indices('row').includes(d.index);
				book.resize(sheet.id, d.axis, sel ? view.indices(d.axis) : [d.index], size);
			}
		} else if (d.kind === 'fill') {
			const target = fillTarget;
			fillTarget = null;
			if (target && !readonly) {
				book.fill(sheet.id, d.source, target);
				view.selectRange(target, view.active);
			}
		} else if (d.kind === 'pick') {
			view.pick = null;
			sink?.focus();
		}
		view.focusTick++;
	}

	function fillDown(e: PointerEvent) {
		if (readonly) return;
		e.preventDefault();
		e.stopPropagation();
		if (view.edit) view.commit();
		drag = { kind: 'fill', source: { ...view.primary }, pointerId: e.pointerId };
		(scroller!.querySelector('[data-viewport]') as HTMLElement).setPointerCapture(e.pointerId);
		clearInterval(autoTimer);
		autoTimer = setInterval(autoScroll, 50);
	}

	function refText(r: number, c: number) {
		const e = view.edit;
		const prefix = e && e.sheetId !== sheet.id ? `${quote(sheet.name)}!` : '';
		return `${prefix}${colName(c)}${r + 1}`;
	}
	const quote = (n: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

	function insertRef(at: number, len: number, ref: string) {
		const e = view.edit;
		if (!e || !sink) return;
		e.text = e.text.slice(0, at) + ref + e.text.slice(at + len);
		sink.value = e.text;
		sink.setSelectionRange(at + ref.length, at + ref.length);
	}

	function dbl(e: MouseEvent) {
		const h = hit(e.clientX, e.clientY);
		if (h.area === 'col' && h.edge && !readonly) autofit('col', h.c);
		else if (h.area === 'row' && h.edge && !readonly) autofitRow(h.r);
		else if (h.area === 'cell' && !readonly) {
			view.select({ r: h.r, c: h.c });
			view.startEdit(null, 'edit');
			view.focusTick++;
		}
	}

	/** Row height that fits wrapped or multi-line text (default height when nothing needs more). */
	function autofitRow(r: number) {
		const rowsSel = view.isWholeRows() && view.indices('row').includes(r) ? view.indices('row') : [r];
		book.group(sheet.id, () => {
			for (const row of rowsSel) {
				let max = 0;
				for (const [k] of sheet.cells) {
					if (Math.floor(k / 16384) !== row) continue;
					const c = k % 16384;
					const d = book.display(sheet, row, c);
					if (!d.text) continue;
					const pt = d.style.size ?? 10;
					const lineH = (pt * 96) / 72 * 1.25;
					const w = Math.max(10, cols.size(c) - 8);
					const lines = d.text.split('\n').reduce((n, l) => n + (d.style.wrap ? Math.max(1, Math.ceil((textWidth(l, d.style) - 8) / w)) : 1), 0);
					max = Math.max(max, lines * lineH + 6);
				}
				book.resize(sheet.id, 'row', [row], max > DEFAULT_ROW_H ? Math.ceil(max) : undefined);
			}
		});
	}

	function autofit(axis: 'col', c: number) {
		measureCtx ??= document.createElement('canvas').getContext('2d');
		if (!measureCtx) return;
		let max = 0;
		for (const [k, cell] of sheet.cells) {
			if (keyCol(k) !== c || !cell) continue;
			const r = Math.floor(k / 16384);
			const d = book.display(sheet, r, c);
			if (!d.text) continue;
			const s = d.style;
			measureCtx.font = `${s.italic ? 'italic ' : ''}${s.bold ? '700 ' : ''}${s.size ? `${s.size}pt` : '10pt'} ${s.font ? `'${s.font}',` : ''}Arial, sans-serif`;
			max = Math.max(max, ...d.text.split('\n').map((l) => measureCtx!.measureText(l).width));
		}
		const sel = view.isWholeCols() && view.indices('col').includes(c) ? view.indices('col') : [c];
		book.resize(sheet.id, axis, sel, max ? Math.ceil(max + 12) : undefined);
	}

	function ctx(e: MouseEvent) {
		e.preventDefault();
		const h = hit(e.clientX, e.clientY);
		if (h.area === 'none' || h.area === 'corner') return;
		if (view.edit) view.commit();
		if (h.area === 'cell' && !view.ranges.some((g) => h.r >= g.r1 && h.r <= g.r2 && h.c >= g.c1 && h.c <= g.c2)) view.select({ r: h.r, c: h.c });
		if (h.area === 'col' && !fullSel('col', h.c)) view.selectCols(h.c, h.c);
		if (h.area === 'row' && !fullSel('row', h.r)) view.selectRows(h.r, h.r);
		oncontext(e, h.area === 'cell' ? 'cell' : h.area);
	}

	// ---------- Keyboard ----------

	/** Keyboard while a floating object is selected: Delete, Escape, arrows (Shift = 10 px), Enter = edit chart. */
	function objectKey(e: KeyboardEvent): boolean {
		const id = view.object;
		if (!id) return false;
		const o = book.object(sheet.id, id);
		if (!o) {
			view.object = null;
			return false;
		}
		const mod = e.ctrlKey || e.metaKey;
		if (mod && ['c', 'x', 'v', 'z', 'y'].includes(e.key.toLowerCase())) return false; // clipboard events / undo
		e.preventDefault();
		if (e.key === 'Escape') view.object = null;
		else if (readonly) return true;
		else if (e.key === 'Delete' || e.key === 'Backspace') {
			book.removeObject(sheet.id, id);
			view.object = null;
		} else if (e.key.startsWith('Arrow')) {
			const step = e.shiftKey ? 10 : 1;
			moveObject(id, e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
		} else if (e.key === 'Enter' && o.kind === 'chart') view.editingChart = id;
		return true;
	}

	function key(e: KeyboardEvent) {
		if (e.isComposing) return;
		const mod = e.ctrlKey || e.metaKey;
		const editing = view.edit;
		// Ctrl+Alt+O: keyboard access to floating objects (cycles through them and scrolls to the one selected).
		if (!editing && mod && e.altKey && e.key.toLowerCase() === 'o') {
			e.preventDefault();
			const list = sheet.objects;
			if (!list.length) return;
			const i = list.findIndex((o) => o.id === view.object);
			const next = list[(i + 1) % list.length];
			view.object = next.id;
			view.active = { r: next.anchor.r, c: next.anchor.c };
			view.reveal++;
			return;
		}
		if (!editing && objectKey(e)) return;
		if (editing) {
			if (fnQuery && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
				e.preventDefault();
				fnIndex = (fnIndex + (e.key === 'ArrowDown' ? 1 : -1) + fnQuery.list.length) % fnQuery.list.length;
				return;
			}
			if (fnQuery && e.key === 'Tab') {
				e.preventDefault();
				acceptFn(fnQuery.list[fnIndex]);
				return;
			}
			if (e.key === 'Enter' && e.altKey) {
				e.preventDefault();
				const pos = sink!.selectionStart ?? sink!.value.length;
				insertRef(pos, (sink!.selectionEnd ?? pos) - pos, '\n');
				return;
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				if (mod) view.commitAll();
				else {
					view.commit();
					view.enter(e.shiftKey);
				}
				return;
			}
			if (e.key === 'Tab') {
				e.preventDefault();
				view.commit();
				view.tab(e.shiftKey);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				view.cancel();
				return;
			}
			if (e.key === 'F2') {
				e.preventDefault();
				editing.mode = editing.mode === 'edit' ? 'enter' : 'edit';
				return;
			}
			if (editing.mode === 'enter' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !view.canPickRef(sink!.value)) {
				e.preventDefault();
				view.commit();
				arrow(e.key, e.shiftKey, mod);
			}
			return;
		}
		if (onshortcut(e)) return;
		switch (e.key) {
			case 'ArrowUp':
			case 'ArrowDown':
			case 'ArrowLeft':
			case 'ArrowRight':
				e.preventDefault();
				arrow(e.key, e.shiftKey, mod);
				return;
			case 'Enter':
				e.preventDefault();
				view.enter(e.shiftKey);
				return;
			case 'Tab':
				e.preventDefault();
				view.tab(e.shiftKey);
				return;
			case 'F2':
				e.preventDefault();
				if (!readonly) view.startEdit(null, 'edit');
				return;
			case 'Delete':
			case 'Backspace':
				e.preventDefault();
				if (!readonly) book.clear(sheet.id, view.ranges, 'contents');
				return;
			case 'Home':
				e.preventDefault();
				view.select(mod ? { r: 0, c: 0 } : { r: view.active.r, c: 0 }, { extend: e.shiftKey });
				return;
			case 'End':
				if (mod) {
					e.preventDefault();
					let maxR = 0;
					let maxC = 0;
					for (const k of sheet.cells.keys()) {
						maxR = Math.max(maxR, Math.floor(k / 16384));
						maxC = Math.max(maxC, k % 16384);
					}
					view.select({ r: maxR, c: maxC }, { extend: e.shiftKey });
				}
				return;
			case 'PageDown':
			case 'PageUp': {
				e.preventDefault();
				const n = Math.max(1, Math.floor((vh - HH - fh) / DEFAULT_ROW_H) - 1);
				view.move(e.key === 'PageDown' ? n : -n, 0, { extend: e.shiftKey });
				return;
			}
			case 'Escape':
				view.clip = null;
				return;
			case ' ':
				if (e.shiftKey && !mod) {
					e.preventDefault();
					view.selectRows(view.primary.r1, view.primary.r2);
					return;
				}
				if (mod && !e.shiftKey) {
					e.preventDefault();
					view.selectCols(view.primary.c1, view.primary.c2);
					return;
				}
		}
		if (mod && e.key.toLowerCase() === 'a') {
			e.preventDefault();
			view.selectAll();
		}
	}

	function arrow(k: string, shift: boolean, mod: boolean) {
		const dr = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
		const dc = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
		view.move(dr, dc, { extend: shift, jump: mod });
	}

	function input() {
		if (!sink) return;
		if (readonly) {
			sink.value = '';
			return;
		}
		if (!view.edit) view.startEdit(sink.value, 'enter');
		else view.edit.text = sink.value;
	}

	function compositionStart() {
		composing = true;
		if (!view.edit && !readonly) view.startEdit('', 'enter');
	}

	const OBJ_MARK = 'mai-object:';

	function onCopy(e: ClipboardEvent, cut: boolean) {
		if (view.edit) return;
		e.preventDefault();
		const o = view.object ? book.object(sheet.id, view.object) : undefined;
		if (o) {
			view.objClip = structuredClone($state.snapshot(o)) as SheetObject;
			e.clipboardData?.setData('text/plain', OBJ_MARK + o.id);
			if (cut && !readonly) {
				book.removeObject(sheet.id, o.id);
				view.object = null;
			}
			return;
		}
		const { text, html } = view.copy(cut && !readonly);
		e.clipboardData?.setData('text/plain', text);
		e.clipboardData?.setData('text/html', html);
	}

	function onPaste(e: ClipboardEvent) {
		if (view.edit || readonly) return;
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain');
		if (text?.startsWith(OBJ_MARK) && view.objClip) {
			const c = cloneObject(view.objClip, view.active);
			book.addObject(sheet.id, c);
			view.object = c.id;
			return;
		}
		const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
		if (files.length && !text) {
			void insertImages(view, files);
			return;
		}
		view.paste({ text, html: e.clipboardData?.getData('text/html') || undefined });
	}

	const clipRect = $derived(view.clip && view.clip.sheetId === sheet.id ? rectOf(view.clip.range) : null);
	const atBottom = $derived(sy + vh >= HH + rows.total + EXTRA - 4);
</script>

{#snippet cellList(list: CellBox[])}
	{#each list as b (b.key)}
		<div
			class="cell absolute box-border flex border-b border-grid px-1 leading-tight whitespace-pre {b.ow ? 'z-[1] overflow-visible' : 'overflow-hidden'} {b.nr ? '' : 'border-r'}"
			style="left:{b.x}px;top:{b.y}px;width:{b.w}px;height:{b.h}px;{styleCss(b.d.style, b.d.align, b.d.color)}"
			role="gridcell"
			aria-rowindex={b.r + 1}
			aria-colindex={b.c + 1}
		>
			{#if b.img}
				{@const u = urls.get(b.img.blobId)}
				{#if u}<img src={u} alt={b.img.alt ?? ''} draggable="false" class="pointer-events-none absolute inset-px h-[calc(100%-2px)] w-[calc(100%-2px)] select-none" style="object-fit:{b.img.fit}" />{/if}
			{/if}
			<span class="min-w-0 {b.d.style.wrap ? '' : b.ow ? 'shrink-0 overflow-hidden' : 'overflow-hidden text-ellipsis'}" class:pr-4={b.filterBtn} style={b.ow ? `width:${b.ow - 8}px` : ''}>{b.d.text}</span>
			{#if b.filterBtn}
				{@const crit = sheet.filter?.criteria[b.c]}
				<button
					data-filter-btn
					class="absolute top-1/2 right-0.5 grid size-4 -translate-y-1/2 place-items-center rounded-sm border border-line bg-surface text-[9px] {crit?.values || crit?.cond ? 'text-accent' : 'text-muted'}"
					aria-label={t().sheet.filter}
					onclick={(e) => {
						const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
						onfilter(b.c, r.left, r.bottom);
					}}>▼</button
				>
			{/if}
		</div>
	{/each}
{/snippet}

{#snippet overlays(p: { id: string })}
	{#each selRects as g, i (i)}
		<div class="pointer-events-none absolute bg-sel-fill" style="left:{g.x}px;top:{g.y}px;width:{g.w}px;height:{g.h}px" class:hidden={!multi && i === selRects.length - 1}></div>
	{/each}
	{#if primaryRect && multi}
		<div class="pointer-events-none absolute border border-sel" style="left:{primaryRect.x}px;top:{primaryRect.y}px;width:{primaryRect.w}px;height:{primaryRect.h}px"></div>
	{/if}
	{#each refRects as g, i (i)}
		<div class="pointer-events-none absolute border-2 border-dashed" style="left:{g.x}px;top:{g.y}px;width:{g.w}px;height:{g.h}px;border-color:{g.color};background:{g.color}14"></div>
	{/each}
	{#if clipRect}
		<div class="clip-ants pointer-events-none absolute" style="left:{clipRect.x}px;top:{clipRect.y}px;width:{clipRect.w}px;height:{clipRect.h}px"></div>
	{/if}
	{#if fillRect}
		<div class="pointer-events-none absolute border border-dashed border-sel" style="left:{fillRect.x}px;top:{fillRect.y}px;width:{fillRect.w}px;height:{fillRect.h}px"></div>
	{/if}
	{#if !view.edit}
		<div class="pointer-events-none absolute border-2 border-sel" style="left:{activeRect.x - 1}px;top:{activeRect.y - 1}px;width:{activeRect.w + 1}px;height:{activeRect.h + 1}px"></div>
	{/if}
	{#if primaryRect && !readonly && !view.edit && p.id !== 'none'}
		<div
			class="absolute z-10 size-[7px] cursor-crosshair border border-surface bg-sel"
			style="left:{primaryRect.x + primaryRect.w - 4}px;top:{primaryRect.y + primaryRect.h - 4}px"
			onpointerdown={fillDown}
			role="presentation"
		></div>
	{/if}
{/snippet}

<div class="relative min-h-0 flex-1">
	<div bind:this={scroller} class="grid-scroller absolute inset-0 overflow-auto" onscroll={onScroll}>
		<div class="relative" style="width:{HW + cols.total}px;height:{HH + rows.total + EXTRA}px">
			<div
				data-viewport
				class="sticky top-0 left-0 overflow-hidden bg-surface text-[10pt] text-fg select-none"
				style="width:{vw}px;height:{vh}px;touch-action:{drag && drag.kind !== 'touch' ? 'none' : 'auto'}"
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
				ondblclick={dbl}
				ondragover={(e) => e.dataTransfer?.types.includes('Files') && e.preventDefault()}
				ondrop={onDrop}
				oncontextmenu={ctx}
				role="grid"
				tabindex="-1"
				aria-label={sheet.name}
				aria-rowcount={sheet.rows}
				aria-colcount={sheet.cols}
			>
				{#each panes as p (p.id)}
					<div class="absolute overflow-hidden" style="left:{p.left}px;top:{p.top}px;width:{p.w}px;height:{p.h}px">
						<div class="absolute top-0 left-0" style="transform:translate({p.tx}px,{p.ty}px)">
							{#if p.id === 'body'}{@render cellList(bodyBoxes)}{:else if p.id === 'top'}{@render cellList(topBoxes)}{:else if p.id === 'left'}{@render cellList(leftBoxes)}{:else}{@render cellList(cornerBoxes)}{/if}
							{@render overlays(p)}
							<ObjectLayer {view} objects={paneObjects[p.id]} {rows} {cols} {readonly} {urls} {dataFor} />
						</div>
					</div>
				{/each}

				<!-- Column headers -->
				{#each [{ id: 'fc', cs: frozenCols, left: HW, w: fw, tx: 0 }, { id: 'bc', cs: bodyCols, left: HW + fw, w: Math.max(0, vw - HW - fw), tx: -(fw + sx) }] as hp (hp.id)}
					<div class="absolute top-0 overflow-hidden" style="left:{hp.left}px;width:{hp.w}px;height:{HH}px">
						<div class="absolute top-0 left-0" style="transform:translateX({hp.tx}px)">
							{#each hp.cs as c (c)}
								<div
									class="absolute top-0 box-border flex items-center justify-center border-r border-b border-grid text-xs {fullSel('col', c) ? 'bg-sel text-white' : inSel('col', c) ? 'bg-grid-head-active font-semibold text-fg' : 'bg-grid-head text-muted'}"
									style="left:{cols.offset(c)}px;width:{cols.size(c)}px;height:{HH}px"
									role="columnheader"
								>
									{colName(c)}
								</div>
							{/each}
						</div>
					</div>
				{/each}
				<!-- Row headers -->
				{#each [{ id: 'fr', rs: frozenRows, top: HH, h: fh, ty: 0 }, { id: 'br', rs: bodyRows, top: HH + fh, h: Math.max(0, vh - HH - fh), ty: -(fh + sy) }] as hp (hp.id)}
					<div class="absolute left-0 overflow-hidden" style="top:{hp.top}px;width:{HW}px;height:{hp.h}px">
						<div class="absolute top-0 left-0" style="transform:translateY({hp.ty}px)">
							{#each hp.rs as r (r)}
								<div
									class="absolute left-0 box-border flex items-center justify-center border-r border-b border-grid text-xs {fullSel('row', r) ? 'bg-sel text-white' : inSel('row', r) ? 'bg-grid-head-active font-semibold text-fg' : 'bg-grid-head text-muted'}"
									style="top:{rows.offset(r)}px;height:{rows.size(r)}px;width:{HW}px"
									role="rowheader"
								>
									{r + 1}
								</div>
							{/each}
							{#if hp.id === 'br'}
								<div class="absolute left-0 flex items-center" style="top:{rows.total}px;height:{EXTRA}px">
									{#if !readonly && atBottom}
										<button data-add-rows class="btn ml-2 !py-0.5 text-xs whitespace-nowrap" onclick={() => book.addRows(sheet.id, 1000)}>{t().sheet.addRows(1000)}</button>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{/each}
				<!-- Corner -->
				<button class="absolute top-0 left-0 border-r border-b border-grid bg-grid-head" style="width:{HW}px;height:{HH}px" aria-label={t().sheet.selectAll} onclick={() => view.selectAll()}></button>
				<!-- Frozen separators -->
				{#if fr > 0}<div class="pointer-events-none absolute left-0 h-[2px] bg-faint/60" style="top:{HH + fh - 1}px;width:{vw}px"></div>{/if}
				{#if fc > 0}<div class="pointer-events-none absolute top-0 w-[2px] bg-faint/60" style="left:{HW + fw - 1}px;height:{vh}px"></div>{/if}
				{#if live}
					<div class="pointer-events-none absolute bg-sel" style={live.axis === 'col' ? `left:${screenX(live.index, cols.offset(live.index + 1)) - 1}px;top:0;width:2px;height:${vh}px` : `top:${screenY(live.index, rows.offset(live.index + 1)) - 1}px;left:0;height:2px;width:${vw}px`}></div>
				{/if}

				<!-- Editor / input sink -->
				<textarea
					bind:this={sink}
					class="absolute z-20 resize-none overflow-hidden border-2 border-sel bg-surface px-1 text-[10pt] leading-tight whitespace-pre text-fg outline-none {view.edit && view.edit.from === 'cell' ? '' : 'pointer-events-none opacity-0'}"
					style="left:{editRect.x - 1}px;top:{editRect.y - 1}px;min-width:{editRect.w + 1}px;min-height:{editRect.h + 1}px;{view.edit ? `${editSize}max-width:${Math.max(editRect.w + 1, vw - editRect.x - 4)}px;` : 'width:2px;height:2px;'}{editStyle}"
					spellcheck="false"
					autocomplete="off"
					autocapitalize="off"
					aria-label={t().sheet.formulaBar}
					readonly={readonly}
					onkeydown={key}
					oninput={() => (input(), trackCaret())}
					onkeyup={trackCaret}
					onclick={trackCaret}
					oncompositionstart={compositionStart}
					oncompositionend={() => {
						composing = false;
						input();
					}}
					oncopy={(e) => onCopy(e, false)}
					oncut={(e) => onCopy(e, true)}
					onpaste={onPaste}
				></textarea>
				{#if sigHint && view.edit}
					<div class="pointer-events-none absolute z-30 max-w-[min(32rem,90vw)] rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs text-muted shadow-lg" style="left:{editRect.x}px;top:{editRect.y + editRect.h + 2}px" role="status">
						<span class="font-semibold text-fg">{sigHint.name}</span>(
						{#each sigHint.parts as part, i (i)}
							<span class={i === sigHint.current ? 'font-semibold text-accent' : ''}>{part}</span>{i < sigHint.parts.length - 1 ? ', ' : ''}
						{/each})
					</div>
				{/if}
				{#if fnQuery && view.edit?.from === 'cell'}
					<div data-fn-list class="menu absolute z-30 !min-w-36 py-0.5 text-xs" style="left:{editRect.x}px;top:{editRect.y + editRect.h + 2}px" role="listbox">
						{#each fnQuery.list as name, i (name)}
							<button
								class="menu-item !py-1 font-mono !text-xs {i === fnIndex ? 'bg-accent-soft text-accent' : ''}"
								role="option"
								aria-selected={i === fnIndex}
								onpointerdown={(e) => {
									e.preventDefault();
									acceptFn(name);
								}}>{name}</button
							>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	/* Each cell has a fixed box: isolate its layout/paint so adding/removing cells stays cheap. */
	:global(.cell) {
		contain: layout paint style;
	}
	:global(.cell.overflow-visible) {
		contain: layout style;
	}
	.grid-scroller {
		scrollbar-width: thin;
	}
	.clip-ants {
		background:
			linear-gradient(90deg, var(--c-sel) 50%, transparent 50%) repeat-x top / 8px 2px,
			linear-gradient(90deg, var(--c-sel) 50%, transparent 50%) repeat-x bottom / 8px 2px,
			linear-gradient(0deg, var(--c-sel) 50%, transparent 50%) repeat-y left / 2px 8px,
			linear-gradient(0deg, var(--c-sel) 50%, transparent 50%) repeat-y right / 2px 8px;
		animation: ants 0.6s linear infinite;
	}
	@keyframes ants {
		to {
			background-position:
				8px top,
				-8px bottom,
				left -8px,
				right 8px;
		}
	}
</style>
