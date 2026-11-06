<script lang="ts">
	// Right-click menu of the document editor. Ctrl+right click and the keyboard menu key (Shift+F10 / ContextMenu)
	// keep the browser menu, which has the spelling suggestions a page cannot read.
	// The menu acts on what was under the pointer: the caret moves there unless the click falls inside the selection;
	// images and charts get a node selection.
	import type { Editor } from '@tiptap/core';
	import { NodeSelection, TextSelection } from '@tiptap/pm/state';
	import { promptDialog } from '../../client/dialogs.svelte.ts';
	import { toast } from '../../client/toast.svelte.ts';
	import { insertImages } from '../../docs/editor.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import ContextMenu, { type MenuAt } from '../ContextMenu.svelte';
	import Icon from '../Icon.svelte';
	import { CHART_EDIT_EVENT } from './chart-view.svelte.ts';

	let { editor, docId, readonly = false }: { editor: Editor; docId: string; readonly?: boolean } = $props();

	let at = $state<MenuAt | null>(null);
	let target = $state<{ kind: 'text' | 'image' | 'chart'; pos: number; table: boolean; link: string | null; empty: boolean }>({ kind: 'text', pos: 0, table: false, link: null, empty: true });
	let keyboardMenu = false;

	/** Keyboard-opened context menus stay native (Shift+F10, the menu key). */
	export function keydown(e: KeyboardEvent) {
		keyboardMenu = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
	}

	export function open(e: MouseEvent) {
		if (e.ctrlKey || e.metaKey || keyboardMenu) {
			keyboardMenu = false;
			return;
		}
		const view = editor.view;
		const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
		if (!hit) return;
		e.preventDefault();
		const { state } = view;
		const node = hit.inside >= 0 ? state.doc.nodeAt(hit.inside) : null;
		let kind: 'text' | 'image' | 'chart' = 'text';
		if (node && (node.type.name === 'image' || node.type.name === 'chart')) {
			kind = node.type.name;
			view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, hit.inside)));
		} else {
			const { from, to } = state.selection;
			const inside = from !== to && hit.pos >= from && hit.pos <= to;
			if (!inside) view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(hit.pos))));
		}
		editor.commands.focus();
		const s = editor.state.selection;
		target = { kind, pos: s.from, table: editor.isActive('table'), link: (editor.getAttributes('link').href as string | undefined) ?? null, empty: s.empty };
		at = { x: e.clientX, y: e.clientY };
	}

	const chain = () => editor.chain().focus();

	function exec(cmd: 'copy' | 'cut') {
		editor.commands.focus();
		// execCommand still runs ProseMirror's copy/cut handlers (rich HTML + plain text) inside a user gesture.
		if (!document.execCommand(cmd)) toast.info(t().ctx.pasteDenied);
	}

	async function paste(plain: boolean) {
		try {
			if (plain || !navigator.clipboard.read) {
				const text = await navigator.clipboard.readText();
				editor.commands.focus();
				if (text) editor.view.pasteText(text);
				return;
			}
			const items = await navigator.clipboard.read();
			for (const it of items) {
				const img = it.types.find((x) => x.startsWith('image/'));
				if (img && !it.types.includes('text/html')) {
					const blob = await it.getType(img);
					await insertImages(editor, docId, [new File([blob], 'image', { type: img })]);
					return;
				}
				editor.commands.focus();
				if (it.types.includes('text/html')) return void editor.view.pasteHTML(await (await it.getType('text/html')).text());
				if (it.types.includes('text/plain')) return void editor.view.pasteText(await (await it.getType('text/plain')).text());
			}
		} catch {
			toast.info(t().ctx.pasteDenied);
		}
	}

	async function link() {
		const url = await promptDialog(t().doc.linkUrl, target.link || 'https://');
		if (url === null) return;
		if (!url.trim() || url.trim() === 'https://') chain().extendMarkRange('link').unsetLink().run();
		else chain().extendMarkRange('link').setLink({ href: url.trim() }).run();
	}

	function editChart() {
		editor.view.dom.dispatchEvent(new CustomEvent(CHART_EDIT_EVENT, { detail: target.pos, bubbles: true }));
	}

	const active = (name: string) => editor.isActive(name);
</script>

