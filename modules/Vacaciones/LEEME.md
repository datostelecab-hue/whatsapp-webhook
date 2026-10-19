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
vacaciones.repo.js         contratos, ausencias, festivos y horas de cada festivo
vistas/vacaciones.ejs      el Listado: el saldo debajo de cada nombre y, en la ficha, el extracto
```

Las reglas (Camilo, 14/10/2026), en la cabecera del servicio: 0,0821 días por día
natural desde el alta (o desde el 01/01/2026 —antes del 19/10/2026 era el 01/01/2025—;
lo de antes no cuenta para nada), sin los días de suspensión; + 1 día
por festivo trabajado más de 6 h; − vacaciones disfrutadas; − cada día de permiso
retribuido.

Las horas de un festivo son las de la nómina (`nominas.service.horasDelDia`) y se
guardan en `festivo_horas`: desde el 01/07/2026 las pone el cron horario de
`app.js`; las de antes, db/198 desde el historial de BOLT. Calendario y llave
`/vacaciones`: db/197. Comprobador: `scripts/comprobar-vacaciones-saldo.js`.

La nota completa: `docs/modulos/Vacaciones.md`.
