// Formula AST. Formulas are stored without the leading '=' and always use English function names and ','.
import type { ErrorCode } from '../values.ts';

/** One end of a reference. r/c undefined = whole column / whole row (A:A, 1:1). */
export type RefEnd = { r?: number; c?: number; ar: boolean; ac: boolean };

export type Node =
	| { t: 'num'; v: number }
	| { t: 'str'; v: string }
	| { t: 'bool'; v: boolean }
	| { t: 'err'; v: ErrorCode }
	/** Single cell or range. `b` undefined = single cell. `sheet` = sheet name as written (unquoted). */
	| { t: 'ref'; sheet?: string; a: RefEnd; b?: RefEnd }
	/** Reference that became invalid (#REF!), keeping the sheet prefix for printing. */
	| { t: 'refErr'; sheet?: string }
	| { t: 'name'; name: string }
	| { t: 'fn'; name: string; args: Node[] }
	| { t: 'un'; op: '-' | '+' | '%'; a: Node }
	| { t: 'bin'; op: BinOp; a: Node; b: Node }
	| { t: 'arr'; rows: Node[][] }
	| { t: 'paren'; a: Node }
	| { t: 'empty' };

export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=';
