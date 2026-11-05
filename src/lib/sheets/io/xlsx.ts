// .xlsx ⇄ workbook with exceljs (loaded on demand; browser build in the app, Node build in tests).
// Supported: values, formulas (+ cached results), cell styles, number formats, merges, column widths, row heights,
// frozen panes, autofilter range, several sheets. Not supported (reported as lost): images, charts,
// data validation, conditional formatting.
import type * as ExcelNS from 'exceljs';
import { a1, cellKey, keyCol, keyRow, parseRange, rangeA1, type Range } from '../addr.ts';
import { DEFAULT_COL_W, DEFAULT_ROW_H, newSheet, styleIndex, uniqueSheetName, type BorderSide, type CellStyle, type Workbook, type WorkbookContent, toContent } from '../model.ts';
import { ERROR_CODES, isErr, serialToUtcDate, utcDateToSerial, type ErrorCode, type Value } from '../values.ts';

type ExcelJS = typeof ExcelNS;

async function lib(): Promise<ExcelJS> {
	const m = (await import('exceljs')) as unknown as { default?: ExcelJS } & ExcelJS;
	return m.default ?? m;
}

export type LostKind = 'images' | 'charts' | 'validations' | 'conditional';

/** Functions newer than Excel 2007 must be written with the _xlfn. prefix or Excel shows #NAME?. */
const XLFN = [
	'XLOOKUP', 'IFS', 'SWITCH', 'CONCAT', 'TEXTJOIN', 'MAXIFS', 'MINIFS', 'XOR', 'IFNA', 'DAYS', 'IFERROR_', 'STDEV.S', 'STDEV.P',
	'VAR.S', 'VAR.P', 'NORM.DIST', 'NORM.INV', 'MODE.SNGL', 'PERCENTILE.INC', 'PERCENTILE.EXC', 'QUARTILE.INC', 'QUARTILE.EXC',
	'RANK.EQ', 'RANK.AVG', 'CEILING.MATH', 'FLOOR.MATH', 'ISOWEEKNUM', 'UNIQUE', 'SORT', 'FILTER', 'SEQUENCE', 'XMATCH'
];
const XLFN_RE = new RegExp(`(^|[^A-Za-z0-9_.])(${XLFN.map((f) => f.replace('.', '\\.')).join('|')})\\(`, 'g');

export const toExcelFormula = (f: string) => withoutStrings(f, (s) => s.replace(XLFN_RE, '$1_xlfn.$2('));
export const fromExcelFormula = (f: string) => withoutStrings(f, (s) => s.replace(/_xlfn\.|_xlws\.|_xludf\./g, ''));

/** Applies fn only outside "string literals". */
function withoutStrings(f: string, fn: (s: string) => string) {
	return f
		.split(/("(?:[^"]|"")*")/)
		.map((part, i) => (i % 2 ? part : fn(part)))
		.join('');
}

const argbToHex = (c: { argb?: string } | undefined) => {
	const v = c?.argb;
	if (!v || v.length < 6) return undefined;
	return `#${v.slice(-6).toLowerCase()}`;
};
const hexToArgb = (h: string | undefined) => (h ? { argb: `FF${h.replace('#', '').toUpperCase().padStart(6, '0').slice(-6)}` } : undefined);

const BORDER_STYLES: BorderSide['style'][] = ['thin', 'medium', 'thick', 'dashed', 'dotted', 'double'];

function readBorder(b: Partial<ExcelNS.Border> | undefined): BorderSide | undefined {
	if (!b?.style) return undefined;
	const style = (BORDER_STYLES as string[]).includes(b.style) ? (b.style as BorderSide['style']) : b.style.startsWith('medium') ? 'medium' : b.style.includes('dash') ? 'dashed' : 'thin';
	return { style, color: argbToHex(b.color) };
}

