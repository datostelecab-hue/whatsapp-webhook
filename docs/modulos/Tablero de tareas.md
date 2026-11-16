---
tags: [modulo, tablero, tareas, hoja-de-ruta, item-1]
actualizado: 2026-11-16
---

# Tablero de tareas

El **lugar único del trabajo pendiente** (ítem 1 de la [[Hoja de ruta]]). Una tarjeta es algo que alguien tiene que hacer: tiene responsable, plazo en días hábiles e historia. Se hace en tres entregas, cada una en su rama:
- **1a — datos y servicio** (16/11/2026, rama `tablero/1a-datos`, db/251): esta nota.
- **1b — pantallas** (16/11/2026, rama `tablero/1b-pantallas`): ver «La pantalla» abajo.
- **1c — las colas:** J, −J, correcciones de fichaje y vacaciones, y el paso de todo lo abierto de una vez.

## Lo que decidieron Camilo e Ignacio (16/11/2026)

1. **Tareas a mano** (y desde el chat, cuando exista): cualquiera la crea, para otra persona o para sí. **Se le notifica a Ignacio y él la aprueba o no**. El plazo empieza a contar al aprobarla.
2. **Tickets: todos.** Cada ticket nuevo crea su tarjeta, y **el plazo y el responsable se ponen a mano**.
3. **El responsable de la tarjeta de un ticket lo pone Ignacio**, que es quien las asigna.
4. **Ninguna tarjeta pide aprobación para cerrarse:** pasa a «cerrada» y ya.
5. **Las colas de hoy pasan de una vez** (entrega 1c).

Y lo propuesto y aceptado:
- los tickets abiertos de antes también pasan en la 1c;
- las bajas médicas no enseñan el nombre en la tarjeta;
- el plazo es obligatorio al asignar;
- aprobar y asignar son **funciones de Organización** (`tareas_aprueba` y `tareas_asigna`, de Ignacio desde db/251), no nombres en el código;
- cada uno ve lo suyo, el responsable de un área ve lo de su área, e Ignacio lo ve todo.

## Las columnas

| Estado | Qué es |
|---|---|
| **Por aprobar** | Una tarea a mano esperando a Ignacio |
| **Por asignar** | La de un ticket, sin responsable ni plazo |
| **Por hacer**, **En curso** | Con responsable y plazo |
| **Bloqueada** | Con lo que la bloquea, obligatorio. Se avisa a quien reparte |
| **Cerrada** | Hecha: en qué quedó y, si pasó el plazo, el **motivo de demora** (obligatorio) |
| *Rechazada*, *Anulada* | Sin columna. Con su motivo |

## Quién puede qué

| Quién | Qué |
|---|---|
| Cualquiera con sesión | Crear una tarea (para otro o para sí) y comentar lo que ve |
| Quien la lleva | Moverla (por hacer, en curso, bloqueada), cerrarla y decidir quién colabora |
| **Quien aprueba** (`tareas_aprueba`) | Aprobar o rechazar las tareas a mano; al aprobar puede cambiar el responsable o el plazo |
| **Quien reparte** (`tareas_asigna`) | Asignar las de los tickets, reasignar (con motivo), cambiar el plazo (con motivo), anular, y todo lo de quien la lleva. Lo ve todo |
| Quien la pidió | Anularla mientras espera aprobación |

**Quién ve qué** (`puedeVer`):
- lo suyo: lo que lleva, lo que creó y donde colabora;
- lo de su gente: si lleva un área o es su superior (`organizacion.equipo`);
- todo: quien tiene `ve_todos_los_tableros` o `tareas_asigna`;
- quien aprueba, además, lo que espera su aprobación.

Lo que no puede ver le da un 404 (no un 403): ni sabe que existe.

## El plazo

