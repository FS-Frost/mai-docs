// In-app confirm/prompt dialogs (native ones are blocked in some installed PWAs and can't be styled).
// Rendered by components/Dialogs.svelte, mounted once in the root layout.

export type DialogReq =
	| { kind: 'confirm'; message: string; confirm: string; danger: boolean; resolve: (ok: boolean) => void }
	| { kind: 'prompt'; message: string; value: string; confirm: string; resolve: (v: string | null) => void; validate?: (v: string) => string | null };

export const dialog = $state<{ current: DialogReq | null }>({ current: null });

export function confirmDialog(message: string, opts: { confirm?: string; danger?: boolean } = {}): Promise<boolean> {
	return new Promise((resolve) => {
		dialog.current = { kind: 'confirm', message, confirm: opts.confirm ?? '', danger: !!opts.danger, resolve };
	});
}

export function promptDialog(message: string, value = '', opts: { confirm?: string; validate?: (v: string) => string | null } = {}): Promise<string | null> {
	return new Promise((resolve) => {
		dialog.current = { kind: 'prompt', message, value, confirm: opts.confirm ?? '', resolve, validate: opts.validate };
	});
}

export function closeDialog(result: boolean | string | null) {
	const d = dialog.current;
	dialog.current = null;
	if (!d) return;
	if (d.kind === 'confirm') d.resolve(result === true);
	else d.resolve(typeof result === 'string' ? result : null);
}
