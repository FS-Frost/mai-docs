// Slides E2: tables, motion (steps/timeline/navigation), writer output for tables, charts, media, icons,
// custom shapes, transitions, animations and imported timing.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { cellAt, deleteCol, deleteRow, insertCol, insertRow, merge, newTable, setCell, split } from '../src/lib/slides/table.ts';
import { advance } from '../src/lib/slides/present.ts';
import { animSteps, hiddenAt, stepTimeline, textDoc, textOf, type Anim, type ChartEl, type IconEl, type MediaEl, type ShapeEl, type SlidesContent, type TableEl } from '../src/lib/slides/model.ts';
import { custPathXml, writePptx } from '../src/lib/slides/io/pptx-write.ts';
import { scalePath } from '../src/lib/slides/geometry.ts';
import { deck, PNG } from './slides-fixture.ts';
import { checkPackage } from './pptx-check.ts';


describe('slide tables', () => {
	test('insert/delete rows and cols keep shape', () => {
		let t = newTable(3, 3, 0, 0, 600);
		t = insertRow(t, 1);
		expect(t.rows.length).toBe(4);
		expect(t.cells.length).toBe(4);
		t = insertCol(t, 3);
		expect(t.cols.length).toBe(4);
		expect(t.cells.every((r) => r.length === 4)).toBe(true);
		expect(Math.abs(t.cols.reduce((a, b) => a + b) - 600)).toBeLessThan(4);
		t = deleteRow(deleteCol(t, 0), 0);
		expect(t.rows.length).toBe(3);
		expect(t.cols.length).toBe(3);
	});
	test('merge, split and structural ops through merges', () => {
		let t = newTable(3, 3, 0, 0, 300);
		t = setCell(t, 0, 0, { text: textDoc('a') });
		t = setCell(t, 1, 1, { text: textDoc('b') });
		t = merge(t, { r1: 0, c1: 0, r2: 1, c2: 1 });
		expect(t.cells[0][0].colSpan).toBe(2);
		expect(t.cells[0][0].rowSpan).toBe(2);
		expect(t.cells[1][1].hidden).toBe(true);
		expect(textOf(t.cells[0][0].text)).toBe('a\nb');
		expect(cellAt(t, 150, 50)).toEqual({ r: 0, c: 0 });
		// A row inserted inside the block unmerges it; one inserted below keeps it.
		expect(insertRow(t, 1).cells[0][0].rowSpan).toBeUndefined();
		expect(insertRow(t, 2).cells[0][0].rowSpan).toBe(2);
		expect(deleteCol(t, 2).cells[0][0].colSpan).toBe(2);
		const s = split(t, 0, 0);
		expect(s.cells.flat().some((c) => c.hidden || c.colSpan)).toBe(false);
	});
});

describe('slide motion', () => {
	const anims: Anim[] = [
		{ id: 'a', el: 'x', effect: 'fade', dur: 500, trigger: 'click' },
		{ id: 'b', el: 'y', effect: 'fly', dir: 'l', dur: 400, trigger: 'with' },
		{ id: 'c', el: 'z', effect: 'appear', dur: 0, trigger: 'after', delay: 100 },
		{ id: 'd', el: 'w', effect: 'zoom', dur: 300, trigger: 'click' }
	];
	test('steps, hidden elements and timeline', () => {
		const s = { anims };
		expect(animSteps(s).steps).toBe(2);
		expect([...hiddenAt(s, 0)].sort()).toEqual(['w', 'x', 'y', 'z']);
		expect([...hiddenAt(s, 1)]).toEqual(['w']);
		const tl = stepTimeline(s, 1);
		expect(tl.entering.get('x')?.delay).toBe(0);
		expect(tl.entering.get('y')?.delay).toBe(0);
		expect(tl.entering.get('z')?.delay).toBe(600);
		expect(tl.length).toBe(600);
	});
	test('advance plays animation steps before moving, skips hidden slides', () => {
		const slides = [{ anims }, { hidden: true }, {}];
		expect(advance(slides, { index: 0, step: 0 }, 1)).toEqual({ index: 0, step: 1 });
		expect(advance(slides, { index: 0, step: 2 }, 1)).toEqual({ index: 2, step: 0 });
		expect(advance(slides, { index: 2, step: 0 }, -1)).toEqual({ index: 0, step: 2 });
		expect(advance(slides, { index: 2, step: 0 }, 1)).toBeNull();
	});
});

