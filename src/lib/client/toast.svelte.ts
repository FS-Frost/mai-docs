// Notificaciones de la app (toasts), arriba de la pantalla. Úsalo para confirmar acciones, avisos y errores pasajeros:
//   toast.success('Guardado')                         // se cierra solo (3,5 s)
//   toast.error('No se pudo importar', { detail })    // se queda hasta cerrarlo
//   toast.info('Hay una versión nueva', { duration: null, action: { label: 'Actualizar', run } })
// Lo que forma parte de un formulario (un campo inválido) sigue mostrándose junto al campo, no como toast.
// Lo pinta components/Toaster.svelte (en el layout raíz, también en el laboratorio y la instalación).

import { untrack } from 'svelte';

export type ToastKind ='success' | 'info' | 'warn' | 'error';

export type ToastAction = { label: string; run: () => void | Promise<void>; /** No cerrar el toast al pulsar. */ keep?: boolean };

export type ToastOptions = {
	/** Segunda línea, más pequeña. */
	detail?: string;
	/** ms hasta cerrarse solo; null = hasta que se cierre a mano. Por defecto según el tipo (DURATIONS). */
	duration?: number | null;
	/** Hasta dos botones (p. ej. «Actualizar», «Deshacer»). */
	actions?: ToastAction[];
	/** Clave: un toast nuevo con la misma clave sustituye al anterior (p. ej. «sin conexión»). */
	key?: string;
	/** Sin botón ✕ (para avisos que se resuelven solos con una acción). */
	persistent?: boolean;
};

export type Toast = Required<Pick<ToastOptions, 'duration'>> &
	Omit<ToastOptions, 'duration'> & { id: number; kind: ToastKind; message: string; createdAt: number };

/** Cierre automático por defecto: los errores se quedan (hay que leerlos), lo demás se va solo. */
export const DURATIONS: Record<ToastKind, number | null> = { success: 3500, info: 5000, warn: 8000, error: null };
/** Como mucho estos a la vez: los más antiguos se descartan. */
export const MAX_TOASTS = 4;

export const toasts = $state<{ list: Toast[] }>({ list: [] });

let nextId = 1;
const timers = new Map<number, { handle: ReturnType<typeof setTimeout>; ends: number; left: number }>();

function schedule(t: Toast, ms: number) {
	clearTimeout(timers.get(t.id)?.handle);
	timers.set(t.id, { handle: setTimeout(() => dismiss(t.id), ms), ends: Date.now() + ms, left: ms });
}

export function show(kind: ToastKind, message: string, opts: ToastOptions = {}): number {
	// Sin rastrear la lista: llamado desde un $effect, leerla lo volvería a disparar en bucle.
	return untrack(() => {
		const duration = opts.duration === undefined ? DURATIONS[kind] : opts.duration;
		if (opts.key) for (const old of toasts.list.filter((x) => x.key === opts.key)) dismiss(old.id);
		const t: Toast = { ...opts, id: nextId++, kind, message, duration, createdAt: Date.now() };
		toasts.list = [...toasts.list, t].slice(-MAX_TOASTS);
		if (duration != null) schedule(t, duration);
		return t.id;
	});
}

export function dismiss(id: number) {
	clearTimeout(timers.get(id)?.handle);
	timers.delete(id);
	toasts.list = toasts.list.filter((t) => t.id !== id);
}

/** Cierra los toasts con esa clave (p. ej. «sin conexión» al volver la red). */
export function dismissKey(key: string) {
	for (const t of untrack(() => toasts.list.filter((x) => x.key === key))) dismiss(t.id);
}

/** Pausa el cierre automático (ratón o foco encima) y lo reanuda con el tiempo que quedaba. */
export function pause(id: number) {
	const tm = timers.get(id);
	if (!tm) return;
	clearTimeout(tm.handle);
	timers.set(id, { ...tm, left: Math.max(0, tm.ends - Date.now()) });
}
export function resume(id: number) {
	const tm = timers.get(id);
	const t = toasts.list.find((x) => x.id === id);
	if (tm && t) schedule(t, Math.max(1200, tm.left));
}

export const toast = Object.assign((message: string, opts?: ToastOptions) => show('info', message, opts), {
	success: (message: string, opts?: ToastOptions) => show('success', message, opts),
	info: (message: string, opts?: ToastOptions) => show('info', message, opts),
	warn: (message: string, opts?: ToastOptions) => show('warn', message, opts),
	error: (message: string, opts?: ToastOptions) => show('error', message, opts),
	dismiss,
	dismissKey
});
