<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import type { LayoutProps } from './$types';
	import Toaster from '#lib/components/Toaster.svelte';
	import Dialogs from '#lib/components/Dialogs.svelte';
	import UpdateNotice from '#lib/components/UpdateNotice.svelte';
	import { initTheme } from '#lib/client/theme.svelte.ts';
	import { initI18n, t } from '#lib/i18n/index.svelte.ts';
	import { registerServiceWorker } from '#lib/client/pwa.ts';
	import { initInstall } from '#lib/client/install.svelte.ts';
	import { toast } from '#lib/client/toast.svelte.ts';
	import { importFile, isSupported } from '#lib/files/open.ts';
	import { goto } from '#lib/client/nav.ts';
	import { fileRoute } from '#lib/files/create.ts';

	let { children }: LayoutProps = $props();

	initInstall();

	onMount(() => {
		initTheme();
		initI18n();
		void registerServiceWorker();
		const offline = () => toast.info(t().net.offline, { detail: t().net.offlineDetail, key: 'net' });
		const online = () => toast.dismissKey('net');
		addEventListener('offline', offline);
		addEventListener('online', online);
		// Opened from the OS ("Open with Mai Docs", manifest file_handlers, Chromium).
		window.launchQueue?.setConsumer(async ({ files }) => {
			let last: string | null = null;
			let kind: 'doc' | 'sheet' | 'slides' = 'doc';
			for (const h of files) {
				try {
					const file = await h.getFile();
					if (!isSupported(file.name)) {
						toast.error(t().library.unsupported(file.name));
						continue;
					}
					const { meta, warnings } = await importFile(file, h);
					for (const w of warnings) toast.warn(w);
					last = meta.id;
					kind = meta.kind;
				} catch (e) {
					toast.error(t().library.openFailed, { detail: String((e as Error)?.message ?? e) });
				}
			}
			if (last) void goto(fileRoute(kind, last));
		});
		return () => {
			removeEventListener('offline', offline);
			removeEventListener('online', online);
		};
	});
</script>

<svelte:head>
	<title>{t().app.name}</title>
	<meta name="description" content={t().app.tagline} />
</svelte:head>

{@render children()}

<Toaster />
<Dialogs />
<UpdateNotice />
