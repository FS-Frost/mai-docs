import { describe, expect, test } from 'bun:test';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { unzipSync, strFromU8 } from 'fflate';
import { schemaExtensions } from '../src/lib/docs/extensions/index.ts';
import { findMatches } from '../src/lib/docs/extensions/search.ts';
import { buildDocx, docxBytes, halfPoints, hexColor } from '../src/lib/docs/io/docx-export.ts';
import { jsonToMarkdown, markdownToJSON, textToJSON } from '../src/lib/docs/io/markdown.ts';
import { defaultPage, plainText } from '../src/lib/docs/model.ts';

const sample = {
	type: 'doc',
	content: [
		{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
		{
			type: 'paragraph',
			attrs: { textAlign: 'center', indent: 1 },
			content: [
				{ type: 'text', text: 'Hello ' },
				{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
				{ type: 'text', text: ' red', marks: [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '14pt', fontFamily: 'Georgia' } }] },
				{ type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }
			]
		},
		{
			type: 'orderedList',
			content: [
				{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
				{
					type: 'listItem',
					content: [
						{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
						{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] }] }
					]
				}
			]
		},
		{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] }] },
		{
			type: 'table',
			content: [
				{
					type: 'tableRow',
					content: [
						{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H1' }] }] },
						{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H2' }] }] }
					]
				},
				{
					type: 'tableRow',
					content: [{ type: 'tableCell', attrs: { colspan: 2, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'merged' }] }] }]
				}
			]
		},
		{ type: 'image', attrs: { src: 'mai-blob:x', width: 100 } }
	]
};

// 1x1 transparent PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('docx export', () => {
	test('helpers', () => {
		expect(hexColor('#f00')).toBe('FF0000');
		expect(hexColor('rgb(16, 32, 48)')).toBe('102030');
		expect(halfPoints('12pt')).toBe(24);
		expect(halfPoints('16px')).toBe(24);
	});
	test('structure', async () => {
		const doc = await buildDocx(sample, defaultPage('es'), async () => ({ data: PNG, type: 'png', width: 1, height: 1 }), 'T');
		const bytes = new Uint8Array(await docxBytes(doc));
		const files = unzipSync(bytes);
		const xml = strFromU8(files['word/document.xml']);
		expect(xml).toContain('Heading1');
		expect(xml).toContain('>Title<');
		expect(xml).toContain('<w:b/>');
		expect(xml).toContain('w:val="FF0000"');
		expect(xml).toContain('Georgia');
		expect(xml).toContain('<w:jc w:val="center"/>');
		expect(xml).toContain('w:gridSpan w:val="2"');
		expect(xml).toContain('☑');
		expect(xml).toContain('<w:numPr>');
		expect(xml).toContain('w:w="11906"'); // A4 width in twips
		expect(Object.keys(files).some((f) => f.startsWith('word/media/'))).toBe(true);
		expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('https://example.com');
	});
	test('landscape letter', async () => {
		const doc = await buildDocx({ type: 'doc', content: [] }, { ...defaultPage('en'), orientation: 'landscape' }, async () => null);
		const xml = strFromU8(unzipSync(new Uint8Array(await docxBytes(doc)))['word/document.xml']);
		expect(xml).toContain('w:orient="landscape"');
	});
});

describe('markdown', () => {
	test('round trip keeps structure', () => {
		const md = '# Title\n\nSome **bold** and *italic* text with [a link](https://x.y).\n\n- one\n- two\n\n1. first\n2. second\n\n> quote\n\n```\ncode\n```';
		const json = markdownToJSON(md);
		const types = (json.content ?? []).map((n) => n.type);
		expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList', 'blockquote', 'codeBlock']);
		const back = jsonToMarkdown(json);
		expect(back).toContain('# Title');
		expect(back).toContain('**bold**');
		expect(back).toContain('[a link](https://x.y)');
		expect(back).toContain('- one');
		expect(back).toContain('1. first');
		expect(markdownToJSON(back).content?.map((n) => n.type)).toEqual(types);
	});
	test('tables survive', () => {
		const json = markdownToJSON('| a | b |\n|---|---|\n| 1 | 2 |');
		expect(json.content?.[0].type).toBe('table');
		expect(jsonToMarkdown(json)).toContain('| a');
	});
	test('plain text', () => {
		const json = textToJSON('line 1\nline 2\n\npara 2');
		expect(json.content?.length).toBe(2);
		expect(plainText(json)).toBe('line 1\nline 2\n\npara 2');
	});
});

describe('search', () => {
	const schema = getSchema(schemaExtensions());
	const doc = PMNode.fromJSON(schema, {
		type: 'doc',
		content: [
			{ type: 'paragraph', content: [{ type: 'text', text: 'Cat cat catalog' }] },
			{ type: 'paragraph', content: [{ type: 'text', text: 'the ' }, { type: 'text', text: 'cat', marks: [{ type: 'bold' }] }] }
		]
	});
	test('case-insensitive', () => expect(findMatches(doc, 'cat', { caseSensitive: false, wholeWord: false }).length).toBe(4));
	test('case-sensitive whole word', () => {
		const m = findMatches(doc, 'cat', { caseSensitive: true, wholeWord: true });
		expect(m.length).toBe(2);
		expect(doc.textBetween(m[0].from, m[0].to)).toBe('cat');
		expect(doc.textBetween(m[1].from, m[1].to)).toBe('cat');
	});
});

describe('docx image layout', () => {
	test('alignment, wrapping, alt text and captions', async () => {
		const doc = await buildDocx(
			{
				type: 'doc',
				content: [
					{ type: 'image', attrs: { src: 'mai-blob:a', align: 'center', alt: 'Logo azul' } },
					{ type: 'paragraph', attrs: { caption: true, textAlign: 'center' }, content: [{ type: 'text', text: 'Figura 1' }] },
					{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'mai-blob:b', wrap: 'left' } }, { type: 'text', text: 'texto alrededor' }] },
					{ type: 'image', attrs: { src: 'mai-blob:c', wrap: 'right' } }
				]
			},
			defaultPage('es'),
			async () => ({ data: PNG, type: 'png', width: 10, height: 10 })
		);
		const files = unzipSync(new Uint8Array(await docxBytes(doc)));
		const xml = strFromU8(files['word/document.xml']);
		expect(xml).toContain('descr="Logo azul"');
		expect(xml).toContain('<w:jc w:val="center"/>');
		expect(xml).toContain('<w:pStyle w:val="Caption"/>');
		expect(xml).toContain('<wp:anchor');
		expect(xml).toContain('<wp:wrapSquare');
		expect(xml).toContain('<wp:align>right</wp:align>');
		expect(strFromU8(files['word/styles.xml'])).toContain('w:styleId="Caption"');
	});
});
