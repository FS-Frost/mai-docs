import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { XMLValidator } from 'fast-xml-parser';
import * as XLSX from 'xlsx';
import { cellKey } from '../src/lib/sheets/addr.ts';
import { newChart } from '../src/lib/sheets/charts.ts';
import { readXlsx, writeXlsx, type LoadImage } from '../src/lib/sheets/io/xlsx.ts';
import { chartXml, seriesRefs } from '../src/lib/sheets/io/xlsx-charts.ts';
import { fromContent, type ChartObject, type ChartType } from '../src/lib/sheets/model.ts';
import { book } from './helpers.ts';

// 2x2 red PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwMDAxMDAwAAAHgQCAf6C3GoAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const load: LoadImage = async () => ({ data: PNG, extension: 'png' });
const text = (s: { cells: Map<number, { v?: unknown }> }, r: number, c: number) => String(s.cells.get(cellKey(r, c))?.v ?? '');

function sales() {
	return book({
		Ventas: { A1: 'Mes', B1: 'Norte', C1: 'Sur', A2: 'Ene', B2: 10, C2: 4, A3: 'Feb', B3: 12, C3: 6, A4: 'Mar', B4: 9, C4: 8 },
		Vacía: { A1: 1 }
	});
}

function validateAll(bytes: Uint8Array) {
	const files = unzipSync(bytes);
	for (const n of Object.keys(files).filter((x) => x.endsWith('.xml') || x.endsWith('.rels'))) {
		const r = XMLValidator.validate(strFromU8(files[n]));
		expect(r === true ? true : `${n}: ${JSON.stringify(r)}`).toBe(true);
	}
	return files;
}

describe('xlsx images', () => {
	test('floating and in-cell images round trip', async () => {
		const b = sales();
		const s = b.wb.sheets[0];
		s.objects.push({ id: 'i1', kind: 'image', blobId: 'blob-1', anchor: { r: 5, c: 1, dx: 10, dy: 4 }, w: 160, h: 90, alt: 'logo' });
		s.cells.set(cellKey(7, 0), { img: { blobId: 'blob-2', fit: 'contain' } });
		const bytes = await writeXlsx(b.wb, load, text);
		const files = validateAll(bytes);
		expect(Object.keys(files).filter((f) => f.startsWith('xl/media/')).length).toBeGreaterThanOrEqual(1);
		const saved: Blob[] = [];
		const { content, lost } = await readXlsx(bytes, (n) => `S${n}`, async (blob) => (saved.push(blob), `new-${saved.length}`));
		expect(lost).not.toContain('images');
		const back = fromContent(content);
		const d = back.sheets[0];
		expect(d.objects).toHaveLength(1);
		const img = d.objects[0];
		expect(img.kind).toBe('image');
		expect(img.anchor).toEqual({ r: 5, c: 1, dx: 10, dy: 4 });
		expect([img.w, img.h]).toEqual([160, 90]);
		expect(d.cells.get(cellKey(7, 0))?.img?.blobId).toMatch(/^new-/);
		expect(saved[0].type).toBe('image/png');
	}, 30_000);
});

describe('xlsx charts', () => {
	const TYPES: ChartType[] = ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter'];
	for (const type of TYPES)
		test(`${type} chart XML is well-formed with references`, () => {
			const b = sales();
			const ch = { ...newChart(b.wb, b.wb.sheets[0], { r1: 0, c1: 0, r2: 3, c2: 2 }, { r: 0, c: 4, dx: 0, dy: 0 }), type, title: 'Ventas <2024>' };
			const xml = chartXml(ch, seriesRefs(b.wb, ch, text));
			expect(XMLValidator.validate(xml)).toBe(true);
			if (type !== 'scatter') expect(xml).toContain('<c:f>Ventas!$B$2:$B$4</c:f>');
			expect(xml).toContain('Ventas &lt;2024&gt;');
		});

	test('round trip: type, stacking, source, titles, legend, colors and anchor', async () => {
		const b = sales();
		const s = b.wb.sheets[0];
		const col = newChart(b.wb, s, { r1: 0, c1: 0, r2: 3, c2: 2 }, { r: 1, c: 4, dx: 6, dy: 3 });
		Object.assign(col, { stacked: true, title: 'Ventas', xTitle: 'Mes', yTitle: 'Unidades', yMin: 0, yMax: 20, legend: 'right', colors: ['#112233', '#445566'] });
		col.w = 400;
		col.h = 250;
		const pie = { ...newChart(b.wb, s, { r1: 0, c1: 0, r2: 3, c2: 1 }, { r: 20, c: 0, dx: 0, dy: 0 }), id: 'p', type: 'pie' as const, title: 'Norte' };
		s.objects.push(col, pie);
		// Images and charts on the same sheet share one drawing part.
		s.objects.push({ id: 'i1', kind: 'image', blobId: 'b', anchor: { r: 10, c: 1, dx: 0, dy: 0 }, w: 50, h: 50 });
		b.wb.sheets[1].objects.push({ ...col, id: 'c3', title: 'Otra hoja', anchor: { r: 0, c: 0, dx: 0, dy: 0 } });
		const bytes = await writeXlsx(b.wb, load, text);
		const files = validateAll(bytes);
		expect(Object.keys(files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f))).toHaveLength(3);
		const ct = strFromU8(files['[Content_Types].xml']);
		expect(ct.match(/drawingml\.chart\+xml/g)?.length).toBe(3);
		// Still readable by other implementations.
		expect(XLSX.read(bytes, { type: 'array' }).SheetNames).toEqual(['Ventas', 'Vacía']);

		const { content, chartsSimplified } = await readXlsx(bytes, (n) => `S${n}`, async () => 'x');
		expect(chartsSimplified).toBe(false);
		const back = fromContent(content);
		const charts = back.sheets[0].objects.filter((o): o is ChartObject => o.kind === 'chart');
		expect(charts).toHaveLength(2);
		const c = charts.find((x) => x.type === 'column')!;
		expect(c).toMatchObject({ stacked: true, title: 'Ventas', xTitle: 'Mes', yTitle: 'Unidades', yMin: 0, yMax: 20, legend: 'right', colors: ['#112233', '#445566'] });
		expect(c.source).toEqual({ range: 'Ventas!A1:C4', seriesIn: 'cols', headerRow: true, headerCol: true });
		expect(c.anchor).toEqual({ r: 1, c: 4, dx: 6, dy: 3 });
		expect([c.w, c.h]).toEqual([400, 250]);
		const p = charts.find((x) => x.type === 'pie')!;
		expect(p.source.range).toBe('Ventas!A1:B4');
		expect(p.title).toBe('Norte');
		expect(back.sheets[0].objects.filter((o) => o.kind === 'image')).toHaveLength(1);
		expect(back.sheets[1].objects).toHaveLength(1);
	}, 30_000);

	test('series in rows and bar direction survive', async () => {
		const b = sales();
		const ch = { ...newChart(b.wb, b.wb.sheets[0], { r1: 0, c1: 0, r2: 3, c2: 2 }, { r: 0, c: 5, dx: 0, dy: 0 }), type: 'bar' as const };
		ch.source = { ...ch.source, seriesIn: 'rows' };
		b.wb.sheets[0].objects.push(ch);
		const { content } = await readXlsx(await writeXlsx(b.wb, load, text), (n) => `S${n}`);
		const c = fromContent(content).sheets[0].objects[0] as ChartObject;
		expect(c.type).toBe('bar');
		expect(c.source).toEqual({ range: 'Ventas!A1:C4', seriesIn: 'rows', headerRow: true, headerCol: true });
	}, 30_000);
});
