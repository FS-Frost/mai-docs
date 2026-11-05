// Chart data from a sheet range (pure; tested). Rendering lives in components/charts/ChartView.svelte.
import { cellKey, keyCol, keyRow, rangeA1, type Range } from './addr.ts';
import { tryParse, quoteSheet } from './formula/parse.ts';
import { sheetByName, styleOf, type ChartObject, type ChartOptions, type ChartSource, type ChartType, type Sheet, type Workbook } from './model.ts';
import { isDateFmt } from './format.ts';

export type Series = { name: string; values: (number | null)[] };
export type ChartData = { labels: string[]; series: Series[]; numFmt?: string; xs?: (number | null)[]; error?: 'ref' | 'empty' };

/** Categorical palette (dataviz reference palette, validated light/dark; fixed order, never cycled). */
export const PALETTE = {
	light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
	dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
};
/** Pie/doughnut and scatter: series beyond this fold into "Other" (all-pairs validation holds for 3). */
export const MAX_SERIES = 8;

export function resolveRange(wb: Workbook, text: string): { sheet: Sheet; range: Range } | null {
	const ast = tryParse(text);
	if (!ast || ast.t !== 'ref' || ast.sheet === undefined) return null;
	const sheet = sheetByName(wb, ast.sheet);
	if (!sheet) return null;
	const b = ast.b ?? ast.a;
	const used = extent(sheet);
	const r1 = Math.min(ast.a.r ?? 0, b.r ?? 0);
	const c1 = Math.min(ast.a.c ?? 0, b.c ?? 0);
	const r2 = ast.a.r === undefined || b.r === undefined ? used.r : Math.max(ast.a.r, b.r);
	const c2 = ast.a.c === undefined || b.c === undefined ? used.c : Math.max(ast.a.c, b.c);
	return { sheet, range: { r1, c1, r2: Math.max(r1, r2), c2: Math.max(c1, c2) } };
}

function extent(s: Sheet) {
	let r = 0;
	let c = 0;
	for (const k of s.cells.keys()) {
		r = Math.max(r, keyRow(k));
		c = Math.max(c, keyCol(k));
	}
	return { r, c };
}

export const rangeText = (sheetName: string, g: Range) => `${quoteSheet(sheetName)}!${rangeA1(g).includes(':') ? rangeA1(g) : `${rangeA1(g)}:${rangeA1(g)}`}`;

