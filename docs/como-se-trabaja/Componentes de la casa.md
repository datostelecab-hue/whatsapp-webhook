---
tags: [como-se-trabaja, diseño, componentes, interfaz]
aliases: [Componentes, Diseño de la casa, Componente Listado]
actualizado: 2026-09-21
---

# Componentes de la casa

**Léelo ANTES de escribir una pantalla.** Casi todo lo que hace falta ya existe, y lo que se escribe a mano cuando había pieza se nota: se ve de otra aplicación.

> [!danger] La regla, en una línea
> Si el navegador trae una versión de algo —`prompt`, `alert`, `confirm`, `<input type="date">`, `<select>`— **la casa tiene la suya y es la que se usa**. La del navegador se pinta con los colores del sistema operativo: fondo blanco, azul de Windows, y en una pantalla oscura canta.

## El inventario

| Lo que necesitas | La pieza | NO uses |
|---|---|---|
| Avisar de algo | `Dialogo.aviso({titulo, texto\|html, tono, ancho})` | `alert()` |
| Preguntar sí/no | `Dialogo.confirmar({titulo, texto, textoBoton, tono})` | `confirm()` |
| Elegir de una lista | `Dialogo.elegir({titulo, texto, opciones})` | `prompt()` con números |
| Pedir varios datos | `Dialogo.formulario(titulo, campos, opciones)` | `prompt()` encadenados |
| Confirmación breve | `Dialogo.hecho(texto, {tono, segundos})` | — |
| **Una fecha** | `<input class="js-fecha">` | **`<input type="date">`** |
| Listar cosas | el componente **Listado** (`listado.js`) | una tabla nueva |
| **Explicar un dato** | un **`title`** en el elemento (lo pinta `ayuda.js`) | un icono de «?» propio |
| Tapar mientras carga | `#cargando-overlay` de `layout-gestion` | un spinner propio |
| Un color | los tokens (`text-telecab-gold`, `bg-telecab-red/15`) | un hex a pelo |

Todo se carga solo desde `views/layout-gestion.ejs`: no hay que importar nada.

## El calendario: `js-fecha`

Vive en `layout-gestion.ejs` y engancha **cualquier** `input.js-fecha` de la página, aunque se pinte después. Trabaja en **dd/mm/aaaa**, se puede teclear o elegir, formatea al escribir (mete las barras solo), limpia lo que no es una fecha al salir del campo, y trae «Hoy» y «Borrar».

```html
<input id="f-desde" class="js-fecha w-32 px-3 py-2 bg-telecab-card2 border border-telecab-border rounded-xl text-sm"
       placeholder="dd/mm/aaaa" readonly>
```

Al elegir un día dispara **`input` y `change`**, así que cualquiera de los dos vale para enterarse.

> [!warning] Trabaja en dd/mm/aaaa, y la base en ISO
> Convierte tú en el borde: `dd/mm/aaaa → aaaa-mm-dd` al mandar, y al revés al rellenar. En `Dialogo.formulario`, el campo `tipo: 'fecha'` **ya devuelve ISO** — pero hay que **darle** dd/mm/aaaa en `valor`, o la casilla enseña el formato de la base. → [[Fechas sin toISOString]]

## `Dialogo.formulario`

Una ventana para pedir unos datos, en vez de repetir el mismo modal seis veces. Los campos:

```js
{ id, etiqueta, tipo, valor, ayuda, grupo, obligatorio, marcador, opciones }
```

`tipo` puede ser `texto`, `texto-largo`, `fecha`, `semana`, `lista` u `opciones`.

- **`opciones` es el selector de la casa** y `lista` es el mismo por fuera; lo que cambia es lo que devuelven. Con muchas opciones acepta `buscador: { marcador, tope }`: pinta un filtro, enseña `tope` (10 por defecto) y dice cuántas quedan fuera. Con `grupos` pinta dos niveles.
- `grupo` mete una cabecera cuando cambia: con treinta campos seguidos no se distingue la dirección de la Seguridad Social.
- `ancho` (`max-w-md` por defecto) y `columnas: 2`.
- Devuelve los valores, o **`null` si se cancela** — compruébalo siempre.

**Un formulario no se cierra por un clic fuera**: tiene X, botón de cancelar y Escape. Perder lo escrito por rozar el fondo pasó de verdad. → [[Reglas de la casa]]

## El Listado

Lista → ficha → atrás, con buscador, filtros, KPIs, paginación, selección múltiple y exportar a Excel. **Toda pantalla que liste algo lo usa.**

Lo que hay que saber al filtrar: `visibles()` es un **`.filter()` puro** sobre las filas tal como llegan. No ordena, y el buscador tampoco ordena por relevancia — así que **el orden lo pone la consulta**, una vez, y vale bajo cualquier filtro. → [[Conductores]]

## El diálogo largo cabe en la pantalla

La caja se capa al **90 % del alto**, es una columna, y lo que lleva la barra de desplazamiento es el **contenido** — los botones se quedan abajo, siempre visibles.

