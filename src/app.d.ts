// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {}

	interface FilePickerAcceptType {
		description?: string;
		accept: Record<string, string | string[]>;
	}
	interface Window {
		showOpenFilePicker?: (opts?: { multiple?: boolean; types?: FilePickerAcceptType[]; excludeAcceptAllOption?: boolean }) => Promise<FileSystemFileHandle[]>;
		showSaveFilePicker?: (opts?: { suggestedName?: string; types?: FilePickerAcceptType[] }) => Promise<FileSystemFileHandle>;
		launchQueue?: { setConsumer(cb: (params: { files: readonly FileSystemFileHandle[] }) => void): void };
	}
	interface FileSystemHandle {
		queryPermission?(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
		requestPermission?(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
	}
}

export {};
