// Native Excel charts (DrawingML) — exceljs doesn't support them, so they are written into / read from the
// .xlsx zip directly. Supported: column, bar, line, area (clustered / stacked / 100%), pie, doughnut, scatter;
// series as references to the sheet (+ value caches), titles, axis titles, min/max, legend, series colors,
// two-cell anchor position.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { cellKey, colName, type Range } from '../addr.ts';
import { tryParse, quoteSheet } from '../formula/parse.ts';
import { Axis } from '../layout.ts';
import { DEFAULT_COL_W, DEFAULT_ROW_H, sheetByName, valueText, type Anchor, type ChartObject, type ChartType, type Sheet, type Workbook } from '../model.ts';
import { resolveRange, PALETTE } from '../charts.ts';

const EMU = 9525; // per pixel
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const REL_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const axesOf = (s: Sheet) => ({ rows: new Axis(s.rows, DEFAULT_ROW_H, s.rowHeights), cols: new Axis(s.cols, DEFAULT_COL_W, s.colWidths) });

// ---------- Series references ----------

type SerRef = { name?: { f: string; v: string }; cat?: { f: string; v: string[]; num: boolean }; val: { f: string; v: (number | null)[] } };

const absRef = (sheet: string, r1: number, c1: number, r2: number, c2: number) =>
	`${quoteSheet(sheet)}!$${colName(c1)}$${r1 + 1}${r1 === r2 && c1 === c2 ? '' : `:$${colName(c2)}$${r2 + 1}`}`;

