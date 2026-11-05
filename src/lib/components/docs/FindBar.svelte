<script lang="ts">
	import type { Editor } from '@tiptap/core';
	import { onDestroy } from 'svelte';
	import { clearSearch, replaceAll, replaceCurrent, searchState, setSearch, stepSearch } from '../../docs/extensions/search.ts';
	import { t } from '../../i18n/index.svelte.ts';
	import { toast } from '../../client/toast.svelte.ts';
	import Icon from '../Icon.svelte';

	let { editor, ver, replace = $bindable(false), onclose, readonly = false }: { editor: Editor; ver: number; replace?: boolean; onclose: () => void; readonly?: boolean } = $props();

	let query = $state('');
	let replacement = $state('');
	let caseSensitive = $state(false);
	let wholeWord = $state(false);
	let input = $state<HTMLInputElement>();

	export function focus() {
		input?.focus();
		input?.select();
	}

	$effect(() => {
		// Prefill with the selected text.
		const { from, to } = editor.state.selection;
		if (to > from && to - from < 200) query = editor.state.doc.textBetween(from, to);
		queueMicrotask(focus);
	});

	$effect(() => {
		setSearch(editor, query, { caseSensitive, wholeWord });
	});

	const dep = <T,>(_v: number, x: T) => x;
	const st = $derived(dep(ver, searchState(editor.state)));

	onDestroy(() => clearSearch(editor));

	function key(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			stepSearch(editor, e.shiftKey ? -1 : 1);
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}
</script>

<div class="no-print absolute top-2 right-3 z-20 w-[min(26rem,calc(100vw-1.5rem))] rounded-lg border border-line bg-surface p-2 shadow-xl" role="search">
	<div class="flex items-center gap-1">
		<input bind:this={input} class="input min-w-0 flex-1 !py-1" placeholder={t().doc.find} aria-label={t().doc.find} bind:value={query} onkeydown={key} />
		<span class="w-16 text-center text-xs whitespace-nowrap text-muted">
			{#if query}{st.matches.length ? t().doc.matchesOf(st.index + 1, st.matches.length) : t().doc.noMatches}{/if}
		</span>
		<button class="tb" title={t().doc.previous} aria-label={t().doc.previous} disabled={!st.matches.length} onclick={() => stepSearch(editor, -1)}><Icon name="chevronUp" size={16} /></button>
		<button class="tb" title={t().doc.next} aria-label={t().doc.next} disabled={!st.matches.length} onclick={() => stepSearch(editor, 1)}><Icon name="chevronDown" size={16} /></button>
		{#if !readonly}
			<button class="tb" title={t().doc.findReplace} aria-label={t().doc.findReplace} aria-pressed={replace} onclick={() => (replace = !replace)}><Icon name="rename" size={16} /></button>
		{/if}
		<button class="tb" title={t().common.close} aria-label={t().common.close} onclick={onclose}><Icon name="x" size={16} /></button>
	</div>
	<div class="mt-1.5 flex gap-3 px-1 text-xs text-muted">
		<label class="flex items-center gap-1"><input type="checkbox" bind:checked={caseSensitive} />{t().doc.matchCase}</label>
		<label class="flex items-center gap-1"><input type="checkbox" bind:checked={wholeWord} />{t().doc.wholeWord}</label>
	</div>
	{#if replace && !readonly}
		<div class="mt-1.5 flex items-center gap-1">
			<input class="input min-w-0 flex-1 !py-1" placeholder={t().doc.replaceWith} aria-label={t().doc.replaceWith} bind:value={replacement} onkeydown={(e) => e.key === 'Escape' && onclose()} />
			<button class="btn !px-2 !py-1 text-xs" disabled={!st.matches.length} onclick={() => replaceCurrent(editor, replacement)}>{t().doc.replace}</button>
			<button
				class="btn !px-2 !py-1 text-xs"
				disabled={!st.matches.length}
				onclick={() => {
					const n = replaceAll(editor, replacement);
					toast.success(t().doc.replaced(n));
				}}>{t().doc.replaceAll}</button
			>
		</div>
	{/if}
</div>
