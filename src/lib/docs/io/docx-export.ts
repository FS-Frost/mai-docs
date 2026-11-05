// Tiptap JSON → .docx (docx library). Page size/orientation/margins go to the section; images are fetched
// through `getImage` (browser: blob store + canvas for unsupported formats; tests: a stub).
import type { JSONContent } from '@tiptap/core';
import {
	AlignmentType,
	BorderStyle,
	Document,
	ExternalHyperlink,
	HeadingLevel,
	HorizontalPositionAlign,
	HorizontalPositionRelativeFrom,
	TextWrappingSide,
	TextWrappingType,
	VerticalPositionRelativeFrom,
	ImageRun,
	LevelFormat,
	Packer,
	PageOrientation,
	Paragraph,
	ShadingType,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
	convertMillimetersToTwip,
	type IParagraphOptions,
	type IRunOptions,
	type ParagraphChild
} from 'docx';
import { INDENT_STEP_MM } from '../extensions/indent.ts';
import { pageDims, type PageSetup } from '../model.ts';

export type DocxImage = { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number };
export type ImageLoader = (src: string) => Promise<DocxImage | null>;

type Marks = NonNullable<JSONContent['marks']>;

const NUMBERING = 'mai-ol';

/** CSS color (#rgb, #rrggbb, rgb()) → 'RRGGBB'. */
export function hexColor(c: unknown): string | undefined {
	if (typeof c !== 'string' || !c) return undefined;
	const s = c.trim();
	let m = /^#([0-9a-f]{3})$/i.exec(s);
	if (m)
		return m[1]
			.split('')
			.map((x) => x + x)
			.join('')
			.toUpperCase();
	m = /^#([0-9a-f]{6})$/i.exec(s);
	if (m) return m[1].toUpperCase();
	m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(s);
	if (m)
		return [m[1], m[2], m[3]]
			.map((x) => Number(x).toString(16).padStart(2, '0'))
			.join('')
			.toUpperCase();
	const named: Record<string, string> = { yellow: 'FFFF00', red: 'FF0000', green: '00FF00', blue: '0000FF', black: '000000', white: 'FFFFFF' };
	return named[s.toLowerCase()];
}

/** CSS font size → half-points. */
export function halfPoints(size: unknown): number | undefined {
	if (typeof size !== 'string' && typeof size !== 'number') return undefined;
	const m = /^([\d.]+)\s*(pt|px)?$/.exec(String(size).trim());
	if (!m) return undefined;
	const n = Number(m[1]);
	const pt = m[2] === 'px' ? (n * 72) / 96 : n;
	return Math.round(pt * 2);
}

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
	left: AlignmentType.LEFT,
	center: AlignmentType.CENTER,
	right: AlignmentType.RIGHT,
	justify: AlignmentType.JUSTIFIED
};

const HEADING = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

export type ChartLoader = (attrs: Record<string, unknown>) => Promise<DocxImage | null>;
type Ctx = { getImage: ImageLoader; getChart?: ChartLoader; listInstance: number; contentWidthPx: number };

