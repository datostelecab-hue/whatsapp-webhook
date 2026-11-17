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

### «Han salido» y «Conectados ahora», al día (28/10/2026)

Camilo, con una captura: *«han salido 25, planificador 23 + 2 NN, pero conectados ahora 35, 31 de noche y 4 de día: ¿por qué se contradicen?»*. Medían cosas distintas en momentos distintos:
- **«Han salido»** contaba a quien ya tenía **horas** en el turno. Las horas llegan con retraso: el motor va cada 5 min y el panel se guarda otros tantos.
- **«Conectados ahora»** viene de la lista en vivo de BOLT (API v2) cada 10 s, **también en descanso**.

Al empezar el turno, quien acaba de conectarse o está en descanso salía conectado pero no «salido». Ahora:
- **«Han salido» se pone al día cada 10 s** (`inicio.conectadosPorTurno` → `salido`). Son los del plan del turno con horas **o que están ahora mismo trabajando** (en viaje o en espera), más los NN por sus horas, como antes. El plan y quién tenía horas los deja apuntados el último cálculo del panel (`delPanel`). Si ese cálculo es de otro turno (justo al cambiar) o tiene más de 40 min, se queda el número del panel.
- **«Conectados ahora» separa a los que están en descanso**: «31 noche (3 en descanso)». La ayuda dice cuántos hay en total.

La gente y sus horas salen de **la misma carga** que el total y los «X conductores»: `repartoTurnos.porTurno(fechas, { gente: true })`, que pasa por `visibilidad.resumen({ gente: true })`. Visibilidad no la pide y no cambia. El nombre es el de BOLT de la ficha, como en todo el ERP; sin ficha, el de su cuenta (`fv_conductor`).

Después, **los kilómetros por turno** sin tocar (*«la de los KM está perfecta»*) y, abajo y en pequeño, **el resto**: hoy por día natural, la semana, el neto y la utilización del mes y las horas **no efectivas** (lo que faltó para la jornada de quien debía salir, por persona y sin compensar, solo de jornadas cerradas, de `bitacora_horas`).

Las gráficas son SVG propio, sin librerías, con los colores del tema (`--tc-*`), para que el inicio cargue al momento.

## Cómo va cada zona (17/11/2026)

Camilo: *«en inicio, en la parte de abajo abajo, pon el resumen de cómo va cada zona: Canillejas 450 h de 500 que debía hacer, Alcorcón, etc. Si el coche no tiene CT, esos días no suman horas que debía hacer… si no había nadie, esas 8 horas se perdieron… si hoy el coche pasa de Alcobendas a Canillejas, en el lapso de esa fecha debían hacer tantas horas hasta que se cambió. Lo mismo cuando se pone en taller… es un resumen, más no gráficos complejos, algo sencillo y ejecutivo»*.

Abajo de todo, una fila por zona (y el total): **las horas que hizo contra las que debía hacer**, su porcentaje con el color de la meta y una barra fina. Debajo, en pequeño, los coches, lo que debe en todo el mes, las horas de turnos sin nadie y los días de taller o parado.

- **Días cerrados, hasta ayer a las 24:00** (Camilo: *«¿es en vivo o día cerrado?»*). Hoy no entra ni en lo que debía ni en lo que hizo: aún corre y saldría siempre por debajo. El día 1, el mes anterior entero.
- **Las reglas son las del informe de rendimiento** de [[Control Reportes]] (`modules/Control/rendimiento.service.js`): cada turno que le toca a un coche, 8 h; un coche con correturnos, los dos turnos todos los días (si falta el CT se pide igual: son horas perdidas); uno **sin correturnos**, no se pide el turno del fijo que libra; los días **en taller o parado** no se piden ni cuentan sus horas (salvo que BOLT diga que rodó); las horas son las del coche en BOLT, lo lleve quien lo lleve.
- **Cada día va a la zona que tenía el coche ese día** (`vehiculo_zona`, `db/264`). Antes del 17/11/2026 no había ningún registro: hasta ahí, la zona de ese día.
- Los **cuadrantes libres** (coches sin cuadrante) son una zona más y suman al total, como en el informe.
- Va aparte del panel (`GET /inicio/api/zonas`, `inicio.zonas`) y se guarda **una hora**: es el informe del mes entero y, como llega hasta ayer, apenas cambia en el día. Con la copia de octubre tarda menos de medio segundo.
