import { describe, expect, test } from 'bun:test';
import { parse, print } from '../src/lib/sheets/formula/parse.ts';
import { dateSerial, formatGeneral, serialToParts } from '../src/lib/sheets/values.ts';
import { book, calc } from './helpers.ts';

describe('parser', () => {
	const roundTrip = [
		'SUM(A1:B2)',
		'Sheet2!A1+1',
		"'My sheet'!$A$1*2",
		'IF(A1>0,"yes","no")',
		'-A1^2',
		'A1%',
		'SUM(A:A)',
		'SUM(1:3)',
		'{1,2;3,4}',
		'"say ""hi"""',
		'A1&" "&B1',
		'(1+2)*3',
		'IFERROR(1/0,#N/A)',
		'LOG10(100)',
		'COUNTIF(A1:A9,">5")',
		'#REF!+1',
		"'Hoja 2'!#REF!"
	];
	for (const f of roundTrip) test(`round trip ${f}`, () => expect(print(parse(f))).toBe(f));

	test('function names are upper-cased', () => expect(print(parse('sum(a1)'))).toBe('SUM(A1)'));
	test('invalid formula throws', () => {
		expect(() => parse('SUM(')).toThrow();
		expect(() => parse('1+')).toThrow();
		expect(() => parse('"abc')).toThrow();
	});
});

describe('values', () => {
	test('date serials match Excel', () => {
		expect(dateSerial(1900, 1, 1)).toBe(1);
		expect(dateSerial(1900, 2, 28)).toBe(59);
		expect(dateSerial(1900, 3, 1)).toBe(61);
		expect(dateSerial(2024, 1, 1)).toBe(45292);
		expect(serialToParts(45292)).toMatchObject({ y: 2024, m: 1, d: 1 });
		expect(serialToParts(60)).toMatchObject({ y: 1900, m: 2, d: 29 });
	});
	test('general format', () => {
		expect(formatGeneral(0.1 + 0.2)).toBe('0.3');
		expect(formatGeneral(42)).toBe('42');
		expect(formatGeneral(1 / 3)).toBe('0.333333333333333');
		expect(formatGeneral(1e20)).toBe('1E+20');
	});
});

describe('operators', () => {
	test.each([
		['1+2*3', 7],
		['(1+2)*3', 9],
		['2^3^2', 64],
		['-2^2', 4],
		['10/4', 2.5],
		['50%', 0.5],
		['"a"&"b"', 'ab'],
		['1=1', true],
		['"A"="a"', true],
		['"b">"a"', true],
		['1<"a"', true],
		['TRUE+1', 2],
		['"3"+1', 4]
	])('%s', (f, v) => expect(calc(f)).toEqual(v as never));
	test('errors', () => {
		expect(calc('1/0')).toEqual({ e: '#DIV/0!' });
		expect(calc('"x"+1')).toEqual({ e: '#VALUE!' });
		expect(calc('NOPE(1)')).toEqual({ e: '#NAME?' });
		expect(calc('foo')).toEqual({ e: '#NAME?' });
		expect(calc('#REF!+1')).toEqual({ e: '#REF!' });
	});
	test('empty reference is 0', () => expect(calc('A1')).toBe(0));
});

