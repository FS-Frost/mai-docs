// Workbook model. In memory: Maps keyed by cellKey(r, c). Persisted: WorkbookContent (plain JSON).
import { cellKey, keyCol, keyRow, type Range } from './addr.ts';
import { isErr, type Value } from './values.ts';

export type BorderSide = { style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'; color?: string };

export type CellStyle = {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	color?: string;
	fill?: string;
	font?: string;
	size?: number; // pt
	hAlign?: 'left' | 'center' | 'right';
	vAlign?: 'top' | 'middle' | 'bottom';
	wrap?: boolean;
	numFmt?: string;
	border?: { top?: BorderSide; right?: BorderSide; bottom?: BorderSide; left?: BorderSide };
};

/** Image shown inside a cell (moves with the cell: copy, fill, sort, filter). */
export type CellImage = { blobId: string; alt?: string; fit: 'contain' | 'cover' };

/** f = formula without '='; v = literal value or cached formula result; s = index into Workbook.styles. */
export type Cell = { v?: Value; f?: string; s?: number; img?: CellImage };

// ---------- Floating objects (images and charts) ----------

/** Top-left of a floating object: cell + offset inside it (px). */
export type Anchor = { r: number; c: number; dx: number; dy: number };

export type ChartType = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter';

export type ChartSource = {
	/** A1 range with sheet prefix, e.g. "Hoja1!A1:C6" (rewritten on structural changes like a formula). */
	range: string;
	seriesIn: 'cols' | 'rows';
	/** First row holds series names (cols) / categories (rows). */
	headerRow: boolean;
	/** First column holds categories (cols) / series names (rows). */
	headerCol: boolean;
};

export type ChartOptions = {
	type: ChartType;
	stacked?: boolean | 'percent';
	title?: string;
	legend: 'top' | 'bottom' | 'right' | 'none';
	xTitle?: string;
	yTitle?: string;
	yMin?: number;
	yMax?: number;
	/** Per-series colors; missing = palette slot. */
	colors?: string[];
};

export type SheetObject =
	| { id: string; kind: 'image'; blobId: string; anchor: Anchor; w: number; h: number; alt?: string }
	| ({ id: string; kind: 'chart'; source: ChartSource; anchor: Anchor; w: number; h: number } & ChartOptions);

export type ImageObject = Extract<SheetObject, { kind: 'image' }>;
export type ChartObject = Extract<SheetObject, { kind: 'chart' }>;

export type FilterCriterion = {
	/** Visible display values; undefined = all. */
	values?: string[];
	cond?: { op: CondOp; value?: string };
};
export type CondOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne' | 'contains' | 'notContains' | 'empty' | 'notEmpty';
export type Filter = { range: Range; criteria: Record<number, FilterCriterion> };

export type Sheet = {
	id: string;
	name: string;
	rows: number;
	cols: number;
	cells: Map<number, Cell>;
	colWidths: Map<number, number>;
	rowHeights: Map<number, number>;
	merges: Range[];
	freeze: { rows: number; cols: number };
	filter?: Filter;
	objects: SheetObject[];
	/** Derived from the filter; not persisted. */
	hidden: Set<number>;
};

export type Workbook = { sheets: Sheet[]; active: string; styles: CellStyle[] };

export const DEFAULT_COL_W = 100;
export const DEFAULT_ROW_H = 24;
export const DEFAULT_ROWS = 1000;
export const DEFAULT_COLS = 26;

// ---------- Persistence ----------

export type SheetJSON = {
	id: string;
	name: string;
	rows: number;
	cols: number;
	cells: [string, Cell][]; // "r:c"
	colWidths: [number, number][];
	rowHeights: [number, number][];
	merges: Range[];
	freeze: { rows: number; cols: number };
	filter?: Filter;
	objects?: SheetObject[];
};
export type WorkbookContent = { v: 1; sheets: SheetJSON[]; active: string; styles: CellStyle[] };

export function newSheet(name: string, id: string = crypto.randomUUID()): Sheet {
	return {
		id,
		name,
		rows: DEFAULT_ROWS,
		cols: DEFAULT_COLS,
		cells: new Map(),
		colWidths: new Map(),
		rowHeights: new Map(),
		merges: [],
		freeze: { rows: 0, cols: 0 },
		hidden: new Set(),
		objects: []
	};
}

export function newWorkbook(sheetName: string): Workbook {
	const s = newSheet(sheetName);
	return { sheets: [s], active: s.id, styles: [{}] };
}

export function sheetToJSON(s: Sheet): SheetJSON {
	const cells: [string, Cell][] = [];
	for (const [k, c] of s.cells) {
		const out: Cell = {};
		if (c.v !== undefined && c.v !== null) out.v = c.v;
		if (c.f) out.f = c.f;
		if (c.s) out.s = c.s;
		if (c.img) out.img = { ...c.img };
		if (out.v !== undefined || out.f || out.s || out.img) cells.push([`${keyRow(k)}:${keyCol(k)}`, out]);
	}
	return {
		id: s.id,
		name: s.name,
		rows: s.rows,
		cols: s.cols,
		cells,
		colWidths: [...s.colWidths],
		rowHeights: [...s.rowHeights],
		merges: s.merges.map((m) => ({ ...m })),
		freeze: { ...s.freeze },
		filter: s.filter ? structuredClone(s.filter) : undefined,
		objects: s.objects.length ? structuredClone(s.objects) : undefined
	};
}

export function sheetFromJSON(j: SheetJSON): Sheet {
	const cells = new Map<number, Cell>();
	for (const [k, c] of j.cells) {
		const [r, col] = k.split(':').map(Number);
		cells.set(cellKey(r, col), { ...c });
	}
	return {
		id: j.id,
		name: j.name,
		rows: j.rows,
		cols: j.cols,
		cells,
		colWidths: new Map(j.colWidths),
		rowHeights: new Map(j.rowHeights),
		merges: j.merges.map((m) => ({ ...m })),
		freeze: { ...j.freeze },
		filter: j.filter ? structuredClone(j.filter) : undefined,
		objects: j.objects ? structuredClone(j.objects) : [],
		hidden: new Set()
	};
}

export function toContent(wb: Workbook): WorkbookContent {
	return { v: 1, sheets: wb.sheets.map(sheetToJSON), active: wb.active, styles: wb.styles.map((s) => structuredClone(s)) };
}

export function fromContent(c: WorkbookContent): Workbook {
	const wb: Workbook = {
		sheets: c.sheets.map(sheetFromJSON),
		active: c.active,
		styles: c.styles.length ? c.styles.map((s) => structuredClone(s)) : [{}]
	};
	if (!wb.sheets.some((s) => s.id === wb.active)) wb.active = wb.sheets[0].id;
	return wb;
}

// ---------- Helpers ----------

export function getSheet(wb: Workbook, id: string) {
	return wb.sheets.find((s) => s.id === id);
}

export function sheetByName(wb: Workbook, name: string) {
	const n = name.toLowerCase();
	return wb.sheets.find((s) => s.name.toLowerCase() === n);
}

/** Deduplicated style table: returns the index for that style (0 = default). */
export function styleIndex(wb: Workbook, style: CellStyle): number {
	const clean = cleanStyle(style);
	if (!Object.keys(clean).length) return 0;
	const key = JSON.stringify(clean);
	const i = wb.styles.findIndex((s) => JSON.stringify(s) === key);
	if (i >= 0) return i;
	wb.styles.push(clean);
	return wb.styles.length - 1;
}

function cleanStyle(s: CellStyle): CellStyle {
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(s).sort()) {
		const v = (s as Record<string, unknown>)[k];
		if (v === undefined || v === false || v === '' || v === null) continue;
		if (k === 'border') {
			const b = v as NonNullable<CellStyle['border']>;
			const bb: Record<string, BorderSide> = {};
			for (const side of ['bottom', 'left', 'right', 'top'] as const) if (b[side]) bb[side] = b[side]!;
			if (Object.keys(bb).length) out.border = bb;
			continue;
		}
		out[k] = v;
	}
	return out as CellStyle;
}

