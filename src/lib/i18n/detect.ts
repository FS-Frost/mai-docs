// Pure language logic (tested in Bun). Same rule as the inline script in app.html.

export type Locale = 'en' | 'es';
export type LangPref = Locale | 'system';

export const LANG_KEY = 'mai.lang';
export const LOCALES: Locale[] = ['es', 'en'];

/** Any preferred language starting with "es" (es, es-CL, es-419…) → Spanish; anything else → English. */
export function detect(langs: readonly string[]): Locale {
	return langs.some((l) => /^es\b/i.test(l)) ? 'es' : 'en';
}

export function readPref(store: Pick<Storage, 'getItem'> | null): LangPref {
	try {
		const v = store?.getItem(LANG_KEY);
		return v === 'es' || v === 'en' ? v : 'system';
	} catch {
		return 'system';
	}
}

export function resolveLocale(pref: LangPref, langs: readonly string[]): Locale {
	return pref === 'system' ? detect(langs) : pref;
}