- **En días hábiles** con el [[Calendario laboral]] de Madrid (A2): `{ plazoDias: 3 }`, que cuenta desde mañana, o `{ venceEl: 'aaaa-mm-dd' }`. Se guarda la **fecha límite ya calculada** (`vence_el`) y desde cuándo cuenta (`plazo_desde`).
- **El semáforo:** verde mientras queda plazo, amarillo el último día y rojo vencida (`calendario.semaforo`).
- **Al vencer:** la tarea programada `tablero.vencidas` (A10) se lanza cada día hábil a las 09:00 y avisa **al responsable y a su superior** con una notificación urgente al móvil. Avisa una sola vez por tarjeta; si se cambia el plazo, vuelve a poder avisar.

## Los tickets (`modules/Ticketera/tarjetas.js`)

- **Nacen** los tickets abiertos que entran desde que existe el tablero. `config_app.tablero.tickets_desde_id`, que pone db/251, dice desde cuál. Se crean al traer el formulario y al abrir uno de soporte, «por asignar».
- **La tarjeta lleva** el tipo, el nombre de quien lo pide y el código, y enlaza a su bandeja (`?ticket=CÓDIGO`). Las **bajas médicas** (`BAJA_AUSENCIA`) no llevan nombre ni descripción: se miran en el ticket, con sus permisos.
- **Al asignarla**, el ticket queda a cargo de esa persona (`ticketera.asignarA`) y pasa a «en curso».
- **«Me hago cargo» en la bandeja** le pasa la tarjeta a quien lo pulsó, sin plazo; el plazo lo pone Ignacio.
- **Cerrarla en el tablero cierra el ticket**, con las reglas del ticket (en qué quedó, la llave de vacaciones, «aplicar» en las ausencias), y el ticket cerrado cierra la tarjeta. **Cerrar el ticket en su bandeja** también la cierra.

Los enganches van en lo que **exporta** `ticketera.service`: así no se olvidan en ninguna ruta. Y no lanzan nunca, porque el ticket ya está hecho.

## Los avisos

Cada cambio, ya fuera de la transacción:
- llega por el [[Tiempo real]] a los interesados (canal `tablero`);
- mueve sus [[Contadores]] (`tareas.mias`, en rojo si hay vencidas; `tareas.por_aprobar` y `tareas.por_asignar` a quien le tocan);
- manda una [[Notificaciones al dispositivo|notificación]] a quien le importa. Por ejemplo, «Tarea por aprobar» a Ignacio, «Te han asignado una tarea» o «Tarea reasignada» a los dos.

La notificación de una tarjeta sensible no lleva el título.

## Cómo se usa desde un módulo (para la 1c y los ítems que vienen)

```js
const tablero = require('../../services/tablero');
tablero.registrarTipo('j', {
  etiqueta: 'J por aprobar',
  cierreManual: false,     // se cierra sola al aprobarla en su pantalla; la API rechaza el «Hecha» a mano
});
// Nace, dentro de la transacción de quien la crea:
await tablero.nacer(cli, { tipo: 'j', origenId: j.id, titulo: '…', enlace: '/justificantes?j=…' });
// Y su origen la cierra:
await tablero.cerrarPorOrigen(cli, { tipo: 'j', origenId: j.id, autorId, nota: 'Aprobada' });
```

## Las tablas (db/251)

- `tarea`: la tarjeta, que se puede medir para el ítem 22 (fecha límite, cumplimiento, responsable por id, motivo de demora y enlace por id).
- `tarea_colaborador`.
- `tarea_comentario`: se anula, no se borra.
- `tarea_evento`: su historia en palabras del tablero. Un disparador impide cambiarla o borrarla.
- Las tres primeras, bajo el [[Libro de auditoria]].

## La pantalla (`/tablero`, entrega 1b)

**Tablero** en el menú, para todos, como Inicio; qué ve cada uno lo decide el tablero. Su número (`tareas.menu`) suma las tarjetas que lleva y, a quien reparte o aprueba, lo que espera por él. Va en rojo si hay algo vencido o esperando.

