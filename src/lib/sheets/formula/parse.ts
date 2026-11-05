// Tokenizer + recursive-descent parser (Excel precedence) and printer.
import { colIndex, colName, MAX_COLS, MAX_ROWS } from '../addr.ts';
import { ERROR_CODES, type ErrorCode } from '../values.ts';
import type { BinOp, Node, RefEnd } from './ast.ts';

export class ParseError extends Error {}

type Tok =
	| { k: 'num'; v: number }
	| { k: 'str'; v: string }
	| { k: 'err'; v: ErrorCode }
	| { k: 'word'; v: string; sheet?: string } // identifier or cell ref like A1 / $A$1
	| { k: 'sheet'; v: string } // sheet prefix incl. '!' consumed; next token is a ref
	| { k: 'op'; v: string }
	| { k: 'eof' };

const OPS = ['<>', '<=', '>=', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%', '(', ')', ',', ':', '{', '}', ';'];

function tokenize(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	const n = src.length;
	while (i < n) {
		const ch = src[i];
		if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
			i++;
			continue;
		}
		if (ch === '"') {
			let s = '';
			i++;
			for (;;) {
				if (i >= n) throw new ParseError('unterminated string');
				if (src[i] === '"') {
					if (src[i + 1] === '"') {
						s += '"';
						i += 2;
						continue;
					}
					i++;
					break;
				}
				s += src[i++];
			}
			out.push({ k: 'str', v: s });
			continue;
		}
		if (ch === "'") {
			// Quoted sheet name: 'My sheet'!A1
			let s = '';
			i++;
			for (;;) {
				if (i >= n) throw new ParseError('unterminated sheet name');
				if (src[i] === "'") {
					if (src[i + 1] === "'") {
						s += "'";
						i += 2;
						continue;
					}
					i++;
					break;
				}
				s += src[i++];
			}
			if (src[i] !== '!') throw new ParseError('expected !');
			i++;
			out.push({ k: 'sheet', v: s });
			continue;
		}
		if (ch === '#') {
			const code = ERROR_CODES.find((c) => src.startsWith(c, i) || src.slice(i, i + c.length).toUpperCase() === c);
			if (!code) throw new ParseError('bad error literal');
			out.push({ k: 'err', v: code });
			i += code.length;
			continue;
		}
		if (/[0-9.]/.test(ch) && !(ch === '.' && !/[0-9]/.test(src[i + 1] ?? ''))) {
			const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
			// Row range like 1:3 → word token "1" so the parser can build a range.
			const after = src[i + m[0].length];
			if (after === ':' && /^\d+$/.test(m[0]) && /^\$?\d/.test(src.slice(i + m[0].length + 1))) {
				out.push({ k: 'word', v: m[0] });
			} else out.push({ k: 'num', v: Number(m[0]) });
			i += m[0].length;
			continue;
		}
		if (/[A-Za-z_$\\]/.test(ch)) {
			const m = /^[A-Za-z_$\\][A-Za-z0-9_.$]*/.exec(src.slice(i))!;
			let w = m[0];
			i += w.length;
			if (src[i] === '!') {
				i++;
				out.push({ k: 'sheet', v: w });
				continue;
			}
			// Row ref with $: $1:$3 starts with $ followed by digits.
			if (w === '$' && /\d/.test(src[i] ?? '')) {
				const d = /^\d+/.exec(src.slice(i))![0];
				w += d;
				i += d.length;
			}
			out.push({ k: 'word', v: w });
			continue;
		}
		const op = OPS.find((o) => src.startsWith(o, i));
		if (!op) throw new ParseError(`unexpected ${ch}`);
		out.push({ k: 'op', v: op });
		i += op.length;
	}
	out.push({ k: 'eof' });
	return out;
}

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;
const COL = /^(\$?)([A-Za-z]{1,3})$/;
const ROW = /^(\$?)(\d{1,7})$/;

function cellEnd(w: string): RefEnd | null {
	const m = CELL.exec(w);
	if (!m) return null;
	const c = colIndex(m[2]);
	const r = Number(m[4]) - 1;
	if (c < 0 || c >= MAX_COLS || r < 0 || r >= MAX_ROWS) return null;
	return { r, c, ac: !!m[1], ar: !!m[3] };
}
function colEnd(w: string): RefEnd | null {
	const m = COL.exec(w);
	if (!m) return null;
	const c = colIndex(m[2]);
	return c < 0 || c >= MAX_COLS ? null : { c, ac: !!m[1], ar: false };
}
function rowEnd(w: string): RefEnd | null {
	const m = ROW.exec(w);
	if (!m) return null;
	const r = Number(m[2]) - 1;
	return r < 0 || r >= MAX_ROWS ? null : { r, ar: !!m[1], ac: false };
}

