// Chart.js config from our model (shared by the sheet grid, document chart nodes and PNG export).
// Marks follow the dataviz skill: thin bars with 4px rounded data ends, 2px lines, 8px markers,
// recessive grid, legend only for >= 2 series, fixed palette order.
import type { Chart as ChartT, ChartConfiguration } from 'chart.js';
import type { ChartOptions } from '../sheets/model.ts';
import { PALETTE, type ChartData } from '../sheets/charts.ts';
import { displayText } from '../sheets/format.ts';
import type { Locale } from '../i18n/detect.ts';

type ChartCtor = typeof ChartT;
let lib: Promise<ChartCtor> | undefined;

/** Chart.js loaded on demand (separate chunk; precached by the service worker). */
export function loadChart(): Promise<ChartCtor> {
	return (lib ??= import('chart.js/auto').then((m) => m.default as unknown as ChartCtor));
}

export type Theme = { dark: boolean; text: string; muted: string; grid: string; surface: string };

export function themeFromCss(dark: boolean): Theme {
	const cs = getComputedStyle(document.documentElement);
	const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
	return { dark, text: v('--c-fg', dark ? '#e7e8eb' : '#1c1f26'), muted: v('--c-muted', dark ? '#a6abb6' : '#555b68'), grid: v('--c-grid', dark ? '#30343d' : '#e1e3e8'), surface: v('--c-surface', dark ? '#1d2027' : '#ffffff') };
}

/** Light theme on white paper (documents, PNG export). */
export const PAPER: Theme = { dark: false, text: '#1a1a1a', muted: '#52514e', grid: '#e6e6e3', surface: '#ffffff' };

export function seriesColor(o: Pick<ChartOptions, 'colors'>, i: number, dark: boolean) {
	return o.colors?.[i] || PALETTE[dark ? 'dark' : 'light'][i % PALETTE.light.length];
}

