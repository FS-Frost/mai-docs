// Slides E3: .pptx import over the synthetic test set + round trips through our writer.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { readPptx, replaceFont } from '../src/lib/slides/io/pptx-read.ts';
import { writePptx } from '../src/lib/slides/io/pptx-write.ts';
import { textOf, type ChartEl, type ImageEl, type MediaEl, type ShapeEl, type SlidesContent, type TableEl } from '../src/lib/slides/model.ts';
import { buildPptx, FIXTURES, PNG } from './pptx-fixtures.ts';
import { checkPackage } from './pptx-check.ts';
import { deck } from './slides-fixture.ts';

function store() {
	const blobs = new Map<string, { data: Uint8Array; mime: string }>();
	let n = 0;
	return {
		blobs,
		putBlob: async (data: Uint8Array, mime: string) => {
			const id = `b${++n}`;
			blobs.set(id, { data, mime });
			return id;
		}
	};
}

async function read(fx: keyof typeof FIXTURES, fontAvailable?: (f: string) => boolean) {
	const s = store();
	const r = await readPptx(buildPptx(FIXTURES[fx]()), { putBlob: s.putBlob, fontAvailable });
	return { ...r, blobs: s.blobs };
}

const shapes = (c: SlidesContent, i = 0) => c.slides[i].elements.filter((e): e is ShapeEl => e.kind === 'shape');

