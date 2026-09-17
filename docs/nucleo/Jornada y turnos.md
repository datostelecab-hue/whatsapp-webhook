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
| `nocheControl` | 12:00 → 05:00 (+1) | la noche como la mira el cockpit |

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

El cockpit usa la misma idea recortada al final real del turno (`nocheControl`, 12:00 → 05:00). Por qué no vale 17→05 ahí:

- Lo que un conductor de noche hace a las 06:00 es **la cola de su turno de ayer**, y con la ventana de 05:00 se le contaba como actividad de hoy: **le salían alertas de rechazos por viajes de la noche anterior**.
- Al revés, el que empieza a las 13:00 **no aparecía por ninguna parte hasta las 17:00**.

> **Medir no es reclamar.** Que la ventana esté abierta a las 12:30 no significa que a quien entra a las 17:00 haya que llamarle por no estar; eso lo decide `reclamable` en el cockpit.

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

`services/visibilidad.js` (que a propósito mantiene **dos vistas**, día natural y jornada), `modules/Operaciones/bitacora.repo.js`, `modules/Operaciones/auditoria.service.js`, el reporte de horas y el cockpit de [[Control]], y `services/inicio.js` para el panel de inicio.

Ninguno escribe las horas: las pide. Tenerlas a mano en un fichero suelto era la forma segura de que el día que cambien los turnos esa pantalla se quedara sola diciendo otra cosa.

Ver también: [[Flota viva]], [[Base de datos]], [[Ingesta]], [[Reglas de la casa]], [[Glosario]].