class Parser {
	i = 0;
	constructor(private toks: Tok[]) {}
	peek() {
		return this.toks[this.i];
	}
	next() {
		return this.toks[this.i++];
	}
	isOp(v: string) {
		const t = this.peek();
		return t.k === 'op' && t.v === v;
	}
	expectOp(v: string) {
		if (!this.isOp(v)) throw new ParseError(`expected ${v}`);
		this.i++;
	}

	parse(): Node {
		const n = this.comparison();
		if (this.peek().k !== 'eof') throw new ParseError('unexpected token');
		return n;
	}
	comparison(): Node {
		let a = this.concat();
		for (;;) {
			const t = this.peek();
			if (t.k === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(t.v)) {
				this.i++;
				a = { t: 'bin', op: t.v as BinOp, a, b: this.concat() };
			} else return a;
		}
	}
	concat(): Node {
		let a = this.additive();
		while (this.isOp('&')) {
			this.i++;
			a = { t: 'bin', op: '&', a, b: this.additive() };
		}
		return a;
	}
	additive(): Node {
		let a = this.term();
		for (;;) {
			const t = this.peek();
			if (t.k === 'op' && (t.v === '+' || t.v === '-')) {
				this.i++;
				a = { t: 'bin', op: t.v, a, b: this.term() };
			} else return a;
		}
	}
	term(): Node {
		let a = this.power();
		for (;;) {
			const t = this.peek();
			if (t.k === 'op' && (t.v === '*' || t.v === '/')) {
				this.i++;
				a = { t: 'bin', op: t.v, a, b: this.power() };
			} else return a;
		}
	}
	power(): Node {
		let a = this.unary();
		while (this.isOp('^')) {
			this.i++;
			a = { t: 'bin', op: '^', a, b: this.unary() };
		}
		return a;
	}
	unary(): Node {
		const t = this.peek();
		if (t.k === 'op' && (t.v === '-' || t.v === '+')) {
			this.i++;
			return { t: 'un', op: t.v, a: this.unary() };
		}
		return this.postfix();
	}
	postfix(): Node {
		let a = this.primary();
		while (this.isOp('%')) {
			this.i++;
			a = { t: 'un', op: '%', a };
		}
		return a;
	}
	primary(): Node {
		const t = this.next();
		switch (t.k) {
			case 'num':
				return { t: 'num', v: t.v };
			case 'str':
				return { t: 'str', v: t.v };
			case 'err':
				return t.v === '#REF!' ? { t: 'refErr' } : { t: 'err', v: t.v };
			case 'sheet': {
				const w = this.next();
				if (w.k === 'err' && w.v === '#REF!') return { t: 'refErr', sheet: t.v };
				if (w.k !== 'word') throw new ParseError('expected reference');
				const ref = this.reference(w.v);
				if (!ref) throw new ParseError('bad reference');
				return { ...ref, sheet: t.v };
			}
			case 'word': {
				if (this.isOp('(')) {
					this.i++;
					const args: Node[] = [];
					if (!this.isOp(')')) {
						for (;;) {
							if (this.isOp(',') || this.isOp(')')) args.push({ t: 'empty' });
							else args.push(this.comparison());
							if (this.isOp(',')) {
								this.i++;
								continue;
							}
							break;
						}
					}
					this.expectOp(')');
					return { t: 'fn', name: t.v.toUpperCase(), args };
				}
				const up = t.v.toUpperCase();
				if (up === 'TRUE' || up === 'FALSE') return { t: 'bool', v: up === 'TRUE' };
				const ref = this.reference(t.v);
				if (ref) return ref;
				return { t: 'name', name: t.v };
			}
			case 'op':
				if (t.v === '(') {
					const a = this.comparison();
					this.expectOp(')');
					return { t: 'paren', a };
				}
				if (t.v === '{') return this.array();
				throw new ParseError(`unexpected ${t.v}`);
			default:
				throw new ParseError('unexpected end');
		}
	}
	/** Word already consumed. Handles A1, A1:B2, A:B, 1:3. */
	reference(w: string): (Node & { t: 'ref' }) | null {
		const cell = cellEnd(w);
		if (cell) {
			if (this.isOp(':')) {
				const save = this.i;
				this.i++;
				const n = this.peek();
				const b = n.k === 'word' ? cellEnd(n.v) : null;
				if (b) {
					this.i++;
					return { t: 'ref', a: cell, b };
				}
				this.i = save;
			}
			return { t: 'ref', a: cell };
		}
		const col = colEnd(w);
		const row = col ? null : rowEnd(w);
		const first = col ?? row;
		if (first && this.isOp(':')) {
			const save = this.i;
			this.i++;
			const n = this.peek();
			const b =
				n.k === 'word' ? (col ? colEnd(n.v) : rowEnd(n.v)) : n.k === 'num' && !col && Number.isInteger(n.v) ? rowEnd(String(n.v)) : null;
			if (b) {
				this.i++;
				return { t: 'ref', a: first, b };
			}
			this.i = save;
		}
		return null;
	}
	array(): Node {
		const rows: Node[][] = [[]];
		if (this.isOp('}')) {
			this.i++;
			return { t: 'arr', rows };
		}
		for (;;) {
			rows[rows.length - 1].push(this.unary());
			if (this.isOp(',')) {
				this.i++;
				continue;
			}
			if (this.isOp(';')) {
				this.i++;
				rows.push([]);
				continue;
			}
			this.expectOp('}');
			return { t: 'arr', rows };
		}
	}
}

