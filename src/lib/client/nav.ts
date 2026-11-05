// goto() for app-absolute paths ('/docs/x'): prefixes the site base (GitHub Pages).
import { goto as kitGoto } from '$app/navigation';
import { withBase } from './base.ts';

export function goto(path: string, opts?: Parameters<typeof kitGoto>[1]) {
	return kitGoto(withBase(path), opts);
}
