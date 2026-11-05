// Built-in themes. Fonts are system fonts available offline (with CSS fallbacks in the renderer).
import type { Theme } from './model.ts';

const base = (id: string, name: string, c: Partial<Theme['colors']>, fonts: Theme['fonts'], bg = c.lt1 ?? '#ffffff'): Theme => ({
	id,
	name,
	colors: {
		dk1: '#1f2328',
		lt1: '#ffffff',
		dk2: '#44546a',
		lt2: '#e7e6e6',
		accent1: '#2a78d6',
		accent2: '#eb6834',
		accent3: '#1baf7a',
		accent4: '#eda100',
		accent5: '#6250d6',
		accent6: '#e34948',
		hlink: '#1a56c4',
		...c
	},
	fonts,
	background: { type: 'solid', color: bg }
});

export const THEMES: Theme[] = [
	base('simple', 'Simple', {}, { major: 'Arial', minor: 'Arial' }),
	base('dark', 'Noche', { dk1: '#f2f2f2', lt1: '#16181d', dk2: '#c9ccd3', lt2: '#2a2e37', accent1: '#3987e5', accent2: '#d95926', accent3: '#199e70', accent4: '#c98500', accent5: '#9085e9', accent6: '#e66767', hlink: '#7aa7ff' }, { major: 'Segoe UI', minor: 'Segoe UI' }, '#16181d'),
	base('ocean', 'Océano', { dk1: '#0b2a3c', lt1: '#f4fafc', dk2: '#155e75', lt2: '#d7eef4', accent1: '#0e7490', accent2: '#f97316', accent3: '#14b8a6', accent4: '#facc15', accent5: '#6366f1', accent6: '#e11d48' }, { major: 'Georgia', minor: 'Verdana' }),
	base('coral', 'Coral', { dk1: '#3b1f1f', lt1: '#fff8f5', dk2: '#9a3412', lt2: '#fde2d6', accent1: '#e2553f', accent2: '#2f7f8f', accent3: '#f2a541', accent4: '#5b8c5a', accent5: '#8e5ea2', accent6: '#3b5bdb' }, { major: 'Trebuchet MS', minor: 'Trebuchet MS' }),
	base('forest', 'Bosque', { dk1: '#1d2a1d', lt1: '#f6f8f3', dk2: '#2f5233', lt2: '#dfe8d6', accent1: '#2f7d32', accent2: '#c27c0e', accent3: '#4f8fc0', accent4: '#a33b3b', accent5: '#6d5a9c', accent6: '#7a9a01' }, { major: 'Cambria', minor: 'Calibri' }),
	base('mono', 'Monocromo', { dk1: '#111111', lt1: '#ffffff', dk2: '#555555', lt2: '#eeeeee', accent1: '#111111', accent2: '#666666', accent3: '#999999', accent4: '#333333', accent5: '#bbbbbb', accent6: '#e34948' }, { major: 'Helvetica', minor: 'Helvetica' }),
	base('sunset', 'Atardecer', { dk1: '#2b1b3d', lt1: '#fffaf0', dk2: '#7c2d5b', lt2: '#fbe3d0', accent1: '#d9480f', accent2: '#7048e8', accent3: '#f08c00', accent4: '#c2255c', accent5: '#1971c2', accent6: '#2b8a3e' }, { major: 'Palatino Linotype', minor: 'Segoe UI' }),
	base('paper', 'Papel', { dk1: '#2b2b2b', lt1: '#fbf8f1', dk2: '#5c4b37', lt2: '#efe6d4', accent1: '#8b5e34', accent2: '#3d6b8c', accent3: '#6b8e23', accent4: '#b8860b', accent5: '#7b4b94', accent6: '#a83232' }, { major: 'Georgia', minor: 'Georgia' })
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];