> [!warning] Un diálogo sin tope se sale por abajo
> Pasó con el historial de llamadas de una persona: diecisiete entradas, la caja crecía por debajo del borde y el botón de «Entendido» quedaba fuera. **Había que alejar el navegador al 75 % para poder cerrarlo.** Un aviso que obliga a cambiar el zoom no es un aviso.
>
> El `min-h-0` del contenido hace falta: sin él, un hijo de un flex no se deja encoger por debajo de su contenido y la barra no aparece nunca.

## Las ayudas: escribir un `title` y ya está

Pasar el cursor por encima y que el sistema te cuente qué es ese número **es la parte del ERP que más se usa sin darse cuenta**. Quien lleva dos días aquí no sabe qué son «16,7 km fuera» ni por qué el 11 % está en rojo, y no va a preguntar por cada celda.

`public/assets/js/ayuda.js` **se queda con el `title`** de cualquier elemento y lo pinta con la cara de la casa: tokens del tema, aparición y desvanecimiento, y el pico apuntando al dato. Por eso valió para todo el sistema el día que se desplegó —**227 `title=` repartidos por 36 pantallas**— sin tocar ni una vista.

> [!tip] Poner una ayuda nueva es poner un `title`
> No hay API que aprender ni componente que montar. Los **saltos de línea** del `title` se respetan (`&#10;` en el HTML, `\n` en JavaScript), y son lo que permite la forma que mejor funciona aquí: **una frase que dice qué es, y otra que dice qué hacer con eso**.
>
> ```html
> <p title="Km rodados FUERA de BOLT en toda su jornada. No cuentan como trabajo.&#10;De ellos, 16,7 km desde las 08:00, que es lo que hay que preguntar.">16,7 km</p>
> ```

Lo que hace por su cuenta: se coloca **debajo si cabe y encima si no**, se recorta contra los bordes sin salirse, responde al **tabulador** igual que al ratón, se cierra con Escape o al hacer clic, y **no se activa sin ratón** — en un móvil el primer toque abriría el globo en vez de pulsar el botón.

**Se puede apagar**, y la decisión es de cada uno: `usuario.ayudas` (db/143), en Configuración → Apariencia. Viaja en el perfil como el tema, no en el navegador: quien las apaga en la oficina no se las vuelve a encontrar en casa. Apagadas, vuelven los globos del navegador de siempre. **Nace encendida**: quien no sepa que la opción existe se queda con la ayuda, no sin ella.

> [!warning] El `title` se roba y se devuelve
> Si el atributo se queda puesto, el navegador pinta **además** su propio globo al segundo y medio: dos cajas con el mismo texto, una con los colores de Windows. Se mueve a `data-ayuda` al entrar y **se devuelve siempre** al salir.

> [!warning] `requestAnimationFrame` no llega si la pestaña no pinta
> La primera versión esperaba un fotograma para que arrancara la transición. Con la ventana tapada por otra, ese fotograma **no llega** y el globo se quedaba puesto pero invisible para siempre. Se fuerza el reflujo leyendo `offsetHeight` y se enciende en la misma vuelta: no depende de que nadie pinte nada.

### Dónde merece la pena poner una

Medido el 21/09/2026. Donde más hay es donde más números raros hay, que es justo la señal:

| Pantalla | ayudas |
|---|---|
| Control · En directo | 51 |
| Recaudación | 20 |
| Planificador V2 | 18 |
| Bitácora · Plantilla | 13 cada una |
| Nóminas | 12 |

Y **17 pantallas no tienen ninguna**. Las que más lo piden, por orden: **Coches sin cuadrante** (las cuatro listas necesitan decir por qué son cuatro), **Vehículos**, **Operaciones**, **Selección**, **ETT**, **RRHH pendientes** e **Inicio** — que es la primera que ve quien acaba de entrar.

**La regla para lo que venga:** cuando una pantalla enseñe un número que no se explique solo —un porcentaje, un color, una cifra recortada por una ventana de tiempo— lleva su `title`. Una frase de qué es, y otra de qué hacer.

## Los colores

Ninguna vista lleva color propio: todo son **tokens** (`--tc-gold`, `--tc-card`…) escritos como canales RGB para que Tailwind pueda darles opacidad. Los colores crudos de Tailwind están **remapeados**: `text-red-500` ES el rojo de la marca. Tailwind viene por CDN y pinta después de la hoja propia, así que los ajustes se escriben con especificidad subida (`body .clase`). → [[Reglas de la casa]], regla 7.

## Cuando falte algo

Si necesitas una pieza que no está, **hazla en el sitio compartido** (`public/assets/js/`, o `layout-gestion.ejs` si tiene que engancharse sola) y **apúntala aquí**. Una pieza que solo existe dentro de una vista es una pieza que la siguiente pantalla volverá a escribir de otra manera.

Relacionado: [[Reglas de la casa]] · [[Fechas sin toISOString]] · [[Trampas conocidas]]
