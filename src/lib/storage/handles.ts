// File System Access handles per library file (Chromium). Lets Ctrl+S write back to the original file.
import { db } from './db.ts';

export async function setHandle(id: string, handle: FileSystemFileHandle) {
	try {
		await (await db()).put('handles', { id, handle, name: handle.name });
	} catch {
		/* handles not cloneable in this browser */
	}
}

export async function getHandle(id: string) {
	try {
		return (await (await db()).get('handles', id))?.handle;
	} catch {
		return undefined;
	}
}

export async function clearHandle(id: string) {
	await (await db()).delete('handles', id);
}

/** Asks for write permission if needed (must run in a user gesture). */
export async function canWrite(handle: FileSystemFileHandle) {
	const opts = { mode: 'readwrite' as const };
	if ((await handle.queryPermission?.(opts)) === 'granted') return true;
	return (await handle.requestPermission?.(opts)) === 'granted';
}
