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
| **Elegir una opción en un formulario propio** | `.tc-selector` + input oculto (`selector.js`) | **`<select>`** |
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
> Convierte tú en el borde: `dd/mm/aaaa → aaaa-mm-dd` al mandar, y al revés al rellenar. En `Dialogo.formulario`, el campo `tipo: 'fecha'` **ya devuelve ISO** — pero hay que **darle** dd/mm/aaaa en `valor`, o la casilla enseña el formato de la base. → [[Trampas conocidas|Fechas sin toISOString]]

## `Dialogo.formulario`

Una ventana para pedir unos datos, en vez de repetir el mismo modal seis veces. Los campos:

```js
{ id, etiqueta, tipo, valor, ayuda, grupo, obligatorio, marcador, opciones }
```

`tipo` puede ser `texto`, `texto-largo`, `fecha`, `semana`, `lista` u `opciones`.

- **`opciones` es el selector de la casa** y `lista` es el mismo por fuera; lo que cambia es lo que devuelven (abajo). Los dos aceptan `buscador: { marcador, tope }`: pinta un filtro, enseña `tope` (10 por defecto) y dice cuántas quedan fuera. Con `grupos` pinta dos niveles.
- `grupo` mete una cabecera cuando cambia: con treinta campos seguidos no se distingue la dirección de la Seguridad Social.
- `ancho` (`max-w-md` por defecto) y `columnas: 2`.
- Devuelve los valores, o **`null` si se cancela** — compruébalo siempre.

**Un formulario no se cierra por un clic fuera**: tiene X, botón de cancelar y Escape. Perder lo escrito por rozar el fondo pasó de verdad. → [[Reglas de la casa]]

> [!danger] `lista` y `opciones` se ven IGUAL y devuelven cosas distintas
> - **`lista`** devuelve el valor **a secas**, como el `<select>` de siempre. Es lo que usan las treinta y tantas pantallas que ya existían, y por eso no hubo que tocar ninguna.
> - **`opciones`** devuelve un **objeto**: `{ valor, grupo, texto }`. Hay que sacar el `.valor` a mano.
>
> Como se pintan idénticos, elegir mal no se ve en pantalla: se ve en el servidor, que recibe `"[object Object]"`. Le pasó a la **ticketera entera** —aplicar, enlazar, resolver y mover, las cuatro— y el error que daba (`Ese estado no es una ausencia`) no señalaba a ningún sitio: era el propio valor que el ticket proponía.
>
> **Elige `lista` salvo que necesites el `grupo` o el `texto`.** Y si escribes la puerta del servidor, desenvuelve por si acaso: `const codigo = x && typeof x === 'object' ? x.valor : x`.
>
> → [[Trampas conocidas]]

> [!tip] Un campo alto puede ocupar varias filas: `filas`
> En un formulario de dos columnas, una lista de opciones en vertical deja un
> hueco en blanco a su lado. Con `filas: 3` el campo ocupa tres filas de la
> rejilla y los siguientes **se apilan a su lado**. Solo aplica con
> `columnas: 2`. Lo usa el sexo en el formulario de Datos de Selección.

## El selector suelto: `.tc-selector`

`Dialogo.formulario` ya traía su selector, pero vivía **dentro** del diálogo y no había forma de usarlo en un formulario montado a mano —que es lo que tienen varias pantallas—. `selector.js` es esa misma idea, suelta.

```html
<input type="hidden" id="fm-sede" value="madrid">
<div class="tc-selector" data-para="fm-sede">
  <button type="button" data-v="madrid">Madrid</button>
  <button type="button" data-v="barcelona">Barcelona</button>
</div>
```

> [!tip] El valor vive en el input oculto, y ese es el truco
> El formulario sigue leyendo y escribiendo `campo('sede').value` como si fuera un `<select>` de toda la vida. **Cambiar el aspecto no obligó a tocar la lógica de nadie**: en Vehículos, los dos `<select>` que había se cambiaron sin tocar ni el envío ni la validación.

Al elegir dispara **`input` y `change`** sobre el input, como el calendario. Va delegado en el documento, así que vale para lo que se pinte después; si rellenas el input desde fuera, llama a `Selector.montar(raiz)` para que repinte. Y se mueve con las flechas del teclado.

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

> [!warning] Moverse a un hijo NO es salir
> `mouseout` salta también al cruzar de un elemento a otro **dentro del mismo**: la celda del calendario lleva el `title` y dentro tiene el número. Sin comprobar `relatedTarget`, pasar el ratón del borde de la celda a la cifra se leía como una salida — se devolvía el `title`, el navegador se ponía a contar y pintaba **su** globo encima. De ahí que al mover el cursor unos centímetros cambiara de aspecto sin salir de la casilla.
>
> Y por lo mismo, ocultar por desplazamiento, Escape o clic **no devuelve** el atributo: el cursor sigue encima, así que devolverlo sería invitar al globo del navegador. Se devuelve cuando se sale de verdad.

> [!warning] `requestAnimationFrame` no llega si la pestaña no pinta
> La primera versión esperaba un fotograma para que arrancara la transición. Con la ventana tapada por otra, ese fotograma **no llega** y el globo se quedaba puesto pero invisible para siempre. Se fuerza el reflujo leyendo `offsetHeight` y se enciende en la misma vuelta: no depende de que nadie pinte nada.

### En el Listado, la ayuda va en la definición

Una columna y una tarjeta de KPI aceptan `ayuda`, y el componente la pinta como `title` en la cabecera o en la tarjeta:

```js
{ titulo: 'DNI / NIE', campo: 'dni_nie',
  ayuda: 'La identidad de la casa: dos fichas con el mismo DNI son la misma persona.' }
```

La cabecera de la columna es donde mejor cae la explicación de un dato, y así la gana de golpe **cualquier** pantalla que use el Listado.

### Cobertura

El **21/09/2026** se pasó de **227 ayudas en 36 pantallas** a **310 en todas las que enseñan datos**. Las que quedan sin ninguna, a propósito:

| Sin ayudas | Por qué |
|---|---|
| Cambiar / recuperar contraseña | Van sobre `layout-auth`, que **no carga `ayuda.js`**. Tres campos y nada que explicar. |
| Sin permiso | Un mensaje y un botón. |
| `layout.ejs`, `layout-auth.ejs` | Son plantillas, no pantallas. |
| Boda | No es del ERP. |

**La regla para lo que venga:** cuando una pantalla enseñe un número que no se explique solo —un porcentaje, un color, una cifra recortada por una ventana de tiempo— lleva su `title`. Una frase de qué es, y otra de qué hacer.

## Los colores

Ninguna vista lleva color propio: todo son **tokens** (`--tc-gold`, `--tc-card`…) escritos como canales RGB para que Tailwind pueda darles opacidad. Los colores crudos de Tailwind están **remapeados**: `text-red-500` ES el rojo de la marca. Tailwind viene por CDN y pinta después de la hoja propia, así que los ajustes se escriben con especificidad subida (`body .clase`). → [[Reglas de la casa]], regla 7.

## Cuando falte algo

Si necesitas una pieza que no está, **hazla en el sitio compartido** (`public/assets/js/`, o `layout-gestion.ejs` si tiene que engancharse sola) y **apúntala aquí**. Una pieza que solo existe dentro de una vista es una pieza que la siguiente pantalla volverá a escribir de otra manera.

Relacionado: [[Reglas de la casa]] · [[Trampas conocidas|Fechas sin toISOString]] · [[Trampas conocidas]]
