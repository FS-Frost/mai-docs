// .pptx writer (own OOXML, no pptxgenjs): theme, one slide master, 6 layouts with placeholders, slides with
// shapes (preset geometry, fill, line, rich text), pictures, notes. Part order and element order follow the
// PresentationML schema so PowerPoint opens the file without repair.
import type { JSONContent } from '@tiptap/core';
import { strToU8, zipSync } from 'fflate';
import { layoutBoxes } from '../layouts.ts';
import { EMU, LAYOUTS, THEME_COLORS, resolveFont, textOf, type Color, type El, type Fill, type LayoutKind, type Line, type Placeholder, type ShapeEl, type Slide, type SlidesContent, type TextBase, type Theme } from '../model.ts';

export type PptxImage = { data: Uint8Array; extension: 'png' | 'jpeg' | 'gif' };
export type LoadImage = (blobId: string) => Promise<PptxImage | null>;

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const emu = (px: number) => Math.round(px * EMU);
const hex = (c: string) => c.replace('#', '').toUpperCase().padStart(6, '0').slice(-6);

type Rel = { id: string; type: string; target: string };
const rels = (list: Rel[]) =>
	`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${r.id}" Type="${R}/${r.type}" Target="${esc(r.target)}"/>`).join('')}</Relationships>`;

/** Color → DrawingML: theme roles as schemeClr (stay linked to the theme), hex as srgbClr. */
function clr(c: Color | undefined, alpha?: number) {
	const a = alpha !== undefined && alpha < 1 ? `<a:alpha val="${Math.round(alpha * 100000)}"/>` : '';
	if (!c) return `<a:srgbClr val="000000">${a}</a:srgbClr>`;
	if (c.startsWith('#')) return `<a:srgbClr val="${hex(c)}">${a}</a:srgbClr>`;
	return `<a:schemeClr val="${c}">${a}</a:schemeClr>`;
}
const fillXml = (f: Fill | undefined) => (!f || f.type === 'none' ? '<a:noFill/>' : `<a:solidFill>${clr(f.color, f.alpha)}</a:solidFill>`);
const lineXml = (l: Line) =>
	!l ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="${emu(l.width)}"><a:solidFill>${clr(l.color)}</a:solidFill>${l.dash && l.dash !== 'solid' ? `<a:prstDash val="${l.dash === 'dot' ? 'sysDot' : 'dash'}"/>` : ''}</a:ln>`;

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
			for (const item of n.content ?? []) {
				let first = true;
				for (const c of item.content ?? []) {
					if (c.type === 'paragraph' && first) {
						walk(c, { kind, level });
						first = false;
					} else walk(c, { kind, level });
				}
			}
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
	for (const m of r.marks) {
		if (m.type === 'bold') b = true;
		else if (m.type === 'italic') i = true;
		else if (m.type === 'underline') u = true;
		else if (m.type === 'strike') s = true;
		else if (m.type === 'highlight') hl = String(m.attrs?.color ?? '#ffff00');
		else if (m.type === 'textStyle') {
			if (m.attrs?.color) color = String(m.attrs.color);
			if (m.attrs?.fontFamily) font = String(m.attrs.fontFamily).split(',')[0].replace(/["']/g, '').trim();
			const p = sizePt(m.attrs?.fontSize);
			if (p) size = p;
		}
	}
	const attrs = `lang="${lang}" sz="${Math.round(size * 100)}"${b ? ' b="1"' : ' b="0"'}${i ? ' i="1"' : ''}${u ? ' u="sng"' : ''}${s ? ' strike="sngStrike"' : ''} dirty="0"`;
	const props = `<a:solidFill>${clr(color.startsWith('#') || color.startsWith('rgb') ? toHex(color) : color)}</a:solidFill>${hl ? `<a:highlight>${clr(toHex(hl))}</a:highlight>` : ''}<a:latin typeface="${esc(font)}"/><a:cs typeface="${esc(font)}"/>`;
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

function txBody(el: ShapeEl, theme: Theme, lang: string) {
	const anchor = el.anchor === 'middle' ? 'ctr' : el.anchor === 'bottom' ? 'b' : 't';
	const ins = emu(el.inset);
	const paras = paragraphs(el.text);
	const body = (paras.length ? paras : [{ runs: [] } as Para])
		.map((p) => {
			const algn = ALGN[p.align ?? el.textStyle.align ?? 'left'] ?? 'l';
			let ppr: string;
			if (p.list) {
				const marL = emu(28 + p.list.level * 28);
				const bu = p.list.kind === 'bullet' ? `<a:buFont typeface="Arial"/><a:buChar char="${p.list.level % 2 ? '–' : '•'}"/>` : `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>`;
				ppr = `<a:pPr marL="${marL}" lvl="${Math.min(8, p.list.level)}" indent="${-emu(22)}" algn="${algn}">${bu}</a:pPr>`;
			} else ppr = `<a:pPr marL="0" indent="0" algn="${algn}"><a:buNone/></a:pPr>`;
			const runs = p.runs.map((r) => runXml(r, el.textStyle, theme, lang)).join('');
			return `<a:p>${ppr}${runs}<a:endParaRPr lang="${lang}" sz="${Math.round(el.textStyle.size * 100)}" dirty="0"/></a:p>`;
		})
		.join('');
	return `<p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${anchor}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody>`;
}

// ---------- Placeholders ----------

const PH: Record<Placeholder, (layout: LayoutKind) => string> = {
	title: (l) => `<p:ph type="${l === 'title' ? 'ctrTitle' : 'title'}"/>`,
	subtitle: (l) => (l === 'title' ? '<p:ph type="subTitle" idx="1"/>' : '<p:ph type="body" idx="1"/>'),
	body: () => '<p:ph idx="1"/>',
	body2: () => '<p:ph idx="2"/>'
};
const LAYOUT_TYPE: Record<LayoutKind, string> = { title: 'title', titleBody: 'obj', section: 'secHead', twoCol: 'twoObj', titleOnly: 'titleOnly', blank: 'blank' };
const LAYOUT_NAME: Record<LayoutKind, string> = { title: 'Title Slide', titleBody: 'Title and Content', section: 'Section Header', twoCol: 'Two Content', titleOnly: 'Title Only', blank: 'Blank' };
const PH_NAME: Record<Placeholder, string> = { title: 'Title', subtitle: 'Subtitle', body: 'Content Placeholder', body2: 'Content Placeholder' };

const xfrm = (e: { x: number; y: number; w: number; h: number; rot?: number; flipH?: boolean; flipV?: boolean }) =>
	`<a:xfrm${e.rot ? ` rot="${Math.round(e.rot * 60000)}"` : ''}${e.flipH ? ' flipH="1"' : ''}${e.flipV ? ' flipV="1"' : ''}><a:off x="${emu(e.x)}" y="${emu(e.y)}"/><a:ext cx="${emu(Math.max(1, e.w))}" cy="${emu(Math.max(1, e.h))}"/></a:xfrm>`;

// ---------- Parts ----------

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

function masterXml(c: SlidesContent) {
	const { w, h } = c.size;
	const tb = layoutBoxes('titleBody', w, h);
	const titleStyle = `<p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>`;
	const bodyStyle = `<p:bodyStyle>${[1, 2, 3].map((n) => lvl(n, 2200 - (n - 1) * 200, '<a:buNone/>')).join('')}</p:bodyStyle>`;
	const otherStyle = `<p:otherStyle>${lvl(1, 1800)}</p:otherStyle>`;
	return (
		`${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr>${fillXml(c.theme.background)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}` +
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

function shapeXml(el: ShapeEl, id: number, layout: LayoutKind, theme: Theme, lang: string) {
	const name = el.name ?? (el.ph ? `${PH_NAME[el.ph]} ${id - 1}` : el.textbox ? `TextBox ${id - 1}` : `Shape ${id - 1}`);
	const nv = el.ph
		? `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${PH[el.ph](layout)}</p:nvPr>`
		: `<p:cNvSpPr${el.textbox ? ' txBox="1"' : ''}/><p:nvPr/>`;
	const geom = el.geom === 'line' ? 'line' : el.geom;
	const hasText = el.geom !== 'line' && (el.text || el.ph || el.textbox);
	return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/>${nv}</p:nvSpPr><p:spPr>${xfrm(el)}<a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${el.geom === 'line' ? '<a:noFill/>' : fillXml(el.fill)}${lineXml(el.line)}</p:spPr>${hasText ? txBody(el, theme, lang) : ''}</p:sp>`;
}

function picXml(el: Extract<El, { kind: 'image' }>, id: number, rid: string) {
	return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id - 1}" descr="${esc(el.alt ?? '')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

// ---------- Package ----------

export async function writePptx(c: SlidesContent, loadImage: LoadImage, opts: { title?: string; lang?: string } = {}): Promise<Uint8Array> {
	const lang = opts.lang === 'es' ? 'es-ES' : 'en-US';
	const files: Record<string, Uint8Array> = {};
	const put = (path: string, s: string) => (files[path] = strToU8(s));
	const overrides: [string, string][] = [];
	const media = new Map<string, string>(); // blobId → media file name
	const ext = new Set<string>();
	let mediaN = 0;

	const ordered = LAYOUTS;
	put('ppt/theme/theme1.xml', themeXml(c.theme));
	put('ppt/theme/theme2.xml', themeXml(c.theme));
	overrides.push(['/ppt/theme/theme1.xml', `${CT}.theme+xml`], ['/ppt/theme/theme2.xml', `${CT}.theme+xml`]);
	put('ppt/slideMasters/slideMaster1.xml', masterXml(c));
	put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([...ordered.map((_, i) => ({ id: `rId${i + 1}`, type: 'slideLayout', target: `../slideLayouts/slideLayout${i + 1}.xml` })), { id: `rId${ordered.length + 1}`, type: 'theme', target: '../theme/theme1.xml' }]));
	overrides.push(['/ppt/slideMasters/slideMaster1.xml', `${CT}.presentationml.slideMaster+xml`]);
	ordered.forEach((kind, i) => {
		put(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(c, kind));
		put(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]));
		overrides.push([`/ppt/slideLayouts/slideLayout${i + 1}.xml`, `${CT}.presentationml.slideLayout+xml`]);
	});
	put('ppt/notesMasters/notesMaster1.xml', notesMasterXml());
	put('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([{ id: 'rId1', type: 'theme', target: '../theme/theme2.xml' }]));
	overrides.push(['/ppt/notesMasters/notesMaster1.xml', `${CT}.presentationml.notesMaster+xml`]);

	for (const [i, s] of c.slides.entries()) {
		const n = i + 1;
		const sRels: Rel[] = [{ id: 'rId1', type: 'slideLayout', target: `../slideLayouts/slideLayout${ordered.indexOf(s.layout) + 1}.xml` }];
		let id = 2;
		const parts: string[] = [];
		for (const el of s.elements) {
			if (el.kind === 'shape') parts.push(shapeXml(el, id++, s.layout, c.theme, lang));
			else {
				let file = media.get(el.blobId);
				if (!file) {
					const img = await loadImage(el.blobId);
					if (!img) continue;
					file = `image${++mediaN}.${img.extension === 'jpeg' ? 'jpeg' : img.extension}`;
					files[`ppt/media/${file}`] = img.data;
					ext.add(img.extension === 'jpeg' ? 'jpeg' : img.extension);
					media.set(el.blobId, file);
				}
				const rid = `rId${sRels.length + 1}`;
				sRels.push({ id: rid, type: 'image', target: `../media/${file}` });
				parts.push(picXml(el, id++, rid));
			}
		}
		if (s.notes.trim()) {
			put(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(s.notes, lang));
			put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, rels([{ id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' }, { id: 'rId2', type: 'slide', target: `../slides/slide${n}.xml` }]));
			overrides.push([`/ppt/notesSlides/notesSlide${n}.xml`, `${CT}.presentationml.notesSlide+xml`]);
			sRels.push({ id: `rId${sRels.length + 1}`, type: 'notesSlide', target: `../notesSlides/notesSlide${n}.xml` });
		}
		const bg = s.background ? `<p:bg><p:bgPr>${fillXml(s.background)}<a:effectLst/></p:bgPr></p:bg>` : '';
		put(`ppt/slides/slide${n}.xml`, `${XML}<p:sld ${NS}${s.hidden ? ' show="0"' : ''}><p:cSld>${bg}<p:spTree>${GRP}${parts.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
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
	const defaults = [...ext].map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('');
	put(
		'[Content_Types].xml',
		`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${defaults}${overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`
	);
	return zipSync(files, { level: 6 });
}

export type { Slide };
