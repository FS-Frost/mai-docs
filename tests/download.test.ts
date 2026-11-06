// Library download plan: single file, folder zip, mixed selection, trash skipped, unique names; fflate keeps empty dirs.
import { describe, expect, test } from 'bun:test';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import type { FileMeta, Folder } from '../src/lib/storage/db.ts';
import { planDownload, safeName } from '../src/lib/files/download-plan.ts';

const F = (id: string, name: string, parentId?: string, trashedAt?: number): Folder => ({ id, name, parentId, createdAt: 1, updatedAt: 1, trashedAt });
const M = (id: string, title: string, kind: FileMeta['kind'], folderId?: string, trashedAt?: number): FileMeta => ({ id, kind, title, createdAt: 1, updatedAt: 1, size: 1, folderId, trashedAt });

// Proyectos ─ 2026 ─ (empty) ; Proyectos: Plan (doc), Plan (doc), Cifras (sheet), Viejo (trashed)
// Proyectos ─ Basura (trashed) ─ Oculto ; root: Charla (slides)
const folders = [F('p', 'Proyectos'), F('y', '2026', 'p'), F('t', 'Basura', 'p', 5)];
const files = [M('d1', 'Plan', 'doc', 'p'), M('d2', 'Plan', 'doc', 'p'), M('s1', 'Cifras', 'sheet', 'p'), M('o', 'Viejo', 'doc', 'p', 9), M('h', 'Oculto', 'doc', 't'), M('c', 'Charla', 'slides')];
const all = { folders, files };

describe('download plan', () => {
	test('one file downloads as itself with its Office extension', () => {
		expect(planDownload({ files: ['c'], folders: [] }, all, 'Biblioteca')).toEqual({ type: 'file', id: 'c', name: 'Charla.pptx' });
	});

	test('one folder → "<folder>.zip" with its contents at the root, subfolders kept, trash skipped', () => {
		const p = planDownload({ files: [], folders: ['p'] }, all, 'Biblioteca');
		expect(p?.type).toBe('zip');
		if (p?.type !== 'zip') return;
		expect(p.name).toBe('Proyectos.zip');
		expect(p.dirs).toEqual(['2026/']);
		expect(p.files.map((f) => f.path)).toEqual(['Cifras.xlsx', 'Plan.docx', 'Plan (2).docx']);
	});

	test('several items → "<open folder>.zip"; selected folders become directories', () => {
		const p = planDownload({ files: ['c'], folders: ['p'] }, all, 'Mi carpeta');
		if (p?.type !== 'zip') throw new Error('zip expected');
		expect(p.name).toBe('Mi carpeta.zip');
		expect(p.dirs).toEqual(['Proyectos/', 'Proyectos/2026/']);
		expect(p.files.map((f) => f.path)).toEqual(['Proyectos/Cifras.xlsx', 'Proyectos/Plan.docx', 'Proyectos/Plan (2).docx', 'Charla.pptx']);
	});

	test('trashed or missing items alone give nothing; unsafe names are cleaned', () => {
		expect(planDownload({ files: ['o'], folders: ['t'] }, all, 'x')).toBeNull();
		expect(safeName('a/b:c?')).toBe('a b c');
		expect(safeName('  ')).toBe('untitled');
	});

	test('fflate writes empty directories from "{}" entries', () => {
		const entries: Zippable = { 'A/B': {}, 'A/x.txt': new Uint8Array([1]) };
		expect(Object.keys(unzipSync(zipSync(entries))).sort()).toEqual(['A/B/', 'A/x.txt']);
	});
});
