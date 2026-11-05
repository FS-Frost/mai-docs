// CSV ⇄ sheet. Import: delimiter auto-detected; with ';' numbers are read in the UI locale (Excel es exports
// "1,5;2"), with ',' or tab they use '.' decimals. Export: RFC 4180, ',' delimiter, '.' decimals, cached values.
import Papa from 'papaparse';
import type { Locale } from '../../i18n/detect.ts';
import { cellKey, keyCol, keyRow } from '../addr.ts';
import { parseInput } from '../input.ts';
import { newSheet, styleIndex, valueText, type Sheet, type Workbook } from '../model.ts';
import { isErr } from '../values.ts';

export function parseCSV(text: string): { rows: string[][]; delimiter: string } {
	const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t', '|'] });
	return { rows: res.data, delimiter: res.meta.delimiter };
}

/** Fills a new sheet from CSV text. Formulas in CSV are imported as text (never executed). */
export function csvToSheet(wb: Workbook, text: string, name: string, locale: Locale): Sheet {
	const { rows, delimiter } = parseCSV(text);
	const numLocale: Locale = delimiter === ';' ? locale : 'en';
	const s = newSheet(name);
	let maxC = 0;
	rows.forEach((row, r) => {
		row.forEach((raw, c) => {
			if (raw === '') return;
			const p = parseInput(raw.startsWith('=') ? `'${raw}` : raw, numLocale);
			const cell: { v?: typeof p.v; s?: number } = { v: p.v };
			if (p.numFmt) cell.s = styleIndex(wb, { numFmt: p.numFmt });
			s.cells.set(cellKey(r, c), cell);
			if (c > maxC) maxC = c;
		});
	});
	s.rows = Math.max(s.rows, rows.length + 100);
	s.cols = Math.max(s.cols, maxC + 1);
	return s;
}

export function sheetToCSV(sheet: Sheet): string {
	let maxR = -1;
	let maxC = -1;
	for (const [k, c] of sheet.cells) {
		if (c.v === undefined || c.v === null || c.v === '') continue;
		maxR = Math.max(maxR, keyRow(k));
		maxC = Math.max(maxC, keyCol(k));
	}
	const rows: string[][] = [];
	for (let r = 0; r <= maxR; r++) {
		const row: string[] = [];
		for (let c = 0; c <= maxC; c++) {
			const v = sheet.cells.get(cellKey(r, c))?.v;
			row.push(v === undefined || v === null ? '' : isErr(v) ? v.e : typeof v === 'number' ? String(Number(v.toPrecision(15))) : valueText(v));
		}
		rows.push(row);
	}
	return Papa.unparse(rows, { newline: '\r\n' });
}