export function buildConfig(o: ChartOptions, d: ChartData, theme: Theme, locale: Locale): ChartConfiguration {
	const fmt = (v: number) => displayText(v, d.numFmt, locale);
	const pie = o.type === 'pie' || o.type === 'doughnut';
	const percent = o.stacked === 'percent';
	const stacked = !!o.stacked && !pie && o.type !== 'scatter';
	let series = d.series;
	if (percent) {
		const totals = d.labels.map((_, i) => series.reduce((s, x) => s + Math.abs(x.values[i] ?? 0), 0));
		series = series.map((s) => ({ ...s, values: s.values.map((v, i) => (v === null || !totals[i] ? null : (Math.abs(v) / totals[i]) * 100)) }));
	}
	const color = (i: number) => seriesColor(o, i, theme.dark);
	let datasets: ChartConfiguration['data']['datasets'];
	if (pie) {
		const s = series[0] ?? { name: '', values: [] };
		datasets = [
			{
				label: s.name,
				data: s.values.map((v) => (v === null ? 0 : Math.max(0, v))),
				backgroundColor: d.labels.map((_, i) => color(i)),
				borderColor: theme.surface,
				borderWidth: 2
			}
		];
	} else if (o.type === 'scatter') {
		datasets = series.map((s, i) => ({
			label: s.name,
			data: s.values.map((y, k) => ({ x: d.xs?.[k] ?? k + 1, y })).filter((p) => p.y !== null && p.x !== null) as { x: number; y: number }[],
			backgroundColor: color(i),
			borderColor: theme.surface,
			borderWidth: 2,
			pointRadius: 4,
			pointHoverRadius: 6
		}));
	} else {
		const line = o.type === 'line' || o.type === 'area';
		datasets = series.map((s, i) => ({
			label: s.name,
			data: s.values,
			backgroundColor: o.type === 'area' ? color(i) + '55' : color(i),
			borderColor: line ? color(i) : theme.surface,
			borderWidth: line ? 2 : 0,
			borderRadius: line ? undefined : 4,
			borderSkipped: line ? undefined : 'start',
			fill: o.type === 'area' ? (stacked && i > 0 ? '-1' : 'origin') : false,
			pointRadius: line ? (d.labels.length > 40 ? 0 : 4) : undefined,
			pointHoverRadius: line ? 6 : undefined,
			spanGaps: false,
			tension: 0
		})) as ChartConfiguration['data']['datasets'];
	}
	const showLegend = o.legend !== 'none' && (pie || series.length >= 2);
	const axis = (title?: string, min?: number, max?: number, isValue = false) => ({
		stacked,
		min: isValue ? (percent ? 0 : min) : undefined,
		max: isValue ? (percent ? 100 : max) : undefined,
		title: { display: !!title, text: title ?? '', color: theme.muted },
		grid: { color: theme.grid, drawTicks: false, display: isValue },
		border: { display: !isValue, color: theme.grid },
		// Category axes keep Chart.js' default callback (labels); only value axes format numbers.
		ticks: isValue ? { color: theme.muted, padding: 6, callback: (v: string | number) => (percent ? `${v}%` : fmt(Number(v))) } : { color: theme.muted, padding: 6 }
	});
	const horizontal = o.type === 'bar';
	const type = pie ? o.type : o.type === 'scatter' ? 'scatter' : o.type === 'column' || o.type === 'bar' ? 'bar' : 'line';
	return {
		type: type as 'bar',
		data: { labels: o.type === 'scatter' ? undefined : d.labels, datasets },
		options: {
			responsive: true,
			maintainAspectRatio: false,
			animation: false,
			indexAxis: horizontal ? 'y' : 'x',
			color: theme.text,
			font: { family: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', size: 12 },
			layout: { padding: 8 },
			cutout: o.type === 'doughnut' ? '55%' : undefined,
			plugins: {
				title: { display: !!o.title, text: o.title ?? '', color: theme.text, font: { size: 14, weight: 600 }, padding: { bottom: 8 } },
				legend: { display: showLegend, position: o.legend === 'none' ? 'bottom' : o.legend, labels: { color: theme.text, boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 2 } },
				tooltip: {
					callbacks: {
						label: (ctx) => {
							const raw = ctx.raw as number | { x: number; y: number } | null;
							const v = typeof raw === 'object' && raw ? raw.y : (raw as number);
							const name = pie ? String(ctx.label ?? '') : ctx.dataset.label;
							return `${name}: ${v === null || v === undefined ? '—' : percent ? `${Number(v).toFixed(1)}%` : fmt(Number(v))}`;
						}
					}
				}
			},
			scales: pie
				? {}
				: horizontal
					? { x: axis(o.yTitle, o.yMin, o.yMax, true), y: axis(o.xTitle) }
					: { x: o.type === 'scatter' ? { ...axis(o.xTitle, undefined, undefined, true), grid: { color: theme.grid, display: true } } : axis(o.xTitle), y: axis(o.yTitle, o.yMin, o.yMax, true) }
		}
	} as ChartConfiguration;
}

/** Renders a chart to a PNG blob (documents, docx export). */
export async function renderChartPng(o: ChartOptions, d: ChartData, w: number, h: number, locale: Locale, scale = 2): Promise<Blob> {
	const Chart = await loadChart();
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(w * scale);
	canvas.height = Math.round(h * scale);
	canvas.style.width = `${w}px`;
	canvas.style.height = `${h}px`;
	const holder = document.createElement('div');
	holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px`;
	holder.append(canvas);
	document.body.append(holder);
	const cfg = buildConfig(o, d, PAPER, locale);
	cfg.options = { ...cfg.options, responsive: false, devicePixelRatio: scale };
	const plugin = { id: 'bg', beforeDraw: (c: ChartT) => {
		const ctx = c.ctx;
		ctx.save();
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, c.width, c.height);
		ctx.restore();
	} };
	cfg.plugins = [plugin];
	canvas.width = w;
	canvas.height = h;
	const chart = new Chart(canvas, cfg);
	const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
	chart.destroy();
	holder.remove();
	if (!blob) throw new Error('png');
	return blob;
}
