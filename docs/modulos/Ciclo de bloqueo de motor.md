---
tags: [modulo, bloqueo-motor, mapon, trafico, fichaje]
aliases: [Ciclo de bloqueo de motor, Bloqueo de motor, /bloqueo-motor]
actualizado: 2026-09-30
---

# Ciclo de bloqueo de motor

`/bloqueo-motor`, en el grupo **Tráfico** del menú. Los coches que estamos bloqueando, en qué punto de su ciclo está cada uno, y el botón para **soltar** el que se queda en el taller.

```
modules/BloqueoMotor/bloqueoMotor.controller.js   la pantalla y la API
modules/BloqueoMotor/bloqueoMotor.service.js      LA PUERTA: el estado de cada coche
modules/BloqueoMotor/vistas/bloqueoMotor.ejs      el Listado
services/fichaje.js                               bloquear al terminar, soltar al empezar
services/repo/fichajeTurno.js                     el libro (fichaje_orden_motor) y los turnos
```

## La regla (Camilo, 30/09/2026)

> Deisy coge el XXX4544 hoy, entonces al terminar turno se bloquea el XXX4544. Solo se desbloquea si va a volver a trabajar al otro día o si tiene compañero correturno que lo vaya a coger —Lionar—: Lionar debe iniciar turno también y así continúa el ciclo. Si alguien debe dejar el coche en el taller, debe decírselo a Tráfico y desde el módulo soltarlo: ya no se bloquea más hasta que nos lo entreguen de nuevo, un conductor inicie turno y termine, y de nuevo empieza el ciclo. **El sistema no bloquea nada sino que suelta; los únicos que bloquearán son los conductores.**

| Quién | Qué hace con el motor |
|---|---|
| El conductor, al **terminar** su turno | lo **bloquea** (si él y todos los que llevan ese coche hoy o mañana tienen el bloqueo encendido, y `FICHAJE_BLOQUEO_MOTOR=1`) |
| El conductor, al **empezar** su turno | lo **suelta** |
| Tráfico, desde aquí | lo **suelta** con un motivo; el coche sale del ciclo |
| El sistema | **nada**. No hay repaso, y el cierre automático de las 14 h cierra el turno sin tocar el motor |

Los viajes de la gente de la empresa siguen igual: al terminar bloquean. Los coches de otra sede no entran nunca ([[Fichaje]], «Los coches de otra sede no se tocan»).

## Los estados

Salen en este orden, lo que pide acción primero:

| Estado | Qué quiere decir | ¿Se suelta aquí? |
|---|---|---|
| **El corte no corta** | Mapon lo da cortado y el coche se mueve sin turno: la instalación del relé. Taller | sí |
| **Bloqueado** | Lo bloqueó quien terminó. Lo suelta el siguiente al empezar | sí |
| **No se pudo bloquear** | Al terminar no se confirmó (sin cobertura, sin relé…). Está libre y nadie lo reintenta | si Mapon lo da cortado |
| **Cortado fuera del ciclo** | Mapon lo da cortado y no fue un conductor al terminar: el repaso que ya no existe, o alguien desde Mapon | sí |
| **Soltado desde Mapon** | Lo bloqueamos y Mapon ya lo da libre | no |
| **En turno** | Lo lleva alguien con el bloqueo (o un viaje). Dice si se bloqueará al terminar o se quedará libre porque un compañero no tiene el bloqueo | no |
| **Fuera del ciclo** | Lo soltó Tráfico (30 días en la lista). No se vuelve a bloquear hasta que alguien empiece y termine un turno en él | si Mapon lo da cortado |

Un coche cuyo último turno lo cerró alguien **sin** el bloqueo no está en el ciclo: no se bloqueó y no hay nada que mirar.

## De dónde sale

- **El libro del ciclo es `fichaje_orden_motor`** (db/148, comentado de nuevo en db/167). Hasta el 30/09 solo guardaba lo que soltaba Tráfico a mano; desde entonces apunta también lo del conductor: `bloquear` al terminar (salga bien o mal) y `soltar` al empezar (solo si de verdad estaba cortado). **`usuario_id` vacío = el conductor; con usuario = Tráfico.** Por eso soltar a mano exige saber quién es: una orden de Tráfico sin usuario el ciclo la leería al revés.
- **El estado de un coche es su última orden**, salvo que tenga un turno abierto de alguien con el bloqueo (entonces está *en turno*).
- **Mapon dice la verdad del relé** (`unit/list` de toda la flota, una llamada). Si no contesta, la lista sale igual con el relé «sin datos» y un aviso arriba.
- **Quién lo coge** sale del cuadrante de hoy y mañana (`quienesLlevan`).
- La ficha de cada coche junta **turnos y órdenes** en una sola línea de tiempo.

## Permisos

`/bloqueo-motor` para mirar y `/bloqueo-motor/soltar` (marcada `escribir`) para soltar. **db/167** se las dio a quien podía editar el planificador, que es desde donde se soltaba hasta ese día. La columna «Motores cortados» del panel «Bloqueo de motor» del planificador es ahora un enlace aquí: un solo sitio desde el que soltar un motor.

## Cómo se prueba

`scripts/probar-corte-motor.js`, con Mapon y la base de mentira: secciones 7 (sin repaso, el cierre automático no corta), 11 (los estados del módulo), 12 (soltar saca del ciclo y el ciclo vuelve a empezar) y 13 (Barcelona).

Relacionado: [[Fichaje]] · [[Planificacion]] · [[Mapon]] · [[Historial de decisiones]]