function readStyle(cell: ExcelNS.Cell): CellStyle {
	const st: CellStyle = {};
	const f = cell.font;
	if (f) {
		if (f.bold) st.bold = true;
		if (f.italic) st.italic = true;
		if (f.underline) st.underline = true;
		if (f.strike) st.strike = true;
		const color = argbToHex(f.color);
		if (color && color !== '#000000') st.color = color;
		if (f.name && f.name !== 'Calibri') st.font = f.name;
		if (f.size && f.size !== 11) st.size = f.size;
	}
	const fill = cell.fill as ExcelNS.FillPattern | undefined;
	if (fill?.type === 'pattern' && fill.pattern === 'solid') {
		const c = argbToHex(fill.fgColor);
		if (c) st.fill = c;
	}
	const a = cell.alignment;
	if (a) {
		if (a.horizontal === 'left' || a.horizontal === 'center' || a.horizontal === 'right') st.hAlign = a.horizontal;
		if (a.horizontal === 'centerContinuous') st.hAlign = 'center';
		if (a.vertical === 'top') st.vAlign = 'top';
		if (a.vertical === 'middle') st.vAlign = 'middle';
		if (a.wrapText) st.wrap = true;
	}
	if (cell.numFmt && cell.numFmt !== 'General') st.numFmt = cell.numFmt;
	const b = cell.border;
	if (b) {
		const border: NonNullable<CellStyle['border']> = {};
		for (const side of ['top', 'right', 'bottom', 'left'] as const) {
			const s = readBorder(b[side]);
			if (s) border[side] = s;
		}
		if (Object.keys(border).length) st.border = border;
	}
	return st;
}

function readValue(v: ExcelNS.CellValue): Value {
	if (v === null || v === undefined) return null;
	if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
	if (v instanceof Date) return utcDateToSerial(v);
	if (typeof v === 'object') {
		if ('error' in v) return { e: (ERROR_CODES as string[]).includes(String(v.error)) ? (v.error as ErrorCode) : '#VALUE!' };
		if ('richText' in v) return v.richText.map((t) => t.text).join('');
		if ('text' in v && 'hyperlink' in v) return typeof v.text === 'string' ? v.text : ((v.text as { richText?: { text: string }[] }).richText?.map((t) => t.text).join('') ?? '');
		if ('result' in v) return readValue((v as { result?: ExcelNS.CellValue }).result ?? null);
	}
	return null;
}

export async function readXlsx(buf: ArrayBuffer | Uint8Array, sheetBaseName: (n: number) => string): Promise<{ content: WorkbookContent; lost: LostKind[] }> {
	const Excel = await lib();
	const x = new Excel.Workbook();
	await x.xlsx.load(buf as ArrayBuffer);
	const wb: Workbook = { sheets: [], active: '', styles: [{}] };
	const lost = new Set<LostKind>();
	x.eachSheet((ws) => {
		const s = newSheet(ws.name || uniqueSheetName(wb, sheetBaseName));
		let maxR = 0;
		let maxC = 0;
		ws.eachRow({ includeEmpty: false }, (row, rn) => {
			if (row.height) s.rowHeights.set(rn - 1, Math.round((row.height * 96) / 72));
			row.eachCell({ includeEmpty: false }, (cell, cn) => {
				if (cell.isMerged && cell.master !== cell) return;
				const r = rn - 1;
				const c = cn - 1;
				const out: { v?: Value; f?: string; s?: number } = {};
				const formula = cell.formula as string | undefined;
				if (formula) {
					out.f = fromExcelFormula(formula);
					const res = readValue(cell.value);
					if (res !== null) out.v = res;
				} else {
					const v = readValue(cell.value);
					if (v !== null && v !== '') out.v = v;
				}
				const st = readStyle(cell);
				if (Object.keys(st).length) out.s = styleIndex(wb, st);
				if (out.v !== undefined || out.f || out.s) {
					s.cells.set(cellKey(r, c), out);
					maxR = Math.max(maxR, r + 1);
					maxC = Math.max(maxC, c + 1);
				}
			});
		});
		const colCount = Math.max(ws.columnCount, maxC);
		for (let c = 1; c <= colCount; c++) {
			const w = ws.getColumn(c).width;
			if (w) s.colWidths.set(c - 1, Math.round(w * 7 + 5));
		}
		const merges = ((ws.model as unknown as { merges?: string[] }).merges ?? []) as string[];
		for (const m of merges) {
			const g = parseRange(m);
			if (g) s.merges.push(g);
		}
		const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
		if (view?.state === 'frozen') s.freeze = { rows: view.ySplit ?? 0, cols: view.xSplit ?? 0 };
		const af = ws.autoFilter as unknown;
		const afRange = typeof af === 'string' ? parseRange(af) : af && typeof af === 'object' && 'from' in af ? autoFilterRange(af as { from: unknown; to: unknown }) : null;
		if (afRange) s.filter = { range: afRange, criteria: {} };
		s.rows = Math.max(s.rows, maxR + 100);
		s.cols = Math.max(s.cols, maxC + 1);
		try {
			if (ws.getImages().length) lost.add('images');
		} catch {
			/* older exceljs */
		}
		const anyWs = ws as unknown as { conditionalFormattings?: unknown[]; dataValidations?: { model?: Record<string, unknown> } };
		if (anyWs.conditionalFormattings?.length) lost.add('conditional');
		if (anyWs.dataValidations?.model && Object.keys(anyWs.dataValidations.model).length) lost.add('validations');
		wb.sheets.push(s);
	});
	if (!wb.sheets.length) wb.sheets.push(newSheet(sheetBaseName(1)));
	wb.active = wb.sheets[0].id;
	return { content: toContent(wb), lost: [...lost] };
}

