// Spreadsheet controller: owns the workbook (non-reactive, potentially large), the recalculation engine and the
// undo history. Components read `book.rev` to re-render after any change.
import { untrack } from 'svelte';
import { i18n } from '../i18n/index.svelte.ts';
import { cellKey, keyCol, keyRow, norm, type Range } from './addr.ts';
import { applyFilter } from './filter.ts';
import { defaultAlign, displayColor, displayText, isDateFmt } from './format.ts';
import { Engine } from './formula/engine.ts';
import { shiftFormula } from './formula/refs.ts';
import { parseInput } from './input.ts';
import {
	fromContent,
	getSheet,
	mergeAt,
	styleIndex,
	styleOf,
	toContent,
	type Cell,
	type CellStyle,
	type Filter,
	type FilterCriterion,
	type Sheet,
	type SheetObject,
	type Workbook,
	type WorkbookContent
} from './model.ts';
import * as ops from './ops.ts';
import type { Value } from './values.ts';

type Entry = { undo: () => void; redo: () => void; sheet: string };

const HISTORY = 200;

export type Display = { text: string; align: 'left' | 'center' | 'right'; color?: string; style: CellStyle };

export class Book {
	wb: Workbook;
	engine: Engine;
	rev = $state(0);
	canUndo = $state(false);
	canRedo = $state(false);
	/** Called after every committed change (autosave). */
	onChange: () => void = () => {};

	private undoStack: Entry[] = [];
	private redoStack: Entry[] = [];

	constructor(content: WorkbookContent) {
		this.wb = fromContent(content);
		this.engine = new Engine(this.wb);
		this.engine.rebuild();
		for (const s of this.wb.sheets) this.refilter(s);
	}

	get locale() {
		return i18n.locale;
	}

	get active(): Sheet {
		return getSheet(this.wb, this.wb.active) ?? this.wb.sheets[0];
	}

	sheet(id: string) {
		return getSheet(this.wb, id);
	}

	setActive(id: string) {
		if (this.wb.active === id) return;
		this.wb.active = id;
		this.bump(false);
		this.onChange();
	}

	content(): WorkbookContent {
		return toContent(this.wb);
	}

	// ---------- Reading ----------

	cell(s: Sheet, r: number, c: number): Cell | undefined {
		return s.cells.get(cellKey(r, c));
	}

	styleAt(s: Sheet, r: number, c: number): CellStyle {
		return styleOf(this.wb, this.cell(s, r, c));
	}

	display(s: Sheet, r: number, c: number): Display {
		const cell = this.cell(s, r, c);
		const style = styleOf(this.wb, cell);
		const v = cell?.v;
		return {
			text: displayText(v, style.numFmt, this.locale),
			align: style.hAlign ?? defaultAlign(v),
			color: displayColor(v, style.numFmt),
			style
		};
	}

	text(s: Sheet, r: number, c: number) {
		const cell = this.cell(s, r, c);
		return displayText(cell?.v, styleOf(this.wb, cell).numFmt, this.locale);
	}

	// ---------- History ----------

	private push(e: Entry) {
		this.undoStack.push(e);
		if (this.undoStack.length > HISTORY) this.undoStack.shift();
		this.redoStack = [];
		this.syncFlags();
	}

	private syncFlags() {
		this.canUndo = this.undoStack.length > 0;
		this.canRedo = this.redoStack.length > 0;
	}

	undo() {
		const e = this.undoStack.pop();
		if (!e) return;
		e.undo();
		this.redoStack.push(e);
		if (getSheet(this.wb, e.sheet)) this.wb.active = e.sheet;
		this.syncFlags();
		this.bump();
	}

	redo() {
		const e = this.redoStack.pop();
		if (!e) return;
		e.redo();
		this.undoStack.push(e);
		if (getSheet(this.wb, e.sheet)) this.wb.active = e.sheet;
		this.syncFlags();
		this.bump();
	}

