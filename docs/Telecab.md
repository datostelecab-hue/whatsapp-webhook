---
tags: [proyecto, contexto]
actualizado: 2026-09-17
---

# Telecab

El negocio y la forma en que se trabaja. Sin esto, la mitad de las decisiones del sistema no se entienden.

## Qué es

Una flota **VTC en Madrid** que trabaja sobre la plataforma **BOLT**. En números redondos de septiembre de 2026:

- Unos **85 coches** vigilados en el día a día (la flota en Mapon es mayor: hay coches de otras plazas, bajas y reservas).
- En torno a **150 conductores** activos cada jornada.
- Entre **26.000 y 35.000 km** de flota al día.
- Unos **2.000 viajes** diarios.

Los coches llevan GPS de **Mapon**; los conductores no están identificados en Mapon, sino en BOLT. Cruzar las dos cosas es, literalmente, la mitad de este sistema: *BOLT dice quién y en qué; Mapon dice dónde y cuánto.*

## Cómo es la operación

- **La jornada va de 05:00 a 05:00**, no de medianoche a medianoche. El turno de noche se parte por la mitad con el día natural, y con él los reportes. → [[Jornada y turnos]]
- **Dos turnos**, día y noche, con un relevo por medio. En el relevo es normal que un coche ruede con la app apagada; fuera del relevo, no.
- **El cuadrante manda**: quién sale, con qué coche y qué día libra. Lo que pasa fuera del cuadrante —el que sale sin que le tocara— tiene nombre propio en el sistema: **NN**. → [[Planificacion]]
- **Tráfico vigila en vivo**: llama a quien no ha salido, a quien rueda con la app cerrada y a quien rechaza pedidos. Esas llamadas se registran. → [[Control En directo]]

## Quién usa el sistema

- **Tráfico / control**: el día a día. En directo, llamadas, alertas, reportes.
- **RRHH**: altas y bajas, ausencias, justificantes, nóminas, selección.
- **Taller**: mantenimientos por kilómetros, averías, facturas.
- **Dirección**: los reportes y lo que cuestan las cosas.
- **Desarrollo**: una persona. Por eso el código está escrito para que se entienda solo dentro de seis meses.

## Dónde vive

- **Node + Express + EJS**, con Tailwind por CDN. Sin build.
- **PostgreSQL en Render (Frankfurt)**. Las credenciales viven en variables de entorno del servicio; no en el repositorio.
- Un **motor cada cinco minutos** que ingiere BOLT y Mapon y escribe en la base; las pantallas leen solo de la base. → [[Ingesta]] · [[Flota viva]]

## De dónde viene

El sistema nació encima de **Google Sheets** y se está terminando de sacar de ahí. Quedan restos —informes que se publican en hojas—, pero la fuente de verdad ya es PostgreSQL. La migración se hizo **desde cero** en agosto de 2026, partiendo de un único fichero de RRHH, con el **DNI** como identidad y el teléfono como enlace con BOLT. → [[Historial de decisiones]]

## Cómo se escribe aquí

Todo en español: el código, los comentarios, los nombres de las cosas y estas notas. Los comentarios explican **por qué** algo es como es, no qué hace la línea de abajo; cuando un fallo costó tiempo, se queda escrito con su cifra para que nadie lo repita. → [[Reglas de la casa]] · [[Trampas conocidas]]

Relacionado: [[INDICE]] · [[Estado y pendientes]] · [[Arquitectura]]
