import { describe, expect, test } from 'bun:test';
import { a1, cellKey, colIndex, colName, parseA1, parseRange } from '../src/lib/sheets/addr.ts';
import { parseTSV, toTSV } from '../src/lib/sheets/clipboard.ts';
import { matchesCond } from '../src/lib/sheets/filter.ts';
import { changeDecimals, displayText } from '../src/lib/sheets/format.ts';
import { adjustFormula, formulaRefs, renameSheetInFormula, shiftFormula } from '../src/lib/sheets/formula/refs.ts';
import { editText, parseInput } from '../src/lib/sheets/input.ts';
import { csvToSheet, sheetToCSV } from '../src/lib/sheets/io/csv.ts';
import { fromExcelFormula, readXlsx, toExcelFormula, writeXlsx } from '../src/lib/sheets/io/xlsx.ts';
import { Axis } from '../src/lib/sheets/layout.ts';
import { fromContent, newWorkbook, styleIndex, toContent } from '../src/lib/sheets/model.ts';
import { applyCells, fillChanges, insertOrDelete, renameSheet, sortRange, deleteSheet } from '../src/lib/sheets/ops.ts';
import { book } from './helpers.ts';

describe('addr', () => {
	test('column names', () => {
		expect(colName(0)).toBe('A');
		expect(colName(25)).toBe('Z');
		expect(colName(26)).toBe('AA');
		expect(colName(16383)).toBe('XFD');
		expect(colIndex('XFD')).toBe(16383);
		expect(parseA1('$B$3')).toEqual({ r: 2, c: 1 });
		expect(parseA1('XFE1')).toBeNull();
		expect(parseRange('B2:A1')).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
		expect(a1(9, 2)).toBe('C10');
	});
});

describe('refs', () => {
	test('shift relative/absolute', () => {
		expect(shiftFormula('A1+$B$1+C$1+$D1', 2, 1)).toBe('B3+$B$1+D$1+$D3');
		expect(shiftFormula('A1', -1, 0)).toBe('#REF!');
		expect(shiftFormula('SUM(A1:A3)', 1, 0)).toBe('SUM(A2:A4)');
	});
	test('insert rows', () => {
		const op = { sheetName: 'S', axis: 'row' as const, at: 2, count: 2, kind: 'insert' as const };
		expect(adjustFormula('A1+A3', 'S', op)).toBe('A1+A5');
		expect(adjustFormula('SUM(A1:A5)', 'S', op)).toBe('SUM(A1:A7)');
		expect(adjustFormula('Other!A3', 'S', op)).toBe('Other!A3');
		expect(adjustFormula('S!A3', 'Other', op)).toBe('S!A5');
		expect(adjustFormula('SUM(A:A)', 'S', op)).toBe('SUM(A:A)');
	});
	test('delete rows', () => {
		const op = { sheetName: 'S', axis: 'row' as const, at: 1, count: 2, kind: 'delete' as const };
		expect(adjustFormula('A2', 'S', op)).toBe('#REF!');
		expect(adjustFormula('A5', 'S', op)).toBe('A3');
		expect(adjustFormula('SUM(A1:A5)', 'S', op)).toBe('SUM(A1:A3)');
		expect(adjustFormula('SUM(A2:A3)', 'S', op)).toBe('SUM(#REF!)');
	});
	test('delete columns', () => {
		const op = { sheetName: 'S', axis: 'col' as const, at: 0, count: 1, kind: 'delete' as const };
		expect(adjustFormula('B1*2', 'S', op)).toBe('A1*2');
	});
	test('rename sheet', () => {
		expect(renameSheetInFormula('Hoja2!A1+SUM(hoja2!B1:B2)', 'Hoja2', 'Datos 2024')).toBe("'Datos 2024'!A1+SUM('Datos 2024'!B1:B2)");
	});
	test('refs while typing', () => {
		expect(formulaRefs('SUM(A1:B2,C3').map((r) => [r.r1, r.c1, r.r2, r.c2])).toEqual([
			[0, 0, 1, 1],
			[2, 2, 2, 2]
		]);
	});
});

