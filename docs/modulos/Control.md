---
tags: [modulo, control, trafico, operaciones, llamadas]
aliases: [Control de tráfico, Puesto de tráfico]
---

# Control

Control es el puesto de tráfico del ERP: quién tenía que salir, quién salió, a quién se llamó y qué contestó. Vive en `modules/Control/` y su cabecera lo resume sin adornos — "lo que pasa ahora mismo, las llamadas de la mañana, las alertas de franja, las justificaciones y el parte del día siguiente" (`modules/Control/LEEME.md`).

No es un módulo de consulta: existe para decidir a quién se llama en los próximos diez minutos.

## Las pantallas y por dónde se entra

| Ruta | Qué es | Vista |
|---|---|---|
| `/control` | el cockpit [[Control En directo|En directo]] | `modules/Control/vistas/controlDirecto.ejs` |
| `/control/campanas` | las tres pasadas de llamadas del turno | `controlCampanas.ejs` / `controlCampanasInforme.ejs` |
| `/control/historico` | qué pasó ese día y qué se hizo | `controlHistorico.ejs` |
| `/control/km` | km conectado vs desconectado | `kmTraza.ejs` |
| `/control/reportes` | [[Control Reportes|solo descargables]] | `reportes.ejs` |
| `/alertas` | [[Control Alertas|qué se vigila y a quién se avisa]] | `alertas.ejs` |
| `/callcenter` | registro de llamadas y su cuadro de mando | `callCenter.ejs` |
| `/justificantes` | la cola de aprobación de las J | `justificantes.ejs` |
| `/flota-viva/api/…` | las APIs que consume el cockpit (sin pantalla) | — |

La sub-navegación de las pestañas está en `modules/Control/vistas/partials/control-nav.ejs`, y lleva Justificantes dentro aunque cuelgue de otra URL: "quien rechaza una J es quien está mirando el directo".

**Flota viva ya no es una pantalla.** Sus dos vistas se retiraron el 11/09/2026 porque contaban un sistema de alertas de vehículo apagado desde el 08/09 y enseñaban una foto fija de un día que no era hoy. `modules/Control/flota.controller.js` redirige `/flota-viva` a `/control` y `/flota-viva/partes` a `/control/historico`, y lo hace con un **302 a propósito**: un 301 se cachea en el navegador para siempre y ata las manos si mañana hay que reutilizar la URL. Ver [[Flota viva]].

## Cómo se reparte el trabajo

```
control.controller.js       HTTP del cockpit. No decide nada.
control.service.js          la jornada, el orden de cada cosa, los descargables
cockpit.service.js          "En directo": el plan fundido con la realidad
campanas.service.js         las tres pasadas y sus ventanas
historico.service.js        el parte de un día · historico.repo.js  su SQL
panel.service.js            incidencias del coche y su gestión
alertas.controller/service/repo.js      /alertas
callcenter.controller/service/repo.js   /callcenter
justificantes.controller/service.js     /justificantes
reporteHoras.service.js     el reporte del día con bandas · reporteHoras.repo.js
asistencia.repo.js · auditoriaLunes.repo.js · reporteTurnos.service.js
*.excel.js  *.pdf.js        los descargables
```

**El controlador no decide nada.** `modules/Control/control.controller.js` lo dice en su cabecera y se cumple: no sabe qué jornada es, ni qué vista le toca a cada rol, ni cómo se llama un fichero de descarga. Todo eso vive en `modules/Control/control.service.js` — incluso el catálogo de motivos de llamada, que se sirve desde el servidor porque "la misma lista la usan el cockpit, las campañas y el histórico, y tres copias en tres `.ejs` se desincronizan al primer motivo nuevo". Ver [[Reglas de la casa]].

**Desde fuera del módulo se entra por un `.service`, nunca por un `.repo`.** Ejemplo vivo: el historial completo de llamadas de una persona se sirve desde `/control/api/historial-llamadas/:id` y no desde `/callcenter`, y no por capricho — es para que el permiso sea el de esta pantalla: quien lleva el Histórico tiene que poder abrir el historial de alguien sin que le den además el módulo de Call Center entero.

