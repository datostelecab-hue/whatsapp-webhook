---
tags: [como-se-trabaja, diseño, interfaz, identidad]
aliases: [Diseño corporativo, Tokens de color, La marca]
actualizado: 2026-09-27
---

# Identidad visual

**Desde el 27/09/2026 la casa es corporativa.** Camilo: *«más moderna, elegante y un poco más minimalista, no quiero tanto emoji ni colores combinados, algo más corporativo»*. Sustituye al diseño del 05/09 (fondo negro cálido con resplandor ámbar, tarjetas de cristal, botones en degradado, Plus Jakarta Sans).

Todo vive en **`public/assets/css/telecab.css`** y en la configuración de Tailwind de **`views/layout-gestion.ejs`** (y `layout-auth.ejs` para el acceso). Las vistas no llevan color propio → [[Reglas de la casa]], regla 7.

## Las tres reglas

1. **Un solo acento.** El oro del logo (`--tc-gold`) marca lo que se pulsa o lo que está elegido, y nada más. El resto es gris: grafito en oscuro, gris claro en claro. Rojo, verde y naranja quedan para lo que de verdad es un **estado**.
2. **Superficies lisas.** Sin cristal (`backdrop-filter` apagado en toda la app), sin resplandor de fondo, sin grano, sin degradados, sin sombras de color. Una tarjeta es una superficie con un borde fino; lo que flota (menús, diálogos) lleva una sombra neutra (`--tc-sombra-alta`).
3. **La tipografía ordena.** **IBM Plex Sans** en toda la app, con cifras tabulares en las tablas. Los títulos a 600, no a 800.

## Los tokens

Canales RGB (`"227 178 60"`) para que Tailwind pueda darles opacidad (`bg-telecab-gold/15`).

| Token | Para qué | Oscuro | Claro |
|---|---|---|---|
| `--tc-dark` | fondo de la página | `#0E1013` | `#F4F5F7` |
| `--tc-card` | tarjetas, menú | `#16181C` | `#FFFFFF` |
| `--tc-card2` | superficie elevada / hover | `#1F2227` | `#F1F3F5` |
| `--tc-border` | la línea fina | `#2C3037` | `#DEE2E7` |
| `--tc-campo` | el interior de un campo | `#0E1013` | `#FFFFFF` |
| `--tc-gold` | **el acento** | `#E3B23C` | `#966A00` (legible como texto, 4,8:1) |
| `--tc-on-gold` | el texto sobre el acento | casi negro | blanco |
| `--tc-azul` | informativo | acero apagado | azul oscuro |
| `--tc-warn` | aviso (naranja, distinto del acento) | | |
| `--tc-red` / `--tc-green` / `--tc-violet` | estados | | |
| `--tc-sombra` / `--tc-sombra-alta` | sombra de tarjeta / de lo que flota | | |

**Los temas** (`data-theme`, lo elige cada uno en Configuración) **comparten las superficies y cambian solo el acento**: azul, verde, púrpura, rosa, cian y naranja en oscuro; los mismos en claro (`claro-*`); y alto contraste aparte. Así cada uno conserva su color sin que la pantalla se vuelva un arcoíris. Las muestras del selector de tema en `views/configuracion.ejs` copian estos valores: si cambia un token, cambia también la muestra.

`--tc-halo*`, `--tc-card-a` y `--tc-brillo` son del diseño anterior: siguen definidos (alguna vista los lee) pero ya no pintan nada.

## Los colores crudos de Tailwind

Están **remapeados a los tokens en todos sus tonos** (`window.__tcCrudos` en los layouts): `text-red-300`, `bg-emerald-500/15` o `border-indigo-500/40` son colores de la marca. Ninguna vista puede colar un color suelto.

> [!important] El ámbar es AVISO, no el acento
> Desde el 27/09 `amber`, `orange` y `yellow` van a `--tc-warn`. En las vistas el ámbar marca «pendiente», «sin contestar», «provisional»; antes iba al acento y lo que se podía pulsar se confundía con lo que había que revisar. `sky`/`blue` → `--tc-azul`; `violet`/`purple`/`indigo` → `--tc-violet`.

## Sin emojis

En las pantallas **no se usan emojis**: se pintan de colores, cada sistema operativo los dibuja a su manera y en una pantalla de gestión se leen como adorno. Si el dibujo dice algo (día/noche, un aviso), va **el icono de la casa** (Font Awesome, que toma el color del texto); si era adorno, se quita. Las marcas tipográficas `✓ ✕ ·` sí valen: son texto y salen de un color.

Lo que **no** es pantalla y se queda como estaba: los mensajes de WhatsApp del bot a los conductores y los títulos de los Excel que se descargan.

## La marca y la carga

**`views/partials/marca.ejs`** dibuja el pin y la carretera del logo en SVG, con los colores del tema: el pin es el acento y la carretera, el color del texto. Sustituye al vídeo `telecab.mp4` (4,9 MB que se bajaban en cada página, hasta tres veces).

