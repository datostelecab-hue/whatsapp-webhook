---
tags: [decision, historia]
actualizado: 2026-09-17
---

# Historial de decisiones

Las decisiones que explican por qué el sistema es como es. En orden, de la más reciente a la más antigua. Cada una tiene su nota cuando da para más.

## 2026-09-17 · Los km salen del odómetro del coche

Se deja de medir con la estimación del GPS y se pasa al cuentakilómetros del cuadro. El GPS se quedaba un 4 % corto en la flota y **mucho más** en coches sueltos: el 0454MMZ marcaba 45 km contra 518 reales. Los coches sin CAN siguen con GPS y lo dicen en pantalla. → [[Km por odometro CAN]]

## 2026-09-17 · El corte de tramos vale para todos, cerrados incluidos

Tres intentos hasta acertar. Un tramo «desconectado» puede durar días y le colgaba al último conductor todos los km que el coche hiciera después. → [[Corte de tramos]]

## 2026-09-17 · Un trayecto se reparte por donde pasa, no cuenta entero donde empieza

Un trayecto de 249 km y siete horas que arrancó a las 04:45 —un cuarto de hora antes de abrir la jornada— metía la mañana entera en el día anterior. A Carlos Borelli le quedaban 52 km en 8,2 h de trabajo. Eran 330 trayectos y 22.302 km mal colocados en diez días. Ahora los metros se prorratean por el solape con la ventana.

## 2026-09-16 · Cuentas fantasma

A quien le suspenden la cuenta de BOLT se le presta otra para que pueda salir a trabajar. El sistema permite **enlazar** esa cuenta a la persona por un rango de fechas: sus horas y sus km son suyos, la bitácora dice «horas de cuenta fantasma» y Control enseña su nombre real con el aviso. Solo lo pueden hacer dos personas y **cada acción queda auditada** con fecha, hora, IP y dispositivo. → [[Conductores]]

## 2026-09-16 · El bloqueo de motor ya funciona

Mapon concedió el permiso y se probó en un coche real: la orden llega en dos segundos y con el corte puesto no arranca. **Regla de oro: nunca cortar con el contacto puesto** — el coche arranca y anda, pero ya no se deja apagar. Por eso el fichaje no deja terminar turno con el contacto puesto. → [[Fichaje]]

## 2026-09-15 · La calificación cuenta por mes y desde el alta

Libranzas, bajas, vacaciones y permisos valen 8 h para que no hundan la media; los días con horas en BOLT valen lo que hicieron; y los días que tocaba salir y no se salió **sin justificar valen 0**. Quien no tiene ni trabajo ni plan no cuenta. → [[Calificacion de conductores]]

## 2026-09 · Adiós a las hojas

El sistema deja de leer Google Sheets y lee solo PostgreSQL. Las hojas quedan como destino de informes, no como fuente. → [[Base de datos]] · [[Google Drive y Sheets]]

## 2026-09 · Una sola puerta de entrada

BOLT y Mapon entran por **una** función cada cinco minutos y escriben en PostgreSQL; las pantallas leen de ahí y no llaman a las APIs. Una llamada de flota alimenta a todo el mundo. → [[Ingesta]] · [[Flota viva]]

## 2026-09 · La jornada es 05:00 → 05:00

El día natural no sirve para esta flota: parte los turnos de noche por la mitad. Todo lo que cuenta horas o kilómetros usa la jornada operativa. → [[Jornada y turnos]]

## 2026-08 · Un módulo por negocio

El código se reparte en módulos con sus capas (controlador → servicio → repositorio) y desde fuera se entra por el `.service`. Hay comprobadores que lo vigilan. → [[ARQUITECTURA]] · [[Reglas de la casa]] · [[Comprobadores]]

## 2026-08 · Migración desde cero

Se arranca de un único fichero de RRHH, la identidad la manda el **DNI** y el enlace con BOLT se hace por teléfono. Los teléfonos duplicados del Excel se comieron a cinco personas en la migración: por eso hay que leer el informe de errores. → [[Base de datos]]

Relacionado: [[INDICE]] · [[Estado y pendientes]]