**Tres ficheros que no eran lo que decían.** La mudanza a `modules/Control/` no arregló infracciones de capas: las hizo desaparecer poniéndole a cada fichero el nombre de lo que hace.

- `repo/campanas` no tenía una sola consulta: pide el cockpit, las llamadas y las J y reparte en colas. Eso es negocio → `campanas.service.js`.
- `repo/historicoControl` mezclaba las dos cosas: dos consultas y un `parte()` que cruza cuatro fuentes. Se partió en `historico.service.js` + `historico.repo.js`.
- `services/flotaViva/rutas` y `franjas` no eran servicios de dominio sino repositorios (16 y 12 consultas sobre las tablas `fv_*`). El comprobador los acusaba por vivir en `services/`; ahora `scripts/comprobar-capas.js` lleva una lista escrita a mano, `CAPA_DECLARADA`, que declara qué es cada uno.

De 15 infracciones iniciales quedan 2, y ninguna es de Control.

## Permisos

Las claves de permiso son prefijos de ruta y **manda el prefijo más largo** (`services/permisos.js`):

- `/control` — En directo (y Campañas, por la tabla de alias)
- `/control/historico`, `/control/km`, `/control/reportes` — submódulos con llave propia
- `/callcenter`, `/alertas`, `/justificantes` — módulos aparte
- `/alertas/config` — **`manual`**: nace apagado hasta para quien lleva el catálogo entero y se reparte usuario a usuario

Hay una tabla `RUTA_A_CLAVE` que existe por un fallo real: `/control/reporte/excel` no casa por prefijo con `/control/reportes`, así que caía en `/control`. Resultado: quien solo tenía "Reportes de control" abría la pestaña y cada botón le daba 403, y quien tenía "En directo" sin Reportes se descargaba todo igualmente. Ahí están mapeadas las descargas, `/control/api/km-*` → `/control/km`, las llamadas y trazos → `/control/historico`, y `/flota-viva` → `/control` (sin esa línea las APIs del cockpit quedarían sin dueño en el catálogo, o sea, abiertas a cualquiera con sesión).

Los **backfills** de `/flota-viva/api/*` piden rol de desarrollador o superadmin, y eso se comprueba en el controlador (`soloDev`) porque es autorización, no negocio. Si el rango es largo se van a segundo plano: un mes son minutos y el HTTP se corta a la mitad. Todos son idempotentes. Ver [[Permisos]].

## Las reglas del módulo

**Todo va por JORNADA OPERATIVA (05→05), no por fecha de calendario.** El mismo día para el plan, la actividad, las llamadas y las J. Cuando no lo era, entre las 00:00 y las 05:00 se pintaban los badges del lunes sobre el plan del martes y dos operadores llamaban al mismo conductor. La jornada la dice `services/repo/llamadas.diaOperativoHoy()` y es la única. Ver [[Jornada y turnos]].

**La llamada se escribe UNA vez**, en `llamada_seguimiento`. Hasta `db/131-call-center-una-sola-historia.sql` se copiaba además al Call Center con la clasificación clavada en el código, así que allí una avería en ruta y un conductor que no coge el teléfono entraban como la misma cosa. Ahora el Call Center **lee** estas llamadas y las clasifica por su tipo y su caso (`DESDE_CONTROL` en `modules/Control/callcenter.service.js`): una copia envejece, una lectura no puede.

**El informe del histórico se camina, no se resta.** Tope de 7 días, porque cada día recalcula el cockpit entero contra el núcleo (unos 5 s) y un mes de una sentada serían dos minutos y medio de petición colgada. Y el calendario se recorre día a día (`diaSiguiente()`) porque el día del cambio de hora tiene 23 o 25 y restar bloques de 24 se salta una jornada. Los partes se piden **de uno en uno**: cada uno ya paraleliza sus consultas por dentro y siete a la vez ahogan el pool.

