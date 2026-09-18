---
tags: [modulo, control, mapon, coches, postgresql]
aliases: [Coches sin cuadrante, Coches libres]
---

# Control · Coches sin cuadrante

`/control/coches` enseña los coches que **se movieron sin que hubiera nadie puesto para llevarlos**. Vive en `modules/Control/cochesLibres.service.js` → `cochesLibres.repo.js`, con la pantalla en `modules/Control/vistas/controlCoches.ejs`.

## Por qué existe

Todo [[Control]] mira **personas**: quién no ha salido, quién rueda con la app cerrada, a quién hay que llamar. Esta pantalla mira **coches**, y no es la misma pregunta. No es «a quién llamo», es **«quién está usando esto»**.

El 17/09/2026 el **5646MDM** rodó 59 km de noche y no aparecía en ninguna pantalla de Control. No por un fallo: es que para Control **no existía**. Su correturnos está de baja médica, así que esa noche la plaza no la cubre nadie — y un coche que nadie tiene planificado no sale en un tablero que se construye a partir de la gente.

Ese era el agujero: el sistema vigilaba muy bien a los del cuadrante y **no vigilaba en absoluto a los que no están en él**.

> [!warning] Por TURNO, no por coche
> Es la diferencia entre ver el caso y no verlo. El 5646MDM **tiene fijo de día**, así que mirando el coche entero siempre sale «planificado», y sus noches de miércoles y jueves —los días que libra el fijo y su correturnos está de baja— no aparecían en ningún sitio. Que es exactamente cuando se lo llevaron.
>
> La cobertura se cuenta por `(vehiculo_id, turno)`, no por vehículo.

## Las cuatro listas

El rojo es para una sola cosa: si todo grita, no grita nada.

| Lista | Qué es | Por qué |
|---|---|---|
| **Nadie detrás** | rodó, nadie planificado **y** nadie conectado en BOLT | No es un hueco de cuadrante: es alguien conduciendo sin fichar |
| **Fuera de cobertura y rodando** | en taller, siniestro o de baja | No debería moverse en absoluto |
| **De reserva** | operativo y sin ninguna plaza | No es de nadie; si se mueve, alguien lo ha cogido |
| **Sin plan, con alguien fichado** | salió alguien que el cuadrante no puso ahí | Hueco de planificación, no un coche perdido |

La última va **aparte para no tapar a la primera**: son unas 19 al día y ahogarían la lista que importa (5 el 17/09, 7 el 16/09).

## Los km salen de Mapon, y esa es toda la gracia

Se miden con `fv_ruta` —los trayectos de Mapon— y **no** con BOLT. Un coche que nadie ficha **no deja un solo apunte de BOLT**, así que preguntarle a BOLT por él devuelve silencio. → [[Flota viva]]

El mínimo son **3 km** (`CONTROL_MIN_KM_SIN_PLAN`). Por debajo es moverlo dentro del parking o el error del GPS parado, y una lista que grita por cada coche recolocado no la mira nadie.

La pantalla enseña también las **salidas de zona** de cada coche, que es la otra cosa que hay que saber de uno que no debería estar rodando. → [[Control Alertas]]

## Lo que NO es

No sustituye a los **kilómetros sin dueño** del cockpit de [[Control En directo]] (`kmSinDuenio`), que es una resta —los km del coche menos los que se han podido atribuir— sobre coches que sí están planificados. Aquello contesta «a este coche le faltan km por atribuir»; esto contesta «a este coche no le tocaba salir».

Relacionado: [[Control]] · [[Control Alertas]] · [[Planificacion]] · [[Mapon]] · [[Flota viva]]
