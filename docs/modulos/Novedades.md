---
tags: [modulo, novedades, recorrido, v3]
actualizado: 2026-11-17
---

# Novedades

**La ventana que avisa de cada versión, y un recorrido guiado opcional** (V3, 16/11/2026, rama `v3/rediseno`, db/253). Camilo: *«se avisará en una ventana en prod la actualización de toda la aplicación con las nuevas funciones que traerá y lo que ya trae»*, y *«una especie de tutorial opcional»*.

## Qué ve cada uno

- **Una vez por persona y versión**, al entrar en cualquier pantalla de gestión, sale la ventana. Espera a que la pantalla esté quieta: sin la carga, sin un diálogo ni una ficha abierta.
- **Dos pestañas:**
  - **Lo nuevo**: las novedades de la versión, cada una con su icono, su explicación y, si la tiene, un enlace («Abrir mi tablero», «Elegir mi tema»). Las que son de una pantalla que no puede abrir (Organización, Parámetros) no le salen.
  - **Lo que ya tienes**: las pantallas de **su menú**, por departamento, con una línea de qué es cada una. Sale del menú que ya se ha pintado con sus permisos, así que nunca enseña algo que no puede abrir.
- **«Hacer el recorrido»** o **«Ahora no»**. Cerrarla de cualquier forma (la X, Escape, «Ahora no» o pulsar un enlace de dentro) la da por vista.
- **«Novedades»**, en el pie del menú, la vuelve a abrir cuando se quiera, con un puntito mientras está sin ver.
- **El título es «Novedades Telecab»** (Camilo, 17/11/2026: «que no diga Telecab se ha puesto al día; que solo diga Novedades Telecab y ya»).

## El recorrido

Un paseo de un minuto por lo que está siempre a mano: el menú, el tablero, los tickets de la barra, fichar, la campana, la sesión, Configuración y Novedades. Ilumina cada parte, oscurece el resto y lo explica al lado.

- **Se adapta solo**: un paso cuyo elemento no está o no se ve (sin tickets en la barra, sin fichaje, el menú escondido en el móvil) se salta. En el móvil, el paso del menú ilumina el botón que lo abre.
- **Con el menú plegado**, lo despliega mientras ilumina algo suyo.
- **Teclado**: → o Intro sigue, ← vuelve, Escape lo deja; el foco no sale del globo y vuelve a su sitio al acabar.
- Queda apuntado si se hizo entero (`hecho`) o se dejó (`saltado`). Un «hecho» no se pisa con un «saltado» posterior.

## El recorrido de una pantalla, la primera vez que se entra (17/11/2026)

Camilo: *«un recorrido del chat por primera vez para que sepan cómo es el flujo de creación de tareas, y también un recorrido por el tablero de tareas»*. Sale **solo, una vez por persona** (en cualquier dispositivo), la primera vez que entra en esa pantalla, cuando está quieta: después de la ventana de novedades y sin un diálogo ni una ficha abierta. Dejarlo con Escape también cuenta: no vuelve a salir solo. Cada pantalla tiene un botón con la ruta (`fa-route`) para repetirlo.

- **[[Chat]]**: los canales y los directos, escribir (menciones y ficheros), la barra de cada mensaje y **el flujo de una tarea**: convertir el mensaje, quién la aprueba, el sello en el mensaje y la respuesta en el hilo al cerrarla. Con un mensaje en pantalla ilumina su barra; sin él (los chats arrancan vacíos) o en el móvil, esos pasos salen en el centro.
- **[[Tablero de tareas]]**: las vistas, «Nueva tarea», las columnas (por aprobar, por hacer y en curso, bloqueada, cerrada), el semáforo del plazo y lo que se cierra solo.

Desde una pantalla:

```js
Novedades.primeraVez('chat', () => [{ sel, icono, titulo, texto, antes }, …]);   // los pasos se miran al empezar
Novedades.recorridoDe('chat', pasos);                                           // el botón de repetirlo
```

Va en la misma tabla, con la «versión» `recorrido-<pantalla>`, y las pantallas que lo tienen están en `PANTALLAS` (`novedades.service.js`): una nueva se añade allí.

## Para la versión siguiente

1. En `public/assets/js/novedades.js`, añadir **arriba** su entrada en `VERSIONES` (título, sello, bajada y la lista de novedades: icono, tono, título, texto, enlace y `solo` si es de una pantalla con permiso).
2. En `modules/Novedades/novedades.service.js`, cambiar `ACTUAL`.
3. Si hay pantallas nuevas en el menú, su línea en `DESCRIPCIONES`.

## Piezas globales

- **`Recorrido.empezar(pasos, { alAcabar })`** (`public/assets/js/recorrido.js`): cualquier pantalla puede tener su propio recorrido. Cada paso lleva `sel` (uno o varios selectores; vale el primero que se vea), `titulo`, `texto`, `icono` y `antes(el)`. Un paso sin `sel` sale en el centro. Ver [[Componentes de la casa]].
- Las clases `.tc-novedades*` y `.tc-recorrido*`, en `telecab.css`, con los tokens.

## La tabla (db/253)

`novedad_vista (usuario_id, version, vista_at, recorrido, recorrido_at)`: quién vio cada versión y cómo acabó su recorrido. `novedades.cuentas(version)` dice cuántos la vieron y cuántos hicieron el recorrido. Este navegador recuerda además la última vista (`localStorage`), para no preguntar al servidor en cada pantalla.

## La API

```
GET  /novedades/api/estado   → { version, pendiente, recorrido }
POST /novedades/api/visto    { version, recorrido? }
GET  /novedades/api/pantalla/:p    → { pantalla, visto, recorrido }   (chat, tablero)
POST /novedades/api/pantalla/:p    { como: 'hecho' | 'saltado' }
```

De todos los que tienen sesión, como `/contadores`: no está en el catálogo de permisos y cada uno marca lo suyo.

## Ficheros

```
db/253-novedades.sql                    la tabla
modules/Novedades/novedades.service.js  la versión de ahora, quién la vio
modules/Novedades/novedades.controller.js
public/assets/js/novedades.js           la ventana, lo que dice cada versión, el recorrido de la V3
public/assets/js/recorrido.js           el recorrido guiado (pieza global)
test/novedades.test.js                  3 pruebas
```

Relacionado: [[Identidad visual]] · [[Componentes de la casa]]
