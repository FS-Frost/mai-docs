import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { XMLValidator } from 'fast-xml-parser';
import { geomPath, GEOMS, snapRect } from '../src/lib/slides/geometry.ts';
import { applyLayout, layoutBoxes, newSlide, resize } from '../src/lib/slides/layouts.ts';
import { cssFill, LAYOUTS, resolveColor, slideTitle, textDoc, textOf, type ImageEl, type ShapeEl, type SlidesContent } from '../src/lib/slides/model.ts';
import { THEMES } from '../src/lib/slides/themes.ts';
import { writePptx } from '../src/lib/slides/io/pptx-write.ts';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function deck(): SlidesContent {
	const c: SlidesContent = { v: 1, size: { w: 1280, h: 720 }, theme: THEMES[2], slides: [] };
	c.slides.push(newSlide(c, 'title'), newSlide(c, 'titleBody'), newSlide(c, 'twoCol'), newSlide(c, 'blank'));
	const [t, b] = c.slides;
	(t.elements[0] as ShapeEl).text = textDoc('Informe <anual> & más');
	(b.elements[0] as ShapeEl).text = textDoc('Puntos');
	(b.elements[1] as ShapeEl).text = {
		type: 'doc',
		content: [
			{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno', marks: [{ type: 'bold' }] }] }] }] },
			{ type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dos', marks: [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '30pt', fontFamily: 'Georgia' } }] }] }] }] },
			{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'centrado' }] }
		]
	};
	b.notes = 'Nota del orador\nsegunda línea';
	c.slides[3].elements.push(
		{ id: 's1', kind: 'shape', geom: 'star5', x: 100, y: 100, w: 200, h: 200, rot: 30, fill: { type: 'solid', color: 'accent2' }, line: { color: '#000000', width: 2, dash: 'dash' }, textStyle: { font: 'minor', size: 18, color: 'lt1' }, inset: 6, anchor: 'middle', text: textDoc('★') },
		{ id: 'i1', kind: 'image', blobId: 'b1', x: 500, y: 100, w: 300, h: 200, rot: 0, alt: 'Foto' } as ImageEl
	);
	c.slides[3].background = { type: 'solid', color: '#112233' };
	c.slides[3].hidden = true;
	return c;
}

