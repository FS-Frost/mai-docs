// Presentation controller: immutable content snapshots with undo/redo, current slide, selection, text editing.
import type { Editor } from '@tiptap/core';
import { untrack } from 'svelte';
import { applyLayout, newSlide } from './layouts.ts';
import { resize } from './layouts.ts';
import { uid, type El, type LayoutKind, type Slide, type SlidesContent, type Theme } from './model.ts';

const HISTORY = 100;
const COALESCE_MS = 1200;

export class Deck {
	content = $state.raw<SlidesContent>(null as unknown as SlidesContent);
	current = $state(0);
	selection = $state<string[]>([]);
	/** Element whose text is being edited (Tiptap editor mounted on it). */
	editing = $state<string | null>(null);
	textEditor = $state.raw<Editor | null>(null);
	/** Bumped on every transaction of the text editor (toolbar active states). */
	textVer = $state(0);
	canUndo = $state(false);
	canRedo = $state(false);
	onChange: () => void = () => {};

	private undoStack: { c: SlidesContent; at: number; key?: string; cur: number }[] = [];
	private redoStack: { c: SlidesContent; cur: number }[] = [];

	constructor(c: SlidesContent) {
		this.content = c;
	}

	get slide(): Slide {
		return this.content.slides[Math.min(this.current, this.content.slides.length - 1)];
	}

	get selected(): El[] {
		const ids = new Set(this.selection);
		return this.slide.elements.filter((e) => ids.has(e.id));
	}

	// ---------- History ----------

	/** Replaces the content; consecutive commits with the same key within 1.2 s are one undo step (typing). */
	commit(next: SlidesContent, key?: string) {
		const now = Date.now();
		const top = this.undoStack[this.undoStack.length - 1];
		if (!(key && top?.key === key && now - top.at < COALESCE_MS)) {
			this.undoStack.push({ c: this.content, at: now, key, cur: this.current });
			if (this.undoStack.length > HISTORY) this.undoStack.shift();
		} else top.at = now;
		this.redoStack = [];
		this.content = next;
		this.flags();
		untrack(() => this.onChange());
	}

	undo() {
		const e = this.undoStack.pop();
		if (!e) return;
		this.redoStack.push({ c: this.content, cur: this.current });
		this.content = e.c;
		this.current = Math.min(e.cur, e.c.slides.length - 1);
		this.cleanSelection();
		this.flags();
		this.onChange();
	}

	redo() {
		const e = this.redoStack.pop();
		if (!e) return;
		this.undoStack.push({ c: this.content, at: 0, cur: this.current });
		this.content = e.c;
		this.current = Math.min(e.cur, e.c.slides.length - 1);
		this.cleanSelection();
		this.flags();
		this.onChange();
	}

	private flags() {
		this.canUndo = this.undoStack.length > 0;
		this.canRedo = this.redoStack.length > 0;
	}

	private cleanSelection() {
		const ids = new Set(this.slide.elements.map((e) => e.id));
		this.selection = this.selection.filter((s) => ids.has(s));
		if (this.editing && !ids.has(this.editing)) this.editing = null;
	}

	// ---------- Slides ----------

	private setSlides(slides: Slide[], key?: string) {
		this.commit({ ...this.content, slides }, key);
	}

	updateSlide(fn: (s: Slide) => Slide, key?: string, index = this.current) {
		this.setSlides(
			this.content.slides.map((s, i) => (i === index ? fn(s) : s)),
			key
		);
	}

	go(i: number) {
		const n = Math.max(0, Math.min(this.content.slides.length - 1, i));
		if (n === this.current) return;
		this.stopEditing();
		this.current = n;
		this.selection = [];
	}

	addSlide(kind: LayoutKind, after = this.current) {
		const s = newSlide(this.content, kind);
		const slides = [...this.content.slides];
		slides.splice(after + 1, 0, s);
		this.stopEditing();
		this.setSlides(slides);
		this.current = after + 1;
		this.selection = [];
	}

	duplicateSlide(i = this.current) {
		const src = this.content.slides[i];
		const copy: Slide = { ...structuredClone(src), id: uid(), elements: src.elements.map((e) => ({ ...structuredClone(e), id: uid() })) };
		const slides = [...this.content.slides];
		slides.splice(i + 1, 0, copy);
		this.setSlides(slides);
		this.current = i + 1;
	}

	deleteSlide(i = this.current) {
		if (this.content.slides.length <= 1) return false;
		this.stopEditing();
		this.setSlides(this.content.slides.filter((_, k) => k !== i));
		this.current = Math.min(this.current, this.content.slides.length - 1);
		this.selection = [];
		return true;
	}

	moveSlide(from: number, to: number) {
		if (from === to) return;
		const slides = [...this.content.slides];
		const [s] = slides.splice(from, 1);
		slides.splice(Math.max(0, Math.min(slides.length, to)), 0, s);
		this.setSlides(slides);
		this.current = slides.indexOf(s);
	}

	setLayout(kind: LayoutKind) {
		this.updateSlide((s) => applyLayout(this.content, s, kind));
	}

