// Floating objects and cell images: insertion and geometry helpers (browser).
import { toast } from '../client/toast.svelte.ts';
import { fitSize, prepareImage } from '../files/images.ts';
import { t } from '../i18n/index.svelte.ts';
import { putBlob } from '../storage/blobs.ts';
import { cellKey, type Range } from './addr.ts';
import { newChart } from './charts.ts';
import { usedRange, type Anchor, type SheetObject } from './model.ts';
import type { Axis } from './layout.ts';
import type { SheetView } from './view.svelte.ts';

export const isImageFile = (f: File) => f.type.startsWith('image/');

async function store(view: SheetView, file: File) {
	const p = await prepareImage(file);
	if (p.reencoded) toast.info(t().object.reencoded(file.name));
	const blobId = await putBlob(view.fileId, p.blob);
	return { blobId, ...p };
}

export async function insertImages(view: SheetView, files: File[], at?: { r: number; c: number }) {
	const imgs = files.filter(isImageFile);
	if (!imgs.length) {
		if (files.length) toast.warn(t().object.unsupported);
		return;
	}
	const s = view.sheet;
	const base = at ?? view.active;
	let offset = 0;
	let last = '';
	for (const f of imgs) {
		const { blobId, width, height } = await store(view, f);
		const { w, h } = fitSize(width, height, 480, 360);
		const obj: SheetObject = { id: crypto.randomUUID(), kind: 'image', blobId, anchor: { r: base.r, c: base.c, dx: offset, dy: offset }, w, h, alt: f.name.replace(/\.[^.]+$/, '') };
		view.book.addObject(s.id, obj);
		last = obj.id;
		offset += 16;
	}
	view.object = last;
	view.focusTick++;
}

export async function insertCellImage(view: SheetView, file: File) {
	if (!isImageFile(file)) {
		toast.warn(t().object.unsupported);
		return;
	}
	const { blobId } = await store(view, file);
	const s = view.sheet;
	const { r, c } = view.active;
	const prev = s.cells.get(cellKey(r, c));
	view.book.setCells(s.id, [[cellKey(r, c), { ...prev, img: { blobId, alt: file.name.replace(/\.[^.]+$/, ''), fit: 'contain' } }]]);
	view.focusTick++;
}

export function insertChart(view: SheetView): boolean {
	const s = view.sheet;
	const g = view.primary;
	const single = g.r1 === g.r2 && g.c1 === g.c2;
	const range: Range | null = single ? usedRange(s, true) : view.book.clampRanges(s, [g])[0];
	if (!range) {
		toast.info(t().chart.needRange);
		return false;
	}
	const anchor: Anchor = { r: range.r1, c: range.c2 + 2, dx: 0, dy: 0 };
	const ch = newChart(view.book.wb, s, range, anchor);
	view.book.addObject(s.id, ch);
	view.object = ch.id;
	view.editingChart = ch.id;
	return true;
}

export function pickImage(multiple = true): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.multiple = multiple;
		input.onchange = () => resolve([...(input.files ?? [])]);
		input.oncancel = () => resolve([]);
		input.click();
	});
}

/** Content-space position of an anchor. */
export const anchorXY = (a: Anchor, rows: Axis, cols: Axis) => ({ x: cols.offset(a.c) + a.dx, y: rows.offset(a.r) + a.dy });

/** Anchor for a content-space position. */
export function xyAnchor(x: number, y: number, rows: Axis, cols: Axis): Anchor {
	const cx = Math.max(0, x);
	const cy = Math.max(0, y);
	const c = cols.indexAt(cx);
	const r = rows.indexAt(cy);
	return { r, c, dx: Math.round(cx - cols.offset(c)), dy: Math.round(cy - rows.offset(r)) };
}