function runOptions(marks: Marks | undefined, extra: Partial<IRunOptions> = {}): IRunOptions {
	const o: Record<string, unknown> = { ...extra };
	for (const m of marks ?? []) {
		switch (m.type) {
			case 'bold':
				o.bold = true;
				break;
			case 'italic':
				o.italics = true;
				break;
			case 'underline':
				o.underline = {};
				break;
			case 'strike':
				o.strike = true;
				break;
			case 'code':
				o.font = 'Courier New';
				break;
			case 'highlight': {
				const c = hexColor(m.attrs?.color) ?? 'FFFF00';
				o.shading = { type: ShadingType.CLEAR, color: 'auto', fill: c };
				break;
			}
			case 'textStyle': {
				const a = m.attrs ?? {};
				const color = hexColor(a.color);
				if (color) o.color = color;
				if (a.fontFamily) o.font = String(a.fontFamily).split(',')[0].replace(/["']/g, '').trim();
				const hp = halfPoints(a.fontSize);
				if (hp) o.size = hp;
				const bg = hexColor(a.backgroundColor);
				if (bg) o.shading = { type: ShadingType.CLEAR, color: 'auto', fill: bg };
				break;
			}
			case 'link':
				o.style = 'Hyperlink';
				break;
		}
	}
	return o as IRunOptions;
}

async function inline(nodes: JSONContent[] | undefined, ctx: Ctx, extra: Partial<IRunOptions> = {}): Promise<ParagraphChild[]> {
	const out: ParagraphChild[] = [];
	for (const n of nodes ?? []) {
		if (n.type === 'text') {
			const opts = runOptions(n.marks, { ...extra, text: n.text ?? '' });
			const link = n.marks?.find((m) => m.type === 'link');
			if (link?.attrs?.href) out.push(new ExternalHyperlink({ link: String(link.attrs.href), children: [new TextRun(opts)] }));
			else out.push(new TextRun(opts));
		} else if (n.type === 'hardBreak') out.push(new TextRun({ break: 1 }));
		else if (n.type === 'image') {
			const img = await imageRun(n, ctx);
			if (img) out.push(img);
		}
	}
	return out;
}

async function imageRun(n: JSONContent, ctx: Ctx) {
	const src = String(n.attrs?.src ?? '');
	if (!src) return null;
	const img = await ctx.getImage(src);
	if (!img) return null;
	let w = Number(n.attrs?.width) || img.width;
	let h = Number(n.attrs?.height) || (img.height * w) / img.width;
	if (w > ctx.contentWidthPx) {
		h = (h * ctx.contentWidthPx) / w;
		w = ctx.contentWidthPx;
	}
	const alt = String(n.attrs?.alt ?? '');
	const wrap = n.attrs?.wrap as 'left' | 'right' | null | undefined;
	const floating = wrap
		? {
				horizontalPosition: { relative: HorizontalPositionRelativeFrom.COLUMN, align: wrap === 'left' ? HorizontalPositionAlign.LEFT : HorizontalPositionAlign.RIGHT },
				verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 },
				wrap: { type: TextWrappingType.SQUARE, side: TextWrappingSide.BOTH_SIDES },
				margins: wrap === 'left' ? { right: 114300, bottom: 57150 } : { left: 114300, bottom: 57150 }
			}
		: undefined;
	return new ImageRun({
		type: img.type,
		data: img.data,
		transformation: { width: Math.round(w), height: Math.round(h) },
		altText: alt ? { name: alt, description: alt, title: alt } : undefined,
		floating
	} as ConstructorParameters<typeof ImageRun>[0]);
}

function paraBase(n: JSONContent): Partial<IParagraphOptions> {
	const o: Record<string, unknown> = {};
	const align = n.attrs?.textAlign;
	if (align && ALIGN[align]) o.alignment = ALIGN[align];
	const ind = Number(n.attrs?.indent) || 0;
	if (ind) o.indent = { left: convertMillimetersToTwip(ind * INDENT_STEP_MM) };
	return o;
}

type Block = Paragraph | Table;

async function blocks(nodes: JSONContent[] | undefined, ctx: Ctx, list?: { kind: 'bullet' | 'ordered'; level: number; instance: number }): Promise<Block[]> {
	const out: Block[] = [];
	for (const n of nodes ?? []) out.push(...(await block(n, ctx, list)));
	return out;
}

async function block(n: JSONContent, ctx: Ctx, list?: { kind: 'bullet' | 'ordered'; level: number; instance: number }): Promise<Block[]> {
	switch (n.type) {
		case 'paragraph': {
			const o: IParagraphOptions = { ...paraBase(n), style: n.attrs?.caption ? 'Caption' : undefined, children: await inline(n.content, ctx) };
			return [new Paragraph(o)];
		}
		case 'heading': {
			const level = Math.min(3, Math.max(1, Number(n.attrs?.level) || 1));
			return [new Paragraph({ ...paraBase(n), heading: HEADING[level - 1], children: await inline(n.content, ctx) })];
		}
		case 'blockquote': {
			const out: Block[] = [];
			for (const c of n.content ?? []) {
				if (c.type === 'paragraph' || c.type === 'heading')
					out.push(
						new Paragraph({
							indent: { left: convertMillimetersToTwip(10) },
							border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } },
							children: await inline(c.content, ctx, { color: '555555' })
						})
					);
				else out.push(...(await block(c, ctx, list)));
			}
			return out;
		}
		case 'codeBlock': {
			const text = (n.content ?? []).map((c) => c.text ?? '').join('');
			return text.split('\n').map(
				(line) =>
					new Paragraph({
						shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F5F5' },
						spacing: { after: 0 },
						children: [new TextRun({ text: line, font: 'Courier New', size: 20 })]
					})
			);
		}
		case 'horizontalRule':
			return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 1 } }, children: [] })];
		case 'image': {
			const img = await imageRun(n, ctx);
			const align = n.attrs?.align as string | undefined;
			return img ? [new Paragraph({ alignment: align && !n.attrs?.wrap ? ALIGN[align] : undefined, children: [img] })] : [];
		}
		case 'bulletList':
		case 'orderedList': {
			const kind = n.type === 'bulletList' ? 'bullet' : 'ordered';
			const level = list ? list.level + 1 : 0;
			const instance = kind === 'ordered' ? (list?.kind === 'ordered' ? list.instance : ++ctx.listInstance) : 0;
			const out: Block[] = [];
			for (const item of n.content ?? []) out.push(...(await listItem(item, ctx, { kind, level, instance })));
			return out;
		}
		case 'taskList': {
			const level = list ? list.level + 1 : 0;
			const out: Block[] = [];
			for (const item of n.content ?? []) {
				const [first, ...rest] = item.content ?? [];
				const box = item.attrs?.checked ? '☑ ' : '☐ ';
				out.push(
					new Paragraph({
						indent: { left: convertMillimetersToTwip(6 + level * 6), hanging: convertMillimetersToTwip(5) },
						children: [new TextRun({ text: box }), ...(await inline(first?.content, ctx, item.attrs?.checked ? { strike: true } : {}))]
					})
				);
				for (const r of rest) out.push(...(await block(r, ctx, { kind: 'bullet', level, instance: 0 })));
			}
			return out;
		}
		case 'table':
			return [await table(n, ctx)];
		case 'chart': {
			// Charts go to Word as PNG images rendered by the caller (Chart.js needs a canvas).
			const img = await ctx.getChart?.(n.attrs ?? {});
			if (!img) return [];
			const s = Math.min(1, ctx.contentWidthPx / img.width);
			return [new Paragraph({ children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.width * s), height: Math.round(img.height * s) } } as ConstructorParameters<typeof ImageRun>[0])] })];
		}
		default:
			return n.content ? blocks(n.content, ctx, list) : [];
	}
}

