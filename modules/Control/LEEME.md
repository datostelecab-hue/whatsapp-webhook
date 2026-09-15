# Control

Quién tenía que salir, quién salió, a quién se llamó y qué contestó. El puesto
de tráfico: lo que pasa ahora mismo, las llamadas de la mañana, las alertas de
franja, las justificaciones y el parte del día siguiente.

```
/control                         el cockpit "En directo"
/control/campanas                las tres pasadas de llamadas del turno
/control/historico               qué pasó ese día y qué se hizo
/control/km                      km conectado vs desconectado
/control/reportes                solo descargables
/alertas                         qué se vigila y a quién se avisa
/callcenter                      registro de llamadas y su cuadro de mando
/justificantes                   la cola de aprobación de las J
/flota-viva/api/…                la traza del coche que consume el cockpit
```

## Las piezas

```
control.controller.js       HTTP del cockpit. No decide nada.
control.service.js          la jornada, el orden de cada cosa, los descargables
cockpit.service.js          "En directo": el plan fundido con la realidad
campanas.service.js         las tres pasadas y sus ventanas
historico.service.js        el parte de un día · historico.repo.js  su SQL
panel.service.js            incidencias del coche y su gestión
flota.controller.js         /flota-viva · flota.service.js  su capa
alertas.controller.js       /alertas · alertas.service.js · alertas.repo.js
callcenter.controller.js    /callcenter · callcenter.service.js
justificantes.controller.js /justificantes · justificantes.service.js
reporteHoras.service.js     el reporte del día con bandas · reporteHoras.repo.js
asistencia.repo.js          quién faltó · auditoriaLunes.repo.js  los lunes
reporteTurnos.service.js    el reporte 5-5 (datos + Excel)
*.excel.js  *.pdf.js        los descargables
vistas/                     controlDirecto · controlCampanas(+Informe) ·
                            controlHistorico · kmTraza · alertas ·
                            callCenter · justificantes
```

Desde fuera del módulo se entra por un `.service`, nunca por un `.repo`.

## Lo que hay que saber

**Todo va por JORNADA OPERATIVA (05→05), no por fecha de calendario.** El mismo
día para el plan, la actividad, las llamadas y las J. Cuando no lo era, entre
las 00:00 y las 05:00 se pintaban los badges del lunes sobre el plan del martes,
y dos operadores llamaban al mismo conductor. La jornada la dice
`repo/llamadas.diaOperativoHoy()` y es la única.

**La llamada se apunta primero y se espeja después.** PostgreSQL es la verdad;
la hoja del call center es una copia para que ese equipo lo vea en su
herramienta. Si la hoja no responde, la llamada **no se pierde**: la respuesta
dice `enCallCenter: false` en vez de fallar entera.

**El informe del histórico se camina, no se resta.** Tope de 7 días porque cada
uno recalcula el cockpit contra el núcleo (unos 5 s) —un mes de una sentada
serían dos minutos y medio de petición colgada—, y el calendario se recorre día
a día porque el del cambio de hora tiene 23 o 25 y restar bloques de 24 se salta
una jornada. Los partes se piden **de uno en uno**: cada uno ya paraleliza sus
consultas por dentro y siete a la vez ahogan el pool.

**Campañas son dos vistas de la misma cosa.** El gestor ve la operativa (a quién
llamar); admin y desarrollador entran al informe (cómo va el día). Quién ve qué
es una regla, y vive en el servicio, no en la plantilla.

**Las alertas nacen en modo pruebas y sin destinatarios.** Registran y no mandan.
Hasta que no se elige a alguien en `/alertas/config` y se pasa el modo a `live`,
no sale un solo WhatsApp. Y **"un mensaje por alerta" lo garantiza un índice
único, no un `if`**: dos pasadas del cron a la vez —o el botón "Revisar ahora"
pulsado mientras corre el cron— no pueden mandar el mismo aviso dos veces.

**Una J pendiente es presunta.** Cuenta como hora presunta (azul) hasta que
alguien la mira; la aprobada es la única que entra en bitácora y en nómina; la
rechazada es una alerta para volver a llamar, y tiene dos finales —rehacerla o
cerrarla— porque sin ellos el caso se quedaba abierto para siempre.

