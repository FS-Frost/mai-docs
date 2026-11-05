// Presentation model. Coordinates are logical px at 96 dpi (= EMU / 9525), so 16:9 = 1280×720 like PowerPoint.
import type { JSONContent } from '@tiptap/core';
import type { ChartData } from '../sheets/charts.ts';
import type { ChartOptions } from '../sheets/model.ts';

export const EMU = 9525;

export type ThemeColor = 'dk1' | 'lt1' | 'dk2' | 'lt2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink';
export const THEME_COLORS: ThemeColor[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink'];

/** '#rrggbb' or a theme color role. */
export type Color = string;
export type GradStop = { pos: number; color: Color; alpha?: number };
export type Fill =
	| { type: 'none' }
	| { type: 'solid'; color: Color; alpha?: number }
	/** Linear (angle in degrees, 0 = left→right, clockwise) or radial gradient; stop pos 0..1. */
	| { type: 'gradient'; kind?: 'linear' | 'radial'; angle: number; stops: GradStop[] }
	/** Picture fill (stretched). */
	| { type: 'image'; blobId: string };
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

export type Shadow = { color: Color; alpha: number; blur: number; dist: number; dir: number };

type Base = {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rot: number;
	flipH?: boolean;
	flipV?: boolean;
	ph?: Placeholder;
	name?: string;
	/** Shape id (cNvPr) in the imported .pptx; kept so imported animations (opaque XML) still target it on export. */
	srcId?: number;
	shadow?: Shadow;
	/** Copied from an imported master/layout (decoration): drawn but not selectable, like in PowerPoint. */
	locked?: boolean;
};

/** Custom geometry subpath in its own w×h space (scaled to the element box). Commands: absolute M L C Q Z. */
export type CustomPath = { w: number; h: number; d: string; fill?: boolean; stroke?: boolean };

export type ShapeEl = Base & {
	kind: 'shape';
	/** One of GEOMS, 'custom' (paths), or another PowerPoint preset kept from an import (drawn approximately). */
	geom: Geom | 'custom' | (string & {});
	paths?: CustomPath[];
	fill: Fill;
	line: Line;
	text?: JSONContent;
	textStyle: TextBase;
	inset: number;
	anchor: 'top' | 'middle' | 'bottom';
	/** Text box: grows with its text when autofit is on. */
	textbox?: boolean;
};
/** crop: fractions trimmed from each side (srcRect). svgBlobId: original SVG (written next to the PNG). */
export type ImageEl = Base & { kind: 'image'; blobId: string; alt?: string; crop?: { l: number; t: number; r: number; b: number }; svgBlobId?: string };

export type TableCell = {
	text?: JSONContent;
	fill?: Fill;
	/** Spans on the top-left cell of a merged block; the covered cells have `hidden`. */
	colSpan?: number;
	rowSpan?: number;
	hidden?: boolean;
	anchor?: 'top' | 'middle' | 'bottom';
};
export type TableEl = Base & {
	kind: 'table';
	/** Column widths and row heights in px. */
	cols: number[];
	rows: number[];
	cells: TableCell[][];
	border: Line;
	textStyle: TextBase;
	/** Header row in accent1 with white text; banded rows. */
	firstRow?: boolean;
	bandRow?: boolean;
};

export type ChartEl = Base & { kind: 'chart'; options: ChartOptions; data: ChartData; origin?: string };

export type MediaEl = Base & {
	kind: 'media';
	media: 'video' | 'audio';
	blobId: string;
	mime: string;
	fileName?: string;
	/** Poster frame (video) shown before playing and written to the .pptx. */
	posterBlobId?: string;
	autoplay?: boolean;
	loop?: boolean;
};

/** Lucide icon copied into the deck (SVG child nodes), so it renders without loading the icon set. */
export type IconEl = Base & { kind: 'icon'; icon: string; nodes: [string, Record<string, string>][]; color: Color; stroke: number };

export type El = ShapeEl | ImageEl | TableEl | ChartEl | MediaEl | IconEl;

export type Transition = { type: 'none' | 'fade' | 'push' | 'wipe' | 'cover' | 'zoom'; dir?: 'l' | 'r' | 'u' | 'd'; dur: number };
export const TRANSITIONS: Transition['type'][] = ['none', 'fade', 'push', 'wipe', 'cover', 'zoom'];
export type AnimEffect = 'appear' | 'fade' | 'fly' | 'zoom' | 'wipe';
export const ANIM_EFFECTS: AnimEffect[] = ['appear', 'fade', 'fly', 'zoom', 'wipe'];
/** Entrance animation. List order = play order; 'click' starts a new step, 'with'/'after' join the current one. */
export type Anim = { id: string; el: string; effect: AnimEffect; dir?: 'l' | 'r' | 'u' | 'd'; dur: number; delay?: number; trigger: 'click' | 'with' | 'after' };

export type Slide = {
	id: string;
	layout: LayoutKind;
	background?: Fill;
	elements: El[];
	notes: string;
	hidden?: boolean;
	transition?: Transition;
	anims?: Anim[];
	/** Imported <p:timing> kept as-is for re-export while `anims` stay as imported (compared with `animsFrom`). */
	timingXml?: string;
	animsFrom?: string;
};

export type SlidesContent = { v: 1; size: { w: number; h: number }; theme: Theme; slides: Slide[] };

export const SIZES = { '16:9': { w: 1280, h: 720 }, '4:3': { w: 960, h: 720 } } as const;

export const uid = () => crypto.randomUUID();

export const resolveColor = (theme: Theme, c: Color | undefined, fallback = '#000000') => {
	if (!c) return fallback;
	if (c.startsWith('#')) return c;
	return theme.colors[c as ThemeColor] ?? fallback;
};

export const resolveFont = (theme: Theme, f: string) => (f === 'major' ? theme.fonts.major : f === 'minor' ? theme.fonts.minor : f);

export function cssColor(theme: Theme, c: Color | undefined, alpha?: number): string {
	const hex = resolveColor(theme, c);
	if (alpha === undefined || alpha >= 1) return hex;
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, alpha)})`;
}

/** CSS background of a fill. Picture fills need the object URL (`imageUrl`), which only the browser has. */
export function cssFill(theme: Theme, f: Fill | undefined, imageUrl?: (blobId: string) => string | undefined): string {
	if (!f || f.type === 'none') return 'transparent';
	if (f.type === 'solid') return cssColor(theme, f.color, f.alpha);
	if (f.type === 'gradient') {
		const stops = [...f.stops]
			.sort((a, b) => a.pos - b.pos)
			.map((s) => `${cssColor(theme, s.color, s.alpha)} ${Math.round(s.pos * 1000) / 10}%`)
			.join(', ');
		return f.kind === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${(f.angle + 90) % 360}deg, ${stops})`;
	}
	const u = imageUrl?.(f.blobId);
	return u ? `center / 100% 100% no-repeat url("${u}")` : '#888888';
}