async function listItem(item: JSONContent, ctx: Ctx, list: { kind: 'bullet' | 'ordered'; level: number; instance: number }): Promise<Block[]> {
	const out: Block[] = [];
	let first = true;
	for (const c of item.content ?? []) {
		if ((c.type === 'paragraph' || c.type === 'heading') && first) {
			first = false;
			const children = await inline(c.content, ctx);
			out.push(
				new Paragraph({
					...paraBase(c),
					children,
					...(list.kind === 'bullet' ? { bullet: { level: list.level } } : { numbering: { reference: NUMBERING, level: list.level, instance: list.instance } })
				})
			);
		} else if (c.type === 'paragraph') {
			out.push(new Paragraph({ indent: { left: convertMillimetersToTwip(6.35 * (list.level + 1)) }, children: await inline(c.content, ctx) }));
		} else out.push(...(await block(c, ctx, list)));
	}
	return out;
}

async function table(n: JSONContent, ctx: Ctx): Promise<Table> {
	const rows: TableRow[] = [];
	const firstRow = n.content?.[0];
	const widths: number[] = [];
	for (const cell of firstRow?.content ?? []) {
		const span = Number(cell.attrs?.colspan) || 1;
		const cw = (cell.attrs?.colwidth as number[] | null) ?? [];
		for (let i = 0; i < span; i++) widths.push(cw[i] ?? 0);
	}
	const known = widths.filter((w) => w > 0).reduce((a, b) => a + b, 0);
	const unknown = widths.filter((w) => !w).length;
	const rest = unknown ? Math.max(40, (ctx.contentWidthPx - known) / unknown) : 0;
	const px = widths.map((w) => w || rest);
	const scale = Math.min(1, ctx.contentWidthPx / Math.max(1, px.reduce((a, b) => a + b, 0)));
	const twips = px.map((w) => Math.round(w * scale * 15)); // 1 px = 15 twips at 96 dpi
	for (const row of n.content ?? []) {
		const cells: TableCell[] = [];
		let col = 0;
		for (const cell of row.content ?? []) {
			const span = Number(cell.attrs?.colspan) || 1;
			const w = twips.slice(col, col + span).reduce((a, b) => a + b, 0);
			col += span;
			const content = (await blocks(cell.content, ctx)).filter((b): b is Paragraph | Table => !!b);
			cells.push(
				new TableCell({
					children: content.length ? content : [new Paragraph({ children: [] })],
					columnSpan: span > 1 ? span : undefined,
					rowSpan: Number(cell.attrs?.rowspan) > 1 ? Number(cell.attrs?.rowspan) : undefined,
					width: { size: w, type: WidthType.DXA },
					shading: cell.type === 'tableHeader' ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' } : undefined
				})
			);
		}
		rows.push(new TableRow({ children: cells, tableHeader: row.content?.every((c) => c.type === 'tableHeader') || undefined }));
	}
	return new Table({ rows, columnWidths: twips, width: { size: twips.reduce((a, b) => a + b, 0), type: WidthType.DXA } });
}