Hay cuatro pestañas, y la elegida va en `?vista=`:

| Pestaña | Qué enseña |
|---|---|
| **Mi tablero** | Lo que lleva, lo que pidió y donde colabora, en columnas: por aprobar, por hacer, en curso, bloqueada y cerrada (los últimos 14 días) |
| **Mi equipo** / **Todo el equipo** | Lo mismo con lo de su gente (todo, si reparte o lo ve todo) |
| **Por repartir** | Solo a quien aprueba o reparte: por aprobar y por asignar, con su contador |
| **Lista** | Todas las que ve, en el [[Componentes de la casa\|Listado]]: buscador, filtros (estado, responsable, tipo, plazo), KPIs y Excel |

- **La tarjeta** lleva el título, el tipo, el semáforo («Quedan 3 días», «Vence hoy», «Vencida (14/11)»), los comentarios, quién colabora y las iniciales de quien la lleva. Las de datos sensibles, con un candado.
- **Arrastrar** entre por hacer, en curso y bloqueada la mueve; a cerrada, la cierra. Bloquear pide el motivo; cerrar pide en qué quedó, cómo queda el ticket y, si venció, por qué se cierra tarde. Las columnas donde no se puede soltar se apagan. Arrastrar es un atajo: con el teclado o en el móvil, la ficha tiene **«Mover a…»**.
- **La ficha se abre al lado** (Panel) al pulsar la tarjeta, también con `?tarjeta=ID`, que es el enlace de las notificaciones. Lleva:
  - los botones de lo que puede hacer (los dice el servidor en `puede`);
  - los datos y el origen («Abrir el ticket»);
  - quién colabora, los comentarios y la historia.
- **Nueva tarea:** qué hay que hacer, el detalle, quién la hace y el plazo (en días hábiles o una fecha). Si la crea quien aprueba, empieza ya; si no, le llega a él.
- **Se actualiza sola** por el [[Tiempo real]] (canal `tablero`): el tablero y la ficha abierta. Sin directo, cada minuto.
- **Una lectura vieja no pinta encima de un cambio:** se vio al probarlo. Unas lecturas de la ficha pedidas antes de asignar llegaban después y la dejaban en «Por asignar». Cada lectura lleva su turno, y una recarga pedida mientras otra está en marcha se repite al acabar.

Todo con las **piezas globales de la casa** (Pestanas, Kanban, Panel, Listado, Dialogo y las clases `.tc-*`), como pidió Camilo para el rediseño de Telecab V3. Ver [[Componentes de la casa]].

## La API (`/tablero/api`)

```
GET  /tablero/api/tarjetas?vista=mias|equipo|pendientes
GET  /tablero/api/tarjetas/:id
POST /tablero/api/tarjetas                         { titulo, descripcion, responsableId, plazoDias | venceEl }
POST /tablero/api/tarjetas/:id/aprobar | rechazar | asignar | reasignar | plazo | mover | cerrar | anular
POST /tablero/api/tarjetas/:id/comentarios | colaboradores
POST /tablero/api/comentarios/:id/anular
GET  /tablero/api/personas
GET  /tablero/api/yo                               si aprueba, si reparte, si lo ve todo
```

## Ficheros

```
db/251-tablero-de-tareas.sql               las tablas, las funciones de Ignacio, desde qué ticket
services/tablero.js                        los tipos, quién ve y puede qué, el plazo, los avisos, las vencidas
services/repo/tablero.js                   el SQL
modules/Ticketera/tarjetas.js              los tickets en el tablero, en los dos sentidos
modules/Tablero/tablero.controller.js      /tablero (la pantalla) y /tablero/api
modules/Tablero/vistas/tablero.ejs         la pantalla
public/assets/js/vistas/Tablero/tablero.js las vistas, la ficha, los formularios
test/tablero.test.js                       12 pruebas, una por decisión
```