	private bump(changed = true) {
		for (const s of this.wb.sheets) if (s.filter) this.refilter(s);
		untrack(() => this.rev++);
		if (changed) this.onChange();
	}

	private refilter(s: Sheet) {
		applyFilter(s, (r, c) => this.text(s, r, c));
	}

	// ---------- Cell edits ----------

	/** Applies cell changes with undo. */
	setCells(sheetId: string, changes: ops.CellChange[]) {
		const s = this.sheet(sheetId);
		if (!s || !changes.length) return;
		const run = (ch: ops.CellChange[]) => {
			const inv = ops.applyCells(s, ch);
			this.grow(s, ch);
			this.engine.update(ch.map(([key]) => ({ sheetId, key })));
			return inv;
		};
		const inverse = run(changes);
		this.push({ undo: () => run(inverse), redo: () => run(changes), sheet: sheetId });
		this.bump();
	}

	private grow(s: Sheet, ch: ops.CellChange[]) {
		for (const [k] of ch) {
			const r = keyRow(k);
			const c = keyCol(k);
			if (r >= s.rows) s.rows = r + 1;
			if (c >= s.cols) s.cols = c + 1;
		}
	}

	/** User typed `text` into (r, c). */
	setInput(sheetId: string, r: number, c: number, text: string) {
		const s = this.sheet(sheetId);
		if (!s) return;
		const prev = this.cell(s, r, c);
		const style = styleOf(this.wb, prev);
		const p = parseInput(text, this.locale, style.numFmt);
		const next: Cell = { s: prev?.s };
		if (p.f) next.f = p.f;
		else next.v = p.v;
		if (p.numFmt) next.s = styleIndex(this.wb, { ...style, numFmt: p.numFmt });
		this.setCells(sheetId, [[cellKey(r, c), next]]);
	}

	/** Sets the same text in every cell of the ranges (Ctrl+Enter). Formulas are shifted per cell. */
	fillInput(sheetId: string, ranges: Range[], text: string, origin: { r: number; c: number }) {
		const s = this.sheet(sheetId);
		if (!s) return;
		const changes: ops.CellChange[] = [];
		for (const g of ranges)
			for (let r = g.r1; r <= g.r2; r++)
				for (let c = g.c1; c <= g.c2; c++) {
					const prev = this.cell(s, r, c);
					const style = styleOf(this.wb, prev);
					const p = parseInput(text, this.locale, style.numFmt);
					const next: Cell = { s: prev?.s };
					if (p.f) next.f = shiftFormula(p.f, r - origin.r, c - origin.c);
					else next.v = p.v;
					if (p.numFmt) next.s = styleIndex(this.wb, { ...style, numFmt: p.numFmt });
					changes.push([cellKey(r, c), next]);
				}
		this.setCells(sheetId, changes);
	}

	clear(sheetId: string, ranges: Range[], what: 'contents' | 'formats' | 'all') {
		const s = this.sheet(sheetId);
		if (!s) return;
		const changes: ops.CellChange[] = [];
		for (const g of this.clampRanges(s, ranges))
			for (const [k, cell] of s.cells) {
				const r = keyRow(k);
				const c = keyCol(k);
				if (r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2) continue;
				if (what === 'all') changes.push([k, undefined]);
				else if (what === 'contents') changes.push([k, cell.s ? { s: cell.s } : undefined]);
				else changes.push([k, { v: cell.v, f: cell.f }]);
			}
		this.setCells(sheetId, changes);
	}

	/** Ranges limited to the used area (whole-column selections can be huge). */
	clampRanges(s: Sheet, ranges: Range[]): Range[] {
		return ranges.map((g) => ({ r1: g.r1, c1: g.c1, r2: Math.min(g.r2, s.rows - 1), c2: Math.min(g.c2, s.cols - 1) }));
	}

