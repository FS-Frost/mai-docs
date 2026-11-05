/// <reference lib="webworker" />
// Service worker (PWA): the app opens offline. Precaches the whole build (shell + every hashed chunk, including
// lazily-loaded exceljs/mammoth/docx, so import/export also work offline).
import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';
import { CACHE_PREFIX, KEPT_CACHES } from './lib/client/pwa-core.ts';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Served at `<base>/service-worker.js`: the site base comes from there.
const BASE = sw.location.pathname.replace(/\/service-worker\.js$/, '');
const SHELL = `${BASE}/`;
const CACHE = `${CACHE_PREFIX}${version}`;

const url = (p: string) => `${BASE}/${p.replace(/^\//, '')}`;
const PRECACHE = [...immutable.map((f) => url(f.path)), ...assets.map((f) => url(f.path))];
const PRECACHED = new Set(PRECACHE);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll([...PRECACHE, SHELL]);
			// No skipWaiting: an old page may still lazy-load chunks from the old cache. The page asks for it
			// (client/pwa.ts → applyUpdate) right before reloading.
		})()
	);
});

sw.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE && !KEPT_CACHES.includes(key)) await caches.delete(key);
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const u = new URL(req.url);
	if (u.origin !== sw.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// Hashed files and static assets: cache first.
			if (PRECACHED.has(u.pathname) || u.pathname.startsWith(`${BASE}/_app/immutable/`)) {
				const hit = await cache.match(u.pathname);
				if (hit) return hit;
			}
			// Navigation (SPA): network first; offline → the shell.
			if (req.mode === 'navigate') {
				try {
					return await fetch(req);
				} catch {
					return (await cache.match(SHELL)) ?? Response.error();
				}
			}
			// Rest: network, filling the cache; offline → cached copy.
			try {
				const res = await fetch(req);
				if (res.ok && res.type === 'basic') void cache.put(req, res.clone());
				return res;
			} catch {
				return (await cache.match(req)) ?? Response.error();
			}
		})()
	);
});
