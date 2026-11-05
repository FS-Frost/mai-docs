<script lang="ts">
	// Manifest shortcuts: /new/doc and /new/sheet create a file and open it.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '#lib/client/nav.ts';
	import { newDocument, newSpreadsheet } from '#lib/files/create.ts';
	import { t } from '#lib/i18n/index.svelte.ts';

	onMount(async () => {
		const kind = page.params.kind === 'sheet' ? 'sheet' : 'doc';
		const meta = kind === 'doc' ? await newDocument() : await newSpreadsheet();
		await goto(kind === 'doc' ? `/docs/${meta.id}` : `/sheets/${meta.id}`, { replaceState: true });
	});
</script>

<div class="grid h-dvh place-items-center text-muted">{t().common.loading}</div>
