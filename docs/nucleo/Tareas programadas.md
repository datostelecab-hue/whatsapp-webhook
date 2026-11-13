---
tags: [nucleo, crons, hoja-de-ruta]
actualizado: 2026-11-13
---

# Tareas programadas

Desde el 13/11/2026 (db/246) las **tareas de negocio** que el ERP hace solo en su momento se registran en `services/tareasProgramadas.js`. Es la pieza A10 de la [[Hoja de ruta]]. Las tareas que la usarán:
- el informe de pendientes de nómina del día 20 (ítem 7);
- los vencimientos del tablero (ítem 1);
- las ITV a 30 días (ítem 14);
- las pólizas a 60 días (ítem 19);
- las alarmas de mantenimiento (ítem 20).

Los crons que ya había en `app.js` (la ingesta, las bajas programadas, las citas…) **siguen como estaban**.

## Por qué no un cron por tarea

Con un cron a secas pasan tres cosas que aquí no pueden pasar:

- **En cada despliegue conviven dos procesos un rato.** El informe del día 20 saldría dos veces y crearía cada tarea dos veces. El 13/11/2026 se vio lo mismo, a lo grande: el [[Servidor de pruebas en Render]] corrió diez minutos contra la base de producción.
- **Si el servidor está caído a esa hora, la tarea no se hace nunca.**
- **Si el proceso muere a medias** (un despliegue manda SIGTERM y `app.js` sale en el acto), queda hecha a medias.

## Cómo funciona

Hay **una sola vuelta cada diez minutos** que pregunta a cada tarea qué veces le tocan ya:

```js
const tareasProgramadas = require('../../services/tareasProgramadas');
const { cuando } = tareasProgramadas;

tareasProgramadas.registrar({
  clave: 'nomina.pendientes_dia_20',
  descripcion: 'Informe de pendientes de nómina',
  desde: '2026-12',                        // la primera vez que tiene que hacer
  toca: ahora => cuando.mensualHabil(ahora, { dia: 20, hora: '08:00' }),
  hacer: async ({ periodo, cli }) => ({ tareas: await crearPendientes(cli, periodo) }),
});
```

- **`toca(ahora)` devuelve las veces que ya deberían estar hechas.** Son la de ahora, si ya toca, y **la anterior**, para recuperarla si se perdió. Se hacen las que no estén hechas. Hay dos ayudas:
  - `cuando.diaria(ahora, { hora })` devuelve ayer y, si ya es la hora, hoy (hora de Madrid);
  - `cuando.mensualHabil(ahora, { dia, hora })` devuelve el mes anterior, este si ya llegó su día y el siguiente si su día cae en este mes. Si el día no es hábil, se toma el hábil anterior con el [[Calendario laboral]], aunque caiga en el mes de antes: el día 1, si es domingo, toca el viernes 30. Si el mes es más corto, su último día.
- **`desde`** evita que una tarea recién estrenada haga las veces de antes.
- **`hacer({ periodo, cli })`** hace la tarea **con el `cli` que recibe** y devuelve **recuentos**.

## Una sola vez, de verdad

`una(tarea, periodo, fn)` trabaja dentro de **una transacción**:

1. Toma un **cerrojo de la base** para esa tarea y esa vez (`pg_try_advisory_xact_lock`). Si lo tiene otro proceso, se salta.
2. Mira si ya está hecha. Si lo está, se salta.
3. Hace la tarea con ese `cli`.
4. Apunta la vez como **hecha en la misma transacción** (`tarea_programada_vez`).

**El trabajo de la tarea y su «hecha» entran juntos o no entra ninguno.** Si el proceso muere a medias, la base lo deshace todo y suelta el cerrojo sola. La siguiente vuelta la hace entera, sin duplicados y sin esperar a nadie.

**Lo que sale fuera de la base** (un correo, un WhatsApp) no se deshace. Va al final de `hacer`, o lleva su propia marca de «ya enviado».

**Si falla**, se apunta el intento como `fallida`, con el error, y se reintenta más tarde: a los 10, 30, 60 y 120 minutos. **Al quinto fallo se deja** y lo dice el log, porque hay que mirarlo. Una tarea que falla no para a las demás.

**El resultado guarda solo recuentos**: números, sí/no y textos cortos. Lo demás se quita y se cuenta como «sin guardar», porque la tabla no se borra nunca y no puede acabar con listas de personas.

**Nada se borra**: la tabla no admite DELETE ni TRUNCATE. `ultimas()` devuelve los últimos intentos.

**Con `MODO_PRUEBAS` no arranca**, como todos los crons (lo decide `programar` en `app.js`). En el servidor de pruebas la vuelta sale entre los crons no arrancados de `/modo-pruebas`. **Si una vuelta no ha acabado, la siguiente no empieza.**

El SQL vive en `services/repo/tareasProgramadas.js` (regla 1 de la casa).

## Lo que falta

- **A quién se avisa si una tarea se deja tras cinco fallos.** Hoy queda en el log y en la tabla. Con los avisos del ítem 3 se avisará al desarrollador.
- **Una pantalla con los últimos intentos**, para el desarrollador.
- **Pasar aquí los crons de `app.js` que se beneficien**, de uno en uno, al tocar cada módulo.

## Pruebas

`test/tareas-programadas.test.js` comprueba:
- una vez por periodo;
- que lo escrito y el «hecha» entran juntos (si falla a medias no queda nada);
- otro proceso con el cerrojo, con una segunda conexión de verdad;
- los reintentos con pausa y tope;
- el resultado sin listas de personas;
- que los intentos no se borran;
- la hora de Madrid y la recuperación de ayer;
- el criterio del ítem 7: el día 20 o el hábil anterior, con la recuperación del mes anterior;
- el día 1 que cae en fin de semana;
- `desde` y la vuelta entera.

Ver [[Pruebas automáticas]].
