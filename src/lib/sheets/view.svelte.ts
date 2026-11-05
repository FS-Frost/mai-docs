// UI state of an open spreadsheet: selection, editing, clipboard and navigation. Shared by the grid, the
// formula bar, the toolbar and the tabs.
import { i18n } from '../i18n/index.svelte.ts';
import { a1, cellKey, colName, keyCol, keyRow, MAX_COLS, MAX_ROWS, norm, parseA1, parseRefText, rangeA1, type Range } from './addr.ts';
import type { Book } from './book.svelte.ts';
import { parseHTMLTable, parseTSV, toHTML, toTSV } from './clipboard.ts';
import { editText } from './input.ts';
import { hasContent, styleOf, type Cell, type CellStyle, type Sheet } from './model.ts';

export type Pos = { r: number; c: number };
export type EditState = { text: string; r: number; c: number; sheetId: string; mode: 'enter' | 'edit'; from: 'cell' | 'bar' };

type Clip = { sheetId: string; range: Range; cells: (Cell | undefined)[][]; text: string; cut: boolean };

export class SheetView {
	active = $state<Pos>({ r: 0, c: 0 });
	anchor = $state<Pos>({ r: 0, c: 0 });
	/** Normalized ranges; the last one is the primary (contains `active`). */
	ranges = $state<Range[]>([{ r1: 0, c1: 0, r2: 0, c2: 0 }]);
	edit = $state<EditState | null>(null);
	clip = $state.raw<Clip | null>(null);
	/** Bumped to ask the grid to scroll the active cell into view. */
	reveal = $state(0);
	/** Bumped to ask the grid to focus its input sink. */
	focusTick = $state(0);
	/** Formula reference picking while editing (range being dragged). */
	pick = $state<Range | null>(null);

	constructor(public book: Book) {}

	get sheet(): Sheet {
		return this.book.active;
	}

	get primary(): Range {
		return this.ranges[this.ranges.length - 1];
	}

	// ---------- Selection ----------

	select(p: Pos, opts: { extend?: boolean; add?: boolean } = {}) {
		if (!this.keepTab) this.tabStart = null;
		const s = this.sheet;
		const pos = { r: clamp(p.r, 0, s.rows - 1), c: clamp(p.c, 0, s.cols - 1) };
		if (opts.extend) {
			const g = this.expandMerges(norm({ r1: this.anchor.r, c1: this.anchor.c, r2: pos.r, c2: pos.c }));
			this.ranges = [...this.ranges.slice(0, -1), g];
			this.active = { ...this.active };
			this.lastExtend = pos;
		} else {
			const m = this.book.mergeAt(s, pos.r, pos.c);
			const anchorPos = m ? { r: m.r1, c: m.c1 } : pos;
			const g = m ? { ...m } : { r1: pos.r, c1: pos.c, r2: pos.r, c2: pos.c };
			this.ranges = opts.add ? [...this.ranges, g] : [g];
			this.active = anchorPos;
			this.anchor = anchorPos;
			this.lastExtend = anchorPos;
		}
		this.reveal++;
	}

	/** Moving end of an extended selection (for Shift+arrows). */
	lastExtend: Pos = { r: 0, c: 0 };

	selectRange(g: Range, active?: Pos) {
		const n = norm(g);
		this.ranges = [n];
		this.active = active ?? { r: n.r1, c: n.c1 };
		this.anchor = { ...this.active };
		this.lastExtend = { r: n.r2, c: n.c2 };
		this.reveal++;
	}

	selectAll() {
		this.ranges = [{ r1: 0, c1: 0, r2: this.sheet.rows - 1, c2: this.sheet.cols - 1 }];
	}

	selectRows(r1: number, r2: number, extend = false) {
		const a = extend ? this.anchor.r : r1;
		this.ranges = [norm({ r1: a, c1: 0, r2, c2: this.sheet.cols - 1 })];
		if (!extend) {
			this.active = { r: r1, c: 0 };
			this.anchor = { r: r1, c: 0 };
		}
	}

