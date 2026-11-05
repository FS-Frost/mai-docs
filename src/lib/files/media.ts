// Local video/audio for presentations: size limit and a poster frame for videos (shown in the editor and
// written to the .pptx as the picture of the media shape).
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export const isMedia = (f: File) => f.type.startsWith('video/') || f.type.startsWith('audio/') || /\.(mp4|m4v|webm|mov|mp3|m4a|wav|ogg|oga|aac)$/i.test(f.name);
export const mediaKind = (f: File): 'video' | 'audio' => (f.type.startsWith('audio/') || /\.(mp3|m4a|wav|oga|aac)$/i.test(f.name) ? 'audio' : 'video');

/** Mime from the extension when the browser doesn't give one. */
export function mediaMime(f: File): string {
	if (f.type) return f.type;
	const e = /\.([a-z0-9]+)$/i.exec(f.name)?.[1]?.toLowerCase() ?? '';
	return ({ mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', aac: 'audio/aac' } as Record<string, string>)[e] ?? 'application/octet-stream';
}

/** First frame (at 0.1 s) as PNG + the video size; null when the browser can't decode it. */
export function videoPoster(file: Blob): Promise<{ blob: Blob; width: number; height: number } | null> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const v = document.createElement('video');
		v.muted = true;
		v.preload = 'auto';
		v.playsInline = true;
		let done = false;
		const finish = (r: { blob: Blob; width: number; height: number } | null) => {
			if (done) return;
			done = true;
			URL.revokeObjectURL(url);
			resolve(r);
		};
		const timer = setTimeout(() => finish(null), 8000);
		v.onerror = () => (clearTimeout(timer), finish(null));
		v.onloadeddata = () => {
			v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
		};
		v.onseeked = () => {
			clearTimeout(timer);
			const w = v.videoWidth || 640;
			const h = v.videoHeight || 360;
			const scale = Math.min(1, 1280 / w);
			const c = document.createElement('canvas');
			c.width = Math.round(w * scale);
			c.height = Math.round(h * scale);
			c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
			c.toBlob((b) => finish(b ? { blob: b, width: w, height: h } : null), 'image/png');
		};
		v.src = url;
	});
}