{#snippet sep()}<div class="my-1 border-t border-line"></div>{/snippet}

<ContextMenu {at} onclose={() => (at = null)} label={t().ctx.label}>
	{#snippet children(close)}
		{@const run = (fn: () => unknown) => () => (close(), void fn())}
		{#if readonly}
			<button class="menu-item" disabled={target.empty} onclick={run(() => exec('copy'))}><Icon name="copy" size={16} />{t().ctx.copy}</button>
			<button class="menu-item" onclick={run(() => editor.commands.selectAll())}>{t().ctx.selectAll}</button>
		{:else}
			{#if target.kind === 'image'}
				<div class="flex px-1">
					<button class="menu-item !w-auto !px-2" title={t().docImage.alignLeft} aria-label={t().docImage.alignLeft} onclick={run(() => chain().setImageAlign('left').run())}><Icon name="alignLeft" size={16} /></button>
					<button class="menu-item !w-auto !px-2" title={t().docImage.alignCenter} aria-label={t().docImage.alignCenter} onclick={run(() => chain().setImageAlign('center').run())}><Icon name="alignCenter" size={16} /></button>
					<button class="menu-item !w-auto !px-2" title={t().docImage.alignRight} aria-label={t().docImage.alignRight} onclick={run(() => chain().setImageAlign('right').run())}><Icon name="alignRight" size={16} /></button>
					<button class="menu-item !w-auto !px-2" title={t().docImage.wrapLeft} aria-label={t().docImage.wrapLeft} onclick={run(() => chain().setImageWrap(editor.getAttributes('image').wrap === 'left' ? 'inline' : 'left').run())}><Icon name="wrapLeft" size={16} /></button>
					<button class="menu-item !w-auto !px-2" title={t().docImage.wrapRight} aria-label={t().docImage.wrapRight} onclick={run(() => chain().setImageWrap(editor.getAttributes('image').wrap === 'right' ? 'inline' : 'right').run())}><Icon name="wrapRight" size={16} /></button>
				</div>
				<button class="menu-item" onclick={run(() => chain().addImageCaption(t().docImage.captionPlaceholder).run())}><Icon name="caption" size={16} />{t().docImage.caption}</button>
				{@render sep()}
			{:else if target.kind === 'chart'}
				<button class="menu-item" onclick={run(editChart)}><Icon name="chart" size={16} />{t().chart.edit}</button>
				{@render sep()}
			{/if}
			<button class="menu-item" disabled={target.empty} onclick={run(() => exec('cut'))}>{t().ctx.cut}</button>
			<button class="menu-item" disabled={target.empty} onclick={run(() => exec('copy'))}><Icon name="copy" size={16} />{t().ctx.copy}</button>
			<button class="menu-item" onclick={run(() => paste(false))}>{t().ctx.paste}</button>
			<button class="menu-item" onclick={run(() => paste(true))}>{t().ctx.pastePlain}</button>
			{#if target.kind !== 'text'}
				<button class="menu-item text-bad" onclick={run(() => chain().deleteSelection().run())}><Icon name="trash" size={16} />{t().common.delete}</button>
			{:else}
				<button class="menu-item" onclick={run(() => editor.commands.selectAll())}>{t().ctx.selectAll}</button>
				{@render sep()}
				<div class="flex px-1">
					<button class="menu-item !w-auto !px-2" title={t().doc.bold} aria-label={t().doc.bold} aria-pressed={active('bold')} onclick={run(() => chain().toggleBold().run())}><Icon name="bold" size={16} /></button>
					<button class="menu-item !w-auto !px-2" title={t().doc.italic} aria-label={t().doc.italic} aria-pressed={active('italic')} onclick={run(() => chain().toggleItalic().run())}><Icon name="italic" size={16} /></button>
					<button class="menu-item !w-auto !px-2" title={t().doc.underline} aria-label={t().doc.underline} aria-pressed={active('underline')} onclick={run(() => chain().toggleUnderline().run())}><Icon name="underline" size={16} /></button>
					<button class="menu-item !w-auto !px-2" title={t().ctx.clearFormat} aria-label={t().ctx.clearFormat} onclick={run(() => chain().unsetAllMarks().clearNodes().run())}><Icon name="clear" size={16} /></button>
				</div>
				<button class="menu-item" onclick={run(link)}><Icon name="link" size={16} />{t().ctx.link}</button>
				{#if target.link}
					<button class="menu-item" onclick={run(() => window.open(target.link!, '_blank', 'noopener'))}>{t().ctx.openLink}</button>
					<button class="menu-item" onclick={run(() => chain().extendMarkRange('link').unsetLink().run())}>{t().ctx.removeLink}</button>
				{/if}
				{#if target.table}
					{@render sep()}
					<button class="menu-item" onclick={run(() => chain().addRowBefore().run())}>{t().doc.addRowBefore}</button>
					<button class="menu-item" onclick={run(() => chain().addRowAfter().run())}>{t().doc.addRowAfter}</button>
					<button class="menu-item" onclick={run(() => chain().addColumnBefore().run())}>{t().doc.addColBefore}</button>
					<button class="menu-item" onclick={run(() => chain().addColumnAfter().run())}>{t().doc.addColAfter}</button>
					<button class="menu-item" onclick={run(() => chain().deleteRow().run())}>{t().doc.deleteRow}</button>
					<button class="menu-item" onclick={run(() => chain().deleteColumn().run())}>{t().doc.deleteCol}</button>
					<button class="menu-item" disabled={!editor.can().mergeCells()} onclick={run(() => chain().mergeCells().run())}>{t().doc.mergeCells}</button>
					<button class="menu-item" disabled={!editor.can().splitCell()} onclick={run(() => chain().splitCell().run())}>{t().doc.splitCell}</button>
					<button class="menu-item text-bad" onclick={run(() => chain().deleteTable().run())}>{t().doc.deleteTable}</button>
				{/if}
			{/if}
		{/if}
		<p class="max-w-56 px-3 pt-1.5 pb-1 text-[0.7rem] leading-snug text-faint">{t().ctx.nativeHint}</p>
	{/snippet}
</ContextMenu>