describe('structural ops', () => {
	test('insert row moves cells and rewrites formulas', () => {
		const b = book({ S: { A1: 1, A2: 2, A3: '=SUM(A1:A2)' }, T: { A1: '=S!A2' } });
		insertOrDelete(b.wb, 's', 'row', 1, 1, 'insert');
		b.engine.rebuild();
		expect(b.get('A3')).toBe(2);
		expect(b.wb.sheets[0].cells.get(cellKey(3, 0))?.f).toBe('SUM(A1:A3)');
		expect(b.get('A4')).toBe(3);
		expect(b.wb.sheets[1].cells.get(cellKey(0, 0))?.f).toBe('S!A3');
	});
	test('delete column', () => {
		const b = book({ S: { A1: 1, B1: 2, C1: '=A1+B1' } });
		insertOrDelete(b.wb, 's', 'col', 0, 1, 'delete');
		b.engine.rebuild();
		expect(b.wb.sheets[0].cells.get(cellKey(0, 1))?.f).toBe('#REF!+A1');
	});
	test('rename and delete sheet', () => {
		const b = book({ S: { A1: '=T!A1*2' }, T: { A1: 5 } });
		renameSheet(b.wb, 't', 'Data');
		b.engine.rebuild();
		expect(b.wb.sheets[0].cells.get(0)?.f).toBe('Data!A1*2');
		expect(b.get('A1')).toBe(10);
		deleteSheet(b.wb, 't');
		b.engine.rebuild();
		expect(b.get('A1')).toEqual({ e: '#REF!' });
	});
	test('sort with header, blanks last, stable', () => {
		const b = book({ S: { A1: 'n', A2: 3, A3: 'b', A4: 1, A6: 2, B2: 'x3', B4: 'x1', B6: 'x2' } });
		const s = b.wb.sheets[0];
		applyCells(s, sortRange(s, { r1: 0, c1: 0, r2: 5, c2: 1 }, 0, false, true));
		const col = [1, 2, 3, 4, 5].map((r) => s.cells.get(cellKey(r, 0))?.v);
		expect(col).toEqual([1, 2, 3, 'b', undefined]);
		expect(s.cells.get(cellKey(1, 1))?.v).toBe('x1');
	});
	test('fill series and formulas', () => {
		const b = book({ S: { A1: 1, A2: 3, B1: '=A1*2', C1: 'Item 9' } });
		const s = b.wb.sheets[0];
		applyCells(s, fillChanges(s, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 }));
		expect([2, 3, 4].map((r) => s.cells.get(cellKey(r, 0))?.v)).toEqual([5, 7, 9]);
		applyCells(s, fillChanges(s, { r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 0, c1: 1, r2: 2, c2: 1 }));
		expect(s.cells.get(cellKey(2, 1))?.f).toBe('A3*2');
		applyCells(s, fillChanges(s, { r1: 0, c1: 2, r2: 0, c2: 2 }, { r1: 0, c1: 2, r2: 2, c2: 2 }));
		expect(s.cells.get(cellKey(2, 2))?.v).toBe('Item 11');
	});
});

describe('input and format', () => {
	test('locale numbers', () => {
		expect(parseInput('1,5', 'es').v).toBe(1.5);
		expect(parseInput('1.234,5', 'es').v).toBe(1234.5);
		expect(parseInput('1.5', 'en').v).toBe(1.5);
		expect(parseInput('1,234.5', 'en').v).toBe(1234.5);
		expect(parseInput('25%', 'es')).toMatchObject({ v: 0.25, numFmt: '0%' });
		expect(parseInput('31/1/2024', 'es')).toMatchObject({ v: 45322, numFmt: 'dd/mm/yyyy' });
		expect(parseInput('1/31/2024', 'en')).toMatchObject({ v: 45322, numFmt: 'm/d/yyyy' });
		expect(parseInput("'123", 'en').v).toBe('123');
		expect(parseInput('=sum(A1)', 'en').f).toBe('sum(A1)');
		expect(parseInput('=TODAY()', 'es').numFmt).toBe('dd/mm/yyyy');
		expect(parseInput('verdadero', 'es').v).toBe(true);
		expect(parseInput('hola', 'es').v).toBe('hola');
	});
	test('display', () => {
		expect(displayText(1234.5, '#,##0.00', 'es')).toBe('1.234,50');
		expect(displayText(1234.5, '#,##0.00', 'en')).toBe('1,234.50');
		expect(displayText(0.5, undefined, 'es')).toBe('0,5');
		expect(displayText(45322, 'dd/mm/yyyy', 'es')).toBe('31/01/2024');
		expect(displayText({ e: '#N/A' }, undefined, 'en')).toBe('#N/A');
	});
	test('edit text round-trips', () => {
		expect(editText({ v: 1.5 }, 'es')).toBe('1,5');
		expect(editText({ f: 'A1+1' }, 'es')).toBe('=A1+1');
		expect(editText({ v: '123' }, 'en')).toBe("'123");
	});
	test('decimals', () => {
		expect(changeDecimals(undefined, 1.5, 1)).toBe('0.00');
		expect(changeDecimals('#,##0.00', 1, -1)).toBe('#,##0.0');
		expect(changeDecimals('#,##0.0', 1, -1)).toBe('#,##0');
		expect(changeDecimals('0%', 1, 1)).toBe('0.0%');
		expect(changeDecimals('"$"#,##0.00', 1, 1)).toBe('"$"#,##0.000');
	});
	test('filter conditions', () => {
		expect(matchesCond(5, '5', 'gt', '3')).toBe(true);
		expect(matchesCond('abc', 'abc', 'contains', 'B')).toBe(true);
		expect(matchesCond(null, '', 'empty', '')).toBe(true);
	});
});

