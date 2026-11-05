// .docx → HTML with mammoth (lossy: no headers/footers, partial styles). Images are stored as blobs of the
// new document and referenced as mai-blob:<id>. HTML → JSON happens in the browser (needs a DOM).
import { BLOB_PREFIX } from '../../storage/blobs.ts';

type Mammoth = {
	convertToHtml(input: { arrayBuffer: ArrayBuffer }, opts?: Record<string, unknown>): Promise<{ value: string; messages: { type: string; message: string }[] }>;
	images: { imgElement(fn: (img: { contentType: string; read(enc?: string): Promise<ArrayBuffer | Uint8Array | string> }) => Promise<{ src: string }>): unknown };
};

async function mammoth(): Promise<Mammoth> {
	const m = (await import('mammoth')) as unknown as { default?: Mammoth } & Mammoth;
	return m.default ?? m;
}

export async function docxToHtml(buf: ArrayBuffer, saveImage: (blob: Blob) => Promise<string>): Promise<{ html: string; lossy: boolean }> {
	const mm = await mammoth();
	const res = await mm.convertToHtml(
		{ arrayBuffer: buf },
		{
			convertImage: mm.images.imgElement(async (img) => {
				const data = await img.read();
				const blob = new Blob([data as BlobPart], { type: img.contentType });
				const id = await saveImage(blob);
				return { src: BLOB_PREFIX + id };
			}),
			styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "r[style-name='Strong'] => strong", 'u => u', 'strike => s']
		}
	);
	const lossy = res.messages.some((m) => m.type === 'warning' || m.type === 'error');
	return { html: res.value, lossy };
}