**La asistencia llega hasta ayer.** La jornada de hoy no ha terminado y quien
entra a las 17:00 aún no ha faltado a nada.

**La auditoría de los lunes no tiene botón, a propósito.** Se pidió como un
vistazo puntual, no como un reporte semanal. Se baja por URL
(`/control/auditoria-lunes/excel?lunes=8`).

**Los backfills piden rol de desarrollador y, si el rango es largo, se van a
segundo plano.** Un mes son minutos y el HTTP se corta a la mitad. Todos son
idempotentes: repetir una ventana no duplica nada.

## Tres ficheros que no eran lo que decían, y cuatro infracciones que murieron

Esta mudanza no arregló infracciones de capas: **las hizo desaparecer** poniendo
a cada fichero el nombre de lo que hace.

- **`repo/campanas` no tenía una sola consulta.** Pide el cockpit (`enDirecto`),
  las llamadas y las J, y reparte en colas. Eso es negocio → `campanas.service`.
- **`repo/historicoControl` mezclaba las dos cosas**: dos consultas y un
  `parte()` que cruza cuatro fuentes. Se partió en servicio y repositorio.
- **`services/flotaViva/rutas` y `franjas` no eran servicios de dominio**, que es
  lo que el comprobador suponía por vivir en `services/`: son 16 y 12 consultas
  sobre las tablas `fv_*`. O sea, repositorios. Por eso `repo/inicio` y
  `reporteHoras.repo` salían acusados de llamar hacia arriba al pedirles los km.
  La acusación era del etiquetado, no del código: ahora `comprobar-capas.js`
  lleva una lista, `CAPA_DECLARADA`, escrita fichero a fichero.

**De 15 infracciones iniciales quedan 2**, y ninguna es de Control.

## Dónde vive el núcleo, y por qué no aquí

`services/flotaViva/` es el **núcleo de la ingesta**: `fv_tramo`, `fv_ruta`, las
franjas y las fuentes de BOLT y Mapon. Lo leen también Nóminas, Visibilidad,
Bitácora, Sanciones e Inicio. Meterlo dentro de Control obligaría a media casa a
entrar por la puerta de este módulo.

Lo que **sí** entró es lo que solo usaba Control: `directo.js` (el cockpit, 940
líneas sin una sola consulta) y `panel.js` (las incidencias del coche y su
gestión). Y con ellos `routes/flotaViva.js`, que ya solo servía APIs al cockpit
—sus dos pantallas se retiraron el 11/09 y sus URLs redirigen a `/control`—.

## Lo que se quedó fuera, y por qué

**`repo/llamadas` y `repo/justificantes` siguen en `services/repo/`.** El
telefonito y las J los leen también Bitácora, Calificación y Rendimiento. Un
repositorio puede llamar a otro repositorio; si entraran aquí, esos tres estarían
entrando al repositorio de otro módulo.

**`auditoriaPdf` tampoco:** lo comparte con Operaciones.

## Lo que aún no está bien

**El Call Center sigue sobre hojas.** Su persistencia es la hoja `CALL_CENTER`
del libro de sanciones, y la lista de conductores del formulario sale de
`planificadorV2`. Se mudó igual —al revés que `agenda` o `libranzas`— porque su
lógica (el catálogo, los KPIs, la clasificación) es de Control y no la usa nadie
más: el día que la persistencia pase a PostgreSQL se toca un fichero de este
módulo, no uno suelto en `services/`. En local no se puede probar sin
`GOOGLE_CREDENTIALS`.

**Dos pools sobre una sola base.** `FLOTA_VIVA_DB_URL` nació apuntando a otra
base, pero hoy seis repositorios leen `fv_*` por el pool principal contra la
misma base de Render. Colapsarlos es un rato de trabajo tranquilo, y conviene
hacerlo antes de que alguien dé por hecho que son bases distintas.

**`panel.service.js` lleva 17 consultas dentro.** Es un servicio con su SQL
pegado, como `conductores.repo` lo es al revés. Se movió primero y se parte
después: mover y partir a la vez es como se pierde una ruta sin enterarse.
