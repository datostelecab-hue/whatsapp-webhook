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

## Las piezas

```
barcelona.controller.js   las rutas (sin lógica)
barcelona.service.js      el planificador: el tablero de un día y las comprobaciones al asignar
barcelona.repo.js         el SQL: cuentas, coches, asignaciones (con la sede como parámetro)
vistas/barcelona-planificador.ejs
```

Comprobador: `scripts/comprobar-barcelona.js` (sin base: el repositorio se sustituye por datos de mentira).

## Ver también

[[Sedes]] · [[Planificacion]] · [[Ingesta]] · [[Jornada y turnos]] · [[Usuarios y permisos]]
