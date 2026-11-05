<script lang="ts">
	import type { SheetView } from '../../sheets/view.svelte.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import Icon from '../Icon.svelte';

	let { view, readonly = false }: { view: SheetView; readonly?: boolean } = $props();

	let nameDraft = $state('');
	let nameFocus = $state(false);
	let input = $state<HTMLTextAreaElement>();

	const shown = $derived.by(() => {
		void view.book.rev;
		return view.edit ? view.edit.text : view.cellText();
	});

	$effect(() => {
		if (!nameFocus) nameDraft = view.nameBox;
	});

	function onInput(e: Event) {
		const v = (e.currentTarget as HTMLTextAreaElement).value;
		if (!view.edit) view.startEdit(v, 'edit', 'bar');
		else {
			view.edit.text = v;
			view.edit.from = 'bar';
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.isComposing) return;
		if (e.key === 'Enter' && !e.altKey) {
			e.preventDefault();
			if (e.ctrlKey || e.metaKey) view.commitAll();
			else {
				view.commit();
				view.enter(e.shiftKey);
			}
			view.focusTick++;
		} else if (e.key === 'Enter' && e.altKey) {
			e.preventDefault();
			const el = e.currentTarget as HTMLTextAreaElement;
			const pos = el.selectionStart;
			const v = el.value.slice(0, pos) + '\n' + el.value.slice(el.selectionEnd);
			el.value = v;
			el.setSelectionRange(pos + 1, pos + 1);
			onInput(e);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			view.cancel();
			view.focusTick++;
		} else if (e.key === 'Tab') {
			e.preventDefault();
			view.commit();
			view.tab(e.shiftKey);
			view.focusTick++;
		}
	}
</script>

<div class="no-print flex items-stretch gap-1 border-b border-line bg-surface px-2 py-1">
	<input
		class="input w-24 shrink-0 !py-0.5 text-center font-mono text-xs sm:w-28"
		aria-label={t().sheet.nameBox}
		title={t().sheet.nameBox}
		bind:value={nameDraft}
		onfocus={(e) => {
			nameFocus = true;
			(e.currentTarget as HTMLInputElement).select();
		}}
		onblur={() => (nameFocus = false)}
		onkeydown={(e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				if (!view.goTo(nameDraft)) nameDraft = view.nameBox;
				(e.currentTarget as HTMLInputElement).blur();
			}
			if (e.key === 'Escape') {
				nameDraft = view.nameBox;
				view.focusTick++;
			}
		}}
	/>
	<span class="grid w-7 shrink-0 place-items-center text-faint" aria-hidden="true"><Icon name="fx" size={16} /></span>
	<textarea
		bind:this={input}
		class="input min-h-7 flex-1 resize-none !py-0.5 font-mono text-[13px] leading-5"
		rows="1"
		value={shown}
		aria-label={t().sheet.formulaBar}
		spellcheck="false"
		readonly={readonly}
		oninput={onInput}
		onkeydown={onKey}
		onfocus={() => {
			if (view.edit) view.edit.from = 'bar';
		}}
	></textarea>
</div>
