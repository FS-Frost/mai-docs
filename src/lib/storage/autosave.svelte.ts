// Debounced autosave with a reactive status. Saves `delay` ms after the last change, but at least every
// `maxWait` ms during continuous editing; flushes when the tab is hidden or the page unloads.

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export function createAutosave(save: () => Promise<void>, delay = 400, maxWait = 2000) {
	const state = $state({ status: 'saved' as SaveStatus });
	let timer: ReturnType<typeof setTimeout> | undefined;
	let firstDirty = 0;
	let running: Promise<void> | null = null;
	let again = false;

	async function run() {
		clearTimeout(timer);
		timer = undefined;
		firstDirty = 0;
		if (running) {
			again = true;
			return running;
		}
		state.status = 'saving';
		running = (async () => {
			try {
				await save();
				state.status = again ? 'dirty' : 'saved';
			} catch (err) {
				console.error('[mai] autosave failed', err);
				state.status = 'error';
			}
		})();
		await running;
		running = null;
		if (again) {
			again = false;
			await run();
		}
	}

	function schedule() {
		state.status = 'dirty';
		const now = Date.now();
		if (!firstDirty) firstDirty = now;
		clearTimeout(timer);
		const wait = Math.max(0, Math.min(delay, maxWait - (now - firstDirty)));
		timer = setTimeout(run, wait);
	}

	async function flush() {
		if (timer || state.status === 'dirty') await run();
		else if (running) await running;
	}

	const onHide = () => {
		if (document.visibilityState === 'hidden') void flush();
	};
	const onUnload = () => void flush();
	document.addEventListener('visibilitychange', onHide);
	addEventListener('pagehide', onUnload);
	addEventListener('beforeunload', onUnload);

	function destroy() {
		document.removeEventListener('visibilitychange', onHide);
		removeEventListener('pagehide', onUnload);
		removeEventListener('beforeunload', onUnload);
		void flush();
	}

	return { state, schedule, flush, destroy };
}
