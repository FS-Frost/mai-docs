// What a user typed into a cell → stored cell content. Numbers/dates follow the UI locale
// (es: "1,5", "31/1/2024"; en: "1.5", "1/31/2024"). Formulas are locale-independent.
import { parseValue } from 'numfmt';
import type { Locale } from '../i18n/detect.ts';
import { formatForId } from './format.ts';
import { DATE_RESULT, DATETIME_RESULT } from './formula/functions.ts';
import { tryParse } from './formula/parse.ts';
import { DATE_FMT, DATETIME_FMT } from './format.ts';
import type { Value } from './values.ts';

export type Parsed = { v?: Value; f?: string; numFmt?: string };

export function parseInput(text: string, locale: Locale, currentFmt?: string): Parsed {
	if (text === '') return { v: null };
	if (text.startsWith("'")) return { v: text.slice(1) };
	if (text.startsWith('=') && text.length > 1) {
		const f = text.slice(1).trim();
		const out: Parsed = { f };
		const ast = tryParse(f);
		if (ast && ast.t === 'fn' && !currentFmt) {
			if (DATE_RESULT.has(ast.name)) out.numFmt = DATE_FMT[locale];
			else if (DATETIME_RESULT.has(ast.name)) out.numFmt = DATETIME_FMT[locale];
		}
		return out;
	}
	if (currentFmt === '@') return { v: text };
	const up = text.trim().toUpperCase();
	if (up === 'TRUE' || (locale === 'es' && up === 'VERDADERO')) return { v: true };
	if (up === 'FALSE' || (locale === 'es' && up === 'FALSO')) return { v: false };
	const p = parseValue(text.trim(), { locale });
	if (p && typeof p.value === 'number' && Number.isFinite(p.value)) {
		const numFmt = currentFmt ? undefined : formatForId(p.formatId, locale);
		return numFmt ? { v: p.value, numFmt } : { v: p.value };
	}
	return { v: text };
}

/** Text shown in the editor for a cell (formulas with '=', numbers in locale form without grouping). */
export function editText(cell: { v?: Value; f?: string } | undefined, locale: Locale, numFmt?: string, displayed?: string): string {
	if (!cell) return '';
	if (cell.f) return `=${cell.f}`;
	const v = cell.v;
	if (v === null || v === undefined) return '';
	if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
	if (typeof v === 'object') return v.e;
	if (typeof v === 'number') {
		// Dates/percents are edited as displayed (so re-parsing keeps them).
		if (displayed !== undefined && numFmt && (/[dmyhs]/i.test(numFmt.replace(/"[^"]*"/g, '')) || numFmt.includes('%'))) return displayed;
		const s = String(Number(v.toPrecision(15)));
		return locale === 'es' ? s.replace('.', ',') : s;
	}
	if (numFmt !== '@' && (v.startsWith('=') || (parseValue(v, { locale }) != null && v.trim() !== ''))) return `'${v}`;
	return v;
}