describe('functions', () => {
	const cells = { A1: 1, A2: 2, A3: 3, A4: 'x', A5: true, B1: 'apple', B2: 'banana', B3: 'cherry', C1: 10, C2: 20, C3: 30 };
	test.each([
		['SUM(A1:A5)', 6],
		['SUM(A1:A3,10)', 16],
		['AVERAGE(A1:A3)', 2],
		['MIN(A1:A3)', 1],
		['MAX(A1:A3,7)', 7],
		['COUNT(A1:A5)', 3],
		['COUNTA(A1:A5)', 5],
		['COUNTBLANK(A1:A6)', 1],
		['PRODUCT(A1:A3)', 6],
		['ROUND(2.345,2)', 2.35],
		['ROUND(-2.5,0)', -3],
		['ROUNDDOWN(2.399,1)', 2.3],
		['ROUNDUP(2.301,1)', 2.4],
		['MOD(-3,2)', 1],
		['INT(-1.5)', -2],
		['IF(A1>0,"pos","neg")', 'pos'],
		['IF(FALSE,1)', false],
		['IFS(A1>5,"big",A1>0,"small")', 'small'],
		['IFERROR(1/0,"oops")', 'oops'],
		['IFNA(MATCH(9,A1:A3,0),"none")', 'none'],
		['AND(TRUE,A1>0)', true],
		['OR(FALSE,A1>5)', false],
		['NOT(FALSE)', true],
		['SWITCH(2,1,"one",2,"two","other")', 'two'],
		['CHOOSE(3,"a","b","c")', 'c'],
		['SUMIF(A1:A3,">1")', 5],
		['SUMIF(B1:B3,"b*",C1:C3)', 20],
		['COUNTIF(B1:B3,"*an*")', 1],
		['COUNTIFS(A1:A3,">1",C1:C3,"<30")', 1],
		['SUMIFS(C1:C3,A1:A3,">=2")', 50],
		['AVERAGEIF(A1:A3,">1")', 2.5],
		['VLOOKUP("banana",B1:C3,2,FALSE)', 20],
		['VLOOKUP(2.5,A1:C3,3)', 20],
		['HLOOKUP(2,A1:C3,1,FALSE)', { e: '#N/A' }],
		['MATCH("cherry",B1:B3,0)', 3],
		['INDEX(C1:C3,2)', 20],
		['INDEX(A1:C3,3,3)', 30],
		['SUM(INDEX(A1:C3,0,3))', 60],
		['XLOOKUP("cherry",B1:B3,C1:C3)', 30],
		['XLOOKUP("zzz",B1:B3,C1:C3,"nf")', 'nf'],
		['CONCAT(B1,"-",B2)', 'apple-banana'],
		['CONCATENATE("a",1,TRUE)', 'a1TRUE'],
		['TEXTJOIN(", ",TRUE,B1:B3)', 'apple, banana, cherry'],
		['LEFT("hello",2)', 'he'],
		['RIGHT("hello",3)', 'llo'],
		['MID("hello",2,3)', 'ell'],
		['LEN("hello")', 5],
		['TRIM("  a   b ")', 'a b'],
		['UPPER("abc")', 'ABC'],
		['PROPER("hello world")', 'Hello World'],
		['SUBSTITUTE("a-b-c","-","+")', 'a+b+c'],
		['SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c'],
		['FIND("l","hello")', 3],
		['SEARCH("L*O","hello")', 3],
		['TEXT(0.5,"0%")', '50%'],
		['TEXT(1234.5,"#,##0.00")', '1,234.50'],
		['VALUE("1,234.5")', 1234.5],
		['DATE(2024,1,31)', 45322],
		['YEAR(45322)', 2024],
		['MONTH(45322)', 1],
		['DAY(45322)', 31],
		['EDATE(45322,1)', 45351],
		['EOMONTH(45322,1)', 45351],
		['WEEKDAY(45292)', 2],
		['DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"Y")', 4],
		['DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"M")', 49],
		['NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,7))', 5],
		['ISNUMBER(A1)', true],
		['ISTEXT(A4)', true],
		['ISBLANK(A9)', true],
		['ISERROR(1/0)', true],
		['ROW()', 1000],
		['COLUMN(C5)', 3],
		['ROWS(A1:B4)', 4],
		['SUMPRODUCT(A1:A3,C1:C3)', 140],
		['SUMPRODUCT((A1:A3>1)*C1:C3)', 50],
		['MEDIAN(1,3,2,4)', 2.5],
		['LARGE(C1:C3,1)', 30],
		['FACT(5)', 120],
		['GCD(12,18)', 6]
	])('%s', (f, v) => expect(calc(f, cells)).toEqual(v as never));

	test('volatile TODAY is an integer serial', () => {
		const v = calc('TODAY()');
		expect(typeof v).toBe('number');
		expect(Number.isInteger(v)).toBe(true);
	});
});

