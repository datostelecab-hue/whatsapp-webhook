---
tags: [como-se-trabaja, diseño, interfaz, identidad]
aliases: [Diseño corporativo, Tokens de color, La marca, Telecab V3]
actualizado: 2026-11-16
---

# Identidad visual

**Desde el 16/11/2026 la casa es la V3.** Camilo trajo tres paneles de referencia (uno oscuro en azul marino, dos claros y limpios) y una pantalla de acceso, y lo dijo así: *«tal cual así quiero que se vea el sistema… algo con más vida, los colores que hay ahora están muy apagados»*. Sustituye a la corporativa del 27/09 (un solo acento oro, grafito, IBM Plex Sans), que a su vez sustituyó a la del 05/09 (cristal y resplandor ámbar).

Todo vive en **`public/assets/css/telecab.css`** y en la configuración de Tailwind, **`tailwind.config.js`**, que comparten la gestión y el acceso. Las vistas no llevan color propio → [[Reglas de la casa]], regla 7. **La V3 se hizo sin tocar las pantallas**: cambiaron los tokens, las reglas globales, el menú y la barra del layout, y las piezas `.tc-*`.

## Las cuatro reglas

1. **Azul sobre azul marino.** En oscuro, la página es azul noche y las tarjetas un punto más claras; en claro, página gris muy claro y tarjetas blancas. El acento es un **azul vivo**.
2. **Los estados, con su color entero.** Verde, rojo, ámbar y violeta salen saturados: una pastilla se tiene que ver de lejos. El ámbar sigue siendo aviso, no acento.
3. **Formas amables.** Esquinas de 12–16 px (las de Tailwind, ya sin encoger), pastillas redondas, el botón principal con una sombra de su color y el elegido del menú **relleno** (en claro, teñido).
4. **La tipografía: Plus Jakarta Sans**, con las cifras grandes en negrita (800) y tabulares en las tablas.

Lo que **se mantiene** de antes: sin cristal (`backdrop-filter` apagado), el fondo liso, sin emojis, y un solo acento por tema.

## Los tokens

Canales RGB (`"59 130 246"`) para que Tailwind pueda darles opacidad (`bg-telecab-gold/15`).

> [!important] `--tc-gold` ya no es oro: es «el acento»
> El nombre no se cambió porque lo usan cientos de clases en las vistas (`text-telecab-gold`, `bg-telecab-gold/15`…). Hoy vale azul. Quien quiera el oro del logo tiene el tema **Dorado**.

| Token | Para qué | Oscuro | Claro |
|---|---|---|---|
| `--tc-dark` | fondo de la página | `#080C18` | `#F3F5F9` |
| `--tc-card` | tarjetas | `#0F1628` | `#FFFFFF` |
| `--tc-card2` | superficie elevada / hover | `#17213A` | `#F1F4F9` |
| `--tc-border` | la línea fina | `#24304E` | `#E2E7F0` |
| `--tc-campo` | el interior de un campo | `#0A0F1E` | `#FFFFFF` |
| `--tc-menu` | **(V3)** el menú lateral y la barra de arriba | `#0B101F` | `#FFFFFF` |
| `--tc-gold` | **el acento** (texto, filos, tintes) | `#3B82F6` | `#2563EB` |
| `--tc-boton` / `--tc-boton-hover` | **(V3)** el relleno del botón principal: más hondo que el acento, para que el texto blanco se lea | `#2563EB` / `#1D4ED8` | `#2563EB` / `#1D4ED8` |
| `--tc-on-gold` | el texto sobre el acento | blanco | blanco |
| `--tc-azul` | informativo (celeste, distinto del acento) | `#38BDF8` | `#0284C7` |
| `--tc-green` / `--tc-red` / `--tc-warn` / `--tc-violet` | estados | `#22C55E` `#EF4444` `#F59E0B` `#A78BFA` | `#04875F` `#DC2626` `#C25906` `#7C3AED` |
| `--tc-sombra` / `--tc-sombra-alta` | sombra de tarjeta / de lo que flota | | |

En Tailwind hay además `bg-telecab-boton`, `bg-telecab-boton-hover` y `bg-telecab-menu`.

**Los temas** (`data-theme`, lo elige cada uno en Configuración) **comparten las superficies y cambian solo el acento**, ahora con colores enteros: celeste (la clave sigue siendo `azul`), verde, púrpura, rosa, cian, naranja y **dorado** (`oro`, nuevo: el acento de antes de la V3) en oscuro; celeste, verde, rosa, púrpura y naranja en claro (`claro-*`); y alto contraste aparte. Cada uno define su acento, su versión suave y honda y el relleno de su botón. Las muestras del selector (`public/assets/js/vistas/configuracion/tema.js`) copian estos valores: si cambia un token, cambia también la muestra.

`--tc-halo*`, `--tc-card-a` y `--tc-brillo` son de diseños anteriores: siguen definidos (alguna vista los lee) pero ya no pintan nada.

## El menú y la barra

