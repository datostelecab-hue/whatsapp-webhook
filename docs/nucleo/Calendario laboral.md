---
tags: [nucleo, calendario, hoja-de-ruta]
actualizado: 2026-11-13
---

# Calendario laboral

Desde el 13/11/2026, los **días y las horas hábiles** se calculan en un solo sitio: `services/calendario.js`. Es la pieza A2 de la [[Hoja de ruta]] y responde a su convención 3: «Días y horas hábiles los calcula el sistema […] Ningún plazo se calcula a mano».

No es la [[Jornada y turnos|jornada operativa]] (de 05:00 a 05:00), que es la de los conductores. Esto es el calendario de la **oficina**: el que cuenta los plazos de la gente que trabaja en ella.

## Qué es hábil

- **Un día hábil** es un día del horario de la oficina que no es festivo.
- **Una hora hábil** es una hora dentro de ese horario, en un día hábil.

**El horario** es un parámetro: `oficina.madrid.horario`, editable en [[Parametros]]. Camilo, 13/11/2026: de lunes a viernes, de 09:00 a 18:00.

**Los festivos** salen de dos tablas:

| De dónde | Qué | Para qué sede |
|---|---|---|
| `festivo` (db/197) | Los 12 del convenio: nacionales y de la Comunidad de Madrid | Los nacionales, para todas; los de la Comunidad, para Madrid |
| `festivo_oficina` (db/244) | Los de la oficina que no son del convenio: San Isidro y la Almudena de Madrid capital (2025 y 2026) | Por sede |

**`festivo` no se toca.** Es de [[Vacaciones]]: cada festivo trabajado suma días a quien lo trabajó, y `sellarFestivos` no mira el ámbito. Meter ahí San Isidro regalaría días de vacaciones a los conductores que lo trabajaron. Por eso los locales van aparte.

## Las cuentas

```js
const calendario = require('../../services/calendario');
const cal = await calendario.de('madrid');

cal.esHabil('2026-11-09')                    // false: la Almudena
cal.sumarDiasHabiles('2026-12-03', 5)        // '2026-12-14': salta el puente de diciembre
cal.restarDiasHabiles('2026-12-25', 4)       // '2026-12-21': «4 días hábiles antes del corte»
cal.habilEnOAntes('2026-12-20')              // '2026-12-18': «si el 20 no es hábil, el hábil anterior»
cal.diasHabilesEntre(hoy, plazo)             // los que quedan (negativo: los que ya pasaron)
cal.semaforo(plazo, hoy)                     // 'verde' | 'amarillo' (el último día) | 'rojo' (vencido)
cal.sumarHorasHabiles(new Date(), 5)         // el instante en que vencen 5 horas hábiles
calendario.hoy()                             // el día de hoy en Madrid, 'aaaa-mm-dd'
```

- **N días hábiles desde un día** empiezan a contar el día siguiente; el plazo vence al acabar el N-ésimo hábil.
- **Las horas hábiles** solo corren dentro del horario. Lo que empieza fuera, empieza a contar al abrir: un siniestro del sábado a las 10:00, con 5 horas, vence el lunes a las 14:00.
- **Todo va en hora de Madrid**, con el cambio de hora. Las fechas viajan como texto `aaaa-mm-dd` y nunca pasan por `toISOString` con una fecha local (ver [[Trampas conocidas]]).
- **Un plazo se calcula una vez, al nacer, y se guarda.** Si cambia el horario o un festivo, lo que ya corría no se mueve.

El núcleo son funciones puras sobre un calendario (`calendario.crear`): se prueban sin base. `calendario.de(sede)` lo monta con lo de la base, con una caché de diez minutos.

## Lo que falta

- **Los festivos de 2027**, de la Comunidad y de Madrid capital, por migración. Si se pide un día de un año sin festivos cargados, el servicio lo dice una vez en el log y solo cuenta los fines de semana.
- **Barcelona.** Camilo, 13/11/2026: más adelante. La tabla ya lleva la sede: sus festivos de Cataluña y de Barcelona ciudad entrarán en `festivo_oficina`, y su horario será otro parámetro.
- **Una pantalla de festivos.** Hoy se cargan por migración, como siempre.
- **Usar `calendario.hoy()` en lo que ya existe.** El «hoy» se calcula en más de 50 sitios con distintos nombres, y en 6 ficheros en UTC. Se cambia al tocar cada módulo, no de golpe.

## Pruebas

`test/calendario.test.js`. Además de las cuentas, prueba los criterios de aceptación de la hoja de ruta que son pura cuenta de calendario:

| Ítem | Criterio |
|---|---|
| 5 | El plazo cuenta 5 días hábiles y salta fines de semana y festivos |
| 6 | La fecha límite es 4 días hábiles antes del corte |
| 7 | Si el 20 no es hábil, se toma el hábil anterior |
| 10 | Las 24 horas hábiles de una multa urgente cruzan el fin de semana |
| 18 | Un siniestro del sábado empieza a contar sus 5 horas el lunes al abrir |
| 1 | El semáforo: verde, amarillo el último día y rojo |

Ver [[Pruebas automáticas]].
