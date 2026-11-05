// Spreadsheet commands shared by the toolbar, context menu and keyboard shortcuts.
import { i18n, t } from '../i18n/index.svelte.ts';
import { toast } from '../client/toast.svelte.ts';
import { changeDecimals, presetCode, type FmtPreset } from './format.ts';
import { usedRange, type BorderSide, type CellStyle } from './model.ts';
import type { SheetView } from './view.svelte.ts';

export type BorderPreset = 'all' | 'outer' | 'top' | 'bottom' | 'left' | 'right' | 'none';

export function toggleStyle(v: SheetView, key: 'bold' | 'italic' | 'underline' | 'strike' | 'wrap') {
	const on = !v.styleHere[key];
	v.book.setStyle(v.sheet.id, v.ranges, { [key]: on || undefined });
}

export function setStyle(v: SheetView, patch: Partial<CellStyle>) {
	v.book.setStyle(v.sheet.id, v.ranges, patch);
}

export function setNumFmt(v: SheetView, preset: FmtPreset | { code: string }) {
	const code = typeof preset === 'string' ? presetCode(preset, i18n.locale) : preset.code;
	v.book.setStyle(v.sheet.id, v.ranges, { numFmt: code });
}

export function decimals(v: SheetView, delta: 1 | -1) {
	const s = v.sheet;
	v.book.setStyle(v.sheet.id, v.ranges, (st, r, c) => {
		const val = v.book.cell(s, r, c)?.v;
		if (typeof val !== 'number' && !st.numFmt) return st;
		return { ...st, numFmt: changeDecimals(st.numFmt, val, delta) };
	});
}

export function borders(v: SheetView, preset: BorderPreset, color = '#000000') {
	const side: BorderSide = { style: 'thin', color };
	const ranges = v.book.clampRanges(v.sheet, v.ranges);
	v.book.setStyle(v.sheet.id, ranges, (st, r, c) => {
		const g = ranges.find((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2)!;
		const b = { ...(st.border ?? {}) };
		switch (preset) {
			case 'none':
				return { ...st, border: undefined };
			case 'all':
				return { ...st, border: { top: side, bottom: side, left: side, right: side } };
			case 'outer':
				if (r === g.r1) b.top = side;
				if (r === g.r2) b.bottom = side;
				if (c === g.c1) b.left = side;
				if (c === g.c2) b.right = side;
				break;
			case 'top':
				if (r === g.r1) b.top = side;
				break;
			case 'bottom':
				if (r === g.r2) b.bottom = side;
				break;
			case 'left':
				if (c === g.c1) b.left = side;
				break;
			case 'right':
				if (c === g.c2) b.right = side;
				break;
		}
		return { ...st, border: b };
	});
}

export function mergeToggle(v: SheetView) {
	const s = v.sheet;
	const g = v.primary;
	const merged = s.merges.some((m) => m.r1 <= g.r2 && g.r1 <= m.r2 && m.c1 <= g.c2 && g.c1 <= m.c2);
	if (merged) v.book.unmerge(s.id, v.ranges);
	else {
		let lost = false;
		for (const [k, c] of s.cells) {
			const r = Math.floor(k / 16384);
			const col = k % 16384;
			if (r >= g.r1 && r <= g.r2 && col >= g.c1 && col <= g.c2 && !(r === g.r1 && col === g.c1) && (c.f || (c.v !== undefined && c.v !== null && c.v !== ''))) lost = true;
		}
		v.book.merge(s.id, v.book.clampRanges(s, v.ranges));
		if (lost) toast.info(t().sheet.mergeLoses);
		v.selectRange(v.book.clampRanges(s, [g])[0]);
	}
}

export function freeze(v: SheetView, rows: number, cols: number) {
	v.book.setFreeze(v.sheet.id, rows, cols);
}

/** Range to sort/filter: the selection, or the used block around the active cell when a single cell is selected. */
export function dataRange(v: SheetView) {
	const g = v.primary;
	const s = v.sheet;
	if (g.r1 !== g.r2 || g.c1 !== g.c2) return v.book.clampRanges(s, [g])[0];
	return usedRange(s, true) ?? g;
}

export function sort(v: SheetView, desc: boolean) {
	const g = dataRange(v);
	const header = g.r1 === 0 && hasHeader(v, g);
	v.book.sort(v.sheet.id, g, v.active.c, desc, header);
}

/** Heuristic: first row is text and the second has at least one number, or the filter range header. */
function hasHeader(v: SheetView, g: { r1: number; c1: number; c2: number }) {
	const s = v.sheet;
	if (s.filter && s.filter.range.r1 === g.r1) return true;
	let text = 0;
	let nums = 0;
	for (let c = g.c1; c <= g.c2; c++) {
		const a = v.book.cell(s, g.r1, c)?.v;
		const b = v.book.cell(s, g.r1 + 1, c)?.v;
		if (typeof a === 'string') text++;
		if (typeof b === 'number') nums++;
	}
	return text > 0 && nums > 0;
}

export function toggleFilter(v: SheetView) {
	const s = v.sheet;
	if (s.filter) v.book.setFilter(s.id, undefined);
	else v.book.setFilter(s.id, { range: dataRange(v), criteria: {} });
}

export function insert(v: SheetView, axis: 'row' | 'col', after: boolean) {
	const idx = v.indices(axis);
	const count = Math.max(1, Math.min(idx.length, 1000));
	const at = after ? idx[idx.length - 1] + 1 : idx[0];
	v.book.insert(v.sheet.id, axis, at, count);
}

export function remove(v: SheetView, axis: 'row' | 'col') {
	const idx = v.indices(axis);
	if (!idx.length) return;
	// Contiguous blocks from the end so indices stay valid.
	const blocks: [number, number][] = [];
	for (const i of idx) {
		const last = blocks[blocks.length - 1];
		if (last && i === last[0] + last[1]) last[1]++;
		else blocks.push([i, 1]);
	}
	v.book.group(v.sheet.id, () => {
		for (const [at, n] of blocks.reverse()) v.book.remove(v.sheet.id, axis, at, n);
	});
	v.selectRange({ r1: v.active.r, c1: v.active.c, r2: v.active.r, c2: v.active.c });
}

/** Keyboard shortcuts while the grid has focus (not editing). Returns true when handled. */
export function shortcut(v: SheetView, e: KeyboardEvent, readonly: boolean): boolean {
	const mod = e.ctrlKey || e.metaKey;
	if (!mod) return false;
	const k = e.key.toLowerCase();
	if (k === 'z' && !e.shiftKey) {
		e.preventDefault();
		v.book.undo();
		return true;
	}
	if (k === 'y' || (k === 'z' && e.shiftKey)) {
		e.preventDefault();
		v.book.redo();
		return true;
	}
	if (readonly) return false;
	if (k === 'b' || k === 'i' || k === 'u') {
		e.preventDefault();
		toggleStyle(v, k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
		return true;
	}
	if (k === '5' && !e.shiftKey) {
		e.preventDefault();
		toggleStyle(v, 'strike');
		return true;
	}
	return false;
}
