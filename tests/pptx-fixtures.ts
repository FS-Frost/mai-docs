// Synthetic .pptx test set written the way PowerPoint structures its packages (theme, master with
// decorations and text styles, layouts, clrMap, style references, mc:AlternateContent, p14 extensions…).
import { strToU8, zipSync } from 'fflate';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

const rels = (list: [string, string, string][]) => `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : `${R}/${type}`}" Target="${target}"/>`).join('')}</Relationships>`;

const THEME = `${X}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const sp = (id: number, name: string, nvPr: string, spPr: string, tx = '', style = '') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${nvPr}</p:nvPr></p:nvSpPr><p:spPr>${spPr}</p:spPr>${style}${tx}</p:sp>`;
const xf = (x: number, y: number, w: number, h: number, extra = '') => `<a:xfrm${extra}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
const tx = (paras: string, body = '<a:bodyPr/>') => `<p:txBody>${body}<a:lstStyle/>${paras}</p:txBody>`;
const run = (t: string, rpr = '<a:rPr lang="en-US" dirty="0"/>') => `<a:r>${rpr}<a:t>${t}</a:t></a:r>`;
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';

/** Master: title/body placeholders with positions, a decoration bar and a logo, PowerPoint-like text styles. */
const MASTER = `${X}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}` +
	sp(2, 'Title Placeholder 1', '<p:ph type="title"/>', xf(838200, 365125, 10515600, 1325563), tx('<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit</a:t></a:r></a:p>', '<a:bodyPr anchor="ctr"/>')) +
	sp(3, 'Text Placeholder 2', '<p:ph type="body" idx="1"/>', xf(838200, 1825625, 10515600, 4351338), tx('<a:p><a:endParaRPr lang="en-US"/></a:p>')) +
	sp(7, 'Deco bar', '', `${xf(0, 6400800, 12192000, 457200)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln><a:noFill/></a:ln>`) +
	`<p:pic><p:nvPicPr><p:cNvPr id="8" name="Logo"/><p:cNvPicPr/><p:nvPr userDrawn="1"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xf(11277600, 6477000, 304800, 304800)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
	`</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
	`<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>` +
	`<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600" algn="l"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="685800" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle>` +
	`<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

/** Layout "Title and Content": overrides the title color and adds its own decoration. */
const LAYOUT = `${X}<p:sldLayout ${NS} type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree>${GRP}` +
	sp(2, 'Title 1', '<p:ph type="title"/>', '', tx('<a:p><a:endParaRPr lang="en-US"/></a:p>', '<a:bodyPr/>').replace('<a:lstStyle/>', '<a:lstStyle><a:lvl1pPr><a:defRPr><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle>')) +
	sp(3, 'Content Placeholder 2', '<p:ph idx="1"/>', '', tx('<a:p><a:endParaRPr lang="en-US"/></a:p>')) +
	sp(9, 'Layout stripe', '', `${xf(0, 0, 152400, 6858000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent2"/></a:solidFill>`) +
	`</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

export type Fixture = { slides: string[]; slideRels?: [string, string, string][][]; extra?: Record<string, string | Uint8Array>; size?: [number, number]; notes?: (string | null)[] };

/** Builds a package: theme + master + one layout + the given slide XML bodies (inside <p:sld>). */
export function buildPptx(f: Fixture): Uint8Array {
	const files: Record<string, Uint8Array> = {};
	const put = (p: string, s: string | Uint8Array) => (files[p] = typeof s === 'string' ? strToU8(s) : s);
	const [cx, cy] = f.size ?? [12192000, 6858000];
	put('ppt/theme/theme1.xml', THEME);
	put('ppt/slideMasters/slideMaster1.xml', MASTER);
	put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml'], ['rId3', 'image', '../media/logo.png']]));
	put('ppt/media/logo.png', PNG);
	put('ppt/slideLayouts/slideLayout1.xml', LAYOUT);
	put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
	f.slides.forEach((body, i) => {
		const n = i + 1;
		put(`ppt/slides/slide${n}.xml`, `${X}<p:sld ${NS} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"${body.startsWith('HIDDEN') ? ' show="0"' : ''}>${body.replace(/^HIDDEN/, '')}</p:sld>`);
		const extra = f.slideRels?.[i] ?? [];
		const note = f.notes?.[i];
		const list: [string, string, string][] = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ...extra];
		if (note) {
			list.push([`rId${list.length + 1}`, 'notesSlide', `../notesSlides/notesSlide${n}.xml`]);
			put(`ppt/notesSlides/notesSlide${n}.xml`, `${X}<p:notes ${NS}><p:cSld><p:spTree>${GRP}${sp(2, 'Slide Image', '<p:ph type="sldImg"/>', '')}${sp(3, 'Notes', '<p:ph type="body" idx="1"/>', '', tx(note.split('\n').map((l) => `<a:p>${run(l)}</a:p>`).join('')))}</p:spTree></p:cSld></p:notes>`);
		}
		put(`ppt/slides/_rels/slide${n}.xml.rels`, rels(list));
	});
	for (const [p, s] of Object.entries(f.extra ?? {})) put(p, s);
	const N = f.slides.length;
	put('ppt/presentation.xml', `${X}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${f.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
	put('ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...f.slides.map((_, i) => [`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`] as [string, string, string]), [`rId${N + 2}`, 'theme', 'theme/theme1.xml']]));
	put('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]));
	put('[Content_Types].xml', `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>`);
	return zipSync(files);
}

const tree = (s: string, bg = '') => `<p:cSld>${bg}<p:spTree>${GRP}${s}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`;

/** 1. Inheritance: placeholders without position/style on the slide, bullets from the master, deco shapes. */
export const fxInheritance = (): Fixture => ({
	slides: [
		tree(
			sp(2, 'Title 1', '<p:ph type="title"/>', '', tx(`<a:p>${run('Heredado')}</a:p>`)) +
				sp(3, 'Content 2', '<p:ph idx="1"/>', '', tx(`<a:p>${run('Uno')}</a:p><a:p><a:pPr lvl="1"/>${run('Sub')}</a:p><a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr>${run('Sin viñeta')}</a:p>`))
		)
	],
	notes: ['Nota uno\nNota dos']
});

/** 2. Shapes: unknown preset, custom geometry with arcTo, gradient, style refs, shadow, group scaling, connector. */
export const fxShapes = (): Fixture => ({
	slides: [
		tree(
			sp(4, 'Cloud', '', `${xf(914400, 914400, 1828800, 914400)}<a:prstGeom prst="cloud"><a:avLst/></a:prstGeom>`, tx(`<a:p>${run('Nube')}</a:p>`, '<a:bodyPr rtlCol="0" anchor="ctr"/>'), '<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>') +
				sp(5, 'Arc', '', `${xf(3657600, 914400, 914400, 914400)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="914400" h="914400"><a:moveTo><a:pt x="0" y="457200"/></a:moveTo><a:arcTo wR="457200" hR="457200" stAng="10800000" swAng="10800000"/><a:close/></a:path></a:pathLst></a:custGeom><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"><a:alpha val="50000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:effectLst><a:outerShdw blurRad="76200" dist="38100" dir="2700000"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>`) +
				`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="6096000" y="914400"/><a:ext cx="1828800" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="914400" cy="457200"/></a:xfrm></p:grpSpPr>` +
				sp(7, 'Child', '', `${xf(457200, 0, 457200, 457200)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent6"/></a:solidFill>`) +
				`</p:grpSp>` +
				`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="8" name="Connector"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xf(914400, 3657600, 3657600, 0)}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:prstDash val="dash"/></a:ln></p:spPr></p:cxnSp>`,
			'<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="bg1"/></a:gs><a:gs pos="100000"><a:schemeClr val="bg2"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>'
		)
	]
});