describe('pptx import', () => {
	test('theme, master/layout inheritance, decorations, notes', async () => {
		const { content } = await read('fxInheritance');
		expect(content.size).toEqual({ w: 1280, h: 720 });
		expect(content.theme.fonts).toEqual({ major: 'Calibri Light', minor: 'Calibri' });
		expect(content.theme.colors.accent1).toBe('#4472c4');
		expect(content.theme.colors.dk1).toBe('#000000');
		const s = content.slides[0];
		expect(s.layout).toBe('titleBody');
		// Decorations: master bar + logo, layout stripe — locked, behind the slide's own shapes.
		const locked = s.elements.filter((e) => e.locked);
		expect(locked.length).toBe(3);
		expect(s.elements.slice(0, 3).every((e) => e.locked)).toBe(true);
		expect(locked.some((e) => e.kind === 'image')).toBe(true);
		const title = shapes(content).find((e) => e.ph === 'title')!;
		// Position from the master, size 44 pt and major font from master txStyles, color from the layout (lumMod → hex).
		expect(title.x).toBeCloseTo(88, 0);
		expect(title.textStyle.size).toBe(44);
		expect(title.textStyle.font).toBe('major');
		expect(title.textStyle.color.startsWith('#')).toBe(true);
		expect(title.anchor).toBe('middle');
		expect(textOf(title.text)).toBe('Heredado');
		const body = shapes(content).find((e) => e.ph === 'body')!;
		expect(body.textStyle.size).toBe(28);
		const doc = body.text!;
		expect(doc.content?.[0].type).toBe('bulletList');
		// Level 1 is nested inside the first item; "Sin viñeta" is a plain paragraph.
		expect(JSON.stringify(doc.content?.[0])).toContain('"bulletList"');
		expect(doc.content?.[1].type).toBe('paragraph');
		expect(s.notes).toBe('Nota uno\nNota dos');
	});

	test('shapes: presets, custom geometry, gradients, style refs, shadow, groups, connectors', async () => {
		const { content, lossy } = await read('fxShapes');
		const els = shapes(content).filter((e) => !e.locked);
		const cloud = els.find((e) => e.name === 'Cloud')!;
		expect(cloud.geom).toBe('cloud');
		expect(cloud.fill).toEqual({ type: 'solid', color: 'accent1' });
		expect(cloud.line?.width).toBeGreaterThan(0);
		expect(cloud.textStyle.color).toBe('lt1');
		expect(lossy).toBe(true); // unknown preset drawn approximately
		const arc = els.find((e) => e.name === 'Arc')!;
		expect(arc.geom).toBe('custom');
		expect(arc.paths?.[0].d).toMatch(/^M0 48C/);
		expect(arc.fill.type).toBe('gradient');
		expect(arc.shadow?.alpha).toBeCloseTo(0.4);
		const child = els.find((e) => e.name === 'Child')!;
		// Group: chExt is half of ext → child scaled ×2 and offset by the group position.
		expect(child.x).toBeCloseTo(640 + 96, 0);
		expect(child.w).toBeCloseTo(96, 0);
		const cxn = els.find((e) => e.name === 'Connector')!;
		expect(cxn.geom).toBe('straightConnector1');
		expect(cxn.line?.dash).toBe('dash');
		expect(content.slides[0].background?.type).toBe('gradient');
	});

	test('tables and charts', async () => {
		const { content } = await read('fxTableChart');
		const t = content.slides[0].elements.find((e): e is TableEl => e.kind === 'table')!;
		expect(t.cols.length).toBe(3);
		expect(t.cells[0][0].colSpan).toBe(2);
		expect(t.cells[0][1].hidden).toBe(true);
		expect(t.cells[0][2].fill).toEqual({ type: 'solid', color: '#ffff00' });
		expect(t.cells[0][2].anchor).toBe('middle');
		expect(t.firstRow).toBe(true);
		expect(textOf(t.cells[1][2].text)).toBe('3');
		const ch = content.slides[0].elements.find((e): e is ChartEl => e.kind === 'chart')!;
		expect(ch.options.type).toBe('bar');
		expect(ch.options.stacked).toBe(true);
		expect(ch.options.title).toBe('Ventas');
		expect(ch.options.legend).toBe('right');
		expect(ch.options.colors?.[0]).toBe('#112233');
		expect(ch.data).toEqual({ labels: ['T1', 'T2'], series: [{ name: 'Norte', values: [4.5, 7] }] });
	});

	test('SmartArt from its drawing, equations from the fallback picture', async () => {
		const { content, lossy } = await read('fxSmartArtMath');
		const els = content.slides[0].elements.filter((e) => !e.locked);
		const step = els.find((e): e is ShapeEl => e.kind === 'shape' && textOf(e.text) === 'Paso A')!;
		expect(step.geom).toBe('roundRect');
		expect(step.x).toBeCloseTo(96, 0);
		const eq = els.find((e): e is ShapeEl => e.kind === 'shape' && e.name === 'Equation')!;
		expect(eq.fill.type).toBe('image');
		expect(lossy).toBe(true);
	});

	test('video and audio with posters', async () => {
		const { content, blobs } = await read('fxMedia');
		const media = content.slides[0].elements.filter((e): e is MediaEl => e.kind === 'media');
		expect(media.map((m) => m.media)).toEqual(['video', 'audio']);
		expect(media[0].mime).toBe('video/mp4');
		expect(blobs.get(media[0].blobId)?.data.length).toBe(8);
		expect(media[0].posterBlobId).toBeTruthy();
		expect(media[1].mime).toBe('audio/mpeg');
	});

	test('transitions, approximate animations, opaque timing, hidden slide, 4:3', async () => {
		const { content, animsApprox } = await read('fxMotion');
		expect(content.size).toEqual({ w: 960, h: 720 });
		const [a, b] = content.slides;
		expect(a.transition).toEqual({ type: 'push', dir: 'd', dur: 1250 });
		expect(b.transition).toEqual({ type: 'fade', dur: 500 });
		expect(b.hidden).toBe(true);
		expect(animsApprox).toBe(true);
		expect(a.anims?.map((x) => [x.effect, x.trigger, x.dir ?? null, x.dur])).toEqual([
			['fly', 'click', 'l', 750],
			['fade', 'with', null, 500]
		]);
		expect(a.anims?.[1].delay).toBe(250);
		expect(a.timingXml).toContain('presetClass="emph"');
		// Re-export keeps the original timing (emphasis effect included) and the shape ids it targets.
		const files = unzipSync(await writePptx(content, async () => ({ data: PNG, extension: 'png' })));
		checkPackage(files);
		const xml = strFromU8(files['ppt/slides/slide1.xml']);
		expect(xml).toContain('presetClass="emph"');
		expect(xml).toContain('<p:cNvPr id="4"');
		expect(xml).toContain('<p:cNvPr id="5"');
	});

	test('missing fonts are replaced by a close family', async () => {
		const have = new Set(['Arial', 'Georgia', 'Segoe UI']);
		const { content, fontsReplaced } = await read('fxInheritance', (f) => have.has(f));
		expect(content.theme.fonts.minor).toBe('Segoe UI');
		expect(fontsReplaced.join()).toContain('Calibri → Segoe UI');
		expect(replaceFont('Cambria', (f) => have.has(f))).toBe('Georgia');
		expect(replaceFont('Arial', (f) => have.has(f))).toBeNull();
	});

	test('every fixture re-exports to a valid package', async () => {
		for (const fx of Object.keys(FIXTURES) as (keyof typeof FIXTURES)[]) {
			const { content, blobs } = await read(fx);
			const bytes = await writePptx(content, async (id) => (blobs.get(id)?.mime === 'image/png' ? { data: blobs.get(id)!.data, extension: 'png' } : null), { loadBlob: async (id) => blobs.get(id)?.data ?? null });
			checkPackage(unzipSync(bytes));
		}
	});

	test('our own entrance animations are exact: no approximation warning', async () => {
		const src = deck();
		const s1 = src.slides[1];
		const ids = s1.elements.map((e) => e.id);
		s1.anims = [
			{ id: 'a1', el: ids[0], effect: 'fade', dur: 500, trigger: 'click' },
			{ id: 'a2', el: ids[1], effect: 'fly', dir: 'd', dur: 500, trigger: 'with' },
			{ id: 'a3', el: ids[0], effect: 'wipe', dir: 'l', dur: 500, trigger: 'after' },
			{ id: 'a4', el: ids[1], effect: 'zoom', dur: 500, trigger: 'click' },
			{ id: 'a5', el: ids[0], effect: 'appear', dur: 0, trigger: 'click' }
		];
		const bytes = await writePptx(src, async () => ({ data: PNG, extension: 'png' }));
		const { content, animsApprox } = await readPptx(bytes, { putBlob: store().putBlob });
		expect(animsApprox).toBe(false);
		expect(content.slides[1].anims?.map((a) => a.effect)).toEqual(['fade', 'fly', 'wipe', 'zoom', 'appear']);
	});

	test('round trip of our own export keeps the content', async () => {
		const src = deck();
		const bytes = await writePptx(src, async () => ({ data: PNG, extension: 'png' }), { lang: 'es' });
		const s = store();
		const { content } = await readPptx(bytes, { putBlob: s.putBlob });
		expect(content.slides.length).toBe(4);
		expect(content.theme.colors).toEqual(src.theme.colors);
		expect(content.theme.fonts).toEqual(src.theme.fonts);
		expect(content.slides.map((x) => x.layout)).toEqual(src.slides.map((x) => x.layout));
		expect(textOf((content.slides[0].elements[0] as ShapeEl).text)).toBe('Informe <anual> & más');
		const body = content.slides[1].elements.find((e) => e.kind === 'shape' && e.ph === 'body') as ShapeEl;
		expect(JSON.stringify(body.text)).toContain('"bulletList"');
		expect(JSON.stringify(body.text)).toContain('"orderedList"');
		expect(JSON.stringify(body.text)).toContain('"fontFamily":"Georgia"');
		expect(content.slides[1].notes).toBe('Nota del orador\nsegunda línea');
		const star = content.slides[3].elements.find((e) => e.kind === 'shape' && e.geom === 'star5') as ShapeEl;
		expect(star.rot).toBe(30);
		expect(star.fill).toEqual({ type: 'solid', color: 'accent2' });
		expect(star.line?.dash).toBe('dash');
		expect(content.slides[3].elements.some((e): e is ImageEl => e.kind === 'image' && e.alt === 'Foto')).toBe(true);
		expect(content.slides[3].hidden).toBe(true);
		expect(content.slides[3].background).toEqual({ type: 'solid', color: '#112233' });
	});
});
