<script lang="ts">
	import { onMount } from 'svelte';
	import { version } from '$app/env';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { i18n, setLangPref, t, formatBytes, type LangPref } from '#lib/i18n/index.svelte.ts';
	import { setTheme, theme, type ThemeMode } from '#lib/client/theme.svelte.ts';
	import { install, isIos, promptInstall } from '#lib/client/install.svelte.ts';
	import { toast } from '#lib/client/toast.svelte.ts';
	import { exportLibrary, importLibrary } from '#lib/files/backup.ts';
	import { download } from '#lib/files/save.ts';

	let usage = $state<{ used: number; quota: number } | null>(null);
	let persisted = $state<boolean | null>(null);

	async function measure() {
		try {
			const e = await navigator.storage?.estimate?.();
			if (e) usage = { used: e.usage ?? 0, quota: e.quota ?? 0 };
			persisted = (await navigator.storage?.persisted?.()) ?? null;
		} catch {
			/* not supported */
		}
	}
	onMount(measure);

	async function askPersist() {
		try {
			persisted = (await navigator.storage?.persist?.()) ?? false;
		} catch {
			persisted = false;
		}
	}

	async function backup() {
		const blob = await exportLibrary();
		const d = new Date().toISOString().slice(0, 10);
		download(blob, `mai-docs-${d}.zip`);
		toast.success(t().library.backupDone);
	}

	function restore() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.zip,application/zip';
		input.onchange = async () => {
			const f = input.files?.[0];
			if (!f) return;
			try {
				const n = await importLibrary(f);
				toast.success(t().library.backupRestored(n));
				void measure();
			} catch {
				toast.error(t().library.backupInvalid);
			}
		};
		input.click();
	}

	const langs = $derived<{ id: LangPref; label: string }[]>([
		{ id: 'system', label: t().settings.langSystem },
		{ id: 'es', label: 'Español' },
		{ id: 'en', label: 'English' }
	]);
	const themes = $derived<{ id: ThemeMode; label: string; icon: 'sun' | 'moon' | 'monitor' }[]>([
		{ id: 'light', label: t().settings.themeLight, icon: 'sun' },
		{ id: 'dark', label: t().settings.themeDark, icon: 'moon' },
		{ id: 'system', label: t().settings.themeSystem, icon: 'monitor' }
	]);
</script>

<AppHeader />

<main class="mx-auto max-w-2xl space-y-5 px-4 pt-6 pb-10">
	<h1 class="text-xl font-semibold">{t().settings.title}</h1>

	<section class="rounded-xl border border-line bg-surface p-4">
		<h2 class="mb-3 flex items-center gap-2 font-medium"><Icon name="globe" size={18} />{t().settings.language}</h2>
		<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={t().settings.language}>
			{#each langs as l (l.id)}
				<button role="radio" aria-checked={i18n.pref === l.id} class="btn {i18n.pref === l.id ? '!border-accent !bg-accent-soft !text-accent' : ''}" onclick={() => setLangPref(l.id)}>{l.label}</button>
			{/each}
		</div>
	</section>

	<section class="rounded-xl border border-line bg-surface p-4">
		<h2 class="mb-3 flex items-center gap-2 font-medium"><Icon name="sun" size={18} />{t().settings.theme}</h2>
		<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={t().settings.theme}>
			{#each themes as th (th.id)}
				<button role="radio" aria-checked={theme.mode === th.id} class="btn {theme.mode === th.id ? '!border-accent !bg-accent-soft !text-accent' : ''}" onclick={() => setTheme(th.id)}>
					<Icon name={th.icon} size={16} />{th.label}
				</button>
			{/each}
		</div>
	</section>

	<section class="rounded-xl border border-line bg-surface p-4">
		<h2 class="mb-3 flex items-center gap-2 font-medium"><Icon name="database" size={18} />{t().settings.storage}</h2>
		{#if usage}
			<p class="text-sm text-muted">{t().settings.used(formatBytes(usage.used), formatBytes(usage.quota))}</p>
			<div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
				<div class="h-full rounded-full bg-accent" style="width:{Math.max(1, Math.min(100, (usage.used / Math.max(1, usage.quota)) * 100))}%"></div>
			</div>
		{/if}
		{#if persisted === true}
			<p class="mt-3 flex items-start gap-2 text-sm text-ok"><Icon name="check" size={16} class="mt-0.5" />{t().settings.persistent}</p>
		{:else if persisted === false}
			<div class="mt-3 rounded-lg border border-warn/40 bg-warn/8 p-3 text-sm">
				<p class="font-medium text-warn">{t().settings.notPersistent}</p>
				<p class="mt-1 text-muted">{t().settings.notPersistentDetail}</p>
				<button class="btn mt-2" onclick={askPersist}>{t().settings.askPersist}</button>
			</div>
		{/if}
		<h3 class="mt-4 mb-2 text-sm font-medium">{t().settings.backup}</h3>
		<div class="flex flex-wrap gap-2">
			<button class="btn" onclick={backup}><Icon name="download" size={16} />{t().library.backupExport}</button>
			<button class="btn" onclick={restore}><Icon name="upload" size={16} />{t().library.backupImport}</button>
		</div>
	</section>

	<section class="rounded-xl border border-line bg-surface p-4">
		<h2 class="mb-3 flex items-center gap-2 font-medium"><Icon name="install" size={18} />{t().settings.install}</h2>
		{#if install.installed}
			<p class="text-sm text-ok">{t().settings.installed}</p>
		{:else}
			<p class="text-sm text-muted">{t().settings.installHint}</p>
			{#if install.available}
				<button class="btn btn-primary mt-3" onclick={promptInstall}><Icon name="install" size={16} />{t().settings.install}</button>
			{:else if isIos()}
				<p class="mt-2 text-sm">{t().settings.installIos}</p>
			{/if}
		{/if}
	</section>

	<section class="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
		<h2 class="mb-2 flex items-center gap-2 font-medium text-fg"><Icon name="info" size={18} />{t().settings.about}</h2>
		<p>{t().app.name} — {t().settings.version(version)}</p>
		<p class="mt-1">{t().settings.offlineReady}</p>
	</section>
</main>
