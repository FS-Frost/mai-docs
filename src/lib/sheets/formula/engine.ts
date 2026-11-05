// Recalculation engine: dependency index + incremental recalc of dirty formulas.
// Ordering is demand-driven: evaluating a formula that reads a dirty formula evaluates that one first
// (depth-limited recursion + explicit stack, so long chains don't overflow). A formula reached again while it is
// still being evaluated is a cycle → #CIRC!.
import { cellKey, keyCol, keyRow } from '../addr.ts';
import { sheetByName, type Workbook } from '../model.ts';
import { err, isErr, type Value } from '../values.ts';
import type { Node } from './ast.ts';
import { evaluateFormula, type EvalCtx } from './eval.ts';
import { VOLATILE } from './functions.ts';
import { tryParse, walk } from './parse.ts';

type GKey = string; // `${sheetId}|${cellKey}`
const gk = (sheetId: string, key: number): GKey => `${sheetId}|${key}`;
const split = (g: GKey) => {
	const i = g.lastIndexOf('|');
	return { sheetId: g.slice(0, i), key: Number(g.slice(i + 1)) };
};

type RangeDep = { r1: number; c1: number; r2: number; c2: number; f: GKey };

class NeedFirst {
	constructor(public g: GKey) {}
}
class Cycle {}

const MAX_DEPTH = 400;
const BIG = 4000;

export class Engine {
	private cellDeps = new Map<GKey, Set<GKey>>();
	private rangeDeps = new Map<string, RangeDep[]>();
	private precs = new Map<GKey, { cells: GKey[]; ranges: { sheetId: string; dep: RangeDep }[] }>();
	private volatile = new Set<GKey>();
	private formulas = new Set<GKey>();

	// Per-recalc state.
	private state = new Map<GKey, 1 | 2>(); // 1 visiting, 2 done
	private dirty = new Set<GKey>();
	private extents = new Map<string, { rows: number; cols: number }>();
	private depth = 0;
	private now = Date.now();

	constructor(public wb: Workbook) {}

	/** Re-indexes every formula and recalculates everything (after load, structural changes, sheet rename…). */
	rebuild() {
		this.cellDeps.clear();
		this.rangeDeps.clear();
		this.precs.clear();
		this.volatile.clear();
		this.formulas.clear();
		for (const s of this.wb.sheets) for (const [k, c] of s.cells) if (c.f) this.register(s.id, k, c.f);
		this.recalc(new Set(this.formulas));
	}

	/** Cells whose content changed (value or formula). Recalculates what depends on them. */
	update(changed: { sheetId: string; key: number }[]) {
		const seeds = new Set<GKey>();
		for (const { sheetId, key } of changed) {
			const g = gk(sheetId, key);
			this.unregister(g);
			const cell = this.wb.sheets.find((s) => s.id === sheetId)?.cells.get(key);
			if (cell?.f) this.register(sheetId, key, cell.f);
			seeds.add(g);
		}
		if (changed.length > BIG) {
			this.recalc(new Set(this.formulas));
			return;
		}
		const dirty = this.closure(seeds);
		if (!dirty) {
			this.recalc(new Set(this.formulas));
			return;
		}
		for (const v of this.volatile) dirty.add(v);
		this.recalc(dirty);
	}

	/** Recalculates volatile formulas only (e.g. on open). */
	recalcVolatile() {
		if (!this.volatile.size) return;
		const dirty = this.closure(new Set(this.volatile)) ?? new Set(this.formulas);
		this.recalc(dirty);
	}

	hasFormulas() {
		return this.formulas.size > 0;
	}

	// ---------- Index ----------

	private register(sheetId: string, key: number, f: string) {
		const g = gk(sheetId, key);
		this.formulas.add(g);
		const ast = tryParse(f);
		const entry = { cells: [] as GKey[], ranges: [] as { sheetId: string; dep: RangeDep }[] };
		this.precs.set(g, entry);
		if (!ast) return;
		walk(ast, (n: Node) => {
			if (n.t === 'fn' && VOLATILE.has(n.name)) this.volatile.add(g);
			if (n.t !== 'ref') return;
			const target = n.sheet !== undefined ? sheetByName(this.wb, n.sheet)?.id : sheetId;
			if (!target) return;
			if (!n.b && n.a.r !== undefined && n.a.c !== undefined) {
				const dg = gk(target, cellKey(n.a.r, n.a.c));
				let set = this.cellDeps.get(dg);
				if (!set) this.cellDeps.set(dg, (set = new Set()));
				set.add(g);
				entry.cells.push(dg);
				return;
			}
			const b = n.b ?? n.a;
			const dep: RangeDep = {
				r1: Math.min(n.a.r ?? 0, b.r ?? 0),
				c1: Math.min(n.a.c ?? 0, b.c ?? 0),
				r2: n.a.r === undefined || b.r === undefined ? Infinity : Math.max(n.a.r, b.r),
				c2: n.a.c === undefined || b.c === undefined ? Infinity : Math.max(n.a.c, b.c),
				f: g
			};
			let list = this.rangeDeps.get(target);
			if (!list) this.rangeDeps.set(target, (list = []));
			list.push(dep);
			entry.ranges.push({ sheetId: target, dep });
		});
	}