	setNotes(text: string) {
		this.updateSlide((s) => ({ ...s, notes: text }), `notes:${this.slide.id}`);
	}

	// ---------- Elements ----------

	updateElements(ids: string[], fn: (e: El) => El, key?: string) {
		const set = new Set(ids);
		this.updateSlide((s) => ({ ...s, elements: s.elements.map((e) => (set.has(e.id) ? fn(e) : e)) }), key);
	}

	patch(ids: string[], p: Partial<El>, key?: string) {
		this.updateElements(ids, (e) => ({ ...e, ...p }) as El, key);
	}

	add(el: El) {
		this.updateSlide((s) => ({ ...s, elements: [...s.elements, el] }));
		this.selection = [el.id];
	}

	addMany(els: El[]) {
		if (!els.length) return;
		this.updateSlide((s) => ({ ...s, elements: [...s.elements, ...els] }));
		this.selection = els.map((e) => e.id);
	}

	removeSelected() {
		const ids = new Set(this.selection);
		if (!ids.size) return;
		this.stopEditing();
		this.updateSlide((s) => ({ ...s, elements: s.elements.filter((e) => !ids.has(e.id)) }));
		this.selection = [];
	}

	duplicateSelected(offset = 16) {
		const copies = this.selected.map((e) => ({ ...structuredClone(e), id: uid(), ph: undefined, x: e.x + offset, y: e.y + offset }) as El);
		this.addMany(copies);
	}

	/** z-order: 'front' | 'back' | 'forward' | 'backward'. */
	arrange(dir: 'front' | 'back' | 'forward' | 'backward') {
		const ids = new Set(this.selection);
		this.updateSlide((s) => {
			const els = [...s.elements];
			if (dir === 'front') return { ...s, elements: [...els.filter((e) => !ids.has(e.id)), ...els.filter((e) => ids.has(e.id))] };
			if (dir === 'back') return { ...s, elements: [...els.filter((e) => ids.has(e.id)), ...els.filter((e) => !ids.has(e.id))] };
			if (dir === 'forward') {
				for (let i = els.length - 2; i >= 0; i--) if (ids.has(els[i].id) && !ids.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
			} else for (let i = 1; i < els.length; i++) if (ids.has(els[i].id) && !ids.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
			return { ...s, elements: els };
		});
	}

	/** Align selected elements (to each other, or to the slide when only one is selected). */
	align(how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
		const sel = this.selected;
		if (!sel.length) return;
		const box =
			sel.length === 1
				? { x: 0, y: 0, w: this.content.size.w, h: this.content.size.h }
				: (() => {
						const x1 = Math.min(...sel.map((e) => e.x));
						const y1 = Math.min(...sel.map((e) => e.y));
						return { x: x1, y: y1, w: Math.max(...sel.map((e) => e.x + e.w)) - x1, h: Math.max(...sel.map((e) => e.y + e.h)) - y1 };
					})();
		this.updateElements(this.selection, (e) => {
			switch (how) {
				case 'left':
					return { ...e, x: box.x };
				case 'center':
					return { ...e, x: Math.round(box.x + (box.w - e.w) / 2) };
				case 'right':
					return { ...e, x: box.x + box.w - e.w };
				case 'top':
					return { ...e, y: box.y };
				case 'middle':
					return { ...e, y: Math.round(box.y + (box.h - e.h) / 2) };
				case 'bottom':
					return { ...e, y: box.y + box.h - e.h };
			}
		});
	}

	distribute(axis: 'h' | 'v') {
		const sel = [...this.selected].sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
		if (sel.length < 3) return;
		const first = sel[0];
		const last = sel[sel.length - 1];
		const total = sel.reduce((n, e) => n + (axis === 'h' ? e.w : e.h), 0);
		const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
		const gap = (span - total) / (sel.length - 1);
		let at = axis === 'h' ? first.x : first.y;
		const pos = new Map<string, number>();
		for (const e of sel) {
			pos.set(e.id, Math.round(at));
			at += (axis === 'h' ? e.w : e.h) + gap;
		}
		this.updateElements(this.selection, (e) => (axis === 'h' ? { ...e, x: pos.get(e.id)! } : { ...e, y: pos.get(e.id)! }));
	}

	// ---------- Theme / size ----------

	setTheme(theme: Theme) {
		this.commit({ ...this.content, theme });
	}

	setSize(w: number, h: number) {
		if (w === this.content.size.w && h === this.content.size.h) return;
		this.commit(resize(this.content, w, h));
	}

	// ---------- Text editing ----------

	startEditing(id: string) {
		this.selection = [id];
		this.editing = id;
	}

	stopEditing() {
		this.editing = null;
		this.textEditor = null;
	}
}

export function newDeckContent(theme: Theme, size: { w: number; h: number } = { w: 1280, h: 720 }): SlidesContent {
	const c: SlidesContent = { v: 1, size, theme, slides: [] };
	c.slides.push(newSlide(c, 'title'));
	return c;
}