/** Series of a chart as cell references, in the orientation of its source. */
export function seriesRefs(wb: Workbook, ch: ChartObject, text: (s: Sheet, r: number, c: number) => string): SerRef[] {
	const res = resolveRange(wb, ch.source.range);
	if (!res) return [];
	const { sheet: s, range: g } = res;
	const { seriesIn, headerRow, headerCol } = ch.source;
	const cols = seriesIn === 'cols';
	const num = (r: number, c: number) => {
		const v = s.cells.get(cellKey(r, c))?.v;
		return typeof v === 'number' ? v : null;
	};
	const out: SerRef[] = [];
	if (cols) {
		const r1 = g.r1 + (headerRow ? 1 : 0);
		const cat = headerCol && r1 <= g.r2 ? { f: absRef(s.name, r1, g.c1, g.r2, g.c1), v: range(r1, g.r2).map((r) => text(s, r, g.c1)), num: range(r1, g.r2).every((r) => num(r, g.c1) !== null) } : undefined;
		for (let c = g.c1 + (headerCol ? 1 : 0); c <= g.c2; c++)
			out.push({ name: headerRow ? { f: absRef(s.name, g.r1, c, g.r1, c), v: text(s, g.r1, c) } : undefined, cat, val: { f: absRef(s.name, r1, c, g.r2, c), v: range(r1, g.r2).map((r) => num(r, c)) } });
	} else {
		const c1 = g.c1 + (headerCol ? 1 : 0);
		const cat = headerRow && c1 <= g.c2 ? { f: absRef(s.name, g.r1, c1, g.r1, g.c2), v: range(c1, g.c2).map((c) => text(s, g.r1, c)), num: range(c1, g.c2).every((c) => num(g.r1, c) !== null) } : undefined;
		for (let r = g.r1 + (headerRow ? 1 : 0); r <= g.r2; r++)
			out.push({ name: headerCol ? { f: absRef(s.name, r, g.c1, r, g.c1), v: text(s, r, g.c1) } : undefined, cat, val: { f: absRef(s.name, r, c1, r, g.c2), v: range(c1, g.c2).map((c) => num(r, c)) } });
	}
	return out;
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

// ---------- Chart XML ----------

const strRef = (r: { f: string; v: string[] }) =>
	`<c:strRef><c:f>${esc(r.f)}</c:f><c:strCache><c:ptCount val="${r.v.length}"/>${r.v.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`;
const numRef = (r: { f: string; v: (number | null)[] }) =>
	`<c:numRef><c:f>${esc(r.f)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${r.v.length}"/>${r.v
		.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`))
		.join('')}</c:numCache></c:numRef>`;
const fill = (hex: string, line = false) => {
	const c = hex.replace('#', '').toUpperCase();
	return line ? `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill><a:round/></a:ln></c:spPr>` : `<c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></c:spPr>`;
};
const rich = (text: string, size = 1400) =>
	`<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="0"/></a:pPr><a:r><a:rPr lang="en-US" sz="${size}" b="0"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/>`;
const titleXml = (text?: string, size?: number) => (text ? `<c:title>${rich(text, size)}</c:title>` : '');

export function chartXml(ch: ChartObject, sers: SerRef[]): string {
	const colors = sers.map((_, i) => ch.colors?.[i] || PALETTE.light[i % PALETTE.light.length]);
	const pie = ch.type === 'pie' || ch.type === 'doughnut';
	const grouping = ch.stacked === 'percent' ? 'percentStacked' : ch.stacked ? 'stacked' : null;
	const catXml = (s: SerRef) => (s.cat ? `<c:cat>${s.cat.num ? numRef({ f: s.cat.f, v: s.cat.v.map((x) => (x === '' ? null : Number(x))) }) : strRef(s.cat)}</c:cat>` : '');
	const tx = (s: SerRef) => (s.name ? `<c:tx>${strRef({ f: s.name.f, v: [s.name.v] })}</c:tx>` : '');
	const head = (i: number) => `<c:idx val="${i}"/><c:order val="${i}"/>`;
	let plot: string;
	const AX1 = 500001;
	const AX2 = 500002;
	const axIds = `<c:axId val="${AX1}"/><c:axId val="${AX2}"/>`;
	if (ch.type === 'column' || ch.type === 'bar') {
		plot =
			`<c:barChart><c:barDir val="${ch.type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="${grouping ?? 'clustered'}"/><c:varyColors val="0"/>` +
			sers.map((s, i) => `<c:ser>${head(i)}${tx(s)}${fill(colors[i])}<c:invertIfNegative val="0"/>${catXml(s)}<c:val>${numRef(s.val)}</c:val></c:ser>`).join('') +
			`<c:gapWidth val="80"/>${grouping ? '<c:overlap val="100"/>' : ''}${axIds}</c:barChart>`;
	} else if (ch.type === 'line') {
		plot =
			`<c:lineChart><c:grouping val="${grouping ?? 'standard'}"/><c:varyColors val="0"/>` +
			sers.map((s, i) => `<c:ser>${head(i)}${tx(s)}${fill(colors[i], true)}<c:marker><c:symbol val="circle"/><c:size val="5"/>${fill(colors[i])}</c:marker>${catXml(s)}<c:val>${numRef(s.val)}</c:val><c:smooth val="0"/></c:ser>`).join('') +
			`<c:marker val="1"/>${axIds}</c:lineChart>`;
	} else if (ch.type === 'area') {
		plot =
			`<c:areaChart><c:grouping val="${grouping ?? 'standard'}"/><c:varyColors val="0"/>` +
			sers.map((s, i) => `<c:ser>${head(i)}${tx(s)}${fill(colors[i])}${catXml(s)}<c:val>${numRef(s.val)}</c:val></c:ser>`).join('') +
			`${axIds}</c:areaChart>`;
	} else if (pie) {
		const s = sers[0];
		const n = s ? s.val.v.length : 0;
		const dpts = Array.from({ length: n }, (_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/>${fill(ch.colors?.[i] || PALETTE.light[i % PALETTE.light.length])}</c:dPt>`).join('');
		const ser = s ? `<c:ser>${head(0)}${tx(s)}${dpts}${catXml(s)}<c:val>${numRef(s.val)}</c:val></c:ser>` : '';
		plot = ch.type === 'pie' ? `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>` : `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
	} else {
		// scatter: x = categories when numeric, else the first series.
		let xs: SerRef['val'] | undefined;
		let ys = sers;
		if (sers[0]?.cat?.num) xs = { f: sers[0].cat.f, v: sers[0].cat.v.map((x) => (x === '' ? null : Number(x))) };
		else if (sers.length > 1) {
			xs = sers[0].val;
			ys = sers.slice(1);
		}
		plot =
			`<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>` +
			ys
				.map(
					(s, i) =>
						`<c:ser>${head(i)}${tx(s)}<c:spPr><a:ln w="25400"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/>${fill(colors[i])}</c:marker>${xs ? `<c:xVal>${numRef(xs)}</c:xVal>` : ''}<c:yVal>${numRef(s.val)}</c:yVal><c:smooth val="0"/></c:ser>`
				)
				.join('') +
			`${axIds}</c:scatterChart>`;
	}
	const scaling = (min?: number, max?: number) => `<c:scaling><c:orientation val="minMax"/>${max !== undefined ? `<c:max val="${max}"/>` : ''}${min !== undefined ? `<c:min val="${min}"/>` : ''}</c:scaling>`;
	const tail = (cross: number) => `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/>`;
	const horizontal = ch.type === 'bar';
	let axes = '';
	if (!pie) {
		const valAx = (id: number, cross: number, pos: string, title?: string, min?: number, max?: number, grid = true) =>
			`<c:valAx><c:axId val="${id}"/>${scaling(min, max)}<c:delete val="0"/><c:axPos val="${pos}"/>${grid ? '<c:majorGridlines/>' : ''}${titleXml(title, 1000)}<c:numFmt formatCode="General" sourceLinked="1"/>${tail(cross)}<c:crossBetween val="${ch.type === 'scatter' ? 'midCat' : 'between'}"/></c:valAx>`;
		if (ch.type === 'scatter') axes = valAx(AX1, AX2, 'b', ch.xTitle, undefined, undefined, false) + valAx(AX2, AX1, 'l', ch.yTitle, ch.yMin, ch.yMax);
		else
			axes =
				`<c:catAx><c:axId val="${AX1}"/>${scaling()}<c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/>${titleXml(ch.xTitle, 1000)}<c:numFmt formatCode="General" sourceLinked="1"/>${tail(AX2)}<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
				valAx(AX2, AX1, horizontal ? 'b' : 'l', ch.yTitle, ch.stacked === 'percent' ? undefined : ch.yMin, ch.stacked === 'percent' ? undefined : ch.yMax);
	}
	const legend = ch.legend === 'none' ? '' : `<c:legend><c:legendPos val="${ch.legend === 'top' ? 't' : ch.legend === 'right' ? 'r' : 'b'}"/><c:overlay val="0"/></c:legend>`;
	return (
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
		`<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/>` +
		`<c:chart>${titleXml(ch.title)}<c:autoTitleDeleted val="${ch.title ? 0 : 1}"/><c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
		`<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>` +
		`</c:chartSpace>`
	);
}

// ---------- Anchors ----------

function anchorXml(s: Sheet, a: Anchor, w: number, h: number, rid: string, n: number, name: string) {
	const { rows, cols } = axesOf(s);
	const x2 = cols.offset(a.c) + a.dx + w;
	const y2 = rows.offset(a.r) + a.dy + h;
	const c2 = cols.indexAt(x2);
	const r2 = rows.indexAt(y2);
	const off = (v: number) => Math.max(0, Math.round(v * EMU));
	return (
		`<xdr:twoCellAnchor editAs="oneCell">` +
		`<xdr:from><xdr:col>${a.c}</xdr:col><xdr:colOff>${off(a.dx)}</xdr:colOff><xdr:row>${a.r}</xdr:row><xdr:rowOff>${off(a.dy)}</xdr:rowOff></xdr:from>` +
		`<xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>${off(x2 - cols.offset(c2))}</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>${off(y2 - rows.offset(r2))}</xdr:rowOff></xdr:to>` +
		`<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${n}" name="${esc(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
		`<xdr:xfrm><a:off xmlns:a="${NS_A}" x="0" y="0"/><a:ext xmlns:a="${NS_A}" cx="0" cy="0"/></xdr:xfrm>` +
		`<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="${rid}"/></a:graphicData></a:graphic>` +
		`</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
	);
}

// ---------- Zip helpers ----------

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, isArray: (name) => ['Relationship', 'sheet', 'ser', 'pt', 'twoCellAnchor', 'oneCellAnchor', 'dPt', 'p', 'r'].includes(name) });

