# CLAUDE.md

Mai Docs: lightweight Documents (Word-like) and Spreadsheets (Excel-like) editors as an offline-first **static PWA on GitHub Pages**. No backend. UI in Spanish and English.

Implementation plan in `plan.md` (local, gitignored). Phases F0–F9 implemented.

## Commands

- `bun run dev` — Vite dev server (port 5173).
- `bun run check` — svelte-check; keep 0 errors / 0 warnings.
- `bun test` — pure logic tests in `tests/` (formulas, engine, refs, ops, CSV, xlsx round trip, docx XML, markdown, search, i18n parity, filters, signature hints, chart data, objects + structure, xlsx images and native charts round trip in `xlsx-objects.test.ts`) plus `interop.test.ts`: exported .xlsx read by SheetJS (`xlsx`, dev-only), .docx read by mammoth, every XML part validated with `fast-xml-parser`. Svelte rune files (`*.svelte.ts`) can't be imported from Bun tests.
- `bun run build` — static site in `build/`. For Pages: `MSYS_NO_PATHCONV=1 BASE_PATH=/mai-docs bun run build` (Git Bash mangles `/mai-docs` without the prefix). CI copies `404.html` → `index.html`.
- Deploy: `.github/workflows/main.yml` (check, test, build with `BASE_PATH=/<repo>`, push `build/` to `gh-pages`). Bun pinned to 1.4.4 (same as local). Pages must be set to serve the `gh-pages` branch.
- UI checks: headless Edge driven over CDP (`--remote-debugging-port`), screenshots with `Page.captureScreenshot`. Icons PNGs (`static/icons/*.png`, `static/apple-touch-icon.png`) are rendered from the SVGs that way (transparent background via `Emulation.setDefaultBackgroundColorOverride`); regenerate them if the SVGs change.

## Stack

- SvelteKit 3 SPA (`adapter-static`, `ssr = false`, fallback `404.html`) + Svelte 5 runes + TypeScript 6.x + Vite 8 + Bun.
- Tailwind v4 via `@tailwindcss/vite`. Colors are tokens (`app.css`: `--c-*` vars mapped in `@theme inline` to `bg-surface`, `text-muted`, `border-line`, `bg-sel`…); no hardcoded colors in components except white text on fills and the document paper (always white).
- Docs: Tiptap v3 (`@tiptap/core`, no Pro extensions). Extension list in `docs/extensions/index.ts` (`schemaExtensions()` shared by editor, markdown and HTML→JSON). Own extensions: `indent.ts` (paragraph indent attr; Tab/Shift-Tab), `search.ts` (find/replace decorations).
- Docs I/O: `docx` (export, `docs/io/docx-export.ts`, own JSON→docx serializer), `mammoth` (import, lossy), `@tiptap/markdown` `MarkdownManager` (works without DOM), print = CSS `@media print` + injected `@page`.
- Sheets: own virtualized DOM grid + own formula engine. `@formulajs/formulajs` only as fallback for functions not implemented in `formula/functions.ts` (its Date results are converted to serials). `exceljs` (xlsx), `papaparse` (CSV), `numfmt` (number formats + locale-aware input parsing).
- Charts: Chart.js (`charts/render.ts` builds the config from `ChartOptions` + `ChartData`; loaded with `import()`). Palette = dataviz skill reference palette (`PALETTE` in `sheets/charts.ts`, light/dark, fixed order). Marks: 4px rounded bar ends, 2px lines, 8px markers, legend only for >= 2 series. Native Excel charts are written/read by `sheets/io/xlsx-charts.ts` (DrawingML XML into the zip after exceljs; parsed with `fast-xml-parser`).
- Storage: IndexedDB via `idb` (`storage/db.ts`: stores `files`, `contents`, `blobs`, `handles`). File System Access for open/save in Chromium.

## Architecture inherited from `../sensei`

