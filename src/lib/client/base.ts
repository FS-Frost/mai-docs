// Site base without trailing slash: '' locally, '/<repo>' on GitHub Pages (Kit paths.base → Vite base).
// Kit 3 no longer exports `base` from $app/paths.
export const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** '/docs/x' → '/<repo>/docs/x'. Use for every internal href and goto(). */
export function withBase(path: string) {
	if (!path.startsWith('/') || !base) return path;
	return path === base || path.startsWith(`${base}/`) ? path : base + path;
}

/** Route path without the base, for comparisons. */
export function routePath(pathname: string) {
	return base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname;
}
