// Image intake for documents and sheets: large images are re-encoded (WebP, max 4096 px side) so the local
// library stays small. Returns the natural size for default object sizes.

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_SIDE = 4096;

export type PreparedImage = { blob: Blob; width: number; height: number; reencoded: boolean };

export async function prepareImage(file: Blob): Promise<PreparedImage> {
	let bmp: ImageBitmap;
	try {
		bmp = await createImageBitmap(file);
	} catch {
		// SVG and other formats createImageBitmap rejects: keep as-is with a nominal size.
		return { blob: file, width: 320, height: 240, reencoded: false };
	}
	const { width, height } = bmp;
	const big = file.size > MAX_BYTES || width > MAX_SIDE || height > MAX_SIDE;
	if (!big || file.type === 'image/gif') {
		bmp.close();
		return { blob: file, width, height, reencoded: false };
	}
	const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
	const w = Math.round(width * scale);
	const h = Math.round(height * scale);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
	bmp.close();
	const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85));
	if (!blob || blob.size >= file.size) return { blob: file, width, height, reencoded: false };
	return { blob, width: w, height: h, reencoded: true };
}

/** Fits (w, h) into a box keeping the aspect ratio (never upscales). */
export function fitSize(w: number, h: number, maxW: number, maxH: number) {
	const s = Math.min(1, maxW / w, maxH / h);
	return { w: Math.round(w * s), h: Math.round(h * s) };
}

/** Image bytes in a format Excel/Word can show (PNG/JPEG/GIF); others (WebP, SVG…) are re-encoded to PNG. */
export async function officeImage(blob: Blob): Promise<{ data: Uint8Array; extension: 'png' | 'jpeg' | 'gif' } | null> {
	const ok: Record<string, 'png' | 'jpeg' | 'gif'> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif' };
	const ext = ok[blob.type];
	if (ext) return { data: new Uint8Array(await blob.arrayBuffer()), extension: ext };
	try {
		const bmp = await createImageBitmap(blob);
		const canvas = document.createElement('canvas');
		canvas.width = bmp.width;
		canvas.height = bmp.height;
		canvas.getContext('2d')!.drawImage(bmp, 0, 0);
		bmp.close();
		const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
		return png ? { data: new Uint8Array(await png.arrayBuffer()), extension: 'png' } : null;
	} catch {
		return null;
	}
}
