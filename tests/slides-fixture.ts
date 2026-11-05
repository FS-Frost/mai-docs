// Shared fixture for slides tests.
import { newSlide } from '../src/lib/slides/layouts.ts';
import { textDoc, type ImageEl, type ShapeEl, type SlidesContent } from '../src/lib/slides/model.ts';
import { THEMES } from '../src/lib/slides/themes.ts';

export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

export function deck(): SlidesContent {
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