	selectCols(c1: number, c2: number, extend = false) {
		const a = extend ? this.anchor.c : c1;
		this.ranges = [norm({ r1: 0, c1: a, r2: this.sheet.rows - 1, c2 })];
		if (!extend) {
			this.active = { r: 0, c: c1 };
			this.anchor = { r: 0, c: c1 };
		}
	}

	isWholeRows(g = this.primary) {
		return g.c1 === 0 && g.c2 >= this.sheet.cols - 1;
	}
	isWholeCols(g = this.primary) {
		return g.r1 === 0 && g.r2 >= this.sheet.rows - 1;
	}

	private expandMerges(g: Range): Range {
		const ms = this.sheet.merges;
		if (!ms.length) return g;
		let changed = true;
		const out = { ...g };
		while (changed) {
			changed = false;
			for (const m of ms) {
				if (m.r1 <= out.r2 && out.r1 <= m.r2 && m.c1 <= out.c2 && out.c1 <= m.c2) {
					if (m.r1 < out.r1 || m.r2 > out.r2 || m.c1 < out.c1 || m.c2 > out.c2) {
						out.r1 = Math.min(out.r1, m.r1);
						out.r2 = Math.max(out.r2, m.r2);
						out.c1 = Math.min(out.c1, m.c1);
						out.c2 = Math.max(out.c2, m.c2);
						changed = true;
					}
				}
			}
		}
		return out;
	}

	/** Next visible row in a direction (skips rows hidden by filters). */
	private stepRow(r: number, d: number) {
		const s = this.sheet;
		let n = r + d;
		while (n >= 0 && n < s.rows && s.hidden.has(n)) n += d;
		return n < 0 || n >= s.rows ? r : n;
	}

	move(dr: number, dc: number, opts: { extend?: boolean; jump?: boolean } = {}) {
		const s = this.sheet;
		const from = opts.extend ? this.lastExtend : this.active;
		let { r, c } = from;
		if (!opts.extend) {
			// Leaving a merged cell: step from its far edge.
			const m = this.book.mergeAt(s, r, c);
			if (m) {
				if (dr > 0) r = m.r2;
				if (dc > 0) c = m.c2;
			}
		}
		if (opts.jump) ({ r, c } = this.jumpTarget(r, c, dr, dc));
		else {
			if (dr) r = this.stepRow(r, dr);
			c = clamp(c + dc, 0, s.cols - 1);
		}
		this.select({ r, c }, { extend: opts.extend });
		if (opts.extend) this.lastExtend = { r, c };
	}

	/** Ctrl+arrow: edge of the current data block (like Excel). */
	private jumpTarget(r: number, c: number, dr: number, dc: number): Pos {
		const s = this.sheet;
		const filled = (rr: number, cc: number) => hasContent(s.cells.get(cellKey(rr, cc)));
		const maxR = s.rows - 1;
		const maxC = s.cols - 1;
		const inb = (rr: number, cc: number) => rr >= 0 && rr <= maxR && cc >= 0 && cc <= maxC;
		let rr = r;
		let cc = c;
		const next = () => ({ r: rr + dr, c: cc + dc });
		if (!inb(next().r, next().c)) return { r, c };
		const here = filled(rr, cc);
		const ahead = filled(next().r, next().c);
		if (here && ahead) {
			while (inb(next().r, next().c) && filled(next().r, next().c)) ({ r: rr, c: cc } = next());
			return { r: rr, c: cc };
		}
		// Skip blanks to the next filled cell (or the edge). Limit the scan to the used area.
		const limit = dr ? Math.max(...[...s.cells.keys()].map(keyRow), 0) + 1 : Math.max(...[...s.cells.keys()].map(keyCol), 0) + 1;
		({ r: rr, c: cc } = next());
		while (inb(rr, cc) && !filled(rr, cc)) {
			if ((dr > 0 && rr > limit) || (dc > 0 && cc > limit)) return { r: dr > 0 ? maxR : r, c: dc > 0 ? maxC : c };
			if (!inb(rr + dr, cc + dc)) break;
			rr += dr;
			cc += dc;
		}
		return { r: clamp(rr, 0, maxR), c: clamp(cc, 0, maxC) };
	}

