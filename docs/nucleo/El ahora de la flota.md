---
tags: [nucleo, flota-viva, bolt, patron, en-vivo]
fecha: 2026-09-25
estado: en producción
---

# El ahora de la flota

Qué está haciendo en BOLT **cada coche y cada conductor en este momento**, calculado **una sola vez** para todas las pantallas que lo enseñan. Vive en `services/flotaViva/ahora.js`.

## Por qué existe

Camilo, 25/09/2026, con una captura de En directo: *«este está en espera hace como 3 minutos en Control, pero en el mapa ya dice que está parado desconectado, y es verdad»*. Y después: *«¿podemos aplicar un patrón de diseño? Quiero que ambos módulos reutilicen los mismos datos sin repetir procesos ni consultas diferentes»*.

Mirándolo, **había tres sitios** que calculaban lo mismo, cada uno por su lado:

| Quién | Qué calculaba | Cada cuánto se refrescaba la pantalla |
|---|---|---|
| El mapa (`mapa.repo`) | el ahora de cada **coche** | 10 s |
| Control, tarjeta del coche (`panel.service`) | el ahora de cada **coche** | 45 s |
| Control, fila de la persona (`rutas.actividadDeVariosTurnos`) | el ahora de cada **conductor** — el chip «En espera» | 45 s, recalculando el cockpit entero |

Tres consultas distintas, tres copias de la regla «gana la noticia más fresca» y **ningún desempate**. El caso de la captura no era de velocidad: Duvan tenía dos apuntes de BOLT **en el mismo segundo** («waiting_orders» y «busy»), y cada consulta se quedaba con uno cualquiera. El mapa cogió «busy» (parado, no trabaja) y Control «waiting_orders» (en espera).

## El patrón: fuente única, caché compartida, aviso al cambiar

```
  ingesta 10 s ──┐
  ingesta 5 min ─┼── invalidar() ──►  FOTO DEL AHORA  ◄── foto() ── mapa (10 s)
  motor 5 min ───┘                   (una consulta,    ◄── foto() ── En directo (10 s el ahora)
                                      una regla)        ◄── foto() ── panel de Flota viva
                                          │             ◄── foto() ── aviso de sueltos (30 s)
                                          └── alCambiar() ──► el mapa tira su foto de posiciones
```

- **Una foto.** Dos consultas (coches y conductores). La regla —tramo del motor contra último apunte de BOLT, gana el más reciente, y si dicen lo mismo se queda el tramo, que sabe desde cuándo dura— se aplica **una vez**, aquí. Se lee por la clave que convenga: `porMatricula`, `porUnidad` (Mapon), `porVehiculo`, `porConductor`.
- **Se rehace solo si hay algo nuevo** (patrón *observador*). Quien escribe avisa con `invalidar()`: la ingesta de 10 s cuando entran apuntes, la red de seguridad de 5 min si recoge algo, el motor al acabar la vuelta. La siguiente petición la rehace. **Si nadie mira, no se hace nada.** Lleva un tope de 15 s (`AHORA_TOPE_MS`) por si un aviso no llega.
- **Una consulta a la vez** (*single-flight*). Si el mapa y tres pantallas de Control la piden mientras se está haciendo, todos esperan a esa misma. Probado: cinco peticiones a la vez, una construcción, la misma foto para los cinco.
- **Quien guarde algo derivado se apunta** con `alCambiar(fn)`. El mapa guarda su foto de posiciones y la tira en cuanto cambia lo de BOLT.

## El desempate: dos apuntes en el mismo segundo

`services/flotaViva/desempate.js`. En 14 días hubo **1.074 empates** y **1.053 eran «waiting_orders + busy»**. El apunte siguiente lo aclara: BOLT apunta un cambio, no un estado en el que ya estás, así que si lo siguiente es «waiting_orders», el estado del empate era el otro. Pasó **639 veces y en todas era «busy»**: la espera es solo la entrada de paso. El orden en que se guardaron (el id) no sirve: falla justo en esos casos.

Empatados, gana el de más rango: **espera < viaje < descanso < desconectado**. Contrastado con los 1.073 empates que tienen un apunte detrás: encaja en **1.066**. Los 7 que no son del par raro «espera + viaje».

La usan la foto (en SQL, `sqlRango`) y **el motor de tramos** (en JavaScript, `ordenar`). Antes el motor dependía del orden en que BOLT devolviera los apuntes, que no está garantizado.

> [!warning] La auditoría de km desempata AL REVÉS, y es a propósito
> `RANGO_ESTADO` en `modules/Operaciones/auditoria.service.js` hace ganar a «waiting_orders» sobre «busy»: allí se **acusa** a un conductor (km rodados en descanso) y ante la duda gana el estado que no acusa. Aquí la pregunta es qué está haciendo **ahora**, y la contesta el dato. No se unifican sin decidirlo antes. Ver [[BOLT]].

## Quién la lee

| | Cómo |
|---|---|
| [[Mapa de flota]] | `mapa.service.frente()`: la posición es suya; lo de BOLT, de `porMatricula`. Su consulta ya no toca `fv_ahora` ni `bolt_state_log` |
| [[Control En directo]] · tarjeta del coche | `panel.service.estado()`: los coches vigilados de la foto, tal cual |
| [[Control En directo]] · fila de la persona | `rutas.actividadDeVariosTurnos`: el ahora de cada conductor sale de `porConductor` (si el motor no sabe algo más nuevo de sus tramos) |
| [[Control En directo]] · **cada 10 s** | `GET /control/api/directo/ahora`: la foto por conductor, compacta (`[situación, desde]`, ~9 kB). La pantalla lo pone encima de lo cargado sin recalcular el turno entero |
| [[Control Alertas]] | `mapa.sueltos()`, a través del mapa |

Comprobado contra la base real (`Scripts de análisis/probar-foto-ahora.js`, solo lee): cada coche del mapa dice lo mismo que la foto (0 distintos de 83) y en los **52 conectados el cockpit y la foto coinciden todos**.

## Añadir otra pantalla

Pedir `await require('services/flotaViva/ahora').foto()` y leer. **No** volver a escribir una consulta contra `bolt_state_log` o `fv_ahora` para saber «qué hace ahora»: es exactamente lo que había que quitar. Si la pantalla guarda algo hecho con la foto, apuntarse con `alCambiar()` para tirarlo al cambiar.

Para diagnosticar sin abrir la base: `ahora.estado()` dice cuántas fotos se han hecho, si la guardada vale, y lo que tardó y trajo la última.

## Ficheros

```
services/flotaViva/ahora.js       la foto, la caché, el single-flight y los avisos
services/flotaViva/desempate.js   la regla del mismo segundo (SQL y JS)
```

Relacionado: [[Flota viva]] · [[BOLT]] · [[Trampas conocidas]]
