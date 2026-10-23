---
tags: [modulo, inicio, visibilidad, control]
aliases: [Panel de inicio, Inicio]
---

# Inicio

La pantalla en la que cae todo el mundo al entrar (`/inicio`). **No se bloquea nunca**: su permiso decide QUÉ se ve, no si se entra. Sin él, la bienvenida con los módulos que esa persona sí puede abrir; con él, las cifras de la flota.

| Pieza | Dónde |
|---|---|
| La ruta | `routes/inicio.js` (`GET /inicio` y `GET /inicio/api/panel`); la excepción de entrar siempre está en `SIEMPRE_ABIERTO` de `services/sesion.js` |
| Las cifras | `services/inicio.js` (`panel`, con caché de 5 min y refresco por detrás) |
| De dónde salen las horas | `visibilidad.resumen()` y `visibilidad.serieMes()`, tal cual: ver [[Jornada y turnos]] |
| La vista | `views/inicio.ejs` |

## Lo que se ve (23/10/2026)

Camilo: *«lo más importante siempre serán las horas del mes, las horas del turno actual, si es día o noche, y luego las horas del turno pasado, también de la jornada pasada, si puede ser más gráfico mejor»*. Arriba y en grande:

- **Las horas del mes** (día natural, las de Visibilidad) contra **la meta del mes** de la configuración de Visibilidad. La barra va en dos trozos —los días cerrados y, más claro, lo de hoy, que aún corre— y la raya es **el ideal a cierre de ayer**, que se compara con lo cerrado, igual que el acumulado contra el ideal de Visibilidad. Debajo, **una barra por día** del mes, con la línea del ritmo diario que pide la meta. Son las fotos diarias de Visibilidad y hoy en vivo.
- **El turno en curso**, con su sol o su luna: de 05:00 a 17:00 el de día y de 17:00 a 05:00 el de noche, que es la hora a la que Visibilidad cambia de tarjeta. Sus horas son las de **su gente** (el día de 00:00 a 24:00 y la noche de 12:00 a 12:00, por el turno de cada conductor en el cuadrante; los NN, por su hora de inicio), contra **la meta de su turno**, con el mismo color de rojo a verde que Visibilidad (`colorMeta`). Debajo, viaje contra espera y el reloj del turno (cuánto lleva y cuánto le queda).
- **El turno anterior** y **la jornada pasada** (su día más su noche, contra la suma de las dos metas), esta partida en día y noche.

**Los conductores de cada turno**, pequeños al lado de las horas, son los de Visibilidad partidos en **«del cuadrante + NN»**. Es como los cuenta Control: la pestaña del turno, los del cuadrante que salieron, y la de los NN. Camilo, el mismo día: *«cuadra bien, en control los de cuadrante y NN; eso da en visibilidad un total de día + NN de día y noche + NN de noche, déjalos así»*. No se cuentan aquí: si cambia la regla, cambia en `repartoTurnos`, que es de los dos.

Después, **los kilómetros por turno** sin tocar (*«la de los KM está perfecta»*) y, abajo y en pequeño, **el resto**: hoy por día natural, la semana, el neto y la utilización del mes y las horas **no efectivas** (lo que faltó para la jornada de quien debía salir, por persona y sin compensar, solo de jornadas cerradas, de `bitacora_horas`).

Las gráficas son SVG propio, sin librerías, con los colores del tema (`--tc-*`), para que el inicio cargue al momento.
