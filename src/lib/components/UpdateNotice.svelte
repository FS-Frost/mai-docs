<script lang="ts">
	// New app version (short sha), announced with toasts:
	// - back on the tab with a published version → updates by itself (reload);
	// - detected while visible → toast with "Update" (never reloads in the middle of editing);
	// - after updating, "Mai Docs updated (sha)"; if the reload did not bring it, error with "Force".
	import { onMount } from 'svelte';
	import { updated } from '$app/state';
	import { version } from '$app/env';
	import { applyUpdate, failedUpdate, forceReload } from '../client/pwa.ts';
	import { noteVersion } from '../client/version.ts';
	import { toast } from '../client/toast.svelte.ts';
	import { ago, t } from '../i18n/index.svelte.ts';

	const builtAt = import.meta.env.VITE_BUILT_AT as string | undefined;

	function offer() {
		toast.info(t().update.available, { duration: null, key: 'version', actions: [{ label: t().update.action, run: update, keep: true }] });
	}

	async function update() {
		toast.info(t().update.updating, { duration: null, key: 'version', persistent: true, detail: t().update.updatingDetail });
		const r = await applyUpdate();
		if (r === 'publishing')
			toast.warn(t().update.publishing, {
				detail: t().update.publishingDetail,
				duration: null,
				key: 'version',
				actions: [{ label: t().common.retry, run: update, keep: true }]
			});
		else if (r === 'offline') toast.warn(t().update.offline, { key: 'version', actions: [{ label: t().common.retry, run: update, keep: true }] });
	}

	onMount(() => {
		const missed = version === 'dev' ? null : failedUpdate(version);
		if (missed) toast.error(t().update.failed(missed), { detail: t().update.failedDetail, key: 'version', actions: [{ label: t().update.force, run: forceReload, keep: true }] });
		else if (noteVersion(version) !== null)
			toast.success(t().update.done(version), { detail: builtAt ? t().update.publishedAgo(ago(Date.parse(builtAt))) : undefined, duration: 8000, key: 'version' });
		const onVisible = async () => {
			if (document.visibilityState !== 'visible' || version === 'dev') return;
			try {
				if (updated.current || (await updated.check())) {
					// Never reload under an open editor: offer instead (autosave runs on hide, but be safe).
					if (location.pathname.includes('/docs/') || location.pathname.includes('/sheets/')) offer();
					else await applyUpdate();
				}
			} catch {
				/* offline */
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	$effect(() => {
		if (updated.current) offer();
	});
</script>
