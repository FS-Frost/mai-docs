<script lang="ts">
	// One slide element drawn in logical slide coordinates (no interaction).
	import { geomPath } from '../../slides/geometry.ts';
	import { cssFill, resolveColor, resolveFont, type El, type Theme } from '../../slides/model.ts';
	import { mediaUrl, textHtml } from '../../slides/render.svelte.ts';
	import { t } from '../../i18n/index.svelte.ts';

	let { el, theme, hideText = false, placeholders = false }: { el: El; theme: Theme; hideText?: boolean; placeholders?: boolean } = $props();

	const transform = $derived(`${el.rot ? `rotate(${el.rot}deg)` : ''}${el.flipH ? ' scaleX(-1)' : ''}${el.flipV ? ' scaleY(-1)' : ''}`.trim());
	const font = (f: string) => `'${resolveFont(theme, f)}', ${f === 'major' || /Georgia|Cambria|Palatino/.test(resolveFont(theme, f)) ? 'Georgia, serif' : 'Arial, Helvetica, sans-serif'}`;
	const empty = $derived(el.kind === 'shape' && (!el.text || !el.text.content?.some((n) => n.content?.length)));
</script>

<div class="absolute" style="left:{el.x}px;top:{el.y}px;width:{el.w}px;height:{el.h}px;{transform ? `transform:${transform};` : ''}">
	{#if el.kind === 'image'}
		{@const url = mediaUrl(el.blobId)}
		{#if url}<img src={url} alt={el.alt ?? ''} draggable="false" class="pointer-events-none block h-full w-full select-none" style="object-fit:fill" />{:else}<div class="h-full w-full bg-black/5"></div>{/if}
	{:else}
		{#if el.geom !== 'rect' || el.fill.type !== 'none' || el.line}
			<svg class="pointer-events-none absolute inset-0 overflow-visible" width={el.w} height={el.h} viewBox="0 0 {Math.max(1, el.w)} {Math.max(1, el.h)}" preserveAspectRatio="none" aria-hidden="true">
				<path
					d={geomPath(el.geom, el.w, el.h)}
					fill={el.geom === 'line' ? 'none' : cssFill(theme, el.fill)}
					stroke={el.line ? resolveColor(theme, el.line.color) : el.geom === 'line' ? resolveColor(theme, 'dk1') : 'none'}
					stroke-width={el.line?.width ?? (el.geom === 'line' ? 2 : 0)}
					stroke-dasharray={el.line?.dash === 'dash' ? `${(el.line.width || 1) * 4} ${(el.line.width || 1) * 3}` : el.line?.dash === 'dot' ? `${el.line.width || 1} ${(el.line.width || 1) * 2}` : undefined}
					vector-effect="non-scaling-stroke"
				/>
			</svg>
		{/if}
		{#if el.geom !== 'line' && !hideText}
			<div
				class="slide-text absolute inset-0 flex flex-col overflow-hidden"
				style="padding:{el.inset}px;justify-content:{el.anchor === 'middle' ? 'center' : el.anchor === 'bottom' ? 'flex-end' : 'flex-start'};font-family:{font(el.textStyle.font)};font-size:{el.textStyle.size}pt;color:{resolveColor(theme, el.textStyle.color)};font-weight:{el.textStyle.bold ? 700 : 400};text-align:{el.textStyle.align ?? 'left'}"
			>
				{#if !empty}
					<div>{@html textHtml(el.text)}</div>
				{:else if placeholders && el.ph}
					<div class="opacity-45">{t().slides.placeholders[el.ph]}</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>
