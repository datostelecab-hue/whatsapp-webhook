---
tags: [modulo, tablero, tareas, hoja-de-ruta, item-1]
actualizado: 2026-11-17
---

# Tablero de tareas

El **lugar único del trabajo pendiente** (ítem 1 de la [[Hoja de ruta]]). Una tarjeta es algo que alguien tiene que hacer: tiene responsable, plazo en días hábiles e historia. Se hace en tres entregas, cada una en su rama:
- **1a — datos y servicio** (16/11/2026, rama `tablero/1a-datos`, db/251): esta nota.
- **1b — pantallas** (16/11/2026, rama `tablero/1b-pantallas`): ver «La pantalla» abajo.
- **1c — las colas** (16/11/2026, rama `tablero/1c-colas`, db/252): J, −J, correcciones de fichaje y vacaciones, y el paso de lo abierto de una vez. Ver «Las colas» abajo.
- **17/11/2026 — fuera las J, las −J y las correcciones de fichaje; la tarea para uno mismo, sin aprobación** (en `main`, db/261). Ver abajo.

## Lo que decidieron Camilo e Ignacio (16/11/2026)

1. **Tareas a mano** (y desde el chat, cuando exista): cualquiera la crea, para otra persona o para sí. **Se le notifica a Ignacio y él la aprueba o no**. El plazo empieza a contar al aprobarla. *(Desde el 17/11/2026, la que uno se pide a sí mismo no espera: abajo.)*
2. **Tickets: todos.** Cada ticket nuevo crea su tarjeta, y **el plazo y el responsable se ponen a mano**.
3. **El responsable de la tarjeta de un ticket lo pone Ignacio**, que es quien las asigna.
4. **Ninguna tarjeta pide aprobación para cerrarse:** pasa a «cerrada» y ya.
5. **Las colas de hoy pasan de una vez** (entrega 1c).

Y el 17/11/2026, Camilo:

- **La tarea que uno se pide a sí mismo no pasa por aprobación**: «William le pide a William, entonces son preaprobadas de una vez, no tienen que pasar por dirección». Nace «por hacer», el plazo cuenta ya, no avisa a quien aprueba y su historia dice «Para sí: no pasa por aprobación». Vale también para la que nace de un mensaje del [[Chat]]. La que se pide a otra persona sigue esperando a quien aprueba.
- **Las correcciones de fichaje salen del tablero**: «la corrección de fichajes no será prioridad». Se llevan en `/fichaje`, como antes.
- **Las J y las −J salen del tablero**: «vamos a separar las justificaciones del tablero… no son cosas urgentes». Se llevan en `/justificantes`, como antes; las funciones de quién lleva cada tipo siguen.
- **Carlos también aprueba las tareas** («Que Carlos también apruebe tareas»): la función `tareas_aprueba` la tiene también el puesto Dirección Barcelona (db/262), además de Dirección de Operaciones (Ignacio). Repartir los tickets (`tareas_asigna`) sigue siendo solo de Ignacio.
- **Quien aprueba, rechaza o cierra una tarjeta la sigue viendo después** (17/11/2026). Carlos, que aprueba pero no ve todos los tableros, rechazó una y le salió «no existe»: la había rechazado, pero ya no estaba «por aprobar» y no era suya ni de su equipo.
- **La tarea que nace de un mensaje enseña el mensaje en su ficha** (autor, cuándo, canal y texto), para quien puede ver la tarjeta aunque no esté en ese canal: quien la aprueba no tiene por qué estar en un privado (a Carlos, «Abrir el mensaje» le decía «no existe»). Solo ese mensaje; el resto del canal sigue siendo de quien está dentro, y a quien no está no se le enseña el enlace. Lo da cada tipo con `verOrigen` (`registrarTipo`).
- Sus tarjetas abiertas se **anularon** con su motivo (db/261: en producción, 9 de correcciones y 1 J); las cerradas siguen como estaban. Nada se borró.

Y para la 1c (16/11/2026), con lo que hacía cada uno en los últimos 60 días:

6. **Las J, por su tipo, «como hoy»:** Tráfico, BOLT y Por compañero, William; Taller, Óscar; RR. HH., Laura. Las −J, William.
7. **De los tickets abiertos pasan solo los pedidos desde el corte de las bandejas** (24/09/2026): 8 en producción. Los 578 de antes se quedan en la ticketera.
8. **Las vacaciones, directas a quien las aprueba** (la llave de vacaciones, Laura); Ignacio puede reasignarlas.
9. **Plazo de las colas: 2 días hábiles**, un parámetro.