- **El menú** va sobre `--tc-menu`. El elegido, en oscuro, **relleno** del color del botón con el texto y el icono en blanco y una sombra de su color; en claro, teñido del acento con el texto en el acento.
- **La barra de arriba**, la misma superficie. A la derecha, **el avatar** de quien tiene la sesión (`.tc-avatar`, sus iniciales sobre el acento), su nombre y su rol.

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

El script del final de `layout-gestion.ejs` fija el estilo de Chart.js para todos: Plus Jakarta Sans (V3), texto en `--tc-muted`, rejilla en `--tc-border`, barras lisas con la esquina apenas redondeada y el globo con los colores del tema. Sustituye al plugin `barrasDegradadas`. Los colores de serie los sigue poniendo cada gráfico.

**Desde el 25/10/2026, las piezas de un gráfico son de la casa** (`public/assets/js/graficos.js`, ver [[Componentes de la casa#Los gráficos: `graficos.js`]]), hechas con la skill de visualización: **un acento** para lo que importa y **gris** para el contexto (el mes anterior), **tinta** para una media; la raya **discontinua** solo para un objetivo o una previsión; el rojo y el verde, solo cuando el dato **es** un estado (por delante o por detrás, la zona crítica), y siempre con su flecha o su etiqueta; **nunca dos ejes Y**; barras de 24 px como mucho con la punta redondeada y la base recta; leyenda siempre y una tabla gemela de cada gráfico; un dato que no se puede comparar (un mes con menos de 7 días con datos) va en el **gris** del contexto y lo dice en el eje («pocos días»), no con el acento como si pesara lo mismo. Lo estrenó [[Visibilidad]].

## La pantalla de acceso

**Desde el 16/11/2026 (V3), la pantalla partida en dos**, como la referencia que trajo Camilo:

- **A la izquierda, la foto**: un **Toyota Corolla** —el coche de la flota— en una calle, **de noche y en el azul de la casa**. Encima, la marca, el lema («Toda la flota, en un solo sitio»; a quien crea su primera contraseña, la bienvenida) y, abajo, cuatro cosas que se hacen dentro, cada una con su icono en un cuadro de color.
- **A la derecha, el formulario en su tarjeta**, sobre el azul noche: campos oscuros con su icono (el sobre, el candado), la etiqueta encima, la sede en dos botones, la casilla de la sesión con «¿Olvidaste tu contraseña?» al lado, y el botón del acento a todo el ancho. Al pie, «Conexión cifrada» y el año.
- **La foto la eligió Camilo**: es de la web de Toyota (la serie del Corolla Hybrid en ciudad). La original no está en el repositorio; **el resultado sí, desde el 17/11/2026** (lo decidió Camilo, «sube la nueva imagen del login»). `scripts/fondo-acceso/portada-corolla.py <foto>` la **recorta** por la izquierda de una persona que cruzaba (no sale nadie), la **pasa a noche** (baja la exposición, enfría el color, deja las luces del coche) y escribe `public/assets/acceso/portada.webp` (150 KB) y `portada-900.webp` (68 KB, el móvil). **Si esos ficheros no están en un servidor, se ve debajo la ciudad de siempre** (`madrid.webp`): un fondo que falla deja ver el siguiente.
- **Siempre en oscuro**; de cada tema se conserva el acento («claro-azul» se pinta como «azul» y «light» como «dark»).
- **Un solo movimiento al cargar**: la foto se asienta y los textos aparecen. Con menos movimiento, nada se mueve.
- **Pantallas bajas** (1280 × 593): se aprietan los márgenes y los campos para que quepa sin desplazarse. **En el móvil**, una columna: la foto es una franja arriba con la marca y el lema, y la tarjeta sube sobre ella.
- **Cambiar y recuperar la contraseña** usan el mismo formulario (`.form-acceso`, `.entrada`, `.btn-entrar`) y salen en la misma tarjeta.
- **La sede** ya no cambia la foto (hasta la V3 había una ciudad por sede); se sigue recordando la última elegida.

> [!note] Lo de antes (07/10/2026)
> Una imagen a toda la pantalla, hecha por nosotros en SVG (`scripts/fondo-acceso/`: Madrid o Barcelona al anochecer, según la sede), con el saludo a la izquierda y el formulario encima de la foto, con campos blancos. Las imágenes siguen en `public/assets/acceso/` como respaldo de la portada.

## Cómo se probó

**La V3 (16/11/2026) la prueba Camilo en su local**: lo pidió así («yo seré el que testee»). Se comprobó solo que Tailwind compila, que los layouts y las tres pantallas de acceso se pintan sin error y que pasan las comprobaciones de instalación; **no** se miró en el navegador.

Lo de la corporativa del 27/09: un muestrario renderizado con el layout **real** (`ejs.renderFile` con `tema` por página y `fetch` simulado) en oscuro, claro, claro rosa y azul, la carga en oscuro y claro, el acceso real y la bienvenida de `/inicio`; también en móvil (375 px, sin desbordes). Se midió que la animación corre: el pin sube hasta −9 px y se aplasta al caer, y el carril se desplaza.

Relacionado: [[Reglas de la casa]] · [[Componentes de la casa]] · [[Historial de decisiones]]
