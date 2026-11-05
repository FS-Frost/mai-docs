<script lang="ts">
	// One slide element drawn in logical slide coordinates (no interaction). `live` = presenting (media controls on).
	// The outer box carries the entrance animation, the inner one the rotation/flip.
	import { geomPath, scalePath } from '../../slides/geometry.ts';
	import { cssColor, cssFill, resolveColor, resolveFont, type Anim, type El, type ShapeEl, type TableEl, type TextBase, type Theme } from '../../slides/model.ts';
	import { iconInner } from '../../slides/icons.ts';
	import { chartColors, mediaUrl, textHtml } from '../../slides/render.svelte.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import ChartView from '../charts/ChartView.svelte';
	import Icon from '../Icon.svelte';

	let {
		el,
		theme,
		bg = '#ffffff',
		size,
		hideText = false,
		hideCell = null,
		placeholders = false,
		live = false,
		hidden = false,
		enter = null,
		thumb = false
	}: {
		el: El;
		theme: Theme;
		bg?: string;
		size?: { w: number; h: number };
		hideText?: boolean;
		hideCell?: string | null;
		placeholders?: boolean;
		live?: boolean;
		hidden?: boolean;
		enter?: Anim | null;
		thumb?: boolean;
	} = $props();

	const transform = $derived(`${el.rot ? `rotate(${el.rot}deg)` : ''}${el.flipH ? ' scaleX(-1)' : ''}${el.flipV ? ' scaleY(-1)' : ''}`.trim());
	const SERIF = /Georgia|Cambria|Palatino|Times|Garamond|Book|Serif/i;
	const font = (f: string) => `'${resolveFont(theme, f)}', ${SERIF.test(resolveFont(theme, f)) ? 'Georgia, serif' : 'Arial, Helvetica, sans-serif'}`;
	const isEmpty = (doc: ShapeEl['text']) => !doc || !doc.content?.some((n) => n.content?.length);
	const textCss = (s: TextBase, color = resolveColor(theme, s.color)) =>
		`font-family:${font(s.font)};font-size:${s.size}pt;color:${color};font-weight:${s.bold ? 700 : 400};text-align:${s.align ?? 'left'}`;
	const anchorCss = (a?: string) => `justify-content:${a === 'middle' ? 'center' : a === 'bottom' ? 'flex-end' : 'flex-start'}`;
	const shadow = $derived.by(() => {
		const s = el.shadow;
		if (!s) return '';
		const rad = (s.dir * Math.PI) / 180;
		return `filter:drop-shadow(${Math.round(Math.cos(rad) * s.dist)}px ${Math.round(Math.sin(rad) * s.dist)}px ${Math.round(s.blur / 2)}px ${cssColor(theme, s.color, s.alpha)});`;
	});
	const enterCss = $derived.by(() => {
		if (hidden) return 'visibility:hidden;';
		if (!enter || enter.effect === 'appear') return '';
		const sw = size?.w ?? 1280;
		const sh = size?.h ?? 720;
		const d = enter.dir ?? 'd';
		const fx = d === 'l' ? -(el.x + el.w) : d === 'r' ? sw - el.x : 0;
		const fy = d === 'u' ? -(el.y + el.h) : d === 'd' ? sh - el.y : 0;
		const name = enter.effect === 'fly' ? 'mai-fly' : enter.effect === 'zoom' ? 'mai-zoom' : enter.effect === 'wipe' ? `mai-wipe-${d}` : 'mai-fade';
		return `--fx:${fx}px;--fy:${fy}px;animation:${name} ${enter.dur}ms ease-out ${enter.delay ?? 0}ms both;`;
	});

	// Shapes: fill as a clipped CSS background (gradients, pictures), outline as SVG on top.
	const shapePath = (s: ShapeEl) => (s.geom === 'custom' && s.paths?.length ? s.paths.filter((p) => p.fill !== false).map((p) => scalePath(p, s.w, s.h)).join(' ') : geomPath(s.geom, Math.max(1, s.w), Math.max(1, s.h)));
	const strokePaths = (s: ShapeEl) => (s.geom === 'custom' && s.paths?.length ? s.paths.filter((p) => p.stroke !== false).map((p) => scalePath(p, s.w, s.h)) : [geomPath(s.geom, Math.max(1, s.w), Math.max(1, s.h))]);
	const isLine = (s: ShapeEl) => s.geom === 'line' || s.geom === 'straightConnector1' || s.geom === 'bentConnector3';
	const dash = (l: NonNullable<ShapeEl['line']>) => (l.dash === 'dash' ? `${(l.width || 1) * 4} ${(l.width || 1) * 3}` : l.dash === 'dot' ? `${l.width || 1} ${(l.width || 1) * 2}` : undefined);

	function cellBg(tb: TableEl, r: number, c: number) {
		const cell = tb.cells[r]?.[c];
		if (cell?.fill) return cssFill(theme, cell.fill, mediaUrl);
		if (tb.firstRow && r === 0) return resolveColor(theme, 'accent1');
		if (tb.bandRow && r % 2 === (tb.firstRow ? 1 : 0)) return cssColor(theme, 'accent1', 0.12);
		return 'transparent';
	}
</script>

