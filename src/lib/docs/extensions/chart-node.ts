// Chart block in documents: options + copied data (no link to the source sheet). Schema only; the editor adds a
// node view that renders it with Chart.js (components/docs/chart-view.ts). HTML form: <figure data-chart="{json}">.
import { Node } from '@tiptap/core';
import type { ChartData } from '../../sheets/charts.ts';
import type { ChartOptions } from '../../sheets/model.ts';

export type DocChartAttrs = { options: ChartOptions; data: ChartData; width: number; height: number; origin?: string };

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		chart: {
			insertChart: (attrs: DocChartAttrs) => ReturnType;
		};
	}
}

export const ChartNode = Node.create({
	name: 'chart',
	group: 'block',
	atom: true,
	draggable: true,
	selectable: true,
	addAttributes() {
		return {
			options: { default: { type: 'column', legend: 'bottom' } },
			data: { default: { labels: [], series: [] } },
			width: { default: 520 },
			height: { default: 300 },
			origin: { default: null }
		};
	},
	parseHTML() {
		return [
			{
				tag: 'figure[data-chart]',
				getAttrs: (el) => {
					try {
						return JSON.parse((el as HTMLElement).getAttribute('data-chart') ?? '{}');
					} catch {
						return false;
					}
				}
			}
		];
	},
	renderHTML({ node }) {
		return ['figure', { 'data-chart': JSON.stringify(node.attrs), class: 'mai-chart' }, node.attrs.options?.title ?? ''];
	},
	addCommands() {
		return {
			insertChart:
				(attrs) =>
				({ commands }) =>
					commands.insertContent({ type: 'chart', attrs })
		};
	}
});
