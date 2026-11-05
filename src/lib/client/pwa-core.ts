// Shared by the page and the service worker (no DOM).

export const CACHE_PREFIX = 'mai-';
/** Caches kept across app versions (the SW deletes other mai-* caches when it activates). */
export const KEPT_CACHES: string[] = [];
