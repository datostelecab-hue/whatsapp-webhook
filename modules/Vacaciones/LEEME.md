# Vacaciones (`/vacaciones`)

El saldo de vacaciones de cada persona de PLANTILLA PROPIA con contrato abierto
(los de ETT, no: sus vacaciones se las da la agencia), y de dónde sale cada
número. Poner o borrar unas vacaciones sigue siendo de Plantilla, con la llave de
aprobar (una sola persona, db/189). CAMBIAR LAS FECHAS de unas ya aprobadas, solo
lo que aún no ha llegado, se puede también desde aquí (16/10/2026), con la misma
llave y sin soltarlas de su ticket, que apunta el cambio (`cambiarVacaciones`).
La regla de «solo a futuro» vive en `services/vacacionesAFuturo.js` y la aplica
también Plantilla al corregir o borrar unas vacaciones.

```
vacaciones.controller.js   la pantalla y la API (/api/lista, /api/ficha/:id,
                           PUT /api/conductor/:id/vacaciones/:filaId)
vacaciones.service.js      LA CUENTA (saldoDe, pura), las horas de los festivos (sellarFestivos)
                           y cambiar unas aprobadas (cambiarVacaciones, con validarCambio pura)
vacaciones.repo.js         contratos, ausencias, festivos, horas de cada festivo, días
                           laborados, J aprobadas y lo planificado (planes)
libranzas.js               qué le tocaba cada día (pura): las libranzas no cuentan
vistas/vacaciones.ejs      el Listado: el saldo debajo de cada nombre y, en la ficha, el extracto
```

Las reglas (Camilo, 14/10/2026), en la cabecera del servicio: 0,05882 días por cada
DÍA LABORADO —un día con MÁS de 4 h de viaje + espera de BOLT— desde el alta (o desde
el 01/01/2026 —antes del 19/10/2026 era el 01/01/2025—; lo de antes no cuenta para
nada), y también cada día con una J aprobada y cada día de baja médica que le tocaba
trabajar; + 1 día por festivo trabajado más de 6 h; − vacaciones disfrutadas, SOLO los
días que le tocaba trabajar (sus libranzas se mantienen: `libranzas.js`, la regla de
f_cobertura sin apartar al ausente; la plaza de ese día o la última que tuvo; antes del
planificador, 03/09/2026, no se sabe y cuentan). Ningún permiso resta. Hasta el
06/11/2026 eran 0,0821 por día natural, sin las suspensiones.

«Simular vacaciones» (ficha, GET /api/simular/:id?desde&hasta): el calendario de unas
fechas, qué días cuentan y cuáles libra, y lo que le quedaría. No guarda nada.

LOS DÍAS LABORADOS (`repo.diasLaborados`): desde el 01/07/2026, los de la bitácora
(`bitacora_horas`); antes, `bolt_jornada_historico` (db/231), las jornadas de 05:00 a
05:00 de cada CUENTA de BOLT sacadas del historial de estados, repartidas a cada
persona al leer (conductor_externo y cuentas prestadas), como la bitácora. Una
cuenta que se enlace después trae sus días sola.

Los ASUNTOS PROPIOS van en un banco aparte (29/10/2026, db/225): 2 días por año
natural, enteros y acumulables, menos cada día en la situación «Asuntos propios»
de Plantilla. No tocan el saldo de vacaciones (`saldoDe` → `asuntosPropios`).

Las horas de un festivo son las de la nómina (`nominas.service.horasDelDia`) y se
guardan en `festivo_horas`: desde el 01/07/2026 las pone el cron horario de
`app.js`; las de antes, db/198 desde el historial de BOLT. Calendario y llave
`/vacaciones`: db/197. Comprobador: `scripts/comprobar-vacaciones-saldo.js`.

La nota completa: `docs/modulos/Vacaciones.md`.
