---
tags:
  - calificacion
  - rendimiento
  - conductores
  - metricas
  - bitacora
  - postgres
---

# Calificación de conductores

Una letra por conductor y periodo. Es lo que Tráfico ve al lado del nombre —*"Juan Manuel Akieme (9,4 h · A)"*— en el planificador, en el cockpit, en las campañas y en el reporte de horas, para saber a quién está colocando o llamando.

Dos ficheros, y **dos medias distintas** que conviene no confundir:

- `services/repo/calificacion.js` — el modelo **ABCD 2.0**, la letra de verdad.
- `services/repo/rendimiento.js` — el **promedio de horas del mes corrido** (escala S/A/B/C) y, hoy, la puerta por la que las pantallas piden la letra.

## El modelo: tres métricas ponderadas

| Métrica | Peso | Qué es |
|---|---|---|
| **HORAS** | 50 % | promedio **diario** sobre TODOS los días del periodo |
| **UTILIZACIÓN** | 30 % | promedio **diario** del % de tiempo con pasajero |
| **VELOCIDAD** | 20 % | **SUMA ACUMULADA** de excesos del periodo |

> **La trampa del modelo, y está avisada en la especificación:** las dos primeras son promedios diarios y la tercera es un total. Un conductor con 3 excesos en el mes tiene **3**, no 0,10.

Todos los umbrales viven en la constante `MODELO`, en un solo sitio. Recalibrar es cambiarla y subir `version_modelo`; no hay ni un número suelto por el código.

### De dónde sale cada cosa

**HORAS** = horas efectivas de [[BOLT]] (viaje + espera, **sin descanso**) **más** las horas justificadas del día. Se suman: dos horas en el taller con su J más seis rodando son **ocho horas**, no seis. Es la misma cuenta que entiende un conductor y la que ya hacen el reporte y la nómina. Se apoya en `bitacora_horas`, el histórico **sellado**, así que la letra de un periodo cerrado no se mueve porque alguien recalcule algo.

**UTILIZACIÓN** = tiempo en viaje / tiempo efectivo, de `fv_tramo`. Es la definición que ya usan el BI y la nómina variable, así que no aparece un tercer número distinto en la casa. La jornada operativa empieza a las **05:00**, igual que las horas, para que los dos promedios hablen del mismo día. Ver [[Jornada y turnos]].

**EXCESOS** = `velocidad_exceso`, que ya solo cuenta los **atribuidos con certeza**.

### Las J suman a las horas pero NO entran en la utilización

Va separado a propósito. Una J no genera viaje ni espera; meterla en el denominador hundiría el porcentaje de quien pasó la mañana en el taller, **castigándolo dos veces por algo que no decidió él**. Un día sin horas de BOLT no tiene utilización que medir y se excluye de ese promedio (§9.2) — **no del de horas**.

## Qué cuenta como día cubierto

Esta es la parte que más se pregunta. El periodo es el **mes corrido**, del día 1 (o del alta, si entró a mitad) hasta la última jornada cerrada, y **cada día del periodo vale algo**. El orden del `CASE` en `metricas()` es la regla entera:

| | Situación | Vale |
|---|---|---|
| 1 | **Trabajó** | sus horas (BOLT + justificadas). Manda sobre todo lo demás |
| 2 | **Vacaciones, baja o permiso** | **8 h** — descansar cuando toca no puede bajar la media |
| 3 | **Le tocaba y no salió**, sin nada que lo explique | **0**. Este es el que baja, y para eso está |
| 4 | **No le tocaba**, pero el cuadrante le da trabajo otros días (libró) | **8 h** |
| 5 | **Ni trabajo ni plan** | **NULL**: ese día no cuenta ni para bien ni para mal |

Las 8 horas son `horasDiaCubierto`, el objetivo de jornada: **ni premia ni castiga** descansar cuando toca.

"A quién le tocaba salir" es `f_cobertura`, la misma definición que usa todo el ERP ([[Planificacion]]). Lo que no está ahí es libranza.

### Sin cuadrante no hay libranza que valga

El caso 4 tiene una condición que costó descubrir: *"no le tocaba"* solo significa *"libró"* si el cuadrante le da trabajo **algún día del periodo**. A quien no le toca **ningún** día no está librando: **es que no se le ha dado coche**.

> Mirar solo si tiene plaza no basta —se probó— y salían **diez personas con 16 días a 8 h y cero horas rodadas, con letra C sin haber salido una sola vez**. Antes de eso eran N/E, que es lo honesto.

### Por qué el periodo pasó de 14 días al mes

En la versión 1.0 la ventana eran 14 días y **solo contaban los días con horas**: quien libraba, estaba de vacaciones o simplemente no salía **no existía** para el cálculo. Eso tenía dos efectos malos a la vez:

