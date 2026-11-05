// Package checks shared by the slides tests.
import { expect } from 'bun:test';
import { strFromU8 } from 'fflate';
import { XMLValidator } from 'fast-xml-parser';

/** Well-formed XML, every rel target exists, every r:id used is declared, content types cover parts and extensions. */
export function checkPackage(files: Record<string, Uint8Array>) {
	const names = Object.keys(files);
	for (const n of names.filter((x) => x.endsWith('.xml') || x.endsWith('.rels'))) {
		const r = XMLValidator.validate(strFromU8(files[n]));
		expect(r === true ? true : `${n}: ${JSON.stringify(r)}`).toBe(true);
	}
	for (const r of names.filter((n) => n.endsWith('.rels'))) {
		const dir = r.replace(/_rels\/[^/]*\.rels$/, '');
		const xml = strFromU8(files[r]);
		for (const m of xml.matchAll(/Target="([^"]+)"( TargetMode="External")?/g)) {
			if (m[2]) continue;
			const target = new URL(m[1], `file:///${dir}`).pathname.slice(1);
			expect(names, `${r} → ${m[1]}`).toContain(target);
		}
		const part = r.replace(/_rels\/([^/]*)\.rels$/, '$1');
		if (!files[part]) continue;
		const ids = new Set([...xml.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
		for (const m of strFromU8(files[part]).matchAll(/r:(?:id|embed|link)="([^"]+)"/g)) expect(ids, `${part} uses ${m[1]}`).toContain(m[1]);
	}
	const ct = strFromU8(files['[Content_Types].xml']);
	for (const n of names.filter((x) => x.endsWith('.xml') && !x.startsWith('['))) expect(ct, n).toContain(`PartName="/${n}"`);
	const exts = new Set(names.map((n) => /\.([a-z0-9]+)$/i.exec(n)?.[1]).filter((e): e is string => !!e && e !== 'xml' && e !== 'rels'));
	for (const ext of exts) expect(ct, ext).toContain(`Extension="${ext}"`);
}
