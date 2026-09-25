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
| `/administracion/tickets` | ADMIN | combustible y reintegros de gastos |
| `/planificador/tickets` | TRAFICO | cambios de libranza |
| `/taller/tickets` | TALLER | incidencias del vehículo |
| `/operaciones/sin-traza` | OPERACIONES | los que **no se sabe clasificar** |

El montaje se hace con `ticketera.para(area, {titulo, seccion, subtitulo})` en `app.js`. Quien puede abrir Administración ve los tickets de Administración: **separar la bandeja es una cosa y separar quién entra es otra**, y lo segundo no lo ha pedido nadie — hacerlo dejaría a todo el mundo fuera hasta que alguien fuera concediendo permisos uno a uno.

### En la barra de arriba, con sus pendientes del mes (25/09/2026)

Las cinco bandejas **ya no están en el menú lateral**: son cinco cuadros en la barra de arriba —**RRHH, Administración, Tráfico, Taller y Sin traza**—, cada uno con su nombre y el número de **pendientes de este mes**. Lo pidió Camilo: estaban repartidas por el menú y solo se veían al ir a buscarlas. Pinchar uno abre su bandeja, y el de la bandeja en la que se está sale marcado en dorado.

- **Cada uno ve solo los cuadros que puede abrir**, con la misma regla que el control de acceso (`permisos.claveDeRuta`): un cuadro que dijera «sin permiso» al pincharlo sería peor que no tenerlo. Lo decide `ticketera.controller → enLaBarra`, y la lista de las cinco (`BANDEJAS`) está en un solo sitio.
- **El número llega después**, como la campana: `GET /bandejas/api/pendientes`, que solo devuelve los de las bandejas que quien pregunta puede abrir. Se refresca cada dos minutos, al volver a la pestaña y al tocar un ticket en la bandeja.
- **Si no caben**, la fila se desliza de lado y lo de la derecha (fichar, campana, usuario) no se aprieta. En el móvil van en una segunda línea bajo la barra: sin menú, no había otra forma de llegar.

#### RRHH, partido en pantalla grande

A partir de **2xl (1.536 px)** el cuadro de RRHH se sustituye por un bloque con el nombre delante y sus partes, que es como lo pidió Camilo: **Casos de nómina · Casos de baja médica · Vacaciones · Permisos**. Por debajo de ese ancho sigue siendo un cuadro. Cada parte abre la bandeja **ya filtrada** (`/ticketera?grupo=nomina`…), y la bandeja lo dice arriba con un «ver todos».

| Parte | Tipos (`subtipo_codigo`) |
|---|---|
| Casos de nómina | `INCIDENCIA_NOMINA`, `CAMBIO_CUENTA` (la cuenta es donde se cobra) |
| Casos de baja médica | `BAJA_AUSENCIA` |
| Vacaciones | `VACACIONES` |
| Permisos | `PERMISO_RETRIBUIDO` |
| **Otros de RRHH** | todo lo demás (domicilio, documentación, recomendaciones…). **Solo sale si tiene algo**: partir no puede esconder un ticket |

Las partes viven en un solo sitio (`PARTES_RRHH` en `ticketera.controller.js`), y el recuento va por tipo en la misma consulta: las partes suman siempre lo mismo que el cuadro único. Para que todo quepa a 1.920 px con el menú desplegado, en pantalla grande los cuadros pierden el icono.

### Solo los tickets de este mes

Las bandejas y sus cuadros traen **solo lo pedido este mes**. Los 550 y pico pendientes de antes son, casi todos, de cuando se importó la hoja vieja; siguen en la base, sin tocar, pero no salen (decisión de Camilo, 25/09/2026). La bandeja lo dice arriba (*«Solo los pedidos en septiembre de 2026»*).

