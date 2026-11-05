import { cellKey, parseA1 } from '../src/lib/sheets/addr.ts';
import { Engine } from '../src/lib/sheets/formula/engine.ts';
import { newSheet, type Workbook } from '../src/lib/sheets/model.ts';
import type { Value } from '../src/lib/sheets/values.ts';

/** Builds a workbook: { Sheet1: { A1: 1, B1: '=A1*2' } }. Strings starting with '=' are formulas. */
export function book(spec: Record<string, Record<string, Value>>) {
	const wb: Workbook = { sheets: [], active: '', styles: [{}] };
	for (const [name, cells] of Object.entries(spec)) {
		const s = newSheet(name, name.toLowerCase());
		for (const [ref, v] of Object.entries(cells)) {
			const p = parseA1(ref)!;
			if (typeof v === 'string' && v.startsWith('=')) s.cells.set(cellKey(p.r, p.c), { f: v.slice(1) });
			else s.cells.set(cellKey(p.r, p.c), { v });
		}
		wb.sheets.push(s);
	}
	wb.active = wb.sheets[0].id;
	const engine = new Engine(wb);
	engine.rebuild();
	const get = (ref: string, sheet = wb.sheets[0].name) => {
		const s = wb.sheets.find((x) => x.name === sheet)!;
		const p = parseA1(ref)!;
		return s.cells.get(cellKey(p.r, p.c))?.v ?? null;
	};
	const set = (ref: string, v: Value, sheet = wb.sheets[0].name) => {
		const s = wb.sheets.find((x) => x.name === sheet)!;
		const p = parseA1(ref)!;
		const k = cellKey(p.r, p.c);
		if (typeof v === 'string' && v.startsWith('=')) s.cells.set(k, { f: v.slice(1) });
		else s.cells.set(k, { v });
		engine.update([{ sheetId: s.id, key: k }]);
	};
	return { wb, engine, get, set };
}

/** Evaluates a single formula in an otherwise-empty (or given) workbook. */
export function calc(formula: string, cells: Record<string, Value> = {}) {
	const b = book({ Sheet1: { ...cells, ZZ1000: formula.startsWith('=') ? formula : `=${formula}` } });
	return b.get('ZZ1000');
}
