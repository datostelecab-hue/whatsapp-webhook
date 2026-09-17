---
tags: [decision, km, flota-viva, atribucion]
fecha: 2026-09-17
estado: en producción
---

# Corte de tramos

Hasta dónde cuentan los kilómetros de un tramo de BOLT. Es la regla que decide **de quién** son unos km, y es la que más veces se ha equivocado.

## El problema

`fv_tramo` es una línea de tiempo **por vehículo** ([[Flota viva]]). Cuando alguien se desconecta de BOLT, su tramo se queda abierto en «desconectado» hasta que alguien vuelva a conectarse **a ese coche**. Si nadie lo hace, puede durar días. Y mientras tanto, el coche rueda: lo lleva otro, se va al taller, se va a Barcelona.

Sin cortar ese tramo, **todos esos kilómetros se le cuelgan al último que lo condujo**. Con ese número se llama a la gente por teléfono.

## La regla

En `services/flotaViva/rutas.js`, constante `FIN_KM`. Un tramo cuenta hasta lo que pase **antes** de estas cuatro cosas:

1. **El final del propio tramo**, cuando lo hay. Un tramo normal dura minutos y manda él; las otras tres ni se notan.
2. **Otro conductor se conecta a ese coche.** A partir de ahí los km son suyos: es el hecho más fuerte que hay y no hace falta suponer nada.
3. **Él aparece en otro coche.** Nadie conduce dos a la vez.
4. **Un tope de 12 horas.** Solo salta cuando no ocurre ninguna de las dos anteriores, que es justo el caso feo: el coche se va de la flota y nadie vuelve a conectarse con él, así que ningún hecho cierra el tramo.

Los kilómetros que quedan fuera del corte **no desaparecen**: pasan a ser huérfanos y salen en el aviso de Control de coches rodando sin nadie conectado. La cuenta cierra siempre: *flota = en BOLT + por fuera + huérfanos*.

## Las tres veces que se equivocó

**1. No había corte (hasta el 17/09).** Macilon Dos Santos se desconectó del 7550KYT el 15/09 a las 06:41, se fue a otro coche, y el reporte le apuntó 256 km «fuera de servicio» que eran 217 de ese coche más sus 38 reales. Había 21 tramos abiertos de más de 12 h imputando unos 2.500 km a gente que no iba dentro.

**2. El corte solo miraba los tramos abiertos.** El 17/09 el motor cerró el tramo de Macilon con **58 horas** de duración; al dejar de estar abierto dejó de cortarse y sus 219 km reaparecieron en el reporte del día 16. Que un tramo esté cerrado no lo hace creíble: lo único que dice es que alguien volvió a conectarse, dos días después. Medido entonces: **512 tramos cerrados de más de 12 h en treinta días, 11.327 horas**, todos «desconectado».

**3. Una guarda por rendimiento dejó fuera el caso que importa.** Para que no costara caro, los tramos cerrados de menos de 12 h se salían sin preguntar nada. Y ahí se colaba el conductor que aparece en **dos coches a la vez**: Isac Muntean tenía el 6621LTK en «desconectado» de 07:55 a 19:00 mientras a las 08:05 ya trabajaba en el 8997LDK. Once horas, por debajo del tope, y 118,5 km del coche que había dejado.

## Por qué costaba caro (y cómo se arregló)

El corte lleva dos subconsultas dentro. Metido en el `ON` del cruce, PostgreSQL lo resolvía **una vez por cada pareja de tramo y trozo de km**: tres mil por cincuenta mil son 157 millones de veces. La pantalla pasaba de segundos a minuto y medio.

Dos líneas lo arreglan, y las dos dicen lo mismo de otra forma:

- La CTE de tramos va **`MATERIALIZED`**: el corte se calcula una vez por tramo y no una vez por pareja.
- Solo se mira hacia atrás **lo que el tope permite** (12 h en vez de 14 días): ningún tramo cuenta más allá de su inicio más el tope, así que barrer cincuenta mil tramos para descartarlos era trabajo tirado.

Resultado: `actividadPorConductor` de 87 s a 3,5 s; la alerta de WhatsApp de 15,6 s a 1,2 s.

## Dónde se aplica

- `services/flotaViva/rutas.js` — toda la atribución de km por conductor (En directo, Histórico, reporte de horas, km sin dueño).
- `modules/Control/alertas.repo.js` — la alerta de WhatsApp, que **importa el mismo `FIN_KM`** en vez de copiarlo. Si la alerta repartiera con una regla y la pantalla con otra, se llamaría a la gente con un número que no sale por ningún lado.

## Lo que NO cambia

Las **horas** no se cortan. Un tramo desconectado de tres días no es trabajo, así que nunca entra en las horas efectivas; y acotar la consulta de minutos rompía otras cosas (a un conductor le pasaban 1.492 minutos a 52). El corte es solo para kilómetros.

Relacionado: [[Flota viva]] · [[Km por odometro CAN]] · [[Control Alertas]] · [[Control En directo]] · [[Jornada y turnos]]