- A quien acababa de entrar no se le podía puntuar. **Elena**, de alta el día 8, tenía 4 días con horas de los 9 que llevaba, y salía **N/E**.
- A quien faltaba no se le notaba: sus ausencias no bajaban nada **porque ni se miraban**.

El mes corrido, además, es como se mira todo lo demás en la casa (el promedio del planificador, la asistencia) y es lo que entiende quien lo lee: *"la letra de septiembre"*, no *"la de los últimos catorce días"*.

## Cuándo NO hay letra (N/E)

N/E no es una nota mala: es *"no se puede decir nada todavía"*. Hay tres puertas, y las tres son deliberadas:

- **Menos de 5 días en el periodo** (`minDiasTrabajados`). Por debajo de eso, N/E — nunca D.
- **Ningún día con actividad que medir.** Quien pasó el mes entero de baja tiene sus días a 8 h —así lo quiere la regla, y con razón— pero cero días con actividad. Metiendo su utilización como 0 % se lleva 0 de los 30 puntos de esa mitad y **sale con una C por estar enfermo**. Es el mismo principio de las J: no se puede puntuar lo que no se ha podido medir.
- **Sin telemetría en el periodo.** Si Mapon estuvo caído **no se asume cero excesos**: asumirlo premiaría un fallo del sistema (§9.3). Y se guarda `dias_telemetria`, porque si son menos que el periodo los excesos están infravalorados y **la letra sale mejor de lo que es** — hay que poder decirlo al mirar la fila, no al mirar el log.

## Las tablas, las bandas y los topes

Cada tabla se lee *"el primero cuyo umbral se alcanza"*.

```
HORAS (media diaria)        ≥9 → 100 · ≥8 → 90 · ≥7 → 70 · ≥6 → 50 · ≥5 → 30 · resto 0
UTILIZACIÓN (%)            ≥80 → 100 · ≥75 → 90 · ≥70 → 85 · ≥60 → 50 · ≥50 → 45 · resto 0
VELOCIDAD (excesos, al revés) 0 → 100 · ≤2 → 90 · ≤3 → 70 · ≤5 → 30 · más 0

BANDAS   ≥85 A · ≥70 B · ≥55 C · resto D
```

Los **topes de seguridad SOLO BAJAN**, y existen para impedir que un volumen alto de horas compense una conducción peligrosa:

- puntos de velocidad ≤ 30 → como mucho **C**
- puntos de velocidad ≤ 70 → como mucho **B**

Se guarda tanto la letra final como `letra_por_puntos` y `tope_aplicado`, para poder explicar por qué alguien con 88 puntos tiene una C.

El **redondeo a 2 decimales, media hacia arriba, es parte de la regla** y no una cuestión de presentación: la letra se decide comparando el total con las bandas, así que un **84,995 tiene que ser 85,00 y ser A**.

`calificar()` es una función pura sobre números ya resueltos, sin base de datos: es lo que hace que los casos de prueba de la especificación se puedan correr tal cual.

## Los rechazos no puntúan

El hueco de `pts_rechazos` en la tabla es **para un modelo futuro, no un olvido** (§15). Decisión de Tráfico del **11/09/2026** sobre los dos tipos, que no son lo mismo:

- **No responder** no puede bajar la calificación: detrás hay cobertura mala, móviles colgados y soportes flojos, y castigar eso sería castigar **al que peor equipo tiene**. Levanta un aviso para ir a **ayudarle** (`/alertas`).
- **Rechazar** es otra cosa —aquí no se rechaza ningún viaje— pero también se atiende por teléfono, porque un viaje larguísimo sí puede justificarse.

Si algún día entran al modelo, entran con su propia versión y recalibrando.

## El desglose: explicar el número

Con cada letra se guarda de qué está hecho el promedio: `dias_con_horas` (cuántos rodó), `dias_cubiertos` (cuántos estuvo a 8 h) y `dias_cero` (cuántos salieron a cero), más los tres parciales de puntos.

Sin eso, *"5,8 h"* es un número que **nadie puede discutir porque nadie sabe de dónde sale**. Un chip que dice "B" tiene que poder explicar por qué, y la explicación son tres números y puede que un tope.

Además hay `historico(conductorId)` —para contestar *"llevo tres periodos bajando"*— y `reparto(hasta)`, que es lo que se mira para recalibrar (§13): cuántos A, B, C, D y N/E hay y qué porcentaje son A.

## Por qué hay DOS medias distintas

Porque contestan preguntas distintas y **no dan el mismo número para la misma persona**.

### `conductor_rendimiento` — el promedio de horas del mes corrido

`services/repo/rendimiento.js`. Escala propia **S / A / B / C**:

```
S  9 h o más      A  entre 8 y 9 h      B  entre 6 y 8 h      C  menos de 6 h
```

