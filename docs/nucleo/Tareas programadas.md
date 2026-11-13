---
tags: [nucleo, crons, hoja-de-ruta]
actualizado: 2026-11-13
---

# Tareas programadas

Desde el 13/11/2026 (db/246) las **tareas de negocio** que el ERP hace solo en su momento se registran en `services/tareasProgramadas.js`. Es la pieza A10 de la [[Hoja de ruta]]. Las que traen sus ítems:
- el informe de pendientes de nómina del día 20 (ítem 7);
- los vencimientos del tablero (ítem 1);
- las ITV a 30 días (ítem 14);
- las pólizas a 60 días (ítem 19);
- las alarmas de mantenimiento (ítem 20).

Los crons que ya había en `app.js` (la ingesta, las bajas programadas, las citas…) **siguen como estaban**.

## Por qué no un cron por tarea

Con un cron a secas pasan dos cosas que aquí no pueden pasar:

- **En cada despliegue conviven dos procesos un rato.** El informe del día 20 saldría dos veces y crearía cada tarea dos veces.
- **Si el servidor está caído a esa hora, la tarea no se hace nunca.**

## Cómo funciona

Hay **una sola vuelta cada diez minutos** que pregunta a cada tarea si ya le toca su vez:

```js
const tareasProgramadas = require('../../services/tareasProgramadas');
const { cuando } = tareasProgramadas;

tareasProgramadas.registrar({
  clave: 'nomina.pendientes_dia_20',
  descripcion: 'Informe de pendientes de nómina',
  toca: ahora => cuando.mensualHabil(ahora, { dia: 20, hora: '08:00' }),   // '2026-12' o null
  hacer: async ({ periodo }) => ({ tareas: await crearPendientes(periodo) }),
});
```

- **`toca(ahora)`** devuelve el periodo que ya debería estar hecho («2026-12») o `null` si aún no toca. Hay dos ayudas:
  - `cuando.diaria(ahora, { hora })`: una vez al día desde esa hora de Madrid;
  - `cuando.mensualHabil(ahora, { dia, hora })`: una vez al mes ese día; si no es hábil, el hábil anterior, con el [[Calendario laboral]]. Si el mes es más corto, su último día.
- **`hacer({ periodo })`** hace la tarea. Lo que devuelve se apunta como resultado.

Cada vez se hace **una sola vez**: `una(tarea, periodo, fn)` apunta cada intento en `tarea_programada_vez`, y un índice único deja una sola vez en curso o hecha por tarea y periodo. El segundo proceso que llega no la empieza.

**Recupera lo perdido.** Mientras la vez no esté hecha, `toca` sigue devolviendo su periodo: si el servidor estaba caído el día 18, la vuelta del 21 lo hace.

**Si falla**, queda apuntado el error y la siguiente vuelta la reintenta. **Si el proceso murió con ella a medias**, pasadas dos horas se da por abandonada y se reintenta. Una tarea que falla no para a las demás.

**Nada se borra**: cada intento se queda con su estado (`hecha`, `fallida`, `abandonada`), su resultado o su error, y qué proceso lo hizo. `ultimas()` los devuelve.

**Con `MODO_PRUEBAS` no arranca**, como todos los crons (lo decide `programar` en `app.js`). En el servidor de pruebas la vuelta sale entre los crons no arrancados de `/modo-pruebas`.

## Lo que falta

- **A quién se avisa si una tarea falla.** Hoy queda en el log y en la tabla. Con los avisos del ítem 3 se avisará al desarrollador.
- **Una pantalla con los últimos intentos**, para el desarrollador.
- **Pasar aquí los crons de `app.js` que se beneficien** (las bajas programadas ya se recuperan por su cuenta, cada hora): de uno en uno, al tocar cada módulo.

## Pruebas

`test/tareas-programadas.test.js` comprueba:
- una vez por periodo;
- otro proceso con ella en curso;
- la que se quedó a medias;
- el reintento tras un fallo;
- que los intentos no se borran;
- la hora de Madrid;
- la vuelta entera;
- el criterio del ítem 7: el día 20 a las 08:00 y, si no es hábil, el hábil anterior (en diciembre de 2026, el viernes 18), con la recuperación si se perdió.

Ver [[Pruebas automáticas]].