function autoFilterRange(af: { from: unknown; to: unknown }): Range | null {
	const end = (e: unknown) => (typeof e === 'string' ? e : e && typeof e === 'object' && 'row' in e && 'column' in e ? a1((e as { row: number }).row - 1, (e as { column: number }).column - 1) : null);
	const f = end(af.from);
	const t = end(af.to);
	return f && t ? parseRange(`${f}:${t}`) : null;
}

function writeStyle(cell: ExcelNS.Cell, st: CellStyle) {
	if (st.bold || st.italic || st.underline || st.strike || st.color || st.font || st.size) {
		cell.font = {
			name: st.font ?? 'Calibri',
			size: st.size ?? 11,
			bold: st.bold || undefined,
			italic: st.italic || undefined,
			underline: st.underline || undefined,
			strike: st.strike || undefined,
			color: hexToArgb(st.color)
		};
	}
	if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: hexToArgb(st.fill)! };
	if (st.hAlign || st.vAlign || st.wrap) cell.alignment = { horizontal: st.hAlign, vertical: st.vAlign, wrapText: st.wrap || undefined };
	if (st.numFmt) cell.numFmt = st.numFmt;
	if (st.border) {
		const b: Partial<ExcelNS.Borders> = {};
		for (const side of ['top', 'right', 'bottom', 'left'] as const) {
			const s = st.border[side];
			if (s) b[side] = { style: s.style, color: hexToArgb(s.color ?? '#000000') };
		}
		cell.border = b;
	}
}

const xlError = (code: ErrorCode) => ({ error: code === '#CIRC!' || code === '#SPILL!' || code === '#CALC!' ? '#REF!' : code }) as unknown as ExcelNS.CellErrorValue;

export async function writeXlsx(wb: Workbook): Promise<Uint8Array> {
	const Excel = await lib();
	const x = new Excel.Workbook();
	x.creator = 'Mai Docs';
	x.created = new Date();
	for (const s of wb.sheets) {
		const ws = x.addWorksheet(s.name, {
			views: s.freeze.rows || s.freeze.cols ? [{ state: 'frozen', xSplit: s.freeze.cols, ySplit: s.freeze.rows }] : undefined
		});
		for (const [c, w] of s.colWidths) ws.getColumn(c + 1).width = Math.max(1, (w - 5) / 7);
		for (const [r, h] of s.rowHeights) ws.getRow(r + 1).height = (h * 72) / 96;
		for (const [k, cell] of s.cells) {
			const xc = ws.getCell(keyRow(k) + 1, keyCol(k) + 1);
			const v = cell.v;
			if (cell.f) {
				const result = v === undefined || v === null ? undefined : isErr(v) ? xlError(v.e) : v;
				xc.value = { formula: toExcelFormula(cell.f), result } as ExcelNS.CellFormulaValue;
			} else if (isErr(v)) xc.value = xlError(v.e);
			else if (v !== undefined && v !== null) xc.value = v;
			const st = cell.s ? wb.styles[cell.s] : undefined;
			if (st) writeStyle(xc, st);
		}
		for (const m of s.merges) ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1);
		if (s.filter) ws.autoFilter = rangeA1(s.filter.range);
	}
	const out = await x.xlsx.writeBuffer();
	return new Uint8Array(out as ArrayBuffer);
}

export { serialToUtcDate, DEFAULT_COL_W, DEFAULT_ROW_H };
