<script lang="ts">
	// Toolbar: slides, insert, then context groups (text while editing, shape/box when selected), arrange, theme.
	import type { Deck } from '../../slides/deck.svelte.ts';
	import { GEOMS, geomPath } from '../../slides/geometry.ts';
	import { LAYOUTS, resolveColor, uid, type ShapeEl, type TextBase, type Line, type Geom, type TableEl, type IconEl, type MediaEl, type Fill } from '../../slides/model.ts';
	import { deleteCol, deleteRow, insertCol, insertRow, merge, newTable, setCells, split, type CellRange } from '../../slides/table.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import { dep } from '../../client/dep.ts';
	import Icon, { type IconName } from '../Icon.svelte';
	import Menu from '../Menu.svelte';
	import ThemeColorPicker from './ThemeColorPicker.svelte';

	let {
		deck,
		onimage,
		ontheme,
		oninsert,
		onmotion,
		motionOpen = false
	}: { deck: Deck; onimage: () => void; ontheme: () => void; oninsert: (what: 'chartSheet' | 'chartNew' | 'media' | 'icon') => void; onmotion: () => void; motionOpen?: boolean } = $props();

	const FONTS = ['major', 'minor', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Segoe UI', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Courier New'];
	const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 54, 60, 72, 96];
	const theme = $derived(deck.content.theme);
	const ed = $derived(deck.textEditor);
	const a = (name: string, attrs?: Record<string, unknown>) => dep(deck.textVer, !!ed?.isActive(name, attrs));
	const chain = () => ed!.chain().focus();
	const shapes = $derived(deck.selected.filter((e): e is ShapeEl => e.kind === 'shape'));
	const shape = $derived(shapes[0]);
	const sel = $derived(deck.selection.length);
	const ts = $derived(dep(deck.textVer, ed?.getAttributes('textStyle') ?? {}));
	const fontName = (f: string) => (f === 'major' ? `${theme.fonts.major} (${t().slides.headingFont})` : f === 'minor' ? `${theme.fonts.minor} (${t().slides.bodyFont})` : f);

	function center(w: number, h: number) {
		return { x: Math.round((deck.content.size.w - w) / 2), y: Math.round((deck.content.size.h - h) / 2) };
	}

	function addShape(geom: Geom) {
		const w = geom === 'line' ? 300 : 240;
		const h = geom === 'line' ? 0 : 160;
		const el: ShapeEl = {
			id: uid(),
			kind: 'shape',
			geom,
			...center(w, h),
			w,
			h,
			rot: 0,
			fill: geom === 'line' ? { type: 'none' } : { type: 'solid', color: 'accent1' },
			line: geom === 'line' ? { color: 'dk1', width: 3 } : null,
			inset: 8,
			anchor: 'middle',
			textStyle: { font: 'minor', size: 20, color: 'lt1', align: 'center' }
		};
		deck.add(el);
	}

	function addTextBox() {
		const el: ShapeEl = { id: uid(), kind: 'shape', geom: 'rect', ...center(480, 64), w: 480, h: 64, rot: 0, fill: { type: 'none' }, line: null, textbox: true, inset: 8, anchor: 'top', textStyle: { font: 'minor', size: 20, color: 'dk1' } };
		deck.add(el);
		deck.startEditing(el.id);
	}

	const base = (p: Partial<TextBase>) => deck.updateElements(shapes.map((s) => s.id), (e) => (e.kind === 'shape' ? { ...e, textStyle: { ...e.textStyle, ...p } } : e));

	function setFont(f: string) {
		if (ed) {
			if (f === 'major' || f === 'minor') chain().unsetFontFamily().run();
			else chain().setFontFamily(f).run();
			if (f === 'major' || f === 'minor') base({ font: f });
		} else base({ font: f });
	}
	function setSize(n: number) {
		if (ed) chain().setFontSize(`${n}pt`).run();
		else base({ size: n });
	}
	function setColor(c: string | null) {
		if (ed) {
			if (c) chain().setColor(resolveColor(theme, c)).run();
			else chain().unsetColor().run();
		} else if (c) base({ color: c });
	}
	function setAlign(al: 'left' | 'center' | 'right' | 'justify') {
		if (ed) chain().setTextAlign(al).run();
		else base({ align: al === 'justify' ? 'left' : al });
	}

	type Btn = { icon: IconName; label: string; run: () => void; active?: boolean; disabled?: boolean };
	const textBtns = $derived<Btn[]>([
		{ icon: 'bold', label: t().doc.bold, run: () => (ed ? chain().toggleBold().run() : base({ bold: !shape?.textStyle.bold })), active: ed ? a('bold') : !!shape?.textStyle.bold },
		{ icon: 'italic', label: t().doc.italic, run: () => ed && chain().toggleItalic().run(), active: a('italic'), disabled: !ed },
		{ icon: 'underline', label: t().doc.underline, run: () => ed && chain().toggleUnderline().run(), active: a('underline'), disabled: !ed },
		{ icon: 'strike', label: t().doc.strike, run: () => ed && chain().toggleStrike().run(), active: a('strike'), disabled: !ed }
	]);
	const alignBtns = $derived<Btn[]>(
		(['left', 'center', 'right', 'justify'] as const).map((al) => ({
			icon: (al === 'left' ? 'alignLeft' : al === 'center' ? 'alignCenter' : al === 'right' ? 'alignRight' : 'justify') as IconName,
			label: t().doc[al === 'left' ? 'alignLeft' : al === 'center' ? 'alignCenter' : al === 'right' ? 'alignRight' : 'justify'],
			run: () => setAlign(al),
			active: ed ? a('paragraph', { textAlign: al }) : (shape?.textStyle.align ?? 'left') === al
		}))
	);
	const WIDTHS = [0, 1, 2, 3, 4, 6, 8];

	// ---------- Tables / icons / media ----------
	const table = $derived(deck.selection.length === 1 && deck.selected[0]?.kind === 'table' ? (deck.selected[0] as TableEl) : null);
	const iconEl = $derived(deck.selected.find((e): e is IconEl => e.kind === 'icon'));
	const media = $derived(deck.selection.length === 1 && deck.selected[0]?.kind === 'media' ? (deck.selected[0] as MediaEl) : null);
	const cells = $derived<CellRange>(deck.cellSel ?? { r1: 0, c1: 0, r2: (table?.rows.length ?? 1) - 1, c2: (table?.cols.length ?? 1) - 1 });
	let hover = $state({ r: 0, c: 0 });

	function addTable(r: number, c: number) {
		const w = Math.min(deck.content.size.w * 0.8, c * 160);
		const tb = newTable(r, c, 0, 0, w);
		const pos = center(tb.w, tb.h);
		deck.add({ ...tb, ...pos });
	}
	const tbl = (fn: (t: TableEl) => TableEl) => {
		if (!table) return;
		deck.stopEditing();
		deck.updateTable(table.id, fn);
		deck.cellSel = null;
	};
	const cellFill = (c: string | null) => table && deck.updateTable(table.id, (tb) => setCells(tb, cells, { fill: c ? ({ type: 'solid', color: c } as Fill) : undefined }));