describe('layout', () => {
	test('offsets with overrides and hidden', () => {
		const ax = new Axis(10, 20, new Map([[2, 50]]), new Set([5]));
		expect(ax.offset(0)).toBe(0);
		expect(ax.offset(3)).toBe(90);
		expect(ax.offset(6)).toBe(130);
		expect(ax.total).toBe(10 * 20 + 30 - 20);
		expect(ax.indexAt(95)).toBe(3);
		expect(ax.indexAt(45)).toBe(2);
	});
});

describe('clipboard and csv', () => {
	test('tsv round trip', () => {
		const rows = [
			['a', 'b\tc'],
			['multi\nline', 'q"uote']
		];
		expect(parseTSV(toTSV(rows))).toEqual(rows);
		expect(parseTSV('1\t2\n3\t4\n')).toEqual([
			['1', '2'],
			['3', '4']
		]);
	});
	test('csv import/export', () => {
		const wb = newWorkbook('S');
		const s = csvToSheet(wb, 'name;value\n"a;b";1,5\nc;2', 'csv', 'es');
		expect(s.cells.get(cellKey(1, 0))?.v).toBe('a;b');
		expect(s.cells.get(cellKey(1, 1))?.v).toBe(1.5);
		const s2 = csvToSheet(wb, 'x,y\n1.5,"=1+1"', 'csv', 'es');
		expect(s2.cells.get(cellKey(1, 0))?.v).toBe(1.5);
		expect(s2.cells.get(cellKey(1, 1))?.v).toBe('=1+1');
		expect(sheetToCSV(s)).toBe('name,value\r\na;b,1.5\r\nc,2');
	});
});

describe('xlsx', () => {
	test('_xlfn prefixes', () => {
		expect(toExcelFormula('XLOOKUP(A1,B:B,C:C)+SUM(1)')).toBe('_xlfn.XLOOKUP(A1,B:B,C:C)+SUM(1)');
		expect(toExcelFormula('"IFS("&IFS(TRUE,1)')).toBe('"IFS("&_xlfn.IFS(TRUE,1)');
		expect(fromExcelFormula('_xlfn.IFS(A1>0,1)')).toBe('IFS(A1>0,1)');
	});
	test('round trip keeps values, formulas, styles, merges, freeze, widths', async () => {
		const b = book({ Datos: { A1: 'Total', B1: 3, B2: 4, B3: '=SUM(B1:B2)', C1: true, D1: 45322 }, Otra: { A1: '=Datos!B3*2' } });
		const wb = b.wb;
		const s = wb.sheets[0];
		const bold = styleIndex(wb, { bold: true, fill: '#ffcc00', hAlign: 'center', border: { bottom: { style: 'thin', color: '#000000' } } });
		s.cells.get(cellKey(0, 0))!.s = bold;
		s.cells.get(cellKey(0, 3))!.s = styleIndex(wb, { numFmt: 'dd/mm/yyyy' });
		s.merges.push({ r1: 4, c1: 0, r2: 5, c2: 1 });
		s.cells.set(cellKey(4, 0), { v: 'merged' });
		s.freeze = { rows: 1, cols: 1 };
		s.colWidths.set(0, 152);
		s.rowHeights.set(0, 40);
		s.filter = { range: { r1: 0, c1: 0, r2: 3, c2: 3 }, criteria: {} };
		const bytes = await writeXlsx(wb);
		expect(bytes.byteLength).toBeGreaterThan(1000);
		const { content } = await readXlsx(bytes, (n) => `Sheet${n}`);
		const back = fromContent(content);
		const d = back.sheets[0];
		expect(back.sheets.map((x) => x.name)).toEqual(['Datos', 'Otra']);
		expect(d.cells.get(cellKey(0, 0))?.v).toBe('Total');
		expect(d.cells.get(cellKey(2, 1))).toMatchObject({ f: 'SUM(B1:B2)', v: 7 });
		expect(d.cells.get(cellKey(0, 2))?.v).toBe(true);
		expect(d.cells.get(cellKey(0, 3))?.v).toBe(45322);
		expect(back.styles[d.cells.get(cellKey(0, 3))!.s!].numFmt).toBe('dd/mm/yyyy');
		const st = back.styles[d.cells.get(cellKey(0, 0))!.s!];
		expect(st).toMatchObject({ bold: true, fill: '#ffcc00', hAlign: 'center' });
		expect(st.border?.bottom?.style).toBe('thin');
		expect(d.merges).toEqual([{ r1: 4, c1: 0, r2: 5, c2: 1 }]);
		expect(d.freeze).toEqual({ rows: 1, cols: 1 });
		expect(d.colWidths.get(0)).toBe(152);
		expect(d.rowHeights.get(0)).toBe(40);
		expect(d.filter?.range).toEqual({ r1: 0, c1: 0, r2: 3, c2: 3 });
		expect(back.sheets[1].cells.get(0)).toMatchObject({ f: 'Datos!B3*2', v: 14 });
		expect(toContent(back).v).toBe(1);
	}, 30_000);
});
