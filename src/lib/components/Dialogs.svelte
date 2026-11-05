<script lang="ts">
	import { closeDialog, dialog } from '../client/dialogs.svelte.ts';
	import { t } from '../i18n/index.svelte.ts';

	let value = $state('');
	let error = $state<string | null>(null);
	let input = $state<HTMLInputElement>();
	let okBtn = $state<HTMLButtonElement>();

	$effect(() => {
		const d = dialog.current;
		if (!d) return;
		error = null;
		if (d.kind === 'prompt') {
			value = d.value;
			queueMicrotask(() => {
				input?.focus();
				input?.select();
			});
		} else queueMicrotask(() => okBtn?.focus());
	});

	function submit(e: Event) {
		e.preventDefault();
		const d = dialog.current;
		if (!d) return;
		if (d.kind === 'prompt') {
			const err = d.validate?.(value) ?? null;
			if (err) {
				error = err;
				return;
			}
			closeDialog(value);
		} else closeDialog(true);
	}
</script>

<svelte:window onkeydown={(e) => dialog.current && e.key === 'Escape' && (e.preventDefault(), closeDialog(null))} />

{#if dialog.current}
	{@const d = dialog.current}
	<div class="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4" role="presentation" onmousedown={(e) => e.target === e.currentTarget && closeDialog(null)}>
		<div class="w-full max-w-sm" role="dialog" aria-modal="true" aria-labelledby="dlg-msg">
		<form class="rounded-xl border border-line bg-surface p-5 shadow-2xl" onsubmit={submit}>
			<p id="dlg-msg" class="mb-4 text-sm leading-relaxed whitespace-pre-line text-fg">{d.message}</p>
			{#if d.kind === 'prompt'}
				<input bind:this={input} bind:value class="input mb-1 w-full" aria-invalid={!!error} />
				{#if error}<p class="mb-2 text-xs text-bad">{error}</p>{/if}
			{/if}
			<div class="mt-4 flex justify-end gap-2">
				<button type="button" class="btn" onclick={() => closeDialog(null)}>{t().common.cancel}</button>
				<button bind:this={okBtn} type="submit" class="btn {d.kind === 'confirm' && d.danger ? 'btn-danger' : 'btn-primary'}">{d.confirm || t().common.ok}</button>
			</div>
		</form>
		</div>
	</div>
{/if}