	/** Column where a Tab sequence started: Enter goes back to it on the next row (like Excel). */
	private tabStart: number | null = null;
	private keepTab = false;

	private get single() {
		const g = this.primary;
		return this.ranges.length === 1 && g.r1 === g.r2 && g.c1 === g.c2;
	}

	tab(shift: boolean) {
		if (!this.single) return this.advance(0, shift ? -1 : 1);
		const start = this.tabStart ?? this.active.c;
		this.keepTab = true;
		this.move(0, shift ? -1 : 1);
		this.keepTab = false;
		this.tabStart = shift ? null : start;
	}

	enter(shift: boolean) {
		if (!this.single) return this.advance(shift ? -1 : 1, 0);
		const col = !shift ? this.tabStart : null;
		if (col === null) return this.move(shift ? -1 : 1, 0);
		this.select({ r: this.stepRow(this.active.r, 1), c: col });
	}

	/** Enter/Tab inside a multi-cell selection cycles through it (like Excel). */
	advance(dr: number, dc: number) {
		const g = this.primary;
		if (g.r1 === g.r2 && g.c1 === g.c2) {
			this.move(dr, dc);
			return;
		}
		let { r, c } = this.active;
		if (dc) {
			c += dc;
			if (c > g.c2) {
				c = g.c1;
				r = r + 1 > g.r2 ? g.r1 : r + 1;
			} else if (c < g.c1) {
				c = g.c2;
				r = r - 1 < g.r1 ? g.r2 : r - 1;
			}
		} else {
			r += dr;
			if (r > g.r2) {
				r = g.r1;
				c = c + 1 > g.c2 ? g.c1 : c + 1;
			} else if (r < g.r1) {
				r = g.r2;
				c = c - 1 < g.c1 ? g.c2 : c - 1;
			}
		}
		this.active = { r, c };
		this.reveal++;
	}

	get nameBox() {
		const g = this.primary;
		if (this.isWholeCols(g) && this.isWholeRows(g)) return `A1:${a1(this.sheet.rows - 1, this.sheet.cols - 1)}`;
		if (this.isWholeCols(g)) return `${colName(g.c1)}:${colName(g.c2)}`;
		if (this.isWholeRows(g)) return `${g.r1 + 1}:${g.r2 + 1}`;
		return g.r1 === g.r2 && g.c1 === g.c2 ? a1(this.active.r, this.active.c) : rangeA1(g);
	}

	goTo(text: string) {
		const g = parseRefText(text);
		if (!g) return false;
		this.selectRange({ r1: Math.min(g.r1, this.sheet.rows - 1), c1: Math.min(g.c1, this.sheet.cols - 1), r2: Math.min(g.r2, this.sheet.rows - 1), c2: Math.min(g.c2, this.sheet.cols - 1) });
		this.focusTick++;
		return true;
	}

	// ---------- Editing ----------

	cellText(r = this.active.r, c = this.active.c) {
		const s = this.sheet;
		const cell = this.book.cell(s, r, c);
		const style = styleOf(this.book.wb, cell);
		return editText(cell, i18n.locale, style.numFmt, this.book.text(s, r, c));
	}

	startEdit(initial: string | null, mode: 'enter' | 'edit', from: 'cell' | 'bar' = 'cell') {
		const { r, c } = this.active;
		this.edit = { text: initial ?? this.cellText(r, c), r, c, sheetId: this.sheet.id, mode, from };
	}

	commit(): boolean {
		const e = this.edit;
		if (!e) return false;
		this.edit = null;
		this.pick = null;
		const before = this.cellTextAt(e.sheetId, e.r, e.c);
		if (e.text !== before) this.book.setInput(e.sheetId, e.r, e.c, e.text);
		return true;
	}

	/** Ctrl+Enter: same input in every selected cell. */
	commitAll() {
		const e = this.edit;
		if (!e) return;
		this.edit = null;
		this.pick = null;
		this.book.fillInput(e.sheetId, this.ranges, e.text, { r: e.r, c: e.c });
	}

	cancel() {
		this.edit = null;
		this.pick = null;
	}