	/** Applies a style patch (or transform) to every cell of the ranges. */
	setStyle(sheetId: string, ranges: Range[], patch: Partial<CellStyle> | ((s: CellStyle, r: number, c: number) => CellStyle)) {
		const s = this.sheet(sheetId);
		if (!s) return;
		const changes: ops.CellChange[] = [];
		const cache = new Map<number, number>();
		for (const g of this.clampRanges(s, ranges))
			for (let r = g.r1; r <= g.r2; r++)
				for (let c = g.c1; c <= g.c2; c++) {
					const cell = this.cell(s, r, c);
					const cur = cell?.s ?? 0;
					let idx: number;
					if (typeof patch === 'function') idx = styleIndex(this.wb, patch(styleOf(this.wb, cell), r, c));
					else {
						const hit = cache.get(cur);
						idx = hit ?? styleIndex(this.wb, { ...styleOf(this.wb, cell), ...patch });
						cache.set(cur, idx);
					}
					if (idx === cur) continue;
					changes.push([cellKey(r, c), { v: cell?.v, f: cell?.f, s: idx || undefined }]);
				}
		this.setCells(sheetId, changes);
	}

	// ---------- Non-cell sheet properties (with undo) ----------

	private meta<T>(sheetId: string, get: (s: Sheet) => T, set: (s: Sheet, v: T) => void, next: T) {
		const s = this.sheet(sheetId);
		if (!s) return;
		const prev = structuredClone(get(s));
		const apply = (v: T) => {
			set(s, structuredClone(v));
		};
		apply(next);
		this.push({ undo: () => apply(prev), redo: () => apply(next), sheet: sheetId });
		this.bump();
	}

	resize(sheetId: string, axis: 'row' | 'col', indices: number[], size: number | undefined) {
		const key = axis === 'row' ? 'rowHeights' : 'colWidths';
		const s = this.sheet(sheetId);
		if (!s) return;
		const next = new Map(s[key]);
		for (const i of indices) if (size === undefined) next.delete(i);
		else next.set(i, Math.max(4, Math.round(size)));
		this.meta(
			sheetId,
			(x) => [...x[key]],
			(x, v) => (x[key] = new Map(v)),
			[...next]
		);
	}

	setFreeze(sheetId: string, rows: number, cols: number) {
		this.meta(
			sheetId,
			(x) => x.freeze,
			(x, v) => (x.freeze = v),
			{ rows, cols }
		);
	}

	setFilter(sheetId: string, filter: Filter | undefined) {
		this.meta(
			sheetId,
			(x) => x.filter,
			(x, v) => {
				x.filter = v;
				this.refilter(x);
			},
			filter
		);
	}

	setFilterCriterion(sheetId: string, col: number, cr: FilterCriterion | undefined) {
		const s = this.sheet(sheetId);
		if (!s?.filter) return;
		const criteria = { ...s.filter.criteria };
		if (cr && (cr.values || cr.cond)) criteria[col] = cr;
		else delete criteria[col];
		this.setFilter(sheetId, { ...s.filter, criteria });
	}

	merge(sheetId: string, ranges: Range[]) {
		const s = this.sheet(sheetId);
		if (!s) return;
		const add = ranges.map(norm).filter((g) => g.r1 !== g.r2 || g.c1 !== g.c2);
		if (!add.length) return;
		// Values outside the top-left cell are discarded, like Excel.
		const changes: ops.CellChange[] = [];
		for (const g of add)
			for (const [k, cell] of s.cells) {
				const r = keyRow(k);
				const c = keyCol(k);
				if (r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2 || (r === g.r1 && c === g.c1)) continue;
				if (cell.f || cell.v !== undefined) changes.push([k, cell.s ? { s: cell.s } : undefined]);
			}
		this.group(sheetId, () => {
			if (changes.length) this.setCells(sheetId, changes);
			const kept = s.merges.filter((m) => !add.some((g) => g.r1 <= m.r2 && m.r1 <= g.r2 && g.c1 <= m.c2 && m.c1 <= g.c2));
			this.meta(
				sheetId,
				(x) => x.merges,
				(x, v) => (x.merges = v),
				[...kept, ...add]
			);
		});
	}