Y lo propuesto y aceptado:
- los tickets abiertos de antes también pasan en la 1c;
- las bajas médicas no enseñan el nombre en la tarjeta;
- el plazo es obligatorio al asignar;
- aprobar y asignar son **funciones de Organización** (`tareas_aprueba` y `tareas_asigna`, de Ignacio desde db/251), no nombres en el código;
- cada uno ve lo suyo, el responsable de un área ve lo de su área, e Ignacio lo ve todo.

## Por tipo de tarea: las pestañas de grupos (27/11/2026)

Camilo: *«sepárale a Diana el tablero por tareas: altas, bajas, etc.; todo se le está acumulando»*.

- Encima de las columnas, en todas las vistas de columnas, sale una pestaña por **grupo**: Todas, Altas, Bajas médicas, Ausencias, Nómina, Firmas y cartas, Sanciones, Salidas y finiquitos, Comunicados, J y −J, Tickets y mensajes, y Otras.
- Cada pestaña lleva **cuántas siguen abiertas** y, en rojo, cuántas están vencidas. Al pulsar una, el tablero se queda solo con esas, y la URL lo recuerda (`?grupo=altas`).
- Con un solo grupo, las pestañas no salen.
- **El grupo lo pone el servidor** según el tipo de la tarjeta (`grupoDe` en `services/tablero.js`, por el nombre del tipo). Un tipo nuevo que no casa con ninguno cae en «Otras». La lista también filtra por grupo.

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
  - **Y a quien tenga la llave `/tablero/vencidas`** (25/11/2026, db/285, plan de RR. HH.: «las vencidas avisan a Ignacio»; Camilo: *«Programa que le lleguen a Ignacio»*): recibe el aviso de todas, sean de quien sean. Es una llave y no un nombre: de inicio la tiene Ignacio y se da o se quita en [[Usuarios y permisos]] (grupo Dirección). No abre ninguna pantalla.

## Los tickets (`modules/Ticketera/tarjetas.js`)

- **Nacen** los tickets abiertos pedidos desde el **corte de las bandejas** (`ticketera_desde`, 24/09/2026 si nadie lo cambia): lo que ellas enseñan como pendiente. Se crean al traer el formulario, al abrir uno de soporte y en el repaso diario, «por asignar». Hasta la 1c miraba desde qué id (`tablero.tickets_desde_id`, que quitó db/252).
- **Las vacaciones** nacen ya **a nombre de quien tiene la llave de aprobarlas** (`/vacaciones/aprobar`), con el plazo de las colas. Ignacio puede reasignarlas.
- **Un ticket que se reabre** reabre su tarjeta cerrada. Una tarjeta **anulada** no vuelve a nacer: alguien decidió que ese ticket no es una tarjeta.
- **La tarjeta lleva** el tipo, el nombre de quien lo pide y el código, y enlaza a su bandeja (`?ticket=CÓDIGO`). Las **bajas médicas** (`BAJA_AUSENCIA`) no llevan nombre ni descripción: se miran en el ticket, con sus permisos.
- **Al asignarla**, el ticket queda a cargo de esa persona (`ticketera.asignarA`) y pasa a «en curso».
- **«Me hago cargo» en la bandeja** le pasa la tarjeta a quien lo pulsó, sin plazo; el plazo lo pone Ignacio.
- **Cerrarla en el tablero cierra el ticket**, con las reglas del ticket (en qué quedó, la llave de vacaciones, «aplicar» en las ausencias), y el ticket cerrado cierra la tarjeta. **Cerrar el ticket en su bandeja** también la cierra.

Los enganches van en lo que **exporta** `ticketera.service`: así no se olvidan en ninguna ruta. Y no lanzan nunca, porque el ticket ya está hecho.

## Las colas (entrega 1c, `services/tableroColas.js`)

> [!note] Desde el 17/11/2026, solo los tickets (y las vacaciones)
> Las J, las −J y las correcciones de fichaje dejaron de ser colas del tablero (arriba). La tabla de abajo cuenta cómo eran; el mecanismo sigue igual para cualquier cola que se registre, y sus pruebas usan una cola de mentira.

Lo que espera en una cola de hoy tiene su tarjeta, **ya asignada** a quien lo resuelve y con el plazo de las colas (`tablero.plazo_colas_dias_habiles`, 2 días hábiles, en [[Parametros]]). **La cierra su cola**: desde el tablero no se cierra (la ficha dice «Se cierra sola al resolverla allí» y no hay «Cerrar»).

