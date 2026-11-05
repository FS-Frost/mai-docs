// Function library. Core functions are implemented here with Excel semantics; any other name known by
// @formulajs/formulajs is delegated to it (see `fromFormulajs`). Errors are thrown as FormulaError.
import * as FJ from '@formulajs/formulajs';
import {
	bool,
	compare,
	dateSerial,
	err,
	FormulaError,
	formatGeneral,
	isErr,
	jsDateToSerial,
	num,
	parseNumberLiteral,
	serialToParts,
	str,
	type ErrorCode,
	type Scalar,
	type Value
} from '../values.ts';
import { format as numfmtFormat } from 'numfmt';
import type { Node } from './ast.ts';
import { isArr, isRange, matrix, scalar, type EvalCtx, type EvalV, type RangeV } from './eval.ts';

type Fn = (args: EvalV[], ctx: EvalCtx) => EvalV;
type Special = (args: Node[], ctx: EvalCtx, ev: (n: Node, ctx: EvalCtx) => EvalV) => EvalV;

const fail = (code: ErrorCode): never => {
	throw new FormulaError(code);
};

const S = (v: EvalV, ctx: EvalCtx) => scalar(v, ctx);
const N = (v: EvalV, ctx: EvalCtx) => num(S(v, ctx));
const T = (v: EvalV, ctx: EvalCtx) => str(S(v, ctx));
const B = (v: EvalV, ctx: EvalCtx) => bool(S(v, ctx));
const opt = <X>(args: EvalV[], i: number, ctx: EvalCtx, f: (v: EvalV, ctx: EvalCtx) => X, d: X): X =>
	args[i] === undefined || args[i] === null ? d : f(args[i], ctx);

const argc = (args: EvalV[], min: number, max = min) => {
	if (args.length < min || args.length > max) fail('#VALUE!');
};

/** Every value of every argument, flattened (ranges row by row). `fromRef` marks values that came from cells. */
function* each(args: EvalV[], ctx: EvalCtx): Generator<{ v: Value; ref: boolean }> {
	for (const a of args) {
		if (isRange(a) || isArr(a)) {
			const ref = isRange(a);
			for (const row of matrix(a, ctx)) for (const v of row) yield { v, ref };
		} else yield { v: a as Value, ref: false };
	}
}

/** Numbers for SUM/AVERAGE/MIN…: cells contribute only numbers; direct arguments are coerced. Errors propagate. */
function numbers(args: EvalV[], ctx: EvalCtx): number[] {
	const out: number[] = [];
	for (const { v, ref } of each(args, ctx)) {
		if (isErr(v)) fail(v.e);
		if (typeof v === 'number') out.push(v);
		else if (!ref && v !== null) out.push(num(v));
	}
	return out;
}

const flat = (v: EvalV, ctx: EvalCtx): Value[] => matrix(v, ctx).flat();

// ---------- Criteria (SUMIF, COUNTIF…) ----------

