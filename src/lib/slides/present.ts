// Presentation ↔ presenter window sync over BroadcastChannel (same origin, works offline).

export type Screen = 'normal' | 'black' | 'white';
export type PresentMsg =
	| { type: 'state'; index: number; screen: Screen; running: boolean }
	| { type: 'goto'; index: number }
	| { type: 'step'; dir: 1 | -1 }
	| { type: 'screen'; screen: Screen }
	| { type: 'hello' }
	| { type: 'end' };

export const presentChannel = (fileId: string) => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`mai-present-${fileId}`));

/** Indices of slides shown when presenting (skipped ones excluded). */
export const visibleSlides = (slides: { hidden?: boolean }[]) => slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0);

export function nextVisible(slides: { hidden?: boolean }[], from: number, dir: 1 | -1): number | null {
	for (let i = from + dir; i >= 0 && i < slides.length; i += dir) if (!slides[i].hidden) return i;
	return null;
}

export function formatClock(ms: number) {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
}