describe('slides model', () => {
	test('layouts produce placeholders', () => {
		for (const k of LAYOUTS) {
			const s = newSlide({ size: { w: 1280, h: 720 } }, k);
			const boxes = layoutBoxes(k, 1280, 720);
			expect(s.elements.length).toBe(Object.keys(boxes).length);
			for (const e of s.elements) {
				expect(e.x).toBeGreaterThanOrEqual(0);
				expect(e.x + e.w).toBeLessThanOrEqual(1280);
			}
		}
	});
	test('change layout keeps text and moves placeholders', () => {
		const c = deck();
		const s = applyLayout(c, c.slides[1], 'twoCol');
		expect(s.elements.filter((e) => e.kind === 'shape' && e.ph).map((e) => (e as ShapeEl).ph).sort()).toEqual(['body', 'body2', 'title']);
		expect(textOf((s.elements[0] as ShapeEl).text)).toBe('Puntos');
		expect(slideTitle(s)).toBe('Puntos');
	});
	test('resize keeps aspect inside new size', () => {
		const c = resize(deck(), 960, 720);
		for (const s of c.slides) for (const e of s.elements) expect(e.x + e.w).toBeLessThanOrEqual(961);
	});
	test('colors', () => {
		const t = THEMES[0];
		expect(resolveColor(t, 'accent1')).toBe(t.colors.accent1);
		expect(resolveColor(t, '#abcdef')).toBe('#abcdef');
		expect(cssFill(t, { type: 'solid', color: '#ff0000', alpha: 0.5 })).toBe('rgba(255,0,0,0.5)');
		expect(cssFill(t, { type: 'none' })).toBe('transparent');
	});
	test('geometry paths', () => {
		for (const g of GEOMS) expect(geomPath(g, 100, 50)).toMatch(/^M/);
	});
	test('snapping to edges and centers', () => {
		const slide = { x: 0, y: 0, w: 1280, h: 720 };
		const r = snapRect({ x: 597, y: 10, w: 80, h: 40 }, [slide], 6);
		expect(r.dx).toBe(3); // center 637+3 = 640
		expect(r.guides).toContainEqual({ axis: 'x', at: 640 });
		expect(snapRect({ x: 300, y: 300, w: 10, h: 10 }, [slide], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
	});
});

describe('pptx writer', () => {
	test('package is complete, well-formed and carries content', async () => {
		const bytes = await writePptx(deck(), async () => ({ data: PNG, extension: 'png' }), { title: 'Prueba', lang: 'es' });
		const files = unzipSync(bytes);
		const names = Object.keys(files);
		for (const n of names.filter((x) => x.endsWith('.xml') || x.endsWith('.rels'))) {
			const r = XMLValidator.validate(strFromU8(files[n]));
			expect(r === true ? true : `${n}: ${JSON.stringify(r)}`).toBe(true);
		}
		for (const p of [
			'[Content_Types].xml',
			'_rels/.rels',
			'ppt/presentation.xml',
			'ppt/_rels/presentation.xml.rels',
			'ppt/theme/theme1.xml',
			'ppt/slideMasters/slideMaster1.xml',
			'ppt/slideLayouts/slideLayout6.xml',
			'ppt/slides/slide4.xml',
			'ppt/notesMasters/notesMaster1.xml',
			'ppt/notesSlides/notesSlide2.xml',
			'ppt/media/image1.png',
			'docProps/core.xml'
		])
			expect(names).toContain(p);
		// Every relationship target exists.
		for (const r of names.filter((n) => n.endsWith('.rels'))) {
			const dir = r.replace(/_rels\/[^/]*\.rels$/, '');
			for (const m of strFromU8(files[r]).matchAll(/Target="([^"]+)"/g)) {
				const target = new URL(m[1], `file:///${dir}`).pathname.slice(1);
				expect(names, `${r} → ${m[1]}`).toContain(target);
			}
		}
		const ct = strFromU8(files['[Content_Types].xml']);
		for (const n of names.filter((x) => x.endsWith('.xml') && !x.startsWith('['))) expect(ct, n).toContain(`PartName="/${n}"`);
		const pres = strFromU8(files['ppt/presentation.xml']);
		expect(pres).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
		expect(pres.match(/<p:sldId /g)?.length).toBe(4);
		const s1 = strFromU8(files['ppt/slides/slide1.xml']);
		expect(s1).toContain('<p:ph type="ctrTitle"/>');
		expect(s1).toContain('Informe &lt;anual&gt; &amp; más');
		const s2 = strFromU8(files['ppt/slides/slide2.xml']);
		expect(s2).toContain('<a:buChar char="•"/>');
		expect(s2).toContain('<a:buAutoNum type="arabicPeriod"/>');
		expect(s2).toContain('sz="3000"');
		expect(s2).toContain('<a:latin typeface="Georgia"/>');
		expect(s2).toContain('<a:srgbClr val="FF0000">');
		expect(s2).toContain('algn="ctr"');
		expect(s2).toContain('b="1"');
		const s4 = strFromU8(files['ppt/slides/slide4.xml']);
		expect(s4).toContain('show="0"');
		expect(s4).toContain('<a:prstGeom prst="star5">');
		expect(s4).toContain('rot="1800000"');
		expect(s4).toContain('<a:schemeClr val="accent2">');
		expect(s4).toContain('<a:prstDash val="dash"/>');
		expect(s4).toContain('<p:pic>');
		expect(s4).toContain('descr="Foto"');
		expect(s4).toContain('<a:srgbClr val="112233">');
		expect(strFromU8(files['ppt/notesSlides/notesSlide2.xml'])).toContain('segunda línea');
		expect(strFromU8(files['ppt/theme/theme1.xml'])).toContain(`<a:latin typeface="${THEMES[2].fonts.major}"/>`);
	});
	test('4:3 size', async () => {
		const c = resize(deck(), 960, 720);
		const files = unzipSync(await writePptx(c, async () => null));
		expect(strFromU8(files['ppt/presentation.xml'])).toContain('<p:sldSz cx="9144000" cy="6858000"/>');
	});
});