const CHART = `${X}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Ventas</a:t></a:r></a:p></c:rich></c:tx></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Norte</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></c:spPr><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>T1</c:v></c:pt><c:pt idx="1"><c:v>T2</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>4.5</c:v></c:pt><c:pt idx="1"><c:v>7</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart></c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>`;

/** 3. Table with merges and fills + a native chart. */
export const fxTableChart = (): Fixture => ({
	slides: [
		tree(
			`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table 3"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="5486400" cy="1483360"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="1828800"/><a:gridCol w="1828800"/><a:gridCol w="1828800"/></a:tblGrid>` +
				`<a:tr h="370840"><a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run('Unida', '<a:rPr lang="es-ES" sz="1400" b="1"/>')}</a:p></a:txBody><a:tcPr/></a:tc><a:tc hMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run('C')}</a:p></a:txBody><a:tcPr anchor="ctr"><a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill></a:tcPr></a:tc></a:tr>` +
				`<a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run('1')}</a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run('2')}</a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run('3')}</a:p></a:txBody><a:tcPr/></a:tc></a:tr>` +
				`</a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
				`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Chart 4"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="6400800" y="914400"/><a:ext cx="4572000" cy="2743200"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>`
		)
	],
	slideRels: [[['rId2', 'chart', '../charts/chart1.xml']]],
	extra: { 'ppt/charts/chart1.xml': CHART }
});

