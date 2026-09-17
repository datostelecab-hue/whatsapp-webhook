---
tags: [modulo, ticketera, rrhh, soporte, it, formulario]
aliases: [Ticketera, Tickets, Soporte técnico, Tickets Telecab]
---

# Ticketera

Lo que pide la gente y qué se hace con ello. Un conductor rellena el Formulario y aparece un **ticket** en la bandeja de quien le toca resolverlo; todo vive en `modules/Ticketera/` sobre la tabla `ticket` de PostgreSQL.

```
ticketera.controller.js   HTTP. Un controlador, cinco montajes.
ticketera.service.js      las decisiones: quién lo pide, qué se hace, cómo se cierra
ticketera.repo.js         SQL y nada más
formulario.js             lee las respuestas del Formulario de Google
clasificar.js             el reparto: a qué área va cada cosa
rescateIT.js              el traslado, una sola vez, de la hoja TICKETS_IT
vistas/ticketera.ejs      la bandeja (la misma para las cinco áreas)
```

## Cinco bandejas, ningún permiso nuevo

Cada área tiene su bandeja **colgando del módulo al que pertenece el trabajo**, y el permiso sale solo del prefijo de la ruta (ver [[Usuarios y permisos]]):

| Ruta | Área | Qué lleva |
|---|---|---|
| `/ticketera` | RRHH | vacaciones, bajas, permisos, nóminas, cuentas, domicilio, papeles |
| `/administracion/tickets` | ADMIN | Ballenoil y reintegros de gastos |
| `/planificador/tickets` | TRAFICO | cambios de libranza |
| `/taller/tickets` | TALLER | incidencias del vehículo |
| `/operaciones/sin-traza` | OPERACIONES | los que **no se sabe clasificar** |

El montaje se hace con `ticketera.para(area, {titulo, seccion, subtitulo})` en `app.js`. Quien puede abrir Administración ve los tickets de Administración: **separar la bandeja es una cosa y separar quién entra es otra**, y lo segundo no lo ha pedido nadie — hacerlo dejaría a todo el mundo fuera hasta que alguien fuera concediendo permisos uno a uno.

La bandeja de Operaciones es nueva y arregla un agujero: el Apps Script mandaba a RRHH todo lo que no encajaba con ninguna regla, y ahí se perdía entre trescientos tickets. Son justo los que hay que mirar — cada uno es **o algo que no habíamos previsto, o una regla de reparto que se quedó corta**. Por eso su pantalla no se llama "Ticketera" sino "Tickets sin traza": explicar qué es eso en su propia cabecera ahorra la pregunta.

## La entrada es lo único que sigue en Google

Y **solo la entrada**: se *lee* la hoja de respuestas del Formulario y no se escribe en ella (`modules/Ticketera/formulario.js`). El Apps Script que clasificaba, numeraba, buscaba el DNI contra otra hoja y mandaba los correos deja de hacer falta, y **hay que apagarlo**: si sigue corriendo, cada ticket existirá dos veces. Ver [[Adiós a las hojas]].

Se lee la pestaña de **respuestas crudas**, no la hoja MASTER que montaba el script. Leer MASTER sería más fácil y dejaría vivo justo la pieza que hay que apagar; además, dos programas escribiendo sobre las mismas filas es como se llega a que uno pise al otro. Leyendo las respuestas, el formulario solo **recoge**.

**Las cabeceras son las preguntas, y las preguntas se reescriben**: "DNI" se convierte en "Indica tu DNI o NIE (con la letra)" el día que alguien la aclara. El Apps Script las tenía clavadas en una constante, así que retocar el formulario dejaba una columna sin leer **en silencio**. Aquí se buscan por trozo de texto (`ticket_form_campo`) y —esto es lo que de verdad lo arregla— **lo que no case con ningún campo conocido no se pierde**: se añade a la descripción como «Pregunta: respuesta», así que una pregunta nueva aparece en el ticket desde el primer día sin tocar una línea.

Ni siquiera el nombre de la pestaña se escribe fijo: el primer intento buscó «BBDD» y la pestaña se llama «BBDD Tickets», Google contestó *Unable to parse range* y las cinco bandejas salieron en rojo.

`GET …/api/formulario` enseña **qué está leyendo y qué no**: qué columna alimenta qué campo y cuáles van a parar a la descripción. Sin eso, que una pregunta deje de casar es invisible — el ticket sale con un campo vacío y nadie se entera.

## La sincronización se puede repetir

La llama la ingesta (ver [[Ingesta]]), y también `POST …/sincronizar` para traer ahora lo que haya sin esperar. Es **idempotente**: el índice único sobre `fila_form` impide que la misma respuesta entre dos veces, así que una pasada cortada a medias se arregla sola en la siguiente. La marca de agua (`config_app.ticketera_ultima_fila`) es una optimización —no releer mil filas—, **no la garantía**.

Y **una fila mala no puede tumbar la pasada**. Pasó de verdad: una respuesta con la prioridad larga no cabía en su columna, la excepción subía, y con ella se quedaban fuera **todas** las respuestas posteriores, pasada tras pasada. Ahora cada fila va por su cuenta: la que falle se apunta con su número y su motivo, y las demás siguen entrando.

## El reparto: gana la primera regla que encaja

`modules/Ticketera/clasificar.js` está portado del Apps Script y **el orden es la regla**: se busca el texto dentro de la gestión que eligió el conductor y gana la primera coincidencia. El ejemplo que lo explica: *"baja por permiso retribuido"* contiene «baja» y contiene «permiso», y cae en baja/ausencia porque esa regla va antes — que es lo correcto, es una baja. Si alguien reordenara la tabla, ese ticket se iría a otra bandeja sin que nada fallara.

