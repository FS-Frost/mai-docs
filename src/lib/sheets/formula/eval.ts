// Formula evaluation. Ranges stay lazy (RangeV) until a function asks for their values.
import { err, FormulaError, isErr, num, str, bool, compare, parseNumberLiteral, type Value, type Scalar, type ErrorCode } from '../values.ts';
import type { Node, RefEnd } from './ast.ts';
import { FUNCTIONS, SPECIAL } from './functions.ts';

export type RangeV = { kind: 'range'; sheetId: string; r1: number; c1: number; r2: number; c2: number };
export type Arr = { kind: 'arr'; rows: Value[][] };
export type EvalV = Value | RangeV | Arr;

export interface EvalCtx {
	/** Sheet and position of the formula being evaluated. */
	sheetId: string;
	row: number;
	col: number;
	value(sheetId: string, r: number, c: number): Value;
	resolveSheet(name: string): string | undefined;
	/** Used extent of a sheet (rows/cols count), to clamp whole-column/row references. */
	extent(sheetId: string): { rows: number; cols: number };
	now: number;
}

export const isRange = (v: EvalV): v is RangeV => typeof v === 'object' && v !== null && (v as RangeV).kind === 'range';
export const isArr = (v: EvalV): v is Arr => typeof v === 'object' && v !== null && (v as Arr).kind === 'arr';