type Rel = { Id: string; Type: string; Target: string };

function relsOf(files: Record<string, Uint8Array>, path: string): Rel[] {
	const f = files[path];
	if (!f) return [];
	const x = parser.parse(strFromU8(f));
	return (x.Relationships?.Relationship ?? []) as Rel[];
}

function writeRels(rels: Rel[]) {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${r.Id}" Type="${r.Type}" Target="${esc(r.Target)}"/>`).join('')}</Relationships>`;
}

const relsPath = (path: string) => path.replace(/([^/]+)$/, '_rels/$1.rels');
/** Resolves a relationship target relative to the part that declares it. */
function resolve(from: string, target: string) {
	if (target.startsWith('/')) return target.slice(1);
	const parts = from.split('/').slice(0, -1);
	for (const seg of target.split('/')) {
		if (seg === '..') parts.pop();
		else if (seg !== '.') parts.push(seg);
	}
	return parts.join('/');
}
const relative = (from: string, to: string) => {
	const a = from.split('/').slice(0, -1);
	const b = to.split('/');
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
};
const nextId = (rels: Rel[]) => `rId${Math.max(0, ...rels.map((r) => Number(r.Id.replace(/\D/g, '')) || 0)) + 1}`;

/** Sheet name → worksheet part path. */
function sheetParts(files: Record<string, Uint8Array>): Map<string, string> {
	const wbx = parser.parse(strFromU8(files['xl/workbook.xml']));
	const rels = relsOf(files, 'xl/_rels/workbook.xml.rels');
	const out = new Map<string, string>();
	for (const s of wbx.workbook?.sheets?.sheet ?? []) {
		const rel = rels.find((r) => r.Id === s.id);
		if (rel) out.set(String(s.name), resolve('xl/workbook.xml', rel.Target));
	}
	return out;
}

