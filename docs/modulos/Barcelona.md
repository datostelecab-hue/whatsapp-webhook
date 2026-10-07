---
tags: [modulo, barcelona, sedes, planificador, horas]
ruta: /barcelona
codigo: modules/Barcelona
fecha: 2026-10-07
---

# Barcelona

Camilo, 07/10/2026: «en el login ahora va a aparecer Barcelona o Madrid». Barcelona **no necesita fichas, altas ni libranzas**: sus conductores son sus **cuentas de BOLT** (nombre y teléfono) y sus matrículas, los **coches de su empresa de BOLT**. Lo que necesita es:

- un **planificador**: cada conductor en una matrícula, de día o de noche;
- un **reporte de horas** con la misma regla que Madrid, y «No salió» cuando no hizo horas;
- su **Visibilidad**, con las mismas métricas que la de Madrid.

Las piezas de datos (de dónde salen sus horas y sus coches, y por qué van en tablas suyas) están en [[Sedes]].

## Se entra eligiendo la sede en el login

El login tiene un selector **Madrid / Barcelona** (se recuerda el último en ese navegador). La sede viaja en la cookie de sesión como el tema (`services/sesion.js`, `SEDES` y `sedeValida`), y se conserva al re-emitirla (cambiar el tema o la contraseña). Ver [[Usuarios y permisos]].

- **Madrid** es el ERP de siempre.
- **Barcelona** cae en `/barcelona` y su menú solo tiene sus tres pantallas.
- En las dos, arriba del menú, **«Ir a Madrid» / «Ir a Barcelona»** cambia de sede sin volver a entrar (`POST /sede`).
- **Cualquier usuario** puede elegir Barcelona (Camilo). Por eso `/barcelona` no tiene clave en el catálogo de permisos: lo que no está en el catálogo es libre para quien está dentro.

## El planificador (`/barcelona`)

Una fila por **matrícula** y dos plazas: **día** y **noche**. Al pulsar una plaza se elige el conductor (con buscador, entre las cuentas **activas** de BOLT Barcelona) y **desde qué día**.

**Fijo hasta que se cambie** (lo eligió Camilo frente a planificar día a día). Un cambio no borra el pasado: la asignación de antes se **cierra el día anterior**, así que el reporte de un día viejo sigue sabiendo a quién le tocaba. Si la de antes empezaba ese mismo día o después (una corrección), no llegó a valer y se borra.

- **Una persona por plaza, y una plaza por persona y turno**: lo garantiza la base (`uq_sede_asig_plaza`, `uq_sede_asig_conductor`). Si eliges a alguien que ya estaba en otra matrícula del mismo turno, **se mueve** y la pantalla lo dice.
- «Sin dato» deja la plaza libre.
- La fecha va de **un mes atrás** (para corregir lo que se olvidó) a **dos meses adelante**.
- Salen los coches **activos** en BOLT; uno desactivado solo si alguien lo lleva, atenuado y con su estado. Una cuenta desactivada en una plaza sale tachada.
- Abajo, **Sin plaza**: los activos que ese día no están en ninguna matrícula.

Sin db/181 la pantalla lo dice («Falta aplicar la migración db/181») en vez de dar un error.

## El reporte de horas (`/barcelona/reportes`)

Solo descargable, como los reportes de Madrid ([[Control Reportes]]): se eligen las fechas (hasta **31 días**; atajos Ayer, Últimos 7 días y Este mes) y baja un Excel con tres pestañas:

- **Por día**: una fila por día y plaza con conductor. Sus horas en **su turno**, viaje y espera, el coche de BOLT en que trabajó y si salió. Las horas llevan los colores del reporte de Madrid (verde desde 7,6 h, amarillo de 6,4 a 7,5, rojo menos).
- **Por conductor**: los días que le tocaba, los que salió y los que no, sus horas y la media de los días que salió. Arriba, quien más días no salió.
- **Sin plaza**: quien trabajó un día sin tener plaza ninguna ese día.

**La regla de las horas es la de Madrid, no una copia**: `repartoTurnos.repartir` ([[Jornada y turnos]]) con el plan del planificador de Barcelona. Quien tiene plaza de **día** cuenta de 00:00 a 24:00; quien la tiene de **noche**, de 12:00 a 12:00 del día siguiente (Camilo: «de 00:00 a 23:59… desde las 12 PM hasta el día Y hasta las 12 PM»). Quien trabaja sin plaza va por su hora de inicio, como los NN. Cuenta el trabajo (viaje y espera), no el descanso; el catálogo de estados es el de Madrid (`fv_estado_bolt`).

**Los estados de cada plaza:**

| Estado | Cuándo |
|---|---|
| Salió | hizo algo en la ventana de su turno y la ventana ya cerró |
| Salió · en curso | ha hecho algo y su ventana sigue abierta |
| Aún no ha salido | su ventana está abierta y no ha hecho nada todavía |
| Por empezar | su ventana no ha empezado |
| **No salió** | tenía plaza y no hizo ni un minuto en su ventana, ya cerrada. Barcelona no tiene libranzas: no hay otra explicación que dar (Camilo) |

En las observaciones se dice si trabajó **en otro coche** que el de su plaza, y lo que hizo **fuera de su turno** ese día (no se suma a su plaza).

**De los apuntes a las horas** (`barcelona.horas.js`). BOLT apunta cambios: cada apunte dura hasta el siguiente del mismo conductor. Dos en el mismo segundo se desempatan como en Madrid (`desempate.js`). Para saber cómo estaba cada uno al empezar la ventana se lee un día más de apuntes por detrás. Y **un estado de trabajo no dura más de 6 h sin otro apunte** (`BARCELONA_TOPE_ESTADO_H`): si el móvil se apaga en espera, BOLT no avisa y la espera duraría días. Con los datos reales del 04 al 07/10 (1.704 apuntes, 1.368 ratos de trabajo) el rato más largo fue de 3 h: el tope no recorta nada normal.

## Las piezas

```
barcelona.controller.js   las rutas (sin lógica)
barcelona.service.js      el planificador (el tablero de un día, las comprobaciones al asignar) y el reporte
barcelona.horas.js        puro: de los apuntes de BOLT a los ratos de trabajo, y el reporte con el plan
barcelona.excel.js        el Excel del reporte
barcelona.repo.js         el SQL: cuentas, coches, asignaciones, apuntes, pedidos (con la sede como parámetro)
vistas/barcelona-planificador.ejs · vistas/barcelona-reportes.ejs
```

Comprobador: `scripts/comprobar-barcelona.js` (sin base: el repositorio se sustituye por datos de mentira).

## Ver también

[[Sedes]] · [[Planificacion]] · [[Ingesta]] · [[Jornada y turnos]] · [[Usuarios y permisos]]
