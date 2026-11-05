// .pptx writer (own OOXML, no pptxgenjs): theme, one slide master, 6 layouts with placeholders, slides with
// shapes (preset/custom geometry, solid/gradient/picture fill, line, shadow, rich text), pictures, tables,
// native charts (+ embedded workbook), video/audio, icons (PNG + SVG), notes, transitions and entrance
// animations. Part order and element order follow the PresentationML schema so PowerPoint opens the file
// without repair. Imported animations (opaque <p:timing>) are written back unchanged while they still match.
import type { JSONContent } from '@tiptap/core';
import { strToU8, zipSync } from 'fflate';
import { layoutBoxes } from '../layouts.ts';
import {
	EMU,
	LAYOUTS,
	THEME_COLORS,
	animSteps,
	resolveFont,
	textOf,
	type Anim,
	type ChartEl,
	type Color,
	type CustomPath,
	type El,
	type Fill,
	type IconEl,
	type ImageEl,
	type LayoutKind,
	type Line,
	type MediaEl,
	type Placeholder,
	type Shadow,
	type ShapeEl,
	type Slide,
	type SlidesContent,
	type TableEl,
	type TextBase,
	type Theme
} from '../model.ts';
import { iconSvg } from '../icons.ts';
import { mediaPosterPng, TRANSPARENT_PNG } from './png.ts';
import { chartXml } from '../../sheets/io/xlsx-charts.ts';
import type { ChartObject } from '../../sheets/model.ts';
import { owner } from '../table.ts';

export type PptxImage = { data: Uint8Array; extension: 'png' | 'jpeg' | 'gif' };
export type LoadImage = (blobId: string) => Promise<PptxImage | null>;
export type WriteOptions = {
	title?: string;
	lang?: string;
	/** Raw bytes of a media/SVG blob. */
	loadBlob?: (blobId: string) => Promise<Uint8Array | null>;
	/** PNG of an icon (browser canvas); without it a transparent PNG goes next to the SVG. */
	renderIcon?: (el: IconEl, svg: string) => Promise<Uint8Array | null>;
};

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument';
const URI_CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const URI_TABLE = 'http://schemas.openxmlformats.org/drawingml/2006/table';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const emu = (px: number) => Math.round(px * EMU);
const hex = (c: string) => c.replace('#', '').toUpperCase().padStart(6, '0').slice(-6);

type Rel = { id: string; type: string; target: string; external?: boolean };
const relType = (t: string) => (t.startsWith('http') ? t : `${R}/${t}`);
const rels = (list: Rel[]) =>
	`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${r.id}" Type="${relType(r.type)}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

/** Color → DrawingML: theme roles as schemeClr (stay linked to the theme), hex as srgbClr. */
function clr(c: Color | undefined, alpha?: number) {
	const a = alpha !== undefined && alpha < 1 ? `<a:alpha val="${Math.round(Math.max(0, alpha) * 100000)}"/>` : '';
	if (!c) return `<a:srgbClr val="000000">${a}</a:srgbClr>`;
	if (c.startsWith('#') || c.startsWith('rgb')) return `<a:srgbClr val="${hex(toHex(c))}">${a}</a:srgbClr>`;
	return `<a:schemeClr val="${c}">${a}</a:schemeClr>`;
}

/** Rel ids of pictures used as fills (resolved by the slide writer). */
type Embed = (blobId: string) => string | null;

function fillXml(f: Fill | undefined, embed?: Embed, bg = false) {
	if (!f || f.type === 'none') return '<a:noFill/>';
	if (f.type === 'solid') return `<a:solidFill>${clr(f.color, f.alpha)}</a:solidFill>`;
	if (f.type === 'gradient') {
		const gs = [...f.stops]
			.sort((a, b) => a.pos - b.pos)
			.map((s) => `<a:gs pos="${Math.round(Math.max(0, Math.min(1, s.pos)) * 100000)}">${clr(s.color, s.alpha)}</a:gs>`)
			.join('');
		const shade = f.kind === 'radial' ? '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>' : `<a:lin ang="${Math.round((((f.angle % 360) + 360) % 360) * 60000)}" scaled="0"/>`;
		return `<a:gradFill rotWithShape="1"><a:gsLst>${gs}</a:gsLst>${shade}</a:gradFill>`;
	}
	const rid = embed?.(f.blobId);
	if (!rid) return '<a:noFill/>';
	return `<a:blipFill${bg ? ' dpi="0" rotWithShape="1"' : ''}><a:blip r:embed="${rid}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;
}

const lineXml = (l: Line, tag = 'a:ln') =>
	!l ? `<${tag}><a:noFill/></${tag}>` : `<${tag} w="${emu(l.width)}"><a:solidFill>${clr(l.color)}</a:solidFill>${l.dash && l.dash !== 'solid' ? `<a:prstDash val="${l.dash === 'dot' ? 'sysDot' : 'dash'}"/>` : ''}</${tag}>`;

const shadowXml = (s?: Shadow) =>
	s ? `<a:effectLst><a:outerShdw blurRad="${emu(s.blur)}" dist="${emu(s.dist)}" dir="${Math.round((((s.dir % 360) + 360) % 360) * 60000)}" algn="ctr" rotWithShape="0">${clr(s.color, s.alpha)}</a:outerShdw></a:effectLst>` : '';

const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

// ---------- Text ----------

type Run = { text: string; marks: NonNullable<JSONContent['marks']> };
type Para = { runs: Run[]; align?: string; list?: { kind: 'bullet' | 'ordered'; level: number } };