// ---------- Export ----------

export function addChartsToXlsx(bytes: Uint8Array, wb: Workbook, text: (s: Sheet, r: number, c: number) => string): Uint8Array {
	if (!wb.sheets.some((s) => s.objects.some((o) => o.kind === 'chart'))) return bytes;
	const files = unzipSync(bytes);
	const parts = sheetParts(files);
	let ct = strFromU8(files['[Content_Types].xml']);
	const addOverride = (part: string, type: string) => {
		if (!ct.includes(`PartName="/${part}"`)) ct = ct.replace('</Types>', `<Override PartName="/${part}" ContentType="${type}"/></Types>`);
	};
	let chartN = Object.keys(files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f)).length;
	for (const s of wb.sheets) {
		const charts = s.objects.filter((o): o is ChartObject => o.kind === 'chart');
		if (!charts.length) continue;
		const sheetPath = parts.get(s.name);
		if (!sheetPath) continue;
		const sRelsPath = relsPath(sheetPath);
		const sRels = relsOf(files, sRelsPath);
		let drawingPath: string;
		const existing = sRels.find((r) => r.Type === REL_DRAWING);
		if (existing) drawingPath = resolve(sheetPath, existing.Target);
		else {
			let k = 1;
			while (files[`xl/drawings/drawing${k}.xml`]) k++;
			drawingPath = `xl/drawings/drawing${k}.xml`;
			files[drawingPath] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}"></xdr:wsDr>`);
			const rid = nextId(sRels);
			sRels.push({ Id: rid, Type: REL_DRAWING, Target: relative(sheetPath, drawingPath) });
			files[sRelsPath] = strToU8(writeRels(sRels));
			let sx = strFromU8(files[sheetPath]);
			if (!/xmlns:r=/.test(sx.slice(0, 600))) sx = sx.replace(/<worksheet\b/, `<worksheet xmlns:r="${NS_R}"`);
			const tag = `<drawing r:id="${rid}"/>`;
			const before = /<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/.exec(sx);
			sx = before ? sx.slice(0, before.index) + tag + sx.slice(before.index) : sx.replace('</worksheet>', `${tag}</worksheet>`);
			files[sheetPath] = strToU8(sx);
			addOverride(drawingPath, CT_DRAWING);
		}
		const dRelsPath = relsPath(drawingPath);
		const dRels = relsOf(files, dRelsPath);
		let dx = strFromU8(files[drawingPath]);
		let frameId = 1000;
		for (const ch of charts) {
			chartN++;
			const chartPath = `xl/charts/chart${chartN}.xml`;
			files[chartPath] = strToU8(chartXml(ch, seriesRefs(wb, ch, text)));
			addOverride(chartPath, CT_CHART);
			const rid = nextId(dRels);
			dRels.push({ Id: rid, Type: REL_CHART, Target: relative(drawingPath, chartPath) });
			dx = dx.replace(/<\/xdr:wsDr>\s*$/, `${anchorXml(s, ch.anchor, ch.w, ch.h, rid, ++frameId, ch.title || `Chart ${chartN}`)}</xdr:wsDr>`);
		}
		files[drawingPath] = strToU8(dx);
		files[dRelsPath] = strToU8(writeRels(dRels));
	}
	files['[Content_Types].xml'] = strToU8(ct);
	return zipSync(files, { level: 6 });
}