En el script esto estaba **partido en dos**: una pestaña CONFIG que una persona podía editar y una cascada de `if` escrita a mano en el código, con la pestaña ganando; para saber a dónde iba una gestión había que mirar los dos sitios y saber cuál mandaba. Aquí es **una sola tabla ordenada** (`ticket_routing`, con `manual` primero): las reglas que puso una persona siguen yendo delante, pero se ven y se tocan donde las demás.

## Quién lo pide

Se identifica por **DNI primero, teléfono después y nombre el último**, que es el orden en que esos datos identifican de verdad a alguien. Si no se resuelve, **el ticket entra igual** con lo que escribió: uno sin dueño se puede enlazar después, uno que no existe no.

El listado enseña los **dos nombres** —el que escribió en el formulario y el que dice la base—, porque si no coinciden **eso es el dato**.

## Qué se puede hacer con un ticket

| Acción | Qué es |
|---|---|
| `asignar` | quién lo lleva |
| `estado` | moverlo por el catálogo de estados; cerrar exige decir en qué quedó |
| `observaciones` | lo que se va apuntando |
| `enlazar` | atarlo a una persona — es lo que resuelve un "sin identificar" |
| `reclasificar` | mandarlo a otra bandeja |
| `aplicar` | convertir lo que pide en un hecho |

**Reclasificar no separa área de subtipo**: el subtipo decide el área. Si «incidencia del vehículo» es de Taller, no tiene sentido poder dejarla en RRHH.

**Aplicar** es lo que convierte el ticket en el hecho: para los subtipos que abren una ausencia (vacaciones, baja, permiso) abre el tramo en la ficha de la persona, y entra **por la puerta de Conductores**, que es donde viven las reglas — que el tramo no pise otro de la misma persona, que lo que tiene vuelta la lleve, y que cerrar una vigencia y abrir la siguiente vaya en una transacción. Se aplica **antes** de mover el ticket: si el tramo choca, el ticket se queda como estaba en vez de figurar «Ejecutado» sin haberse ejecutado nada.

Todo movimiento queda apuntado en el historial del ticket con quién lo hizo.

## Los tickets de IT

Son los mismos tickets, con `area = IT` y `origen = soporte`. Desde el 15/09/2026 viven en la tabla `ticket`, la misma que los del formulario: antes tenían su propia hoja, su propio esquema y su propia pantalla, para acabar contestando a las mismas preguntas.

**`/soporte`** (`routes/soporte.js`) lo puede usar **cualquiera que haya entrado**: un fallo, una mejora, una duda. Quien lo abre ve **los suyos y solo los suyos** (`GET /soporte/api/mis-tickets`). Los tipos son Bug, Requerimiento, Mejora, Consulta y Otro, con prioridad Baja / Media / Alta.

**`/tickets-telecab`** (`routes/ticketsTelecab.js`) es la bandeja entera, y es **solo del desarrollador** (`sesion.requiereDesarrollador`): ni siquiera un superadmin la ve. Trae **todos, cerrados incluidos**, porque en soporte se mira tanto lo que falta como lo que se hizo, y los contadores salen del catálogo (`cierra`) y no de una lista de estados escrita a mano.

Soporte habla en sus palabras de siempre y debajo son los estados de la ticketera. La traducción vive en un sitio, `ticketera.service.js`:

| Soporte | Ticketera |
|---|---|
| Nuevo | `pendiente` |
| En curso | `en_curso` |
| Resuelto | `ejecutado` |
| Descartado | `no_procede` |

Cerrar exige decir en qué quedó; en soporte eso son **las notas del desarrollador**, que es lo que ya se escribe, así que no se pide nada nuevo.

### Los adjuntos

Llegan en base64 dentro del JSON, así que `/soporte` sube su propio límite de cuerpo a 40 MB y está en la lista de rutas que se saltan el parser global de `app.js`. Los ficheros se suben a Drive (`services/drive.js`) y en el ticket queda **solo su enlace**.

**Si un adjunto falla, el ticket se crea igual.** Lo que no se puede perder es el reporte: que no haya subido un pantallazo no puede tirar por tierra la descripción de un fallo que alguien acaba de escribir. Se avisa de cuáles fallaron y ya se adjuntarán luego.

La carpeta de Drive lleva un nombre provisional (`Soporte-<marca>`) porque **el código del ticket lo da la base al crearlo** y los ficheros se suben antes.

### El rescate de la hoja vieja

`modules/Ticketera/rescateIT.js` trae, **una sola vez**, lo que quedara en la hoja `TICKETS_IT`: lo abierto ahí era trabajo pendiente de verdad, y perderlo al cambiar de sitio sería perder la cola entera. Se dispara solo la primera vez que se abre `/tickets-telecab`, se apunta en `config_app` para no repetirlo, y **si la hoja no contesta no se marca como hecho**: se reintenta en la siguiente mirada.

Los códigos viejos (`IT-xxxxx`) se conservan **tal cual**, porque están en conversaciones y en correos; los nuevos llevan el formato de la ticketera. Los cuatro estados de la hoja se mapean a los del catálogo: «Resuelto» es *ejecutado* y «Descartado» es *no procede* — significan lo mismo con otras palabras, y añadir dos estados más es como se llega a un desplegable donde nadie sabe qué elegir.

## Detalles de la base

Las fechas salen como **texto con `to_char`** y nunca como `Date`: una columna DATE leída con `toISOString` desde Madrid devuelve el día anterior — ver [[Fechas sin toISOString]]. El repositorio calcula además **cuánto lleva abierto** (o cuánto tardó) en horas con un decimal, que es como se mira "¿cuánto tardamos en atender?".
