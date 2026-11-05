<script lang="ts">
	// Manifest shortcuts: /new/doc and /new/sheet create a file and open it.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '#lib/client/nav.ts';
	import { fileRoute, newOfKind } from '#lib/files/create.ts';
	import { t } from '#lib/i18n/index.svelte.ts';

	onMount(async () => {
		const kind = page.params.kind === 'sheet' ? 'sheet' : page.params.kind === 'slides' ? 'slides' : 'doc';
		const meta = await newOfKind(kind);
		await goto(fileRoute(kind, meta.id), { replaceState: true });
	});
</script>

<div class="grid h-dvh place-items-center text-muted">{t().common.loading}</div>
