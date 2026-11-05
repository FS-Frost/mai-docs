// Tiny PNG encoder (RGBA, no filter) for placeholder pictures written into .pptx (media posters, icon fallback).
import { zlibSync } from 'fflate';

const CRC = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(b: Uint8Array) {
	let c = 0xffffffff;
	for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
	const out = new Uint8Array(12 + data.length);
	const v = new DataView(out.buffer);
	v.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** w×h PNG from a pixel function returning [r, g, b, a]. */
export function encodePng(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Uint8Array {
	const raw = new Uint8Array(h * (1 + w * 4));
	for (let y = 0; y < h; y++) {
		const row = y * (1 + w * 4);
		for (let x = 0; x < w; x++) raw.set(px(x, y), row + 1 + x * 4);
	}
	const ihdr = new Uint8Array(13);
	const v = new DataView(ihdr.buffer);
	v.setUint32(0, w);
	v.setUint32(4, h);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** Poster for a media shape without one: dark (video) or tinted (audio) with a centered play triangle. */
export function mediaPosterPng(kind: 'video' | 'audio'): Uint8Array {
	const W = 160;
	const H = kind === 'video' ? 90 : 160;
	const bg: [number, number, number, number] = kind === 'video' ? [20, 20, 24, 255] : [222, 228, 255, 255];
	const fg: [number, number, number, number] = kind === 'video' ? [235, 235, 240, 255] : [59, 91, 219, 255];
	const s = Math.min(W, H) * 0.32;
	const cx = W / 2;
	const cy = H / 2;
	return encodePng(W, H, (x, y) => {
		const dx = x - (cx - s / 2);
		const inside = dx >= 0 && dx <= s && Math.abs(y - cy) <= (s / 2) * (1 - dx / s);
		return inside ? fg : bg;
	});
}

export const TRANSPARENT_PNG = encodePng(1, 1, () => [0, 0, 0, 0]);
