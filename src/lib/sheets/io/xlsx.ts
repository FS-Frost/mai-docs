// .xlsx ⇄ workbook with exceljs (loaded on demand; browser build in the app, Node build in tests).
// Supported: values, formulas (+ cached results), cell styles, number formats, merges, column widths, row heights,
// frozen panes, autofilter range, several sheets, floating images and images in cells (exceljs), native charts
// (xlsx-charts.ts). Not supported (reported as lost): data validation, conditional formatting.
import type * as ExcelNS from 'exceljs';
import { a1, cellKey, keyCol, keyRow, parseRange, rangeA1, type Range } from '../addr.ts';
import { DEFAULT_COL_W, DEFAULT_ROW_H, newSheet, styleIndex, uniqueSheetName, valueText, type BorderSide, type CellStyle, type Sheet, type Workbook, type WorkbookContent, toContent } from '../model.ts';
import { addChartsToXlsx, axesOf, readChartsFromXlsx } from './xlsx-charts.ts';
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

export type SaveImage = (blob: Blob) => Promise<string>;
/** Image bytes for export (PNG/JPEG/GIF only: Excel can't show WebP). */
export type LoadImage = (blobId: string) => Promise<{ data: Uint8Array; extension: 'png' | 'jpeg' | 'gif' } | null>;

type NativeAnchor = { nativeCol: number; nativeColOff: number; nativeRow: number; nativeRowOff: number };
type SheetImageModel = { imageId: string | number; range: { tl: NativeAnchor; br?: NativeAnchor; ext?: { width: number; height: number }; editAs?: string } };

const EMU = 9525;

async function importImage(x: ExcelNS.Workbook, s: Sheet, img: SheetImageModel, save: SaveImage) {
	const media = x.getImage(Number(img.imageId)) as unknown as { buffer?: Uint8Array; base64?: string; extension?: string } | undefined;
	if (!media) return;
	const bytes = media.buffer ?? (media.base64 ? Uint8Array.from(atob(media.base64.replace(/^data:[^,]+,/, '')), (c) => c.charCodeAt(0)) : undefined);
	if (!bytes) return;
	const ext = (media.extension ?? 'png').toLowerCase();
	const blob = new Blob([bytes as BlobPart], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
	const blobId = await save(blob);
	const { rows, cols } = axesOf(s);
	const tl = img.range.tl;
	const c = Math.floor(tl.nativeCol ?? 0);
	const r = Math.floor(tl.nativeRow ?? 0);
	const x1 = cols.offset(c) + (tl.nativeColOff ?? 0) / EMU;
	const y1 = rows.offset(r) + (tl.nativeRowOff ?? 0) / EMU;
	let w: number;
	let h: number;
	if (img.range.br) {
		const br = img.range.br;
		w = cols.offset(Math.floor(br.nativeCol)) + (br.nativeColOff ?? 0) / EMU - x1;
		h = rows.offset(Math.floor(br.nativeRow)) + (br.nativeRowOff ?? 0) / EMU - y1;
	} else {
		w = img.range.ext?.width ?? 200;
		h = img.range.ext?.height ?? 150;
	}
	w = Math.max(8, Math.round(w));
	h = Math.max(8, Math.round(h));
	const dx = Math.round(x1 - cols.offset(c));
	const dy = Math.round(y1 - rows.offset(r));
	// An image that exactly covers one cell was an "image in cell" (our own export) → back into the cell.
	if (dx <= 1 && dy <= 1 && Math.abs(w - cols.size(c)) <= 2 && Math.abs(h - rows.size(r)) <= 2) {
		const k = cellKey(r, c);
		s.cells.set(k, { ...s.cells.get(k), img: { blobId, fit: 'contain' } });
		return;
	}
	s.objects.push({ id: crypto.randomUUID(), kind: 'image', blobId, anchor: { r, c, dx, dy }, w, h });
}

function toBase64(bytes: Uint8Array) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

export async function readXlsx(
	buf: ArrayBuffer | Uint8Array,
	sheetBaseName: (n: number) => string,
	saveImage?: SaveImage
): Promise<{ content: WorkbookContent; lost: LostKind[]; chartsSimplified: boolean }> {
	const Excel = await lib();
	const x = new Excel.Workbook();
	await x.xlsx.load(buf as ArrayBuffer);
	const wb: Workbook = { sheets: [], active: '', styles: [{}] };
	const lost = new Set<LostKind>();
	const pendingImages: { s: Sheet; img: SheetImageModel }[] = [];
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
			for (const img of ws.getImages() as unknown as SheetImageModel[]) {
				if (saveImage) pendingImages.push({ s, img });
				else lost.add('images');
			}
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
	for (const { s, img } of pendingImages) await importImage(x, s, img, saveImage!);
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let chartsSimplified = false;
	try {
		chartsSimplified = readChartsFromXlsx(bytes, wb).simplified;
	} catch (e) {
		console.warn('[mai] charts not imported', e);
		lost.add('charts');
	}
	return { content: toContent(wb), lost: [...lost], chartsSimplified };
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

export async function writeXlsx(wb: Workbook, loadImage?: LoadImage, text?: (s: Sheet, r: number, c: number) => string): Promise<Uint8Array> {
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
		if (loadImage) await writeImages(x, ws, s, loadImage);
	}
	const out = new Uint8Array((await x.xlsx.writeBuffer()) as ArrayBuffer);
	return addChartsToXlsx(out, wb, text ?? ((sh, r, c) => valueText(sh.cells.get(cellKey(r, c))?.v ?? null)));
}

/** Floating images (two-cell, move with cells) and cell images (sized to their cell). */
async function writeImages(x: ExcelNS.Workbook, ws: ExcelNS.Worksheet, s: Sheet, load: LoadImage) {
	const { rows, cols } = axesOf(s);
	const ids = new Map<string, number>();
	const imageId = async (blobId: string) => {
		if (ids.has(blobId)) return ids.get(blobId)!;
		const img = await load(blobId);
		if (!img) return -1;
		const id = x.addImage({ base64: `data:image/${img.extension};base64,${toBase64(img.data)}`, extension: img.extension });
		ids.set(blobId, id);
		return id;
	};
	for (const o of s.objects) {
		if (o.kind !== 'image') continue;
		const id = await imageId(o.blobId);
		if (id < 0) continue;
		// Native EMU offsets: exceljs converts fractional cells with its own default sizes.
		const tl = { nativeCol: o.anchor.c, nativeColOff: Math.round(o.anchor.dx * EMU), nativeRow: o.anchor.r, nativeRowOff: Math.round(o.anchor.dy * EMU) };
		ws.addImage(id, { tl, ext: { width: o.w, height: o.h }, editAs: 'oneCell' } as never);
	}
	for (const [k, cell] of s.cells) {
		if (!cell.img) continue;
		const id = await imageId(cell.img.blobId);
		if (id < 0) continue;
		const r = keyRow(k);
		const c = keyCol(k);
		ws.addImage(id, { tl: { col: c, row: r }, ext: { width: cols.size(c), height: rows.size(r) }, editAs: 'oneCell' } as never);
	}
}

export { serialToUtcDate, DEFAULT_COL_W, DEFAULT_ROW_H };
