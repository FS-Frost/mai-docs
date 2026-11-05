// UI language. `t()` returns the dictionary of the current locale; reading it in a template/effect is reactive.
//   {t().library.newDoc}   {t().doc.words(n)}
import en, { type Dict } from './en.ts';
import es from './es.ts';
import { LANG_KEY, readPref, resolveLocale, type LangPref, type Locale } from './detect.ts';

export type { Dict, Locale, LangPref };

const dicts: Record<Locale, Dict> = { en, es };

function storage() {
	try {
		return localStorage;
	} catch {
		return null;
	}
}

function systemLangs(): readonly string[] {
	if (typeof navigator === 'undefined') return ['en'];
	return navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
}

const initialPref = typeof window === 'undefined' ? 'system' : readPref(storage());

export const i18n = $state({
	pref: initialPref as LangPref,
	locale: resolveLocale(initialPref, systemLangs())
});

export function t(): Dict {
	return dicts[i18n.locale];
}

/** BCP 47 tag for Intl.* formatting. */
export function intlLocale() {
	return i18n.locale === 'es' ? 'es' : 'en';
}

export function setLangPref(pref: LangPref) {
	i18n.pref = pref;
	i18n.locale = resolveLocale(pref, systemLangs());
	try {
		if (pref === 'system') localStorage.removeItem(LANG_KEY);
		else localStorage.setItem(LANG_KEY, pref);
	} catch {
		/* session only */
	}
	document.documentElement.lang = i18n.locale;
}

/** Follow OS language changes while on "system". */
export function initI18n() {
	document.documentElement.lang = i18n.locale;
	addEventListener('languagechange', () => {
		if (i18n.pref === 'system') {
			i18n.locale = resolveLocale('system', systemLangs());
			document.documentElement.lang = i18n.locale;
		}
	});
}

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 365 * 86400],
	['month', 30 * 86400],
	['week', 7 * 86400],
	['day', 86400],
	['hour', 3600],
	['minute', 60]
];

/** "3 minutes ago", "yesterday"… in the UI language. */
export function ago(ms: number, now = Date.now()) {
	const s = Math.round((now - ms) / 1000);
	if (!Number.isFinite(s)) return '';
	if (s < 60) return t().time.justNow;
	const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' });
	for (const [unit, secs] of STEPS) if (s >= secs) return rtf.format(-Math.floor(s / secs), unit);
	return '';
}

export function formatBytes(n: number) {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: i ? 1 : 0 }).format(n)} ${units[i]}`;
}