- No `svelte.config.js`: Kit options live in the `sveltekit({...})` plugin in `vite.config.ts`.
- Alias `#lib/*` via package.json `imports`; imports need file extensions.
- `$app/state` (no stores). `$app/paths` has no `base` in Kit 3: use `withBase()` from `#lib/client/base.ts` for every internal href and `goto` from `#lib/client/nav.ts`.
- `tsconfig.json` must exclude `src/service-worker.ts` (Kit validates it).
- Service worker `src/service-worker.ts` registered manually in prod (`client/pwa.ts`, `serviceWorker.register: false`). It precaches all of `$app/manifest` `immutable` + `assets` (lazy chunks such as exceljs/mammoth included, so import/export work offline). Cache `mai-<version>`. Update flow (`applyUpdate` checks the served shell before reloading because the Pages CDN can serve a stale `index.html`) ported from sensei; `UpdateNotice.svelte` never auto-reloads while an editor route is open.

## Code map

- `lib/i18n/` — `en.ts` (source; `Dict` type), `es.ts` (`Dict`), `detect.ts` (pure), `index.svelte.ts` (`t()`, `setLangPref`, `ago`, `formatBytes`). New UI text must be added to both dictionaries (TS enforces shape; `tests/i18n.test.ts` checks non-empty).
- `lib/storage/` — `library.ts` (CRUD + BroadcastChannel `mai-library`), `blobs.ts` (doc images: JSON stores `mai-blob:<id>`, editor sees `blob:` URLs; `hydrate`/`dehydrate`), `autosave.svelte.ts`, `locks.ts` (Web Lock `mai-file-<id>`: second tab is read-only), `handles.ts`.
- `lib/files/` — `open.ts` (picker/drop/launchQueue → `importFile`; converters in `convert.ts` loaded with `import()`), `save.ts` (handle write / Save As / download), `backup.ts` (library .zip), `create.ts`.
- `lib/docs/` — `model.ts` (`DocContent {v, page, doc}`), `editor.ts` (image paste/drop → blobs), `io/`.
- `lib/sheets/` — `addr.ts`, `values.ts` (errors `{e}`, coercion, Excel 1900 date serials), `model.ts` (Workbook/Sheet with Maps keyed `r*16384+c`; `WorkbookContent` JSON), `formula/` (`parse.ts` tokenizer/parser/printer, `eval.ts`, `functions.ts`, `engine.ts`, `refs.ts`), `ops.ts` (cell diffs + structural ops), `book.svelte.ts` (controller: engine, undo history, `rev`), `view.svelte.ts` (selection, editing, clipboard), `actions.ts` (toolbar/context/shortcut commands), `format.ts`, `input.ts`, `filter.ts`, `layout.ts` (`Axis`), `clipboard.ts`, `io/`.
- Floating objects (`Sheet.objects`: images and charts, `model.ts` `SheetObject`) anchor to a cell + px offset; drawn by `components/sheets/ObjectLayer.svelte` per pane (frozen anchors stay frozen); move/resize commit on pointerup via `book.updateObject` (one undo step). `view.object` = selected object (keyboard: arrows/Delete/Enter, Ctrl+Alt+O cycles); `view.editingChart` opens `charts/ChartPanel.svelte`. Cell images = `Cell.img` (move with the cell). Chart sources are A1 text with sheet prefix and are rewritten like formulas on insert/delete/rename/delete-sheet (`ops.ts` `forEachChart`). Sheet images live in the `blobs` store with `docId` = file id (raw blob ids in the JSON; `pruneBlobs` matches any id substring).
- Documents: images have `align`/`wrap` attrs (`docs/extensions/image-extras.ts`, styled via `[data-resize-container]:has(img[data-…])`), captions are paragraphs with `caption: true` (docx style `Caption`). Charts are `chart` atom nodes (`docs/extensions/chart-node.ts`, data copied, not linked); the editor uses `ChartNodeWithView` (`components/docs/chart-view.svelte.ts`, Svelte mount) and requests editing with the `mai-edit-chart` DOM event. Exports turn charts into PNG (`renderChartPng`).
- `components/sheets/Grid.svelte` — native scroll container + sticky viewport with 4 panes (frozen corner/rows/cols/body) translated by scroll; one textarea "sink" handles typing (IME), navigation and clipboard events.