/** 4. SmartArt (drawing part) and an equation (AlternateContent with fallback picture). */
export const fxSmartArtMath = (): Fixture => ({
	slides: [
		tree(
			`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Diagram 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="4572000" cy="1828800"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId2" r:lo="rId3" r:qs="rId4" r:cs="rId5"/></a:graphicData></a:graphic></p:graphicFrame>` +
				`<mc:AlternateContent xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><mc:Choice Requires="a14">${sp(6, 'Equation', '', xf(914400, 4572000, 1828800, 457200), tx('<a:p><a14:m><m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"/></a14:m></a:p>'))}</mc:Choice><mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="6" name="Equation"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(914400, 4572000, 1828800, 457200)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rId7"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:spPr></p:sp></mc:Fallback></mc:AlternateContent>`
		)
	],
	slideRels: [[['rId2', 'diagramData', '../diagrams/data1.xml'], ['rId6', 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing', '../diagrams/drawing1.xml'], ['rId7', 'image', '../media/eq.png']]],
	extra: {
		'ppt/diagrams/data1.xml': `${X}<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>`,
		'ppt/diagrams/drawing1.xml': `${X}<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/><dsp:sp modelId="{1}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1371600" cy="914400"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES"/><a:t>Paso A</a:t></a:r></a:p></dsp:txBody></dsp:sp></dsp:spTree></dsp:drawing>`,
		'ppt/media/eq.png': PNG
	}
});

/** 5. Media: video with p14:media and poster, audio. */
export const fxMedia = (): Fixture => ({
	slides: [
		tree(
			`<p:pic><p:nvPicPr><p:cNvPr id="4" name="clip.mp4"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr><a:videoFile r:link="rId3"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media r:embed="rId2"/></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId4"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xf(914400, 914400, 3657600, 2057400)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
				`<p:pic><p:nvPicPr><p:cNvPr id="5" name="sound.mp3"/><p:cNvPicPr/><p:nvPr><a:audioFile r:link="rId6"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media r:embed="rId5"/></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId4"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xf(6096000, 914400, 609600, 609600)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
		)
	],
	slideRels: [
		[
			['rId2', 'http://schemas.microsoft.com/office/2007/relationships/media', '../media/media1.mp4'],
			['rId3', 'video', '../media/media1.mp4'],
			['rId4', 'image', '../media/poster.png'],
			['rId5', 'http://schemas.microsoft.com/office/2007/relationships/media', '../media/media2.mp3'],
			['rId6', 'audio', '../media/media2.mp3']
		]
	],
	extra: { 'ppt/media/media1.mp4': new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), 'ppt/media/media2.mp3': new Uint8Array([73, 68, 51]), 'ppt/media/poster.png': PNG }
});

const TIMING = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="5" presetID="2" presetClass="entr" presetSubtype="8" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="6" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="4"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="7" dur="750" fill="hold"/><p:tgtEl><p:spTgt spid="4"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_x</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="0-#ppt_w/2"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_x"/></p:val></p:tav></p:tavLst></p:anim></p:childTnLst></p:cTn></p:par><p:par><p:cTn id="8" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="withEffect"><p:stCondLst><p:cond delay="250"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="9" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="5"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="10" dur="500"/><p:tgtEl><p:spTgt spid="5"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par><p:par><p:cTn id="11" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="12" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="13" presetID="6" presetClass="emph" presetSubtype="0" fill="hold" grpId="1" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:animScale><p:cBhvr><p:cTn id="14" dur="2000" fill="hold"/><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cBhvr><p:by x="150000" y="150000"/></p:animScale></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="4" grpId="0" animBg="1"/><p:bldP spid="5" grpId="0" animBg="1"/><p:bldP spid="4" grpId="1" animBg="1"/></p:bldLst></p:timing>`;

/** 6. Transitions (p14 in AlternateContent), animations incl. an emphasis effect, hidden slide, 4:3. */
export const fxMotion = (): Fixture => ({
	size: [9144000, 6858000],
	slides: [
		tree(
			sp(4, 'A', '', `${xf(914400, 914400, 1828800, 914400)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill>`, tx(`<a:p>${run('A')}</a:p>`)) +
				sp(5, 'B', '', `${xf(914400, 2743200, 1828800, 914400)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent2"/></a:solidFill>`, tx(`<a:p>${run('B')}</a:p>`))
		) +
			`<mc:AlternateContent><mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="1250"><p:push dir="u"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:push dir="u"/></p:transition></mc:Fallback></mc:AlternateContent>` +
			TIMING,
		`HIDDEN${tree(sp(2, 'Title 1', '<p:ph type="title"/>', '', tx(`<a:p>${run('Oculta')}</a:p>`)))}<p:transition spd="fast"><p:fade/></p:transition>`
	]
});

export const FIXTURES = { fxInheritance, fxShapes, fxTableChart, fxSmartArtMath, fxMedia, fxMotion };
