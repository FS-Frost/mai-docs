// Slide tables: pure operations on TableEl (rows/cols, merge/split). Merged blocks: the top-left cell has
// colSpan/rowSpan, covered cells are `hidden`. Structural ops unmerge blocks they cut through.
import type { JSONContent } from '@tiptap/core';
import { uid, type TableCell, type TableEl } from './model.ts';

export type CellRange = { r1: number; c1: number; r2: number; c2: number };

export function newTable(rows: number, cols: number, x: number, y: number, w: number): TableEl {
	const cw = Math.round(w / cols);
	return {
		id: uid(),
		kind: 'table',
		x,
		y,
		w: cw * cols,
		h: rows * 40,
		rot: 0,
		cols: Array.from({ length: cols }, () => cw),
		rows: Array.from({ length: rows }, () => 40),
		cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({}) as TableCell)),
		border: { color: 'dk2', width: 1 },
		textStyle: { font: 'minor', size: 14, color: 'dk1' },
		firstRow: true,
		bandRow: true
	};
}

const sum = (a: number[]) => a.reduce((n, v) => n + v, 0);
const clone = (t: TableEl): TableEl => ({ ...t, cols: [...t.cols], rows: [...t.rows], cells: t.cells.map((r) => r.map((c) => ({ ...c }))) });
const fit = (t: TableEl): TableEl => ({ ...t, w: Math.round(sum(t.cols)), h: Math.max(t.h, Math.round(sum(t.rows))) });

/** Removes every merge (spans and hidden flags). */
function unmergeAll(t: TableEl) {
	for (const row of t.cells)
		for (const c of row) {
			delete c.colSpan;
			delete c.rowSpan;
			delete c.hidden;
		}
}

/** Merged blocks as ranges. */
export function blocks(t: TableEl): CellRange[] {
	const out: CellRange[] = [];
	t.cells.forEach((row, r) =>
		row.forEach((c, k) => {
			if ((c.colSpan ?? 1) > 1 || (c.rowSpan ?? 1) > 1) out.push({ r1: r, c1: k, r2: r + (c.rowSpan ?? 1) - 1, c2: k + (c.colSpan ?? 1) - 1 });
		})
	);
	return out;
}

function remerge(t: TableEl, list: CellRange[]) {
	unmergeAll(t);
	for (const b of list) mergeInPlace(t, b);
}

export function insertRow(src: TableEl, at: number): TableEl {
	const t = clone(src);
	const keep = blocks(t)
		.filter((b) => !(b.r1 < at && b.r2 >= at))
		.map((b) => (b.r1 >= at ? { ...b, r1: b.r1 + 1, r2: b.r2 + 1 } : b));
	const h = t.rows[Math.min(at, t.rows.length - 1)] ?? 40;
	t.rows.splice(at, 0, h);
	t.cells.splice(at, 0, t.cols.map(() => ({})));
	remerge(t, keep);
	return { ...fit(t), h: src.h + h };
}

export function deleteRow(src: TableEl, at: number): TableEl {
	if (src.rows.length <= 1) return src;
	const t = clone(src);
	const keep = blocks(t)
		.filter((b) => !(b.r1 <= at && b.r2 >= at))
		.map((b) => (b.r1 > at ? { ...b, r1: b.r1 - 1, r2: b.r2 - 1 } : b));
	const [h] = t.rows.splice(at, 1);
	t.cells.splice(at, 1);
	remerge(t, keep);
	return { ...fit(t), h: Math.max(sum(t.rows), src.h - h) };
}

export function insertCol(src: TableEl, at: number): TableEl {
	const t = clone(src);
	const keep = blocks(t)
		.filter((b) => !(b.c1 < at && b.c2 >= at))
		.map((b) => (b.c1 >= at ? { ...b, c1: b.c1 + 1, c2: b.c2 + 1 } : b));
	// The new column takes its share from the others so the table keeps its width.
	const n = t.cols.length + 1;
	const w = sum(t.cols);
	t.cols = t.cols.map((c) => (c * (n - 1)) / n);
	t.cols.splice(at, 0, w / n);
	t.cols = t.cols.map((c) => Math.round(c));
	for (const row of t.cells) row.splice(at, 0, {});
	remerge(t, keep);
	return fit(t);
}

export function deleteCol(src: TableEl, at: number): TableEl {
	if (src.cols.length <= 1) return src;
	const t = clone(src);
	const keep = blocks(t)
		.filter((b) => !(b.c1 <= at && b.c2 >= at))
		.map((b) => (b.c1 > at ? { ...b, c1: b.c1 - 1, c2: b.c2 - 1 } : b));
	const w = sum(t.cols);
	t.cols.splice(at, 1);
	const k = w / sum(t.cols);
	t.cols = t.cols.map((c) => Math.round(c * k));
	for (const row of t.cells) row.splice(at, 1);
	remerge(t, keep);
	return fit(t);
}

function mergeInPlace(t: TableEl, b: CellRange) {
	const top = t.cells[b.r1][b.c1];
	for (let r = b.r1; r <= b.r2; r++)
		for (let c = b.c1; c <= b.c2; c++) {
			if (r === b.r1 && c === b.c1) continue;
			t.cells[r][c] = { hidden: true };
		}
	top.colSpan = b.c2 - b.c1 + 1;
	top.rowSpan = b.r2 - b.r1 + 1;
	if (top.colSpan === 1) delete top.colSpan;
	if (top.rowSpan === 1) delete top.rowSpan;
}