const cache = new Map<string, Node>();

/** Parses a formula (without '='). Throws ParseError. Results are memoized. */
export function parse(src: string): Node {
	const hit = cache.get(src);
	if (hit) return hit;
	const node = new Parser(tokenize(src)).parse();
	if (cache.size > 20_000) cache.clear();
	cache.set(src, node);
	return node;
}

export function tryParse(src: string): Node | null {
	try {
		return parse(src);
	} catch {
		return null;
	}
}

// ---------- Printer ----------

export function quoteSheet(name: string) {
	if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !CELL.test(name) && !/^(TRUE|FALSE)$/i.test(name) && !/^R\d*C\d*$/i.test(name)) return name;
	return `'${name.replace(/'/g, "''")}'`;
}

function endText(e: RefEnd) {
	const c = e.c === undefined ? '' : `${e.ac ? '$' : ''}${colName(e.c)}`;
	const r = e.r === undefined ? '' : `${e.ar ? '$' : ''}${e.r + 1}`;
	return c + r;
}

export function refText(n: { sheet?: string; a: RefEnd; b?: RefEnd }) {
	const p = n.sheet !== undefined ? `${quoteSheet(n.sheet)}!` : '';
	return p + endText(n.a) + (n.b ? `:${endText(n.b)}` : '');
}

const numText = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15))));

export function print(n: Node): string {
	switch (n.t) {
		case 'num':
			return numText(n.v);
		case 'str':
			return `"${n.v.replace(/"/g, '""')}"`;
		case 'bool':
			return n.v ? 'TRUE' : 'FALSE';
		case 'err':
			return n.v;
		case 'ref':
			return refText(n);
		case 'refErr':
			return (n.sheet !== undefined ? `${quoteSheet(n.sheet)}!` : '') + '#REF!';
		case 'name':
			return n.name;
		case 'fn':
			return `${n.name}(${n.args.map(print).join(',')})`;
		case 'un':
			return n.op === '%' ? `${print(n.a)}%` : `${n.op}${print(n.a)}`;
		case 'bin':
			return `${print(n.a)}${n.op}${print(n.b)}`;
		case 'arr':
			return `{${n.rows.map((r) => r.map(print).join(',')).join(';')}}`;
		case 'paren':
			return `(${print(n.a)})`;
		case 'empty':
			return '';
	}
}

/** Visits every node (pre-order). */
export function walk(n: Node, fn: (n: Node) => void) {
	fn(n);
	switch (n.t) {
		case 'fn':
			n.args.forEach((a) => walk(a, fn));
			break;
		case 'un':
		case 'paren':
			walk(n.a, fn);
			break;
		case 'bin':
			walk(n.a, fn);
			walk(n.b, fn);
			break;
		case 'arr':
			n.rows.forEach((r) => r.forEach((a) => walk(a, fn)));
			break;
	}
}

/** Returns a transformed copy (bottom-up). */
export function mapNode(n: Node, fn: (n: Node) => Node): Node {
	let m: Node;
	switch (n.t) {
		case 'fn':
			m = { ...n, args: n.args.map((a) => mapNode(a, fn)) };
			break;
		case 'un':
		case 'paren':
			m = { ...n, a: mapNode(n.a, fn) };
			break;
		case 'bin':
			m = { ...n, a: mapNode(n.a, fn), b: mapNode(n.b, fn) };
			break;
		case 'arr':
			m = { ...n, rows: n.rows.map((r) => r.map((a) => mapNode(a, fn))) };
			break;
		default:
			m = n;
	}
	return fn(m);
}