| Cola | La lleva | Se cierra al | Enlace |
|---|---|---|---|
| **J** pendiente (`j`) | El titular de la función de su tipo: `j_trafico`, `j_bolt`, `j_companero` (William), `j_taller` (Óscar), `j_rrhh` (Laura) | Aprobarla o rechazarla (o anularla), desde donde sea | `/justificantes?tipo=…&dia=…` |
| **−J** pendiente (`menos_j`) | El titular de `menos_j` (William) | Aprobarla o rechazarla | `/justificantes?tipo=menos_j&dia=…` |
| **Corrección de fichaje** (`correccion_fichaje`) | Quien tiene la llave `/fichaje/revisar` (en producción, Ignacio) | Aprobarla, rechazarla o retirarla | `/fichaje` |
| **Vacaciones** (un ticket) | Quien tiene la llave `/vacaciones/aprobar` (Laura) | Cerrar el ticket | Su bandeja |

- **Sin nadie a quien darla** (la función sin titular, la llave sin dueño, una persona bloqueada), nace «por asignar» y la reparte Ignacio.
- **«La pidió»** es quien puso la J o la −J, o quien pidió la corrección: la ve en su tablero y sabe en qué quedó.
- **Si cambia su origen mientras espera** (una J pendiente que pasa de RR. HH. a Taller), cambia el título y pasa a quien le toca ahora, salvo que la haya repartido una persona: eso no se pisa.
- **Una J aprobada que se edita** vuelve a pendiente: su tarjeta se reabre (la misma, con su historia). Una sola tarjeta por cosa en toda su vida.
- **Al nacer no hay notificación al móvil:** son el trabajo de cada día de quien las lleva (unas 5 J al día a William), y las ve en su contador. Al vencer, sí, como todas.

**No se engancha a cada ruta.** Cada cola dice qué tiene pendiente (`abiertas`) y cómo acabó lo que ya no (`comoAcabaron`), y el repaso (`sincronizar`) lo compara con sus tarjetas. Así una J aprobada desde la bitácora, desde /justificantes o desde Control cierra su tarjeta igual, y una ruta nueva no se puede olvidar de avisar. Se repasa:
- **al cambiar algo en la cola**: los repos de J y −J avisan (`avisarCambios`), y el fichaje lo pide tras pedir, retirar o resolver (`pedir`). Si ya hay un repaso en marcha, se repite al acabar;
- **cada día a las 05:00** (tarea programada `tablero.colas`, [[Tareas programadas]]), por si algo cambió por otro camino. **La primera vez es el paso «de una vez»**: lo que ya esperaba (en producción, el 16/11: 4 J, 2 −J, 6 correcciones y 8 tickets, 4 de vacaciones).

Repasar dos veces no hace nada. Una cola nueva (las del chat, las de los ítems que vienen) es otro `colas.registrar(tipo, { etiqueta, abrir, abiertas, responsable, comoAcabaron })`.

## Los avisos

Cada cambio, ya fuera de la transacción:
- llega por el [[Tiempo real]] a los interesados (canal `tablero`);
- mueve sus [[Contadores]] (`tareas.mias`, en rojo si hay vencidas; `tareas.por_aprobar` y `tareas.por_asignar` a quien le tocan);
- manda una [[Notificaciones al dispositivo|notificación]] a quien le importa. Por ejemplo, «Tarea por aprobar» a Ignacio, «Te han asignado una tarea» o «Tarea reasignada» a los dos.

La notificación de una tarjeta sensible no lleva el título.

## Cómo se usa desde un módulo (para los ítems que vienen)

Una **cola** (lo que espera en una pantalla y se resuelve allí), como las J:

```js
const colas = require('../../services/tableroColas');
colas.registrar('j', {
  etiqueta: 'J por aprobar', abrir: 'Abrir la J',            // registra el tipo, con cierreManual: false
  abiertas: async () => [{ origenId, titulo, enlace, creadaPor, reparto }],
  responsable: it => colas.titularDe(`j_${it.reparto}`),     // o null: por asignar
  comoAcabaron: async ids => new Map([[id, { autorId, nota: 'J aprobada' }]]),
});
repoJ.avisarCambios(() => { colas.pedir('j'); });            // cada cambio, un repaso
```

Una tarjeta suelta, dentro de la transacción de quien la crea:

```js
await tablero.nacer(cli, { tipo, origenId, titulo, enlace, responsableId, plazoDias, creadaPor });
await tablero.cerrarPorOrigen(cli, { tipo, origenId, autorId, nota: 'Aprobada' });
```

