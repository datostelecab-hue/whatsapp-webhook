---
tags: [nucleo, horas, bitacora, calificacion, reportes]
aliases: [Promedio de la casa, Promedio h/día, Promedio de horas de la casa]
---

# Promedio de horas (el de la casa)

Desde el **15/10/2026** el promedio de horas por día de una persona **se calcula una sola vez y de una sola manera**, y lo leen todos. Camilo: *«la letra debe de calcularse igual en todas partes, pon lo del cálculo de las horas como un estándar en todas partes, hasta en los reportes»*.

Venía de Lucía Peralta, que el mismo día tenía tres medias: **5,8 h** en su ficha, **9,23 h · A** en el planificador y **10 h** (7,5 h «contando la ausencia») en la [[Bitacora|bitácora]]. Ninguna estaba rota, pero cada pantalla medía otra cosa. Ahora las tres dicen **10 h**.

## La regla

```
promedio = horas ÷ (días que salió + «Ausencias», cada una a 0 h)
```

- **Las horas de un día**: las de BOLT de su turno (las de la bitácora, selladas en `bitacora_horas`, con la regla del turno de [[Jornada y turnos]]) **más las J aprobadas**. Una J pendiente cuenta el día con lo que hizo en BOLT, pero sus horas no hasta que alguien la apruebe.
- **Cuentan** los días que salió (con horas o con una J) y las **Ausencias**: días con plaza en los que le tocaba y no salió sin nada que lo explique. Valen 0 h.
- **No cuentan**: libranzas, vacaciones, bajas, permisos, situaciones sin marca (suspensión, retirada del permiso, pendiente de asignar), **días sin plaza** y los días fuera de contrato (salvo que trabajara).
- **Hasta ayer.** Hoy va a medias y entra mañana.
- El periodo, por omisión, es el **mes corrido**: del día 1 (o del alta) a ayer.

La «media de los días que salió» (horas ÷ días que salió) sigue existiendo, pero **solo como detalle**, debajo del número grande.

## Dónde vive y quién lo lee

`modules/Operaciones/bitacora.service.js` → `promedioHoras({ desde, hasta })`, sobre la rejilla de la bitácora (la misma que pinta la pantalla). `mediaDelMes` es el mismo cálculo con el nombre de antes.

| Dónde se ve | Cómo llega |
|---|---|
| **Bitácora** (persona) | `resumen()` y `mediaKpi()` hacen la misma cuenta en la pantalla: «Promedio h/día», y debajo «X h los días que salió» si hubo ausencias |
| **Bitácora general** | la columna y el orden por horas, con la misma cuenta |
| **Ficha** (la hoja de un vistazo) | `plantilla.service.hoja` lo pide para el mes y para el anterior. Antes salía de BI, por día natural |
| **La letra** (calificación A–D, modelo **2.2**) | `recalcularPromedios` le pasa el promedio. Ver [[Calificacion de conductores]] |
| Planificador, cockpit, campañas, reporte de horas, asistencia, iceberg | leen la calificación (`rendimiento.leer()` o `v_conductor_calificacion`) |
| `conductor_rendimiento` (los «días a 0» de la asistencia) | también con `recalcularPromedios` |
| Excel de Plantilla | `mediaDelMes` |

**Por dónde se recalcula**: `bitacora.service.recalcularPromedios()`. Es lo que llaman los crons de las 05:40 y de las 12:00 y el enlace de cuentas fantasma. Un repositorio no puede llamar a un servicio, así que la calificación y el rendimiento reciben el promedio como parámetro (`promedioHoras`). **Sin él no se calculan**: una letra con otra cuenta de horas es justo lo que se quitó.

## Lo que hubo que cambiar para que fuera el mismo

- **La rejilla sabe los días sin plaza** (`sinPlaza`) y las **situaciones sin marca** (`situaciones`). Antes la pantalla los pintaba como «Ausencia» y el servidor no, y quien estaba en el banquillo salía con ausencias que no eran suyas. Ahora se pintan «sin plaza» o con el nombre de la situación, en gris, y no cuentan.
- **La letra deja de poner las libranzas, vacaciones y bajas a 8 h.** En 2.1 cada día del periodo valía algo: horas, 8 h si estaba cubierto, o 0. En 2.2 esos días no cuentan. Medido el 15/10/2026 con el mes corrido: **cambiaban 37 letras de 205** (las D pasaban de 9 a 22). Las 8 h acolchaban a quien rendía poco: Brayan Rozo salió 3 días y faltó 1 (5,0 h), y sus 8 días de baja a 8 h le dejaban en 7,1 h · A.
- **La ficha cuenta por jornada.** BI (`bi_conductor_mes.horas_por_dia`) divide entre días naturales, y al turno de noche le parte cada turno en dos. La capa BI se queda como está para Power BI; la pantalla ya no la usa para el promedio.

## Ver también

- [[Bitacora]] · [[Calificacion de conductores]] · [[Conductores]] · [[Jornada y turnos]]
