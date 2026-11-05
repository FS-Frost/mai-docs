// A1 addressing. Rows and columns are 0-based internally; A1 = (0, 0).

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

export type Range = { r1: number; c1: number; r2: number; c2: number };

export const cellKey = (r: number, c: number) => r * MAX_COLS + c;
export const keyRow = (k: number) => Math.floor(k / MAX_COLS);
export const keyCol = (k: number) => k % MAX_COLS;

export function colName(c: number): string {
	let s = '';
	c += 1;
	while (c > 0) {
		const m = (c - 1) % 26;
		s = String.fromCharCode(65 + m) + s;
		c = Math.floor((c - 1) / 26);
	}
	return s;
}

/** 'A' → 0, 'AA' → 26. -1 if invalid. */
export function colIndex(name: string): number {
	let n = 0;
	for (const ch of name.toUpperCase()) {
		const v = ch.charCodeAt(0) - 64;
		if (v < 1 || v > 26) return -1;
		n = n * 26 + v;
	}
	return n - 1;
}

export const a1 = (r: number, c: number) => `${colName(c)}${r + 1}`;

const CELL_RE = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

/** 'B3' → {r:2,c:1}; null if not a valid in-bounds cell. */
export function parseA1(s: string): { r: number; c: number } | null {
	const m = CELL_RE.exec(s.trim());
	if (!m) return null;
	const c = colIndex(m[1]);
	const r = Number(m[2]) - 1;
	if (c < 0 || c >= MAX_COLS || r < 0 || r >= MAX_ROWS) return null;
	return { r, c };
}

export function norm(r: Range): Range {
	return { r1: Math.min(r.r1, r.r2), c1: Math.min(r.c1, r.c2), r2: Math.max(r.r1, r.r2), c2: Math.max(r.c1, r.c2) };
}

export function rangeA1(r: Range) {
	const n = norm(r);
	return n.r1 === n.r2 && n.c1 === n.c2 ? a1(n.r1, n.c1) : `${a1(n.r1, n.c1)}:${a1(n.r2, n.c2)}`;
}

/** 'A1:B2' or 'A1' → Range. */
export function parseRange(s: string): Range | null {
	const [a, b] = s.split(':');
	const p = parseA1(a);
	if (!p) return null;
	const q = b === undefined ? p : parseA1(b);
	if (!q) return null;
	return norm({ r1: p.r, c1: p.c, r2: q.r, c2: q.c });
}

/** Name-box text: 'B3', 'A1:C9', 'A:C', '2:5' → Range (whole rows/cols use the max bounds). */
export function parseRefText(s: string): Range | null {
	const t = s.trim().replace(/\$/g, '').toUpperCase();
	const cols = /^([A-Z]{1,3}):([A-Z]{1,3})$/.exec(t);
	if (cols) {
		const a = colIndex(cols[1]);
		const b = colIndex(cols[2]);
		if (a < 0 || b < 0 || a >= MAX_COLS || b >= MAX_COLS) return null;
		return norm({ r1: 0, c1: a, r2: MAX_ROWS - 1, c2: b });
	}
	const rows = /^(\d{1,7}):(\d{1,7})$/.exec(t);
	if (rows) {
		const a = Number(rows[1]) - 1;
		const b = Number(rows[2]) - 1;
		if (a < 0 || b < 0) return null;
		return norm({ r1: a, c1: 0, r2: b, c2: MAX_COLS - 1 });
	}
	return parseRange(t);
}

export const inRange =(g: Range, r: number, c: number) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;

export const intersects = (a: Range, b: Range) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;

export const rangeSize = (g: Range) => (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);

export const sameRange = (a: Range, b: Range) => a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
