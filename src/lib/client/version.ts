// App version = short sha of the published commit ('dev' locally). Pure logic (tested).

const KEY = 'mai.version';

/** Stores the current version and returns the previous one if it changed (null the first time, if unchanged or 'dev'). */
export function noteVersion(current: string, store: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): string | null {
	if (!store || current === 'dev') return null;
	try {
		const prev = store.getItem(KEY);
		if (prev === current) return null;
		store.setItem(KEY, current);
		return prev;
	} catch {
		return null;
	}
}

function safeStorage() {
	try {
		return localStorage;
	} catch {
		return null;
	}
}
