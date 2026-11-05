// One editor per file across tabs (Web Locks). The second tab opens the file read-only.

export type FileLock = { readonly: boolean; release: () => void };

export async function acquireFileLock(id: string): Promise<FileLock> {
	if (typeof navigator === 'undefined' || !navigator.locks) return { readonly: false, release: () => {} };
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	const got = await new Promise<boolean>((resolve) => {
		void navigator.locks
			.request(`mai-file-${id}`, { ifAvailable: true }, async (lock) => {
				resolve(!!lock);
				if (lock) await held;
			})
			.catch(() => resolve(true));
	});
	return { readonly: !got, release: got ? release : () => {} };
}
