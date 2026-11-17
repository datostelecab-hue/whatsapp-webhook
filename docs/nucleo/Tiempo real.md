---
tags: [nucleo, tiempo-real, sse, hoja-de-ruta]
actualizado: 2026-11-16
---

# Tiempo real

Desde el 16/11/2026 el servidor **avisa a las pantallas abiertas** en cuanto algo cambia. Antes cada pantalla preguntaba cada pocos segundos (de 3 s a 5 min) si había algo nuevo. Es la pieza A7 de la [[Hoja de ruta]]. Lo usarán el tablero de tareas, el chat, los contadores del menú (A9) y lo que haga falta.

Va por **Server-Sent Events**: la pantalla deja abierta una petición (`GET /tiempo-real/eventos`) y el servidor escribe por ella. Una sola conexión por pestaña para todos los canales.

## Cómo se usa desde un módulo

```js
// 1. El módulo abre su canal UNA vez (al cargarse) y dice quién lo oye:
const tiempoReal = require('../../services/tiempoReal');
tiempoReal.registrarCanal('tickets', {
  etiqueta: 'Tickets',
  puede: async quien => …,            // quien = { id, rol }; ante la duda, no
});

// 2. Cuando algo cambia, lo avisa: a todos los que oyen el canal, o solo a unos.
tiempoReal.publicar('tickets', { id: 42, que: 'nuevo' });
tiempoReal.publicar('tickets', { id: 42 }, { para: [7, 19] });   // ids de usuario
```

```js
// 3. La pantalla (tiempoReal.js lo carga layout-gestion en todas):
const oido = TiempoReal.escuchar('tickets', {
  alLlegar: (datos, aviso) => recargar(),   // cada aviso del canal
  sondear: recargar,                         // cómo ponerse al día sin tiempo real
  cada: 30000,                               // y cada cuánto, si no lo hay
  alConectar: recargar,                      // opcional: al conectar la primera vez
});
oido.dejar();
```

- **El aviso dice qué cambió, no los datos:** «el ticket 42 es nuevo», y la pantalla los pide a su API, que mira el permiso como siempre. Por eso el aviso no puede pasar de 16 KB.
- **El permiso es del canal:** `puede` se pregunta al conectar y cada dos minutos. Quien lo pierde deja de oír ese canal. `/tiempo-real` no está en el catálogo de permisos: entra cualquiera con sesión, y cada canal decide.
- **`sondear` es obligatorio en la práctica:** es lo que se usa cuando no hay directo (en local, con la conexión caída, con el servidor lleno) y cuando se han perdido avisos. Con él, la pantalla funciona igual sin tiempo real, solo que más lenta.
- **Escuchar antes de cargar.** Si la pantalla carga sus datos y después escucha, lo que pase entre medias no llega. Si importa, `alConectar: recargar`.

## Lo que hace solo

| Pasa | Qué hace |
|---|---|
| Se corta (wifi, el móvil se duerme) | El navegador vuelve solo en 3-7 s (distinto para cada uno, para que no vuelvan todos a la vez) y dice el último aviso que vio. El servidor le manda lo que se perdió, en orden |
| Más de 10 minutos fuera, o el servidor se ha reiniciado (un despliegue) | Lo perdido ya no está: se le manda «reinicio» y la pantalla llama a `sondear` una vez. El id de cada aviso lleva la marca del proceso, así que uno de antes de reiniciar no se confunde |
| No vuelve en 30 s, o el servidor no lo deja | Pasa a **sondeo**: `sondear` cada `cada` ms (con la pestaña oculta, no; al volver a ella, una vez) y prueba el directo cada minuto |
| La sesión se cierra (cerrar la del móvil, bloquear a alguien, caducar) | Se mira cada dos minutos, igual que en cada petición (`sesion.sesionVigente`). Se corta con «fin» y la pantalla comprueba la sesión: con un 401, Api lleva al login |
| Más de 12 pestañas de la misma persona | Se cierra la más vieja, que pasa a sondeo |
| Un navegador que no lee (más de 1 MB sin salir) | Se corta; al volver, retoma |
| Más de 1000 conexiones en el servidor | La nueva va por sondeo |

**El latido:** cada 25 s sale un comentario (`: latido`) que el navegador no ve. Cloudflare corta una conexión a los 100 s sin un byte.

**Sin comprimir:** la respuesta lleva `Cache-Control: no-cache, no-transform`. La compresión de `app.js` no la toca y por eso no retiene los avisos hasta llenar su búfer. Lo vigila una prueba.

## En local va por sondeo

En `http://erptelecab.localhost:3100` la conexión es HTTP/1.1, y el navegador solo abre **seis conexiones por servidor**: seis pestañas con el tiempo real abierto dejarían sin sitio al resto de peticiones. Por eso, con HTTP/1.1, `TiempoReal` va por sondeo. En producción, detrás de Cloudflare, es HTTP/2 o HTTP/3, sin ese límite. Lo decide `performance.getEntriesByType('navigation')[0].nextHopProtocol`.

`TiempoReal.forzarDirecto()` abre el directo igual: lo usa el banco.

## El banco

*Sistema → Banco de tiempo real*, solo para el desarrollador. Abre el directo (también en local) por el canal `prueba` y enseña:
- el estado de la conexión;
- cuántas hay abiertas, por canal;
- los avisos guardados y la marca de este servidor (si cambia, se ha reiniciado).

Tiene tres botones:
- **Mandarme un aviso**, que dice cuánto tarda en llegar (14 ms en local);
- **Cortar, mandar 3 y volver**, en el que tienen que llegar los tres al volver;
- **Volver a conectar**.

## Una sola instancia

Los avisos van por un bus **en memoria**, que es lo que hay hoy en Render (una instancia). Si algún día hay más de una, un aviso publicado en una no llegaría a las conexiones de la otra: habría que pasarlos por la base con `LISTEN/NOTIFY` (y que el id fuera común). `publicar` es la única puerta, así que el cambio se queda en `services/tiempoReal.js`.

## Ficheros

```
services/tiempoReal.js                       los canales, publicar, lo guardado, las conexiones, el latido
modules/TiempoReal/tiempoReal.controller.js  /tiempo-real: la conexión, el estado y el banco
modules/TiempoReal/vistas/tiempoRealBanco.ejs
public/assets/js/tiempoReal.js               el componente (TiempoReal.escuchar), en layout-gestion
public/assets/js/vistas/TiempoReal/banco.js
services/sesion.js                           sesionVigente: la sesión de una conexión que dura horas
test/tiempoReal.test.js                      10 pruebas, sin base
```

## Pendiente

- Los primeros que lo usen: los contadores del menú (A9), el tablero de tareas (ítem 1) y el chat.
- Pasar a tiempo real los sondeos que ya hay (la campana, el chat de WhatsApp, Control en directo) al tocar cada uno.
