---
tags: [modulo, bloqueo-motor, mapon, trafico, fichaje]
aliases: [Ciclo de bloqueo de motor, Bloqueo de motor, /bloqueo-motor]
actualizado: 2026-10-26
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
| El sistema | **solo el cierre de las 14 h, con el coche detenido** (desde el 26/10/2026, db/219; ver abajo). No hay repaso de coches parados |

Los viajes de la gente de la empresa siguen igual: al terminar bloquean. Los coches de otra sede no entran nunca ([[Fichaje]], «Los coches de otra sede no se tocan»).

## Todos los coches del planificador, dentro (26/10/2026, db/219)

Camilo: *«Mantén todos los coches disponibles del planificador dentro del ciclo; si alguno se va fuera del ciclo, que aparezca en el módulo como pendiente de entrar en el ciclo y el porqué»*. Ese día eran 68 coches en el cuadrante de hoy y mañana: 55 dentro y 13 fuera, 11 por 12 personas sin el bloqueo y 2 sin relé de corte.

- **El bloqueo, para todos.** db/219 se lo enciende (`conductor.ficha_coche`) a todos los que están de alta y llevan un coche de Madrid del planificador. Desde ese despliegue, **toda alta** (nueva o vuelta, por Plantilla, la ETT o Selección) entra con él encendido, y a RRHH se le pide la inducción (ver [[Conductores]]). Se puede seguir apagando a alguien en el planificador; su coche sale aquí como pendiente, con su nombre.
- **«Pendiente de entrar».** Los coches del cuadrante de hoy y mañana (`repo.cochesDelCuadrante`, la misma `f_cobertura` que decide el bloqueo) que no tienen nada en el libro salen con el estado **Pendiente de entrar**, y a los que tienen otro estado pero están fuera (o se quedarán libres al terminar) se les pone la marca al lado. El porqué, en «Qué pasa»:
  - **sin relé de corte** en Mapon → el taller;
  - **alguien lo lleva sin el bloqueo** → encendérselo en el planificador; mientras, al terminar se queda libre;
  - **todavía no lo ha terminado nadie con el bloqueo** → no hace falta nada: entra al terminar el próximo turno (o en el cierre de las 14 h). Se cuentan aparte («entran solos»).
- La cifra de arriba **«Pendientes de entrar»** dice cuántos hay que arreglar y cuántos entran solos, y filtra la lista. Si el planificador no se puede leer, se dice arriba.
- El sistema **no los bloquea por estar pendientes**: no ha vuelto el repaso del 30/09. Entran por las reglas (el conductor al terminar, o el cierre de las 14 h).

## El cierre de las 14 h, con el coche delante (26/10/2026, db/219)

Camilo: *«Si alguien no cerró turno, que lo cierre 14 horas después, pero si el coche está en movimiento lo mantengas así, y le envíes un mensaje por WhatsApp diciéndole que confirme que sigue en el coche y así no bloquearle el coche, ya que si no hay nadie logueado en el bot y el coche está parado, se cierra automáticamente el turno y se bloquea el motor, solo si está detenido claro»*. Cambia la regla del 30/09 («el sistema no bloquea nada») **solo para esto**. Cada 5 minutos (`app.js` → `fichajeBot.repasarTurnosLargos` → `fichaje.revisarTurnosLargos`), con cada turno abierto hace más de 14 h:

| Cómo está el coche | Qué se hace |
|---|---|
| Dijo «Sigo en el coche» hace menos de 2 h | nada |
| **Detenido**: 20 min o más quieto, **con el contacto quitado desde hace 20 min o más** y con señal (la regla estricta de `puedeInmovilizar`; un contacto que Mapon no dice no cuenta como quitado) | **se cierra el turno y se bloquea el motor**, con las reglas de «Terminar turno»: solo si todos los que lo llevan tienen el bloqueo, y `motor` lo vuelve a mirar todo antes y después de cortar. El fin del turno es cuando se paró. Queda en el libro del ciclo («Cierre automático tras 14 h…») y se le dice por WhatsApp |
| En marcha, encendido o parado de hace poco | el turno **sigue abierto** y se le pregunta por WhatsApp si sigue en el coche, con **Sigo en el coche** y **Terminar turno**. Como mucho una vez cada 2 h. Si no contesta y el coche se queda detenido, se cierra y se bloquea en el repaso siguiente |
| No se sabe (Mapon caído, sin equipo, sin señal más de 15 min, o sin decir si tiene el contacto puesto) | como antes: se cierra sin tocar el motor |
| Más de 24 h abierto (`FICHAJE_TOPE_HORAS`), ande o no | se cierra sin tocar el motor: ya no se le puede escribir |