```ejs
<%- include('partials/marca', { tam: 'w-10 h-10' }) %>          <%# quieta %>
<%- include('partials/marca', { tam: 'w-24 h-24', anima: true }) %>  <%# la de la carga %>
```

**La carga** (`#cargando-overlay`) usa la marca animada: el pin bota sobre la carretera —se aplasta al tocarla, se estira al subir— mientras el carril corre hacia el horizonte. Ciclo de 1,4 s, solo `transform`, `opacity` y el desplazamiento del trazo (nada que recoloque la página), y quieta para quien pide menos movimiento. Al ser CSS sigue al tema de cada usuario, cosa que un vídeo no puede.

> [!note] Por qué no HyperFrames
> Se pidió «con hyper motion». HyperFrames genera un **MP4**: habría sido otro vídeo, con un render de pago, y con los colores fijos, así que no podría seguir al tema. La animación en CSS pesa unos pocos KB y cumple las dos cosas.

## Los gráficos

El script del final de `layout-gestion.ejs` fija el estilo de Chart.js para todos: IBM Plex Sans, texto en `--tc-muted`, rejilla en `--tc-border`, barras lisas con la esquina apenas redondeada y el globo con los colores del tema. Sustituye al plugin `barrasDegradadas`. Los colores de serie los sigue poniendo cada gráfico.

## La pantalla de acceso

**Desde el 07/10/2026, una foto a toda la pantalla y el formulario encima.** Camilo trajo una referencia («login así»): la imagen de fondo, un saludo grande a la izquierda y el formulario a la derecha, sobre la foto, con los campos blancos y la etiqueta encima de cada uno. La imagen la hicimos nosotros. Esa misma mañana hubo una versión intermedia: la carretera del logo en perspectiva, con el pin como punto de fuga. Duró unas horas y la sustituyó esta.

- **La imagen va con la sede.** Madrid al anochecer: la sierra de Guadarrama con el sol recién puesto, las Cuatro Torres y una autovía con las estelas de los coches. Barcelona: Collserola con su torre y el Tibidabo, la Sagrada Família, la Torre Glòries, las torres del puerto y el mar con los reflejos. Al cambiar la sede en el formulario, la imagen nueva sube encima de la anterior y aparece en 1,6 s, con un fundido que empieza y acaba despacio. Entra algo desenfocada y un poco más cerca, y se asienta. La anterior se queda entera debajo y solo se retira cuando ya está tapada: si las dos se fundieran a la vez, a mitad del cambio se vería un bajón oscuro. El primer cambio, a 0,7 s y con las dos capas fundiéndose a la vez, Camilo lo vio «muy abrupto». La última sede elegida se aplica antes de pintar (`data-sede` en `<html>`), así que nadie ve primero la otra.
- **Las imágenes salen de código** (`scripts/fondo-acceso/`): `comun.js` (el cielo, la sierra y la ciudad, iguales en las dos), `madrid.js` y `barcelona.js` (lo de cada una), con semilla fija. `generar.js` escribe los SVG y `rasterizar.js` los pinta con Edge y los comprime con Pillow a `public/assets/acceso/<sede>.webp` (unos 100 KB) y `<sede>-1280.webp` (unos 42 KB, para el móvil). Rehacerlas da los mismos bytes.
- **La pantalla va siempre en oscuro**: la foto es de noche. Del tema de cada uno se conserva el acento (el oro, o su azul, su verde…): «claro-azul» se pinta como «azul» y «light» como «dark».
- **El saludo** dice «Hola de nuevo», o «Te damos la bienvenida» a quien crea su primera contraseña. Debajo va el enlace a telecab.es; los iconos de redes de la referencia no, porque no hay cuentas que poner.
- **Un velo sobre la foto**, más oscuro a los lados donde van los textos, para que el blanco se lea sobre cualquier parte de la ciudad. Los edificios conocidos quedan en el hueco entre las dos columnas.
- **Un solo movimiento al cargar**: la foto entra un poco más cerca y se asienta, y los textos aparecen. Con menos movimiento, nada se mueve.
- **Pantallas bajas** (1280 × 593, el portátil al 125 %): todo cabe sin desplazarse. En el móvil, una columna: el saludo corto y el formulario.
- **Cambiar y recuperar la contraseña** usan el mismo formulario (`.form-acceso`, `.entrada`, `.btn-entrar`). Antes eran una tarjeta dentro de otra.

Se probó con una muestra que pinta el layout real con EJS, sin arrancar el ERP. Se vio a 1529 × 729, 1280 × 593 y 375 × 812, en las dos sedes, con el error y en las tres pantallas. También se probó el cambio de sede y que la elección se recuerda al recargar.

## Cómo se probó

Un muestrario renderizado con el layout **real** (`ejs.renderFile` con `tema` por página y `fetch` simulado) en oscuro, claro, claro rosa y azul, la carga en oscuro y claro, el acceso real y la bienvenida de `/inicio`; también en móvil (375 px, sin desbordes). Se midió que la animación corre: el pin sube hasta −9 px y se aplasta al caer, y el carril se desplaza.

Relacionado: [[Reglas de la casa]] · [[Componentes de la casa]] · [[Historial de decisiones]]
