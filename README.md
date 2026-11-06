# Mai Docs

Editores ligeros de **documentos**, **hojas de cálculo** y **presentaciones** que corren completamente en el navegador. Es una PWA instalable que funciona sin conexión y guarda todo localmente. No tiene servidor ni cuentas.

Lightweight **documents**, **spreadsheets** and **presentations** editors that run entirely in the browser. It is an installable PWA that works offline and stores everything locally. No server, no accounts.

## Funciones

- **Documentos**: imágenes con alineación, texto alrededor, pie y texto alternativo; gráficos copiados desde una hoja; formato de texto (fuente, tamaño, color, resaltado), títulos, listas, listas de tareas, sangría, alineación, enlaces, tablas (combinar celdas, encabezados), imágenes (pegar o arrastrar, redimensionar), citas, código, tamaño de página y márgenes, buscar y reemplazar, conteo de palabras. Importa `.docx`, `.md`, `.html` y `.txt`; exporta `.docx`, `.md`, `.html` y `.txt`; PDF al imprimir.
- **Hojas de cálculo**: gráficos (columnas, barras, líneas, área, torta, anillo, dispersión; apilados) que se actualizan con los datos y se exportan como gráficos nativos de Excel, imágenes flotantes y dentro de celdas, varias hojas, ~400 funciones (nombres en inglés con `,`: `=SUM(A1:A3)`, `=VLOOKUP(A2,Hoja2!A:B,2,FALSE)`), referencias entre hojas, recálculo incremental, formato de celda (fuente, colores, bordes, alineación, ajuste de texto), formatos numéricos (moneda, %, fecha…), combinar celdas, inmovilizar filas y columnas, ordenar, autofiltro, rellenar arrastrando, copiar y pegar con Excel/Google Sheets, deshacer/rehacer. Importa y exporta `.xlsx` y `.csv`.
- **Presentaciones**: diapositivas con layouts (título, título y contenido, sección, dos columnas…), cajas de texto enriquecido, 15 formas, imágenes, tablas (combinar celdas, encabezado, bandas), gráficos (desde una hoja o con datos propios), video y audio locales (hasta 50 MB), íconos de Lucide; mover, redimensionar y rotar con guías de alineación, alinear y distribuir; 8 temas con colores y fuentes editables, 16:9 o 4:3; transiciones (desvanecer, empujar, barrido, cubrir, zoom) y animaciones de entrada por clic; notas del orador; modo presentación en pantalla completa con vista de orador en otra ventana (notas, temporizador, siguiente diapositiva). Importa y exporta `.pptx` (tema, patrones y diseños, tablas, gráficos nativos, multimedia, animaciones); PDF al imprimir.
- Biblioteca local con autoguardado (IndexedDB) que funciona como un explorador de archivos:
  - carpetas anidadas con ruta de migas, vista de lista (columnas ordenables) o cuadrícula (con miniatura de las presentaciones);
  - selección múltiple, arrastrar para mover, "Mover a…", menú con clic derecho y atajos de teclado;
  - búsqueda en toda la biblioteca y papelera (una carpeta va y vuelve entera);
  - botón "Nuevo archivo" para documento, hoja, presentación o carpeta;
  - copia de seguridad en `.zip` que conserva las carpetas. En Chromium también abre y guarda archivos del disco (Ctrl+S escribe sobre el `.docx`/`.xlsx`/`.pptx` original).
- Menú con clic derecho (o pulsación larga) en documentos y presentaciones, con las acciones del elemento: tabla, imagen, gráfico, texto. En documentos, Ctrl+clic derecho abre el menú del navegador con la corrección ortográfica.
- Interfaz en español o inglés según el idioma del sistema, con selector manual. Tema claro, oscuro o del sistema, que se cambia con un botón en la barra superior.
- Avisa cuando se pierde la conexión y cuando vuelve.

Navegadores soportados: Chrome, Edge y Firefox (Safari no se soporta).

Limitaciones: sin colaboración en tiempo real, sin paginación tipo Word; al importar `.docx` se pierden encabezados/pies de página y estilos complejos; al importar `.xlsx` se pierden validaciones y formato condicional, y los gráficos con opciones avanzadas se simplifican. Al importar `.pptx`, las formas del patrón se copian a cada diapositiva, los grupos se separan, SmartArt y ecuaciones quedan como su dibujo de respaldo, las formas predefinidas poco comunes se dibujan como rectángulo y las animaciones se reproducen de forma aproximada (se conservan al exportar mientras no se cambien).

## Stack

SvelteKit 3 (SPA estática) · Svelte 5 · TypeScript · Tailwind v4 · Vite · Bun · Tiptap v3 · exceljs · docx · mammoth · formulajs · numfmt · papaparse · Chart.js · Lucide.

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
