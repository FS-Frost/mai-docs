// Presentation ↔ presenter window sync over BroadcastChannel (same origin, works offline).

export type Screen = 'normal' | 'black' | 'white';
export type PresentMsg =
	| { type: 'state'; index: number; step?: number; screen: Screen; running: boolean }
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

export type Pos = { index: number; step: number };

/**
 * Next/previous position: entrance animations first (one click step at a time), then the next visible slide.
 * Going back to the previous slide shows it complete. null = no further position (end / start).
 */
export function advance(slides: { hidden?: boolean; anims?: { trigger: string }[] }[], pos: Pos, dir: 1 | -1): Pos | null {
	const steps = (i: number) => (slides[i]?.anims ?? []).reduce((n, a, k) => n + (a.trigger === 'click' || k === 0 ? 1 : 0), 0);
	if (dir === 1 && pos.step < steps(pos.index)) return { index: pos.index, step: pos.step + 1 };
	if (dir === -1 && pos.step > 0) return { index: pos.index, step: pos.step - 1 };
	const n = nextVisible(slides, pos.index, dir);
	if (n === null) return null;
	return { index: n, step: dir === 1 ? 0 : steps(n) };
}
