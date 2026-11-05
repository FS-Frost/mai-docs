// Browser image helpers for exports: blob → docx image (PNG/JPEG/GIF/BMP as-is, others re-encoded to PNG).
import { resolveSrc } from '../../storage/blobs.ts';
import type { DocxImage } from './docx-export.ts';

const TYPES: Record<string, DocxImage['type']> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' };

async function toPng(blob: Blob): Promise<Blob> {
	const bmp = await createImageBitmap(blob);
	const canvas = document.createElement('canvas');
	canvas.width = bmp.width;
	canvas.height = bmp.height;
	canvas.getContext('2d')!.drawImage(bmp, 0, 0);
	return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

export async function loadDocxImage(src: string): Promise<DocxImage | null> {
	let blob = await resolveSrc(src);
	if (!blob) {
		try {
			blob = await (await fetch(src)).blob();
		} catch {
			return null;
		}
	}
	try {
		let type = TYPES[blob.type];
		if (!type) {
			blob = await toPng(blob);
			type = 'png';
		}
		const bmp = await createImageBitmap(blob);
		return { data: new Uint8Array(await blob.arrayBuffer()), type, width: bmp.width, height: bmp.height };
	} catch {
		return null;
	}
}
