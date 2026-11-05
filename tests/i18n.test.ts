import { describe, expect, test } from 'bun:test';
import en from '../src/lib/i18n/en.ts';
import es from '../src/lib/i18n/es.ts';
import { detect, readPref, resolveLocale } from '../src/lib/i18n/detect.ts';
import { noteVersion } from '../src/lib/client/version.ts';
import { applyFilter, distinctValues } from '../src/lib/sheets/filter.ts';
import { cellKey } from '../src/lib/sheets/addr.ts';
import { newSheet } from '../src/lib/sheets/model.ts';

type Tree = { [k: string]: string | ((...a: never[]) => string) | Tree };

function leaves(t: Tree, prefix = ''): [string, unknown][] {
	return Object.entries(t).flatMap(([k, v]) => (typeof v === 'object' ? leaves(v as Tree, `${prefix}${k}.`) : [[`${prefix}${k}`, v] as [string, unknown]]));
}

describe('i18n', () => {
	const a = leaves(en as unknown as Tree);
	const b = leaves(es as unknown as Tree);
	test('same keys in both languages', () => {
		expect(b.map(([k]) => k).sort()).toEqual(a.map(([k]) => k).sort());
	});
	test('no empty strings, same kinds', () => {
		const map = new Map(b);
		for (const [k, v] of a) {
			const w = map.get(k);
			expect(typeof w).toBe(typeof v);
			if (typeof v === 'string') {
				expect(v.trim().length, k).toBeGreaterThan(0);
				expect((w as string).trim().length, k).toBeGreaterThan(0);
			}
		}
	});
	test('functions produce text', () => {
		expect(es.library.files(1)).toBe('1 archivo');
		expect(en.library.files(2)).toBe('2 files');
		expect(es.sheet.sheetName(3)).toBe('Hoja3');
	});
	test('detection', () => {
		expect(detect(['es-CL', 'en'])).toBe('es');
		expect(detect(['en-US', 'es'])).toBe('es');
		expect(detect(['es-419'])).toBe('es');
		expect(detect(['fr-FR', 'de'])).toBe('en');
		expect(detect(['estonian-fake'])).toBe('en');
		expect(resolveLocale('en', ['es-ES'])).toBe('en');
		expect(resolveLocale('system', ['es-ES'])).toBe('es');
		expect(readPref({ getItem: () => 'es' })).toBe('es');
		expect(readPref({ getItem: () => 'xx' })).toBe('system');
		expect(readPref(null)).toBe('system');
	});
});

describe('version', () => {
	test('noteVersion reports changes once', () => {
		const m = new Map<string, string>();
		const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
		expect(noteVersion('abc', store)).toBeNull();
		expect(noteVersion('abc', store)).toBeNull();
		expect(noteVersion('def', store)).toBe('abc');
		expect(noteVersion('dev', store)).toBeNull();
	});
});

describe('filter', () => {
	test('values and conditions hide rows', () => {
		const s = newSheet('S');
		const data = [['name', 'n'], ['a', 1], ['b', 5], ['c', 9], ['', 3]];
		data.forEach((row, r) => row.forEach((v, c) => v !== '' && s.cells.set(cellKey(r, c), { v })));
		s.filter = { range: { r1: 0, c1: 0, r2: 4, c2: 1 }, criteria: { 1: { cond: { op: 'gt', value: '2' } } } };
		const text = (r: number, c: number) => String(s.cells.get(cellKey(r, c))?.v ?? '');
		applyFilter(s, text);
		expect([...s.hidden].sort()).toEqual([1]);
		s.filter.criteria = { 0: { values: ['a', 'c'] } };
		applyFilter(s, text);
		expect([...s.hidden].sort()).toEqual([2, 4]);
		expect(distinctValues(s, 0, text)).toEqual(['a', 'b', 'c', '']);
	});
});