Una **tarea a mano que nace de otra cosa** (con su aprobación, responsable y plazo), como un mensaje del [[Chat]] (2b, 17/11/2026): se registra el tipo con `aprobacion: true` y se crea con `crear`, que admite el origen y el enlace. Con `alCerrar`, el tipo decide qué pasa en su origen al cerrarla desde el tablero (el chat la cierra con `cerrarPorOrigen` y deja la respuesta en el hilo del mensaje):

```js
tablero.registrarTipo('mensaje', { etiqueta: 'Mensaje del chat', aprobacion: true, abrir: 'Abrir el mensaje', alCerrar });
await tablero.crear(usuarioId, { titulo, descripcion, responsableId, plazoDias }, { tipo: 'mensaje', origenId, enlace });
```

## Las tablas (db/251 y db/252)

- `tarea`: la tarjeta, que se puede medir para el ítem 22 (fecha límite, cumplimiento, responsable por id, motivo de demora y enlace por id).
- `tarea_colaborador`.
- `tarea_comentario`: se anula, no se borra.
- `tarea_evento`: su historia en palabras del tablero. Un disparador impide cambiarla o borrarla.
- Las tres primeras, bajo el [[Libro de auditoria]].
- db/252 da a William, Óscar y Laura las funciones de las J y las −J (por id y nombre: en otra base no le toca a nadie) y quita `tablero.tickets_desde_id`.

## El recorrido, la primera vez (17/11/2026)

La primera vez que alguien entra en el tablero le sale un recorrido de un minuto: las vistas, «Nueva tarea», las columnas, el semáforo del plazo y lo que se cierra solo. Se repite con el botón de la ruta, al lado de «Nueva tarea». Ver [[Novedades]].

## La pantalla (`/tablero`, entrega 1b)

**Tablero** en el menú, para todos, como Inicio; qué ve cada uno lo decide el tablero. Su número (`tareas.menu`) suma las tarjetas que lleva y, a quien reparte o aprueba, lo que espera por él. Va en rojo si hay algo vencido o esperando.

Hay cuatro pestañas, y la elegida va en `?vista=` (en la del equipo, la persona elegida en `?persona=`):

| Pestaña | Qué enseña |
|---|---|
| **Mi tablero** | Lo que lleva, lo que pidió y donde colabora, en columnas: por aprobar, por hacer, en curso, bloqueada y cerrada (los últimos 14 días) |
| **Mi equipo** / **Todo el equipo** | Lo mismo con lo de su gente (todo, si reparte o lo ve todo); encima, **una tarjeta por persona** que filtra el tablero. Ver «El equipo, persona a persona» |
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

## El equipo, persona a persona (20/11/2026)

Camilo: *«¿Se pueden ver tableros por persona para que la gestión del equipo sea más sencilla?»*, contando **solo lo que cada uno lleva** (no lo que pidió ni donde colabora). Primero se hizo una pestaña aparte con la carga de cada uno en una lista; el mismo día la cambió: *«no es muy práctica, la idea es que estén las tarjetas de todos encima del tablero de Ignacio como "filtro"… al clickear en uno ya no se vea el tablero general sino el individual»*.

- **En la pestaña del equipo** («Todo el equipo», o «Mi equipo» a quien no lo ve todo), encima de las columnas, **una tarjeta por persona**: sus iniciales, el nombre, cuántas lleva abiertas y, en rojo, cuántas vencidas. Delante, «Todo el equipo» con el total. Ordenadas de más vencidas y abiertas a menos; quien no lleva nada, al final y apagada (se ve quién tiene hueco). Salen de `tablero.carga` (`GET /tablero/api/equipo`), que se relee con cada recarga del tablero. Vencida = su último día hábil ya pasó, como en el número del menú.
- **Pulsar una tarjeta** deja el tablero con **solo lo que lleva esa persona** (`?persona=ID`, `GET /tablero/api/tarjetas?vista=persona&persona=ID`), con su tarjeta resaltada y una línea que lo dice. Pulsarla otra vez, o «Todo el equipo», vuelve al general. Al cambiar de pestaña se quita el filtro; un enlace con `?vista=equipo&persona=ID` lo abre filtrado.
- **Quién ve a quién**, con las reglas de siempre (`puedeVer`): quien reparte o lo ve todo, a todos; quien lleva un área o es superior, a su gente y a sí mismo; el resto, solo a sí mismo. El tablero de alguien que no se ve da 404.

## La API (`/tablero/api`)