## Decisions (durable)

- Internal format is native JSON (Tiptap JSON; sparse workbook model). docx/xlsx are produced only on export, never stored as the source of truth.
- Formula results are cached in `cell.v` (instant open; used as result on xlsx export; volatile ones recalculated on open).
- Formula syntax: English function names and `,` separator always (`=SUM(A1,B1)`), regardless of UI language. Newer functions get the `_xlfn.` prefix on xlsx export (`XLFN` list in `io/xlsx.ts`) and lose it on import.
- Number input in cells follows UI locale via numfmt `parseValue` (`es`: `1,5`, `31/1/2024`; `en`: `1.5`, `1/31/2024`); typed dates/percents set a number format. CSV import: `;` delimiter → UI locale numbers, `,`/tab → `.` decimals. CSV export: `,` + `.` + BOM.
- Default page size: A4 when UI is `es`, Letter when `en`. On narrow screens the doc reflows to the screen width (no paper size) until the user picks a zoom.
- Supported browsers: Chromium (Chrome, Edge) and Firefox. Safari/iOS is not supported (decided 2026-11-05); no Safari-specific work or testing.
- i18n detection: any `navigator.languages` entry starting with `es` → `es`, else `en`; override `localStorage['mai.lang']`. Theme: `localStorage['mai.theme']`; `data-theme` is always concrete (`light|dark`).
- Ctrl+S writes back to the remembered handle only for `.docx`/`.xlsx` (other formats would lose formatting); otherwise Save As.
- Out of scope: real-time collaboration, Word-style pagination, comments/track changes, Playwright, backend. Not implemented: bundled Calibri/Cambria-compatible fonts (font names are written as-is).

## Invariants / gotchas

- `.gitignore` entries must be anchored (`/docs`, `/plan.md`): Tailwind v4 skips gitignored paths when scanning classes, and an unanchored `docs` hid `src/**/docs/`.
- Never increment a reactive counter (`ver++`, `book.rev++`) where it may run inside an effect without `untrack` — reading+writing it subscribes the effect and loops (`effect_update_depth_exceeded`). Tiptap `onTransaction` and `Book.bump` already use `untrack`.
- Sheet objects are mutated in place: components derive `const sheet = $derived(dep(book.rev, { ...book.active }))` (fresh reference per revision) or read `book.rev` inside each derived; deriving `book.active` directly does not propagate changes.
- `saveContent` issues the content `put` before awaiting any read in the transaction: during page unload continuations after an await may never run. Autosave: 400 ms debounce, max 2 s, flush on `visibilitychange`/`pagehide`/`beforeunload`.
- Structural sheet ops (insert/delete rows/cols, sheets, rename) are undone by snapshot restore (`Book.structural`); cell edits by exact inverse diffs. After any structural change call `engine.rebuild()`.
- Formula evaluation is demand-driven with depth limit 400 + explicit stack (`NeedFirst`), so 5000-long chains in either direction don't overflow; cycles → `#CIRC!` (exported to xlsx as `#REF!`).
- Grid performance: the visible window is snapped to blocks (8 rows / 4 cols) and cell box objects are cached per (revision, geometry), so scrolling inside a block only changes pane transforms and rebuilds keep existing DOM. `.cell` uses `contain: layout paint style`. Measured on the prod build (100k rows, headless Edge without GPU): 60 fps at 6000 px/s vertical, 61 fps horizontal. Dev mode is much slower (Svelte dev stack capture): measure performance on `bun run build`.
- Text overflow: left-aligned string cells spill into empty, unfilled neighbours to the right (`ow`/`nr` in `CellBox`); the editor textarea grows with `field-sizing: content` where supported, measured width/height elsewhere (Firefox, Safari).
- Browser checks done: Edge (CDP) and Firefox (WebDriver BiDi, `--remote-debugging-port`, `browsingContext.create` tab; `setViewport` needs system access) on the prod build and on the live site https://fs-frost.github.io/mai-docs/, including real offline and the update flow. Not checked: Word/Excel opening exported files (interop tests substitute).
