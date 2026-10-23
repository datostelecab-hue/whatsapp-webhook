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

## Quién lleva ya su jornada (23/10/2026)

Camilo: *«en la tarjeta del turno actual quiero una previsión: de los 64 conductores que están, cuántos ya cumplieron sus 8 horas, a cuántos les falta por cumplir sus 8 horas, y al darle click que me detalle los nombres y las horas que llevan, de mayor a menor, para saber si llegaremos o no; también agrégalos a las tarjetas del turno anterior»*.

En el turno en curso, el anterior y la jornada pasada:

- **Cuántos llevan ya su jornada y a cuántos les falta**, con las horas que faltan entre todos. La jornada es `jornada_h` de la configuración de Visibilidad (8 h si nadie la ha puesto), la misma de las horas no efectivas. En la jornada pasada, lo de cada uno es su día más su noche.
- **La previsión**, mientras el turno aún suma: si todos los que faltan completaran su jornada, a cuánto llegaría el turno frente a su meta, y cuántos de ellos siguen conectados (esos aún pueden llegar). Con el turno cerrado se dice cuánto les faltó.
- **Al pulsar**, la lista de la gente de mayor a menor (`Dialogo.aviso`), partida en «ya llevan sus 8 h» y «les faltan», con lo que hace cada uno ahora en BOLT (la foto compartida de `flotaViva/ahora`) y si es NN.

**En el turno en curso, todos los planificados** (Camilo, 23/10/2026 por la tarde: *«pon a todos los planificados, así tengan 0 horas, y la previsión de cuántas horas se pueden hacer si todos hacen sus 8 horas»*; a las 18:05 la tarjeta decía «si los 21 completan, 168 h» y confundía). La lista del turno en curso es quien lo tiene en el plan —el de Control: `f_cobertura` con los eventos, sin vacaciones ni bajas— más los NN que ya han salido; los planificados sin horas van en su grupo, «Aún no han salido». La previsión es la de todos haciendo su jornada: cada uno con sus horas o con sus 8 h si aún no llega. Y **en vivo**: **deben salir** (el plan), **han salido** (plan + NN, los «X conductores» de la tarjeta) y **conectados ahora** (en viaje, en espera o en descanso, según la foto del ahora). El turno anterior y la jornada siguen con quien hizo horas.

La gente y sus horas salen de **la misma carga** que el total y los «X conductores»: `repartoTurnos.porTurno(fechas, { gente: true })`, que pasa por `visibilidad.resumen({ gente: true })`. Visibilidad no la pide y no cambia. El nombre es el de BOLT de la ficha, como en todo el ERP; sin ficha, el de su cuenta (`fv_conductor`).

Después, **los kilómetros por turno** sin tocar (*«la de los KM está perfecta»*) y, abajo y en pequeño, **el resto**: hoy por día natural, la semana, el neto y la utilización del mes y las horas **no efectivas** (lo que faltó para la jornada de quien debía salir, por persona y sin compensar, solo de jornadas cerradas, de `bitacora_horas`).

Las gráficas son SVG propio, sin librerías, con los colores del tema (`--tc-*`), para que el inicio cargue al momento.
