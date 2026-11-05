// Slide layouts generated from the slide size: placeholder boxes and default text styles per role.
import { textDoc, uid, type LayoutKind, type Placeholder, type ShapeEl, type Slide, type SlidesContent, type TextBase } from './model.ts';

export type Box = { x: number; y: number; w: number; h: number };

export const ROLE_STYLE: Record<Placeholder, TextBase> = {
	title: { font: 'major', size: 40, color: 'dk1', bold: true },
	subtitle: { font: 'minor', size: 24, color: 'dk2' },
	body: { font: 'minor', size: 22, color: 'dk1' },
	body2: { font: 'minor', size: 22, color: 'dk1' }
};

/** Placeholder boxes of a layout for a slide of w×h. */
export function layoutBoxes(kind: LayoutKind, w: number, h: number): Partial<Record<Placeholder, Box>> {
	const m = Math.round(w * 0.06);
	const inner = w - 2 * m;
	switch (kind) {
		case 'title':
			return { title: { x: m, y: Math.round(h * 0.3), w: inner, h: Math.round(h * 0.2) }, subtitle: { x: m, y: Math.round(h * 0.53), w: inner, h: Math.round(h * 0.13) } };
		case 'section':
			return { title: { x: m, y: Math.round(h * 0.38), w: inner, h: Math.round(h * 0.18) }, subtitle: { x: m, y: Math.round(h * 0.58), w: inner, h: Math.round(h * 0.1) } };
		case 'titleBody':
			return { title: { x: m, y: Math.round(h * 0.06), w: inner, h: Math.round(h * 0.15) }, body: { x: m, y: Math.round(h * 0.25), w: inner, h: Math.round(h * 0.67) } };
		case 'twoCol': {
			const gap = Math.round(w * 0.03);
			const col = Math.round((inner - gap) / 2);
			return {
				title: { x: m, y: Math.round(h * 0.06), w: inner, h: Math.round(h * 0.15) },
				body: { x: m, y: Math.round(h * 0.25), w: col, h: Math.round(h * 0.67) },
				body2: { x: m + col + gap, y: Math.round(h * 0.25), w: col, h: Math.round(h * 0.67) }
			};
		}
		case 'titleOnly':
			return { title: { x: m, y: Math.round(h * 0.06), w: inner, h: Math.round(h * 0.15) } };
		case 'blank':
			return {};
	}
}

export function placeholderEl(role: Placeholder, box: Box, kind: LayoutKind, text = ''): ShapeEl {
	const centered = (kind === 'title' || kind === 'section') && (role === 'title' || role === 'subtitle');
	const style: TextBase = { ...ROLE_STYLE[role], align: centered ? 'center' : 'left', size: kind === 'title' && role === 'title' ? 54 : ROLE_STYLE[role].size };
	return {
		id: uid(),
		kind: 'shape',
		geom: 'rect',
		ph: role,
		...box,
		rot: 0,
		fill: { type: 'none' },
		line: null,
		textbox: true,
		inset: 8,
		anchor: role === 'title' ? (kind === 'title' ? 'bottom' : 'middle') : role === 'subtitle' ? 'top' : 'top',
		textStyle: style,
		text: text ? textDoc(text, role.startsWith('body') ? 'bullet' : undefined) : undefined
	};
}

export function newSlide(c: Pick<SlidesContent, 'size'>, kind: LayoutKind): Slide {
	const boxes = layoutBoxes(kind, c.size.w, c.size.h);
	const elements = (Object.entries(boxes) as [Placeholder, Box][]).map(([role, box]) => placeholderEl(role, box, kind));
	return { id: uid(), layout: kind, elements, notes: '' };
}

/** Switches layout: placeholder elements move to the new boxes (extra ones keep their place, missing roles are added empty). */
export function applyLayout(c: Pick<SlidesContent, 'size'>, s: Slide, kind: LayoutKind): Slide {
	const boxes = layoutBoxes(kind, c.size.w, c.size.h);
	const used = new Set<Placeholder>();
	const elements = s.elements.map((e) => {
		if (e.kind !== 'shape' || !e.ph) return e;
		const box = boxes[e.ph];
		if (!box) return e;
		used.add(e.ph);
		const ref = placeholderEl(e.ph, box, kind);
		return { ...e, ...box, rot: 0, anchor: ref.anchor, textStyle: { ...e.textStyle, align: ref.textStyle.align, size: ref.textStyle.size } };
	});
	for (const [role, box] of Object.entries(boxes) as [Placeholder, Box][]) if (!used.has(role)) elements.push(placeholderEl(role, box, kind));
	return { ...s, layout: kind, elements };
}

/** Scales every element when the slide size changes (16:9 ↔ 4:3). */
export function resize(c: SlidesContent, w: number, h: number): SlidesContent {
	const sx = w / c.size.w;
	const sy = h / c.size.h;
	const s = Math.min(sx, sy);
	const offX = (w - c.size.w * s) / 2;
	const offY = (h - c.size.h * s) / 2;
	return {
		...c,
		size: { w, h },
		slides: c.slides.map((sl) => ({
			...sl,
			elements: sl.elements.map((e) => ({ ...e, x: Math.round(e.x * s + offX), y: Math.round(e.y * s + offY), w: Math.round(e.w * s), h: Math.round(e.h * s) }))
		}))
	};
}