	private cellTextAt(sheetId: string, r: number, c: number) {
		const s = this.book.sheet(sheetId);
		if (!s) return '';
		const cell = this.book.cell(s, r, c);
		return editText(cell, i18n.locale, styleOf(this.book.wb, cell).numFmt, this.book.text(s, r, c));
	}

	/** While typing a formula, is the caret at a spot where a reference may be inserted? */
	canPickRef(caretText: string) {
		return !!this.edit && this.edit.text.startsWith('=') && /[=(,+\-*/^&<>:;]\s*$/.test(caretText);
	}

	// ---------- Clipboard ----------

	copy(cut = false): { text: string; html: string } {
		const s = this.sheet;
		const g = this.book.clampRanges(s, [this.primary])[0];
		const cells: (Cell | undefined)[][] = [];
		const rows: string[][] = [];
		const htmlRows: { text: string; style?: string }[][] = [];
		for (let r = g.r1; r <= g.r2; r++) {
			if (s.hidden.has(r)) continue;
			const crow: (Cell | undefined)[] = [];
			const trow: string[] = [];
			const hrow: { text: string; style?: string }[] = [];
			for (let c = g.c1; c <= g.c2; c++) {
				const cell = this.book.cell(s, r, c);
				crow.push(cell ? { ...cell } : undefined);
				const text = this.book.text(s, r, c);
				trow.push(text);
				hrow.push({ text, style: htmlStyle(styleOf(this.book.wb, cell)) });
			}
			cells.push(crow);
			rows.push(trow);
			htmlRows.push(hrow);
		}
		const text = toTSV(rows);
		this.clip = { sheetId: s.id, range: g, cells, text, cut };
		return { text, html: toHTML(htmlRows) };
	}

	paste(data: { text?: string; html?: string }, valuesOnly = false) {
		const s = this.sheet;
		const at = { r: this.primary.r1, c: this.primary.c1 };
		const clip = this.clip;
		const norm = (t: string) => t.replace(/\r\n?/g, '\n').replace(/\n$/, '');
		if (clip && data.text !== undefined && norm(data.text) === norm(clip.text)) {
			this.book.pasteCells(s.id, at, clip.cells, { r: clip.range.r1, c: clip.range.c1 }, { valuesOnly, cutFrom: clip.cut ? { sheetId: clip.sheetId, range: clip.range } : undefined });
			if (clip.cut) this.clip = null;
			this.selectRange({ r1: at.r, c1: at.c, r2: at.r + clip.cells.length - 1, c2: at.c + (clip.cells[0]?.length ?? 1) - 1 }, at);
			return;
		}
		const grid = (data.html && parseHTMLTable(data.html)) || (data.text !== undefined ? parseTSV(data.text) : null);
		if (!grid?.length) return;
		this.book.pasteText(s.id, at, grid);
		this.selectRange({ r1: at.r, c1: at.c, r2: at.r + grid.length - 1, c2: at.c + Math.max(...grid.map((r) => r.length)) - 1 }, at);
	}

	// ---------- Helpers for actions ----------

	get styleHere(): CellStyle {
		return this.book.styleAt(this.sheet, this.active.r, this.active.c);
	}

	/** Row/col indices covered by the selection along an axis. */
	indices(axis: 'row' | 'col'): number[] {
		const set = new Set<number>();
		for (const g of this.ranges) {
			const [a, b] = axis === 'row' ? [g.r1, Math.min(g.r2, this.sheet.rows - 1)] : [g.c1, Math.min(g.c2, this.sheet.cols - 1)];
			for (let i = a; i <= b; i++) set.add(i);
		}
		return [...set].sort((x, y) => x - y);
	}
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function htmlStyle(s: CellStyle) {
	const out: string[] = [];
	if (s.bold) out.push('font-weight:bold');
	if (s.italic) out.push('font-style:italic');
	if (s.underline || s.strike) out.push(`text-decoration:${[s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ')}`);
	if (s.color) out.push(`color:${s.color}`);
	if (s.fill) out.push(`background:${s.fill}`);
	if (s.hAlign) out.push(`text-align:${s.hAlign}`);
	return out.join(';') || undefined;
}

export { MAX_COLS, MAX_ROWS, parseA1 };
