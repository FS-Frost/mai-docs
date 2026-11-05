// Editor-only chart node: renders DocChart.svelte inside ProseMirror. Editing is requested with a bubbling
// `mai-edit-chart` DOM event (detail = node position) that the document page handles.
import { mount, unmount } from 'svelte';
import { ChartNode, type DocChartAttrs } from '../../docs/extensions/chart-node.ts';
import DocChart from './DocChart.svelte';

export const CHART_EDIT_EVENT = 'mai-edit-chart';

export const ChartNodeWithView = ChartNode.extend({
	addNodeView() {
		return ({ node, getPos, editor }) => {
			let current = node;
			const dom = document.createElement('div');
			dom.className = 'mai-chart-view';
			dom.contentEditable = 'false';
			const state = $state({ attrs: current.attrs as DocChartAttrs, selected: false });
			const pos = () => (typeof getPos === 'function' ? getPos() : undefined);
			const cmp = mount(DocChart, {
				target: dom,
				props: {
					box: state,
					editable: editor.isEditable,
					onedit: () => dom.dispatchEvent(new CustomEvent(CHART_EDIT_EVENT, { bubbles: true, detail: pos() })),
					onresize: (width: number, height: number) => {
						const p = pos();
						if (p === undefined) return;
						editor.view.dispatch(editor.state.tr.setNodeMarkup(p, undefined, { ...current.attrs, width, height }));
					}
				}
			});
			return {
				dom,
				update(n) {
					if (n.type.name !== 'chart') return false;
					current = n;
					state.attrs = n.attrs as DocChartAttrs;
					return true;
				},
				selectNode() {
					state.selected = true;
				},
				deselectNode() {
					state.selected = false;
				},
				stopEvent: (e) => !!(e.target as HTMLElement | null)?.closest?.('[data-chart-handle]'),
				ignoreMutation: () => true,
				destroy() {
					void unmount(cmp);
				}
			};
		};
	}
});