/** Grows a range so it contains every merged block it touches. */
export function expand(t: TableEl, g: CellRange): CellRange {
	let r = { r1: Math.min(g.r1, g.r2), c1: Math.min(g.c1, g.c2), r2: Math.max(g.r1, g.r2), c2: Math.max(g.c1, g.c2) };
	for (let changed = true; changed; ) {
		changed = false;
		for (const b of blocks(t)) {
			const hit = b.r1 <= r.r2 && b.r2 >= r.r1 && b.c1 <= r.c2 && b.c2 >= r.c1;
			if (hit && (b.r1 < r.r1 || b.c1 < r.c1 || b.r2 > r.r2 || b.c2 > r.c2)) {
				r = { r1: Math.min(r.r1, b.r1), c1: Math.min(r.c1, b.c1), r2: Math.max(r.r2, b.r2), c2: Math.max(r.c2, b.c2) };
				changed = true;
			}
		}
	}
	return r;
}

/** Merges a range; the texts of the covered cells are appended to the top-left one. */
export function merge(src: TableEl, g: CellRange): TableEl {
	const b = expand(src, g);
	if (b.r1 === b.r2 && b.c1 === b.c2) return src;
	const t = clone(src);
	const content: JSONContent[] = [];
	for (let r = b.r1; r <= b.r2; r++)
		for (let c = b.c1; c <= b.c2; c++) {
			const cell = t.cells[r][c];
			if (!cell.hidden && cell.text?.content?.some((n) => n.content?.length)) content.push(...(cell.text.content ?? []));
		}
	const keep = blocks(t).filter((x) => !(x.r1 >= b.r1 && x.r2 <= b.r2 && x.c1 >= b.c1 && x.c2 <= b.c2));
	remerge(t, keep);
	t.cells[b.r1][b.c1] = { ...t.cells[b.r1][b.c1], text: content.length ? { type: 'doc', content } : undefined };
	mergeInPlace(t, b);
	return t;
}

/** Splits the merged block whose top-left cell is (r, c). */
export function split(src: TableEl, r: number, c: number): TableEl {
	const cell = src.cells[r]?.[c];
	if (!cell || ((cell.colSpan ?? 1) === 1 && (cell.rowSpan ?? 1) === 1)) return src;
	const t = clone(src);
	remerge(
		t,
		blocks(t).filter((b) => !(b.r1 === r && b.c1 === c))
	);
	return t;
}

/** Top-left cell of the block containing (r, c). */
export function owner(t: TableEl, r: number, c: number): { r: number; c: number } {
	for (const b of blocks(t)) if (r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2) return { r: b.r1, c: b.c1 };
	return { r, c };
}

export function setCell(src: TableEl, r: number, c: number, p: Partial<TableCell>): TableEl {
	return { ...src, cells: src.cells.map((row, i) => (i === r ? row.map((cell, k) => (k === c ? { ...cell, ...p } : cell)) : row)) };
}

/** Applies a patch to every visible cell of a range. */
export function setCells(src: TableEl, g: CellRange, p: Partial<TableCell>): TableEl {
	const b = expand(src, g);
	return { ...src, cells: src.cells.map((row, r) => row.map((cell, c) => (r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2 && !cell.hidden ? { ...cell, ...p } : cell))) };
}

/** Scales columns/rows when the table box is resized. */
export function scaleTable(t: TableEl, w: number, h: number): TableEl {
	const kw = w / Math.max(1, sum(t.cols));
	const kh = h / Math.max(1, sum(t.rows));
	return { ...t, w, h, cols: t.cols.map((c) => Math.max(8, Math.round(c * kw))), rows: t.rows.map((r) => Math.max(8, Math.round(r * kh))) };
}

/** Logical position of the cell under a point in table-local coordinates. */
export function cellAt(t: TableEl, x: number, y: number): { r: number; c: number } | null {
	if (x < 0 || y < 0) return null;
	let c = -1;
	for (let i = 0, at = 0; i < t.cols.length; i++) {
		at += t.cols[i];
		if (x < at) {
			c = i;
			break;
		}
	}
	const kh = t.h / Math.max(1, sum(t.rows));
	let r = -1;
	for (let i = 0, at = 0; i < t.rows.length; i++) {
		at += t.rows[i] * kh;
		if (y < at) {
			r = i;
			break;
		}
	}
	if (r < 0 || c < 0) return null;
	return owner(t, r, c);
}

/** Box of a cell (with spans) in table-local coordinates. */
export function cellBox(t: TableEl, r: number, c: number) {
	const cell = t.cells[r][c];
	const kh = t.h / Math.max(1, sum(t.rows));
	const x = sum(t.cols.slice(0, c));
	const y = sum(t.rows.slice(0, r)) * kh;
	return { x, y, w: sum(t.cols.slice(c, c + (cell.colSpan ?? 1))), h: sum(t.rows.slice(r, r + (cell.rowSpan ?? 1))) * kh };
}
