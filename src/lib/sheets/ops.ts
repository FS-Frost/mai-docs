// Workbook mutations. Cell edits are diffs with an exact inverse; structural changes (insert/delete,
// sheets, sort) mutate in place and are undone by restoring a snapshot (see book.svelte.ts).
import { cellKey, keyCol, keyRow, MAX_COLS, MAX_ROWS, type Range } from './addr.ts';
import { adjustFormula, deleteSheetInFormula, renameSheetInFormula, shiftFormula, type Structural } from './formula/refs.ts';
import { compare, isErr, type Scalar } from './values.ts';
import {
	fromContent,
	getSheet,
	newSheet,
	sheetFromJSON,
	sheetToJSON,
	type Cell,
	type Sheet,
	type Workbook,
	type ChartObject,
	type WorkbookContent
} from './model.ts';

export type CellChange = [key: number, cell: Cell | undefined];

/** Applies cell changes; returns the inverse changes. */
export function applyCells(sheet: Sheet, changes: CellChange[]): CellChange[] {
	const inverse: CellChange[] = [];
	for (const [k, c] of changes) {
		const prev = sheet.cells.get(k);
		inverse.push([k, prev ? { ...prev } : undefined]);
		if (c && (c.f || c.img || (c.v !== undefined && c.v !== null && c.v !== '') || c.s)) sheet.cells.set(k, { ...c });
		else sheet.cells.delete(k);
	}
	return inverse.reverse();
}

/** Restores a snapshot in place (keeps the same Workbook object). */
export function restore(wb: Workbook, content: WorkbookContent) {
	const w = fromContent(structuredClone(content));
	wb.sheets = w.sheets;
	wb.styles = w.styles;
	wb.active = w.active;
}

// ---------- Rows / columns ----------

function forEachChart(wb: Workbook, fn: (s: Sheet, ch: ChartObject) => void) {
	for (const s of wb.sheets) for (const o of s.objects) if (o.kind === 'chart') fn(s, o);
}

function forEachFormula(wb: Workbook, fn: (s: Sheet, k: number, c: Cell) => void) {
	for (const s of wb.sheets) for (const [k, c] of s.cells) if (c.f) fn(s, k, c);
}

function shiftMap<T>(m: Map<number, T>, at: number, count: number, kind: 'insert' | 'delete') {
	const out = new Map<number, T>();
	for (const [i, v] of m) {
		if (kind === 'insert') out.set(i >= at ? i + count : i, v);
		else if (i < at) out.set(i, v);
		else if (i >= at + count) out.set(i - count, v);
	}
	return out;
}

function shiftRange(g: Range, axis: 'row' | 'col', at: number, count: number, kind: 'insert' | 'delete'): Range | null {
	const [lo, hi] = axis === 'row' ? [g.r1, g.r2] : [g.c1, g.c2];
	let nlo = lo;
	let nhi = hi;
	if (kind === 'insert') {
		if (lo >= at) nlo += count;
		if (hi >= at) nhi += count;
	} else {
		const d2 = at + count - 1;
		if (lo >= at && hi <= d2) return null;
		if (lo > d2) nlo = lo - count;
		else if (lo >= at) nlo = at;
		if (hi > d2) nhi = hi - count;
		else if (hi >= at) nhi = at - 1;
	}
	return axis === 'row' ? { ...g, r1: nlo, r2: nhi } : { ...g, c1: nlo, c2: nhi };
}