	private unregister(g: GKey) {
		const p = this.precs.get(g);
		if (!p) return;
		for (const dg of p.cells) this.cellDeps.get(dg)?.delete(g);
		for (const { sheetId, dep } of p.ranges) {
			const list = this.rangeDeps.get(sheetId);
			if (list) {
				const i = list.indexOf(dep);
				if (i >= 0) list.splice(i, 1);
			}
		}
		this.precs.delete(g);
		this.volatile.delete(g);
		this.formulas.delete(g);
	}

	/** Formulas depending (transitively) on the seeds, plus seeds that are formulas. null = too many: recalc all. */
	private closure(seeds: Set<GKey>): Set<GKey> | null {
		const dirty = new Set<GKey>();
		const queue = [...seeds];
		for (const s of seeds) if (this.formulas.has(s)) dirty.add(s);
		while (queue.length) {
			const g = queue.pop()!;
			const add = (f: GKey) => {
				if (dirty.has(f)) return;
				dirty.add(f);
				queue.push(f);
			};
			this.cellDeps.get(g)?.forEach(add);
			const { sheetId, key } = split(g);
			const r = keyRow(key);
			const c = keyCol(key);
			const list = this.rangeDeps.get(sheetId);
			if (list) for (const d of list) if (r >= d.r1 && r <= d.r2 && c >= d.c1 && c <= d.c2) add(d.f);
			if (dirty.size > BIG) return null;
		}
		return dirty;
	}

	// ---------- Evaluation ----------

	private recalc(dirty: Set<GKey>) {
		this.dirty = dirty;
		this.state.clear();
		this.extents.clear();
		this.now = Date.now();
		// Row order keeps recursion shallow for the usual top-down chains.
		const order = [...dirty].sort((a, b) => {
			const x = split(a);
			const y = split(b);
			return x.sheetId === y.sheetId ? x.key - y.key : x.sheetId < y.sheetId ? -1 : 1;
		});
		for (const g of order) {
			if (this.state.get(g) === 2) continue;
			const stack: GKey[] = [g];
			while (stack.length) {
				const top = stack[stack.length - 1];
				if (this.state.get(top) === 2) {
					stack.pop();
					continue;
				}
				try {
					this.depth = 0;
					this.compute(top);
					stack.pop();
				} catch (e) {
					if (e instanceof NeedFirst) {
						if (stack.includes(e.g)) {
							this.setValue(e.g, err('#CIRC!'));
							this.state.set(e.g, 2);
						} else stack.push(e.g);
						continue;
					}
					throw e;
				}
			}
		}
		this.dirty = new Set();
		this.state.clear();
	}

	private setValue(g: GKey, v: Value) {
		const { sheetId, key } = split(g);
		const cell = this.wb.sheets.find((s) => s.id === sheetId)?.cells.get(key);
		if (cell) cell.v = v;
	}

	private compute(g: GKey) {
		const { sheetId, key } = split(g);
		const sheet = this.wb.sheets.find((s) => s.id === sheetId);
		const cell = sheet?.cells.get(key);
		if (!cell?.f) {
			this.state.set(g, 2);
			return;
		}
		this.state.set(g, 1);
		let v: Value;
		const ast = tryParse(cell.f);
		if (!ast) v = err('#NAME?');
		else {
			try {
				v = evaluateFormula(ast, this.ctx(sheetId, keyRow(key), keyCol(key)));
			} catch (e) {
				if (e instanceof Cycle) v = err('#CIRC!');
				else if (e instanceof NeedFirst) {
					this.state.delete(g);
					throw e;
				} else if (e instanceof RangeError) {
					this.state.delete(g);
					throw new NeedFirst(g);
				} else {
					console.error('[mai] formula error', cell.f, e);
					v = err('#VALUE!');
				}
			}
		}
		if (typeof v === 'number' && !Number.isFinite(v)) v = err('#NUM!');
		cell.v = v;
		this.state.set(g, 2);
	}

	private ctx(sheetId: string, row: number, col: number): EvalCtx {
		return {
			sheetId,
			row,
			col,
			now: this.now,
			resolveSheet: (name) => sheetByName(this.wb, name)?.id,
			extent: (id) => this.extent(id),
			value: (sid, r, c) => this.read(sid, r, c)
		};
	}

	private read(sheetId: string, r: number, c: number): Value {
		const sheet = this.wb.sheets.find((s) => s.id === sheetId);
		const key = cellKey(r, c);
		const cell = sheet?.cells.get(key);
		if (!cell) return null;
		if (cell.f) {
			const g = gk(sheetId, key);
			const st = this.state.get(g);
			if (st === 1) throw new Cycle();
			if (st !== 2 && this.dirty.has(g)) {
				if (this.depth >= MAX_DEPTH) throw new NeedFirst(g);
				this.depth++;
				try {
					this.compute(g);
				} finally {
					this.depth--;
				}
			}
		}
		const v = cell.v ?? null;
		return v === '' && !cell.f ? null : v;
	}

	private extent(sheetId: string) {
		let e = this.extents.get(sheetId);
		if (!e) {
			let rows = 0;
			let cols = 0;
			const sheet = this.wb.sheets.find((s) => s.id === sheetId);
			if (sheet)
				for (const k of sheet.cells.keys()) {
					const r = keyRow(k) + 1;
					const c = keyCol(k) + 1;
					if (r > rows) rows = r;
					if (c > cols) cols = c;
				}
			e = { rows, cols };
			this.extents.set(sheetId, e);
		}
		return e;
	}
}

export { isErr };
