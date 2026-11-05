// Instalar como app: guarda el evento `beforeinstallprompt` (Chromium) para ofrecer un botón propio.
// iOS/Safari no lo emite: allí se instala a mano (Compartir → «Añadir a pantalla de inicio»).

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallEvent | null = null;

export const install = $state({
	/** Se puede mostrar el diálogo de instalación del navegador. */
	available: false,
	/** Abierta como app instalada (ventana propia). */
	installed: false
});

export const isIos = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

/** Llamar una vez al arrancar (layout). */
export function initInstall() {
	if (typeof window === 'undefined') return;
	install.installed =
		matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
	// Capturado por app.html antes de que arrancara la app.
	const early = (window as Window & { __maiInstall?: InstallEvent }).__maiInstall;
	if (early && !install.installed) {
		deferred = early;
		install.available = true;
	}
	addEventListener('beforeinstallprompt', (e) => {
		e.preventDefault(); // sin mini-barra automática: el botón está en Ajustes
		deferred = e as InstallEvent;
		install.available = true;
	});
	addEventListener('appinstalled', () => {
		deferred = null;
		install.available = false;
		install.installed = true;
	});
}

const DISMISS_KEY = 'mai.installDismissed';

/** «Ahora no» en la tarjeta de Inicio (los botones del menú siguen disponibles). */
export function installDismissed() {
	try {
		return localStorage.getItem(DISMISS_KEY) === '1';
	} catch {
		return false;
	}
}
export function dismissInstall() {
	try {
		localStorage.setItem(DISMISS_KEY, '1');
	} catch {
		/* sin almacenamiento: vuelve a salir la próxima vez */
	}
}

/** Muestra el diálogo del navegador; true si se aceptó. */
export async function promptInstall() {
	if (!deferred) return false;
	const e = deferred;
	deferred = null;
	install.available = false;
	await e.prompt();
	return (await e.userChoice).outcome === 'accepted';
}