- **El mes es el de la PETICIÓN** (`marca_form`, la hora del formulario), no el de alta en el sistema: los 580 primeros se dieron de alta de golpe el 15/09 y con `creado_at` todos parecerían de septiembre. Un ticket sin marca (los de dentro) va por su fecha de alta.
- **El enlace directo sí trae uno viejo.** La ficha de una persona enlaza el ticket del que salió cada ausencia (`?ticket=CÓDIGO`), y ese se trae sea del mes que sea: si no, el enlace llevaría a una bandeja vacía.

> [!warning] El día 1 de cada mes, los pendientes del anterior dejan de verse
> Es lo que se pidió —«solo los de este mes»— y vale igual para el que se quedó
> sin atender el 30. Si hace falta arrastrar los pendientes del mes anterior,
> es cambiar `INICIO_MES` en `ticketera.repo.js`.

La bandeja de Operaciones es nueva y arregla un agujero: el Apps Script mandaba a RRHH todo lo que no encajaba con ninguna regla, y ahí se perdía entre trescientos tickets. Son justo los que hay que mirar — cada uno es **o algo que no habíamos previsto, o una regla de reparto que se quedó corta**. Por eso su pantalla no se llama "Ticketera" sino "Tickets sin traza": explicar qué es eso en su propia cabecera ahorra la pregunta.

## La entrada es lo único que sigue en Google

Y **solo la entrada**: se *lee* la hoja de respuestas del Formulario y no se escribe en ella (`modules/Ticketera/formulario.js`). El Apps Script que clasificaba, numeraba, buscaba el DNI contra otra hoja y mandaba los correos deja de hacer falta, y **hay que apagarlo**: si sigue corriendo, cada ticket existirá dos veces. Ver [[Google Drive y Sheets|Adiós a las hojas]].

Se lee la pestaña de **respuestas crudas**, no la hoja MASTER que montaba el script. Leer MASTER sería más fácil y dejaría vivo justo la pieza que hay que apagar; además, dos programas escribiendo sobre las mismas filas es como se llega a que uno pise al otro. Leyendo las respuestas, el formulario solo **recoge**.

**Las cabeceras son las preguntas, y las preguntas se reescriben**: "DNI" se convierte en "Indica tu DNI o NIE (con la letra)" el día que alguien la aclara. El Apps Script las tenía clavadas en una constante, así que retocar el formulario dejaba una columna sin leer **en silencio**. Aquí se buscan por trozo de texto (`ticket_form_campo`) y —esto es lo que de verdad lo arregla— **lo que no case con ningún campo conocido no se pierde**: se añade a la descripción como «Pregunta: respuesta», así que una pregunta nueva aparece en el ticket desde el primer día sin tocar una línea.

Ni siquiera el nombre de la pestaña se escribe fijo: el primer intento buscó «BBDD» y la pestaña se llama «BBDD Tickets», Google contestó *Unable to parse range* y las cinco bandejas salieron en rojo.

`GET …/api/formulario` enseña **qué está leyendo y qué no**: qué columna alimenta qué campo y cuáles van a parar a la descripción. Sin eso, que una pregunta deje de casar es invisible — el ticket sale con un campo vacío y nadie se entera.

## La sincronización se puede repetir

La lanza **la ingesta cada 10 minutos** (tarea `tickets_formulario`, ver [[Ingesta]]) y también `POST …/sincronizar` para traer ahora lo que haya sin esperar. Es **idempotente**: el índice único sobre `fila_form` impide que la misma respuesta entre dos veces, así que una pasada cortada a medias se arregla sola en la siguiente.

> [!bug] Hasta el 25/09/2026 la tarea de la ingesta no corrió nunca
> Estaba escrita **dentro** de la tarea de Mapon (`unidades_mapon`) por una llave
> mal cerrada, así que no existía como tarea. Los tickets entraban igual porque
> había además un cron cada dos horas en `app.js`, y nadie lo notó. Se sacó a su
> sitio, se quitó el cron —una sola puerta— y la tabla de la ingesta pasó a
> admitir la fuente `formulario` (db/160): sin eso, cada pasada contaba como
> fallida y, sin un acierto apuntado, la tarea se habría repetido cada minuto
> contra Google. Si falla, espera 10 minutos antes de reintentar.

