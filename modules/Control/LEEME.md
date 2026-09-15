# Control

Quién tenía que salir, quién salió, a quién se llamó y qué contestó. El puesto
de tráfico: lo que pasa ahora mismo, las llamadas de la mañana y el parte del
día siguiente.

```
/control                         el cockpit "En directo"
/control/campanas                las tres pasadas de llamadas del turno
/control/historico               qué pasó ese día y qué se hizo
/control/km                      km conectado vs desconectado
/control/reportes                solo descargables
/control/api/directo             el cockpit en JSON (se refresca solo)
/control/api/llamada        POST apuntar una llamada
/control/api/justificar-directo  POST poner una J desde la carta
```

## Las piezas

```
control.controller.js       HTTP. No decide nada.
control.service.js          la jornada, el orden de cada cosa, los nombres de fichero
campanas.service.js         las tres pasadas y sus ventanas
historico.service.js        el parte de un día: cockpit + llamadas + J + alertas
historico.repo.js           el SQL del parte
asistencia.repo.js          SQL de quién faltó y cuántas veces
auditoriaLunes.repo.js      SQL de los lunes ya cerrados
turnos.excel.js             quién sale mañana y pasado, para imprimir
historico.excel.js          el informe del histórico (1 a 7 días)
asistencia.excel.js         · asistencia.pdf.js
auditoriaLunes.excel.js     · kmCascada.pdf.js
reporteTurnos.service.js    el reporte 5-5 (datos + Excel)
vistas/                     controlDirecto · controlCampanas(+Informe) · controlHistorico · kmTraza
```

Desde fuera del módulo se entra por `control.service`, nunca por un `.repo`.

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

**La asistencia llega hasta ayer.** La jornada de hoy no ha terminado y quien
entra a las 17:00 aún no ha faltado a nada.

**La auditoría de los lunes no tiene botón, a propósito.** Se pidió como un
vistazo puntual, no como un reporte semanal; una tarjeta más en Reportes sería
estorbo para algo que casi nunca se pulsa. Se baja por URL
(`/control/auditoria-lunes/excel?lunes=8`).

## Dos ficheros que no eran repositorios, y dos infracciones que murieron

`campanas` y `historicoControl` vivían en `services/repo/`. Ninguno de los dos
era un repositorio:

- **`campanas` no tiene una sola consulta.** Pide el cockpit (`enDirecto`), las
  llamadas y las J, y reparte en colas. Eso es negocio.
- **`historicoControl` mezclaba las dos cosas**: dos consultas y un `parte()`
  que cruza cuatro fuentes. Se partió — el SQL a `historico.repo`, el cruce a
  `historico.service`.

Mientras estuvieron etiquetados como repositorios, llamar a `enDirecto` contaba
como saltarse una capa, y eran **dos de las seis infracciones** que arrastraba
el proyecto. Con el nombre bueno dejan de serlo: un servicio sí puede llamar a
otro. No se movió código para esquivar al comprobador; se le puso a cada cosa el
nombre de lo que hace, y el comprobador dejó de quejarse solo.

## Lo que se quedó fuera, y por qué

**`services/flotaViva/` NO es de aquí.** `fv_tramo`, `fv_ruta` y compañía son el
núcleo de la ingesta y los leen Nóminas, Visibilidad, Bitácora, Sanciones e
Inicio. Meterlos dentro de Control obligaría a media casa a entrar por la puerta
de este módulo. Se queda donde está, que es donde vive "cómo se le pregunta al
núcleo" — igual que `services/bolt.js`.

**`repo/llamadas` sigue en `services/repo/`.** Es el telefonito, y lo leen
también Bitácora, Calificación y Rendimiento. Un repositorio puede llamar a otro
repositorio; si entrara aquí, esos tres estarían entrando al repositorio de otro
módulo.

**`auditoriaPdf` tampoco se mueve:** lo comparte con Operaciones.

**`alertas`, `callCenter` y `justificantes` faltan todavía.** Son de este módulo
según el reparto, y entran en la siguiente tanda. `control.service` ya habla con
los dos últimos por su nombre de hoy (`services/callCenter`,
`services/justificantes`); cuando entren, cambia el `require` y nada más.

## Lo que aún no está bien

`repo/reporteHoras` llama hacia arriba a `flotaViva/rutas` — es la infracción que
queda en esta familia, y cae cuando entre Justificantes.
