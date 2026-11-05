<script lang="ts">
	// Pinta los toasts (client/toast.svelte.ts) arriba y al centro, sobre todo lo demás. Los que se cierran solos muestran
	// una barra de tiempo que se detiene con el ratón o el foco encima.
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { dismiss, pause, resume, toasts, type Toast } from '../client/toast.svelte.ts';
	import { t as tr } from '../i18n/index.svelte.ts';

	const ICON: Record<Toast['kind'], string> = { success: '✓', info: 'i', warn: '!', error: '✕' };

	async function act(t: Toast, run: () => void | Promise<void>, keep?: boolean) {
		await run();
		if (!keep) dismiss(t.id);
	}

	// ---------- Deslizar para cerrar (dedo o ratón): hacia los lados o hacia arriba; los `persistent`, no ----------
	const START = 8; // px antes de considerarlo arrastre (así los botones siguen recibiendo su clic)
	const CLOSE_X = 90;
	const CLOSE_UP = 45;
	type Drag = { id: number; pointer: number; x0: number; y0: number; t0: number; dx: number; dy: number; active: boolean };
	let drag: Drag | null = $state(null);
	/** Hacia dónde sale cada toast cerrado con gesto (para que la animación siga al dedo). */
	const exit = new Map<number, { x: number; y: number }>();
	let swallowClick = false;

	function down(e: PointerEvent, t: Toast) {
		if (t.persistent || e.button > 0) return;
		drag = { id: t.id, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), dx: 0, dy: 0, active: false };
	}
	function move(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointer) return;
		const dx = e.clientX - drag.x0;
		const dy = Math.min(0, e.clientY - drag.y0); // hacia abajo no
		if (!drag.active && Math.hypot(dx, dy) > START) {
			drag.active = true;
			pause(drag.id);
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		}
		if (drag.active) {
			drag.dx = dx;
			drag.dy = dy;
		}
	}
	function up(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointer) return;
		const d = drag;
		drag = null;
		if (!d.active) return;
		swallowClick = true;
		setTimeout(() => (swallowClick = false), 0);
		// Un golpe rápido también cierra aunque no llegue al umbral.
		const ms = Math.max(1, performance.now() - d.t0);
		const fast = Math.hypot(d.dx, d.dy) / ms > 0.6;
		const horizontal = Math.abs(d.dx) >= Math.abs(d.dy);
		if (horizontal ? Math.abs(d.dx) > CLOSE_X || (fast && Math.abs(d.dx) > 30) : -d.dy > CLOSE_UP || (fast && -d.dy > 20)) {
			exit.set(d.id, horizontal ? { x: Math.sign(d.dx) * 420, y: 0 } : { x: 0, y: -120 });
			dismiss(d.id);
		} else resume(d.id);
	}
	const offset = (t: Toast) => (drag?.id === t.id && drag.active ? { x: drag.dx, y: drag.dy } : null);
	const outOf = (id: number) => {
		const e = exit.get(id);
		exit.delete(id);
		return e ? { x: e.x, y: e.y, duration: 160, opacity: 0 } : { y: -10, duration: 150 };
	};
</script>

<div class="toaster" aria-live="polite">
	{#each toasts.list as t (t.id)}
		{@const off = offset(t)}
		<div
			class="toast {t.kind}"
			class:dragging={!!off}
			role={t.kind === 'error' || t.kind === 'warn' ? 'alert' : 'status'}
			in:fly={{ y: -16, duration: 180 }}
			out:fly={outOf(t.id)}
			animate:flip={{ duration: 180 }}
			style:transform={off ? `translate(${off.x}px, ${off.y}px)` : undefined}
			style:opacity={off ? Math.max(0.25, 1 - Math.max(Math.abs(off.x) / 260, -off.y / 110)) : undefined}
			onmouseenter={() => pause(t.id)}
			onmouseleave={() => !drag && resume(t.id)}
			onfocusin={() => pause(t.id)}
			onfocusout={() => resume(t.id)}
			onpointerdown={(e) => down(e, t)}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
			onclickcapture={(e) => swallowClick && (e.stopPropagation(), e.preventDefault())}
		>
			<span class="icon" aria-hidden="true">{ICON[t.kind]}</span>
			<div class="body">
				<div class="msg">{t.message}</div>
				{#if t.detail}<div class="detail">{t.detail}</div>{/if}
				{#if t.actions?.length}
					<div class="actions">
						{#each t.actions as a, i (a.label)}
							<button class="btn !px-2 !py-0.5 !text-xs" class:btn-primary={i === 0} onclick={() => act(t, a.run, a.keep)}>{a.label}</button>
						{/each}
					</div>
				{/if}
			</div>
			{#if !t.persistent}
				<button class="close btn btn-ghost !px-1.5 !py-0 !text-xs" onclick={() => dismiss(t.id)} aria-label={tr().common.close}>✕</button>
			{/if}
			{#if t.duration != null}<span class="timer" style="animation-duration:{t.duration}ms"></span>{/if}
		</div>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		top: max(0.75rem, env(safe-area-inset-top));
		left: 50%;
		transform: translateX(-50%);
		z-index: 70; /* sobre el lector (42), el tutor (45), el diccionario (50) */
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: min(480px, calc(100vw - 1.2rem));
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.65rem 0.7rem 0.7rem 0.75rem;
		border-radius: 10px;
		background: var(--c-surface);
		border: 1px solid var(--c-line);
		border-left: 4px solid var(--tone);
		box-shadow: 0 8px 28px rgb(0 0 0 / 0.28);
		font-size: 0.92rem;
		/* Deja el scroll vertical de la página; el gesto lo gestionamos nosotros. */
		touch-action: pan-y;
		user-select: none;
		transition:
			transform 0.18s,
			opacity 0.18s;
	}
	.toast.dragging {
		transition: none;
		cursor: grabbing;
	}
	.success {
		--tone: var(--c-ok);
	}
	.info {
		--tone: var(--c-info);
	}
	.warn {
		--tone: var(--c-warn);
	}
	.error {
		--tone: var(--c-bad);
	}
	.icon {
		flex-shrink: 0;
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 0.75rem;
		font-weight: 700;
		color: #fff;
		background: var(--tone);
		margin-top: 0.05rem;
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.msg {
		color: var(--c-fg);
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.detail {
		color: var(--c-muted);
		font-size: 0.82rem;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.2rem;
	}
	.close {
		flex-shrink: 0;
		padding: 0.05rem 0.4rem;
		border: none;
	}
	.timer {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		width: 100%;
		background: var(--tone);
		opacity: 0.5;
		transform-origin: left;
		animation-name: shrink;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
	}
	.toast:hover .timer,
	.toast:focus-within .timer {
		animation-play-state: paused;
	}
	@keyframes shrink {
		to {
			transform: scaleX(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.timer {
			display: none;
		}
	}
</style>