function paragraphs(doc: JSONContent | undefined): Para[] {
	const out: Para[] = [];
	const inline = (n: JSONContent, marks: Run['marks'] = []): Run[] => {
		if (n.type === 'text') return [{ text: n.text ?? '', marks: [...marks, ...(n.marks ?? [])] }];
		if (n.type === 'hardBreak') return [{ text: '\n', marks }];
		return (n.content ?? []).flatMap((c) => inline(c, marks));
	};
	const walk = (n: JSONContent, list?: Para['list']) => {
		if (n.type === 'paragraph' || n.type === 'heading') {
			out.push({ runs: inline(n), align: n.attrs?.textAlign ?? undefined, list });
			return;
		}
		if (n.type === 'bulletList' || n.type === 'orderedList') {
			const kind = n.type === 'bulletList' ? 'bullet' : 'ordered';
			const level = list ? list.level + 1 : 0;
			for (const item of n.content ?? []) for (const c of item.content ?? []) walk(c, { kind, level });
			return;
		}
		for (const c of n.content ?? []) walk(c, list);
	};
	if (doc) walk(doc);
	return out;
}

const ALGN: Record<string, string> = { left: 'l', center: 'ctr', right: 'r', justify: 'just' };

function sizePt(v: unknown): number | undefined {
	const m = /^([\d.]+)\s*(pt|px)?$/.exec(String(v ?? '').trim());
	if (!m) return undefined;
	const n = Number(m[1]);
	return m[2] === 'px' ? (n * 72) / 96 : n;
}

