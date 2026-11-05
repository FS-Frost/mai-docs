// Cell values, errors, coercion and Excel date serials (1900 system, with Excel's fictitious 1900-02-29).

export type ErrorCode = '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#N/A' | '#NUM!' | '#NULL!' | '#CIRC!' | '#SPILL!' | '#CALC!';
export const ERROR_CODES: ErrorCode[] = ['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#N/A', '#NUM!', '#NULL!', '#CIRC!', '#SPILL!', '#CALC!'];

export type Err = { e: ErrorCode };
export type Scalar = number | string | boolean | null;
export type Value = Scalar | Err;

export const err = (e: ErrorCode): Err => ({ e });
export const isErr = (v: unknown): v is Err => typeof v === 'object' && v !== null && 'e' in v && typeof (v as Err).e === 'string';

export class FormulaError extends Error {
	constructor(public code: ErrorCode) {
		super(code);
	}
}

/** Throws FormulaError for errors so functions can propagate them with plain code. */
export function num(v: Value): number {
	if (isErr(v)) throw new FormulaError(v.e);
	if (typeof v === 'number') return v;
	if (typeof v === 'boolean') return v ? 1 : 0;
	if (v === null || v === '') return 0;
	const n = parseNumberLiteral(v);
	if (n === null) throw new FormulaError('#VALUE!');
	return n;
}

export function str(v: Value): string {
	if (isErr(v)) throw new FormulaError(v.e);
	if (v === null) return '';
	if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
	if (typeof v === 'number') return formatGeneral(v);
	return v;
}

export function bool(v: Value): boolean {
	if (isErr(v)) throw new FormulaError(v.e);
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (v === null || v === '') return false;
	const u = v.toUpperCase();
	if (u === 'TRUE') return true;
	if (u === 'FALSE') return false;
	throw new FormulaError('#VALUE!');
}

/** Number text in formula/coercion context (always '.' decimal, optional %, thousands commas not allowed). */
export function parseNumberLiteral(s: string): number | null {
	const t = s.trim();
	if (!t) return null;
	const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(t);
	if (!m) return null;
	const n = Number(m[1]);
	return m[2] ? n / 100 : n;
}

/** Excel "General" number rendering: up to 11 significant chars, like Excel/Sheets. */
export function formatGeneral(n: number): string {
	if (!Number.isFinite(n)) return '#NUM!';
	if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
	const abs = Math.abs(n);
	if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
		const [m, e] = n.toExponential(5).split('e');
		const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
		return `${mant}E${e.startsWith('-') ? '-' : '+'}${e.replace(/^[+-]/, '').padStart(2, '0')}`;
	}
	return String(Number(n.toPrecision(15)));
}

// ---------- Dates ----------

const DAY = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

/** (y, m 1-12, d) → serial. Dates before 1900-03-01 are shifted by Excel's leap-year bug. */
export function dateSerial(y: number, m: number, d: number) {
	const s = (Date.UTC(y, m - 1, d) - EPOCH) / DAY;
	return s < 61 ? s - 1 : s;
}

export function serialToParts(serial: number) {
	let s = Math.floor(serial);
	if (s === 60) return { y: 1900, m: 2, d: 29, wd: 3 };
	if (s < 60) s += 1;
	const dt = new Date(EPOCH + s * DAY);
	return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
}

/** JS Date (local wall time) → serial with time fraction. */
export function jsDateToSerial(dt: Date) {
	const ms = Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds(), dt.getMilliseconds());
	const s = (ms - EPOCH) / DAY;
	return s < 61 ? s - 1 : s;
}

/** UTC-based JS Date (as exceljs gives) → serial. */
export function utcDateToSerial(dt: Date) {
	const s = (dt.getTime() - EPOCH) / DAY;
	return s < 61 ? s - 1 : s;
}

/** serial → Date whose UTC fields are the wall time (for exceljs). */
export function serialToUtcDate(serial: number) {
	const s = serial < 61 ? serial + 1 : serial;
	return new Date(Math.round(EPOCH + s * DAY));
}

// ---------- Comparison (Excel ordering: numbers < text < booleans; text case-insensitive) ----------

const rank = (v: Scalar) => (v === null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3);

export function compare(a: Scalar, b: Scalar): number {
	if (a === null && typeof b === 'number') a = 0;
	if (b === null && typeof a === 'number') b = 0;
	if (a === null && typeof b === 'string') a = '';
	if (b === null && typeof a === 'string') b = '';
	if (a === null && typeof b === 'boolean') a = false;
	if (b === null && typeof a === 'boolean') b = false;
	const ra = rank(a);
	const rb = rank(b);
	if (ra !== rb) return ra - rb;
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'string' && typeof b === 'string') {
		const x = a.toLowerCase();
		const y = b.toLowerCase();
		return x < y ? -1 : x > y ? 1 : 0;
	}
	if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
	return 0;
}
