<script lang="ts">
	// Formatting toolbar. `ver` changes on every editor transaction, so active states recompute.
	import type { Editor } from '@tiptap/core';
	import { promptDialog } from '../../client/dialogs.svelte.ts';
	import { insertImages } from '../../docs/editor.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import ColorPicker from '../ColorPicker.svelte';
	import Icon, { type IconName } from '../Icon.svelte';
	import Menu from '../Menu.svelte';

	let { editor, ver, docId, zoom = $bindable(100), onzoom }: { editor: Editor; ver: number; docId: string; zoom?: number; onzoom?: () => void } = $props();

	const FONTS = ['Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Courier New'];
	const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

	const dep = <T,>(_v: number, x: T) => x;
	const a = (name: string, attrs?: Record<string, unknown>) => dep(ver, editor.isActive(name, attrs));
	const chain = () => editor.chain().focus();

	const style = $derived.by(() => {
		void ver;
		if (editor.isActive('heading', { level: 1 })) return 'h1';
		if (editor.isActive('heading', { level: 2 })) return 'h2';
		if (editor.isActive('heading', { level: 3 })) return 'h3';
		return 'p';
	});
	const ts = $derived(dep(ver, editor.getAttributes('textStyle')));
	const font = $derived((ts.fontFamily as string | undefined)?.split(',')[0].replace(/["']/g, '') ?? '');
	const size = $derived(((ts.fontSize as string | undefined) ?? '').replace('pt', ''));
	const color = $derived((ts.color as string | undefined) ?? '#000000');
	const hl = $derived(dep(ver, (editor.getAttributes('highlight').color as string | undefined) ?? 'transparent'));
	const inTable = $derived(a('table'));

	function setStyle(v: string) {
		if (v === 'p') chain().setParagraph().run();
		else chain().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
	}

	async function link() {
		const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
		const url = await promptDialog(t().doc.linkUrl, prev || 'https://');
		if (url === null) return;
		if (!url.trim() || url.trim() === 'https://') chain().extendMarkRange('link').unsetLink().run();
		else chain().extendMarkRange('link').setLink({ href: url.trim() }).run();
	}

	function pickImage() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.multiple = true;
		input.onchange = () => void insertImages(editor, docId, [...(input.files ?? [])]);
		input.click();
	}

	let gridHover = $state({ r: 0, c: 0 });

	type Btn = { icon: IconName; label: string; run: () => void; active?: boolean; disabled?: boolean };
	const marks = $derived<Btn[]>([
		{ icon: 'bold', label: `${t().doc.bold} (Ctrl+B)`, run: () => chain().toggleBold().run(), active: a('bold') },
		{ icon: 'italic', label: `${t().doc.italic} (Ctrl+I)`, run: () => chain().toggleItalic().run(), active: a('italic') },
		{ icon: 'underline', label: `${t().doc.underline} (Ctrl+U)`, run: () => chain().toggleUnderline().run(), active: a('underline') },
		{ icon: 'strike', label: t().doc.strike, run: () => chain().toggleStrike().run(), active: a('strike') }
	]);
	const aligns = $derived<Btn[]>([
		{ icon: 'alignLeft', label: t().doc.alignLeft, run: () => chain().setTextAlign('left').run(), active: a('paragraph', { textAlign: 'left' }) || a('heading', { textAlign: 'left' }) },
		{ icon: 'alignCenter', label: t().doc.alignCenter, run: () => chain().setTextAlign('center').run(), active: a('paragraph', { textAlign: 'center' }) || a('heading', { textAlign: 'center' }) },
		{ icon: 'alignRight', label: t().doc.alignRight, run: () => chain().setTextAlign('right').run(), active: a('paragraph', { textAlign: 'right' }) || a('heading', { textAlign: 'right' }) },
		{ icon: 'justify', label: t().doc.justify, run: () => chain().setTextAlign('justify').run(), active: a('paragraph', { textAlign: 'justify' }) || a('heading', { textAlign: 'justify' }) }
	]);
	const lists = $derived<Btn[]>([
		{ icon: 'listBullet', label: t().doc.bulletList, run: () => chain().toggleBulletList().run(), active: a('bulletList') },
		{ icon: 'listOrdered', label: t().doc.orderedList, run: () => chain().toggleOrderedList().run(), active: a('orderedList') },
		{ icon: 'listTask', label: t().doc.taskList, run: () => chain().toggleTaskList().run(), active: a('taskList') },
		{ icon: 'outdent', label: t().doc.outdent, run: () => chain().outdent().run() },
		{ icon: 'indent', label: t().doc.indent, run: () => chain().indent().run() }
	]);
</script>

{#snippet btn(b: Btn)}
	<button class="tb" title={b.label} aria-label={b.label} aria-pressed={b.active ?? undefined} disabled={b.disabled} onmousedown={(e) => e.preventDefault()} onclick={b.run}>
		<Icon name={b.icon} />
	</button>
{/snippet}

<div class="no-print flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 py-1 [scrollbar-width:thin] md:flex-wrap md:overflow-visible" role="toolbar" aria-label={t().doc.format}>
	<button class="tb" title="{t().doc.undo} (Ctrl+Z)" aria-label={t().doc.undo} disabled={dep(ver, !editor.can().undo())} onmousedown={(e) => e.preventDefault()} onclick={() => chain().undo().run()}><Icon name="undo" /></button>
	<button class="tb" title="{t().doc.redo} (Ctrl+Y)" aria-label={t().doc.redo} disabled={dep(ver, !editor.can().redo())} onmousedown={(e) => e.preventDefault()} onclick={() => chain().redo().run()}><Icon name="redo" /></button>
	<span class="tb-sep"></span>
	<select class="select w-20 shrink-0" aria-label={t().doc.zoom} title={t().doc.zoom} bind:value={zoom} onchange={() => onzoom?.()}>
		{#each [...new Set([50, 75, 90, 100, 125, 150, 200, zoom])].sort((x, y) => x - y) as z (z)}<option value={z}>{z}%</option>{/each}
	</select>
	<span class="tb-sep"></span>
	<select class="select w-36 shrink-0" aria-label={t().doc.style} title={t().doc.style} value={style} onchange={(e) => setStyle((e.currentTarget as HTMLSelectElement).value)}>
		<option value="p">{t().doc.normal}</option>
		<option value="h1">{t().doc.h1}</option>
		<option value="h2">{t().doc.h2}</option>
		<option value="h3">{t().doc.h3}</option>
	</select>
	<select
		class="select w-36 shrink-0"
		aria-label={t().doc.font}
		title={t().doc.font}
		value={font}
		onchange={(e) => {
			const v = (e.currentTarget as HTMLSelectElement).value;
			if (v) chain().setFontFamily(v).run();
			else chain().unsetFontFamily().run();
		}}
	>
		<option value="">Arial</option>
		{#each FONTS as f (f)}<option value={f} style="font-family:{f}">{f}</option>{/each}
	</select>
	<select
		class="select w-16 shrink-0"
		aria-label={t().doc.size}
		title={t().doc.size}
		value={size}
		onchange={(e) => {
			const v = (e.currentTarget as HTMLSelectElement).value;
			if (v) chain().setFontSize(`${v}pt`).run();
			else chain().unsetFontSize().run();
		}}
	>
		<option value="">11</option>
		{#each SIZES as s (s)}<option value={String(s)}>{s}</option>{/each}
	</select>
	<span class="tb-sep"></span>
	{#each marks as b (b.icon)}{@render btn(b)}{/each}
	<Menu title={t().doc.color} triggerClass="tb gap-0">
		{#snippet icon()}<span class="flex flex-col items-center"><Icon name="color" size={16} /><span class="-mt-0.5 h-1 w-4 rounded-sm" style="background:{color}"></span></span>{/snippet}
		{#snippet children(close)}
			<ColorPicker {close} onpick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())} />
		{/snippet}
	</Menu>
	<Menu title={t().doc.highlight} triggerClass="tb gap-0">
		{#snippet icon()}<span class="flex flex-col items-center"><Icon name="highlight" size={16} /><span class="-mt-0.5 h-1 w-4 rounded-sm border border-line" style="background:{hl}"></span></span>{/snippet}
		{#snippet children(close)}
			<ColorPicker {close} onpick={(c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run())} />
		{/snippet}
	</Menu>
	<span class="tb-sep"></span>
	{#each aligns as b (b.icon)}{@render btn(b)}{/each}
	<span class="tb-sep"></span>
	{#each lists as b (b.icon)}{@render btn(b)}{/each}
	<span class="tb-sep"></span>
	{@render btn({ icon: 'link', label: t().doc.link, run: link, active: a('link') })}
	{@render btn({ icon: 'image', label: t().doc.image, run: pickImage })}
	<Menu title={t().doc.table} triggerClass="tb gap-0 {inTable ? 'text-accent' : ''}">
		{#snippet icon()}<Icon name="table" />{/snippet}
		{#snippet children(close)}
			<div class="px-3 pt-1 pb-2">
				<p class="mb-1 text-xs text-muted">{t().doc.insertTable} {gridHover.r ? `${gridHover.r}×${gridHover.c}` : ''}</p>
				<div class="grid grid-cols-8 gap-0.5" role="grid" tabindex="-1" onmouseleave={() => (gridHover = { r: 0, c: 0 })}>
					{#each Array(64) as _, i (i)}
						{@const r = Math.floor(i / 8) + 1}
						{@const c = (i % 8) + 1}
						<button
							class="size-4 rounded-[2px] border {r <= gridHover.r && c <= gridHover.c ? 'border-accent bg-accent-soft' : 'border-line'}"
							aria-label="{r}×{c}"
							onmouseenter={() => (gridHover = { r, c })}
							onfocus={() => (gridHover = { r, c })}
							onclick={() => {
								close();
								chain().insertTable({ rows: r, cols: c, withHeaderRow: false }).run();
							}}
						></button>
					{/each}
				</div>
			</div>
			{#if inTable}
				<div class="my-1 border-t border-line"></div>
				<button class="menu-item" onclick={() => (close(), chain().addRowBefore().run())}>{t().doc.addRowBefore}</button>
				<button class="menu-item" onclick={() => (close(), chain().addRowAfter().run())}>{t().doc.addRowAfter}</button>
				<button class="menu-item" onclick={() => (close(), chain().deleteRow().run())}>{t().doc.deleteRow}</button>
				<button class="menu-item" onclick={() => (close(), chain().addColumnBefore().run())}>{t().doc.addColBefore}</button>
				<button class="menu-item" onclick={() => (close(), chain().addColumnAfter().run())}>{t().doc.addColAfter}</button>
				<button class="menu-item" onclick={() => (close(), chain().deleteColumn().run())}>{t().doc.deleteCol}</button>
				<button class="menu-item" disabled={!editor.can().mergeCells()} onclick={() => (close(), chain().mergeCells().run())}>{t().doc.mergeCells}</button>
				<button class="menu-item" disabled={!editor.can().splitCell()} onclick={() => (close(), chain().splitCell().run())}>{t().doc.splitCell}</button>
				<button class="menu-item" onclick={() => (close(), chain().toggleHeaderRow().run())}>{t().doc.toggleHeader}</button>
				<button class="menu-item text-bad" onclick={() => (close(), chain().deleteTable().run())}>{t().doc.deleteTable}</button>
			{/if}
		{/snippet}
	</Menu>
	<Menu title={t().doc.insert} triggerClass="tb gap-0">
		{#snippet icon()}<Icon name="plus" />{/snippet}
		{#snippet children(close)}
			<button class="menu-item" onclick={() => (close(), chain().toggleBlockquote().run())}><Icon name="quote" size={16} />{t().doc.quote}</button>
			<button class="menu-item" onclick={() => (close(), chain().toggleCode().run())}><Icon name="code" size={16} />{t().doc.code}</button>
			<button class="menu-item" onclick={() => (close(), chain().toggleCodeBlock().run())}><Icon name="code" size={16} />{t().doc.codeBlock}</button>
			<button class="menu-item" onclick={() => (close(), chain().setHorizontalRule().run())}><Icon name="hr" size={16} />{t().doc.hr}</button>
		{/snippet}
	</Menu>
	{@render btn({ icon: 'clear', label: t().doc.clearFormat, run: () => chain().unsetAllMarks().clearNodes().run() })}
</div>