function runXml(r: Run, base: TextBase, theme: Theme, lang: string) {
	let b = !!base.bold;
	let i = false;
	let u = false;
	let s = false;
	let color: Color = base.color;
	let font = resolveFont(theme, base.font);
	let size = base.size;
	let hl: string | undefined;
	let href: string | undefined;
	for (const m of r.marks) {
		if (m.type === 'bold') b = true;
		else if (m.type === 'italic') i = true;
		else if (m.type === 'underline') u = true;
		else if (m.type === 'strike') s = true;
		else if (m.type === 'highlight') hl = String(m.attrs?.color ?? '#ffff00');
		else if (m.type === 'link' && m.attrs?.href) href = String(m.attrs.href);
		else if (m.type === 'textStyle') {
			if (m.attrs?.color) color = String(m.attrs.color);
			if (m.attrs?.fontFamily) font = String(m.attrs.fontFamily).split(',')[0].replace(/["']/g, '').trim();
			const p = sizePt(m.attrs?.fontSize);
			if (p) size = p;
		}
	}
	void href;
	const attrs = `lang="${lang}" sz="${Math.round(size * 100)}"${b ? ' b="1"' : ' b="0"'}${i ? ' i="1"' : ''}${u ? ' u="sng"' : ''}${s ? ' strike="sngStrike"' : ''} dirty="0"`;
	const props = `<a:solidFill>${clr(color)}</a:solidFill>${hl ? `<a:highlight>${clr(toHex(hl))}</a:highlight>` : ''}<a:latin typeface="${esc(font)}"/><a:cs typeface="${esc(font)}"/>`;
	return r.text
		.split('\n')
		.map((t, k) => `${k ? `<a:br><a:rPr ${attrs}/></a:br>` : ''}${t ? `<a:r><a:rPr ${attrs}>${props}</a:rPr><a:t>${esc(t)}</a:t></a:r>` : ''}`)
		.join('');
}

function toHex(c: string) {
	if (c.startsWith('#')) return c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
	const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
	return m ? `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : c;
}

function parasXml(doc: JSONContent | undefined, style: TextBase, theme: Theme, lang: string) {
	const paras = paragraphs(doc);
	return (paras.length ? paras : [{ runs: [] } as Para])
		.map((p) => {
			const algn = ALGN[p.align ?? style.align ?? 'left'] ?? 'l';
			let ppr: string;
			if (p.list) {
				const marL = emu(28 + p.list.level * 28);
				const bu = p.list.kind === 'bullet' ? `<a:buFont typeface="Arial"/><a:buChar char="${p.list.level % 2 ? '–' : '•'}"/>` : `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>`;
				ppr = `<a:pPr marL="${marL}" lvl="${Math.min(8, p.list.level)}" indent="${-emu(22)}" algn="${algn}">${bu}</a:pPr>`;
			} else ppr = `<a:pPr marL="0" indent="0" algn="${algn}"><a:buNone/></a:pPr>`;
			const runs = p.runs.map((r) => runXml(r, style, theme, lang)).join('');
			return `<a:p>${ppr}${runs}<a:endParaRPr lang="${lang}" sz="${Math.round(style.size * 100)}" dirty="0"/></a:p>`;
		})
		.join('');
}

function txBody(el: ShapeEl, theme: Theme, lang: string) {
	const anchor = el.anchor === 'middle' ? 'ctr' : el.anchor === 'bottom' ? 'b' : 't';
	const ins = emu(el.inset);
	return `<p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${anchor}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${parasXml(el.text, el.textStyle, theme, lang)}</p:txBody>`;
}

// ---------- Placeholders / layouts ----------

const PH: Record<Placeholder, (layout: LayoutKind) => string> = {
	title: (l) => `<p:ph type="${l === 'title' ? 'ctrTitle' : 'title'}"/>`,
	subtitle: (l) => (l === 'title' ? '<p:ph type="subTitle" idx="1"/>' : '<p:ph type="body" idx="1"/>'),
	body: () => '<p:ph idx="1"/>',
	body2: () => '<p:ph idx="2"/>'
};
const LAYOUT_TYPE: Record<LayoutKind, string> = { title: 'title', titleBody: 'obj', section: 'secHead', twoCol: 'twoObj', titleOnly: 'titleOnly', blank: 'blank' };
const LAYOUT_NAME: Record<LayoutKind, string> = { title: 'Title Slide', titleBody: 'Title and Content', section: 'Section Header', twoCol: 'Two Content', titleOnly: 'Title Only', blank: 'Blank' };
const PH_NAME: Record<Placeholder, string> = { title: 'Title', subtitle: 'Subtitle', body: 'Content Placeholder', body2: 'Content Placeholder' };

const off = (e: { x: number; y: number; w: number; h: number }) => `<a:off x="${emu(e.x)}" y="${emu(e.y)}"/><a:ext cx="${emu(Math.max(1, e.w))}" cy="${emu(Math.max(1, e.h))}"/>`;
const xfrm = (e: { x: number; y: number; w: number; h: number; rot?: number; flipH?: boolean; flipV?: boolean }, tag = 'a:xfrm') =>
	`<${tag}${e.rot ? ` rot="${Math.round(e.rot * 60000)}"` : ''}${e.flipH ? ' flipH="1"' : ''}${e.flipV ? ' flipV="1"' : ''}>${off(e)}</${tag}>`;

function themeXml(t: Theme) {
	const c = t.colors;
	const sys = (k: (typeof THEME_COLORS)[number]) => `<a:srgbClr val="${hex(c[k])}"/>`;
	const font = (f: string) => `<a:latin typeface="${esc(f)}"/><a:ea typeface=""/><a:cs typeface=""/>`;
	const solid = (mod = '') => `<a:solidFill><a:schemeClr val="phClr">${mod}</a:schemeClr></a:solidFill>`;
	return (
		`${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${esc(t.name)}"><a:themeElements>` +
		`<a:clrScheme name="${esc(t.name)}"><a:dk1>${sys('dk1')}</a:dk1><a:lt1>${sys('lt1')}</a:lt1><a:dk2>${sys('dk2')}</a:dk2><a:lt2>${sys('lt2')}</a:lt2>` +
		['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((k) => `<a:${k}>${sys(k as 'accent1')}</a:${k}>`).join('') +
		`<a:hlink>${sys('hlink')}</a:hlink><a:folHlink>${sys('dk2')}</a:folHlink></a:clrScheme>` +
		`<a:fontScheme name="${esc(t.name)}"><a:majorFont>${font(t.fonts.major)}</a:majorFont><a:minorFont>${font(t.fonts.minor)}</a:minorFont></a:fontScheme>` +
		`<a:fmtScheme name="${esc(t.name)}"><a:fillStyleLst>${solid()}${solid('<a:tint val="50000"/>')}${solid('<a:shade val="80000"/>')}</a:fillStyleLst>` +
		`<a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solid()}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`).join('')}</a:lnStyleLst>` +
		`<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
		`<a:bgFillStyleLst>${solid()}${solid('<a:tint val="95000"/>')}${solid('<a:shade val="90000"/>')}</a:bgFillStyleLst></a:fmtScheme>` +
		`</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
	);
}

const CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

const lvl = (n: number, sz: number, extra = '') => `<a:lvl${n}pPr marL="0" indent="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${extra}<a:defRPr sz="${sz}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`;

function phShape(id: number, role: Placeholder, layout: LayoutKind, box: { x: number; y: number; w: number; h: number }) {
	return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${PH_NAME[role]} ${id - 1}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${PH[role](layout)}</p:nvPr></p:nvSpPr><p:spPr>${xfrm(box)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
}

function masterXml(c: SlidesContent, bgFill: string) {
	const { w, h } = c.size;
	const tb = layoutBoxes('titleBody', w, h);
	const titleStyle = `<p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>`;
	const bodyStyle = `<p:bodyStyle>${[1, 2, 3].map((n) => lvl(n, 2200 - (n - 1) * 200, '<a:buNone/>')).join('')}</p:bodyStyle>`;
	const otherStyle = `<p:otherStyle>${lvl(1, 1800)}</p:otherStyle>`;
	return (
		`${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr>${bgFill}<a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}` +
		`${phShape(2, 'title', 'titleBody', tb.title!)}${phShape(3, 'body', 'titleBody', tb.body!)}` +
		`</p:spTree></p:cSld>${CLRMAP}<p:sldLayoutIdLst>${LAYOUTS.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldLayoutIdLst>` +
		`<p:txStyles>${titleStyle}${bodyStyle}${otherStyle}</p:txStyles></p:sldMaster>`
	);
}

function layoutXml(c: SlidesContent, kind: LayoutKind) {
	const boxes = layoutBoxes(kind, c.size.w, c.size.h);
	let id = 2;
	const shapes = (Object.entries(boxes) as [Placeholder, { x: number; y: number; w: number; h: number }][]).map(([role, box]) => phShape(id++, role, kind, box)).join('');
	return `${XML}<p:sldLayout ${NS} type="${LAYOUT_TYPE[kind]}" preserve="1"><p:cSld name="${LAYOUT_NAME[kind]}"><p:spTree>${GRP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function notesMasterXml() {
	return (
		`${XML}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}` +
		`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr></p:sp>` +
		`<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>` +
		`</p:spTree></p:cSld>${CLRMAP}<p:notesStyle>${lvl(1, 1200)}</p:notesStyle></p:notesMaster>`
	);
}

function notesXml(text: string, lang: string) {
	const paras = text.split('\n').map((l) => `<a:p>${l ? `<a:r><a:rPr lang="${lang}" dirty="0"/><a:t>${esc(l)}</a:t></a:r>` : ''}</a:p>`).join('');
	return (
		`${XML}<p:notes ${NS}><p:cSld><p:spTree>${GRP}` +
		`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
		`<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras || '<a:p/>'}</p:txBody></p:sp>` +
		`</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
	);
}

// ---------- Elements ----------

const LINE_GEOMS = new Set(['line', 'straightConnector1', 'bentConnector3']);

/** Absolute M/L/C/Q/Z path → DrawingML path commands (EMU). */
export function custPathXml(p: CustomPath) {
	const tokens = p.d.match(/[MLCQZ]|-?[\d.]+(?:e-?\d+)?/g) ?? [];
	let out = '';
	let i = 0;
	const num = () => emu(Number(tokens[i++] ?? 0));
	const pt = () => {
		const x = num();
		const y = num();
		return `<a:pt x="${x}" y="${y}"/>`;
	};
	while (i < tokens.length) {
		const cmd = tokens[i++];
		if (cmd === 'M') out += `<a:moveTo>${pt()}</a:moveTo>`;
		else if (cmd === 'L') out += `<a:lnTo>${pt()}</a:lnTo>`;
		else if (cmd === 'C') out += `<a:cubicBezTo>${pt()}${pt()}${pt()}</a:cubicBezTo>`;
		else if (cmd === 'Q') out += `<a:quadBezTo>${pt()}${pt()}</a:quadBezTo>`;
		else if (cmd === 'Z') out += '<a:close/>';
	}
	return `<a:path w="${emu(p.w)}" h="${emu(p.h)}"${p.fill === false ? ' fill="none"' : ''}${p.stroke === false ? ' stroke="0"' : ''}>${out}</a:path>`;
}

function geomXml(el: ShapeEl) {
	if (el.geom === 'custom' && el.paths?.length) return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${el.paths.map(custPathXml).join('')}</a:pathLst></a:custGeom>`;
	return `<a:prstGeom prst="${/^[a-zA-Z0-9]+$/.test(el.geom) && el.geom !== 'custom' ? el.geom : 'rect'}"><a:avLst/></a:prstGeom>`;
}

function shapeXml(el: ShapeEl, id: number, layout: LayoutKind, theme: Theme, lang: string, embed: Embed) {
	const name = el.name ?? (el.ph ? `${PH_NAME[el.ph]} ${id - 1}` : el.textbox ? `TextBox ${id - 1}` : `Shape ${id - 1}`);
	const isLine = LINE_GEOMS.has(el.geom);
	if (isLine)
		return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(el)}<a:prstGeom prst="${el.geom === 'line' ? 'line' : el.geom}"><a:avLst/></a:prstGeom><a:noFill/>${lineXml(el.line ?? { color: 'dk1', width: 2 })}${shadowXml(el.shadow)}</p:spPr></p:cxnSp>`;
	const nv = el.ph ? `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${PH[el.ph](layout)}</p:nvPr>` : `<p:cNvSpPr${el.textbox ? ' txBox="1"' : ''}/><p:nvPr/>`;
	return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/>${nv}</p:nvSpPr><p:spPr>${xfrm(el)}${geomXml(el)}${fillXml(el.fill, embed)}${lineXml(el.line)}${shadowXml(el.shadow)}</p:spPr>${txBody(el, theme, lang)}</p:sp>`;
}

function picXml(el: ImageEl, id: number, rid: string, svgRid?: string) {
	const c = el.crop;
	const src = c ? `<a:srcRect l="${Math.round(c.l * 100000)}" t="${Math.round(c.t * 100000)}" r="${Math.round(c.r * 100000)}" b="${Math.round(c.b * 100000)}"/>` : '';
	const svg = svgRid ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svgRid}"/></a:ext></a:extLst>` : '';
	return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(el.name ?? `Picture ${id - 1}`)}" descr="${esc(el.alt ?? '')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}">${svg}</a:blip>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>${shadowXml(el.shadow)}</p:spPr></p:pic>`;
}

function mediaXml(el: MediaEl, id: number, rids: { link: string; media: string; poster: string }) {
	const file = el.media === 'video' ? `<a:videoFile r:link="${rids.link}"/>` : `<a:audioFile r:link="${rids.link}"/>`;
	return (
		`<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(el.fileName ?? el.name ?? `Media ${id - 1}`)}"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
		`<p:nvPr>${file}<p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="${rids.media}"/></p:ext></p:extLst></p:nvPr></p:nvPicPr>` +
		`<p:blipFill><a:blip r:embed="${rids.poster}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
	);
}

function frameXml(el: El, id: number, uri: string, inner: string, name: string) {
	return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${esc(el.name ?? name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm({ ...el, rot: 0, flipH: false, flipV: false }, 'p:xfrm')}<a:graphic><a:graphicData uri="${uri}">${inner}</a:graphicData></a:graphic></p:graphicFrame>`;
}

function tableXml(el: TableEl, theme: Theme, lang: string, embed: Embed) {
	const sum = el.rows.reduce((n, v) => n + v, 0) || 1;
	const kh = el.h / sum;
	const header: TextBase = { ...el.textStyle, color: 'lt1', bold: true };
	const border = (tag: string) => lineXml(el.border, tag);
	const rows = el.rows
		.map((h, r) => {
			const tcs = el.cols
				.map((_, c) => {
					const cell = el.cells[r]?.[c] ?? {};
					let attrs = '';
					if (cell.hidden) {
						// Covered cell: hMerge right of the block's first column, vMerge below its first row.
						const o = owner(el, r, c);
						attrs = `${c > o.c ? ' hMerge="1"' : ''}${r > o.r ? ' vMerge="1"' : ''}` || ' hMerge="1"';
					} else {
						if ((cell.colSpan ?? 1) > 1) attrs += ` gridSpan="${cell.colSpan}"`;
						if ((cell.rowSpan ?? 1) > 1) attrs += ` rowSpan="${cell.rowSpan}"`;
					}
					const style = el.firstRow && r === 0 ? header : el.textStyle;
					const fill = cell.fill ? fillXml(cell.fill, embed) : el.firstRow && r === 0 ? '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>' : el.bandRow && r % 2 === (el.firstRow ? 1 : 0) ? '<a:solidFill><a:schemeClr val="accent1"><a:alpha val="12000"/></a:schemeClr></a:solidFill>' : '<a:noFill/>';
					const anchor = cell.anchor === 'middle' ? ' anchor="ctr"' : cell.anchor === 'bottom' ? ' anchor="b"' : '';
					return `<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/>${parasXml(cell.hidden ? undefined : cell.text, style, theme, lang)}</a:txBody><a:tcPr marL="${emu(6)}" marR="${emu(6)}" marT="${emu(4)}" marB="${emu(4)}"${anchor}>${border('a:lnL')}${border('a:lnR')}${border('a:lnT')}${border('a:lnB')}${fill}</a:tcPr></a:tc>`;
				})
				.join('');
			return `<a:tr h="${emu(h * kh)}">${tcs}</a:tr>`;
		})
		.join('');
	return `<a:tbl><a:tblPr${el.firstRow ? ' firstRow="1"' : ''}${el.bandRow ? ' bandRow="1"' : ''}/><a:tblGrid>${el.cols.map((w) => `<a:gridCol w="${emu(w)}"/>`).join('')}</a:tblGrid>${rows}</a:tbl>`;
}

// ---------- Charts ----------

async function chartParts(el: ChartEl): Promise<{ xml: string; xlsx: Uint8Array }> {
	const d = el.data;
	const n = d.labels.length;
	const scatterXs = el.options.type === 'scatter' && d.xs && d.xs.length;
	const col = (k: number) => String.fromCharCode(66 + k); // B, C, …
	const sers = d.series.map((s, k) => ({
		name: { f: `Sheet1!$${col(k)}$1`, v: s.name },
		cat: scatterXs ? { f: `Sheet1!$A$2:$A$${n + 1}`, v: (d.xs ?? []).map((x) => (x === null ? '' : String(x))), num: true } : { f: `Sheet1!$A$2:$A$${n + 1}`, v: d.labels, num: false },
		val: { f: `Sheet1!$${col(k)}$2:$${col(k)}$${n + 1}`, v: s.values }
	}));
	const ch = { ...el.options, id: el.id, kind: 'chart', source: { range: '', seriesIn: 'cols', headerRow: true, headerCol: true }, anchor: { r: 0, c: 0, dx: 0, dy: 0 }, w: el.w, h: el.h } as unknown as ChartObject;
	const xml = chartXml(ch, sers).replace('</c:chartSpace>', '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>');
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Sheet1');
	ws.addRow(['', ...d.series.map((s) => s.name)]);
	for (let i = 0; i < n; i++) ws.addRow([scatterXs ? (d.xs?.[i] ?? null) : d.labels[i], ...d.series.map((s) => s.values[i] ?? null)]);
	const buf = await wb.xlsx.writeBuffer();
	return { xml, xlsx: new Uint8Array(buf as ArrayBuffer) };
}

// ---------- Transitions & timing ----------

/** Our "from" direction → the direction PowerPoint transitions move to. */
const MOVE: Record<string, string> = { l: 'r', r: 'l', u: 'd', d: 'u' };

function transitionXml(s: Slide) {
	const t = s.transition;
	if (!t || t.type === 'none') return '';
	const spd = t.dur <= 500 ? 'fast' : t.dur <= 1000 ? 'med' : 'slow';
	const dir = MOVE[t.dir ?? 'r'] ?? 'l';
	const child = t.type === 'fade' ? '<p:fade/>' : t.type === 'push' ? `<p:push dir="${dir}"/>` : t.type === 'wipe' ? `<p:wipe dir="${dir}"/>` : t.type === 'cover' ? `<p:cover dir="${dir}"/>` : '<p:zoom/>';
	return `<p:transition spd="${spd}">${child}</p:transition>`;
}

const FLY_SUB: Record<string, number> = { d: 4, u: 1, l: 8, r: 2 };
const WIPE_FILTER: Record<string, string> = { d: 'wipe(up)', u: 'wipe(down)', l: 'wipe(right)', r: 'wipe(left)' };

type ElKind = 'sp' | 'pic' | 'frame';

function timingXml(s: Slide, spid: (elId: string) => number | undefined, kinds: Map<string, ElKind>, media: { id: number; autoplay: boolean; kind: 'video' | 'audio' }[]) {
	const anims = (s.anims ?? []).filter((a) => spid(a.el) !== undefined);
	if (!anims.length && !media.length) return '';
	let n = 2;
	const next = () => ++n;
	const tgt = (id: number) => `<p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl>`;
	const set = (id: number) => `<p:set><p:cBhvr><p:cTn id="${next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${tgt(id)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;
	const anim = (id: number, attr: string, from: string, to: string, dur: number) =>
		`<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${next()}" dur="${dur}" fill="hold"/>${tgt(id)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
	const effect = (id: number, filter: string, dur: number) => `<p:animEffect transition="in" filter="${filter}"><p:cBhvr><p:cTn id="${next()}" dur="${dur}"/>${tgt(id)}</p:cBhvr></p:animEffect>`;

	function effectPar(a: Anim, nodeType: string) {
		const id = spid(a.el)!;
		const d = a.dir ?? 'd';
		const dur = Math.max(1, a.dur);
		const head = (preset: number, sub: number) => `<p:par><p:cTn id="${next()}" presetID="${preset}" presetClass="entr" presetSubtype="${sub}" fill="hold"${kinds.get(a.el) === 'sp' ? ' grpId="0"' : kinds.get(a.el) === 'frame' ? ' grpId="0"' : ''} nodeType="${nodeType}"><p:stCondLst><p:cond delay="${a.delay ?? 0}"/></p:stCondLst><p:childTnLst>`;
		const tail = '</p:childTnLst></p:cTn></p:par>';
		if (a.effect === 'appear') return `${head(1, 0)}${set(id)}${tail}`;
		if (a.effect === 'fade') return `${head(10, 0)}${set(id)}${effect(id, 'fade', dur)}${tail}`;
		if (a.effect === 'wipe') return `${head(22, FLY_SUB[d])}${set(id)}${effect(id, WIPE_FILTER[d], dur)}${tail}`;
		if (a.effect === 'zoom') return `${head(53, 16)}${set(id)}${anim(id, 'ppt_w', '0', '#ppt_w', dur)}${anim(id, 'ppt_h', '0', '#ppt_h', dur)}${effect(id, 'fade', dur)}${tail}`;
		// fly
		const x = d === 'l' ? anim(id, 'ppt_x', '0-#ppt_w/2', '#ppt_x', dur) : d === 'r' ? anim(id, 'ppt_x', '1+#ppt_w/2', '#ppt_x', dur) : anim(id, 'ppt_x', '#ppt_x', '#ppt_x', dur);
		const y = d === 'u' ? anim(id, 'ppt_y', '0-#ppt_h/2', '#ppt_y', dur) : d === 'd' ? anim(id, 'ppt_y', '1+#ppt_h/2', '#ppt_y', dur) : anim(id, 'ppt_y', '#ppt_y', '#ppt_y', dur);
		return `${head(2, FLY_SUB[d])}${set(id)}${x}${y}${tail}`;
	}

	const { stepOf } = animSteps({ anims });
	const steps: Anim[][] = [];
	for (const a of anims) (steps[(stepOf.get(a.id) ?? 1) - 1] ??= []).push(a);
	const autoplay = media.filter((m) => m.autoplay);
	const clickPars: string[] = [];
	if (autoplay.length) {
		// Media that starts with the slide: an after-effect par triggered when the main sequence begins.
		const cmds = autoplay
			.map((m) => `<p:par><p:cTn id="${next()}" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="${next()}" dur="1" fill="hold"/>${tgt(m.id)}</p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par>`)
			.join('');
		clickPars.push(`<p:par><p:cTn id="${next()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst><p:par><p:cTn id="${next()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${cmds}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`);
	}
	for (const group of steps) {
		if (!group) continue;
		// Inner pars: a new one at every 'after' effect, starting when the previous ends.
		const inner: { delay: number; items: string[] }[] = [];
		let start = 0;
		let end = 0;
		group.forEach((a, i) => {
			if (i === 0 || a.trigger === 'after') {
				if (i > 0) start = end;
				inner.push({ delay: start, items: [] });
			}
			const nodeType = i === 0 ? (a.trigger === 'after' ? 'afterEffect' : a.trigger === 'with' ? 'withEffect' : 'clickEffect') : a.trigger === 'after' ? 'afterEffect' : 'withEffect';
			inner[inner.length - 1].items.push(effectPar(a, nodeType));
			end = Math.max(end, start + (a.delay ?? 0) + (a.effect === 'appear' ? 0 : a.dur));
		});
		const outerId = next();
		const innerXml = inner.map((p) => `<p:par><p:cTn id="${next()}" fill="hold"><p:stCondLst><p:cond delay="${p.delay}"/></p:stCondLst><p:childTnLst>${p.items.join('')}</p:childTnLst></p:cTn></p:par>`).join('');
		clickPars.push(`<p:par><p:cTn id="${outerId}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>${innerXml}</p:childTnLst></p:cTn></p:par>`);
	}
	const mainSeq = clickPars.length
		? `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clickPars.join('')}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`
		: '';
	const mediaNodes = media
		.map((m) => `<p:${m.kind}><p:cMediaNode vol="80000"><p:cTn id="${next()}" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn>${tgt(m.id)}</p:cMediaNode></p:${m.kind}>`)
		.join('');
	const built = [...new Set(anims.map((a) => a.el))];
	const bld = built
		.map((el) => (kinds.get(el) === 'sp' ? `<p:bldP spid="${spid(el)}" grpId="0" animBg="1"/>` : kinds.get(el) === 'frame' ? `<p:bldGraphic spid="${spid(el)}" grpId="0"><p:bldAsOne/></p:bldGraphic>` : ''))
		.join('');
	// mainSeq must have id 2 (the autoplay condition refers to it); when there is none, ids still start at 2.
	return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${mainSeq}${mediaNodes}</p:childTnLst></p:cTn></p:par></p:tnLst>${bld ? `<p:bldLst>${bld}</p:bldLst>` : ''}</p:timing>`;
}

/** Imported timing is reused only while the anims are untouched and every target shape still exists. */
function rawTiming(s: Slide, ids: Set<number>) {
	if (!s.timingXml || s.animsFrom !== JSON.stringify(s.anims ?? [])) return null;
	for (const m of s.timingXml.matchAll(/spid="(\d+)"/g)) if (!ids.has(Number(m[1]))) return null;
	return s.timingXml;
}

// ---------- Package ----------

const MEDIA_EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'video/ogg': 'ogv' };
const MEDIA_CT: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac' };

export async function writePptx(c: SlidesContent, loadImage: LoadImage, opts: WriteOptions = {}): Promise<Uint8Array> {
	const lang = opts.lang === 'es' ? 'es-ES' : 'en-US';
	const files: Record<string, Uint8Array> = {};
	const put = (path: string, s: string) => (files[path] = strToU8(s));
	const overrides: [string, string][] = [];
	const defaults = new Map<string, string>();
	const imageFiles = new Map<string, string>(); // blobId → media file name
	let mediaN = 0;

	async function imageFile(blobId: string): Promise<string | null> {
		const hit = imageFiles.get(blobId);
		if (hit) return hit;
		const img = await loadImage(blobId);
		if (!img) return null;
		const ext = img.extension === 'jpeg' ? 'jpeg' : img.extension;
		const file = `image${++mediaN}.${ext}`;
		files[`ppt/media/${file}`] = img.data;
		defaults.set(ext, `image/${ext}`);
		imageFiles.set(blobId, file);
		return file;
	}
	function rawFile(data: Uint8Array, ext: string, ct: string, base = 'media') {
		const file = `${base}${++mediaN}.${ext}`;
		files[`ppt/media/${file}`] = data;
		defaults.set(ext, ct);
		return file;
	}

	// Master background (theme background, may be a picture).
	const masterRels: Rel[] = [...LAYOUTS.map((_, i) => ({ id: `rId${i + 1}`, type: 'slideLayout', target: `../slideLayouts/slideLayout${i + 1}.xml` })), { id: `rId${LAYOUTS.length + 1}`, type: 'theme', target: '../theme/theme1.xml' }];
	let masterBg = fillXml(c.theme.background, undefined, true);
	if (c.theme.background.type === 'image') {
		const f = await imageFile(c.theme.background.blobId);
		if (f) {
			masterRels.push({ id: `rId${masterRels.length + 1}`, type: 'image', target: `../media/${f}` });
			masterBg = fillXml(c.theme.background, () => `rId${masterRels.length}`, true);
		}
	}

	put('ppt/theme/theme1.xml', themeXml(c.theme));
	put('ppt/theme/theme2.xml', themeXml(c.theme));
	overrides.push(['/ppt/theme/theme1.xml', `${CT}.theme+xml`], ['/ppt/theme/theme2.xml', `${CT}.theme+xml`]);
	put('ppt/slideMasters/slideMaster1.xml', masterXml(c, masterBg));
	put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels(masterRels));
	overrides.push(['/ppt/slideMasters/slideMaster1.xml', `${CT}.presentationml.slideMaster+xml`]);
	LAYOUTS.forEach((kind, i) => {
		put(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(c, kind));
		put(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]));
		overrides.push([`/ppt/slideLayouts/slideLayout${i + 1}.xml`, `${CT}.presentationml.slideLayout+xml`]);
	});
	put('ppt/notesMasters/notesMaster1.xml', notesMasterXml());
	put('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([{ id: 'rId1', type: 'theme', target: '../theme/theme2.xml' }]));
	overrides.push(['/ppt/notesMasters/notesMaster1.xml', `${CT}.presentationml.notesMaster+xml`]);

	let chartN = 0;
	for (const [i, s] of c.slides.entries()) {
		const n = i + 1;
		const sRels: Rel[] = [{ id: 'rId1', type: 'slideLayout', target: `../slideLayouts/slideLayout${LAYOUTS.indexOf(s.layout) + 1}.xml` }];
		const addRel = (type: string, target: string) => {
			const id = `rId${sRels.length + 1}`;
			sRels.push({ id, type, target });
			return id;
		};
		// Picture fills of this slide, loaded before the synchronous XML pass.
		const fillRids = new Map<string, string>();
		const fillIds = [s.background, ...s.elements.flatMap((e) => (e.kind === 'shape' ? [e.fill] : e.kind === 'table' ? e.cells.flat().map((x) => x.fill) : []))].filter((f): f is Extract<Fill, { type: 'image' }> => f?.type === 'image').map((f) => f.blobId);
		for (const b of new Set(fillIds)) {
			const f = await imageFile(b);
			if (f) fillRids.set(b, addRel('image', `../media/${f}`));
		}
		const embed: Embed = (b) => fillRids.get(b) ?? null;

		// Shape ids: imported ids are kept (animations refer to them); new elements get ids after the largest.
		const used = new Set<number>();
		const idOf = new Map<string, number>();
		for (const e of s.elements) if (e.srcId && e.srcId > 1 && !used.has(e.srcId)) (used.add(e.srcId), idOf.set(e.id, e.srcId));
		let nextId = Math.max(1, ...used) + 1;
		for (const e of s.elements) if (!idOf.has(e.id)) (idOf.set(e.id, nextId), used.add(nextId++));

		const parts: string[] = [];
		const kinds = new Map<string, ElKind>();
		const mediaIds: { id: number; autoplay: boolean; kind: 'video' | 'audio' }[] = [];
		for (const el of s.elements) {
			const id = idOf.get(el.id)!;
			if (el.kind === 'shape') {
				parts.push(shapeXml(el, id, s.layout, c.theme, lang, embed));
				kinds.set(el.id, LINE_GEOMS.has(el.geom) ? 'pic' : 'sp');
			} else if (el.kind === 'image') {
				const file = await imageFile(el.blobId);
				if (!file) continue;
				let svgRid: string | undefined;
				if (el.svgBlobId && opts.loadBlob) {
					const svg = await opts.loadBlob(el.svgBlobId);
					if (svg) svgRid = addRel('image', `../media/${rawFile(svg, 'svg', 'image/svg+xml', 'image')}`);
				}
				parts.push(picXml(el, id, addRel('image', `../media/${file}`), svgRid));
				kinds.set(el.id, 'pic');
			} else if (el.kind === 'icon') {
				const svg = iconSvg(el, c.theme);
				const png = (await opts.renderIcon?.(el, svg)) ?? TRANSPARENT_PNG;
				const pngRid = addRel('image', `../media/${rawFile(png, 'png', 'image/png', 'image')}`);
				const svgRid = addRel('image', `../media/${rawFile(strToU8(svg), 'svg', 'image/svg+xml', 'image')}`);
				parts.push(picXml({ id: el.id, kind: 'image', blobId: '', x: el.x, y: el.y, w: el.w, h: el.h, rot: el.rot, flipH: el.flipH, flipV: el.flipV, name: el.name ?? el.icon, alt: el.icon }, id, pngRid, svgRid));
				kinds.set(el.id, 'pic');
			} else if (el.kind === 'media') {
				const data = await opts.loadBlob?.(el.blobId);
				if (!data) continue;
				const ext = MEDIA_EXT[el.mime] ?? (/\.([a-z0-9]+)$/i.exec(el.fileName ?? '')?.[1]?.toLowerCase() || (el.media === 'video' ? 'mp4' : 'mp3'));
				const file = rawFile(data, ext, MEDIA_CT[ext] ?? el.mime);
				const link = addRel(el.media, `../media/${file}`);
				const mediaRid = addRel('http://schemas.microsoft.com/office/2007/relationships/media', `../media/${file}`);
				const posterFile = (el.posterBlobId && (await imageFile(el.posterBlobId))) || rawFile(mediaPosterPng(el.media), 'png', 'image/png', 'image');
				parts.push(mediaXml(el, id, { link, media: mediaRid, poster: addRel('image', `../media/${posterFile}`) }));
				kinds.set(el.id, 'pic');
				mediaIds.push({ id, autoplay: !!el.autoplay, kind: el.media });
			} else if (el.kind === 'table') {
				parts.push(frameXml(el, id, URI_TABLE, tableXml(el, c.theme, lang, embed), `Table ${id - 1}`));
				kinds.set(el.id, 'frame');
			} else if (el.kind === 'chart') {
				const k = ++chartN;
				const { xml, xlsx } = await chartParts(el);
				put(`ppt/charts/chart${k}.xml`, xml);
				files[`ppt/embeddings/Microsoft_Excel_Worksheet${k}.xlsx`] = xlsx;
				defaults.set('xlsx', `${CT}.spreadsheetml.sheet`);
				put(`ppt/charts/_rels/chart${k}.xml.rels`, rels([{ id: 'rId1', type: 'package', target: `../embeddings/Microsoft_Excel_Worksheet${k}.xlsx` }]));
				overrides.push([`/ppt/charts/chart${k}.xml`, `${CT}.drawingml.chart+xml`]);
				const rid = addRel('chart', `../charts/chart${k}.xml`);
				parts.push(frameXml(el, id, URI_CHART, `<c:chart xmlns:c="${URI_CHART}" r:id="${rid}"/>`, `Chart ${id - 1}`));
				kinds.set(el.id, 'frame');
			}
		}
		if (s.notes.trim()) {
			put(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(s.notes, lang));
			put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, rels([{ id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' }, { id: 'rId2', type: 'slide', target: `../slides/slide${n}.xml` }]));
			overrides.push([`/ppt/notesSlides/notesSlide${n}.xml`, `${CT}.presentationml.notesSlide+xml`]);
			addRel('notesSlide', `../notesSlides/notesSlide${n}.xml`);
		}
		const bg = s.background ? `<p:bg><p:bgPr>${fillXml(s.background, embed, true)}<a:effectLst/></p:bgPr></p:bg>` : '';
		const written = new Set(s.elements.filter((e) => kinds.has(e.id)).map((e) => idOf.get(e.id)!));
		const spid = (elId: string) => (kinds.has(elId) ? idOf.get(elId) : undefined);
		const timing = rawTiming(s, written) ?? timingXml(s, spid, kinds, mediaIds);
		put(`ppt/slides/slide${n}.xml`, `${XML}<p:sld ${NS}${s.hidden ? ' show="0"' : ''}><p:cSld>${bg}<p:spTree>${GRP}${parts.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXml(s)}${timing}</p:sld>`);
		put(`ppt/slides/_rels/slide${n}.xml.rels`, rels(sRels));
		overrides.push([`/ppt/slides/slide${n}.xml`, `${CT}.presentationml.slide+xml`]);
	}

	const N = c.slides.length;
	const presRels: Rel[] = [{ id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' }];
	for (let i = 1; i <= N; i++) presRels.push({ id: `rId${i + 1}`, type: 'slide', target: `slides/slide${i}.xml` });
	const tail = N + 2;
	presRels.push(
		{ id: `rId${tail}`, type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' },
		{ id: `rId${tail + 1}`, type: 'presProps', target: 'presProps.xml' },
		{ id: `rId${tail + 2}`, type: 'viewProps', target: 'viewProps.xml' },
		{ id: `rId${tail + 3}`, type: 'theme', target: 'theme/theme1.xml' },
		{ id: `rId${tail + 4}`, type: 'tableStyles', target: 'tableStyles.xml' }
	);
	put(
		'ppt/presentation.xml',
		`${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId${tail}"/></p:notesMasterIdLst>` +
			`<p:sldIdLst>${c.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>` +
			`<p:sldSz cx="${emu(c.size.w)}" cy="${emu(c.size.h)}"/><p:notesSz cx="6858000" cy="9144000"/>` +
			`<p:defaultTextStyle>${lvl(1, 1800)}</p:defaultTextStyle></p:presentation>`
	);
	put('ppt/_rels/presentation.xml.rels', rels(presRels));
	put('ppt/presProps.xml', `${XML}<p:presentationPr ${NS}/>`);
	put('ppt/viewProps.xml', `${XML}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
	put('ppt/tableStyles.xml', `${XML}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
	overrides.push(
		['/ppt/presentation.xml', `${CT}.presentationml.presentation.main+xml`],
		['/ppt/presProps.xml', `${CT}.presentationml.presProps+xml`],
		['/ppt/viewProps.xml', `${CT}.presentationml.viewProps+xml`],
		['/ppt/tableStyles.xml', `${CT}.presentationml.tableStyles+xml`],
		['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
		['/docProps/app.xml', `${CT}.extended-properties+xml`]
	);
	const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	put(
		'docProps/core.xml',
		`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title ?? textOf(undefined))}</dc:title><dc:creator>Mai Docs</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
	);
	put('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Mai Docs</Application><Slides>${N}</Slides></Properties>`);
	put(
		'_rels/.rels',
		`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/></Relationships>`
	);
	put(
		'[Content_Types].xml',
		`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...defaults].map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join('')}${overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`
	);
	return zipSync(files, { level: 6 });
}

export type { Slide };