export const styleOf = (wb: Workbook, cell: Cell | undefined): CellStyle => (cell?.s ? (wb.styles[cell.s] ?? {}) : {});

/** Bounds of used cells (values, formulas or styles), or null if empty. */
export function usedRange(s: Sheet, valuesOnly = false): Range | null {
	let r1 = Infinity;
	let c1 = Infinity;
	let r2 = -1;
	let c2 = -1;
	for (const [k, c] of s.cells) {
		if (valuesOnly && !hasContent(c)) continue;
		const r = keyRow(k);
		const col = keyCol(k);
		if (r < r1) r1 = r;
		if (r > r2) r2 = r;
		if (col < c1) c1 = col;
		if (col > c2) c2 = col;
	}
	return r2 < 0 ? null : { r1, c1, r2, c2 };
}

export const hasContent = (c: Cell | undefined) => !!c && (!!c.f || !!c.img || (c.v !== undefined && c.v !== null && c.v !== ''));

/** Merge whose area contains (r, c). */
export function mergeAt(s: Sheet, r: number, c: number) {
	return s.merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
}

/** Display value of a cell (cached), for plain uses like CSV. */
export function cellValue(c: Cell | undefined): Value {
	return c?.v ?? null;
}

export function valueText(v: Value): string {
	if (v === null || v === undefined) return '';
	if (isErr(v)) return v.e;
	if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
	return String(v);
}

export function validSheetName(name: string) {
	return name.trim().length > 0 && name.length <= 31 && !/[:\\/?*[\]]/.test(name);
}

export function uniqueSheetName(wb: Workbook, base: (n: number) => string) {
	for (let n = wb.sheets.length + 1; ; n++) {
		const name = base(n);
		if (!sheetByName(wb, name)) return name;
	}
}
