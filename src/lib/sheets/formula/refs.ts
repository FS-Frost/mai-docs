// Formula rewriting: copy/fill offsets, row/column insert/delete, sheet rename/delete.
import { MAX_COLS, MAX_ROWS } from '../addr.ts';
import type { Node, RefEnd } from './ast.ts';
import { mapNode, parse, print, tryParse } from './parse.ts';

type RefNode = Node & { t: 'ref' };

function rewrite(f: string, fn: (n: RefNode) => Node): string {
	const ast = tryParse(f);
	if (!ast) return f;
	const out = mapNode(ast, (n) => (n.t === 'ref' ? fn(n) : n));
	return print(out);
}

/** Copying a formula by (dr, dc): relative parts move, absolute ones stay. Out of bounds → #REF!. */
export function shiftFormula(f: string, dr: number, dc: number): string {
	if (!dr && !dc) return f;
	return rewrite(f, (n) => {
		const move = (e: RefEnd): RefEnd | null => {
			const r = e.r === undefined || e.ar ? e.r : e.r + dr;
			const c = e.c === undefined || e.ac ? e.c : e.c + dc;
			if ((r !== undefined && (r < 0 || r >= MAX_ROWS)) || (c !== undefined && (c < 0 || c >= MAX_COLS))) return null;
			return { ...e, r, c };
		};
		const a = move(n.a);
		const b = n.b ? move(n.b) : undefined;
		if (!a || b === null) return { t: 'refErr', sheet: n.sheet };
		return { ...n, a, b };
	});
}

export type Structural = { sheetName: string; axis: 'row' | 'col'; at: number; count: number; kind: 'insert' | 'delete' };

/**
 * Adjusts references after inserting/deleting rows or columns in `sheetName`.
 * `formulaSheet` = name of the sheet that contains the formula (for unprefixed refs).
 */
export function adjustFormula(f: string, formulaSheet: string, op: Structural): string {
	const same = (n: RefNode) => (n.sheet ?? formulaSheet).toLowerCase() === op.sheetName.toLowerCase();
	return rewrite(f, (n) => {
		if (!same(n)) return n;
		const key = op.axis === 'row' ? 'r' : 'c';
		const a = n.a[key];
		const b = (n.b ?? n.a)[key];
		if (a === undefined || b === undefined) return n; // whole row/col along the other axis
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		let nlo = lo;
		let nhi = hi;
		if (op.kind === 'insert') {
			if (lo >= op.at) nlo += op.count;
			if (hi >= op.at) nhi += op.count;
			// Inserting inside a range expands it (hi moved, lo did not).
		} else {
			const d1 = op.at;
			const d2 = op.at + op.count - 1;
			if (!n.b) {
				if (lo >= d1 && lo <= d2) return { t: 'refErr', sheet: n.sheet };
				if (lo > d2) nlo = nhi = lo - op.count;
			} else {
				if (lo >= d1 && hi <= d2) return { t: 'refErr', sheet: n.sheet };
				// Start
				if (lo > d2) nlo = lo - op.count;
				else if (lo >= d1) nlo = d1;
				// End
				if (hi > d2) nhi = hi - op.count;
				else if (hi >= d1) nhi = d1 - 1;
			}
		}
		const setEnd = (e: RefEnd, v: number): RefEnd => ({ ...e, [key]: v });
		if (!n.b) return { ...n, a: setEnd(n.a, nlo) };
		const aIsLo = a <= b;
		return { ...n, a: setEnd(n.a, aIsLo ? nlo : nhi), b: setEnd(n.b, aIsLo ? nhi : nlo) };
	});
}

export function renameSheetInFormula(f: string, from: string, to: string): string {
	const low = from.toLowerCase();
	if (!f.toLowerCase().includes(low.replace(/'/g, "''"))) return f;
	const ast = tryParse(f);
	if (!ast) return f;
	return print(
		mapNode(ast, (n) => ((n.t === 'ref' || n.t === 'refErr') && n.sheet !== undefined && n.sheet.toLowerCase() === low ? { ...n, sheet: to } : n))
	);
}

export function deleteSheetInFormula(f: string, name: string): string {
	const low = name.toLowerCase();
	const ast = tryParse(f);
	if (!ast) return f;
	return print(mapNode(ast, (n) => (n.t === 'ref' && n.sheet !== undefined && n.sheet.toLowerCase() === low ? { t: 'refErr', sheet: n.sheet } : n)));
}

/** References in a formula being typed (for coloring ranges while editing). Tolerates incomplete input. */
export function formulaRefs(f: string): { sheet?: string; r1: number; c1: number; r2: number; c2: number }[] {
	let ast: Node | null = null;
	try {
		ast = parse(f);
	} catch {
		// Incomplete: try closing parentheses.
		for (let i = 1; i <= 4 && !ast; i++) ast = tryParse(f + ')'.repeat(i));
	}
	if (!ast) return [];
	const out: { sheet?: string; r1: number; c1: number; r2: number; c2: number }[] = [];
	mapNode(ast, (n) => {
		if (n.t === 'ref') {
			const b = n.b ?? n.a;
			out.push({
				sheet: n.sheet,
				r1: Math.min(n.a.r ?? 0, b.r ?? 0),
				c1: Math.min(n.a.c ?? 0, b.c ?? 0),
				r2: n.a.r === undefined || b.r === undefined ? MAX_ROWS - 1 : Math.max(n.a.r, b.r),
				c2: n.a.c === undefined || b.c === undefined ? MAX_COLS - 1 : Math.max(n.a.c, b.c)
			});
		}
		return n;
	});
	return out;
}
