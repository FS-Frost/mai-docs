// .pptx reader (own OOXML). Reads the theme (colors, fonts), slide size, master → layout → slide inheritance of
// placeholders (position, body properties, text styles, bullets), backgrounds (solid, gradient, picture,
// theme references), master/layout decorations (copied as locked elements), shapes (preset and custom
// geometry, fills, lines, shadows, text), pictures (crop, SVG), video/audio, groups (flattened), tables,
// charts, SmartArt (its drawing part), equations/OLE (fallback picture), notes, transitions and animations
// (raw <p:timing> kept for re-export + an approximate list of entrance effects).
import type { JSONContent } from '@tiptap/core';
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { ChartData } from '../../sheets/charts.ts';
import type { ChartOptions, ChartType } from '../../sheets/model.ts';
import {
	EMU,
	THEME_COLORS,
	uid,
	type Anim,
	type AnimEffect,
	type Color,
	type CustomPath,
	type El,
	type Fill,
	type GradStop,
	type LayoutKind,
	type Line,
	type Placeholder,
	type Shadow,
	type ShapeEl,
	type Slide,
	type SlidesContent,
	type TableCell,
	type TableEl,
	type TextBase,
	type Theme,
	type ThemeColor,
	type Transition
} from '../model.ts';

export type ReadOptions = {
	/** Stores a picture/media blob and returns its id. */
	putBlob: (data: Uint8Array, mime: string, name: string) => Promise<string>;
	/** Whether a font is installed (browser check); missing ones are replaced. */
	fontAvailable?: (family: string) => boolean;
};
export type ReadResult = { content: SlidesContent; lossy: boolean; fontsReplaced: string[]; animsApprox: boolean };

// ---------- XML tree ----------

type N = { tag: string; attrs: Record<string, string>; kids: N[]; text?: string };

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, trimValues: false });

function toNode(o: Record<string, unknown>): N {
	const tag = Object.keys(o).find((k) => k !== ':@') ?? '#text';
	if (tag === '#text') return { tag, attrs: {}, kids: [], text: String(o['#text'] ?? '') };
	const attrs = (o[':@'] as Record<string, string>) ?? {};
	const kids = ((o[tag] as Record<string, unknown>[]) ?? []).map(toNode);
	return { tag, attrs, kids };
}

function parse(xml: string): N {
	const top = (parser.parse(xml) as Record<string, unknown>[]).map(toNode).filter((n) => n.tag !== '?xml' && n.tag !== '#text');
	return top[0] ?? { tag: '', attrs: {}, kids: [] };
}

const kid = (n: N | undefined, tag: string) => n?.kids.find((k) => k.tag === tag);
const kidsOf = (n: N | undefined, tag: string) => n?.kids.filter((k) => k.tag === tag) ?? [];
/** Path of child tags; '*' never used. */
const at = (n: N | undefined, ...path: string[]) => path.reduce<N | undefined>((m, t) => kid(m, t), n);
const textIn = (n: N | undefined): string => (!n ? '' : n.tag === '#text' ? (n.text ?? '') : n.kids.map(textIn).join(''));
const num = (v: string | undefined, d = 0) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const px = (v: string | undefined) => num(v) / EMU;

/** mc:AlternateContent → the Fallback content (or the Choice when there is no fallback). */
function unwrap(n: N): N[] {
	if (n.tag !== 'AlternateContent') return [n];
	const fb = kid(n, 'Fallback') ?? kid(n, 'Choice');
	return fb ? fb.kids.filter((k) => k.tag !== '#text').flatMap(unwrap) : [];
}

// ---------- Package ----------

type Rel = { id: string; type: string; target: string; external: boolean };

class Pkg {
	files: Record<string, Uint8Array>;
	private cache = new Map<string, N>();
	constructor(bytes: Uint8Array) {
		this.files = unzipSync(bytes);
	}
	has(p: string) {
		return !!this.files[p];
	}
	str(p: string) {
		const f = this.files[p];
		return f ? strFromU8(f) : '';
	}
	xml(p: string): N | undefined {
		if (!this.files[p]) return undefined;
		let n = this.cache.get(p);
		if (!n) {
			n = parse(this.str(p));
			this.cache.set(p, n);
		}
		return n;
	}
	rels(p: string): Rel[] {
		const r = p.replace(/([^/]+)$/, '_rels/$1.rels');
		const x = this.xml(r);
		return kidsOf(x, 'Relationship').map((e) => ({ id: e.attrs.Id, type: e.attrs.Type ?? '', target: e.attrs.TargetMode === 'External' ? e.attrs.Target : resolve(p, e.attrs.Target ?? ''), external: e.attrs.TargetMode === 'External' }));
	}
	rel(p: string, id: string | undefined) {
		return id ? this.rels(p).find((r) => r.id === id) : undefined;
	}
	relByType(p: string, type: string) {
		return this.rels(p).find((r) => r.type.endsWith(`/${type}`));
	}
}

function resolve(from: string, target: string) {
	if (target.startsWith('/')) return target.slice(1);
	const parts = from.split('/').slice(0, -1);
	for (const seg of target.split('/')) {
		if (seg === '..') parts.pop();
		else if (seg !== '.' && seg) parts.push(seg);
	}
	return parts.join('/');
}

// ---------- Colors ----------

type ClrMap = Record<string, string>;
const DEFAULT_MAP: ClrMap = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };

function hexToRgb(h: string) {
	const n = parseInt(h.replace('#', '').padStart(6, '0').slice(-6), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

function rgbToHsl(r: number, g: number, b: number) {
	r /= 255;
	g /= 255;
	b /= 255;
	const mx = Math.max(r, g, b);
	const mn = Math.min(r, g, b);
	const l = (mx + mn) / 2;
	if (mx === mn) return [0, 0, l];
	const d = mx - mn;
	const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
	const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [h / 6, s, l];
}
function hslToRgb(h: number, s: number, l: number) {
	if (!s) return [l * 255, l * 255, l * 255];
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const f = (t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const PRESET: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', darkBlue: '#00008b', darkRed: '#8b0000', darkGreen: '#006400', lightGray: '#d3d3d3' };

class Colors {
	constructor(
		public theme: Record<ThemeColor, string>,
		public map: ClrMap = DEFAULT_MAP
	) {}
	/** Color element (srgbClr, schemeClr, …) → Color + alpha. Theme roles stay linked when unmodified. */
	read(n: N | undefined, ph?: { color: Color; alpha?: number }): { color: Color; alpha?: number } | null {
		if (!n) return null;
		let base: string | null = null;
		let role: string | null = null;
		if (n.tag === 'srgbClr') base = `#${n.attrs.val}`;
		else if (n.tag === 'sysClr') base = `#${n.attrs.lastClr ?? (n.attrs.val === 'window' ? 'FFFFFF' : '000000')}`;
		else if (n.tag === 'prstClr') base = PRESET[n.attrs.val] ?? '#000000';
		else if (n.tag === 'scrgbClr') base = rgbToHex(num(n.attrs.r) * 2.55e-3, num(n.attrs.g) * 2.55e-3, num(n.attrs.b) * 2.55e-3);
		else if (n.tag === 'hslClr') base = rgbToHex(...(hslToRgb(num(n.attrs.hue) / 21600000, num(n.attrs.sat) / 100000, num(n.attrs.lum) / 100000) as [number, number, number]));
		else if (n.tag === 'schemeClr') {
			const v = n.attrs.val;
			if (v === 'phClr' && ph) {
				if (ph.color.startsWith('#')) base = ph.color;
				else role = ph.color;
			} else {
				const r = this.map[v] ?? v;
				if ((THEME_COLORS as string[]).includes(r)) role = r;
				else if (r === 'folHlink') base = this.theme.dk2;
				else base = this.theme.dk1;
			}
		} else return null;
		const mods = n.kids.filter((k) => k.tag !== '#text');
		let alpha: number | undefined;
		const colorMods = mods.filter((m) => m.tag !== 'alpha');
		const am = mods.find((m) => m.tag === 'alpha');
		if (am) alpha = num(am.attrs.val, 100000) / 100000;
		if (role && !colorMods.length) return { color: role, alpha };
		let [r, g, b] = hexToRgb(base ?? this.theme[role as ThemeColor] ?? '#000000');
		for (const m of colorMods) {
			const v = num(m.attrs.val) / 100000;
			if (m.tag === 'lumMod' || m.tag === 'lumOff') {
				const [h, s, l] = rgbToHsl(r, g, b);
				const nl = m.tag === 'lumMod' ? l * v : l + v;
				[r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, nl)));
			} else if (m.tag === 'tint') [r, g, b] = [r, g, b].map((c) => c + (255 - c) * (1 - v));
			else if (m.tag === 'shade') [r, g, b] = [r, g, b].map((c) => c * v);
			else if (m.tag === 'satMod') {
				const [h, s, l] = rgbToHsl(r, g, b);
				[r, g, b] = hslToRgb(h, Math.min(1, s * v), l);
			}
		}
		return { color: rgbToHex(r, g, b), alpha };
	}
	/** First color child of a fill-ish node. */
	of(n: N | undefined, ph?: { color: Color; alpha?: number }) {
		if (!n) return null;
		for (const k of n.kids) {
			const c = this.read(k, ph);
			if (c) return c;
		}
		return null;
	}
}

// ---------- Context ----------

type ThemeInfo = { theme: Theme; fills: N[]; lines: N[]; bgFills: N[]; effects: N[] };
type Ctx = {
	pkg: Pkg;
	part: string;
	colors: Colors;
	ti: ThemeInfo;
	opts: ReadOptions;
	media: Map<string, string>;
	lossy: { v: boolean };
	fonts: Set<string>;
};

async function blobOf(ctx: Ctx, part: string, rid: string | undefined): Promise<string | null> {
	const rel = ctx.pkg.rel(part, rid);
	if (!rel || rel.external) return null;
	const hit = ctx.media.get(rel.target);
	if (hit) return hit;
	const data = ctx.pkg.files[rel.target];
	if (!data) return null;
	const ext = /\.([a-z0-9]+)$/i.exec(rel.target)?.[1]?.toLowerCase() ?? '';
	const mime =
		({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', wmv: 'video/x-ms-wmv', avi: 'video/x-msvideo', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', wma: 'audio/x-ms-wma', ogg: 'audio/ogg' } as Record<string, string>)[ext] ?? 'application/octet-stream';
	if (ext === 'emf' || ext === 'wmf') ctx.lossy.v = true; // vector metafiles: browsers can't draw them
	const id = await ctx.opts.putBlob(data, mime, rel.target.split('/').pop() ?? 'media');
	ctx.media.set(rel.target, id);
	return id;
}

// ---------- Fills, lines, effects ----------

async function fillOf(ctx: Ctx, part: string, n: N | undefined, ph?: { color: Color; alpha?: number }): Promise<Fill | null | undefined> {
	// undefined = not specified (inherit), null = explicit noFill handled as {type:'none'}.
	if (!n) return undefined;
	const f = n.kids.find((k) => ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'].includes(k.tag));
	if (!f) return undefined;
	if (f.tag === 'noFill') return { type: 'none' };
	if (f.tag === 'solidFill') {
		const c = ctx.colors.of(f, ph);
		return c ? { type: 'solid', color: c.color, alpha: c.alpha } : undefined;
	}
	if (f.tag === 'gradFill') {
		const stops: GradStop[] = kidsOf(kid(f, 'gsLst'), 'gs')
			.map((g): GradStop | null => {
				const c = ctx.colors.of(g, ph);
				return c ? { pos: num(g.attrs.pos) / 100000, color: c.color, alpha: c.alpha } : null;
			})
			.filter((s): s is GradStop => !!s);
		if (!stops.length) return undefined;
		const path = kid(f, 'path');
		return { type: 'gradient', kind: path ? 'radial' : 'linear', angle: num(kid(f, 'lin')?.attrs.ang) / 60000, stops };
	}
	if (f.tag === 'blipFill') {
		const id = await blobOf(ctx, part, kid(f, 'blip')?.attrs.embed);
		return id ? { type: 'image', blobId: id } : undefined;
	}
	if (f.tag === 'pattFill') {
		ctx.lossy.v = true;
		const c = ctx.colors.of(kid(f, 'fgClr'), ph);
		return c ? { type: 'solid', color: c.color, alpha: c.alpha } : undefined;
	}
	return undefined; // grpFill: resolved by the caller
}

function lineOf(ctx: Ctx, ln: N | undefined, ph?: { color: Color; alpha?: number }): Line | undefined {
	if (!ln) return undefined;
	if (kid(ln, 'noFill')) return null;
	const c = ctx.colors.of(kid(ln, 'solidFill'), ph) ?? (kid(ln, 'gradFill') ? ctx.colors.of(kid(kid(kid(ln, 'gradFill'), 'gsLst'), 'gs'), ph) : null);
	const w = ln.attrs.w !== undefined ? Math.max(0.5, px(ln.attrs.w)) : undefined;
	if (!c && w === undefined) return undefined;
	const dash = kid(ln, 'prstDash')?.attrs.val;
	return { color: c?.color ?? ph?.color ?? 'dk1', width: Math.round((w ?? 1) * 4) / 4, dash: !dash || dash === 'solid' ? undefined : /dot/i.test(dash) && !/dash/i.test(dash) ? 'dot' : 'dash' };
}

function shadowOf(ctx: Ctx, eff: N | undefined): Shadow | undefined {
	const s = kid(eff, 'outerShdw');
	if (!eff) return undefined;
	if (eff.kids.some((k) => ['glow', 'reflection', 'softEdge', 'innerShdw', 'prstShdw'].includes(k.tag))) ctx.lossy.v = true;
	if (!s) return undefined;
	const c = ctx.colors.of(s) ?? { color: '#000000', alpha: 0.4 };
	return { color: c.color, alpha: c.alpha ?? 1, blur: px(s.attrs.blurRad), dist: px(s.attrs.dist), dir: num(s.attrs.dir) / 60000 };
}

/** <p:style> references → defaults for fill, line and font color. */
function styleRefs(ctx: Ctx, style: N | undefined) {
	if (!style) return {};
	const ref = (tag: string) => {
		const r = kid(style, tag);
		if (!r) return undefined;
		return { idx: num(r.attrs.idx), color: ctx.colors.of(r) ?? undefined };
	};
	return { fill: ref('fillRef'), line: ref('lnRef'), font: ref('fontRef'), effect: ref('effectRef') };
}

// ---------- Geometry ----------

const KNOWN = new Set(['rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'pentagon', 'hexagon', 'parallelogram', 'trapezoid', 'star5', 'rightArrow', 'leftArrow', 'chevron', 'line', 'straightConnector1', 'bentConnector3', 'octagon', 'plus', 'snip1Rect', 'homePlate', 'upArrow', 'downArrow', 'flowChartProcess', 'flowChartDecision', 'flowChartTerminator', 'flowChartAlternateProcess']);

function customPaths(cust: N, w: number, h: number): CustomPath[] {
	const out: CustomPath[] = [];
	for (const p of kidsOf(kid(cust, 'pathLst'), 'path')) {
		const pw = p.attrs.w ? px(p.attrs.w) : w;
		const ph = p.attrs.h ? px(p.attrs.h) : h;
		let d = '';
		let cx = 0;
		let cy = 0;
		let sx = 0;
		let sy = 0;
		const pt = (n: N) => [px(n.attrs.x), px(n.attrs.y)];
		const f = (v: number) => Math.round(v * 100) / 100;
		for (const c of p.kids) {
			if (c.tag === 'moveTo') {
				const [x, y] = pt(kid(c, 'pt')!);
				d += `M${f(x)} ${f(y)}`;
				cx = sx = x;
				cy = sy = y;
			} else if (c.tag === 'lnTo') {
				const [x, y] = pt(kid(c, 'pt')!);
				d += `L${f(x)} ${f(y)}`;
				cx = x;
				cy = y;
			} else if (c.tag === 'cubicBezTo') {
				const ps = kidsOf(c, 'pt').map(pt);
				if (ps.length === 3) {
					d += `C${ps.map(([x, y]) => `${f(x)} ${f(y)}`).join(' ')}`;
					[cx, cy] = ps[2];
				}
			} else if (c.tag === 'quadBezTo') {
				const ps = kidsOf(c, 'pt').map(pt);
				if (ps.length === 2) {
					d += `Q${ps.map(([x, y]) => `${f(x)} ${f(y)}`).join(' ')}`;
					[cx, cy] = ps[1];
				}
			} else if (c.tag === 'arcTo') {
				const wr = px(c.attrs.wR);
				const hr = px(c.attrs.hR);
				const st = (num(c.attrs.stAng) / 60000) * (Math.PI / 180);
				const sw = (num(c.attrs.swAng) / 60000) * (Math.PI / 180);
				const ox = cx - wr * Math.cos(st);
				const oy = cy - hr * Math.sin(st);
				const segs = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2)));
				const da = sw / segs;
				const k = (4 / 3) * Math.tan(da / 4);
				let a = st;
				for (let i = 0; i < segs; i++) {
					const a2 = a + da;
					const x1 = ox + wr * (Math.cos(a) - k * Math.sin(a));
					const y1 = oy + hr * (Math.sin(a) + k * Math.cos(a));
					const x2 = ox + wr * (Math.cos(a2) + k * Math.sin(a2));
					const y2 = oy + hr * (Math.sin(a2) - k * Math.cos(a2));
					const x3 = ox + wr * Math.cos(a2);
					const y3 = oy + hr * Math.sin(a2);
					d += `C${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x3)} ${f(y3)}`;
					a = a2;
				}
				cx = ox + wr * Math.cos(st + sw);
				cy = oy + hr * Math.sin(st + sw);
			} else if (c.tag === 'close') {
				d += 'Z';
				cx = sx;
				cy = sy;
			}
		}
		if (d) out.push({ w: pw || w || 1, h: ph || h || 1, d, fill: p.attrs.fill === 'none' ? false : undefined, stroke: p.attrs.stroke === '0' || p.attrs.stroke === 'false' ? false : undefined });
	}
	return out;
}

// ---------- Text ----------

type Lvl = { size?: number; color?: { color: Color; alpha?: number }; font?: string; bold?: boolean; italic?: boolean; align?: string; bullet?: 'char' | 'num' | 'none'; marL?: number };
type TextStyles = Lvl[]; // index = level 0..8
type Body = { anchor?: string; ins?: number[]; fontScale?: number; wrap?: boolean };

function lvlOf(ctx: Ctx, p: N | undefined): Lvl {
	if (!p) return {};
	const r = kid(p, 'defRPr');
	const out: Lvl = {};
	if (p.attrs.algn) out.align = p.attrs.algn;
	if (p.attrs.marL) out.marL = px(p.attrs.marL);
	if (kid(p, 'buNone')) out.bullet = 'none';
	else if (kid(p, 'buChar') || kid(p, 'buBlip')) out.bullet = 'char';
	else if (kid(p, 'buAutoNum')) out.bullet = 'num';
	if (r) {
		if (r.attrs.sz) out.size = num(r.attrs.sz) / 100;
		if (r.attrs.b !== undefined) out.bold = r.attrs.b === '1' || r.attrs.b === 'true';
		if (r.attrs.i !== undefined) out.italic = r.attrs.i === '1' || r.attrs.i === 'true';
		const c = ctx.colors.of(kid(r, 'solidFill'));
		if (c) out.color = c;
		const lat = kid(r, 'latin')?.attrs.typeface;
		if (lat) out.font = lat;
	}
	return out;
}

function stylesOf(ctx: Ctx, lst: N | undefined): TextStyles {
	const out: TextStyles = [];
	if (!lst) return out;
	for (let i = 0; i < 9; i++) {
		const p = kid(lst, `lvl${i + 1}pPr`);
		if (p) out[i] = lvlOf(ctx, p);
	}
	return out;
}

const mergeStyles = (...list: TextStyles[]): TextStyles => {
	const out: TextStyles = [];
	for (const s of list) for (let i = 0; i < 9; i++) if (s[i]) out[i] = { ...out[i], ...Object.fromEntries(Object.entries(s[i]).filter(([, v]) => v !== undefined)) };
	return out;
};

function bodyOf(b: N | undefined): Body {
	if (!b) return {};
	const out: Body = {};
	if (b.attrs.anchor) out.anchor = b.attrs.anchor;
	const ins = ['lIns', 'tIns', 'rIns', 'bIns'].map((k) => b.attrs[k]);
	if (ins.some((v) => v !== undefined)) out.ins = ins.map((v, i) => (v === undefined ? (i % 2 ? 3.6 : 7.2) * (96 / 72) : px(v)));
	const fs = kid(b, 'normAutofit')?.attrs.fontScale;
	if (fs) out.fontScale = num(fs) / 100000;
	return out;
}

/** Theme font reference (+mj-lt / +mn-lt) → 'major' | 'minor'; others as-is. */
const fontRef = (f: string | undefined) => (!f ? undefined : f.startsWith('+mj') ? 'major' : f.startsWith('+mn') ? 'minor' : f);

function richText(ctx: Ctx, part: string, tx: N | undefined, styles: TextStyles, base: TextBase, scale: number): JSONContent | undefined {
	if (!tx) return undefined;
	const paras = kidsOf(tx, 'p');
	if (!paras.length) return undefined;
	const blocks: JSONContent[] = [];
	// Open list stack: each entry = list node + its level.
	let stack: { node: JSONContent; level: number; kind: 'bulletList' | 'orderedList' }[] = [];
	let any = false;
	for (const p of paras) {
		const ppr = kid(p, 'pPr');
		const level = num(ppr?.attrs.lvl);
		const st = styles[level] ?? styles[0] ?? {};
		const own = lvlOf(ctx, ppr);
		const bullet = own.bullet ?? st.bullet ?? 'none';
		const align = own.align ?? st.align;
		const content: JSONContent[] = [];
		for (const r of p.kids) {
			if (r.tag === 'r' || r.tag === 'fld') {
				const t = textIn(kid(r, 't'));
				if (!t) continue;
				const marks = runMarks(ctx, part, kid(r, 'rPr'), st, base, scale);
				content.push(marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t });
			} else if (r.tag === 'br') content.push({ type: 'hardBreak' });
		}
		if (content.some((c) => c.type === 'text')) any = true;
		const algnMap: Record<string, string> = { ctr: 'center', r: 'right', just: 'justify', dist: 'justify', l: 'left' };
		const para: JSONContent = { type: 'paragraph', ...(align && algnMap[align] && algnMap[align] !== (base.align ?? 'left') ? { attrs: { textAlign: algnMap[align] } } : {}), ...(content.length ? { content } : {}) };
		if (bullet === 'none' || !content.length) {
			stack = [];
			blocks.push(para);
			continue;
		}
		const kind = bullet === 'num' ? 'orderedList' : 'bulletList';
		while (stack.length && (stack[stack.length - 1].level > level || (stack[stack.length - 1].level === level && stack[stack.length - 1].kind !== kind))) stack.pop();
		const item: JSONContent = { type: 'listItem', content: [para] };
		const top = stack[stack.length - 1];
		if (top && top.level === level) top.node.content!.push(item);
		else {
			const list: JSONContent = { type: kind, content: [item] };
			if (top) {
				const last = top.node.content![top.node.content!.length - 1];
				last.content!.push(list);
			} else blocks.push(list);
			stack.push({ node: list, level, kind });
		}
	}
	return any ? { type: 'doc', content: blocks } : undefined;
}

function runMarks(ctx: Ctx, part: string, rpr: N | undefined, st: Lvl, base: TextBase, scale: number) {
	const marks: NonNullable<JSONContent['marks']> = [];
	const bold = rpr?.attrs.b !== undefined ? rpr.attrs.b === '1' || rpr.attrs.b === 'true' : st.bold;
	if (bold && !base.bold) marks.push({ type: 'bold' });
	const italic = rpr?.attrs.i !== undefined ? rpr.attrs.i === '1' || rpr.attrs.i === 'true' : st.italic;
	if (italic) marks.push({ type: 'italic' });
	if (rpr?.attrs.u && rpr.attrs.u !== 'none') marks.push({ type: 'underline' });
	if (rpr?.attrs.strike && rpr.attrs.strike !== 'noStrike') marks.push({ type: 'strike' });
	const attrs: Record<string, string> = {};
	const size = rpr?.attrs.sz ? num(rpr.attrs.sz) / 100 : st.size;
	if (size && Math.abs(size * scale - base.size) > 0.01) attrs.fontSize = `${Math.round(size * scale * 10) / 10}pt`;
	const c = ctx.colors.of(kid(rpr, 'solidFill')) ?? st.color;
	if (c && c.color !== base.color) attrs.color = c.color.startsWith('#') ? c.color : ctx.colors.theme[c.color as ThemeColor];
	const font = fontRef(kid(rpr, 'latin')?.attrs.typeface ?? st.font);
	if (font && font !== base.font && font !== 'major' && font !== 'minor') {
		attrs.fontFamily = font;
		ctx.fonts.add(font);
	}
	if (Object.keys(attrs).length) marks.push({ type: 'textStyle', attrs });
	const hl = ctx.colors.of(kid(rpr, 'highlight'));
	if (hl) marks.push({ type: 'highlight', attrs: { color: hl.color.startsWith('#') ? hl.color : ctx.colors.theme[hl.color as ThemeColor] } });
	const link = ctx.pkg.rel(part, kid(rpr, 'hlinkClick')?.attrs.id);
	if (link?.external) marks.push({ type: 'link', attrs: { href: link.target } });
	return marks;
}

// ---------- Placeholders & inheritance ----------

type PhKey = { type: string; idx?: string };
const phOf = (sp: N): PhKey | null => {
	const ph = at(sp, 'nvSpPr', 'nvPr', 'ph') ?? at(sp, 'nvPicPr', 'nvPr', 'ph') ?? at(sp, 'nvGraphicFramePr', 'nvPr', 'ph');
	return ph ? { type: ph.attrs.type ?? 'body', idx: ph.attrs.idx } : null;
};

function findPh(tree: N | undefined, key: PhKey): N | undefined {
	const shapes = tree ? spTreeShapes(tree) : [];
	const withPh = shapes.map((s) => ({ s, k: phOf(s) })).filter((x) => x.k);
	const sameType = (a: string, b: string) => a === b || (['title', 'ctrTitle'].includes(a) && ['title', 'ctrTitle'].includes(b)) || (['body', 'subTitle', 'obj'].includes(a) && ['body', 'subTitle', 'obj'].includes(b) && false);
	if (key.idx !== undefined) {
		const byIdx = withPh.find((x) => x.k!.idx === key.idx);
		if (byIdx) return byIdx.s;
	}
	const byType = withPh.find((x) => sameType(x.k!.type, key.type));
	if (byType) return byType.s;
	// Masters only have title/body/dt/ftr/sldNum: subTitle and obj inherit from body.
	if (['subTitle', 'obj', 'body'].includes(key.type)) return withPh.find((x) => x.k!.type === 'body')?.s;
	return undefined;
}

const spTreeShapes = (root: N) => {
	const tree = at(root, 'cSld', 'spTree');
	return tree ? tree.kids.filter((k) => k.tag !== '#text').flatMap(unwrap) : [];
};

type Chain = { master: N; layout?: N; masterPart: string; layoutPart?: string };

/** Placeholder chain (layout + master shapes) for a placeholder key. */
function chainFor(chain: Chain, key: PhKey) {
	const lay = chain.layout ? findPh(chain.layout, key) : undefined;
	const mKey = { type: lay ? (phOf(lay)?.type ?? key.type) : key.type };
	const mas = findPh(chain.master, mKey.type === 'ctrTitle' ? { type: 'title' } : mKey);
	return { lay, mas };
}

function role(key: PhKey | null, bodyCount: { n: number }): Placeholder | undefined {
	if (!key) return undefined;
	if (key.type === 'title' || key.type === 'ctrTitle') return 'title';
	if (key.type === 'subTitle') return 'subtitle';
	if (key.type === 'body' || key.type === 'obj' || (!['dt', 'ftr', 'sldNum', 'pic', 'chart', 'tbl', 'clipArt', 'dgm', 'media', 'sldImg', 'hdr'].includes(key.type) && key.idx)) {
		bodyCount.n++;
		return bodyCount.n === 1 ? 'body' : bodyCount.n === 2 ? 'body2' : undefined;
	}
	return undefined;
}

// ---------- Elements ----------

type Xf = { x: number; y: number; w: number; h: number; rot: number; flipH?: boolean; flipV?: boolean };
function xfOf(n: N | undefined): Xf | null {
	if (!n) return null;
	const o = kid(n, 'off');
	const e = kid(n, 'ext');
	if (!o || !e) return null;
	return { x: px(o.attrs.x), y: px(o.attrs.y), w: px(e.attrs.cx), h: px(e.attrs.cy), rot: num(n.attrs.rot) / 60000, flipH: n.attrs.flipH === '1' || undefined, flipV: n.attrs.flipV === '1' || undefined };
}

/** Group transform: maps child coordinates into the parent's. */
type GroupMap = (x: Xf) => Xf;
const identity: GroupMap = (x) => x;

function groupMap(grp: N, outer: GroupMap): GroupMap {
	const xf = kid(at(grp, 'grpSpPr'), 'xfrm');
	if (!xf) return outer;
	const o = kid(xf, 'off');
	const e = kid(xf, 'ext');
	const co = kid(xf, 'chOff');
	const ce = kid(xf, 'chExt');
	if (!o || !e || !co || !ce) return outer;
	const sx = num(ce.attrs.cx) ? num(e.attrs.cx) / num(ce.attrs.cx) : 1;
	const sy = num(ce.attrs.cy) ? num(e.attrs.cy) / num(ce.attrs.cy) : 1;
	const rot = num(xf.attrs.rot) / 60000;
	return (c) => {
		const m: Xf = { ...c, x: px(o.attrs.x) + (c.x - px(co.attrs.x)) * sx, y: px(o.attrs.y) + (c.y - px(co.attrs.y)) * sy, w: c.w * sx, h: c.h * sy, rot: c.rot + rot };
		return outer(m);
	};
}

const round = (v: number) => Math.round(v * 100) / 100;
const roundXf = (x: Xf): Xf => ({ ...x, x: round(x.x), y: round(x.y), w: round(x.w), h: round(x.h), rot: Math.round(x.rot * 100) / 100 });

type ElCtx = Ctx & { chain?: Chain; bodyCount: { n: number }; locked?: boolean; slideW: number; slideH: number };

const MASTER_TEXT: Record<string, 'titleStyle' | 'bodyStyle' | 'otherStyle'> = { title: 'titleStyle', ctrTitle: 'titleStyle', body: 'bodyStyle', subTitle: 'bodyStyle', obj: 'bodyStyle' };

async function readShape(ctx: ElCtx, sp: N, map: GroupMap): Promise<El | null> {
	const key = ctx.chain ? phOf(sp) : null;
	const ch = key && ctx.chain ? chainFor(ctx.chain, key) : { lay: undefined, mas: undefined };
	const spPr = kid(sp, 'spPr');
	const xf = xfOf(kid(spPr, 'xfrm')) ?? xfOf(kid(kid(ch.lay, 'spPr'), 'xfrm')) ?? xfOf(kid(kid(ch.mas, 'spPr'), 'xfrm'));
	if (!xf) return null;
	const box = roundXf(map(xf));
	const refs = styleRefs(ctx, kid(sp, 'style'));
	// Geometry
	const prst = kid(spPr, 'prstGeom')?.attrs.prst;
	const cust = kid(spPr, 'custGeom');
	let geom: string = prst ?? 'rect';
	let paths: CustomPath[] | undefined;
	if (cust) {
		paths = customPaths(cust, xf.w, xf.h);
		geom = paths.length ? 'custom' : 'rect';
	} else if (prst && !KNOWN.has(prst)) ctx.lossy.v = true;
	// Fill / line
	const phClr = refs.fill?.color;
	let fill = (await fillOf(ctx, ctx.part, spPr, phClr)) ?? (await fillOf(ctx, ctx.chain?.layoutPart ?? ctx.part, kid(ch.lay, 'spPr'))) ?? (await fillOf(ctx, ctx.chain?.masterPart ?? ctx.part, kid(ch.mas, 'spPr')));
	if (fill === undefined && refs.fill && refs.fill.idx > 0) {
		const style = ctx.ti.fills[refs.fill.idx - 1];
		fill = style ? ((await fillOf(ctx, ctx.part, { tag: 'x', attrs: {}, kids: [style] }, refs.fill.color)) ?? undefined) : undefined;
		if (fill === undefined && refs.fill.color) fill = { type: 'solid', color: refs.fill.color.color, alpha: refs.fill.color.alpha };
	}
	let line = lineOf(ctx, kid(spPr, 'ln'), refs.line?.color) ?? lineOf(ctx, kid(kid(ch.lay, 'spPr'), 'ln')) ?? lineOf(ctx, kid(kid(ch.mas, 'spPr'), 'ln'));
	if (line === undefined && refs.line && refs.line.idx > 0) {
		const ln = ctx.ti.lines[refs.line.idx - 1];
		const w = ln?.attrs.w ? px(ln.attrs.w) : 1;
		line = refs.line.color ? { color: refs.line.color.color, width: Math.round(w * 4) / 4 } : null;
		const explicit = kid(spPr, 'ln');
		if (explicit?.attrs.w) line = line ? { ...line, width: px(explicit.attrs.w) } : line;
	}
	const isLine = sp.tag === 'cxnSp' || geom === 'line' || geom === 'straightConnector1' || geom === 'bentConnector3';
	// Text
	const txBody = kid(sp, 'txBody');
	const body = { ...bodyOf(kid(kid(ch.mas, 'txBody'), 'bodyPr')), ...bodyOf(kid(kid(ch.lay, 'txBody'), 'bodyPr')), ...bodyOf(kid(txBody, 'bodyPr')) };
	const masterTx = ctx.chain ? at(ctx.chain.master, 'txStyles', key ? (MASTER_TEXT[key.type] ?? 'otherStyle') : 'otherStyle') : undefined;
	const styles = mergeStyles(stylesOf(ctx, masterTx), stylesOf(ctx, kid(kid(ch.mas, 'txBody'), 'lstStyle')), stylesOf(ctx, kid(kid(ch.lay, 'txBody'), 'lstStyle')), stylesOf(ctx, kid(txBody, 'lstStyle')));
	const l0 = styles[0] ?? {};
	const scale = body.fontScale ?? 1;
	const fontColor = refs.font?.color;
	const algnMap: Record<string, 'left' | 'center' | 'right'> = { ctr: 'center', r: 'right', l: 'left' };
	const textStyle: TextBase = {
		font: fontRef(l0.font) ?? (key && MASTER_TEXT[key.type] === 'titleStyle' ? 'major' : 'minor'),
		size: Math.round((l0.size ?? 18) * scale * 10) / 10,
		color: l0.color?.color ?? fontColor?.color ?? 'dk1',
		bold: l0.bold || undefined,
		align: algnMap[l0.align ?? ''] ?? undefined
	};
	if (textStyle.font !== 'major' && textStyle.font !== 'minor') ctx.fonts.add(textStyle.font);
	const text = richText(ctx, ctx.part, txBody, styles, textStyle, scale);
	if (kid(kid(txBody, 'bodyPr'), 'prstTxWarp') || kid(kid(txBody, 'bodyPr'), 'scene3d')) ctx.lossy.v = true;
	const ins = body.ins ?? [9.6, 4.8, 9.6, 4.8];
	const nv = kid(sp, 'nvSpPr') ?? kid(sp, 'nvCxnSpPr');
	const cnv = kid(nv, 'cNvPr');
	const ph = role(key, ctx.bodyCount);
	const el: ShapeEl = {
		id: uid(),
		kind: 'shape',
		geom: isLine && geom === 'custom' ? 'line' : geom,
		paths,
		...box,
		fill: isLine ? { type: 'none' } : (fill ?? { type: 'none' }),
		line: line ?? (isLine ? { color: 'dk1', width: 1 } : null),
		textStyle,
		inset: Math.round(((ins[0] + ins[1] + ins[2] + ins[3]) / 4) * 10) / 10,
		anchor: body.anchor === 'ctr' ? 'middle' : body.anchor === 'b' ? 'bottom' : 'top',
		text,
		textbox: kid(nv, 'cNvSpPr')?.attrs.txBox === '1' || (!!ph && (fill?.type ?? 'none') === 'none') || undefined,
		ph,
		name: cnv?.attrs.name || undefined,
		srcId: ctx.locked ? undefined : num(cnv?.attrs.id) || undefined,
		shadow: shadowOf(ctx, kid(spPr, 'effectLst')),
		locked: ctx.locked || undefined
	};
	if (!el.paths) delete el.paths;
	// Empty, unfilled, unlined shapes (layout placeholders used as text frames) are dropped when locked.
	if (ctx.locked && !text && el.fill.type === 'none' && !el.line) return null;
	return el;
}

async function readPic(ctx: ElCtx, pic: N, map: GroupMap): Promise<El | null> {
	const xf = xfOf(at(pic, 'spPr', 'xfrm'));
	if (!xf) return null;
	const box = roundXf(map(xf));
	const blip = at(pic, 'blipFill', 'blip');
	const cnv = at(pic, 'nvPicPr', 'cNvPr');
	const nvPr = at(pic, 'nvPicPr', 'nvPr');
	const base = { id: uid(), ...box, name: cnv?.attrs.name || undefined, srcId: ctx.locked ? undefined : num(cnv?.attrs.id) || undefined, locked: ctx.locked || undefined, shadow: shadowOf(ctx, at(pic, 'spPr', 'effectLst')) };
	const video = kid(nvPr, 'videoFile');
	const audio = kid(nvPr, 'audioFile');
	if (video || audio) {
		const embed = nvPr?.kids
			.find((k) => k.tag === 'extLst')
			?.kids.flatMap((e) => e.kids)
			.find((k) => k.tag === 'media')?.attrs.embed;
		const blobId = (await blobOf(ctx, ctx.part, embed)) ?? (await blobOf(ctx, ctx.part, (video ?? audio)!.attrs.link));
		if (blobId) {
			const rel = ctx.pkg.rel(ctx.part, embed ?? (video ?? audio)!.attrs.link);
			const name = rel?.target.split('/').pop();
			const ext = /\.([a-z0-9]+)$/i.exec(name ?? '')?.[1]?.toLowerCase() ?? '';
			const mime = ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', wmv: 'video/x-ms-wmv', wma: 'audio/x-ms-wma' } as Record<string, string>)[ext] ?? (video ? 'video/mp4' : 'audio/mpeg');
			const poster = await blobOf(ctx, ctx.part, blip?.attrs.embed);
			return { ...base, kind: 'media', media: video ? 'video' : 'audio', blobId, mime, fileName: cnv?.attrs.name || name, posterBlobId: poster ?? undefined };
		}
		ctx.lossy.v = true;
	}
	const blobId = await blobOf(ctx, ctx.part, blip?.attrs.embed);
	if (!blobId) return null;
	const svgEmbed = blip?.kids
		.find((k) => k.tag === 'extLst')
		?.kids.flatMap((e) => e.kids)
		.find((k) => k.tag === 'svgBlip')?.attrs.embed;
	const svgBlobId = svgEmbed ? ((await blobOf(ctx, ctx.part, svgEmbed)) ?? undefined) : undefined;
	const src = at(pic, 'blipFill', 'srcRect');
	const crop = src && ['l', 't', 'r', 'b'].some((k) => src.attrs[k]) ? { l: num(src.attrs.l) / 100000, t: num(src.attrs.t) / 100000, r: num(src.attrs.r) / 100000, b: num(src.attrs.b) / 100000 } : undefined;
	return { ...base, kind: 'image', blobId, svgBlobId, alt: cnv?.attrs.descr || undefined, crop };
}

async function readTable(ctx: ElCtx, tbl: N, box: Xf): Promise<TableEl> {
	const cols = kidsOf(kid(tbl, 'tblGrid'), 'gridCol').map((g) => round(px(g.attrs.w)));
	const trs = kidsOf(tbl, 'tr');
	const rows = trs.map((r) => round(px(r.attrs.h)) || 30);
	const tblPr = kid(tbl, 'tblPr');
	let border: Line = null;
	const base: TextBase = { font: 'minor', size: 18, color: 'dk1' };
	let sizeSet = false;
	const cells: TableCell[][] = [];
	for (const [r, tr] of trs.entries()) {
		const row: TableCell[] = [];
		for (const tc of kidsOf(tr, 'tc')) {
			const cell: TableCell = {};
			if (tc.attrs.hMerge === '1' || tc.attrs.vMerge === '1') cell.hidden = true;
			if (num(tc.attrs.gridSpan) > 1) cell.colSpan = num(tc.attrs.gridSpan);
			if (num(tc.attrs.rowSpan) > 1) cell.rowSpan = num(tc.attrs.rowSpan);
			const tcPr = kid(tc, 'tcPr');
			const f = await fillOf(ctx, ctx.part, tcPr);
			if (f && f.type !== 'none') cell.fill = f;
			if (tcPr?.attrs.anchor === 'ctr') cell.anchor = 'middle';
			else if (tcPr?.attrs.anchor === 'b') cell.anchor = 'bottom';
			if (!border) for (const side of ['lnT', 'lnB', 'lnL', 'lnR']) border = border ?? (lineOf(ctx, kid(tcPr, side)) || null);
			const tx = kid(tc, 'txBody');
			if (!sizeSet) {
				const sz = tx?.kids.flatMap((p) => p.kids).find((k) => k.tag === 'r')?.kids.find((k) => k.tag === 'rPr')?.attrs.sz;
				if (sz) {
					base.size = num(sz) / 100;
					sizeSet = true;
				}
			}
			if (!cell.hidden) cell.text = richText(ctx, ctx.part, tx, [], base, 1);
			row.push(cell);
		}
		while (row.length < cols.length) row.push({});
		cells.push(row.slice(0, cols.length));
		void r;
	}
	return { id: uid(), kind: 'table', ...box, cols, rows, cells, border: border ?? { color: '#ffffff', width: 1 }, textStyle: base, firstRow: tblPr?.attrs.firstRow === '1' || undefined, bandRow: tblPr?.attrs.bandRow === '1' || undefined };
}

function readChartPart(ctx: Ctx, path: string): { options: ChartOptions; data: ChartData } | null {
	const x = ctx.pkg.xml(path);
	const chart = kid(x, 'chart');
	const plot = kid(chart, 'plotArea');
	if (!plot) return null;
	const TYPES: Record<string, ChartType> = { barChart: 'column', bar3DChart: 'column', lineChart: 'line', line3DChart: 'line', areaChart: 'area', area3DChart: 'area', pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie', doughnutChart: 'doughnut', scatterChart: 'scatter', bubbleChart: 'scatter', radarChart: 'line', stockChart: 'line' };
	const node = plot.kids.find((k) => TYPES[k.tag]);
	if (!node) return null;
	if (/3D|radar|stock|bubble|ofPie/.test(node.tag) || plot.kids.filter((k) => TYPES[k.tag]).length > 1) ctx.lossy.v = true;
	let type = TYPES[node.tag];
	if (type === 'column' && kid(node, 'barDir')?.attrs.val === 'bar') type = 'bar';
	const grouping = kid(node, 'grouping')?.attrs.val;
	const cache = (ref: N | undefined) => {
		const c = ref?.kids.find((k) => ['strRef', 'numRef', 'strLit', 'numLit', 'multiLvlStrRef'].includes(k.tag));
		const store = c?.kids.find((k) => ['strCache', 'numCache', 'multiLvlStrCache'].includes(k.tag)) ?? c;
		const lvl = store?.tag === 'multiLvlStrCache' ? kid(store, 'lvl') : store;
		const n = num(kid(lvl, 'ptCount')?.attrs.val, kidsOf(lvl, 'pt').length);
		const out: string[] = Array.from({ length: n }, () => '');
		for (const pt of kidsOf(lvl, 'pt')) out[num(pt.attrs.idx)] = textIn(kid(pt, 'v'));
		return out;
	};
	const sers = kidsOf(node, 'ser');
	const first = sers[0];
	const labels = type === 'scatter' ? [] : cache(kid(first, 'cat'));
	const xs = type === 'scatter' ? cache(kid(first, 'xVal')).map((v) => (v === '' ? null : Number(v))) : undefined;
	const colors: string[] = [];
	const series = sers.map((s, i) => {
		const name = textIn(kid(kid(kid(s, 'tx'), 'strRef'), 'strCache')) || textIn(kid(s, 'tx')) || `Series ${i + 1}`;
		const vals = cache(kid(s, type === 'scatter' ? 'yVal' : 'val')).map((v) => (v === '' ? null : Number(v)));
		const c = ctx.colors.of(kid(kid(s, 'spPr'), 'solidFill')) ?? ctx.colors.of(kid(kid(kid(s, 'spPr'), 'ln'), 'solidFill'));
		if (c) colors[i] = c.color.startsWith('#') ? c.color : ctx.colors.theme[c.color as ThemeColor];
		return { name: name.trim(), values: vals };
	});
	if ((type === 'pie' || type === 'doughnut') && first) {
		kidsOf(first, 'dPt').forEach((d) => {
			const c = ctx.colors.of(kid(kid(d, 'spPr'), 'solidFill'));
			if (c) colors[num(kid(d, 'idx')?.attrs.val)] = c.color.startsWith('#') ? c.color : ctx.colors.theme[c.color as ThemeColor];
		});
	}
	const title = kid(chart, 'title');
	const titleText = title ? kidsOf(at(title, 'tx', 'rich'), 'p').map((p) => kidsOf(p, 'r').map((r) => textIn(kid(r, 't'))).join('')).join(' ') : '';
	const legendPos = at(chart, 'legend', 'legendPos')?.attrs.val;
	const legend: ChartOptions['legend'] = !kid(chart, 'legend') ? 'none' : legendPos === 't' ? 'top' : legendPos === 'r' ? 'right' : 'bottom';
	const n = Math.max(labels.length, ...series.map((s) => s.values.length));
	const options: ChartOptions = { type, legend, title: titleText || (series.length === 1 && kid(chart, 'autoTitleDeleted')?.attrs.val !== '1' ? series[0].name : undefined), stacked: grouping === 'percentStacked' ? 'percent' : grouping === 'stacked' ? true : undefined, colors: colors.length ? Array.from({ length: Math.max(colors.length, 0) }, (_, i) => colors[i] ?? '') : undefined };
	const data: ChartData = { labels: type === 'scatter' ? (xs ?? []).map((v) => String(v ?? '')) : Array.from({ length: n }, (_, i) => labels[i] ?? String(i + 1)), series, xs };
	for (const k of Object.keys(options) as (keyof ChartOptions)[]) if (options[k] === undefined) delete options[k];
	if (!data.xs) delete data.xs;
	return { options, data };
}

async function readFrame(ctx: ElCtx, gf: N, map: GroupMap): Promise<El[]> {
	const xf = xfOf(kid(gf, 'xfrm'));
	const data = at(gf, 'graphic', 'graphicData');
	if (!xf || !data) return [];
	const box = roundXf(map(xf));
	const uri = data.attrs.uri ?? '';
	const cnv = at(gf, 'nvGraphicFramePr', 'cNvPr');
	const common = { srcId: ctx.locked ? undefined : num(cnv?.attrs.id) || undefined, name: cnv?.attrs.name || undefined, locked: ctx.locked || undefined };
	if (uri.endsWith('/table')) {
		const tbl = kid(data, 'tbl');
		return tbl ? [{ ...(await readTable(ctx, tbl, box)), ...common }] : [];
	}
	if (uri.endsWith('/chart')) {
		const rel = ctx.pkg.rel(ctx.part, kid(data, 'chart')?.attrs.id);
		const ch = rel ? readChartPart(ctx, rel.target) : null;
		if (ch) return [{ id: uid(), kind: 'chart', ...box, ...ch, ...common }];
		ctx.lossy.v = true;
		return [];
	}
	if (uri.endsWith('/diagram')) {
		// SmartArt: draw the shapes PowerPoint saved in the diagram drawing part.
		ctx.lossy.v = true;
		const drawing = ctx.pkg.rels(ctx.part).find((r) => r.type.endsWith('/diagramDrawing'));
		const relIds = kid(data, 'relIds');
		const own = relIds ? ctx.pkg.rels(ctx.part).find((r) => r.id === relIds.attrs.dm) : undefined;
		const candidates = ctx.pkg.rels(ctx.part).filter((r) => r.type.endsWith('/diagramDrawing'));
		const target = candidates.find((r) => own && r.target.replace(/drawing/i, 'data') === own.target.replace(/data/i, 'data')) ?? drawing;
		const dx = target ? ctx.pkg.xml(target.target) : undefined;
		const tree = at(dx, 'drawing', 'spTree') ?? at(dx, 'spTree');
		if (!tree || !target) return [];
		// Shapes of the drawing are in the frame's coordinate space.
		const inner: GroupMap = (c) => map({ ...c, x: xf.x + c.x, y: xf.y + c.y });
		return readTree({ ...ctx, part: target.target, locked: ctx.locked }, tree, inner, true);
	}
	// OLE objects, equations…: the fallback picture.
	const ole = at(data, 'oleObj');
	const pic = at(ole, 'pic') ?? at(data, 'pic');
	if (pic) {
		ctx.lossy.v = true;
		const el = await readPic(ctx, pic, map);
		return el ? [{ ...el, ...box, ...common }] : [];
	}
	ctx.lossy.v = true;
	return [];
}

async function readTree(ctx: ElCtx, tree: N, map: GroupMap, noIds = false): Promise<El[]> {
	const out: El[] = [];
	for (const raw of tree.kids) {
		if (raw.tag === '#text') continue;
		for (const n of unwrap(raw)) {
			let els: (El | null)[] = [];
			if (n.tag === 'sp' || n.tag === 'cxnSp') els = [await readShape(ctx, n, map)];
			else if (n.tag === 'pic') els = [await readPic(ctx, n, map)];
			else if (n.tag === 'graphicFrame') els = await readFrame(ctx, n, map);
			else if (n.tag === 'grpSp') els = await readTree(ctx, n, groupMap(n, map), noIds);
			else if (n.tag === 'contentPart') ctx.lossy.v = true;
			for (const e of els) if (e) out.push(noIds ? { ...e, srcId: undefined } : e);
		}
	}
	return out;
}

// ---------- Backgrounds ----------

async function bgOf(ctx: Ctx, part: string, root: N | undefined): Promise<Fill | undefined> {
	const bg = at(root, 'cSld', 'bg');
	if (!bg) return undefined;
	const pr = kid(bg, 'bgPr');
	if (pr) return (await fillOf(ctx, part, pr)) ?? undefined;
	const ref = kid(bg, 'bgRef');
	if (ref) {
		const color = ctx.colors.of(ref) ?? undefined;
		const idx = num(ref.attrs.idx);
		const style = idx >= 1001 ? ctx.ti.bgFills[idx - 1001] : idx > 0 ? ctx.ti.fills[idx - 1] : undefined;
		const f = style ? await fillOf(ctx, part, { tag: 'x', attrs: {}, kids: [style] }, color) : undefined;
		return f ?? (color ? { type: 'solid', color: color.color, alpha: color.alpha } : undefined);
	}
	return undefined;
}

// ---------- Transitions & animations ----------

function readTransition(xml: string): Transition | undefined {
	const m = /<p:transition\b[^>]*?(?:\/>|>[\s\S]*?<\/p:transition>)/.exec(xml.replace(/<mc:AlternateContent[\s\S]*?<mc:Fallback>([\s\S]*?)<\/mc:Fallback>[\s\S]*?<\/mc:AlternateContent>/g, (all, fb: string) => (/<p:transition/.test(fb) ? fb : all)));
	const choice = /<p:transition\b([^>]*)>/.exec(xml);
	if (!m) return undefined;
	const t = m[0];
	const dur = Number(/p14:dur="(\d+)"/.exec(choice?.[1] ?? '')?.[1] ?? NaN);
	const spd = /spd="(\w+)"/.exec(t)?.[1];
	const ms = Number.isFinite(dur) ? dur : spd === 'slow' ? 1000 : spd === 'med' ? 750 : 500;
	const dirAttr = /<p:\w+[^>]*\bdir="(\w+)"/.exec(t.replace(/^<p:transition[^>]*>/, ''))?.[1];
	const FROM: Record<string, 'l' | 'r' | 'u' | 'd'> = { l: 'r', r: 'l', u: 'd', d: 'u' };
	const inner = /<p:(\w+)/.exec(t.replace(/^<p:transition[^>]*>/, ''))?.[1];
	if (!inner || inner === 'transition') return /\/>$/.test(t) ? undefined : { type: 'fade', dur: ms };
	const type: Transition['type'] = inner === 'push' ? 'push' : inner === 'wipe' ? 'wipe' : inner === 'cover' || inner === 'pull' ? 'cover' : inner === 'zoom' || inner === 'newsflash' ? 'zoom' : 'fade';
	return { type, dir: type === 'push' || type === 'wipe' || type === 'cover' ? (FROM[dirAttr ?? 'l'] ?? 'r') : undefined, dur: Math.max(100, ms) };
}

function readTiming(xml: string, bySrc: Map<number, string>): { raw?: string; anims: Anim[] } {
	const m = /<p:timing>[\s\S]*<\/p:timing>/.exec(xml);
	if (!m) return { anims: [] };
	const raw = m[0];
	const t = parse(raw);
	const main = findDeep(t, (n) => n.tag === 'cTn' && n.attrs.nodeType === 'mainSeq');
	const anims: Anim[] = [];
	const clickPars = kidsOf(kid(main, 'childTnLst'), 'par');
	for (const cp of clickPars) {
		const inner = kidsOf(kid(kid(cp, 'cTn'), 'childTnLst'), 'par');
		for (const ip of inner) {
			for (const ep of kidsOf(kid(kid(ip, 'cTn'), 'childTnLst'), 'par')) {
				const ctn = kid(ep, 'cTn');
				if (!ctn || ctn.attrs.presetClass !== 'entr') continue;
				const spid = Number(findDeep(ep, (n) => n.tag === 'spTgt')?.attrs.spid);
				const el = bySrc.get(spid);
				if (!el) continue;
				const preset = Number(ctn.attrs.presetID);
				const sub = Number(ctn.attrs.presetSubtype);
				const DIR: Record<number, 'l' | 'r' | 'u' | 'd'> = { 4: 'd', 1: 'u', 8: 'l', 2: 'r' };
				const effect: AnimEffect = preset === 1 ? 'appear' : preset === 2 || preset === 3 || preset === 12 || preset === 7 ? 'fly' : preset === 22 ? 'wipe' : preset === 53 || preset === 23 || preset === 55 ? 'zoom' : 'fade';
				const durs = [...collect(ep, (n) => n.tag === 'cTn' && !!n.attrs.dur && n.attrs.dur !== 'indefinite')].map((n) => Number(n.attrs.dur)).filter((d) => d > 1);
				const dur = effect === 'appear' ? 0 : Math.max(100, ...durs, 0) || 500;
				const nodeType = ctn.attrs.nodeType;
				const trigger: Anim['trigger'] = nodeType === 'withEffect' ? 'with' : nodeType === 'afterEffect' ? 'after' : 'click';
				const delay = Number(kid(kid(ctn, 'stCondLst'), 'cond')?.attrs.delay) || 0;
				anims.push({ id: uid(), el, effect, dir: effect === 'fly' || effect === 'wipe' ? (DIR[sub] ?? 'd') : undefined, dur, delay: delay || undefined, trigger });
				const a = anims[anims.length - 1];
				if (a.dir === undefined) delete a.dir;
				if (a.delay === undefined) delete a.delay;
			}
		}
	}
	return { raw, anims };
}

function findDeep(n: N | undefined, f: (n: N) => boolean): N | undefined {
	if (!n) return undefined;
	if (f(n)) return n;
	for (const k of n.kids) {
		const r = findDeep(k, f);
		if (r) return r;
	}
	return undefined;
}
function* collect(n: N, f: (n: N) => boolean): Generator<N> {
	if (f(n)) yield n;
	for (const k of n.kids) yield* collect(k, f);
}

// ---------- Theme ----------

function readTheme(pkg: Pkg, path: string | undefined): ThemeInfo {
	const x = path ? pkg.xml(path) : undefined;
	const els = kid(x, 'themeElements');
	const cs = kid(els, 'clrScheme');
	const colors = {} as Record<ThemeColor, string>;
	const fallback: Record<ThemeColor, string> = { dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1' };
	for (const k of THEME_COLORS) {
		const n = kid(cs, k)?.kids.find((c) => c.tag !== '#text');
		colors[k] = n?.tag === 'srgbClr' ? `#${n.attrs.val.toLowerCase()}` : n?.tag === 'sysClr' ? `#${(n.attrs.lastClr ?? (k.startsWith('lt') ? 'FFFFFF' : '000000')).toLowerCase()}` : fallback[k];
	}
	const fs = kid(els, 'fontScheme');
	const major = at(fs, 'majorFont', 'latin')?.attrs.typeface || 'Calibri Light';
	const minor = at(fs, 'minorFont', 'latin')?.attrs.typeface || 'Calibri';
	const fmt = kid(els, 'fmtScheme');
	const list = (tag: string) => (kid(fmt, tag)?.kids ?? []).filter((k) => k.tag !== '#text');
	return {
		theme: { id: 'imported', name: kid(x, 'themeElements') ? (x?.attrs.name ?? 'Imported') : 'Imported', colors, fonts: { major, minor }, background: { type: 'solid', color: 'lt1' } },
		fills: list('fillStyleLst'),
		lines: list('lnStyleLst'),
		bgFills: list('bgFillStyleLst'),
		effects: list('effectStyleLst')
	};
}

// ---------- Fonts ----------

const SERIF = /serif|times|georgia|cambria|garamond|book|palatino|baskerville|didot|bodoni|minion|caslon|century|rockwell|constantia|perpetua/i;
const MONO = /mono|courier|consol|code|menlo/i;

export function replaceFont(name: string, available: (f: string) => boolean): string | null {
	if (available(name)) return null;
	const candidates = MONO.test(name) ? ['Consolas', 'Courier New', 'monospace'] : SERIF.test(name) && !/sans/i.test(name) ? ['Georgia', 'Times New Roman', 'serif'] : /light|thin/i.test(name) ? ['Segoe UI Light', 'Segoe UI', 'Arial', 'Helvetica'] : ['Segoe UI', 'Arial', 'Helvetica', 'sans-serif'];
	return candidates.find((c) => available(c)) ?? candidates[candidates.length - 1];
}

function mapFonts(doc: JSONContent | undefined, swap: Map<string, string>) {
	if (!doc) return;
	for (const m of doc.marks ?? []) if (m.type === 'textStyle' && m.attrs?.fontFamily && swap.has(m.attrs.fontFamily)) m.attrs.fontFamily = swap.get(m.attrs.fontFamily);
	for (const c of doc.content ?? []) mapFonts(c, swap);
}

// ---------- Entry ----------

const LAYOUT_KIND: Record<string, LayoutKind> = { title: 'title', obj: 'titleBody', tx: 'titleBody', secHead: 'section', twoObj: 'twoCol', twoTxTwoObj: 'twoCol', twoColTx: 'twoCol', titleOnly: 'titleOnly', blank: 'blank', objTx: 'twoCol', picTx: 'twoCol' };

export async function readPptx(bytes: Uint8Array, opts: ReadOptions): Promise<ReadResult> {
	const pkg = new Pkg(bytes);
	const rootRel = kidsOf(pkg.xml('_rels/.rels'), 'Relationship').find((r) => r.attrs.Type?.endsWith('/officeDocument'));
	const presPath = rootRel ? resolve('', rootRel.attrs.Target) : 'ppt/presentation.xml';
	const pres = pkg.xml(presPath);
	if (!pres) throw new Error('Not a presentation');
	const sz = kid(pres, 'sldSz');
	const size = { w: Math.round(px(sz?.attrs.cx ?? '12192000')), h: Math.round(px(sz?.attrs.cy ?? '6858000')) };
	const slidePaths = kidsOf(kid(pres, 'sldIdLst'), 'sldId')
		.map((s) => pkg.rel(presPath, s.attrs.id)?.target)
		.filter((p): p is string => !!p && pkg.has(p));

	const firstMaster = pkg.rel(presPath, kid(kid(pres, 'sldMasterIdLst'), 'sldMasterId')?.attrs.id)?.target ?? 'ppt/slideMasters/slideMaster1.xml';
	const ti = readTheme(pkg, pkg.relByType(firstMaster, 'theme')?.target);
	const lossy = { v: false };
	const fonts = new Set<string>();
	const media = new Map<string, string>();
	const clrMapOf = (m: N | undefined): ClrMap => {
		const a = kid(m, 'clrMap')?.attrs;
		return a ? { bg1: a.bg1 ?? 'lt1', tx1: a.tx1 ?? 'dk1', bg2: a.bg2 ?? 'lt2', tx2: a.tx2 ?? 'dk2' } : DEFAULT_MAP;
	};
	const baseColors = new Colors(ti.theme.colors, clrMapOf(pkg.xml(firstMaster)));
	const ctx0: Ctx = { pkg, part: firstMaster, colors: baseColors, ti, opts, media, lossy, fonts };
	ti.theme.background = (await bgOf(ctx0, firstMaster, pkg.xml(firstMaster))) ?? { type: 'solid', color: 'lt1' };

	const slides: Slide[] = [];
	let animsApprox = false;
	// Decorations of master/layout pairs are read once.
	const decoCache = new Map<string, El[]>();
	for (const path of slidePaths) {
		const sx = pkg.xml(path)!;
		const layoutPath = pkg.relByType(path, 'slideLayout')?.target;
		const layout = layoutPath ? pkg.xml(layoutPath) : undefined;
		const masterPath = (layoutPath && pkg.relByType(layoutPath, 'slideMaster')?.target) || firstMaster;
		const master = pkg.xml(masterPath) ?? pkg.xml(firstMaster)!;
		const colors = new Colors(ti.theme.colors, clrMapOf(master));
		const chain: Chain = { master, layout, masterPart: masterPath, layoutPart: layoutPath };
		const base: ElCtx = { ...ctx0, colors, part: path, chain, bodyCount: { n: 0 }, slideW: size.w, slideH: size.h };
		// Decorations: master shapes (unless the layout hides them) + layout shapes, placeholders excluded.
		const decoKey = `${masterPath}|${layoutPath}`;
		let deco = decoCache.get(decoKey);
		if (!deco) {
			deco = [];
			const nonPh = (root: N | undefined): N => ({ tag: 'spTree', attrs: {}, kids: root ? spTreeShapes(root).filter((s) => !phOf(s)) : [] });
			if (layout?.attrs.showMasterSp !== '0') deco.push(...(await readTree({ ...base, part: masterPath, chain: undefined, locked: true }, nonPh(master), identity)));
			if (layout) deco.push(...(await readTree({ ...base, part: layoutPath!, chain: undefined, locked: true }, nonPh(layout), identity)));
			decoCache.set(decoKey, deco);
		}
		const tree = at(sx, 'cSld', 'spTree');
		const own = sx.attrs.showMasterSp === '0' ? [] : deco.map((d) => ({ ...structuredClone(d), id: uid() }));
		const elements = [...own, ...(tree ? await readTree(base, tree, identity) : [])];
		const background = (await bgOf(base, path, sx)) ?? (layout ? await bgOf({ ...base, part: layoutPath! }, layoutPath!, layout) : undefined);
		// Notes
		let notes = '';
		const notesPath = pkg.relByType(path, 'notesSlide')?.target;
		if (notesPath) {
			const nx = pkg.xml(notesPath);
			const body = (nx ? spTreeShapes(nx) : []).find((s) => phOf(s)?.type === 'body');
			notes = kidsOf(kid(body, 'txBody'), 'p')
				.map((p) => p.kids.map((r) => (r.tag === 'r' || r.tag === 'fld' ? textIn(kid(r, 't')) : r.tag === 'br' ? '\n' : '')).join(''))
				.join('\n')
				.trim();
		}
		const xml = pkg.str(path);
		const bySrc = new Map<number, string>();
		for (const e of elements) if (e.srcId) bySrc.set(e.srcId, e.id);
		const { raw, anims } = readTiming(xml, bySrc);
		if (raw && (anims.length || /presetClass="(exit|emph|path)"/.test(raw))) animsApprox = true;
		const lay = layout?.attrs.type;
		const hasBody = elements.some((e) => e.kind === 'shape' && (e.ph === 'body' || e.ph === 'body2'));
		const slide: Slide = {
			id: uid(),
			layout: (lay ? LAYOUT_KIND[lay] : undefined) ?? (hasBody ? 'titleBody' : elements.some((e) => e.kind === 'shape' && e.ph === 'title') ? 'titleOnly' : 'blank'),
			background: background && JSON.stringify(background) !== JSON.stringify(ti.theme.background) ? background : undefined,
			elements,
			notes,
			hidden: sx.attrs.show === '0' || undefined,
			transition: readTransition(xml),
			anims: anims.length ? anims : undefined,
			timingXml: raw,
			animsFrom: raw ? JSON.stringify(anims.length ? anims : []) : undefined
		};
		for (const k of Object.keys(slide) as (keyof Slide)[]) if (slide[k] === undefined) delete slide[k];
		slides.push(slide);
	}
	if (!slides.length) throw new Error('No slides');

	// Fonts missing on this device → closest available family (theme fonts and run marks).
	const fontsReplaced: string[] = [];
	if (opts.fontAvailable) {
		const swap = new Map<string, string>();
		for (const f of new Set([ti.theme.fonts.major, ti.theme.fonts.minor, ...fonts])) {
			const r = replaceFont(f, opts.fontAvailable);
			if (r) {
				swap.set(f, r);
				fontsReplaced.push(`${f} → ${r}`);
			}
		}
		if (swap.size) {
			ti.theme.fonts = { major: swap.get(ti.theme.fonts.major) ?? ti.theme.fonts.major, minor: swap.get(ti.theme.fonts.minor) ?? ti.theme.fonts.minor };
			for (const s of slides)
				for (const e of s.elements) {
					if (e.kind === 'shape') {
						if (swap.has(e.textStyle.font)) e.textStyle.font = swap.get(e.textStyle.font)!;
						mapFonts(e.text, swap);
					} else if (e.kind === 'table') {
						if (swap.has(e.textStyle.font)) e.textStyle.font = swap.get(e.textStyle.font)!;
						for (const c of e.cells.flat()) mapFonts(c.text, swap);
					}
				}
		}
	}
	const content: SlidesContent = { v: 1, size, theme: ti.theme, slides };
	return { content, lossy: lossy.v, fontsReplaced, animsApprox };
}