### Se lee solo lo nuevo, y no se escribe nada en su hoja

Camilo: *«que lea los 4 o 5 nuevos que vayan llegando, que no relea 400 tickets ya leídos, y que no edite nada de los campos de ahí»*. El «leído» vive **en nuestra base, no en su hoja**: la **marca de agua** (`config_app.ticketera_ultima_fila`) es la última fila ya convertida en ticket. Las hojas de respuestas solo crecen por abajo, así que el número de fila es una referencia estable, y queda guardado en cada ticket (`fila_form`).

Desde el 25/09/2026 a Google se le piden **dos trozos en un solo viaje** (`readMany`): la fila de cabeceras —hacen falta para saber qué columna es qué— y **de la marca para abajo**. Antes se descargaba la hoja entera en cada pasada y se descartaba lo ya leído. Sin marca —la primera vez— o en el diagnóstico (`GET …/api/formulario`, que quiere saber cuántas filas hay) se lee entera.

Qué hemos atendido nosotros no se apunta en su hoja: es el **estado del ticket** aquí (pendiente, en curso, ejecutado…), con su historial.

Y **una fila mala no puede tumbar la pasada**. Pasó de verdad: una respuesta con la prioridad larga no cabía en su columna, la excepción subía, y con ella se quedaban fuera **todas** las respuestas posteriores, pasada tras pasada. Ahora cada fila va por su cuenta: la que falle se apunta con su número y su motivo, y las demás siguen entrando.

> [!tip] Ya no hay botón de «Traer del formulario»
> Ese botón era el problema: una petición de vacaciones entraba en el sistema cuando alguien se acordaba de pulsarlo, así que un conductor que pedía el lunes por la mañana podía no existir para RRHH hasta el miércoles.
>
> **Dos horas y no cinco minutos** porque al otro lado hay una hoja de Google, no una base: cada pasada lee el libro entero y no hay prisa ninguna — lo que se arregla es que llegue solo, no que llegue al segundo.

## La pantalla: filtros, y el diálogo de la casa

Con **270 abiertos**, una lista sin filtrar no es una bandeja: es un muro. Se filtra por **conductor, DNI, teléfono, código o matrícula** en una sola caja (varias palabras = todas tienen que aparecer), por **tipo** y por **fechas**.

> [!info] Qué fecha mide el filtro
> La de la **ausencia** cuando el ticket la tiene, y la de la **petición** cuando no. Es lo que se busca de verdad: «las vacaciones de noviembre» no se encuentran por la fecha en que se pidieron, y «lo que entró la semana pasada» no tiene más fecha que esa. De 270 tickets, 102 traen fechas de ausencia y los 270 traen fecha de petición.
>
> Y se mira por **solape**, no por «empieza dentro»: unas vacaciones del 28 de octubre al 10 de noviembre son de noviembre también.
>
> Para eso hizo falta `pedido_iso` en el repositorio: el `pedido` que se lee es `DD/MM/YYYY`, y comparado como texto pone el 02/01 antes que el 31/12 del año anterior.

El desplegable de tipos se llena con **lo que hay en la bandeja**, no con el catálogo entero: ofrecer veinte filtros que dan cero no ayuda a nadie.

### Las acciones van por el diálogo de la casa

> [!danger] Las cuatro estuvieron rotas por el mismo motivo
> Usaban `tipo: 'opciones'`, que devuelve un **objeto**, y el servidor leía texto: le llegaba `"[object Object]"`. Ahora usan `tipo: 'lista'`, que devuelve el valor a secas. → [[Trampas conocidas]]

Eran `prompt()` del navegador, encadenados: «Desde (aaaa-mm-dd)», aceptar, «Hasta», aceptar. Un `prompt` no admite un calendario, ni una lista, ni enseñar de quién es el ticket mientras lo rellenas — y se pinta con los colores del sistema operativo, así que en una pantalla oscura parece de otra aplicación. Enlazar a una persona eran **dos** ventanas para una sola decisión: escribe un trozo del nombre, y luego elige entre los siete que salen.

