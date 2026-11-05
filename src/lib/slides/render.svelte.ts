// Render helpers for slides (browser): rich text → HTML (cached), image object URLs (reactive map).
import { generateHTML, type JSONContent } from '@tiptap/core';
import { SvelteMap } from 'svelte/reactivity';
import { schemaExtensions } from '../docs/extensions/index.ts';
import { urlFor } from '../storage/blobs.ts';

let exts: ReturnType<typeof schemaExtensions> | null = null;
const htmlCache = new Map<string, string>();

export function textHtml(doc: JSONContent | undefined): string {
	if (!doc) return '';
	const key = JSON.stringify(doc);
	const hit = htmlCache.get(key);
	if (hit !== undefined) return hit;
	exts ??= schemaExtensions();
	let html = '';
	try {
		html = generateHTML(doc, exts);
	} catch {
		html = '';
	}
	if (htmlCache.size > 2000) htmlCache.clear();
	htmlCache.set(key, html);
	return html;
}

export const mediaUrls = new SvelteMap<string, string>();
const loading = new Set<string>();

/** Object URL for a blob id; undefined until loaded (the map is reactive). */
export function mediaUrl(blobId: string): string | undefined {
	const u = mediaUrls.get(blobId);
	if (u) return u;
	if (!loading.has(blobId)) {
		loading.add(blobId);
		void urlFor(blobId).then((url) => {
			loading.delete(blobId);
			if (url) mediaUrls.set(blobId, url);
		});
	}
	return undefined;
}