// ---------- Import ----------

type Any = Record<string, unknown> & { val?: string };
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

function textOf(tx: unknown): string | undefined {
	const t = tx as { rich?: { p?: { r?: { t?: unknown }[] }[] }; strRef?: { strCache?: { pt?: { v?: unknown }[] } } } | undefined;
	if (!t) return undefined;
	const runs = arr(t.rich?.p).flatMap((p) => arr(p.r).map((r) => String(r.t ?? '')));
	if (runs.length) return runs.join('');
	const v = arr(t.strRef?.strCache?.pt)[0]?.v;
	return v === undefined ? undefined : String(v);
}

function refRange(f: string | undefined): { sheet: string; g: Range } | null {
	if (!f) return null;
	const ast = tryParse(String(f).replace(/^\(|\)$/g, ''));
	if (!ast || ast.t !== 'ref' || ast.sheet === undefined || ast.a.r === undefined || ast.a.c === undefined) return null;
	const b = ast.b ?? ast.a;
	return { sheet: ast.sheet, g: { r1: Math.min(ast.a.r, b.r ?? ast.a.r), c1: Math.min(ast.a.c, b.c ?? ast.a.c), r2: Math.max(ast.a.r, b.r ?? ast.a.r), c2: Math.max(ast.a.c, b.c ?? ast.a.c) } };
}

const TYPE_MAP: Record<string, ChartType> = {
	barChart: 'column',
	bar3DChart: 'column',
	lineChart: 'line',
	line3DChart: 'line',
	areaChart: 'area',
	area3DChart: 'area',
	pieChart: 'pie',
	pie3DChart: 'pie',
	ofPieChart: 'pie',
	doughnutChart: 'doughnut',
	scatterChart: 'scatter',
	bubbleChart: 'scatter',
	radarChart: 'line',
	stockChart: 'line'
};

export type ImportedCharts = { simplified: boolean; count: number };