Lo que **cuenta** para esta media:

- los días que **trabajó**, con horas de BOLT **más** las justificadas (se suman);
- los días que **debía salir y no salió sin nada que lo justifique**, como un **0**.

Lo que **no cuenta, en absoluto**: las libranzas, las vacaciones, las bajas, los permisos, los días fuera de alta, ni un día justificado sin horas ni trabajo. **Librar no penaliza y una J protege el día** — pero tampoco suman nada al denominador.

Ahí está la diferencia con el modelo ABCD: **la calificación mete esos días como 8 h y el rendimiento los excluye**. La misma persona tiene dos medias distintas porque una responde *"cuántas horas hace los días que trabaja"* y la otra *"cómo va el mes entero, incluyendo lo que no hizo"*.

Y una regla propia: los primeros **3 días de alta no se promedian** (`DIAS_NUEVO`). Con dos días trabajados no se sabe nada de nadie, y salía **"0 h · C" como si fuera el peor de la flota**. Se dice *"Nuevo conductor"* (letra **N**) y a partir del cuarto día ya se promedia. Quien todavía no ha rodado ni un día tampoco aparece en la consulta, y aun así se le añade la fila para poder decir que es nuevo.

### `conductor_calificacion` — la letra A–D

Es la que se pinta. Desde el modelo ABCD, `rendimiento.leer()` **ya no devuelve el promedio de horas con su letra S/A/B/C**: devuelve la calificación de `conductor_calificacion`.

> El cambio se hizo **ahí y no en las cuatro pantallas que la pintan**. El planificador, el cockpit, las campañas y el reporte de horas piden *"el rendimiento de esta persona"* y siguen pidiendo lo mismo. Lo que ha cambiado es la respuesta, y **cambia en los cuatro sitios a la vez o no cambia bien**.

Se conserva la forma `{ horas, letra, dias }` porque es la que consumen los chips, y se le añade el desglose. El `N/E` del modelo nuevo ocupa el sitio del `N` viejo: los chips ya sabían pintar ese caso.

### Y entonces, ¿para qué sigue viva la primera?

`conductor_rendimiento` **se sigue calculando**: la usa el **reporte de asistencia**, que compara contra el promedio del mes corrido y no contra la letra ponderada.

Si en algún sitio se ven dos cifras distintas para la misma persona, esa es la razón, y no es un fallo.

## Cuándo se calcula

Las dos cosas van juntas porque dependen de lo mismo (`app.js`):

- **05:40** — después de que la bitácora selle la jornada (05:35). Si se calculara antes, el último día entraría a medias.
- **12:00, otra vez y para todos.** Antes aquí solo se recalculaban los TodoTurno, porque su jornada no cierra a las 05:00 sino al mediodía. Pero **al turno de noche le pasa lo mismo**: a las 05:40 lo suyo aún se está cerrando y salían con horas de menos. Al mediodía la jornada anterior está cerrada para todo el mundo. La pasada de las 05:40 se queda porque da una cifra utilizable a primera hora, cuando Tráfico empieza a colocar gente; esta la corrige. Son 200 filas sobre histórico ya sellado: no le cuesta nada al servidor y es idempotente.

En los dos casos se calcula **hasta la última jornada cerrada** (ayer): la de hoy va a medias y hundiría a quien esté trabajando ahora mismo.

Guardar es un `ON CONFLICT (conductor_id, periodo_inicio, periodo_fin, version_modelo) DO UPDATE`: **repetirlo sobre el mismo periodo reescribe, no duplica**. `conductor_rendimiento`, en cambio, limpia lo del mes anterior al cambiar de mes, porque el promedio es del corrido.

Las cuentas fantasma tocan esto de cerca: cuando se enlaza, cambia o anula un enlace, el servicio vuelve a sellar los días afectados **y rehace el promedio del mes**, porque si no la media sigue siendo la de antes hasta que pase el cron de la noche. Ver [[Conductores]].

## Detalles que conviene saber

- **Si la tabla no se puede leer, las pantallas van igual, sin la letra.** Ni `leer()` de calificación ni el de rendimiento tumban nada: se quejan en consola y devuelven un mapa vacío.
- La letra se pinta **y se filtra** en el listado de plantilla: *"a quién tengo en D"* es la pregunta con la que se abre la pantalla, y sin la letra en la lista habría que abrir a la gente de una en una.
- Sólo se califica a gente con periodo de empleo abierto y que no sea centinela.
- El comentario del cron en `app.js` todavía habla de *"la calificación A-D de 14 días"* y registra `cal.MODELO.dias`, que **no existe en el modelo 2.0** (el periodo es el mes). Es una línea de log heredada de la versión 1.0, no una segunda definición del periodo.

Ver también [[Glosario]] y [[Reglas de la casa]].