**Campañas son dos vistas de la misma cosa.** El gestor ve la operativa (a quién llamar); admin y desarrollador entran al informe (cómo va el día). Quién ve qué es una regla y vive en `control.service.vistaDeCampanas()`, no en la plantilla. Las tres pasadas tienen ventana propia (`modules/Control/campanas.service.js`): día 10-11, 11-12, 12→17; noche 18-19, 19-20, 20→05. Las ventanas abren y cierran pero **no bloquean botones**: dicen cuál es la campaña activa, y si alguien quiere adelantar una llamada es su criterio.

**Una J pendiente es presunta.** Cuenta como hora presunta (azul) hasta que alguien la mira; la aprobada es la única que entra en bitácora y en nómina; la rechazada es una alerta para volver a llamar. Una J rechazada tiene **dos finales** —rehacerla o cerrarla— porque sin ellos el caso se quedaba abierto para siempre: la alerta pedía llamar y no había forma de decir que ya se había llamado (`modules/Control/justificantes.service.js`).

**La asistencia llega hasta ayer.** La jornada de hoy no ha terminado y quien entra a las 17:00 aún no ha faltado a nada.

**La auditoría de los lunes no tiene botón, a propósito.** Se pidió como un vistazo puntual, no como un reporte semanal: se baja por URL (`/control/auditoria-lunes/excel?lunes=8`, máximo 12).

## El núcleo está fuera, y por qué

`services/flotaViva/` es el **núcleo de la ingesta**: `fv_tramo`, `fv_ruta`, las franjas y las fuentes de [[BOLT]] y [[Mapon]]. Lo leen también Nóminas, Visibilidad, Bitácora, Sanciones e Inicio. Meterlo dentro de Control obligaría a media casa a entrar por la puerta de este módulo.

Lo que **sí** entró es lo que solo usaba Control: el cockpit (`directo.js`, 940 líneas sin una sola consulta → `cockpit.service.js`) y las incidencias del coche y su gestión (`panel.js` → `panel.service.js`).

Lo que se quedó fuera y no por descuido: `services/repo/llamadas` y `services/repo/justificantes` los leen también Bitácora, Calificación y Rendimiento. Un repositorio puede llamar a otro repositorio; si entraran aquí, esos tres estarían entrando al repositorio de otro módulo. `services/auditoriaPdf` tampoco entra: lo comparte con Operaciones.

## Lo que aún no está bien

**Dos pools sobre una sola base.** `FLOTA_VIVA_DB_URL` (variable de entorno) nació apuntando a otra base, pero hoy seis repositorios leen `fv_*` por el pool principal contra la misma base. El cockpit **no hace JOIN en SQL** entre los dos mundos precisamente por eso: pide cada fuente a su pool y las cruza en JS por matrícula normalizada, que es lo único que comparten, "así funciona apunten donde apunten las dos". Conviene colapsarlos antes de que alguien dé por hecho que son bases distintas. Ver [[Base de datos]].

**`panel.service.js` lleva 17 consultas dentro.** Es un servicio con su SQL pegado. Se movió primero y se parte después: mover y partir a la vez es como se pierde una ruta sin enterarse.

**El LEEME va un paso por detrás en un punto.** `modules/Control/LEEME.md` dice que el Call Center sigue sobre hojas; el código ya no: `modules/Control/callcenter.repo.js` escribe en la tabla `llamada_cc` de PostgreSQL desde `db/131`. Lo que sí sigue siendo cierto es que su lógica (catálogo, KPIs, clasificación) es de Control y no la usa nadie más.

## Ver también

[[Control En directo]] · [[Control Reportes]] · [[Control Alertas]] · [[Control Coches sin cuadrante]] · [[Flota viva]] · [[Jornada y turnos]] · [[Permisos]] · [[Glosario]]