function wildcard(p: string) {
	let re = '';
	for (let i = 0; i < p.length; i++) {
		const ch = p[i];
		if (ch === '~' && i + 1 < p.length) re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		else if (ch === '*') re += '.*';
		else if (ch === '?') re += '.';
		else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${re}$`, 'i');
}

export function criteria(c: Value): (v: Value) => boolean {
	if (isErr(c)) return (v) => isErr(v) && v.e === c.e;
	if (typeof c === 'number' || typeof c === 'boolean') return (v) => v === c || (typeof v === 'string' && parseNumberLiteral(v) === c);
	const s = c === null ? '' : c;
	const m = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(s)!;
	const op = m[1] ?? '=';
	const rhs = m[2];
	const n = parseNumberLiteral(rhs);
	const upper = rhs.toUpperCase();
	const b = upper === 'TRUE' ? true : upper === 'FALSE' ? false : null;
	if (n !== null || b !== null) {
		const target: Scalar = n ?? b;
		return (v) => {
			if (isErr(v)) return false;
			if (v === null || v === '') return op === '<>';
			const vv = typeof target === 'number' && typeof v === 'string' ? (parseNumberLiteral(v) ?? v) : v;
			if (typeof vv !== typeof target) return op === '<>';
			const k = compare(vv as Scalar, target);
			return op === '=' ? k === 0 : op === '<>' ? k !== 0 : op === '<' ? k < 0 : op === '<=' ? k <= 0 : op === '>' ? k > 0 : k >= 0;
		};
	}
	if (op === '=' || op === '<>') {
		if (rhs === '') return op === '=' ? (v) => v === null || v === '' : (v) => !(v === null || v === '');
		const re = wildcard(rhs);
		return (v) => {
			const ok = typeof v === 'string' && re.test(v);
			return op === '=' ? ok : !ok;
		};
	}
	return (v) => {
		if (typeof v !== 'string') return false;
		const k = compare(v, rhs);
		return op === '<' ? k < 0 : op === '<=' ? k <= 0 : op === '>' ? k > 0 : k >= 0;
	};
}

function ifsPairs(args: EvalV[], ctx: EvalCtx, start: number) {
	if ((args.length - start) % 2) fail('#VALUE!');
	const pairs: { vals: Value[][]; test: (v: Value) => boolean }[] = [];
	for (let i = start; i < args.length; i += 2) pairs.push({ vals: matrix(args[i], ctx), test: criteria(S(args[i + 1], ctx)) });
	return pairs;
}

function matches(pairs: ReturnType<typeof ifsPairs>, r: number, c: number) {
	return pairs.every((p) => p.test(p.vals[r]?.[c] ?? null));
}

// ---------- Lookup ----------

function lookupIndex(needle: Value, list: Value[], mode: number): number {
	if (mode === 0) {
		if (typeof needle === 'string') {
			const re = /[*?~]/.test(needle) ? wildcard(needle) : null;
			return list.findIndex((v) => (re ? typeof v === 'string' && re.test(v) : typeof v === 'string' && v.toLowerCase() === needle.toLowerCase()));
		}
		return list.findIndex((v) => v === needle);
	}
	// Approximate on sorted data (binary search like Excel).
	let lo = 0;
	let hi = list.length - 1;
	let best = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const v = list[mid];
		if (v === null || typeof v !== typeof needle) {
			// Skip mismatched types linearly.
			let j = mid;
			while (j <= hi && (list[j] === null || typeof list[j] !== typeof needle)) j++;
			if (j > hi) {
				hi = mid - 1;
				continue;
			}
			const k = compare(list[j] as Scalar, needle as Scalar);
			if (mode > 0 ? k <= 0 : k >= 0) {
				best = j;
				lo = j + 1;
			} else hi = mid - 1;
			continue;
		}
		const k = compare(v as Scalar, needle as Scalar);
		if (k === 0) {
			best = mid;
			lo = mid + 1;
		} else if (mode > 0 ? k < 0 : k > 0) {
			best = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return best;
}

// ---------- Text ----------

function textFormat(v: Value, fmt: string) {
	try {
		return numfmtFormat(fmt, v as number | string | boolean);
	} catch {
		return fail('#VALUE!');
	}
}

// ---------- Dates ----------

function daysInMonth(y: number, m: number) {
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(serial: number, months: number) {
	const { y, m, d } = serialToParts(serial);
	const t = y * 12 + (m - 1) + months;
	const ny = Math.floor(t / 12);
	const nm = (t % 12) + 1;
	return dateSerial(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

function todaySerial(ctx: EvalCtx) {
	return Math.floor(jsDateToSerial(new Date(ctx.now)));
}

// ---------- Special forms (lazy arguments) ----------

export const SPECIAL: Record<string, Special> = {
	IF(args, ctx, ev) {
		if (args.length < 2 || args.length > 3) fail('#VALUE!');
		const c = S(ev(args[0], ctx), ctx);
		if (isErr(c)) return c;
		if (bool(c)) return args[1].t === 'empty' ? 0 : ev(args[1], ctx);
		return args.length < 3 ? false : args[2].t === 'empty' ? 0 : ev(args[2], ctx);
	},
	IFS(args, ctx, ev) {
		if (args.length < 2 || args.length % 2) fail('#VALUE!');
		for (let i = 0; i < args.length; i += 2) {
			const c = S(ev(args[i], ctx), ctx);
			if (isErr(c)) return c;
			if (bool(c)) return ev(args[i + 1], ctx);
		}
		return err('#N/A');
	},
	IFERROR(args, ctx, ev) {
		if (args.length !== 2) fail('#VALUE!');
		const v = ev(args[0], ctx);
		const s = isRange(v) || isArr(v) ? S(v, ctx) : v;
		return isErr(s) ? ev(args[1], ctx) : v;
	},
	IFNA(args, ctx, ev) {
		if (args.length !== 2) fail('#VALUE!');
		const v = ev(args[0], ctx);
		const s = isRange(v) || isArr(v) ? S(v, ctx) : v;
		return isErr(s) && s.e === '#N/A' ? ev(args[1], ctx) : v;
	},
	SWITCH(args, ctx, ev) {
		if (args.length < 3) fail('#VALUE!');
		const x = S(ev(args[0], ctx), ctx);
		if (isErr(x)) return x;
		let i = 1;
		for (; i + 1 < args.length; i += 2) {
			const v = S(ev(args[i], ctx), ctx);
			if (!isErr(v) && compare(x as Scalar, v as Scalar) === 0 && typeof x === typeof v) return ev(args[i + 1], ctx);
		}
		return i < args.length ? ev(args[i], ctx) : err('#N/A');
	},
	CHOOSE(args, ctx, ev) {
		if (args.length < 2) fail('#VALUE!');
		const i = Math.trunc(num(S(ev(args[0], ctx), ctx)));
		if (i < 1 || i >= args.length) return err('#VALUE!');
		return ev(args[i], ctx);
	},
	ROW(args, ctx, ev) {
		if (!args.length) return ctx.row + 1;
		const v = ev(args[0], ctx);
		return isRange(v) ? v.r1 + 1 : err('#VALUE!');
	},
	COLUMN(args, ctx, ev) {
		if (!args.length) return ctx.col + 1;
		const v = ev(args[0], ctx);
		return isRange(v) ? v.c1 + 1 : err('#VALUE!');
	},
	ISBLANK(args, ctx, ev) {
		if (args.length !== 1) fail('#VALUE!');
		const v = ev(args[0], ctx);
		return isRange(v) ? ctx.value(v.sheetId, v.r1, v.c1) === null : v === null;
	},
	ISREF(args, ctx, ev) {
		return args.length === 1 && isRange(ev(args[0], ctx));
	}
};

// ---------- Functions ----------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const round = (x: number, d: number, mode: 'near' | 'up' | 'down') => {
	const f = Math.pow(10, d);
	const y = Math.abs(x) * f;
	const r = mode === 'near' ? Math.round(Number(y.toPrecision(15))) : mode === 'up' ? Math.ceil(Number(y.toPrecision(15))) : Math.floor(Number(y.toPrecision(15)));
	return (Math.sign(x) * r) / f;
};

const isBlank = (v: Value) => v === null;

export const FUNCTIONS: Record<string, Fn> = {
	// --- math / stats ---
	SUM: (a, c) => sum(numbers(a, c)),
	PRODUCT: (a, c) => numbers(a, c).reduce((x, y) => x * y, 1),
	AVERAGE: (a, c) => {
		const xs = numbers(a, c);
		return xs.length ? sum(xs) / xs.length : fail('#DIV/0!');
	},
	MIN: (a, c) => {
		const xs = numbers(a, c);
		return xs.length ? Math.min(...xs) : 0;
	},
	MAX: (a, c) => {
		const xs = numbers(a, c);
		return xs.length ? Math.max(...xs) : 0;
	},
	COUNT: (a, c) => {
		let n = 0;
		for (const { v, ref } of each(a, c)) if (typeof v === 'number' || (!ref && typeof v === 'string' && parseNumberLiteral(v) !== null) || (!ref && typeof v === 'boolean')) n++;
		return n;
	},
	COUNTA: (a, c) => {
		let n = 0;
		for (const { v } of each(a, c)) if (v !== null) n++;
		return n;
	},
	COUNTBLANK: (a, c) => {
		let n = 0;
		for (const { v } of each(a, c)) if (v === null || v === '') n++;
		return n;
	},
	MEDIAN: (a, c) => {
		const xs = numbers(a, c).sort((x, y) => x - y);
		if (!xs.length) fail('#NUM!');
		const m = xs.length >> 1;
		return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
	},
	LARGE: (a, c) => {
		const xs = numbers([a[0]], c).sort((x, y) => y - x);
		const k = Math.trunc(N(a[1], c));
		return k >= 1 && k <= xs.length ? xs[k - 1] : fail('#NUM!');
	},
	SMALL: (a, c) => {
		const xs = numbers([a[0]], c).sort((x, y) => x - y);
		const k = Math.trunc(N(a[1], c));
		return k >= 1 && k <= xs.length ? xs[k - 1] : fail('#NUM!');
	},
	ABS: (a, c) => (argc(a, 1), Math.abs(N(a[0], c))),
	INT: (a, c) => (argc(a, 1), Math.floor(N(a[0], c))),
	TRUNC: (a, c) => {
		argc(a, 1, 2);
		const d = opt(a, 1, c, N, 0);
		return round(N(a[0], c), d, 'down');
	},
	SIGN: (a, c) => Math.sign(N(a[0], c)),
	MOD: (a, c) => {
		argc(a, 2);
		const x = N(a[0], c);
		const y = N(a[1], c);
		if (y === 0) fail('#DIV/0!');
		return x - y * Math.floor(x / y);
	},
	POWER: (a, c) => {
		argc(a, 2);
		const r = Math.pow(N(a[0], c), N(a[1], c));
		return Number.isFinite(r) ? r : fail('#NUM!');
	},
	SQRT: (a, c) => {
		const x = N(a[0], c);
		return x < 0 ? fail('#NUM!') : Math.sqrt(x);
	},
	EXP: (a, c) => Math.exp(N(a[0], c)),
	LN: (a, c) => {
		const x = N(a[0], c);
		return x <= 0 ? fail('#NUM!') : Math.log(x);
	},
	LOG10: (a, c) => {
		const x = N(a[0], c);
		return x <= 0 ? fail('#NUM!') : Math.log10(x);
	},
	LOG: (a, c) => {
		const x = N(a[0], c);
		const b = opt(a, 1, c, N, 10);
		return x <= 0 || b <= 0 || b === 1 ? fail('#NUM!') : Math.log(x) / Math.log(b);
	},
	PI: () => Math.PI,
	ROUND: (a, c) => (argc(a, 1, 2), round(N(a[0], c), Math.trunc(opt(a, 1, c, N, 0)), 'near')),
	ROUNDUP: (a, c) => (argc(a, 1, 2), round(N(a[0], c), Math.trunc(opt(a, 1, c, N, 0)), 'up')),
	ROUNDDOWN: (a, c) => (argc(a, 1, 2), round(N(a[0], c), Math.trunc(opt(a, 1, c, N, 0)), 'down')),
	CEILING: (a, c) => {
		const x = N(a[0], c);
		const s = opt(a, 1, c, N, 1);
		return s === 0 ? 0 : Math.ceil(x / s) * s;
	},
	FLOOR: (a, c) => {
		const x = N(a[0], c);
		const s = opt(a, 1, c, N, 1);
		return s === 0 ? fail('#DIV/0!') : Math.floor(x / s) * s;
	},
	RAND: () => Math.random(),
	RANDBETWEEN: (a, c) => {
		const lo = Math.ceil(N(a[0], c));
		const hi = Math.floor(N(a[1], c));
		return hi < lo ? fail('#NUM!') : lo + Math.floor(Math.random() * (hi - lo + 1));
	},
	SUMPRODUCT: (a, c) => {
		const ms = a.map((x) => matrix(x, c));
		const rows = ms[0].length;
		const cols = ms[0][0]?.length ?? 0;
		if (ms.some((m) => m.length !== rows || (m[0]?.length ?? 0) !== cols)) fail('#VALUE!');
		let total = 0;
		for (let r = 0; r < rows; r++)
			for (let k = 0; k < cols; k++) {
				let p = 1;
				for (const m of ms) {
					const v = m[r][k];
					if (isErr(v)) fail(v.e);
					p *= typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : 0;
				}
				total += p;
			}
		return total;
	},
	SUMIF: (a, c) => {
		argc(a, 2, 3);
		const range = matrix(a[0], c);
		const sumRange = a[2] !== undefined ? matrix(a[2], c) : range;
		const test = criteria(S(a[1], c));
		let total = 0;
		range.forEach((row, r) =>
			row.forEach((v, k) => {
				if (test(v)) {
					const x = sumRange[r]?.[k];
					if (isErr(x)) fail(x.e);
					if (typeof x === 'number') total += x;
				}
			})
		);
		return total;
	},
	SUMIFS: (a, c) => {
		const sumRange = matrix(a[0], c);
		const pairs = ifsPairs(a, c, 1);
		let total = 0;
		sumRange.forEach((row, r) =>
			row.forEach((x, k) => {
				if (matches(pairs, r, k)) {
					if (isErr(x)) fail(x.e);
					if (typeof x === 'number') total += x;
				}
			})
		);
		return total;
	},
	COUNTIF: (a, c) => {
		argc(a, 2);
		const test = criteria(S(a[1], c));
		return flat(a[0], c).filter(test).length;
	},
	COUNTIFS: (a, c) => {
		const pairs = ifsPairs(a, c, 0);
		const base = pairs[0].vals;
		let n = 0;
		base.forEach((row, r) => row.forEach((_, k) => matches(pairs, r, k) && n++));
		return n;
	},
	AVERAGEIF: (a, c) => {
		argc(a, 2, 3);
		const range = matrix(a[0], c);
		const avgRange = a[2] !== undefined ? matrix(a[2], c) : range;
		const test = criteria(S(a[1], c));
		const xs: number[] = [];
		range.forEach((row, r) =>
			row.forEach((v, k) => {
				const x = avgRange[r]?.[k];
				if (test(v) && typeof x === 'number') xs.push(x);
			})
		);
		return xs.length ? sum(xs) / xs.length : fail('#DIV/0!');
	},
	AVERAGEIFS: (a, c) => {
		const avgRange = matrix(a[0], c);
		const pairs = ifsPairs(a, c, 1);
		const xs: number[] = [];
		avgRange.forEach((row, r) => row.forEach((x, k) => matches(pairs, r, k) && typeof x === 'number' && xs.push(x)));
		return xs.length ? sum(xs) / xs.length : fail('#DIV/0!');
	},
	MAXIFS: (a, c) => {
		const m = matrix(a[0], c);
		const pairs = ifsPairs(a, c, 1);
		const xs: number[] = [];
		m.forEach((row, r) => row.forEach((x, k) => matches(pairs, r, k) && typeof x === 'number' && xs.push(x)));
		return xs.length ? Math.max(...xs) : 0;
	},
	MINIFS: (a, c) => {
		const m = matrix(a[0], c);
		const pairs = ifsPairs(a, c, 1);
		const xs: number[] = [];
		m.forEach((row, r) => row.forEach((x, k) => matches(pairs, r, k) && typeof x === 'number' && xs.push(x)));
		return xs.length ? Math.min(...xs) : 0;
	},

	// --- logic ---
	AND: (a, c) => {
		let any = false;
		for (const { v, ref } of each(a, c)) {
			if (isErr(v)) fail(v.e);
			if (ref && (v === null || typeof v === 'string')) continue;
			any = true;
			if (!bool(v)) return false;
		}
		return any ? true : fail('#VALUE!');
	},
	OR: (a, c) => {
		let any = false;
		let res = false;
		for (const { v, ref } of each(a, c)) {
			if (isErr(v)) fail(v.e);
			if (ref && (v === null || typeof v === 'string')) continue;
			any = true;
			if (bool(v)) res = true;
		}
		return any ? res : fail('#VALUE!');
	},
	XOR: (a, c) => {
		let n = 0;
		for (const { v, ref } of each(a, c)) {
			if (isErr(v)) fail(v.e);
			if (ref && (v === null || typeof v === 'string')) continue;
			if (bool(v)) n++;
		}
		return n % 2 === 1;
	},
	NOT: (a, c) => (argc(a, 1), !B(a[0], c)),
	TRUE: () => true,
	FALSE: () => false,
	NA: () => err('#N/A'),

	// --- info ---
	ISNUMBER: (a, c) => typeof S(a[0], c) === 'number',
	ISTEXT: (a, c) => typeof S(a[0], c) === 'string',
	ISNONTEXT: (a, c) => typeof S(a[0], c) !== 'string',
	ISLOGICAL: (a, c) => typeof S(a[0], c) === 'boolean',
	ISERROR: (a, c) => isErr(S(a[0], c)),
	ISERR: (a, c) => {
		const v = S(a[0], c);
		return isErr(v) && v.e !== '#N/A';
	},
	ISNA: (a, c) => {
		const v = S(a[0], c);
		return isErr(v) && v.e === '#N/A';
	},
	ISEVEN: (a, c) => Math.trunc(N(a[0], c)) % 2 === 0,
	ISODD: (a, c) => Math.abs(Math.trunc(N(a[0], c)) % 2) === 1,
	N: (a, c) => {
		const v = S(a[0], c);
		if (isErr(v)) return v;
		return typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : 0;
	},
	T: (a, c) => {
		const v = S(a[0], c);
		if (isErr(v)) return v;
		return typeof v === 'string' ? v : '';
	},
	ROWS: (a, c) => {
		const v = a[0];
		return isRange(v) ? v.r2 - v.r1 + 1 : matrix(v, c).length;
	},
	COLUMNS: (a, c) => {
		const v = a[0];
		return isRange(v) ? v.c2 - v.c1 + 1 : (matrix(v, c)[0]?.length ?? 1);
	},

	// --- lookup ---
	VLOOKUP: (a, c) => {
		argc(a, 3, 4);
		const needle = S(a[0], c);
		if (isErr(needle)) return needle;
		const m = matrix(a[1], c);
		const col = Math.trunc(N(a[2], c));
		const approx = opt(a, 3, c, B, true);
		if (col < 1) fail('#VALUE!');
		if (col > (m[0]?.length ?? 0)) fail('#REF!');
		const i = lookupIndex(needle, m.map((r) => r[0]), approx ? 1 : 0);
		return i < 0 ? err('#N/A') : (m[i][col - 1] ?? null);
	},
	HLOOKUP: (a, c) => {
		argc(a, 3, 4);
		const needle = S(a[0], c);
		if (isErr(needle)) return needle;
		const m = matrix(a[1], c);
		const row = Math.trunc(N(a[2], c));
		const approx = opt(a, 3, c, B, true);
		if (row < 1) fail('#VALUE!');
		if (row > m.length) fail('#REF!');
		const i = lookupIndex(needle, m[0] ?? [], approx ? 1 : 0);
		return i < 0 ? err('#N/A') : (m[row - 1][i] ?? null);
	},
	MATCH: (a, c) => {
		argc(a, 2, 3);
		const needle = S(a[0], c);
		if (isErr(needle)) return needle;
		const list = flat(a[1], c);
		const mode = Math.sign(opt(a, 2, c, N, 1));
		const i = lookupIndex(needle, list, mode);
		return i < 0 ? err('#N/A') : i + 1;
	},
	INDEX: (a, c) => {
		argc(a, 2, 3);
		const src = a[0];
		const m = matrix(src, c);
		let r = Math.trunc(N(a[1], c));
		let k = Math.trunc(opt(a, 2, c, N, 0));
		if (m.length === 1 && a.length === 2) {
			k = r;
			r = 1;
		}
		if (r < 0 || k < 0 || r > m.length || k > (m[0]?.length ?? 0)) fail('#REF!');
		if (isRange(src)) {
			// Whole row/column when 0: return a range so SUM(INDEX(...)) works.
			const rr: RangeV = { ...src };
			if (r > 0) rr.r1 = rr.r2 = src.r1 + r - 1;
			if (k > 0) rr.c1 = rr.c2 = src.c1 + k - 1;
			return rr;
		}
		if (r === 0 || k === 0) fail('#VALUE!');
		return m[r - 1][k - 1] ?? null;
	},
	XLOOKUP: (a, c) => {
		argc(a, 3, 6);
		const needle = S(a[0], c);
		if (isErr(needle)) return needle;
		const look = flat(a[1], c);
		const ret = matrix(a[2], c);
		const vertical = ret.length === look.length;
		const notFound = a[3];
		const mode = Math.trunc(opt(a, 4, c, N, 0));
		const search = Math.trunc(opt(a, 5, c, N, 1));
		const order = search < 0 ? [...look.keys()].reverse() : [...look.keys()];
		let idx = -1;
		if (mode === 0 || mode === 2) {
			const re = mode === 2 && typeof needle === 'string' ? wildcard(needle) : null;
			idx = order.find((i) => (re ? typeof look[i] === 'string' && re.test(look[i] as string) : compare(look[i] as Scalar, needle as Scalar) === 0 && typeof look[i] === typeof needle)) ?? -1;
		} else {
			let best = -1;
			for (const i of order) {
				const v = look[i];
				if (v === null || typeof v !== typeof needle) continue;
				const k = compare(v as Scalar, needle as Scalar);
				if (k === 0) {
					best = i;
					break;
				}
				if (mode === -1 && k < 0 && (best < 0 || compare(v as Scalar, look[best] as Scalar) > 0)) best = i;
				if (mode === 1 && k > 0 && (best < 0 || compare(v as Scalar, look[best] as Scalar) < 0)) best = i;
			}
			idx = best;
		}
		if (idx < 0) return notFound !== undefined ? notFound : err('#N/A');
		if (vertical) return ret[idx].length === 1 ? ret[idx][0] : { kind: 'arr', rows: [ret[idx]] };
		return ret.length === 1 ? ret[0][idx] : { kind: 'arr', rows: ret.map((r) => [r[idx]]) };
	},

	// --- text ---
	CONCAT: (a, c) => [...each(a, c)].map(({ v }) => str(v)).join(''),
	CONCATENATE: (a, c) => a.map((x) => T(x, c)).join(''),
	TEXTJOIN: (a, c) => {
		const sep = T(a[0], c);
		const skip = B(a[1], c);
		const parts: string[] = [];
		for (const { v } of each(a.slice(2), c)) {
			const s = str(v);
			if (!(skip && s === '')) parts.push(s);
		}
		return parts.join(sep);
	},
	LEFT: (a, c) => {
		const n = opt(a, 1, c, N, 1);
		return n < 0 ? fail('#VALUE!') : [...T(a[0], c)].slice(0, n).join('');
	},
	RIGHT: (a, c) => {
		const n = opt(a, 1, c, N, 1);
		if (n < 0) fail('#VALUE!');
		const s = [...T(a[0], c)];
		return n === 0 ? '' : s.slice(-n).join('');
	},
	MID: (a, c) => {
		argc(a, 3);
		const start = Math.trunc(N(a[1], c));
		const n = Math.trunc(N(a[2], c));
		if (start < 1 || n < 0) fail('#VALUE!');
		return [...T(a[0], c)].slice(start - 1, start - 1 + n).join('');
	},
	LEN: (a, c) => [...T(a[0], c)].length,
	TRIM: (a, c) => T(a[0], c).trim().replace(/ {2,}/g, ' '),
	UPPER: (a, c) => T(a[0], c).toUpperCase(),
	LOWER: (a, c) => T(a[0], c).toLowerCase(),
	PROPER: (a, c) => T(a[0], c).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, p, l) => p + l.toUpperCase()),
	REPT: (a, c) => {
		const n = Math.trunc(N(a[1], c));
		return n < 0 ? fail('#VALUE!') : T(a[0], c).repeat(n);
	},
	EXACT: (a, c) => T(a[0], c) === T(a[1], c),
	SUBSTITUTE: (a, c) => {
		argc(a, 3, 4);
		const s = T(a[0], c);
		const from = T(a[1], c);
		const to = T(a[2], c);
		if (!from) return s;
		if (a[3] === undefined) return s.split(from).join(to);
		const nth = Math.trunc(N(a[3], c));
		if (nth < 1) fail('#VALUE!');
		let idx = -1;
		for (let i = 0; i < nth; i++) {
			idx = s.indexOf(from, idx + 1);
			if (idx < 0) return s;
		}
		return s.slice(0, idx) + to + s.slice(idx + from.length);
	},
	REPLACE: (a, c) => {
		const s = T(a[0], c);
		const start = Math.trunc(N(a[1], c));
		const n = Math.trunc(N(a[2], c));
		return s.slice(0, start - 1) + T(a[3], c) + s.slice(start - 1 + n);
	},
	FIND: (a, c) => {
		const needle = T(a[0], c);
		const hay = T(a[1], c);
		const start = opt(a, 2, c, N, 1);
		const i = hay.indexOf(needle, start - 1);
		return i < 0 ? err('#VALUE!') : i + 1;
	},
	SEARCH: (a, c) => {
		const needle = T(a[0], c);
		const hay = T(a[1], c);
		const start = opt(a, 2, c, N, 1);
		const re = new RegExp(wildcard(needle).source.slice(1, -1), 'i');
		const m = re.exec(hay.slice(start - 1));
		return m ? m.index + start : err('#VALUE!');
	},
	TEXT: (a, c) => {
		argc(a, 2);
		const v = S(a[0], c);
		if (isErr(v)) return v;
		return textFormat(v, T(a[1], c));
	},
	VALUE: (a, c) => {
		const v = S(a[0], c);
		if (isErr(v)) return v;
		if (typeof v === 'number') return v;
		const n = parseNumberLiteral(str(v).replace(/,/g, ''));
		return n === null ? err('#VALUE!') : n;
	},
	CHAR: (a, c) => String.fromCharCode(Math.trunc(N(a[0], c))),
	CODE: (a, c) => {
		const s = T(a[0], c);
		return s ? s.charCodeAt(0) : fail('#VALUE!');
	},
	CLEAN: (a, c) => T(a[0], c).replace(/[\x00-\x1f]/g, ''),

	// --- dates ---
	TODAY: (_a, c) => todaySerial(c),
	NOW: (_a, c) => jsDateToSerial(new Date(c.now)),
	DATE: (a, c) => {
		argc(a, 3);
		let y = Math.trunc(N(a[0], c));
		if (y < 1900) y += 1900;
		const s = dateSerial(y, Math.trunc(N(a[1], c)), Math.trunc(N(a[2], c)));
		return s < 0 ? fail('#NUM!') : s;
	},
	TIME: (a, c) => {
		const t = (N(a[0], c) * 3600 + N(a[1], c) * 60 + N(a[2], c)) / 86400;
		return t - Math.floor(t);
	},
	YEAR: (a, c) => serialToParts(N(a[0], c)).y,
	MONTH: (a, c) => serialToParts(N(a[0], c)).m,
	DAY: (a, c) => serialToParts(N(a[0], c)).d,
	HOUR: (a, c) => Math.floor(((N(a[0], c) % 1) * 24 + 1e-9)),
	MINUTE: (a, c) => Math.floor((((N(a[0], c) % 1) * 1440 + 1e-9) % 60)),
	SECOND: (a, c) => Math.round(((N(a[0], c) % 1) * 86400) % 60) % 60,
	WEEKDAY: (a, c) => {
		const s = N(a[0], c);
		const type = opt(a, 1, c, N, 1);
		const wd = serialToParts(s).wd; // 0 = Sunday
		if (type === 1) return wd + 1;
		if (type === 2) return ((wd + 6) % 7) + 1;
		if (type === 3) return (wd + 6) % 7;
		return fail('#NUM!');
	},
	EDATE: (a, c) => addMonths(Math.floor(N(a[0], c)), Math.trunc(N(a[1], c))),
	EOMONTH: (a, c) => {
		const s = addMonths(Math.floor(N(a[0], c)), Math.trunc(N(a[1], c)));
		const { y, m } = serialToParts(s);
		return dateSerial(y, m, daysInMonth(y, m));
	},
	DAYS: (a, c) => Math.floor(N(a[0], c)) - Math.floor(N(a[1], c)),
	DATEDIF: (a, c) => {
		const s1 = Math.floor(N(a[0], c));
		const s2 = Math.floor(N(a[1], c));
		const unit = T(a[2], c).toUpperCase();
		if (s2 < s1) fail('#NUM!');
		const p = serialToParts(s1);
		const q = serialToParts(s2);
		let months = (q.y - p.y) * 12 + (q.m - p.m);
		if (q.d < p.d) months--;
		switch (unit) {
			case 'D':
				return s2 - s1;
			case 'M':
				return months;
			case 'Y':
				return Math.floor(months / 12);
			case 'YM':
				return months % 12;
			case 'MD': {
				if (q.d >= p.d) return q.d - p.d;
				const pm = q.m === 1 ? 12 : q.m - 1;
				const py = q.m === 1 ? q.y - 1 : q.y;
				return daysInMonth(py, pm) - p.d + q.d;
			}
			case 'YD': {
				const anniv = dateSerial(q.y, p.m, Math.min(p.d, daysInMonth(q.y, p.m)));
				return anniv <= s2 ? s2 - anniv : s2 - dateSerial(q.y - 1, p.m, Math.min(p.d, daysInMonth(q.y - 1, p.m)));
			}
		}
		return fail('#NUM!');
	},
	NETWORKDAYS: (a, c) => {
		let s1 = Math.floor(N(a[0], c));
		let s2 = Math.floor(N(a[1], c));
		const holidays = new Set(a[2] !== undefined ? numbers([a[2]], c).map(Math.floor) : []);
		let sign = 1;
		if (s2 < s1) {
			[s1, s2] = [s2, s1];
			sign = -1;
		}
		let n = 0;
		for (let s = s1; s <= s2; s++) {
			const wd = serialToParts(s).wd;
			if (wd !== 0 && wd !== 6 && !holidays.has(s)) n++;
		}
		return sign * n;
	},
	WORKDAY: (a, c) => {
		let s = Math.floor(N(a[0], c));
		let days = Math.trunc(N(a[1], c));
		const holidays = new Set(a[2] !== undefined ? numbers([a[2]], c).map(Math.floor) : []);
		const step = days < 0 ? -1 : 1;
		while (days !== 0) {
			s += step;
			const wd = serialToParts(s).wd;
			if (wd !== 0 && wd !== 6 && !holidays.has(s)) days -= step;
		}
		return s;
	},
	DATEVALUE: (a, c) => {
		const s = T(a[0], c).trim();
		const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
		if (!m) return fail('#VALUE!');
		return dateSerial(Number(m[1]), Number(m[2]), Number(m[3]));
	}
};

export const VOLATILE = new Set(['NOW', 'TODAY', 'RAND', 'RANDBETWEEN']);

/** Functions whose result should be shown as a date when the cell has no number format. */
export const DATE_RESULT = new Set(['TODAY', 'DATE', 'EDATE', 'EOMONTH', 'WORKDAY', 'DATEVALUE']);
export const DATETIME_RESULT = new Set(['NOW']);

// ---------- formulajs fallback ----------

const fj = FJ as unknown as Record<string, unknown>;

function toFj(v: EvalV, ctx: EvalCtx): unknown {
	if (isRange(v) || isArr(v)) return matrix(v, ctx).map((r) => r.map((x) => (isErr(x) ? fjError(x.e) : x)));
	if (isErr(v)) return fjError(v.e);
	return v;
}

function fjError(code: ErrorCode) {
	const e = new Error(code);
	e.name = code;
	return e;
}

function fromFj(r: unknown): EvalV {
	if (r instanceof Error) {
		const code = (r.message || r.name) as ErrorCode;
		return err(['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#N/A', '#NUM!', '#NULL!'].includes(code) ? code : '#VALUE!');
	}
	if (r instanceof Date) return jsDateToSerial(r);
	if (typeof r === 'number') return Number.isFinite(r) ? r : err('#NUM!');
	if (typeof r === 'string' || typeof r === 'boolean') return r;
	if (r === null || r === undefined) return null;
	if (Array.isArray(r)) {
		const rows = (Array.isArray(r[0]) ? r : [r]) as unknown[][];
		return { kind: 'arr', rows: rows.map((row) => row.map((x) => fromFj(x) as Value)) };
	}
	return err('#VALUE!');
}

for (const name of Object.keys(fj)) {
	if (!/^[A-Z][A-Z0-9.]*$/.test(name) || FUNCTIONS[name] || SPECIAL[name]) continue;
	const f = fj[name];
	if (typeof f !== 'function') continue;
	FUNCTIONS[name] = (args, ctx) => {
		for (const a of args) if (isErr(a)) return a;
		return fromFj((f as (...x: unknown[]) => unknown)(...args.map((a) => toFj(a, ctx))));
	};
}

export const FUNCTION_NAMES = [...new Set([...Object.keys(FUNCTIONS), ...Object.keys(SPECIAL)])].sort();

export { formatGeneral };
