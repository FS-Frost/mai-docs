// New empty files.
import { newDocContent } from '../docs/model.ts';
import { i18n, t } from '../i18n/index.svelte.ts';
import { newWorkbook, toContent } from '../sheets/model.ts';
import { createFile } from '../storage/library.ts';

export async function newDocument() {
	return createFile('doc', t().library.untitledDoc, newDocContent(i18n.locale));
}

export async function newSpreadsheet() {
	return createFile('sheet', t().library.untitledSheet, toContent(newWorkbook(t().sheet.sheetName(1))));
}
