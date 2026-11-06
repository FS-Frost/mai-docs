<script lang="ts">
	// Top bar of both editors: back to library, editable title, save status, menus (snippet).
	import type { Snippet } from 'svelte';
	import { withBase } from '../client/base.ts';
	import { t } from '../i18n/index.svelte.ts';
	import type { SaveStatus } from '../storage/autosave.svelte.ts';
	import Icon from './Icon.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	let {
		title,
		kind,
		status,
		readonly = false,
		onrename,
		menus,
		actions
	}: {
		title: string;
		kind: 'doc' | 'sheet' | 'slides';
		status: SaveStatus;
		readonly?: boolean;
		onrename: (t: string) => void;
		menus?: Snippet;
		actions?: Snippet;
	} = $props();

	let draft = $state('');
	let editing = $state(false);
	$effect(() => {
		if (!editing) draft = title;
	});

	function commit() {
		editing = false;
		const v = draft.trim();
		if (v && v !== title) onrename(v);
		else draft = title;
	}

	const label = $derived(
		readonly ? t().file.readOnly : status === 'saving' ? t().file.saving : status === 'dirty' ? t().file.unsaved : status === 'error' ? t().file.saveError : t().file.saved
	);
</script>

<header class="no-print border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
	<div class="flex h-12 items-center gap-2 px-2 sm:px-3">
		<a href={withBase('/')} class="tb" title={t().file.backToLibrary} aria-label={t().file.backToLibrary}><Icon name="back" /></a>
		<span class="grid size-8 shrink-0 place-items-center rounded-md {kind === 'doc' ? 'bg-doc/12 text-doc' : kind === 'sheet' ? 'bg-sheet/12 text-sheet' : 'bg-slides/12 text-slides'}">
			<Icon name={kind} size={18} />
		</span>
		<input
			class="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1.5 py-1 text-[0.95rem] font-medium outline-none hover:border-line focus:border-accent sm:max-w-md"
			bind:value={draft}
			aria-label={t().file.title}
			readonly={readonly}
			onfocus={() => (editing = true)}
			onblur={commit}
			onkeydown={(e) => {
				if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
				if (e.key === 'Escape') {
					draft = title;
					editing = false;
					(e.currentTarget as HTMLInputElement).blur();
				}
			}}
		/>
		<span class="hidden items-center gap-1 text-xs whitespace-nowrap sm:flex {status === 'error' ? 'text-bad' : readonly ? 'text-warn' : 'text-faint'}" aria-live="polite">
			{#if status === 'saved' && !readonly}<Icon name="check" size={14} />{/if}
			{label}
		</span>
		<div class="ml-auto flex items-center gap-0.5">
			{#if menus}{@render menus()}{/if}
			{#if actions}{@render actions()}{/if}
			<ThemeToggle />
		</div>
	</div>
</header>