export function insertOrDelete(wb: Workbook, sheetId: string, axis: 'row' | 'col', at: number, count: number, kind: 'insert' | 'delete') {
	const sheet = getSheet(wb, sheetId);
	if (!sheet || count <= 0) return;
	const op: Structural = { sheetName: sheet.name, axis, at, count, kind };
	// 1. Rewrite formulas everywhere (before moving cells, using each formula's own sheet name).
	forEachFormula(wb, (s, _k, c) => {
		c.f = adjustFormula(c.f!, s.name, op);
	});
	// 2. Move cells of this sheet.
	const cells = new Map<number, Cell>();
	for (const [k, c] of sheet.cells) {
		const r = keyRow(k);
		const col = keyCol(k);
		const i = axis === 'row' ? r : col;
		let ni = i;
		if (kind === 'insert') ni = i >= at ? i + count : i;
		else if (i >= at && i < at + count) continue;
		else if (i >= at + count) ni = i - count;
		const max = axis === 'row' ? MAX_ROWS : MAX_COLS;
		if (ni >= max) continue;
		cells.set(axis === 'row' ? cellKey(ni, col) : cellKey(r, ni), c);
	}
	sheet.cells = cells;
	// 3. Sizes, merges, freeze, filter, dimensions.
	if (axis === 'row') sheet.rowHeights = shiftMap(sheet.rowHeights, at, count, kind);
	else sheet.colWidths = shiftMap(sheet.colWidths, at, count, kind);
	sheet.merges = sheet.merges.map((m) => shiftRange(m, axis, at, count, kind)).filter((m): m is Range => !!m && (m.r1 !== m.r2 || m.c1 !== m.c2));
	if (sheet.filter) {
		const r = shiftRange(sheet.filter.range, axis, at, count, kind);
		if (!r) sheet.filter = undefined;
		else {
			const crit: typeof sheet.filter.criteria = {};
			for (const [c, v] of Object.entries(sheet.filter.criteria)) {
				const ci = Number(c);
				if (axis === 'col') {
					if (kind === 'insert') crit[ci >= at ? ci + count : ci] = v;
					else if (ci < at) crit[ci] = v;
					else if (ci >= at + count) crit[ci - count] = v;
				} else crit[ci] = v;
			}
			sheet.filter = { range: r, criteria: crit };
		}
	}
	// Floating objects follow their anchor cell; if it is deleted they move to the first surviving one.
	const ak = axis === 'row' ? 'r' : 'c';
	const dk = axis === 'row' ? 'dy' : 'dx';
	for (const o of sheet.objects) {
		const i = o.anchor[ak];
		if (kind === 'insert') {
			if (i >= at) o.anchor[ak] = i + count;
		} else if (i >= at && i < at + count) {
			o.anchor[ak] = at;
			o.anchor[dk] = 0;
		} else if (i >= at + count) o.anchor[ak] = i - count;
	}
	// Chart sources anywhere are rewritten like formulas.
	forEachChart(wb, (s, ch) => {
		ch.source.range = adjustFormula(ch.source.range, s.name, op);
	});
	const f = axis === 'row' ? 'rows' : 'cols';
	if (sheet.freeze[f] > at) sheet.freeze[f] = kind === 'insert' ? sheet.freeze[f] + count : Math.max(at, sheet.freeze[f] - count);
	const dim = axis === 'row' ? 'rows' : 'cols';
	const max = axis === 'row' ? MAX_ROWS : MAX_COLS;
	sheet[dim] = Math.max(1, Math.min(max, kind === 'insert' ? sheet[dim] + count : sheet[dim] - count));
}

// ---------- Sheets ----------

export function addSheet(wb: Workbook, name: string, index = wb.sheets.length): Sheet {
	const s = newSheet(name);
	wb.sheets.splice(index, 0, s);
	wb.active = s.id;
	return s;
}

export function duplicateSheet(wb: Workbook, id: string, name: string) {
	const src = getSheet(wb, id);
	if (!src) return;
	const j = sheetToJSON(src);
	const copy = sheetFromJSON({ ...structuredClone(j), id: crypto.randomUUID(), name });
	// Formulas that name their own sheet explicitly should point to the copy.
	for (const c of copy.cells.values()) if (c.f) c.f = renameSheetInFormula(c.f, src.name, name);
	for (const o of copy.objects) {
		o.id = crypto.randomUUID();
		if (o.kind === 'chart') o.source.range = renameSheetInFormula(o.source.range, src.name, name);
	}
	wb.sheets.splice(wb.sheets.indexOf(src) + 1, 0, copy);
	wb.active = copy.id;
	return copy;
}

export function renameSheet(wb: Workbook, id: string, name: string) {
	const s = getSheet(wb, id);
	if (!s) return;
	const old = s.name;
	forEachFormula(wb, (_s, _k, c) => {
		c.f = renameSheetInFormula(c.f!, old, name);
	});
	forEachChart(wb, (_s, ch) => {
		ch.source.range = renameSheetInFormula(ch.source.range, old, name);
	});
	s.name = name;
}

export function deleteSheet(wb: Workbook, id: string) {
	const i = wb.sheets.findIndex((s) => s.id === id);
	if (i < 0 || wb.sheets.length <= 1) return;
	const [s] = wb.sheets.splice(i, 1);
	forEachFormula(wb, (_s, _k, c) => {
		c.f = deleteSheetInFormula(c.f!, s.name);
	});
	forEachChart(wb, (_s, ch) => {
		ch.source.range = deleteSheetInFormula(ch.source.range, s.name);
	});
	if (wb.active === id) wb.active = wb.sheets[Math.max(0, i - 1)].id;
}

export function moveSheet(wb: Workbook, id: string, to: number) {
	const i = wb.sheets.findIndex((s) => s.id === id);
	if (i < 0) return;
	const [s] = wb.sheets.splice(i, 1);
	wb.sheets.splice(Math.max(0, Math.min(wb.sheets.length, to)), 0, s);
}