```
GET  /tablero/api/tarjetas?vista=mias|equipo|pendientes
GET  /tablero/api/tarjetas?vista=persona&persona=ID      lo que lleva esa persona
GET  /tablero/api/equipo                               la carga de cada persona que se ve
GET  /tablero/api/tarjetas/:id
POST /tablero/api/tarjetas                         { titulo, descripcion, responsableId, plazoDias | venceEl }
POST /tablero/api/tarjetas/:id/aprobar | rechazar | asignar | reasignar | plazo | mover | cerrar | anular
POST /tablero/api/tarjetas/:id/comentarios | colaboradores
POST /tablero/api/comentarios/:id/anular
GET  /tablero/api/personas
GET  /tablero/api/yo                               si aprueba, si reparte, si lo ve todo
```

## Ficheros y GIF (18/11/2026, db/270)

Camilo: «que en cada tarea también se puedan adjuntar archivos, lo que sea: imágenes, vídeos, Word, Excel, etc., hasta GIFs en los comentarios».

- **Los ficheros de la tarjeta.** Una sección propia en la ficha, con el componente de adjuntos de la casa (`Adjuntos`, dueño `tarea`). Los sube quien ve la tarjeta, mientras no esté rechazada ni anulada. Los quita quien la lleva, quien la creó o quien reparte.
- **Los ficheros de un comentario.** Se eligen (o se suelten) en el compositor y se suben ya a un **borrador** de quien escribe (`tarea_borrador`, «<su id>-<al azar>», igual que el chat). Al comentar, pasan al comentario (`tarea_comentario`) en la misma transacción. Un comentario puede llevar **solo** un fichero o un GIF: por eso el texto deja de ser obligatorio cuando lleva ficheros (`con_adjuntos`, db/270).
- **Los GIF.** El mismo buscador de KLIPY que el chat (`buscarGifs`, `/tablero/api/gifs`). Al elegir uno se trae al borrador, con su progreso como un fichero (`gifABorrador`). La descarga, la comprobación de que es un GIF y el tope son los de `modules/Chat/gifs.service.js` (`aBorrador`, compartido).
- **Las imágenes y los GIF** salen en el comentario a la vista; el resto, como una pastilla con su nombre que abre el visor o se descarga. Quitar un comentario quita con él sus ficheros de la vista.
- **Quién ve qué:** quien ve la tarjeta, sus ficheros y los de sus comentarios; un comentario se quita por quien lo escribió (o quien reparte). Un fichero que se quita del borrador antes de mandar el comentario se anula en el servidor, para que no se le cuelgue al siguiente.
- **No se han hecho aún:** que la historia de la tarjeta diga «X adjuntó Y» (un evento nuevo) y el número de ficheros en la tarjeta de la lista.

```
db/270-comentarios-con-ficheros.sql        el comentario puede ir sin texto si lleva ficheros
services/tablero.js                        los dueños de fichero (tarea, tarea_comentario, tarea_borrador: quién ve, sube y quita), comentar con borrador, la ficha con ficheros, buscarGifs y gifABorrador
services/repo/tablero.js                   ficherosDeBorrador y pasarBorrador (el SQL del paso al comentario)
modules/Chat/gifs.service.js               aBorrador: el GIF al borrador (lo usan el chat y el tablero)
public/assets/js/vistas/Tablero/tablero.js el compositor, la subida con progreso, el GIF y los ficheros de la ficha
test/tablero-ficheros.test.js              3 pruebas: el GIF o el fichero sin texto, quién ve y quién sube, y quitar
```

## Ficheros

```
db/251-tablero-de-tareas.sql               las tablas, las funciones de Ignacio
db/252-tablero-colas.sql                   quién lleva las J y las −J (1c)
db/261-tablero-sin-j-ni-fichajes.sql       anula las tarjetas abiertas de J, −J y correcciones de fichaje (17/11)
db/262-carlos-aprueba-tareas.sql           Dirección Barcelona (Carlos) también aprueba las tareas (17/11)
services/tablero.js                        los tipos, quién ve y puede qué, el plazo, los avisos, las vencidas
services/tableroColas.js                   las colas: el repaso, cuándo se pide y el diario (1c)
services/repo/tablero.js                   el SQL
modules/Ticketera/tarjetas.js              los tickets en el tablero, en los dos sentidos, y las vacaciones
modules/Tablero/tablero.controller.js      /tablero (la pantalla) y /tablero/api
modules/Tablero/vistas/tablero.ejs         la pantalla
public/assets/js/vistas/Tablero/tablero.js las vistas, la ficha, los formularios
test/tablero.test.js                       12 pruebas, una por decisión
test/tablero-colas.test.js                 5 pruebas de las colas (1c, y que las J y los fichajes ya no van)
```