<div class="absolute" style="left:{el.x}px;top:{el.y}px;width:{el.w}px;height:{el.h}px;{enterCss}">
	<div class="absolute inset-0" style="{transform ? `transform:${transform};` : ''}{shadow}">
		{#if el.kind === 'image'}
			{@const url = mediaUrl(el.blobId)}
			{#if url}
				{#if el.crop}
					{@const c = el.crop}
					<div class="h-full w-full overflow-hidden">
						<img src={url} alt={el.alt ?? ''} draggable="false" class="pointer-events-none block max-w-none select-none" style="width:{100 / Math.max(0.01, 1 - c.l - c.r)}%;height:{100 / Math.max(0.01, 1 - c.t - c.b)}%;margin-left:{(-c.l / Math.max(0.01, 1 - c.l - c.r)) * 100}%;margin-top:{(-c.t / Math.max(0.01, 1 - c.t - c.b)) * el.h}px" />
					</div>
				{:else}
					<img src={url} alt={el.alt ?? ''} draggable="false" class="pointer-events-none block h-full w-full select-none" style="object-fit:fill" />
				{/if}
			{:else}<div class="h-full w-full bg-black/5"></div>{/if}
		{:else if el.kind === 'shape'}
			{@const line = isLine(el)}
			{#if !line && el.fill.type !== 'none'}
				<div class="pointer-events-none absolute inset-0" style="background:{cssFill(theme, el.fill, mediaUrl)};{el.geom === 'rect' || el.geom === 'flowChartProcess' ? '' : `clip-path:path('${shapePath(el)}');`}"></div>
			{/if}
			{#if el.line || line}
				<svg class="pointer-events-none absolute top-0 left-0 overflow-visible" width={Math.max(1, el.w)} height={Math.max(1, el.h)} viewBox="0 0 {Math.max(1, el.w)} {Math.max(1, el.h)}" preserveAspectRatio="none" aria-hidden="true">
					{#each strokePaths(el) as d, i (i)}
						<path {d} fill="none" stroke={el.line ? resolveColor(theme, el.line.color) : resolveColor(theme, 'dk1')} stroke-width={el.line?.width ?? 2} stroke-dasharray={el.line ? dash(el.line) : undefined} vector-effect="non-scaling-stroke" />
					{/each}
				</svg>
			{/if}
			{#if !line && !hideText}
				<div class="slide-text absolute inset-0 flex flex-col overflow-hidden" style="padding:{el.inset}px;{anchorCss(el.anchor)};{textCss(el.textStyle)}">
					{#if !isEmpty(el.text)}
						<div>{@html textHtml(el.text)}</div>
					{:else if placeholders && el.ph}
						<div class="opacity-45">{t().slides.placeholders[el.ph]}</div>
					{/if}
				</div>
			{/if}
		{:else if el.kind === 'table'}
			{@const bw = el.border ? el.border.width : 0}
			<table class="slide-table h-full w-full border-collapse" style="table-layout:fixed;{textCss(el.textStyle)}">
				<colgroup>{#each el.cols as w, i (i)}<col style="width:{w}px" />{/each}</colgroup>
				<tbody>
					{#each el.rows as h, r (r)}
						<tr style="height:{h}px">
							{#each el.cols as _, c (c)}
								{@const cell = el.cells[r]?.[c]}
								{#if !cell?.hidden}
									<td
										colspan={cell?.colSpan ?? 1}
										rowspan={cell?.rowSpan ?? 1}
										data-cell="{r}:{c}"
										class="overflow-hidden p-0 align-top"
										style="background:{cellBg(el, r, c)};{bw ? `border:${bw}px ${el.border?.dash === 'dash' ? 'dashed' : el.border?.dash === 'dot' ? 'dotted' : 'solid'} ${resolveColor(theme, el.border!.color)};` : ''}{el.firstRow && r === 0 ? `color:${resolveColor(theme, 'lt1')};font-weight:700;` : ''}vertical-align:{cell?.anchor === 'middle' ? 'middle' : cell?.anchor === 'bottom' ? 'bottom' : 'top'}"
									>
										{#if hideCell !== `${r}:${c}`}<div class="slide-text px-1.5 py-1">{@html textHtml(cell?.text)}</div>{/if}
									</td>
								{/if}
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		{:else if el.kind === 'chart'}
			<div class="pointer-events-none h-full w-full">
				<ChartView options={el.options} data={el.data} colors={chartColors(theme, bg)} animate={live} />
			</div>
		{:else if el.kind === 'media'}
			{@const url = mediaUrl(el.blobId)}
			{@const poster = el.posterBlobId ? mediaUrl(el.posterBlobId) : undefined}
			{#if el.media === 'video'}
				{#if live && url}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video src={url} {poster} class="h-full w-full bg-black object-contain" controls autoplay={el.autoplay} loop={el.loop} data-media></video>
				{:else if poster}
					<img src={poster} alt={el.fileName ?? ''} class="pointer-events-none h-full w-full object-contain" draggable="false" />
				{:else if url && !thumb}
					<video src={url} class="pointer-events-none h-full w-full bg-black object-contain" preload="metadata" muted></video>
				{:else}
					<div class="grid h-full w-full place-items-center bg-black text-white/70"><Icon name="video" size={Math.max(16, Math.min(el.w, el.h) / 3)} /></div>
				{/if}
			{:else if live && url}
				<audio src={url} class="h-full w-full" controls autoplay={el.autoplay} loop={el.loop} data-media></audio>
			{:else}
				<div class="grid h-full w-full place-items-center rounded-lg" style="background:{cssColor(theme, 'accent1', 0.15)};color:{resolveColor(theme, 'accent1')}"><Icon name="audio" size={Math.max(16, Math.min(el.w, el.h) / 2)} /></div>
			{/if}
		{:else if el.kind === 'icon'}
			<svg class="pointer-events-none block h-full w-full" viewBox="0 0 24 24" fill="none" stroke={resolveColor(theme, el.color)} stroke-width={el.stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html iconInner(el.nodes)}</svg>
		{/if}
	</div>
</div>
