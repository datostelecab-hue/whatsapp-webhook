---
tags: [decision, km, mapon, flota-viva]
fecha: 2026-09-17
estado: en producción
---

# Km por odómetro CAN

Desde el 17/09/2026 los kilómetros del sistema salen del **odómetro del propio coche** —el número del cuadro, leído del bus CAN— y no de la estimación que hace el GPS uniendo puntos. Los coches cuyo equipo no lee el CAN siguen con el GPS y **lo dicen en pantalla**.

## Por qué se cambió

El GPS estima: une los puntos por los que pasó el coche y mide esa línea. Corta las curvas y, cuando el equipo pierde cobertura, pierde el trozo entero. Medido sobre la flota el 16/09/2026:

- En el conjunto, el GPS se queda **un 4 % por debajo** del odómetro.
- Coche a coche, donde los dos funcionan, la mediana de diferencia es **0,4 %**: dicen lo mismo.
- La diferencia está en los coches donde el GPS falla. El **0454MMZ** marcó **45 km de GPS contra 518 reales**. El **9521MMX** no tenía ni un solo trayecto en Mapon —era invisible para la auditoría— y había hecho **511 km**.

O sea: no era un problema de precisión, era un problema de **coches enteros mal medidos**.

## De dónde sale el dato

`unit_data/can_period.json` con `include[]=total_distance` (ver [[Mapon]]). Devuelve el cuentakilómetros del cuadro:

- Llega cada **90 segundos de mediana** mientras el coche anda.
- Es **acumulado**: dos lecturas se restan y ya está, no hay nada que escalar.
- La resolución es de 1 km, así que entre lectura y lectura puede haber hasta 4 km.
- `include[]=total_distance` baja la respuesta de 240 KB a 27 KB (sin él vienen las revoluciones, 5.201 puntos en un día).
- Es **de una unidad en una**: `unit_id[]=a&unit_id[]=b` devuelve solo la primera. Por eso la ingesta va con cola de 4.

## Cómo se guarda

En `fv_odometro`, y **por tramos entre lectura y lectura**, no por lecturas sueltas. Esa forma es idéntica a la de `fv_ruta`, y eso es lo que permite que el reparto entre conductores y ventanas siga siendo el mismo prorrateo por solape de siempre: una sola regla que mantener, no dos. Ver [[Flota viva]].

Al ingerir se tira lo que no es creíble: saltos hacia atrás (el equipo cambió de coche), huecos de más de 24 h y velocidades imposibles. Con una holgura: **el odómetro cuenta de kilómetro en kilómetro y apunta el salto cuando cae**, así que dos lecturas separadas veinte segundos con un kilómetro de diferencia son 180 km/h en el papel y un coche normal en la calle. Sin esa holgura el filtro se comía km buenos —a Carlos Borelli le quitaba 16 de 292.

## Quién decide qué fuente usa cada coche

Nadie lo configura: se decide **por coche y por ventana** en `FUENTE_KM`, en `services/flotaViva/rutas.js`. Si el CAN se queda por debajo del **85 %** de lo que dice el GPS, es que el equipo calló un rato y ese coche pasa a GPS. La diferencia normal entre los dos es del 1 %, así que el umbral solo salta cuando de verdad falta serie.

Un equipo que hoy lee el CAN y mañana no cambia de fuente solo.

## Dónde se ve el aviso

- **En directo** y **Histórico**: una etiqueta `GPS` al lado de los km.
- **Reporte de horas**: las dos celdas de km en ámbar, con su nota.
- **Auditoría de flota**: la marca en la tabla y una columna «Medido con» en el Excel.

Un número sin decir con qué vara está medido parece igual de firme que el de al lado, y no lo es.

## Cobertura real (septiembre de 2026)

De 85 coches vigilados, unos **65 dan odómetro**. De los que no:

- **Nueve** llevan un equipo que no lee el CAN: 3019KSM, 3031LTV, 3414JXB, 5646MDM, 5775KKL, 5886LBZ, 5909LBZ, 5912LBZ, 9985LBC. Esos no van a mejorar sin cambiar hardware.
- El resto callan a ratos y entran y salen solos.

Eso son en torno al **11 % de los km de la flota** midiéndose con GPS.

## Lo que esto NO arregla

El odómetro dice **cuánto** rodó el coche, no **de quién** son esos kilómetros. La atribución sigue dependiendo de la línea de tramos de BOLT y de su corte ([[Corte de tramos]]). La solución de fondo para eso es iniciar y terminar turno por WhatsApp.

## Lo que cuesta

`fv_odometro` crece unos **9 MB al día** (≈ 3 GB al año). Decisión tomada: no se borra nada, se amplía el disco cuando toque.

## Ficheros

- `services/flotaViva/fuentes.js` → `odometroCan()`
- `services/flotaViva/rutas.js` → `ingestarOdometro()`, `segmentar()`, `FUENTE_KM`, `odometroDeUnidad()`
- `services/flotaViva/esquema.sql` → tabla `fv_odometro`
- `modules/Operaciones/auditoria.service.js` → `atribuirOdometro()`
- `db/137-auditoria-fuente-km.sql` → columna `auditoria_km.fuente_km`

Relacionado: [[Flota viva]] · [[Mapon]] · [[Auditoria de flota]] · [[Control Reportes]] · [[Corte de tramos]]