export function rangeOf(n: Node & { t: 'ref' }, ctx: EvalCtx): RangeV | Err {
	const sheetId = n.sheet !== undefined ? ctx.resolveSheet(n.sheet) : ctx.sheetId;
	if (!sheetId) return err('#REF!');
	const a = n.a;
	const b: RefEnd = n.b ?? n.a;
	const ext = ctx.extent(sheetId);
	let r1 = a.r ?? 0;
	let r2 = b.r ?? Math.max(0, ext.rows - 1);
	let c1 = a.c ?? 0;
	let c2 = b.c ?? Math.max(0, ext.cols - 1);
	if (a.r === undefined && b.r === undefined) {
		r1 = 0;
		r2 = Math.max(0, ext.rows - 1);
	}
	if (a.c === undefined && b.c === undefined) {
		c1 = 0;
		c2 = Math.max(0, ext.cols - 1);
	}
	return { kind: 'range', sheetId, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}
type Err = { e: ErrorCode };

/** All values of a range/array/scalar as rows. */
export function matrix(v: EvalV, ctx: EvalCtx): Value[][] {
	if (isRange(v)) {
		const out: Value[][] = [];
		for (let r = v.r1; r <= v.r2; r++) {
			const row: Value[] = [];
			for (let c = v.c1; c <= v.c2; c++) row.push(ctx.value(v.sheetId, r, c));
			out.push(row);
		}
		return out;
	}
	if (isArr(v)) return v.rows;
	return [[v]];
}

/** Scalar context: a range collapses by implicit intersection with the formula's row/column. */
export function scalar(v: EvalV, ctx: EvalCtx): Value {
	if (isRange(v)) {
		if (v.r1 === v.r2 && v.c1 === v.c2) return ctx.value(v.sheetId, v.r1, v.c1);
		if (v.c1 === v.c2 && ctx.row >= v.r1 && ctx.row <= v.r2) return ctx.value(v.sheetId, ctx.row, v.c1);
		if (v.r1 === v.r2 && ctx.col >= v.c1 && ctx.col <= v.c2) return ctx.value(v.sheetId, v.r1, ctx.col);
		return err('#VALUE!');
	}
	if (isArr(v)) return v.rows[0]?.[0] ?? null;
	return v;
}

function binop(op: string, x: Value, y: Value): Value {
	if (isErr(x)) return x;
	if (isErr(y)) return y;
	switch (op) {
		case '&':
			return str(x) + str(y);
		case '=':
		case '<>':
		case '<':
		case '<=':
		case '>':
		case '>=': {
			const c = compare(x as Scalar, y as Scalar);
			return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
		}
	}
	const a = num(x);
	const b = num(y);
	let r: number;
	switch (op) {
		case '+':
			r = a + b;
			break;
		case '-':
			r = a - b;
			break;
		case '*':
			r = a * b;
			break;
		case '/':
			if (b === 0) return err('#DIV/0!');
			r = a / b;
			break;
		case '^':
			if (a === 0 && b === 0) return err('#NUM!');
			r = Math.pow(a, b);
			break;
		default:
			return err('#VALUE!');
	}
	return Number.isFinite(r) ? r : err('#NUM!');
}

/** Element-wise binary op when one side is an array/range (array formulas inside SUMPRODUCT etc.). */
function lift(op: string, a: EvalV, b: EvalV, ctx: EvalCtx): EvalV {
	const ma = isRange(a) || isArr(a) ? matrix(a, ctx) : null;
	const mb = isRange(b) || isArr(b) ? matrix(b, ctx) : null;
	if (!ma && !mb) return safe(() => binop(op, a as Value, b as Value));
	const rows = Math.max(ma?.length ?? 1, mb?.length ?? 1);
	const cols = Math.max(ma?.[0]?.length ?? 1, mb?.[0]?.length ?? 1);
	const out: Value[][] = [];
	for (let r = 0; r < rows; r++) {
		const row: Value[] = [];
		for (let c = 0; c < cols; c++) {
			const x = ma ? (ma[ma.length === 1 ? 0 : r]?.[ma[0].length === 1 ? 0 : c] ?? err('#N/A')) : (a as Value);
			const y = mb ? (mb[mb.length === 1 ? 0 : r]?.[mb[0].length === 1 ? 0 : c] ?? err('#N/A')) : (b as Value);
			row.push(safe(() => binop(op, x, y)));
		}
		out.push(row);
	}
	return { kind: 'arr', rows: out };
}

function safe(f: () => Value): Value {
	try {
		return f();
	} catch (e) {
		if (e instanceof FormulaError) return err(e.code);
		throw e;
	}
}

/** Whether an AST position is evaluated in "array context" (inside functions that take arrays). */
export function evaluate(n: Node, ctx: EvalCtx): EvalV {
	switch (n.t) {
		case 'num':
			return n.v;
		case 'str':
			return n.v;
		case 'bool':
			return n.v;
		case 'err':
			return err(n.v);
		case 'refErr':
			return err('#REF!');
		case 'empty':
			return null;
		case 'name':
			return err('#NAME?');
		case 'paren':
			return evaluate(n.a, ctx);
		case 'ref':
			return rangeOf(n, ctx);
		case 'arr':
			return { kind: 'arr', rows: n.rows.map((r) => r.map((x) => scalar(evaluate(x, ctx), ctx))) };
		case 'un': {
			const v = evaluate(n.a, ctx);
			if (isRange(v) || isArr(v)) {
				const m = matrix(v, ctx);
				return { kind: 'arr', rows: m.map((r) => r.map((x) => safe(() => unop(n.op, x)))) };
			}
			return safe(() => unop(n.op, v));
		}
		case 'bin': {
			const a = evaluate(n.a, ctx);
			const b = evaluate(n.b, ctx);
			const multi = (v: EvalV) => (isRange(v) && (v.r1 !== v.r2 || v.c1 !== v.c2)) || isArr(v);
			if (multi(a) || multi(b)) return lift(n.op, a, b, ctx);
			return safe(() => binop(n.op, scalar(a, ctx), scalar(b, ctx)));
		}
		case 'fn': {
			const special = SPECIAL[n.name];
			if (special) {
				try {
					return special(n.args, ctx, evaluate);
				} catch (e) {
					if (e instanceof FormulaError) return err(e.code);
					throw e;
				}
			}
			const f = FUNCTIONS[n.name];
			if (!f) return err('#NAME?');
			const args = n.args.map((a) => evaluate(a, ctx));
			try {
				return f(args, ctx);
			} catch (e) {
				if (e instanceof FormulaError) return err(e.code);
				throw e;
			}
		}
	}
}

function unop(op: '-' | '+' | '%', v: Value): Value {
	if (isErr(v)) return v;
	const x = num(v);
	return op === '-' ? -x : op === '%' ? x / 100 : x;
}

/** Final value of a formula cell. */
export function evaluateFormula(n: Node, ctx: EvalCtx): Value {
	const v = evaluate(n, ctx);
	if (isRange(v)) {
		const s = ctx.value(v.sheetId, v.r1, v.c1);
		return s === null ? 0 : s;
	}
	if (isArr(v)) return v.rows[0]?.[0] ?? 0;
	return v === null ? 0 : v;
}

export { num, str, bool, parseNumberLiteral };