// ---------- Sort ----------

/** Sorts rows of `range` by column `col` (absolute index). Stable; blanks last; formulas move with their row. */
export function sortRange(sheet: Sheet, range: Range, col: number, desc: boolean, header: boolean): CellChange[] {
	const r1 = range.r1 + (header ? 1 : 0);
	if (r1 >= range.r2) return [];
	const rows: { r: number; key: Scalar | undefined }[] = [];
	for (let r = r1; r <= range.r2; r++) {
		const v = sheet.cells.get(cellKey(r, col))?.v;
		rows.push({ r, key: v === undefined || v === null || v === '' ? undefined : isErr(v) ? undefined : (v as Scalar) });
	}
	const sorted = [...rows].sort((a, b) => {
		if (a.key === undefined && b.key === undefined) return a.r - b.r;
		if (a.key === undefined) return 1;
		if (b.key === undefined) return -1;
		const k = compare(a.key, b.key);
		return (desc ? -k : k) || a.r - b.r;
	});
	const changes: CellChange[] = [];
	sorted.forEach((src, i) => {
		const dst = r1 + i;
		for (let c = range.c1; c <= range.c2; c++) {
			const cell = sheet.cells.get(cellKey(src.r, c));
			const moved = cell ? { ...cell, f: cell.f ? shiftFormula(cell.f, dst - src.r, 0) : undefined } : undefined;
			if (moved && !moved.f) delete moved.f;
			changes.push([cellKey(dst, c), moved]);
		}
	});
	return changes;
}

// ---------- Fill (drag handle) ----------

/** Values to fill `target` (which extends `source` in one direction) like Excel: series or copies. */
export function fillChanges(sheet: Sheet, source: Range, target: Range, dateLike: (c: Cell) => boolean = () => false): CellChange[] {
	const changes: CellChange[] = [];
	const vertical = target.c1 === source.c1 && target.c2 === source.c2;
	const forward = vertical ? target.r2 > source.r2 : target.c2 > source.c2;
	const lines = vertical ? source.c2 - source.c1 + 1 : source.r2 - source.r1 + 1;
	const len = vertical ? source.r2 - source.r1 + 1 : source.c2 - source.c1 + 1;
	for (let l = 0; l < lines; l++) {
		const at = (i: number) => (vertical ? { r: source.r1 + i, c: source.c1 + l } : { r: source.r1 + l, c: source.c1 + i });
		const src = Array.from({ length: len }, (_, i) => sheet.cells.get(cellKey(at(i).r, at(i).c)));
		const nums = src.map((c) => (c && !c.f && typeof c.v === 'number' ? c.v : null));
		const allNum = len >= 2 && nums.every((n) => n !== null);
		const step = allNum ? linearStep(nums as number[]) : len === 1 && nums[0] !== null && src[0] && dateLike(src[0]) ? 1 : null;
		const textNum = src.map((c) => (c && !c.f && typeof c.v === 'string' ? /^(.*?)(\d+)$/.exec(c.v) : null));
		const tgtStart = vertical ? (forward ? source.r2 + 1 : target.r1) : forward ? source.c2 + 1 : target.c1;
		const tgtEnd = vertical ? (forward ? target.r2 : source.r1 - 1) : forward ? target.c2 : source.c1 - 1;
		const base = vertical ? source.r1 : source.c1;
		for (let p = tgtStart; p <= tgtEnd; p++) {
			const off = p - base; // position relative to source start (may be negative)
			const si = ((off % len) + len) % len;
			const s = src[si];
			const key = vertical ? cellKey(p, source.c1 + l) : cellKey(source.r1 + l, p);
			if (!s) {
				changes.push([key, undefined]);
				continue;
			}
			const cell: Cell = { ...s };
			if (s.f) {
				const delta = p - (base + si);
				cell.f = vertical ? shiftFormula(s.f, delta, 0) : shiftFormula(s.f, 0, delta);
			} else if (step !== null) {
				cell.v = (nums[0] as number) + step * off;
			} else if (len === 1 && textNum[0] && typeof s.v === 'string') {
				const m = textNum[0];
				const n = Number(m[2]) + off;
				cell.v = n >= 0 ? m[1] + String(n).padStart(m[2].length, '0') : s.v;
			}
			changes.push([key, cell]);
		}
	}
	return changes;
}

function linearStep(xs: number[]) {
	const d = xs[1] - xs[0];
	for (let i = 2; i < xs.length; i++) if (Math.abs(xs[i] - xs[i - 1] - d) > 1e-9) return d === 0 ? 0 : (xs[xs.length - 1] - xs[0]) / (xs.length - 1);
	return d;
}

export { forEachFormula };