function richDeck(): SlidesContent {
	const c = deck();
	const s = c.slides[1];
	const tb: TableEl = merge(setCell(newTable(3, 3, 100, 300, 600), 0, 1, { text: textDoc('Cab') }), { r1: 1, c1: 0, r2: 2, c2: 1 });
	const chart: ChartEl = { id: 'ch', kind: 'chart', x: 700, y: 300, w: 400, h: 240, rot: 0, options: { type: 'column', legend: 'bottom', title: 'Ventas' }, data: { labels: ['T1', 'T2'], series: [{ name: 'Norte', values: [3, 5] }, { name: 'Sur', values: [4, null] }] } };
	const icon: IconEl = { id: 'ic', kind: 'icon', icon: 'House', nodes: [['path', { d: 'M3 10l9-7 9 7v10H3z' }]], color: 'accent1', stroke: 2, x: 20, y: 20, w: 60, h: 60, rot: 0 };
	const video: MediaEl = { id: 'v', kind: 'media', media: 'video', blobId: 'vid', mime: 'video/mp4', fileName: 'clip.mp4', autoplay: true, x: 20, y: 400, w: 320, h: 180, rot: 0 };
	const audio: MediaEl = { id: 'au', kind: 'media', media: 'audio', blobId: 'aud', mime: 'audio/mpeg', x: 400, y: 600, w: 80, h: 80, rot: 0 };
	const custom: ShapeEl = {
		id: 'cu',
		kind: 'shape',
		geom: 'custom',
		paths: [{ w: 100, h: 100, d: 'M0 0L100 0C100 50 50 100 0 100Z' }],
		x: 900,
		y: 20,
		w: 200,
		h: 100,
		rot: 0,
		fill: { type: 'gradient', angle: 45, stops: [{ pos: 0, color: 'accent1' }, { pos: 1, color: '#ffffff', alpha: 0.5 }] },
		line: null,
		textStyle: { font: 'minor', size: 18, color: 'dk1' },
		inset: 4,
		anchor: 'top',
		shadow: { color: '#000000', alpha: 0.4, blur: 8, dist: 4, dir: 45 }
	};
	s.elements.push(tb, chart, icon, video, audio, custom);
	s.transition = { type: 'push', dir: 'r', dur: 700 };
	s.anims = [
		{ id: 'a1', el: tb.id, effect: 'fade', dur: 500, trigger: 'click' },
		{ id: 'a2', el: 'ch', effect: 'fly', dir: 'd', dur: 500, trigger: 'with' },
		{ id: 'a3', el: 'cu', effect: 'wipe', dir: 'l', dur: 500, trigger: 'after' },
		{ id: 'a4', el: 'ic', effect: 'zoom', dur: 500, trigger: 'click' }
	];
	c.slides[2].transition = { type: 'fade', dur: 400 };
	return c;
}

describe('pptx writer E2', () => {
	test('tables, charts, media, icons, custom shapes and timing', async () => {
		const blobs: Record<string, Uint8Array> = { vid: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), aud: new Uint8Array([73, 68, 51]) };
		const files = unzipSync(await writePptx(richDeck(), async () => ({ data: PNG, extension: 'png' }), { loadBlob: async (id) => blobs[id] ?? null }));
		checkPackage(files);
		const s = strFromU8(files['ppt/slides/slide2.xml']);
		for (const frag of [
			'<a:tbl>',
			'gridSpan="2" rowSpan="2"',
			'hMerge="1" vMerge="1"',
			'<c:chart ',
			'<a:videoFile r:link=',
			'<a:audioFile r:link=',
			'asvg:svgBlip',
			'<a:custGeom>',
			'<a:gradFill',
			'<a:outerShdw',
			'<p:transition spd="med"><p:push dir="l"/></p:transition>',
			'nodeType="mainSeq"',
			'presetID="2" presetClass="entr" presetSubtype="4"',
			'filter="wipe(right)"',
			'nodeType="afterEffect"',
			'cmd="playFrom(0.0)"',
			'<p:cMediaNode',
			'<p:bldGraphic'
		])
			expect(s, frag).toContain(frag);
		// Element order of <p:sld>: cSld, clrMapOvr, transition, timing.
		expect(s.indexOf('</p:cSld>')).toBeLessThan(s.indexOf('<p:clrMapOvr>'));
		expect(s.indexOf('<p:clrMapOvr>')).toBeLessThan(s.indexOf('<p:transition'));
		expect(s.indexOf('<p:transition')).toBeLessThan(s.indexOf('<p:timing>'));
		// Every animation target exists on the slide; shape ids are unique.
		const ids = [...s.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
		expect(new Set(ids).size).toBe(ids.length);
		for (const m of s.matchAll(/spid="(\d+)"/g)) expect(ids).toContain(m[1]);
		const chart = strFromU8(files['ppt/charts/chart1.xml']);
		expect(chart).toContain('<c:externalData r:id="rId1">');
		expect(chart).toContain('Sheet1!$B$2:$B$3');
		expect(files['ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'].length).toBeGreaterThan(1000);
		expect(Object.keys(files).some((n) => n.endsWith('.mp4'))).toBe(true);
		expect(strFromU8(files['ppt/slides/slide3.xml'])).toContain('<p:fade/>');
	});
	test('imported timing is kept only while it still matches', async () => {
		const c = deck();
		const s = c.slides[3];
		(s.elements[0] as ShapeEl).srcId = 7;
		const raw =
			'<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="5" presetID="31" presetClass="entr" presetSubtype="0" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="6" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="7"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';
		s.anims = [{ id: 'x', el: 's1', effect: 'appear', dur: 0, trigger: 'click' }];
		s.timingXml = raw;
		s.animsFrom = JSON.stringify(s.anims);
		let xml = strFromU8(unzipSync(await writePptx(c, async () => null))['ppt/slides/slide4.xml']);
		expect(xml).toContain('presetID="31"');
		expect(xml).toContain('<p:cNvPr id="7"');
		s.anims = [{ ...s.anims[0], effect: 'fade', dur: 500 }];
		xml = strFromU8(unzipSync(await writePptx(c, async () => null))['ppt/slides/slide4.xml']);
		expect(xml).not.toContain('presetID="31"');
		expect(xml).toContain('presetID="10"');
	});
	test('custom path conversion and scaling', () => {
		expect(custPathXml({ w: 10, h: 10, d: 'M0 0L10 0Q10 10 0 10Z' })).toBe(
			'<a:path w="95250" h="95250"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="95250" y="0"/></a:lnTo><a:quadBezTo><a:pt x="95250" y="95250"/><a:pt x="0" y="95250"/></a:quadBezTo><a:close/></a:path>'
		);
		expect(scalePath({ w: 10, h: 20, d: 'M0 0L10 20' }, 100, 100).replace(/\s+/g, ' ').trim()).toBe('M 0 0L 100 100');
	});
});
