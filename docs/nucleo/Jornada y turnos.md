---
tags: [nucleo, jornada, turnos, horas, control]
fecha: 2026-09-17
estado: en producción
---

# Jornada y turnos

**El día operativo no es el día natural: va de las 05:00 a las 05:00 del día siguiente.** Es la base de todo lo que cuenta horas en el ERP —Visibilidad, la bitácora, el reporte de horas, [[Control]] y las alertas— y la causa número uno de que dos pantallas dejen de cuadrar cuando alguien la olvida.

## Dónde viven las constantes

En `services/nucleo.js`, que es el suelo del sistema: constantes y funciones **puras**, sin base de datos, sin red y sin reglas de negocio.

```
HORA_DIA   = 5    (AUDITORIA_HORA_DIA)
HORA_NOCHE = 17   (AUDITORIA_HORA_NOCHE)
```

Estaban repetidas en `services/flotaViva/rutas.js` y en la auditoría de flota, con la misma variable de entorno. *Dos copias de la constante que parte el día es la forma más silenciosa de que dos pantallas no cuadren: basta con que alguien cambie una.*

## El catálogo de ventanas: `TURNOS`

En `services/flotaViva/rutas.js`, como `[hora_inicio, offset_días_fin, hora_fin]`. Lo importan Visibilidad y todo el que necesite una ventana, precisamente para no volver a escribir las horas en ningún sitio.

| Nombre | Ventana | Para qué |
|---|---|---|
| `dia` | 05:00 → 17:00 | el turno de día |
| `noche` | 17:00 → 05:00 (+1) | el turno de noche, **cruza medianoche** |
| `operativo` | 05:00 → 05:00 (+1) | **la jornada**: día ∪ noche, sin saber de qué turno es nadie |
| `completo` | 00:00 → 24:00 | el día natural |
| `noche12` | 12:00 → 12:00 (+1) | la regla de Tráfico para el reporte |
| `nocheControl` | 12:00 → 12:00 (+1) | la noche como la mira el cockpit (hasta el 06/10/2026, 12:00 → 05:00) |
| `diaControl` | 00:00 → 24:00 | el día como lo mira el cockpit (desde el 06/10/2026) |
| `todoturnoControl` | 00:00 → 12:00 (+1) | quien dobla día y noche del mismo coche |

Dos avisos que están escritos en el propio código:

- **`completo` NO es la suma de `dia` + `noche`.** La madrugada 00:00–05:00 es del turno de noche de la víspera, así que se cuenta aparte.
- **`operativo` empieza a las 05:00** justamente para no comerse la madrugada de la víspera.

## Por qué el día natural no sirve para esta flota

Porque **el turno de noche cruza medianoche**, y esta flota rueda a las cuatro de la mañana.

Cortar por día natural le mete al conductor de día lo que rodó el de noche. Y los kilómetros van con él: un trayecto que cuenta «en el día donde empieza» se coloca donde no es.

**El caso que lo demostró.** Carlos Arturo Borelli hizo un trayecto de **249 km y siete horas que arrancó a las 04:45**, un cuarto de hora antes de que abriera la jornada. Su mañana entera se contó en el día anterior y a él le quedaron 52 km en 8,2 h de trabajo. El error iba doble, porque esos 249 km se los llevaba quien condujera a las 04:45, que no los hizo. **Eran 330 trayectos y 22.302 km mal colocados en diez días.** Desde entonces los metros se prorratean por el solape con la ventana y con el tramo (ver [[Flota viva]]).

Y antes de eso, la propia pantalla de flota cortaba por día natural: «Flota hoy X km» iba al lado de cifras 05→05 que no eran del mismo día.

### La regla de Tráfico: la noche va de mediodía a mediodía

Para el reporte, el turno de noche se mide **12:00 → 12:00 del día siguiente** (`noche12`). Así un turno de noche entero cae en **un** día y la madrugada va con la noche que la trajo, no con el día siguiente. El turno de día usa el día natural.

El cockpit usaba la misma idea recortada al final real del turno (`nocheControl`, 12:00 → 05:00); desde el 06/10/2026 la mide entera, hasta las 12:00 (abajo). Por qué no vale 17→05 ahí:

- Lo que un conductor de noche hace a las 06:00 es **la cola de su turno de ayer**, y con la ventana de 05:00 se le contaba como actividad de hoy: **le salían alertas de rechazos por viajes de la noche anterior**.
- Al revés, el que empieza a las 13:00 **no aparecía por ninguna parte hasta las 17:00**.

> **Medir no es reclamar.** Que la ventana esté abierta a las 12:30 no significa que a quien entra a las 17:00 haya que llamarle por no estar; eso lo decide `reclamable` en el cockpit.

## Las horas de cada turno, por conductor (06/10/2026)

Camilo: «hay gente de día que empieza desde antes de las 5am y no cuentan algunas horas». Desde entonces, **en Control y en Visibilidad, un turno no es un reloj: son las horas de su gente.**

| Quién | Qué cuenta |
|---|---|
| De **día** en el cuadrante | de **00:00 a 24:00** de ese día |
| De **noche** en el cuadrante | de **12:00 a 12:00** del día siguiente |
| **NN** (sin plan) | por su **hora de inicio**: antes de las 12:00, día; desde las 12:00, noche |

Siempre según el **turno de cada conductor** en el cuadrante (`f_cobertura`), no según la hora: a las 15:00 rueda gente de día y gente de noche a la vez.

Vive en `services/flotaViva/repartoTurnos.js`. Las dos ventanas **se solapan** (de 12:00 a 24:00 caben las dos), así que hay que decidir de **quién** es cada minuto:

