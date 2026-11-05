// Display of cell values (numfmt with the UI locale) and number-format presets.
import { format, formatColor, getFormatFromId, isDateFormat } from 'numfmt';
import type { Locale } from '../i18n/detect.ts';
import { formatGeneral, isErr, type Value } from './values.ts';

export const DATE_FMT: Record<Locale, string> = { es: 'dd/mm/yyyy', en: 'm/d/yyyy' };
export const TIME_FMT: Record<Locale, string> = { es: 'H:mm:ss', en: 'h:mm:ss AM/PM' };
export const DATETIME_FMT: Record<Locale, string> = { es: 'dd/mm/yyyy H:mm', en: 'm/d/yyyy h:mm AM/PM' };

export type FmtPreset = 'general' | 'number' | 'currency' | 'percent' | 'date' | 'time' | 'datetime' | 'text';

export function presetCode(p: FmtPreset, locale: Locale): string | undefined {
	switch (p) {
		case 'general':
			return undefined;
		case 'number':
			return '#,##0.00';
		case 'currency':
			return '"$"#,##0.00';
		case 'percent':
			return '0.00%';
		case 'date':
			return DATE_FMT[locale];
		case 'time':
			return TIME_FMT[locale];
		case 'datetime':
			return DATETIME_FMT[locale];
		case 'text':
			return '@';
	}
}

export function presetOf(code: string | undefined, locale: Locale): FmtPreset | 'custom' {
	if (!code || code === 'General') return 'general';
	for (const p of ['number', 'currency', 'percent', 'date', 'time', 'datetime', 'text'] as FmtPreset[]) if (presetCode(p, locale) === code) return p;
	return 'custom';
}

const opts = (locale: Locale) => ({ locale, throws: false, nbsp: false, invalid: '######' });

export function displayText(v: Value | undefined, numFmt: string | undefined, locale: Locale): string {
	if (v === null || v === undefined) return '';
	if (isErr(v)) return v.e;
	if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
	if (typeof v === 'number') {
		if (!numFmt || numFmt === 'General') {
			const g = formatGeneral(v);
			return locale === 'es' ? g.replace('.', ',') : g;
		}
		return format(numFmt, v, opts(locale));
	}
	if (numFmt && numFmt.includes('@')) return format(numFmt, v, opts(locale));
	return v;
}

/** Color from the format code ([Red] etc.), or undefined. */
export function displayColor(v: Value | undefined, numFmt: string | undefined): string | undefined {
	if (!numFmt || typeof v !== 'number' || !numFmt.includes('[')) return undefined;
	try {
		const c = formatColor(numFmt, v);
		return typeof c === 'string' ? c : undefined;
	} catch {
		return undefined;
	}
}

export function defaultAlign(v: Value | undefined): 'left' | 'center' | 'right' {
	if (typeof v === 'number') return 'right';
	if (typeof v === 'boolean' || isErr(v)) return 'center';
	return 'left';
}

export const isDateFmt = (code: string | undefined) => !!code && isDateFormat(code);

/** Number format implied by a typed value (numfmt formatId), adapted to the locale. */
export function formatForId(id: number | undefined, locale: Locale): string | undefined {
	if (id === undefined || id === 0) return undefined;
	if (id === 14) return DATE_FMT[locale];
	if (id === 22) return DATETIME_FMT[locale];
	if (id >= 18 && id <= 21) return TIME_FMT[locale];
	const code = getFormatFromId(id);
	return code && code !== 'General' ? code : undefined;
}

/** +1/-1 decimal place on a format code (or on General, based on the value). */
export function changeDecimals(code: string | undefined, value: Value | undefined, delta: 1 | -1): string {
	if (!code || code === 'General') {
		const g = typeof value === 'number' ? formatGeneral(value) : '0';
		const d = g.includes('.') && !g.includes('E') ? g.split('.')[1].length : 0;
		const nd = Math.max(0, Math.min(10, d + delta));
		return nd ? `0.${'0'.repeat(nd)}` : '0';
	}
	return code
		.split(';')
		.map((sec) => {
			// Skip quoted text and bracketed parts when locating the digits.
			const m = /^((?:"[^"]*"|\[[^\]]*\]|[^0#.])*[0#,]*[0#])(\.0*)?/.exec(sec);
			if (!m) return sec;
			const head = m[1];
			const dec = m[2] ?? '';
			const n = Math.max(0, dec.length - 1);
			const nn = Math.max(0, Math.min(10, n + delta));
			return head + (nn ? `.${'0'.repeat(nn)}` : '') + sec.slice(m[0].length);
		})
		.join(';');
}