describe('engine', () => {
	test('cross-sheet SUM recalculates', () => {
		const b = book({ Hoja1: { A1: '=SUM(Hoja2!A1:A3)' }, Hoja2: { A1: 1, A2: 2, A3: 3 } });
		expect(b.get('A1')).toBe(6);
		b.set('A2', 10, 'Hoja2');
		expect(b.get('A1')).toBe(14);
	});
	test('chain recalculation', () => {
		const b = book({ S: { A1: 1, A2: '=A1+1', A3: '=A2+1', A4: '=A3*2' } });
		expect(b.get('A4')).toBe(6);
		b.set('A1', 5);
		expect(b.get('A4')).toBe(14);
	});
	test('long chain does not overflow the stack', () => {
		const spec: Record<string, string | number> = { A1: 1 };
		for (let i = 2; i <= 5000; i++) spec[`A${i}`] = `=A${i - 1}+1`;
		// Reverse dependency direction too (evaluation goes upward).
		const up: Record<string, string | number> = { B5000: 1 };
		for (let i = 4999; i >= 1; i--) up[`B${i}`] = `=B${i + 1}+1`;
		const b = book({ S: { ...spec, ...up } });
		expect(b.get('A5000')).toBe(5000);
		expect(b.get('B1')).toBe(5000);
	});
	test('cycles give #CIRC!', () => {
		const b = book({ S: { A1: '=B1+1', B1: '=A1+1', C1: '=A1' } });
		const v = b.get('A1');
		expect(v).toEqual({ e: '#CIRC!' });
		expect(b.get('C1')).toEqual({ e: '#CIRC!' });
		b.set('B1', 3);
		expect(b.get('A1')).toBe(4);
		expect(b.get('C1')).toBe(4);
	});
	test('whole column reference follows new data', () => {
		const b = book({ S: { A1: 1, A2: 2, B1: '=SUM(A:A)' } });
		expect(b.get('B1')).toBe(3);
		b.set('A100', 7);
		expect(b.get('B1')).toBe(10);
	});
	test('formula replaced by value updates dependents', () => {
		const b = book({ S: { A1: '=1+1', B1: '=A1*10' } });
		expect(b.get('B1')).toBe(20);
		b.set('A1', 3);
		expect(b.get('B1')).toBe(30);
	});
	test('missing sheet is #REF!', () => {
		const b = book({ S: { A1: '=Nope!A1' } });
		expect(b.get('A1')).toEqual({ e: '#REF!' });
	});
});

import { callAt, signature, signatureParts } from '../src/lib/sheets/formula/signatures.ts';

describe('signature hints', () => {
	test('innermost call and argument index', () => {
		expect(callAt('=SUM(')).toEqual({ name: 'SUM', arg: 0 });
		expect(callAt('=IF(A1>0,ROUND(B1,')).toEqual({ name: 'ROUND', arg: 1 });
		expect(callAt('=IF(A1>0,ROUND(B1,2),')).toEqual({ name: 'IF', arg: 2 });
		expect(callAt('=CONCAT("a,b(",')).toEqual({ name: 'CONCAT', arg: 1 });
		expect(callAt("=SUM('x,y'!A1,")).toEqual({ name: 'SUM', arg: 1 });
		expect(callAt('=A1+1')).toBeNull();
	});
	test('parts and repeat', () => {
		expect(signature('vlookup')).toContain('lookup_value');
		expect(signatureParts(signature('SUM')!, 5).current).toBe(1);
		expect(signatureParts(signature('IF')!, 1).current).toBe(1);
	});
});
