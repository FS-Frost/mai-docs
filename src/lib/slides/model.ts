// Presentation model. Coordinates are logical px at 96 dpi (= EMU / 9525), so 16:9 = 1280×720 like PowerPoint.
import type { JSONContent } from '@tiptap/core';

export const EMU = 9525;

export type ThemeColor = 'dk1' | 'lt1' | 'dk2' | 'lt2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink';
export const THEME_COLORS: ThemeColor[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink'];

/** '#rrggbb' or a theme color role. */
export type Color = string;
export type Fill = { type: 'none' } | { type: 'solid'; color: Color; alpha?: number };
export type Line = { color: Color; width: number; dash?: 'solid' | 'dash' | 'dot' } | null;

export type Theme = {
	id: string;
	name: string;
	colors: Record<ThemeColor, string>;
	fonts: { major: string; minor: string };
	background: Fill;
};

export type Placeholder = 'title' | 'subtitle' | 'body' | 'body2';
export type LayoutKind = 'title' | 'titleBody' | 'section' | 'twoCol' | 'titleOnly' | 'blank';
export const LAYOUTS: LayoutKind[] = ['title', 'titleBody', 'section', 'twoCol', 'titleOnly', 'blank'];

export type Geom =
	| 'rect'
	| 'roundRect'
	| 'ellipse'
	| 'triangle'
	| 'rtTriangle'
	| 'diamond'
	| 'pentagon'
	| 'hexagon'
	| 'parallelogram'
	| 'trapezoid'
	| 'star5'
	| 'rightArrow'
	| 'leftArrow'
	| 'chevron'
	| 'line';

/** Base text style of a shape (Tiptap marks override it). font: 'major' | 'minor' | family name. */
export type TextBase = { font: string; size: number; color: Color; bold?: boolean; align?: 'left' | 'center' | 'right' };

type Base = { id: string; x: number; y: number; w: number; h: number; rot: number; flipH?: boolean; flipV?: boolean; ph?: Placeholder; name?: string };

export type ShapeEl = Base & {
	kind: 'shape';
	geom: Geom;
	fill: Fill;
	line: Line;
	text?: JSONContent;
	textStyle: TextBase;
	inset: number;
	anchor: 'top' | 'middle' | 'bottom';
	/** Text box: grows with its text when autofit is on. */
	textbox?: boolean;
};
export type ImageEl = Base & { kind: 'image'; blobId: string; alt?: string };
export type El = ShapeEl | ImageEl;

export type Slide = { id: string; layout: LayoutKind; background?: Fill; elements: El[]; notes: string; hidden?: boolean };

export type SlidesContent = { v: 1; size: { w: number; h: number }; theme: Theme; slides: Slide[] };

export const SIZES = { '16:9': { w: 1280, h: 720 }, '4:3': { w: 960, h: 720 } } as const;

export const uid = () => crypto.randomUUID();

export const resolveColor = (theme: Theme, c: Color | undefined, fallback = '#000000') => {
	if (!c) return fallback;
	if (c.startsWith('#')) return c;
	return theme.colors[c as ThemeColor] ?? fallback;
};

export const resolveFont = (theme: Theme, f: string) => (f === 'major' ? theme.fonts.major : f === 'minor' ? theme.fonts.minor : f);

export function cssFill(theme: Theme, f: Fill | undefined): string {
	if (!f || f.type === 'none') return 'transparent';
	const hex = resolveColor(theme, f.color);
	if (f.alpha === undefined || f.alpha >= 1) return hex;
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${f.alpha})`;
}

export const slideBackground = (c: SlidesContent, s: Slide) => s.background ?? c.theme.background;

/** Plain text of a Tiptap JSON (titles of thumbnails, accessibility). */
export function textOf(doc: JSONContent | undefined): string {
	if (!doc) return '';
	if (doc.type === 'text') return doc.text ?? '';
	const parts = (doc.content ?? []).map(textOf);
	return doc.type === 'doc' || doc.type === 'bulletList' || doc.type === 'orderedList' || doc.type === 'listItem' ? parts.join('\n') : parts.join('');
}

export const textDoc = (text: string, list?: 'bullet' | 'ordered'): JSONContent => {
	const lines = text.split('\n');
	const p = (l: string): JSONContent => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' });
	if (list) return { type: 'doc', content: [{ type: list === 'bullet' ? 'bulletList' : 'orderedList', content: lines.map((l) => ({ type: 'listItem', content: [p(l)] })) }] };
	return { type: 'doc', content: lines.map(p) };
};

export function slideTitle(s: Slide): string {
	const t = s.elements.find((e) => e.kind === 'shape' && e.ph === 'title') as ShapeEl | undefined;
	return textOf(t?.text).trim();
}
