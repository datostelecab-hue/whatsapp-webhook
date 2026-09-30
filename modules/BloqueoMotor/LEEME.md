# Ciclo de bloqueo de motor (`/bloqueo-motor`)

Los coches que bloquean los conductores al terminar su turno, en qué punto de su
ciclo está cada uno, y el botón de soltar el que se queda en el taller. El sistema
no bloquea nada por su cuenta: no hay repaso (30/09/2026).

```
bloqueoMotor.controller.js   la pantalla y la API (/api/lista, /api/coche/:matricula, /api/soltar)
bloqueoMotor.service.js      LA PUERTA: el estado de cada coche, su historia y soltar
vistas/bloqueoMotor.ejs      el Listado
```

Bloquear al terminar y soltar al empezar viven en `services/fichaje.js`; el libro
del ciclo es `fichaje_orden_motor` (sin usuario = el conductor; con usuario =
Tráfico). Permisos: `/bloqueo-motor` y `/bloqueo-motor/soltar` (db/167).

La nota completa: `docs/modulos/Ciclo de bloqueo de motor.md`.
