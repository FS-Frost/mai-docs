// PWA: service worker registration (production builds only; in dev the cache gets in the way).
// Updates: the new SW installs and WAITS; `applyUpdate` activates it and reloads (toasts in UpdateNotice.svelte).
// Ported from ../sensei: GitHub Pages' CDN can serve the new version.json with the old index.html right after a
// deploy, so the shell is checked before reloading.
import { base } from './base.ts';
import { CACHE_PREFIX, KEPT_CACHES } from './pwa-core.ts';

let reg: ServiceWorkerRegistration | undefined;

export async function registerServiceWorker() {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
	try {
		reg = await navigator.serviceWorker.register(`${base}/service-worker.js`, { scope: `${base}/` });
		// A waiting SW at startup: this page came from the network (navigation is network-first), so it already is
		// the new version. Activating it is safe and refreshes the offline cache.
		if (reg.waiting && navigator.serviceWorker.controller) reg.waiting.postMessage('SKIP_WAITING');
	} catch (err) {
		console.error('[mai] service worker registration failed', err);
	}
}

function installed(w: ServiceWorker, ms = 20_000) {
	return new Promise<ServiceWorker | null>((resolve) => {
		const done = () => {
			if (w.state === 'installed' || w.state === 'activated') resolve(w);
			else if (w.state === 'redundant') resolve(null);
		};
		w.addEventListener('statechange', done);
		setTimeout(() => resolve(null), ms);
		done();
	});
}

const TARGET = 'mai.updateTarget';

async function publishedVersion() {
	const res = await fetch(`${base}/_app/version.json`, { cache: 'no-cache' });
	return ((await res.json()) as { version: string }).version;
}

async function shellIs(version: string) {
	const html = await (await fetch(`${base}/`, { cache: 'reload' })).text();
	return html.includes(`version: "${version}"`) || html.includes(`version:"${version}"`);
}

export type UpdateResult = 'reloading' | 'publishing' | 'offline';

let applying = false;

export async function applyUpdate(): Promise<UpdateResult> {
	if (applying) return 'reloading';
	applying = true;
	let target: string;
	try {
		target = await publishedVersion();
		if (!(await shellIs(target))) {
			applying = false;
			return 'publishing';
		}
	} catch {
		applying = false;
		return 'offline';
	}
	try {
		sessionStorage.setItem(TARGET, target);
	} catch {
		/* no storage */
	}
	let reloaded = false;
	const reload = () => {
		if (reloaded) return;
		reloaded = true;
		location.reload();
	};
	const r = reg ?? (await navigator.serviceWorker?.getRegistration(`${base}/`).catch(() => undefined));
	if (!r || !navigator.serviceWorker.controller) {
		reload();
		return 'reloading';
	}
	try {
		await r.update();
	} catch {
		/* the shell already arrived: reload anyway */
	}
	const next = r.waiting ?? (r.installing ? await installed(r.installing) : null);
	if (!next || next === navigator.serviceWorker.controller) {
		reload();
		return 'reloading';
	}
	navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
	next.postMessage('SKIP_WAITING');
	setTimeout(reload, 4000);
	return 'reloading';
}

/** After reloading for an update: the requested version if it did NOT load, else null. Consumed once. */
export function failedUpdate(current: string) {
	try {
		const t = sessionStorage.getItem(TARGET);
		sessionStorage.removeItem(TARGET);
		return t && t !== current ? t : null;
	} catch {
		return null;
	}
}

/** Last resort: remove the SW and the app cache (never the files) and reload from the network. */
export async function forceReload() {
	try {
		for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
		for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX) && !KEPT_CACHES.includes(k)) await caches.delete(k);
	} catch {
		/* reload anyway */
	}
	location.reload();
}
