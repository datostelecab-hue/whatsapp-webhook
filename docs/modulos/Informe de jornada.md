---
tags: [modulo, rrhh, informe, legal]
ruta: /informe-jornada
codigo: modules/RRHH/informeJornada*
---

# Informe de jornada (para el SMAC)

**Módulo 5** del [[Plan RRHH y nominas]] (25/11/2026, db/288). El encargo: *«En las reclamaciones ante el SMAC casi siempre se piden las horas de los conductores. Por conductor y rango de fechas, con un clic desde su ficha, el ERP genera en PDF y Excel un consolidado para legal y los abogados»*. Hasta ahora se sacaba con scripts sueltos para cada demanda (Góngora, Rachid Lakraa).

```
modules/RRHH/informeJornada.js              la cuenta: pura (tramos → días, semanas, meses, conexiones)
modules/RRHH/informeJornada.service.js      la puerta: el rango, los datos, la huella y el libro
modules/RRHH/informeJornada.repo.js         el SQL (fv_tramo, la persona, la regla del convenio)
modules/RRHH/informeJornada.pdf.js · .excel.js
modules/RRHH/informeJornada.controller.js   GET /informe-jornada/:id.pdf|.xlsx?desde=&hasta=
test/informe-jornada.test.js
```

## Dónde está

En **Plantilla**, en la ficha del conductor: **«Informe de jornada»** (con la llave `/informe-jornada`). Se eligen las fechas y el formato (PDF o Excel) y se descarga. Si algo falla (fechas, permiso), lo dice la pantalla.

## Qué cuenta (decidido por Camilo el 25/11/2026)

- **Estricto del convenio** (art. 18.6 y 18.7), como el motor de [[RRHH|/convenio]]:
  - **Viaje** (`has_order`): trabajo efectivo (TE_A3).
  - **Espera en área**: trabajo efectivo (TE_A1). El área son las zonas de Mapon (`f_en_area`, la misma función del motor).
  - **Espera no efectiva**: la espera fuera del área (TE_NO, art. 18.7).
  - **Tareas auxiliares**: 20 minutos el día con actividad (TE_C, art. 18.6.c), aparte.
  - **Descanso** (`busy`): no es trabajo. Un estado de BOLT sin clasificar, si lo hubiera, va con el descanso.
  - **Trabajo efectivo** = viaje + espera en área. **Presencia** = trabajo efectivo + espera no efectiva: el tiempo conectado y disponible, que es el «tiempo de conexión» del informe de BOLT. El descanso no es presencia.
- **Día natural de Madrid** (00:00 a 24:00): lo que cruza la medianoche se parte. Los totales por semana van de lunes a domingo, y por mes.
- **Desde el 01/07/2026**: lo que el ERP guarda tramo a tramo ([[Flota viva]], `fv_tramo`) de todas las cuentas de BOLT de la persona. Lo anterior se saca como en las demandas, del informe mensual de BOLT.
- **Conexiones**: cada rato conectado seguido (con o sin descanso dentro), de la conexión a la desconexión, con lo que hubo dentro. Y por día, la primera conexión y la última desconexión.
- Si dos cuentas estuvieron a la vez, **cada minuto cuenta una vez**, con el estado de más trabajo. Un tramo que BOLT no cierra se corta con la regla de la casa (`rutas.FIN_KM`: otro conductor coge el coche, aparece en otro coche, o 12 h).

> [!warning] Mientras no haya zonas de Mapon, toda la espera sale «no efectiva»
> Es lo que ya pasa en /convenio (ver [[RRHH#La cuenta del convenio (art. 18.6)]]): sin zonas configuradas no consta ninguna espera dentro del área. El informe lo dice en sus definiciones. Ejemplo real, octubre de 2026 de una ficha: viaje 120 h 51 min, espera no efectiva 39 h 09 min, efectivo 120 h 51 min, **presencia 160 h 00 min** (la bitácora, con su corte por turnos, da 160,19 h el mismo mes).

## La trazabilidad

- El PDF y el Excel dicen **quién lo emitió y cuándo**, **de dónde sale cada dato** (BOLT, Flota viva, zonas de Mapon, el tope de los tramos, el corte del día) y **la regla aplicada** tal como está en la base (`cat_estado_te`).
- **La huella** (SHA-256) de las cifras: el mismo informe de las mismas fechas, emitido otra vez con los mismos datos, da la misma huella.
- **Cada emisión queda en el libro de auditoría** de la ficha (acción «lectura», con las fechas, el formato y la huella).

## Lo que no hace (todavía)

- No suma las **horas justificadas** (las J): el informe es lo que dice la plataforma. La [[Bitacora]] sí las suma.
- No calcula **nocturnidad** ni el descanso legal entre jornadas.
- Rango máximo de 400 días por informe.

Relacionado: [[Plan RRHH y nominas]] · [[RRHH]] · [[Flota viva]] · [[Conductores]]