- **Sin db/219, o con `FICHAJE_CIERRE_14H=off`**, todo sigue como antes: el turno olvidado se cierra a las 14 h al escribir al bot, sin mirar el coche ni tocar el motor. Con db/219, ese cierre al escribir al bot ya no se hace: si no, quien pulsa «Sigo en el coche» vería su turno cerrado antes de apuntarse su «sí».
- **Lo que la revisión del 26/10 obligó a añadir**, con su prueba cada uno: Mapon no tiene un estado de ralentí, así que su «parado» cuenta también el rato encendido; por eso se exige llevar 20 min con el contacto QUITADO, y saberlo (un `null` no es «apagado»). Justo antes de cerrar se vuelve a mirar que el turno siga abierto y sin un «Sigo» recién llegado, y se guarda solo si sigue abierto (`repo.cerrarSiAbierto`): no se pisa un «Terminar turno» o un relevo. El fin nunca queda antes de su «Entregar coche» (la base lo exige, `ck_ft_relevo`) ni de su último «Sigo». Un corte que salió y el coche no confirmó se manda soltar. Si la base falla al mirar si está db/219, esa vez no se cierra nada (ni a ciegas). En la ficha de un coche, ese bloqueo sale como «el cierre de las 14 h», no como «el conductor».
- La tabla `fichaje_turno_sigue` (db/219) guarda cuándo se le preguntó y hasta cuándo vale su «sí». `FICHAJE_PRORROGA_HORAS` y `FICHAJE_REPREGUNTA_HORAS` (2 h y 2 h) lo cambian.
- **WhatsApp solo deja escribirle dentro de las 24 h** de su último mensaje. Empezó el turno escribiendo la matrícula, así que a las 14 h la ventana está abierta; pasadas las 24 h, si sigue en marcha sin contestar, ya no se le puede preguntar y el turno sigue abierto hasta que pare.
- **El bloqueo de verdad sigue dependiendo de `FICHAJE_BLOQUEO_MOTOR=1`** en Render, como al terminar.
- **En el entorno de pruebas** (`MODO_PRUEBAS=1`) los cron no corren: con db/219 aplicada allí, los turnos olvidados no se cierran solos. Se prueba con `scripts/probar-corte-motor.js` (sección 19).
- **Lo que no hace**: encender el bloqueo a quien se pone en una plaza del planificador sin tenerlo (lo tienen todos desde db/219 y las altas; si Tráfico se lo apaga a alguien, su coche sale pendiente con su nombre).

## Cerrar el turno de quien se olvidó al entregar (27/10/2026)

Camilo: *«Marcos López García tiene el turno abierto, se le olvidó cerrarlo al entregárselo al compañero. Ciérrale el turno, quítalo de base de datos a él como responsable»*. El ERP no tenía cierre a mano: el de María del Mar (05/10) se hizo con una migración (db/177).

Ahora, en la ficha de un coche **en turno**, el botón **«Cerrar el turno»** (`fichaje.cerrarDesdeOficina`):

- Pide el **día y la hora de la entrega**. Lo que pase en el coche después ya no es suyo. No vale antes de que empezara, antes de su «Entregar coche» ni en el futuro. La hora es la de Madrid, con su cambio de horario (`instanteMadrid`).
- **No toca el motor**: el coche puede estar rodando con el compañero. Si hay que bloquearlo, es aparte.
- Queda `auto-cerrado`, porque no lo cerró él, con la nota «Cerrado desde el ERP por …: motivo». Deja de ser el conductor del coche en Mapon.
- Lo puede usar quien puede soltar el motor (`/bloqueo-motor/soltar`).

Para saber la hora de la entrega, BOLT es lo más fiable: cuándo terminó él su último tramo en ese coche. Marcos dejó el 5886LBZ el 27/10 a las 05:24. Comprobador: `scripts/probar-corte-motor.js` (sección 21).

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
| **Pendiente de entrar** (26/10/2026) | Un coche del planificador sin nada en el libro: el porqué y qué hacer, en «Qué pasa» | no |

Un coche cuyo último turno lo cerró alguien **sin** el bloqueo no está en el ciclo: no se bloqueó y no hay nada que mirar.

**«No se pudo bloquear» también cuando el corte entró y se deshizo al momento** (11/10/2026). Puede ser que el compañero hubiera abierto turno en esos segundos («X ha cogido el coche mientras se bloqueaba») o que el coche se encendiera mientras entraba el corte. En los dos casos el coche está libre y es lo que tiene que estar. Ver [[Fichaje#Una orden de motor por coche, y mirar después de cortar (11/10/2026)]].

## De dónde sale

- **El libro del ciclo es `fichaje_orden_motor`** (db/148, comentado de nuevo en db/167). Hasta el 30/09 solo guardaba lo que soltaba Tráfico a mano; desde entonces apunta también lo del conductor: `bloquear` al terminar (salga bien o mal) y `soltar` al empezar (solo si de verdad estaba cortado). **`usuario_id` vacío = el conductor; con usuario = Tráfico.** Por eso soltar a mano exige saber quién es: una orden de Tráfico sin usuario el ciclo la leería al revés.
- **El estado de un coche es su última orden**, salvo que tenga un turno abierto de alguien con el bloqueo (entonces está *en turno*).
- **Mapon dice la verdad del relé** (`unit/list` de toda la flota, una llamada). Si no contesta, la lista sale igual con el relé «sin datos» y un aviso arriba.
- **Quién lo coge** sale del cuadrante de hoy y mañana (`quienesLlevan`).
- La ficha de cada coche junta **turnos y órdenes** en una sola línea de tiempo.

## Permisos

`/bloqueo-motor` para mirar y `/bloqueo-motor/soltar` (marcada `escribir`) para soltar. **db/167** se las dio a quien podía editar el planificador, que es desde donde se soltaba hasta ese día. La columna «Motores cortados» del panel «Bloqueo de motor» del planificador es ahora un enlace aquí: un solo sitio desde el que soltar un motor.

## Cómo se prueba

`scripts/probar-corte-motor.js`, con Mapon y la base de mentira: secciones 7 (sin db/219, el cierre automático no corta), 11 (los estados del módulo), 12 (soltar saca del ciclo y el ciclo vuelve a empezar), 13 (Barcelona), 17 (la fila de órdenes de cada coche y lo que se mira después de cortar, el caso del 1067MJY), **19 (el cierre de las 14 h: en marcha pregunta, «sigo en el coche» da la prórroga, detenido cierra y bloquea, parado de hace poco o encendido pregunta, sin saber cierra sin tocar el motor, un compañero sin el bloqueo lo deja libre, y los textos)** y **20 (los coches del planificador pendientes de entrar, con su porqué)**.

Relacionado: [[Fichaje]] · [[Planificacion]] · [[Mapon]] · [[Historial de decisiones]]
