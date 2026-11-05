// Preset shape outlines (SVG path in a w×h box) matching PowerPoint's prstGeom names, plus snapping math.
import type { Geom } from './model.ts';

export const GEOMS: Geom[] = ['rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'pentagon', 'hexagon', 'parallelogram', 'trapezoid', 'star5', 'rightArrow', 'leftArrow', 'chevron', 'line'];

const pts = (p: [number, number][]) => `M${p.map(([x, y]) => `${round(x)},${round(y)}`).join('L')}Z`;
const round = (n: number) => Math.round(n * 100) / 100;

export function geomPath(g: Geom, w: number, h: number): string {
	switch (g) {
		case 'rect':
			return pts([[0, 0], [w, 0], [w, h], [0, h]]);
		case 'roundRect': {
			const r = Math.min(w, h) * 0.1667;
			return `M${r},0H${w - r}A${r},${r} 0 0 1 ${w},${r}V${h - r}A${r},${r} 0 0 1 ${w - r},${h}H${r}A${r},${r} 0 0 1 0,${h - r}V${r}A${r},${r} 0 0 1 ${r},0Z`;
		}
		case 'ellipse':
			return `M0,${h / 2}A${w / 2},${h / 2} 0 1 0 ${w},${h / 2}A${w / 2},${h / 2} 0 1 0 0,${h / 2}Z`;
		case 'triangle':
			return pts([[w / 2, 0], [w, h], [0, h]]);
		case 'rtTriangle':
			return pts([[0, 0], [w, h], [0, h]]);
		case 'diamond':
			return pts([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
		case 'pentagon':
			return pts([[w / 2, 0], [w, h * 0.382], [w * 0.809, h], [w * 0.191, h], [0, h * 0.382]]);
		case 'hexagon': {
			const d = w * 0.25;
			return pts([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]);
		}
		case 'parallelogram': {
			const d = w * 0.25;
			return pts([[d, 0], [w, 0], [w - d, h], [0, h]]);
		}
		case 'trapezoid': {
			const d = w * 0.25;
			return pts([[d, 0], [w - d, 0], [w, h], [0, h]]);
		}
		case 'star5': {
			const out: [number, number][] = [];
			for (let i = 0; i < 10; i++) {
				const a = -Math.PI / 2 + (i * Math.PI) / 5;
				const r = i % 2 ? 0.382 : 1;
				out.push([w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2 + h * 0.05]);
			}
			return pts(out);
		}
		case 'rightArrow': {
			const head = Math.min(w * 0.5, h);
			return pts([[0, h * 0.25], [w - head, h * 0.25], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h * 0.75], [0, h * 0.75]]);
		}
		case 'leftArrow': {
			const head = Math.min(w * 0.5, h);
			return pts([[w, h * 0.25], [head, h * 0.25], [head, 0], [0, h / 2], [head, h], [head, h * 0.75], [w, h * 0.75]]);
		}
		case 'chevron': {
			const d = Math.min(w * 0.5, h * 0.5);
			return pts([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]);
		}
		case 'line':
			return `M0,0L${w},${h}`;
	}
}

// ---------- Snapping ----------

export type Rect = { x: number; y: number; w: number; h: number };
export type Guide = { axis: 'x' | 'y'; at: number };

/** Moves `r` so its edges/center align with nearby targets (within `tol`). Returns the delta and the guides hit. */
export function snapRect(r: Rect, targets: Rect[], tol: number): { dx: number; dy: number; guides: Guide[] } {
	const xs = [r.x, r.x + r.w / 2, r.x + r.w];
	const ys = [r.y, r.y + r.h / 2, r.y + r.h];
	let best: { dx: number; gx: number | null } = { dx: 0, gx: null };
	let bestY: { dy: number; gy: number | null } = { dy: 0, gy: null };
	let mx = tol + 1;
	let my = tol + 1;
	for (const t of targets) {
		const tx = [t.x, t.x + t.w / 2, t.x + t.w];
		const ty = [t.y, t.y + t.h / 2, t.y + t.h];
		for (const a of xs)
			for (const b of tx) {
				const d = b - a;
				if (Math.abs(d) < mx) {
					mx = Math.abs(d);
					best = { dx: d, gx: b };
				}
			}
		for (const a of ys)
			for (const b of ty) {
				const d = b - a;
				if (Math.abs(d) < my) {
					my = Math.abs(d);
					bestY = { dy: d, gy: b };
				}
			}
	}
	const guides: Guide[] = [];
	if (best.gx !== null && mx <= tol) guides.push({ axis: 'x', at: best.gx });
	if (bestY.gy !== null && my <= tol) guides.push({ axis: 'y', at: bestY.gy });
	return { dx: mx <= tol ? best.dx : 0, dy: my <= tol ? bestY.dy : 0, guides };
}

export const union = (rs: Rect[]): Rect => {
	const x1 = Math.min(...rs.map((r) => r.x));
	const y1 = Math.min(...rs.map((r) => r.y));
	const x2 = Math.max(...rs.map((r) => r.x + r.w));
	const y2 = Math.max(...rs.map((r) => r.y + r.h));
	return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};

export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
