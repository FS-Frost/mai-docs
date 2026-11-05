// Autofilter: which rows of the filter range are hidden by the criteria.
import { cellKey } from './addr.ts';
import type { CondOp, FilterCriterion, Sheet } from './model.ts';
import { compare, isErr, type Value } from './values.ts';

export function matchesCriterion(v: Value | undefined, text: string, cr: FilterCriterion): boolean {
	if (cr.values && !cr.values.includes(text)) return false;
	if (cr.cond) return matchesCond(v ?? null, text, cr.cond.op, cr.cond.value ?? '');
	return true;
}

export function matchesCond(v: Value, text: string, op: CondOp, raw: string): boolean {
	const empty = v === null || v === '';
	if (op === 'empty') return empty;
	if (op === 'notEmpty') return !empty;
	if (op === 'contains') return text.toLowerCase().includes(raw.toLowerCase());
	if (op === 'notContains') return !text.toLowerCase().includes(raw.toLowerCase());
	if (isErr(v)) return false;
	const n = Number(raw.replace(',', '.'));
	const target = raw.trim() !== '' && Number.isFinite(n) && typeof v === 'number' ? n : raw;
	const k = typeof target === 'number' ? compare(v as number, target) : compare(text, target);
	switch (op) {
		case 'eq':
			return k === 0;
		case 'ne':
			return k !== 0;
		case 'gt':
			return k > 0;
		case 'gte':
			return k >= 0;
		case 'lt':
			return k < 0;
		case 'lte':
			return k <= 0;
	}
	return true;
}

/** Recomputes sheet.hidden from sheet.filter. `text(v, cell)` = displayed text (for value lists). */
export function applyFilter(sheet: Sheet, text: (r: number, c: number) => string) {
	sheet.hidden = new Set();
	const f = sheet.filter;
	if (!f) return;
	const cols = Object.entries(f.criteria).filter(([, cr]) => cr.values || cr.cond);
	if (!cols.length) return;
	for (let r = f.range.r1 + 1; r <= f.range.r2; r++) {
		for (const [c, cr] of cols) {
			const col = Number(c);
			const v = sheet.cells.get(cellKey(r, col))?.v;
			if (!matchesCriterion(v, text(r, col), cr)) {
				sheet.hidden.add(r);
				break;
			}
		}
	}
}

/** Distinct displayed values of a filter column (for the checklist), sorted. */
export function distinctValues(sheet: Sheet, col: number, text: (r: number, c: number) => string): string[] {
	const f = sheet.filter;
	if (!f) return [];
	const set = new Set<string>();
	for (let r = f.range.r1 + 1; r <= f.range.r2; r++) set.add(text(r, col));
	return [...set].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
}