</script>

{#snippet btn(b: Btn)}
	<button class="tb" title={b.label} aria-label={b.label} aria-pressed={b.active ?? undefined} disabled={b.disabled} onmousedown={(e) => e.preventDefault()} onclick={b.run}><Icon name={b.icon} /></button>
{/snippet}

<div class="no-print flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 py-1 [scrollbar-width:thin] md:flex-wrap md:overflow-visible" role="toolbar" aria-label={t().doc.format}>
	<button class="tb" title={t().doc.undo} aria-label={t().doc.undo} disabled={!deck.canUndo} onclick={() => deck.undo()}><Icon name="undo" /></button>
	<button class="tb" title={t().doc.redo} aria-label={t().doc.redo} disabled={!deck.canRedo} onclick={() => deck.redo()}><Icon name="redo" /></button>
	<span class="tb-sep"></span>
	<Menu title={t().slides.newSlide} triggerClass="tb gap-0">
		{#snippet icon()}<Icon name="plus" />{/snippet}
		{#snippet children(close)}
			{#each LAYOUTS as k (k)}<button class="menu-item" onclick={() => (close(), deck.addSlide(k))}>{t().slides.layouts[k]}</button>{/each}
		{/snippet}
	</Menu>
	<Menu title={t().slides.layout} triggerClass="tb gap-0">
		{#snippet icon()}<Icon name="layout" />{/snippet}
		{#snippet children(close)}
			{#each LAYOUTS as k (k)}<button class="menu-item" aria-pressed={deck.slide.layout === k} onclick={() => (close(), deck.setLayout(k))}>{t().slides.layouts[k]}</button>{/each}
		{/snippet}
	</Menu>
	<span class="tb-sep"></span>
	{@render btn({ icon: 'textbox', label: t().slides.textbox, run: addTextBox })}
	<Menu title={t().slides.shape} triggerClass="tb gap-0">
		{#snippet icon()}<Icon name="shapes" />{/snippet}
		{#snippet children(close)}
			<div class="grid grid-cols-5 gap-1 p-2">
				{#each GEOMS as g (g)}
					<button class="grid size-9 place-items-center rounded hover:bg-surface-2" title={t().slides.shapes[g]} aria-label={t().slides.shapes[g]} onclick={() => (close(), addShape(g))}>
						<svg width="24" height="18" viewBox="-1 -1 26 20" aria-hidden="true"><path d={geomPath(g, 24, 18)} fill={g === 'line' ? 'none' : 'currentColor'} fill-opacity="0.25" stroke="currentColor" stroke-width="1.4" /></svg>
					</button>
				{/each}
			</div>
		{/snippet}
	</Menu>
	{@render btn({ icon: 'image', label: t().slides.image, run: onimage })}
	<Menu title={t().slides.table} triggerClass="tb gap-0">
		{#snippet icon()}<Icon name="table" />{/snippet}
		{#snippet children(close)}
			<div class="p-2" role="grid" aria-label={t().slides.table}>
				<div class="grid grid-cols-8 gap-0.5" onmouseleave={() => (hover = { r: 0, c: 0 })} role="presentation">
					{#each Array.from({ length: 48 }, (_, i) => i) as i (i)}
						{@const r = Math.floor(i / 8) + 1}
						{@const c = (i % 8) + 1}
						<button
							class="size-5 rounded-sm border {r <= hover.r && c <= hover.c ? 'border-accent bg-accent/25' : 'border-line'}"
							aria-label={t().slides.tableSize(r, c)}
							onmouseenter={() => (hover = { r, c })}
							onfocus={() => (hover = { r, c })}
							onclick={() => (close(), addTable(r, c))}
						></button>
					{/each}
				</div>
				<p class="mt-1.5 text-center text-xs text-muted">{hover.r ? t().slides.tableSize(hover.r, hover.c) : t().slides.table}</p>
			</div>
		{/snippet}
	</Menu>
	<Menu title={t().chart.chart} triggerClass="tb gap-0">
		{#snippet icon()}<Icon name="chart" />{/snippet}
		{#snippet children(close)}
			<button class="menu-item" onclick={() => (close(), oninsert('chartSheet'))}>{t().chart.fromSheet}</button>
			<button class="menu-item" onclick={() => (close(), oninsert('chartNew'))}>{t().chart.newData}</button>
		{/snippet}
	</Menu>
	{@render btn({ icon: 'video', label: t().slides.media, run: () => oninsert('media') })}
	{@render btn({ icon: 'sparkle', label: t().slides.icon, run: () => oninsert('icon') })}

	{#if ed || shapes.length}
		<span class="tb-sep"></span>
		<select class="select w-40 shrink-0" aria-label={t().doc.font} title={t().doc.font} value={ed && ts.fontFamily ? String(ts.fontFamily) : (shape?.textStyle.font ?? 'minor')} onchange={(e) => setFont((e.currentTarget as HTMLSelectElement).value)}>
			{#each FONTS as f (f)}<option value={f}>{fontName(f)}</option>{/each}
		</select>
		<select class="select w-16 shrink-0" aria-label={t().doc.size} title={t().doc.size} value={String(ed && ts.fontSize ? parseInt(String(ts.fontSize)) : (shape?.textStyle.size ?? 20))} onchange={(e) => setSize(Number((e.currentTarget as HTMLSelectElement).value))}>
			{#each [...new Set([...SIZES, shape?.textStyle.size ?? 20])].sort((x, y) => x - y) as s (s)}<option value={String(s)}>{s}</option>{/each}
		</select>
		{#each textBtns as b (b.icon)}{@render btn(b)}{/each}
		<Menu title={t().doc.color} triggerClass="tb gap-0">
			{#snippet icon()}<span class="flex flex-col items-center"><Icon name="color" size={16} /><span class="-mt-0.5 h-1 w-4 rounded-sm" style="background:{ed && ts.color ? String(ts.color) : resolveColor(theme, shape?.textStyle.color)}"></span></span>{/snippet}
			{#snippet children(close)}<ThemeColorPicker {theme} {close} onpick={setColor} />{/snippet}
		</Menu>
		{#each alignBtns as b (b.icon)}{@render btn(b)}{/each}
		{#if ed}
			{@render btn({ icon: 'listBullet', label: t().doc.bulletList, run: () => chain().toggleBulletList().run(), active: a('bulletList') })}
			{@render btn({ icon: 'listOrdered', label: t().doc.orderedList, run: () => chain().toggleOrderedList().run(), active: a('orderedList') })}
			{@render btn({ icon: 'outdent', label: t().doc.outdent, run: () => chain().liftListItem('listItem').run() })}
			{@render btn({ icon: 'indent', label: t().doc.indent, run: () => chain().sinkListItem('listItem').run() })}
		{/if}
		{#if shape}
			{@render btn({ icon: 'vTop', label: t().slides.anchorTop, run: () => deck.patch(shapes.map((s) => s.id), { anchor: 'top' }), active: shape.anchor === 'top' })}
			{@render btn({ icon: 'vMiddle', label: t().slides.anchorMiddle, run: () => deck.patch(shapes.map((s) => s.id), { anchor: 'middle' }), active: shape.anchor === 'middle' })}
			{@render btn({ icon: 'vBottom', label: t().slides.anchorBottom, run: () => deck.patch(shapes.map((s) => s.id), { anchor: 'bottom' }), active: shape.anchor === 'bottom' })}
		{/if}
	{/if}

	{#if shapes.length && !ed}
		<span class="tb-sep"></span>
		<Menu title={t().slides.fill} triggerClass="tb gap-0">
			{#snippet icon()}<span class="flex flex-col items-center"><Icon name="fill" size={16} /><span class="-mt-0.5 h-1 w-4 rounded-sm border border-line" style="background:{shape?.fill.type === 'solid' ? resolveColor(theme, shape.fill.color) : 'transparent'}"></span></span>{/snippet}
			{#snippet children(close)}<ThemeColorPicker {theme} {close} onpick={(c) => deck.patch(shapes.map((s) => s.id), { fill: c ? { type: 'solid', color: c } : { type: 'none' } } as Partial<ShapeEl>)} />{/snippet}
		</Menu>
		<Menu title={t().slides.line} triggerClass="tb gap-0">
			{#snippet icon()}<span class="flex flex-col items-center"><Icon name="border" size={16} /><span class="-mt-0.5 h-1 w-4 rounded-sm" style="background:{shape?.line ? resolveColor(theme, shape.line.color) : 'transparent'}"></span></span>{/snippet}
			{#snippet children(close)}
				<ThemeColorPicker {theme} {close} onpick={(c) => deck.patch(shapes.map((s) => s.id), { line: c ? { color: c, width: shape?.line?.width || 2 } : null } as Partial<ShapeEl>)} />
			{/snippet}
		</Menu>
		<Menu title={t().slides.lineWidth} triggerClass="tb gap-0 text-xs">
			{#snippet icon()}<span class="w-6 text-center">{shape?.line?.width ?? 0}px</span>{/snippet}
			{#snippet children(close)}
				{#each WIDTHS as w (w)}
					<button
						class="menu-item"
						onclick={() => {
							close();
							const ids = shapes.map((s) => s.id);
							deck.updateElements(ids, (e) => (e.kind === 'shape' ? { ...e, line: w ? ({ color: e.line?.color ?? 'dk1', width: w, dash: e.line?.dash } as Line) : null } : e));
						}}>{w ? `${w} px` : t().slides.noLine}</button
					>
				{/each}
				<div class="my-1 border-t border-line"></div>
				{#each ['solid', 'dash', 'dot'] as d (d)}
					<button class="menu-item" onclick={() => (close(), deck.updateElements(shapes.map((s) => s.id), (e) => (e.kind === 'shape' && e.line ? { ...e, line: { ...e.line, dash: d as 'solid' } } : e)))}>{d === 'solid' ? '———' : d === 'dash' ? '– – –' : '·······'}</button>
				{/each}
			{/snippet}
		</Menu>
	{/if}

	{#if table && !ed}
		<span class="tb-sep"></span>
		<Menu title={t().slides.table} triggerClass="tb gap-0">
			{#snippet icon()}<Icon name="rowAdd" />{/snippet}
			{#snippet children(close)}
				<button class="menu-item" onclick={() => (close(), tbl((tb) => insertRow(tb, cells.r1)))}>{t().slides.insertRowAbove}</button>
				<button class="menu-item" onclick={() => (close(), tbl((tb) => insertRow(tb, cells.r2 + 1)))}>{t().slides.insertRowBelow}</button>
				<button class="menu-item" onclick={() => (close(), tbl((tb) => insertCol(tb, cells.c1)))}>{t().slides.insertColLeft}</button>
				<button class="menu-item" onclick={() => (close(), tbl((tb) => insertCol(tb, cells.c2 + 1)))}>{t().slides.insertColRight}</button>
				<div class="my-1 border-t border-line"></div>
				<button class="menu-item" disabled={table.rows.length <= 1} onclick={() => (close(), tbl((tb) => deleteRow(tb, cells.r1)))}>{t().slides.deleteRow}</button>
				<button class="menu-item" disabled={table.cols.length <= 1} onclick={() => (close(), tbl((tb) => deleteCol(tb, cells.c1)))}>{t().slides.deleteCol}</button>
				<div class="my-1 border-t border-line"></div>
				<button class="menu-item" disabled={!deck.cellSel || (cells.r1 === cells.r2 && cells.c1 === cells.c2)} onclick={() => (close(), tbl((tb) => merge(tb, cells)))}>{t().slides.mergeCells}</button>
				<button class="menu-item" disabled={!deck.cellSel} onclick={() => (close(), tbl((tb) => split(tb, cells.r1, cells.c1)))}>{t().slides.splitCell}</button>
				<div class="my-1 border-t border-line"></div>
				<button class="menu-item" aria-pressed={!!table.firstRow} onclick={() => (close(), deck.patch([table.id], { firstRow: !table.firstRow } as Partial<TableEl>))}>{t().slides.headerRow}</button>
				<button class="menu-item" aria-pressed={!!table.bandRow} onclick={() => (close(), deck.patch([table.id], { bandRow: !table.bandRow } as Partial<TableEl>))}>{t().slides.bandedRows}</button>
			{/snippet}
		</Menu>
		<Menu title={t().slides.cellFill} triggerClass="tb gap-0">
			{#snippet icon()}<Icon name="fill" />{/snippet}
			{#snippet children(close)}<ThemeColorPicker {theme} {close} onpick={cellFill} />{/snippet}
		</Menu>
		<Menu title={t().slides.tableBorder} triggerClass="tb gap-0">
			{#snippet icon()}<span class="flex flex-col items-center"><Icon name="border" size={16} /><span class="-mt-0.5 h-1 w-4 rounded-sm" style="background:{table.border ? resolveColor(theme, table.border.color) : 'transparent'}"></span></span>{/snippet}
			{#snippet children(close)}
				<ThemeColorPicker {theme} {close} onpick={(c) => deck.patch([table.id], { border: c ? { color: c, width: table.border?.width || 1 } : null } as Partial<TableEl>)} />
				<div class="my-1 border-t border-line"></div>
				<div class="flex gap-1 px-2 pb-1">
					{#each [1, 2, 3] as w (w)}<button class="btn !px-2 !py-0.5 text-xs" onclick={() => (close(), deck.patch([table.id], { border: { color: table.border?.color ?? 'dk2', width: w } } as Partial<TableEl>))}>{w} px</button>{/each}
				</div>
			{/snippet}
		</Menu>
	{/if}

	{#if iconEl && !ed}
		<span class="tb-sep"></span>
		<Menu title={t().slides.iconColor} triggerClass="tb gap-0">
			{#snippet icon()}<span class="flex flex-col items-center"><Icon name="color" size={16} /><span class="-mt-0.5 h-1 w-4 rounded-sm" style="background:{resolveColor(theme, iconEl!.color)}"></span></span>{/snippet}
			{#snippet children(close)}<ThemeColorPicker {theme} {close} allowNone={false} onpick={(c) => c && deck.updateElements(deck.selection, (e) => (e.kind === 'icon' ? { ...e, color: c } : e))} />{/snippet}
		</Menu>
		<select class="select w-16 shrink-0" aria-label={t().slides.iconStroke} title={t().slides.iconStroke} value={String(iconEl.stroke)} onchange={(e) => deck.updateElements(deck.selection, (x) => (x.kind === 'icon' ? { ...x, stroke: Number((e.currentTarget as HTMLSelectElement).value) } : x))}>
			{#each [1, 1.5, 2, 2.5, 3] as s (s)}<option value={String(s)}>{s}</option>{/each}
		</select>
	{/if}

	{#if media}
		<span class="tb-sep"></span>
		<label class="flex items-center gap-1 px-1 text-sm"><input type="checkbox" checked={!!media.autoplay} onchange={(e) => deck.patch([media.id], { autoplay: (e.currentTarget as HTMLInputElement).checked } as Partial<MediaEl>)} />{t().slides.autoplay}</label>
		<label class="flex items-center gap-1 px-1 text-sm"><input type="checkbox" checked={!!media.loop} onchange={(e) => deck.patch([media.id], { loop: (e.currentTarget as HTMLInputElement).checked } as Partial<MediaEl>)} />{t().slides.loop}</label>
	{/if}

	{#if sel}
		<span class="tb-sep"></span>
		<Menu title={t().slides.arrange} triggerClass="tb gap-0">
			{#snippet icon()}<Icon name="arrange" />{/snippet}
			{#snippet children(close)}
				<button class="menu-item" onclick={() => (close(), deck.arrange('front'))}>{t().slides.front}</button>
				<button class="menu-item" onclick={() => (close(), deck.arrange('forward'))}>{t().slides.forward}</button>
				<button class="menu-item" onclick={() => (close(), deck.arrange('backward'))}>{t().slides.backward}</button>
				<button class="menu-item" onclick={() => (close(), deck.arrange('back'))}>{t().slides.back}</button>
				<div class="my-1 border-t border-line"></div>
				{#each [['left', t().slides.alignLeft], ['center', t().slides.alignCenter], ['right', t().slides.alignRight], ['top', t().slides.alignTop], ['middle', t().slides.alignMiddle], ['bottom', t().slides.alignBottom]] as [k, label] (k)}
					<button class="menu-item" onclick={() => (close(), deck.align(k as 'left'))}>{label}</button>
				{/each}
				<button class="menu-item" disabled={sel < 3} onclick={() => (close(), deck.distribute('h'))}>{t().slides.distributeH}</button>
				<button class="menu-item" disabled={sel < 3} onclick={() => (close(), deck.distribute('v'))}>{t().slides.distributeV}</button>
				<div class="my-1 border-t border-line"></div>
				<button class="menu-item" onclick={() => (close(), deck.updateElements(deck.selection, (e) => ({ ...e, flipH: !e.flipH })))}>{t().slides.flipH}</button>
				<button class="menu-item" onclick={() => (close(), deck.updateElements(deck.selection, (e) => ({ ...e, flipV: !e.flipV })))}>{t().slides.flipV}</button>
				<div class="my-1 border-t border-line"></div>
				<button class="menu-item" onclick={() => (close(), deck.duplicateSelected())}>{t().common.duplicate}<span class="ml-auto text-xs text-faint">Ctrl+D</span></button>
				<button class="menu-item text-bad" onclick={() => (close(), deck.removeSelected())}>{t().common.delete}<span class="ml-auto text-xs text-faint">Supr</span></button>
			{/snippet}
		</Menu>
	{/if}

	<span class="tb-sep"></span>
	<button class="tb gap-1 px-2 text-sm" onclick={ontheme}><Icon name="palette" size={16} />{t().slides.theme}</button>
	<button class="tb gap-1 px-2 text-sm" aria-pressed={motionOpen} onclick={onmotion}><Icon name="animation" size={16} />{t().slides.motion}</button>
	<Menu title={t().slides.background} triggerClass="tb gap-0">
		{#snippet icon()}<Icon name="fill" />{/snippet}
		{#snippet children(close)}
			<button class="menu-item" onclick={() => (close(), deck.updateSlide((s) => ({ ...s, background: undefined })))}>{t().slides.resetBackground}</button>
			<ThemeColorPicker {theme} {close} allowNone={false} onpick={(c) => c && deck.updateSlide((s) => ({ ...s, background: { type: 'solid', color: c } }))} />
		{/snippet}
	</Menu>
</div>
