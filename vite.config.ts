import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Site base: '' locally; on GitHub Pages '/<repo>' (set by CI through BASE_PATH).
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;
// Version = short commit sha (GITHUB_SHA in Actions); 'dev' locally.
const version = process.env.GITHUB_SHA?.slice(0, 7) || 'dev';
process.env.VITE_BUILT_AT ??= new Date().toISOString();

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			// SPA: 404.html serves every deep route on GitHub Pages (CI copies it to index.html).
			adapter: adapter({ pages: 'build', assets: 'build', fallback: '404.html', precompress: false, strict: false }),
			paths: { base, relative: false },
			// Registered by hand, only in production builds (client/pwa.ts).
			serviceWorker: { register: false },
			version: { name: version, pollInterval: version === 'dev' ? 0 : 5 * 60_000 }
		})
	],
	worker: { format: 'es' },
	server: { port: Number(process.env.PORT ?? 5173), strictPort: true },
	build: { chunkSizeWarningLimit: 1500 }
});
