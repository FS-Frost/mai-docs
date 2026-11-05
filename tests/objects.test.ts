import { describe, expect, test } from 'bun:test';
import { cellKey } from '../src/lib/sheets/addr.ts';
import { chartData, guessChart, newChart, resolveRange } from '../src/lib/sheets/charts.ts';
import { fromContent, toContent, type ChartObject } from '../src/lib/sheets/model.ts';
import { deleteSheet, duplicateSheet, insertOrDelete, renameSheet } from '../src/lib/sheets/ops.ts';
import { book } from './helpers.ts';

const text = (s: { cells: Map<number, { v?: unknown }> }, r: number, c: number) => String(s.cells.get(cellKey(r, c))?.v ?? '');

function sales() {
	return book({
		Ventas: { A1: 'Mes', B1: 'Norte', C1: 'Sur', A2: 'Ene', B2: 10, C2: 4, A3: 'Feb', B3: 12, C3: 6, A4: 'Mar', B4: 9, C4: 8 },
		Otra: { A1: 1 }
	});
}

describe('chart data', () => {
	test('guess source: header row + category column, series in columns', () => {
		const b = sales();
		const g = guessChart(b.wb, b.wb.sheets[0], { r1: 0, c1: 0, r2: 3, c2: 2 });
		expect(g.source).toEqual({ range: 'Ventas!A1:C4', seriesIn: 'cols', headerRow: true, headerCol: true });
		expect(g.options.type).toBe('column');
	});
	test('values, labels and names', () => {
		const b = sales();
		const ch = newChart(b.wb, b.wb.sheets[0], { r1: 0, c1: 0, r2: 3, c2: 2 }, { r: 0, c: 4, dx: 0, dy: 0 });
		const d = chartData(b.wb, ch, text);
		expect(d.labels).toEqual(['Ene', 'Feb', 'Mar']);
		expect(d.series).toEqual([
			{ name: 'Norte', values: [10, 12, 9] },
			{ name: 'Sur', values: [4, 6, 8] }
		]);
	});
	test('series in rows', () => {
		const b = sales();
		const d = chartData(b.wb, { type: 'column', source: { range: 'Ventas!A1:C4', seriesIn: 'rows', headerRow: true, headerCol: true } }, text);
		expect(d.labels).toEqual(['Norte', 'Sur']);
		expect(d.series.map((s) => s.name)).toEqual(['Ene', 'Feb', 'Mar']);
		expect(d.series[0].values).toEqual([10, 4]);
	});
	test('text and errors become gaps; filtered rows skipped; missing sheet', () => {
		const b = sales();
		b.set('B3', 'x', 'Ventas');
		b.wb.sheets[0].hidden.add(3);
		const d = chartData(b.wb, { type: 'line', source: { range: 'Ventas!A1:C4', seriesIn: 'cols', headerRow: true, headerCol: true } }, text);
		expect(d.labels).toEqual(['Ene', 'Feb']);
		expect(d.series[0].values).toEqual([10, null]);
		expect(chartData(b.wb, { type: 'line', source: { range: 'Nope!A1:B2', seriesIn: 'cols', headerRow: false, headerCol: false } }, text).error).toBe('ref');
	});
	test('scatter uses the first numeric column as x', () => {
		const b = book({ S: { A1: 'x', B1: 'y', A2: 1, B2: 2, A3: 2, B3: 4 } });
		const d = chartData(b.wb, { type: 'scatter', source: { range: 'S!A1:B3', seriesIn: 'cols', headerRow: true, headerCol: false } }, text);
		expect(d.xs).toEqual([1, 2]);
		expect(d.series).toEqual([{ name: 'y', values: [2, 4] }]);
	});
	test('whole-column ranges clamp to used area', () => {
		const b = sales();
		expect(resolveRange(b.wb, 'Ventas!A:B')?.range).toEqual({ r1: 0, c1: 0, r2: 3, c2: 1 });
	});
});

describe('objects and structure', () => {
	test('anchors follow inserts/deletes; chart source rewritten; persistence', () => {
		const b = sales();
		const s = b.wb.sheets[0];
		const ch = newChart(b.wb, s, { r1: 0, c1: 0, r2: 3, c2: 2 }, { r: 5, c: 4, dx: 3, dy: 7 });
		s.objects.push(ch, { id: 'img', kind: 'image', blobId: 'b1', anchor: { r: 2, c: 1, dx: 5, dy: 5 }, w: 100, h: 80 });
		insertOrDelete(b.wb, s.id, 'row', 1, 2, 'insert');
		expect(ch.anchor.r).toBe(7);
		expect(ch.source.range).toBe('Ventas!A1:C6');
		insertOrDelete(b.wb, s.id, 'row', 4, 1, 'delete'); // deletes the image's anchor row (now 4)
		const img = s.objects[1];
		expect(img.anchor).toEqual({ r: 4, c: 1, dx: 5, dy: 0 });
		expect(ch.source.range).toBe('Ventas!A1:C5');
		const back = fromContent(structuredClone(toContent(b.wb)));
		expect(back.sheets[0].objects).toEqual(s.objects);
		expect(back.sheets[1].objects).toEqual([]);
	});
	test('rename, duplicate and delete sheet update chart sources', () => {
		const b = sales();
		const s = b.wb.sheets[0];
		const other = b.wb.sheets[1];
		other.objects.push(newChart(b.wb, s, { r1: 0, c1: 0, r2: 3, c2: 2 }, { r: 0, c: 0, dx: 0, dy: 0 }));
		renameSheet(b.wb, s.id, 'Datos 2024');
		const ch = other.objects[0] as ChartObject;
		expect(ch.source.range).toBe("'Datos 2024'!A1:C4");
		s.objects.push({ ...ch, id: 'c2', source: { ...ch.source } });
		const copy = duplicateSheet(b.wb, s.id, 'Copia')!;
		expect((copy.objects[0] as ChartObject).source.range).toBe('Copia!A1:C4');
		expect(copy.objects[0].id).not.toBe('c2');
		deleteSheet(b.wb, s.id);
		expect(ch.source.range).toBe("'Datos 2024'!#REF!");
	});
	test('cell images survive serialization and count as content', () => {
		const b = sales();
		b.wb.sheets[0].cells.set(cellKey(9, 0), { img: { blobId: 'x', fit: 'contain' } });
		const back = fromContent(structuredClone(toContent(b.wb)));
		expect(back.sheets[0].cells.get(cellKey(9, 0))?.img).toEqual({ blobId: 'x', fit: 'contain' });
	});
});
