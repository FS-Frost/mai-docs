// New empty files.
import { newDocContent } from '../docs/model.ts';
import { i18n, t } from '../i18n/index.svelte.ts';
import { newWorkbook, toContent } from '../sheets/model.ts';
import { createFile } from '../storage/library.ts';

export async function newDocument(folderId?: string) {
	return createFile('doc', t().library.untitledDoc, newDocContent(i18n.locale), { folderId });
}

export async function newSpreadsheet(folderId?: string) {
	return createFile('sheet', t().library.untitledSheet, toContent(newWorkbook(t().sheet.sheetName(1))), { folderId });
}

export async function newPresentation(folderId?: string) {
	const { newDeckContent } = await import('../slides/deck.svelte.ts');
	const { themeById } = await import('../slides/themes.ts');
	return createFile('slides', t().library.untitledSlides, newDeckContent(themeById('simple')), { folderId });
}

/** App route of a library file. */
export const fileRoute = (kind: 'doc' | 'sheet' | 'slides', id: string) => (kind === 'doc' ? `/docs/${id}` : kind === 'sheet' ? `/sheets/${id}` : `/slides/${id}`);

/** New empty file, optionally inside a library folder. */
export const newOfKind = (kind: 'doc' | 'sheet' | 'slides', folderId?: string) => (kind === 'doc' ? newDocument(folderId) : kind === 'sheet' ? newSpreadsheet(folderId) : newPresentation(folderId));