export async function buildDocx(doc: JSONContent, page: PageSetup, getImage: ImageLoader, title = '', getChart?: ChartLoader): Promise<Document> {
	const dims = pageDims(page);
	const contentWidthPx = ((dims.w - page.margins.left - page.margins.right) / 25.4) * 96;
	const ctx: Ctx = { getImage, getChart, listInstance: 0, contentWidthPx };
	const children = await blocks(doc.content, ctx);
	const twip = (mm: number) => Math.round((mm / 25.4) * 1440);
	const [pw, ph] = [twip(dims.w), twip(dims.h)];
	return new Document({
		creator: 'Mai Docs',
		title,
		styles: {
			default: { document: { run: { font: 'Arial', size: 22 } } },
			paragraphStyles: [
				{ id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 40, bold: true }, paragraph: { spacing: { before: 240, after: 120 } } },
				{ id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true }, paragraph: { spacing: { before: 200, after: 100 } } },
				{ id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true }, paragraph: { spacing: { before: 160, after: 80 } } },
				{ id: 'Caption', name: 'Caption', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 18, italics: true, color: '555555' }, paragraph: { spacing: { before: 40, after: 120 } } }
			],
			characterStyles: [{ id: 'Hyperlink', name: 'Hyperlink', basedOn: 'DefaultParagraphFont', run: { color: '1A56C4', underline: {} } }]
		},
		numbering: {
			config: [
				{
					reference: NUMBERING,
					levels: Array.from({ length: 9 }, (_, level) => ({
						level,
						format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
						text: `%${level + 1}.`,
						alignment: AlignmentType.START,
						style: { paragraph: { indent: { left: convertMillimetersToTwip(6.35 * (level + 1)), hanging: convertMillimetersToTwip(6.35) } } }
					}))
				}
			]
		},
		sections: [
			{
				properties: {
					page: {
						// docx swaps width/height for landscape: always pass portrait dimensions.
						size: { width: Math.min(pw, ph), height: Math.max(pw, ph), orientation: page.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
						margin: {
							top: convertMillimetersToTwip(page.margins.top),
							right: convertMillimetersToTwip(page.margins.right),
							bottom: convertMillimetersToTwip(page.margins.bottom),
							left: convertMillimetersToTwip(page.margins.left)
						}
					}
				},
				children: children.length ? children : [new Paragraph({ children: [] })]
			}
		]
	});
}

export async function docxBytes(doc: Document): Promise<ArrayBuffer> {
	return Packer.toArrayBuffer(doc);
}