1. Lo que cae en la ventana de un turno que esa persona **tiene planificado** es de ese turno. Si caben dos suyos (quien dobla, o dos noches seguidas), es del que más recientemente ha empezado a su hora estándar: quien dobla pasa de día a noche a las 17:00.
2. Lo demás —los NN, y lo que alguien hace fuera de sus ventanas— va por **sesiones**: un rato de trabajo seguido que se corta tras **2 h sin trabajar** (`TURNO_HUECO_SESION_MIN`). La sesión es del turno de su hora de inicio; si se sale de su ventana, lo que sobra se reparte desde el borde.

Así **cada segundo es de un solo turno** y día + noche es todo lo trabajado. La prueba es `scripts/comprobar-reparto-turnos.js` (pura, sin base), con los casos que pidió Camilo y los bordes: el NN que trabaja de 13:00 a 02:00 y vuelve a las 09:00 no se cuenta dos veces, y el cambio de hora del 25/10 da 13 h reales en una noche de 17:00 a 05:00.

**Lo que no cambia:** el **final del turno** para «No terminará la jornada» y «En riesgo» sigue siendo las **17:00 y las 05:00**, y se sigue reclamando desde las 05:00 y las 17:00. Se amplía qué horas cuentan, no cuándo acaba el turno. Tampoco cambian la **jornada** (05→05), la Bitácora ni el Reporte de horas.

## Las franjas de vigilancia

Una franja **no es un turno**: es el rato en el que Tráfico mira. Hay dos juegos distintos y conviene no confundirlos.

### Franjas de Flota viva — las incidencias

En la tabla `fv_franja` (`services/flotaViva/esquema.sql`), en minutos desde medianoche:

| Código | Franja |
|---|---|
| `dia` | **06:30 → 15:30** |
| `noche` | **18:30 → 03:30** (cruza medianoche) |

Entre franja y franja hay **relevo** —15:30–18:30 y 03:30–06:30— y ahí no se avisa de nada: se mira a mano.

Las horas van en una tabla y no en el código porque son de las cosas que cambian: **cambiar un turno es un `UPDATE`, no un despliegue**. Y el `INSERT` de arranque **no pisa** `inicio_min` ni `fin_min` al reaplicarse; si los pisara, cada despliegue devolvería las horas al fichero y el cambio de ayer se perdería sin que nadie se entere.

Dentro de su franja, cinco cosas obligan a llamar al conductor (`services/flotaViva/franjas.js`):

- se **desconecta** habiendo trabajado — el caso claro
- **rueda estando desconectado** — km sin plataforma
- lleva **demasiado en descanso** — comer sí, dos horas no
- **rueda estando en descanso** — km con la plataforma de adorno
- **no ha aparecido** en toda la franja — suele trabajar a esas horas y hoy no está

El tiempo y los kilómetros son **dos auditorías, no una**: veinte minutos en descanso no es noticia, pero veinte minutos **y dieciocho kilómetros** sí. El umbral de descanso estuvo en 45 minutos y ese caso se colaba por debajo; ahora es 0 (`FLOTA_VIVA_MAX_DESCANSO_MIN`) y salen todos, con el detalle de cuánto lleva cada uno. Los km sí tienen umbral: `FLOTA_VIVA_MAX_KM_DESCANSO`, 5 km — ir a comer son dos o tres y eso no es noticia.

La quinta es la delicada: no mira solo si el coche está apagado, porque entonces avisaría de todos los coches de repuesto aparcados en la base, todos los días. Solo cuenta si **ese** coche suele trabajar a esas horas (3 veces en los últimos 14 días) y con una hora de gracia desde que abre la franja — nadie ficha a las 06:30 clavadas.

**El contador también empieza cuando abre la franja.** Para eso está `fv_corte`: guarda los metros que el tramo ya traía. Sin él, a las 06:30 clavadas saltaba una alerta de **«29,9 km rodando desconectado»** por algo que había pasado a las tres de la mañana, en el horario de transición.

### Franjas de las alertas de Control

Otras horas, otro módulo: `modules/Control/alertas.repo.js` vigila **08:00–13:00 y 20:00–01:00**, y lo que dispara un WhatsApp es dejar pasar ofertas sin contestar, rechazarlas con el dedo, o rodar 20 km en descanso o desconectado.

Ahí los km también **se prorratean por tiempo**: un tramo de descanso que empezó antes de que abriera la franja trae kilómetros de antes, y cargarlos enteros sería acusar a alguien de lo que hizo a otra hora.

Y las horas que se enseñan en el aviso son las **efectivas** (viaje + espera) de su **jornada operativa** (05:00 → ahora), no las de la franja: quien recibe el aviso quiere saber si el tío lleva dos horas o diez.

## Qué lee estas constantes

`services/visibilidad.js` (que a propósito mantiene **dos vistas**, día natural y jornada, y desde el 06/10/2026 saca las tarjetas de turno de `repartoTurnos.js`), `modules/Operaciones/bitacora.repo.js`, `modules/Operaciones/auditoria.service.js`, el reporte de horas y el cockpit de [[Control]], y `services/inicio.js` para el panel de inicio.

Ninguno escribe las horas: las pide. Tenerlas a mano en un fichero suelto era la forma segura de que el día que cambien los turnos esa pantalla se quedara sola diciendo otra cosa.

Ver también: [[Flota viva]], [[Base de datos]], [[Ingesta]], [[Reglas de la casa]], [[Glosario]].