/** Values for the chart. `text(sheet, r, c)` = displayed text (labels keep their number format). */
export function chartData(wb: Workbook, ch: { source: ChartSource; type: ChartType }, text: (s: Sheet, r: number, c: number) => string): ChartData {
	const res = resolveRange(wb, ch.source.range);
	if (!res) return { labels: [], series: [], error: 'ref' };
	const { sheet, range: g } = res;
	const { seriesIn, headerRow, headerCol } = ch.source;
	const num = (r: number, c: number): number | null => {
		if (sheet.hidden.has(r)) return null;
		const v = sheet.cells.get(cellKey(r, c))?.v;
		return typeof v === 'number' && Number.isFinite(v) ? v : null;
	};
	// Normalize to "series in columns": categories run along i, series along j.
	const cols = seriesIn === 'cols';
	const iStart = cols ? g.r1 + (headerRow ? 1 : 0) : g.c1 + (headerCol ? 1 : 0);
	const iEnd = cols ? g.r2 : g.c2;
	const jStart = cols ? g.c1 + (headerCol ? 1 : 0) : g.r1 + (headerRow ? 1 : 0);
	const jEnd = cols ? g.c2 : g.r2;
	const at = (i: number, j: number) => (cols ? { r: i, c: j } : { r: j, c: i });
	const visible = (i: number) => !cols || !sheet.hidden.has(i);
	const idx: number[] = [];
	for (let i = iStart; i <= iEnd; i++) if (visible(i)) idx.push(i);
	const labelAt = (i: number) => {
		if (cols ? headerCol : headerRow) {
			const p = cols ? { r: i, c: g.c1 } : { r: g.r1, c: i };
			return text(sheet, p.r, p.c);
		}
		return String(i - iStart + 1);
	};
	const nameAt = (j: number, n: number) => {
		if (cols ? headerRow : headerCol) {
			const p = cols ? { r: g.r1, c: j } : { r: j, c: g.c1 };
			const t = text(sheet, p.r, p.c);
			if (t) return t;
		}
		return `${n + 1}`;
	};
	let series: Series[] = [];
	for (let j = jStart, n = 0; j <= jEnd; j++, n++) series.push({ name: nameAt(j, n), values: idx.map((i) => num(at(i, j).r, at(i, j).c)) });
	let labels = idx.map(labelAt);
	let xs: (number | null)[] | undefined;
	if (ch.type === 'scatter') {
		// X values: the category column when it is numeric, else the first series.
		const catNums = (cols ? headerCol : headerRow) ? idx.map((i) => (cols ? num(i, g.c1) : num(g.r1, i))) : null;
		if (catNums && catNums.some((v) => v !== null)) xs = catNums;
		else if (series.length > 1) {
			xs = series[0].values;
			series = series.slice(1);
		} else xs = idx.map((_, k) => k + 1);
		labels = xs.map((v) => (v === null ? '' : String(v)));
	}
	if (!series.length || series.every((s) => s.values.every((v) => v === null))) return { labels, series, xs, error: 'empty' };
	const first = at(idx[0] ?? iStart, jStart);
	const numFmt = styleOf(wb, sheet.cells.get(cellKey(first.r, first.c))).numFmt;
	return { labels, series: series.slice(0, MAX_SERIES), numFmt, xs };
}

/** Chart source + type guessed from a selection (like Excel's "Insert chart"). */
export function guessChart(wb: Workbook, sheet: Sheet, g: Range): { source: ChartSource; options: ChartOptions } {
	const v = (r: number, c: number) => sheet.cells.get(cellKey(r, c))?.v;
	const isNum = (r: number, c: number) => typeof v(r, c) === 'number';
	const isText = (r: number, c: number) => typeof v(r, c) === 'string' && v(r, c) !== '';
	const height = g.r2 - g.r1 + 1;
	const width = g.c2 - g.c1 + 1;
	let headerRow = false;
	for (let c = g.c1; c <= g.c2; c++) if (isText(g.r1, c)) headerRow = true;
	if (height < 2) headerRow = false;
	let headerCol = false;
	const firstData = g.r1 + (headerRow ? 1 : 0);
	if (width > 1) for (let r = firstData; r <= g.r2; r++) if (!isNum(r, g.c1) && v(r, g.c1) !== undefined) headerCol = true;
	// First column of dates also acts as categories.
	const dateCol = width > 1 && isNum(firstData, g.c1) && isDateFmt(styleOf(wb, sheet.cells.get(cellKey(firstData, g.c1))).numFmt);
	const seriesIn: 'cols' | 'rows' = height - (headerRow ? 1 : 0) >= width - (headerCol ? 1 : 0) ? 'cols' : 'rows';
	const catCount = seriesIn === 'cols' ? height - (headerRow ? 1 : 0) : width - (headerCol ? 1 : 0);
	const type: ChartType = dateCol || catCount > 12 ? 'line' : 'column';
	return {
		source: { range: rangeText(sheet.name, g), seriesIn, headerRow, headerCol: headerCol || dateCol },
		options: { type, legend: 'bottom' }
	};
}

export function newChart(wb: Workbook, sheet: Sheet, g: Range, anchor: ChartObject['anchor']): ChartObject {
	const { source, options } = guessChart(wb, sheet, g);
	return { id: crypto.randomUUID(), kind: 'chart', source, anchor, w: 480, h: 300, ...options };
}