	unmerge(sheetId: string, ranges: Range[]) {
		const s = this.sheet(sheetId);
		if (!s) return;
		const kept = s.merges.filter((m) => !ranges.some((g) => g.r1 <= m.r2 && m.r1 <= g.r2 && g.c1 <= m.c2 && m.c1 <= g.c2));
		this.meta(
			sheetId,
			(x) => x.merges,
			(x, v) => (x.merges = v),
			kept
		);
	}

	// ---------- Floating objects (images, charts) ----------

	private setObjects(sheetId: string, next: SheetObject[]) {
		this.meta(
			sheetId,
			(x) => x.objects,
			(x, v) => (x.objects = v),
			next
		);
	}

	object(sheetId: string, id: string) {
		return this.sheet(sheetId)?.objects.find((o) => o.id === id);
	}

	addObject(sheetId: string, obj: SheetObject) {
		const s = this.sheet(sheetId);
		if (s) this.setObjects(sheetId, [...s.objects, obj]);
	}

	updateObject(sheetId: string, id: string, patch: Partial<SheetObject>) {
		const s = this.sheet(sheetId);
		if (!s) return;
		this.setObjects(
			sheetId,
			s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as SheetObject) : o))
		);
	}

	removeObject(sheetId: string, id: string) {
		const s = this.sheet(sheetId);
		if (s) this.setObjects(sheetId, s.objects.filter((o) => o.id !== id));
	}

	/** Moves an object to the end (drawn on top). */
	bringToFront(sheetId: string, id: string) {
		const s = this.sheet(sheetId);
		const o = s?.objects.find((x) => x.id === id);
		if (s && o) this.setObjects(sheetId, [...s.objects.filter((x) => x.id !== id), o]);
	}

	/** Groups several recorded changes into one undo step. */
	group(sheetId: string, fn: () => void) {
		const before = this.undoStack.length;
		fn();
		const entries = this.undoStack.splice(before);
		if (!entries.length) return;
		this.push({
			undo: () => [...entries].reverse().forEach((e) => e.undo()),
			redo: () => entries.forEach((e) => e.redo()),
			sheet: sheetId
		});
	}

	// ---------- Structural (snapshot undo) ----------

	structural(sheetId: string, fn: () => void) {
		const before = toContent(this.wb);
		fn();
		const after = toContent(this.wb);
		const restore = (c: WorkbookContent) => {
			ops.restore(this.wb, c);
			this.engine.rebuild();
			for (const s of this.wb.sheets) this.refilter(s);
		};
		this.engine.rebuild();
		this.push({ undo: () => restore(before), redo: () => restore(after), sheet: sheetId });
		this.bump();
	}

	insert(sheetId: string, axis: 'row' | 'col', at: number, count: number) {
		this.structural(sheetId, () => ops.insertOrDelete(this.wb, sheetId, axis, at, count, 'insert'));
	}

	remove(sheetId: string, axis: 'row' | 'col', at: number, count: number) {
		this.structural(sheetId, () => ops.insertOrDelete(this.wb, sheetId, axis, at, count, 'delete'));
	}

	addRows(sheetId: string, n: number) {
		const s = this.sheet(sheetId);
		if (!s) return;
		this.meta(
			sheetId,
			(x) => x.rows,
			(x, v) => (x.rows = v),
			s.rows + n
		);
	}

	sort(sheetId: string, range: Range, col: number, desc: boolean, header: boolean) {
		const s = this.sheet(sheetId);
		if (!s) return;
		const g = this.clampRanges(s, [range])[0];
		this.setCells(sheetId, ops.sortRange(s, g, col, desc, header));
	}

	fill(sheetId: string, source: Range, target: Range) {
		const s = this.sheet(sheetId);
		if (!s) return;
		this.setCells(
			sheetId,
			ops.fillChanges(s, source, target, (c) => isDateFmt(styleOf(this.wb, c).numFmt))
		);
	}

	/** Moves (cut/paste) or copies cell contents with formula shifting. */
	pasteCells(sheetId: string, at: { r: number; c: number }, grid: (Cell | undefined)[][], origin: { r: number; c: number } | null, opts: { valuesOnly?: boolean; cutFrom?: { sheetId: string; range: Range } } = {}) {
		const s = this.sheet(sheetId);
		if (!s) return;
		const changes: ops.CellChange[] = [];
		const cutChanges: ops.CellChange[] = [];
		if (opts.cutFrom) {
			const g = opts.cutFrom.range;
			for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) cutChanges.push([cellKey(r, c), undefined]);
		}
		grid.forEach((row, dr) =>
			row.forEach((cell, dc) => {
				const r = at.r + dr;
				const c = at.c + dc;
				if (!cell) {
					changes.push([cellKey(r, c), undefined]);
					return;
				}
				const out: Cell = opts.valuesOnly ? { v: cell.v, s: this.cell(s, r, c)?.s } : { ...cell };
				if (!opts.valuesOnly && cell.f && origin && !opts.cutFrom) out.f = shiftFormula(cell.f, r - (origin.r + dr), c - (origin.c + dc));
				changes.push([cellKey(r, c), out]);
			})
		);
		this.group(sheetId, () => {
			if (opts.cutFrom) {
				const same = opts.cutFrom.sheetId === sheetId;
				const keys = new Set(changes.map(([k]) => k));
				const cut = same ? cutChanges.filter(([k]) => !keys.has(k)) : cutChanges;
				if (cut.length) this.setCells(opts.cutFrom.sheetId, cut);
			}
			this.setCells(sheetId, changes);
		});
	}

	/** Plain text grid paste (from other apps): each value parsed like typed input. */
	pasteText(sheetId: string, at: { r: number; c: number }, rows: string[][]) {
		const s = this.sheet(sheetId);
		if (!s) return;
		const changes: ops.CellChange[] = [];
		rows.forEach((row, dr) =>
			row.forEach((text, dc) => {
				const r = at.r + dr;
				const c = at.c + dc;
				const prev = this.cell(s, r, c);
				const style = styleOf(this.wb, prev);
				const p = parseInput(text, this.locale, style.numFmt);
				const next: Cell = { s: prev?.s };
				if (p.f) next.f = p.f;
				else next.v = p.v;
				if (p.numFmt) next.s = styleIndex(this.wb, { ...style, numFmt: p.numFmt });
				changes.push([cellKey(r, c), next]);
			})
		);
		this.setCells(sheetId, changes);
	}

	// ---------- Sheets ----------

	addSheet(name: string) {
		let id = '';
		this.structural(this.wb.active, () => (id = ops.addSheet(this.wb, name).id));
		return id;
	}

	duplicateSheet(id: string, name: string) {
		this.structural(id, () => ops.duplicateSheet(this.wb, id, name));
	}

	renameSheet(id: string, name: string) {
		this.structural(id, () => ops.renameSheet(this.wb, id, name));
	}

	deleteSheet(id: string) {
		this.structural(this.wb.active, () => ops.deleteSheet(this.wb, id));
	}

	moveSheet(id: string, to: number) {
		this.structural(id, () => ops.moveSheet(this.wb, id, to));
	}

	// ---------- Queries ----------

	mergeAt(s: Sheet, r: number, c: number) {
		return mergeAt(s, r, c);
	}

	/** Values of the selection for the status bar (sum/average/count). */
	stats(s: Sheet, ranges: Range[]) {
		let sum = 0;
		let n = 0;
		let count = 0;
		const seen = new Set<number>();
		for (const g of this.clampRanges(s, ranges))
			for (const [k, cell] of s.cells) {
				if (seen.has(k)) continue;
				const r = keyRow(k);
				const c = keyCol(k);
				if (r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2 || s.hidden.has(r)) continue;
				seen.add(k);
				const v: Value | undefined = cell.v;
				if (v === undefined || v === null || v === '') continue;
				count++;
				if (typeof v === 'number') {
					sum += v;
					n++;
				}
			}
		return { sum, avg: n ? sum / n : 0, nums: n, count };
	}
}