/** Representative solid color of a fill (swatches, SVG fallbacks). */
export function fillColor(theme: Theme, f: Fill | undefined): string | null {
	if (!f || f.type === 'none') return null;
	if (f.type === 'solid') return cssColor(theme, f.color, f.alpha);
	if (f.type === 'gradient') return cssColor(theme, f.stops[0]?.color ?? '#888888', f.stops[0]?.alpha);
	return '#888888';
}

/** Blob ids a deck references (images, media, posters, picture fills): pruning keeps them, export embeds them. */
export function blobIds(c: SlidesContent): string[] {
	const out = new Set<string>();
	const fill = (f?: Fill) => {
		if (f?.type === 'image') out.add(f.blobId);
	};
	fill(c.theme.background);
	for (const s of c.slides) {
		fill(s.background);
		for (const e of s.elements) {
			if (e.kind === 'image') {
				out.add(e.blobId);
				if (e.svgBlobId) out.add(e.svgBlobId);
			} else if (e.kind === 'media') {
				out.add(e.blobId);
				if (e.posterBlobId) out.add(e.posterBlobId);
			} else if (e.kind === 'shape') fill(e.fill);
			else if (e.kind === 'table') for (const row of e.cells) for (const cell of row) fill(cell.fill);
		}
	}
	return [...out];
}

/** Click steps of a slide's animations: `stepOf` = 1-based step at which each anim plays. */
export function animSteps(s: Pick<Slide, 'anims'>): { steps: number; stepOf: Map<string, number> } {
	const stepOf = new Map<string, number>();
	let step = 0;
	for (const [i, a] of (s.anims ?? []).entries()) {
		if (a.trigger === 'click' || i === 0) step++;
		stepOf.set(a.id, step);
	}
	return { steps: step, stepOf };
}

/** Anims of a step with absolute start delays ('with' = with the previous, 'after' = when the previous ends), by element. */
export function stepTimeline(s: Pick<Slide, 'anims'>, step: number): { entering: Map<string, Anim>; length: number } {
	const { stepOf } = animSteps(s);
	const entering = new Map<string, Anim>();
	// Like PowerPoint: effects run in groups; 'with' joins the current group, 'after' starts a group when it ends.
	let groupStart = 0;
	let groupEnd = 0;
	let first = true;
	for (const a of s.anims ?? []) {
		if (stepOf.get(a.id) !== step) continue;
		if (a.trigger === 'after' && !first) groupStart = groupEnd;
		first = false;
		const start = groupStart + (a.delay ?? 0);
		const dur = a.effect === 'appear' ? 0 : a.dur;
		entering.set(a.el, { ...a, delay: start, dur });
		groupEnd = Math.max(groupEnd, start + dur);
	}
	return { entering, length: groupEnd };
}

/** Elements hidden at a step (entrance animations not played yet). */
export function hiddenAt(s: Pick<Slide, 'anims'>, step: number): Set<string> {
	const { stepOf } = animSteps(s);
	const out = new Set<string>();
	for (const a of s.anims ?? []) if ((stepOf.get(a.id) ?? 0) > step) out.add(a.el);
	return out;
}

export const hasText = (e: El): e is ShapeEl => e.kind === 'shape' && e.geom !== 'line';

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