/** Adds the charts found in the xlsx to the (already imported) workbook. */
export function readChartsFromXlsx(bytes: Uint8Array, wb: Workbook): ImportedCharts {
	const files = unzipSync(bytes);
	if (!Object.keys(files).some((f) => f.startsWith('xl/charts/'))) return { simplified: false, count: 0 };
	const parts = sheetParts(files);
	let simplified = false;
	let count = 0;
	for (const [name, sheetPath] of parts) {
		const s = sheetByName(wb, name);
		if (!s) continue;
		const drawingRel = relsOf(files, relsPath(sheetPath)).find((r) => r.Type === REL_DRAWING);
		if (!drawingRel) continue;
		const drawingPath = resolve(sheetPath, drawingRel.Target);
		if (!files[drawingPath]) continue;
		const dRels = relsOf(files, relsPath(drawingPath));
		const d = parser.parse(strFromU8(files[drawingPath]));
		const anchors = [...arr(d.wsDr?.twoCellAnchor), ...arr(d.wsDr?.oneCellAnchor)] as Any[];
		const { rows, cols } = axesOf(s);
		for (const an of anchors) {
			const gf = an.graphicFrame as Any | undefined;
			const rid = (gf?.graphic as Any | undefined)?.graphicData as Any | undefined;
			const chartRef = rid?.chart as Any | undefined;
			const id = chartRef?.id as string | undefined;
			if (!id) continue;
			const rel = dRels.find((r) => r.Id === id && r.Type === REL_CHART);
			if (!rel) continue;
			const cx = parser.parse(strFromU8(files[resolve(drawingPath, rel.Target)] ?? new Uint8Array()));
			const chart = cx.chartSpace?.chart as Any | undefined;
			const plot = chart?.plotArea as Any | undefined;
			if (!plot) continue;
			const kind = Object.keys(plot).find((k) => k in TYPE_MAP);
			if (!kind) {
				simplified = true;
				continue;
			}
			if (Object.keys(plot).filter((k) => k in TYPE_MAP).length > 1 || ['bubbleChart', 'radarChart', 'stockChart', 'ofPieChart'].includes(kind) || kind.includes('3D')) simplified = true;
			const node = arr(plot[kind] as Any | Any[])[0];
			let type = TYPE_MAP[kind];
			if (kind.startsWith('bar') && (node.barDir as Any | undefined)?.val === 'bar') type = 'bar';
			const grouping = (node.grouping as Any | undefined)?.val;
			const sers = arr(node.ser as Any | Any[]);
			// Source = bounding box of all referenced cells on one sheet.
			const refs: { sheet: string; g: Range; role: 'tx' | 'cat' | 'val' }[] = [];
			const colors: string[] = [];
			for (const ser of sers) {
				const tx = (ser.tx as Any | undefined)?.strRef as Any | undefined;
				const cat = (ser.cat ?? ser.xVal) as Any | undefined;
				const val = (ser.val ?? ser.yVal) as Any | undefined;
				const tr = refRange(tx?.f as string | undefined);
				const cr = refRange(((cat?.strRef ?? cat?.numRef) as Any | undefined)?.f as string | undefined);
				const vr = refRange((val?.numRef as Any | undefined)?.f as string | undefined);
				if (tr) refs.push({ ...tr, role: 'tx' });
				if (cr) refs.push({ ...cr, role: 'cat' });
				if (vr) refs.push({ ...vr, role: 'val' });
				const clr = ((((ser.spPr as Any | undefined)?.solidFill as Any | undefined)?.srgbClr as Any | undefined)?.val ?? (((((ser.spPr as Any | undefined)?.ln as Any | undefined)?.solidFill as Any | undefined)?.srgbClr as Any | undefined)?.val)) as string | undefined;
				if (clr) colors.push(`#${String(clr).toLowerCase()}`);
			}
			const vals = refs.filter((r) => r.role === 'val');
			if (!vals.length) {
				simplified = true;
				continue;
			}
			const sheetName = vals[0].sheet;
			const same = refs.filter((r) => r.sheet.toLowerCase() === sheetName.toLowerCase());
			const box = same.reduce((a, r) => ({ r1: Math.min(a.r1, r.g.r1), c1: Math.min(a.c1, r.g.c1), r2: Math.max(a.r2, r.g.r2), c2: Math.max(a.c2, r.g.c2) }), { ...vals[0].g });
			const v0 = vals[0].g;
			const seriesIn: 'cols' | 'rows' = v0.c1 === v0.c2 && v0.r2 > v0.r1 ? 'cols' : v0.r1 === v0.r2 && v0.c2 > v0.c1 ? 'rows' : 'cols';
			const hasTx = same.some((r) => r.role === 'tx');
			const hasCat = same.some((r) => r.role === 'cat');
			const source = {
				range: `${quoteSheet(sheetName)}!${colName(box.c1)}${box.r1 + 1}:${colName(box.c2)}${box.r2 + 1}`,
				seriesIn,
				headerRow: seriesIn === 'cols' ? hasTx : hasCat,
				headerCol: seriesIn === 'cols' ? hasCat : hasTx
			};
			if (type === 'scatter' && !hasCat) source[seriesIn === 'cols' ? 'headerCol' : 'headerRow'] = false;
			const from = an.from as Any | undefined;
			const to = an.to as Any | undefined;
			const num = (x: unknown) => Number(x ?? 0) || 0;
			const fc = num(from?.col);
			const fr = num(from?.row);
			const x1 = cols.offset(fc) + num(from?.colOff) / EMU;
			const y1 = rows.offset(fr) + num(from?.rowOff) / EMU;
			const ext = an.ext as Any | undefined;
			const x2 = to ? cols.offset(num(to.col)) + num(to.colOff) / EMU : x1 + num(ext?.cx) / EMU;
			const y2 = to ? rows.offset(num(to.row)) + num(to.rowOff) / EMU : y1 + num(ext?.cy) / EMU;
			const legendPos = ((chart?.legend as Any | undefined)?.legendPos as Any | undefined)?.val;
			const axTitle = (k: 'catAx' | 'valAx', i = 0) => textOf((arr(plot[k] as Any | Any[])[i]?.title as Any | undefined)?.tx);
			const valAx = arr(plot.valAx as Any | Any[]);
			const scal = (valAx[type === 'scatter' ? 1 : 0]?.scaling ?? {}) as Any;
			const obj: ChartObject = {
				id: crypto.randomUUID(),
				kind: 'chart',
				type,
				stacked: grouping === 'percentStacked' ? 'percent' : grouping === 'stacked' ? true : undefined,
				source,
				title: textOf((chart?.title as Any | undefined)?.tx),
				legend: !chart?.legend ? 'none' : legendPos === 't' ? 'top' : legendPos === 'r' ? 'right' : 'bottom',
				xTitle: type === 'scatter' ? textOf((valAx[0]?.title as Any | undefined)?.tx) : axTitle('catAx'),
				yTitle: type === 'scatter' ? textOf((valAx[1]?.title as Any | undefined)?.tx) : axTitle('valAx'),
				yMin: (scal.min as Any | undefined)?.val !== undefined ? Number((scal.min as Any).val) : undefined,
				yMax: (scal.max as Any | undefined)?.val !== undefined ? Number((scal.max as Any).val) : undefined,
				colors: colors.length && type !== 'pie' && type !== 'doughnut' ? colors : undefined,
				anchor: { r: fr, c: fc, dx: Math.round(x1 - cols.offset(fc)), dy: Math.round(y1 - rows.offset(fr)) },
				w: Math.max(40, Math.round(x2 - x1)),
				h: Math.max(30, Math.round(y2 - y1))
			};
			for (const k of Object.keys(obj) as (keyof ChartObject)[]) if (obj[k] === undefined) delete obj[k];
			s.objects.push(obj);
			count++;
		}
	}
	return { simplified, count };
}

export { valueText };