Ahora todas usan `Dialogo.formulario` y `Dialogo.aviso`. Lo que cambia de verdad:

- **Aplicar** enseña qué ausencia se va a abrir y **deja cambiarla**. El subtipo la propone —«Vacaciones» abre vacaciones—, pero la propuesta puede estar mal: el formulario lo rellena el conductor y «Baja o ausencia» cabe en una baja médica, un permiso o un asunto propio. El servicio acepta la corrección **solo si el código es una ausencia de verdad**; cualquier otro dejaría a la persona en un estado que no la aparta de nadie.
- **Enlazar** es un selector con buscador dentro, sobre las 427 fichas, con el DNI al lado del nombre.
- **Historia** es una tabla, no un `alert()` con saltos de línea.

### Los enlaces de los certificados se pinchan

92 de los 270 tickets traen un enlace de Drive dentro de lo que escribió el conductor. Antes había que seleccionar la URL a mano y pegarla en otra pestaña —cada justificante, una vez—, así que **mirar el papel costaba más que aplicar la ausencia**. Ahora son enlaces, y el desplegable «Lo que escribió» nace abierto cuando hay uno.

> [!warning] Escapar primero, enlazar después
> Se escapa cada trozo de texto y el enlace se construye aparte. Escapar el HTML ya hecho rompería las comillas del `href`; no escaparlo dejaría que un formulario **que rellena cualquiera** metiera etiquetas en esta pantalla.
>
> Y la puntuación final no es del enlace: un punto detrás de una URL cierra la frase, y metido dentro del `href` da un 404.

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

### La ausencia se acuerda de su ticket

El tramo que se abre guarda el **id del ticket** (`conductor_estado_hist.ticket_id`, [[Migraciones|db/144]]), además del usuario que lo aplicó, que ya estaba.

Con eso, el **Historial de situaciones** de la ficha contesta sin salir de ahí las tres preguntas que se hacen justo después de ver *«Baja médica, del 18 al 20»*:

| Pregunta | De dónde sale |
|---|---|
| ¿Quién la puso? | `usuario_id` — de la sesión, no se escribe a mano |
| ¿Por qué? | el ticket, con lo que escribió el conductor |
| ¿Y el justificante? | el enlace de Drive del ticket |

> [!info] Un número, no una copia
> Se guarda el **id**, no el código ni el enlace. Copiar el enlace se leería igual de bien, pero sería una **foto**: el día que el conductor suba el certificado corregido, la ficha seguiría enseñando el viejo. Es la misma regla del [[Control|Call Center]] con las llamadas de Control — se leen de donde viven.
>
> Y la clave ajena es `ON DELETE SET NULL`: **borrar un ticket no borra la ausencia**. Ese tramo es lo que explica unas horas en la [[Bitacora]] y en la [[Nominas|nómina]].

> [!warning] El justificante NO está en `adjuntos`
> Esa columna está **vacía en los 578 tickets**. El formulario de Google no sube el fichero: deja la dirección de Drive **dentro del texto** (`Adjuntar Certificados: https://…`), y así llegan 120 de ellos. Se leen los dos sitios, y el nombre del enlace sale de la etiqueta que el formulario escribió delante.

El código del ticket es un enlace a `/ticketera?ticket=CÓDIGO`, que llega con la búsqueda puesta **y los cerrados encendidos** — un ticket ya aplicado está cerrado, y sin eso el enlace llevaría a una bandeja vacía.

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

Las fechas salen como **texto con `to_char`** y nunca como `Date`: una columna DATE leída con `toISOString` desde Madrid devuelve el día anterior — ver [[Trampas conocidas|Fechas sin toISOString]]. El repositorio calcula además **cuánto lleva abierto** (o cuánto tardó) en horas con un decimal, que es como se mira "¿cuánto tardamos en atender?".
