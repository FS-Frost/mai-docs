// Interop checks with independent parsers (no Office available in CI):
// - every XML part of exported .xlsx/.docx is well-formed and declares the expected OOXML parts;
// - SheetJS (independent xlsx implementation) reads our .xlsx with the same values, formulas and merges;
// - mammoth reads our .docx back with headings, formatting, lists and tables.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { XMLValidator } from 'fast-xml-parser';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { cellKey } from '../src/lib/sheets/addr.ts';
import { writeXlsx } from '../src/lib/sheets/io/xlsx.ts';
import { styleIndex } from '../src/lib/sheets/model.ts';
import { buildDocx, docxBytes } from '../src/lib/docs/io/docx-export.ts';
import { defaultPage } from '../src/lib/docs/model.ts';
import { book } from './helpers.ts';

function checkXmlParts(bytes: Uint8Array) {
	const files = unzipSync(bytes);
	const names = Object.keys(files);
	for (const n of names.filter((x) => x.endsWith('.xml') || x.endsWith('.rels'))) {
		const res = XMLValidator.validate(strFromU8(files[n]));
		expect(res === true ? true : `${n}: ${JSON.stringify(res)}`).toBe(true);
	}
	const ct = strFromU8(files['[Content_Types].xml']);
	return { names, ct, files };
}

describe('xlsx interop', () => {
	test('well-formed and readable by SheetJS', async () => {
		const b = book({ Ventas: { A1: 'Producto', B1: 'Monto', A2: 'Café', B2: 2500, A3: 'Té', B3: 1800, B4: '=SUM(B2:B3)', C1: true, D1: 45322 }, Resumen: { A1: '=Ventas!B4*2', A2: '=XLOOKUP("Té",Ventas!A2:A3,Ventas!B2:B3)' } });
		const s = b.wb.sheets[0];
		s.merges.push({ r1: 5, c1: 0, r2: 5, c2: 2 });
		s.cells.set(cellKey(5, 0), { v: 'nota combinada' });
		s.cells.get(cellKey(0, 0))!.s = styleIndex(b.wb, { bold: true, fill: '#ffcc00' });
		s.cells.get(cellKey(0, 3))!.s = styleIndex(b.wb, { numFmt: 'dd/mm/yyyy' });
		s.freeze = { rows: 1, cols: 0 };
		const bytes = await writeXlsx(b.wb);
		const { names, ct } = checkXmlParts(bytes);
		expect(names).toContain('xl/workbook.xml');
		expect(names).toContain('xl/worksheets/sheet1.xml');
		expect(names).toContain('xl/styles.xml');
		expect(ct).toContain('spreadsheetml.sheet.main+xml');

		const wb = XLSX.read(bytes, { type: 'array', cellFormula: true, cellDates: false, cellNF: true });
		expect(wb.SheetNames).toEqual(['Ventas', 'Resumen']);
		const v = wb.Sheets.Ventas;
		expect(v.A2.v).toBe('Café');
		expect(v.B4.f).toBe('SUM(B2:B3)');
		expect(v.B4.v).toBe(4300);
		expect(v.C1.v).toBe(true);
		expect(v.D1.v).toBe(45322);
		expect(v.D1.z).toBe('dd/mm/yyyy');
		expect(v['!merges']).toEqual([{ s: { r: 5, c: 0 }, e: { r: 5, c: 2 } }]);
		const r = wb.Sheets.Resumen;
		expect(r.A1.f).toBe('Ventas!B4*2');
		expect(r.A1.v).toBe(8600);
		expect(r.A2.f).toBe('XLOOKUP("Té",Ventas!A2:A3,Ventas!B2:B3)');
		expect(strFromU8(unzipSync(bytes)['xl/worksheets/sheet2.xml'])).toContain('_xlfn.XLOOKUP');
		expect(r.A2.v).toBe(1800);
	}, 30_000);
});

describe('docx interop', () => {
	test('well-formed and readable by mammoth', async () => {
		const doc = await buildDocx(
			{
				type: 'doc',
				content: [
					{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Informe' }] },
					{ type: 'paragraph', content: [{ type: 'text', text: 'Texto ' }, { type: 'text', text: 'negrita', marks: [{ type: 'bold' }] }, { type: 'text', text: ' e ' }, { type: 'text', text: 'itálica', marks: [{ type: 'italic' }] }] },
					{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dos' }] }] }] },
					{ type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'primero' }] }] }] },
					{
						type: 'table',
						content: [
							{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col' }] }] }, { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Val' }] }] }] },
							{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }, { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] }] }
						]
					}
				]
			},
			defaultPage('es'),
			async () => null,
			'Informe'
		);
		const bytes = new Uint8Array(await docxBytes(doc));
		const { names, ct } = checkXmlParts(bytes);
		expect(names).toContain('word/document.xml');
		expect(names).toContain('word/styles.xml');
		expect(names).toContain('word/numbering.xml');
		expect(ct).toContain('wordprocessingml.document.main+xml');
		const { value: html, messages } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
		expect(messages.filter((m) => m.type === 'error')).toEqual([]);
		expect(html).toContain('<h1>Informe</h1>');
		expect(html).toContain('<strong>negrita</strong>');
		expect(html).toContain('<em>itálica</em>');
		expect(html).toMatch(/<ul><li>uno<\/li><li>dos<\/li><\/ul>/);
		expect(html).toMatch(/<ol><li>primero<\/li><\/ol>/);
		expect(html).toContain('<table>');
		expect(html).toContain('<p>a</p>');
	});
});
