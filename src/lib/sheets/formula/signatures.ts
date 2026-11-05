// Argument hints shown while typing a formula: "VLOOKUP(lookup_value, table_array, col_index, [approximate])".
// Argument names follow Excel (English, like function names).

const SIG: Record<string, string> = {
	SUM: 'number1, [number2], …',
	PRODUCT: 'number1, [number2], …',
	AVERAGE: 'number1, [number2], …',
	MIN: 'number1, [number2], …',
	MAX: 'number1, [number2], …',
	COUNT: 'value1, [value2], …',
	COUNTA: 'value1, [value2], …',
	COUNTBLANK: 'range',
	MEDIAN: 'number1, [number2], …',
	LARGE: 'array, k',
	SMALL: 'array, k',
	ABS: 'number',
	INT: 'number',
	TRUNC: 'number, [num_digits]',
	SIGN: 'number',
	MOD: 'number, divisor',
	POWER: 'number, power',
	SQRT: 'number',
	EXP: 'number',
	LN: 'number',
	LOG10: 'number',
	LOG: 'number, [base]',
	PI: '',
	ROUND: 'number, [num_digits]',
	ROUNDUP: 'number, [num_digits]',
	ROUNDDOWN: 'number, [num_digits]',
	CEILING: 'number, [significance]',
	FLOOR: 'number, [significance]',
	RAND: '',
	RANDBETWEEN: 'bottom, top',
	SUMPRODUCT: 'array1, [array2], …',
	SUMIF: 'range, criteria, [sum_range]',
	SUMIFS: 'sum_range, criteria_range1, criteria1, …',
	COUNTIF: 'range, criteria',
	COUNTIFS: 'criteria_range1, criteria1, …',
	AVERAGEIF: 'range, criteria, [average_range]',
	AVERAGEIFS: 'average_range, criteria_range1, criteria1, …',
	MAXIFS: 'max_range, criteria_range1, criteria1, …',
	MINIFS: 'min_range, criteria_range1, criteria1, …',
	IF: 'logical_test, value_if_true, [value_if_false]',
	IFS: 'logical_test1, value_if_true1, …',
	IFERROR: 'value, value_if_error',
	IFNA: 'value, value_if_na',
	SWITCH: 'expression, value1, result1, …, [default]',
	CHOOSE: 'index_num, value1, [value2], …',
	AND: 'logical1, [logical2], …',
	OR: 'logical1, [logical2], …',
	XOR: 'logical1, [logical2], …',
	NOT: 'logical',
	ISNUMBER: 'value',
	ISTEXT: 'value',
	ISBLANK: 'value',
	ISERROR: 'value',
	ISNA: 'value',
	ISLOGICAL: 'value',
	ROW: '[reference]',
	COLUMN: '[reference]',
	ROWS: 'array',
	COLUMNS: 'array',
	VLOOKUP: 'lookup_value, table_array, col_index_num, [range_lookup]',
	HLOOKUP: 'lookup_value, table_array, row_index_num, [range_lookup]',
	XLOOKUP: 'lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]',
	MATCH: 'lookup_value, lookup_array, [match_type]',
	INDEX: 'array, row_num, [column_num]',
	CONCAT: 'text1, [text2], …',
	CONCATENATE: 'text1, [text2], …',
	TEXTJOIN: 'delimiter, ignore_empty, text1, …',
	LEFT: 'text, [num_chars]',
	RIGHT: 'text, [num_chars]',
	MID: 'text, start_num, num_chars',
	LEN: 'text',
	TRIM: 'text',
	UPPER: 'text',
	LOWER: 'text',
	PROPER: 'text',
	REPT: 'text, number_times',
	EXACT: 'text1, text2',
	SUBSTITUTE: 'text, old_text, new_text, [instance_num]',
	REPLACE: 'old_text, start_num, num_chars, new_text',
	FIND: 'find_text, within_text, [start_num]',
	SEARCH: 'find_text, within_text, [start_num]',
	TEXT: 'value, format_text',
	VALUE: 'text',
	TODAY: '',
	NOW: '',
	DATE: 'year, month, day',
	TIME: 'hour, minute, second',
	YEAR: 'serial_number',
	MONTH: 'serial_number',
	DAY: 'serial_number',
	HOUR: 'serial_number',
	MINUTE: 'serial_number',
	SECOND: 'serial_number',
	WEEKDAY: 'serial_number, [return_type]',
	EDATE: 'start_date, months',
	EOMONTH: 'start_date, months',
	DAYS: 'end_date, start_date',
	DATEDIF: 'start_date, end_date, unit',
	NETWORKDAYS: 'start_date, end_date, [holidays]',
	WORKDAY: 'start_date, days, [holidays]',
	DATEVALUE: 'date_text',
	PMT: 'rate, nper, pv, [fv], [type]',
	FV: 'rate, nper, pmt, [pv], [type]',
	PV: 'rate, nper, pmt, [fv], [type]',
	NPV: 'rate, value1, [value2], …',
	IRR: 'values, [guess]',
	STDEV: 'number1, [number2], …',
	'STDEV.S': 'number1, [number2], …',
	VAR: 'number1, [number2], …',
	RANK: 'number, ref, [order]',
	'RANK.EQ': 'number, ref, [order]',
	FACT: 'number',
	GCD: 'number1, [number2], …',
	LCM: 'number1, [number2], …'
};

export function signature(name: string): string | undefined {
	const s = SIG[name.toUpperCase()];
	return s === undefined ? undefined : s;
}

/**
 * Innermost function call around the caret in a formula being typed (text starts with '='),
 * with the index of the argument the caret is in. Ignores commas inside strings and nested parentheses.
 */
export function callAt(text: string, caret = text.length): { name: string; arg: number } | null {
	const stack: { name: string; arg: number }[] = [];
	let inStr = false;
	let inSheet = false;
	for (let i = 0; i < caret; i++) {
		const ch = text[i];
		if (inStr) {
			if (ch === '"') inStr = false;
			continue;
		}
		if (inSheet) {
			if (ch === "'") inSheet = false;
			continue;
		}
		if (ch === '"') inStr = true;
		else if (ch === "'") inSheet = true;
		else if (ch === '(') {
			const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(text.slice(0, i));
			stack.push({ name: m ? m[1].toUpperCase() : '', arg: 0 });
		} else if (ch === ')') stack.pop();
		else if ((ch === ',' || ch === ';') && stack.length) stack[stack.length - 1].arg++;
	}
	for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name) return stack[i];
	return null;
}

/** Splits "a, [b], …" into parts for highlighting the current argument (repeating "…" keeps the last). */
export function signatureParts(sig: string, arg: number): { parts: string[]; current: number } {
	const parts = sig ? sig.split(', ') : [];
	const ell = parts[parts.length - 1] === '…';
	let current = arg;
	if (current >= parts.length) current = ell ? parts.length - 2 : parts.length - 1;
	return { parts, current };
}
