# Mai Docs

Editores ligeros de **documentos** y **hojas de cálculo** que corren completamente en el navegador. Es una PWA instalable que funciona sin conexión y guarda todo localmente. No tiene servidor ni cuentas.

Lightweight **documents** and **spreadsheets** editors that run entirely in the browser. It is an installable PWA that works offline and stores everything locally. No server, no accounts.

## Funciones

- **Documentos**: formato de texto (fuente, tamaño, color, resaltado), títulos, listas, listas de tareas, sangría, alineación, enlaces, tablas (combinar celdas, encabezados), imágenes (pegar o arrastrar, redimensionar), citas, código, tamaño de página y márgenes, buscar y reemplazar, conteo de palabras. Importa `.docx`, `.md`, `.html` y `.txt`; exporta `.docx`, `.md`, `.html` y `.txt`; PDF al imprimir.
- **Hojas de cálculo**: varias hojas, ~400 funciones (nombres en inglés con `,`: `=SUM(A1:A3)`, `=VLOOKUP(A2,Hoja2!A:B,2,FALSE)`), referencias entre hojas, recálculo incremental, formato de celda (fuente, colores, bordes, alineación, ajuste de texto), formatos numéricos (moneda, %, fecha…), combinar celdas, inmovilizar filas y columnas, ordenar, autofiltro, rellenar arrastrando, copiar y pegar con Excel/Google Sheets, deshacer/rehacer. Importa y exporta `.xlsx` y `.csv`.
- Biblioteca local con autoguardado (IndexedDB), papelera y copia de seguridad en `.zip`. En Chromium también abre y guarda archivos del disco (Ctrl+S escribe sobre el `.docx`/`.xlsx` original).
- Interfaz en español o inglés según el idioma del sistema, con selector manual. Tema claro, oscuro o del sistema.

Navegadores soportados: Chrome, Edge y Firefox (Safari no se soporta).

Limitaciones: sin colaboración en tiempo real, sin paginación tipo Word, sin gráficos en hojas; al importar `.docx` se pierden encabezados/pies de página y estilos complejos; al importar `.xlsx` se pierden imágenes, gráficos, validaciones y formato condicional.

## Stack

SvelteKit 3 (SPA estática) · Svelte 5 · TypeScript · Tailwind v4 · Vite · Bun · Tiptap v3 · exceljs · docx · mammoth · formulajs · numfmt · papaparse.

## Desarrollo

Requiere [Bun](https://bun.sh) 1.4.4.

```sh
bun install
bun run dev      # servidor de desarrollo (http://localhost:5173)
bun run check    # svelte-check (0 errores, 0 advertencias)
bun test         # tests
bun run build    # sitio estático en build/
```

En Git Bash, para compilar con la base de GitHub Pages: `MSYS_NO_PATHCONV=1 BASE_PATH=/mai-docs bun run build`.

## Deploy

Sitio: https://fs-frost.github.io/mai-docs/ — repo https://github.com/FS-Frost/mai-docs.

Cada push a `main` corre `.github/workflows/main.yml`: chequeo de tipos, tests, build con `BASE_PATH=/<repo>` y publicación de `build/` en la rama `gh-pages`. En GitHub, Settings → Pages debe servir desde la rama `gh-pages`.

## Licencia

MIT.
