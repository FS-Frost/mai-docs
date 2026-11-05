// Lucide icons: the set is loaded lazily (picker only); a placed icon keeps its SVG nodes in the deck.
import type { IconEl, Theme } from './model.ts';
import { resolveColor } from './model.ts';

export type IconNode = [string, Record<string, string | number>][];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export const iconInner = (nodes: IconEl['nodes']) =>
	nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(String(v))}"`).join(' ')}/>`).join('');

/** Standalone SVG of an icon (export as picture, svgBlip). */
export function iconSvg(el: Pick<IconEl, 'nodes' | 'color' | 'stroke' | 'w' | 'h'>, theme: Theme): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(el.w)}" height="${Math.round(el.h)}" viewBox="0 0 24 24" fill="none" stroke="${resolveColor(theme, el.color)}" stroke-width="${el.stroke}" stroke-linecap="round" stroke-linejoin="round">${iconInner(el.nodes)}</svg>`;
}

let set: Promise<Record<string, IconNode>> | null = null;
/** Every Lucide icon by PascalCase name (lazy chunk, precached by the service worker). */
export function loadIcons(): Promise<Record<string, IconNode>> {
	return (set ??= import('lucide').then((m) => m.icons as unknown as Record<string, IconNode>));
}

/** 'ArrowBigDown' → 'arrow big down' (search text). */
export const iconWords = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').toLowerCase();
