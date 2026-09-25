---
tags: [nucleo, ingesta, bolt, mapon, postgresql]
fecha: 2026-09-17
estado: en producción
---

# Ingesta

La **única puerta** por la que entran datos externos. `services/ingesta.js` trae lo de [[BOLT]] y lo de [[Mapon]] y lo deja en PostgreSQL; todo lo demás lee de la base.

> **REGLA: ningún módulo llama a BOLT ni a Mapon para pintar una pantalla.**

## Por qué una sola puerta

Tres razones, todas comprobadas a base de disgustos:

- **Una pantalla no depende de que una API responda.** Mapon se cae de vez en cuando por temas de pago y RRHH ni se entera: sigue leyendo lo último que entró, y puede decir **de cuándo es**. Antes, las alertas las pedía la pantalla de Operaciones en cada carga: si Mapon estaba caído la pantalla no decía «esto es de hace un rato», decía *error*. Y como la ventana de la API es de 31 días, lo anterior no existía para nadie.
- **La cuota se controla en un sitio**, no en catorce.
- **Una respuesta se interpreta una vez.** `getVehicles` lo leían la auditoría de flota y la auditoría en vivo, cada una quedándose con cosas distintas del mismo JSON.

## El latido

Un cron en `app.js` cada cinco minutos (`programar('*/5 * * * *')`, zona `Europe/Madrid`) llama a `latido()`, que recorre las tareas y ejecuta **las que toquen**.

Las tareas van **en serie a propósito**: en paralelo, dos tareas de BOLT compiten por la misma cuota y se sacan 429 la una a la otra.

El latido es de 5 minutos; **la cadencia la pone cada tarea**. El padrón de conductores no cambia cada cinco minutos y pedirlo así son cientos de páginas por hora — ya se vio un 429 pidiéndolo una sola vez.

## Las tareas

Cada una declara `cadaMin`, si es `critica` y, las caras, un `reintentoMin`. Todas se ajustan por variable de entorno sin tocar código.

| Tarea | Fuente | Cada | Crítica | Qué escribe |
|---|---|---|---|---|
| `padron_bolt` | BOLT | 60 min | **sí** | inventario de cuentas y su cazamiento |
| `vehiculos_bolt` | BOLT | 360 min | no | coches de BOLT |
| `state_logs_bolt` | BOLT | 10 min | **sí** | `ingesta_descarga` + `bolt_state_log`, ventana de 2 h |
| `orders_bolt` | BOLT | 60 min | no | `bolt_order`, ventana de **48 h** |
| `orders_recientes_bolt` | BOLT | 10 min | no | `bolt_order`, ventana de **2 h** |
| `zonas_mapon` | Mapon | 15 min | no | `mapon_zona_evento` (entradas/salidas) |
| `alertas_mapon` | Mapon | 15 min | no | `mapon_alerta` (velocidad, zonas, alimentación, batería) |
| `unidades_mapon` | Mapon | 30 min | no | odómetros de los coches |
| `auditoria_flota` | Mapon | 1440 min | no | `auditoria_km` y compañía; reintento cada 60 min |
| `tickets_formulario` | formulario | 10 min | no | tickets del formulario de conductores. **Solo lee lo nuevo** y no escribe en la hoja. No corrió hasta el 25/09/2026: estaba anidada por error dentro de `unidades_mapon` (ver [[Ticketera]]) |

**`critica` no es decoración:** BOLT cayéndose es una alarma (`❌`), Mapon cayéndose es lo normal (`⚠️`). Que Mapon se caiga no puede teñir de rojo la ingesta de la que vive el cuadrante.

### Las dos tareas de órdenes

Parecen duplicadas y no lo son. `orders_bolt` trae **48 horas cada hora**: es perfecto para el dinero, porque una orden **madura** durante horas y hay que volver a por su precio final. Y es malísimo para avisar de nada: las alertas de [[Control]] preguntan «¿cuántas ha rechazado en esta franja?» y la respuesta llegaba con hasta **sesenta minutos de retraso** — para cuando sonaba el aviso, el conductor ya había hecho el turno entero.

`orders_recientes_bolt` trae **dos horas**: unas 2.000 órdenes por pasada en vez de las ~50.000 de la otra, veinticinco veces más barata, y por eso se puede pedir cada diez minutos. Escribe en la **misma tabla y por la misma puerta** (`guardarOrders` es idempotente), así que no duplica nada: solo adelanta el aterrizaje de lo recién ocurrido.

Esa sí guarda la fila de descarga **pero sin el crudo**: el payload se repetiría cada diez minutos y serían cientos de MB al día de lo mismo.

### La auditoría de flota

Es la tarea más cara con diferencia —una llamada a Mapon por coche, unos 20 segundos— y por eso va una vez al día. El cron de las 5:00 solo **pone la hora**: el trabajo lo hace la ingesta, que es quien lleva la cuenta. Antes era un cron mudo y, si dejaba de funcionar, nadie se enteraba hasta que alguien echaba en falta un día en la pantalla.

Y **se cura sola**: si ayer ya está, se ocupa del día pendiente más antiguo de la última semana.

## Cuándo toca

`toca(tarea)` mira el **último acierto**, no el último intento: un fallo suelto no puede dejar una tarea parada hasta su siguiente turno.

Con `reintentoMin` la lógica se invierte y además se mira el último intento, para **esperar**. Es para las tareas caras: reintentar cada cinco minutos lo que acaba de fallar cuesta más que quedarse quieto. Para la auditoría, que son 144 llamadas a Mapon por vuelta, la hora de espera es la diferencia entre reintentar y machacar.

## Lo que queda apuntado

`ejecutar()` **nunca lanza**: la ingesta de una fuente no puede tumbar la de otra ni el proceso entero. Escriba o falle, deja una fila en `ingesta_ejecucion` (fuente, tarea, ok, duración, registros, detalle o error).

De ahí sale la vista `v_ingesta_estado` y el panel, que marca una tarea **al día** si su último acierto es más reciente que su cadencia con margen de 2,5 veces. Un fallo puntual no la marca como caída.

## Flota viva va por su cuenta

[[Flota viva]] tiene su propio cron, también cada cinco minutos, y es la otra mitad de la puerta: de ahí salen `fv_tramo`, `fv_ruta` y `fv_odometro`. Sigue la misma regla —una sola llamada de flota por vuelta alimenta a todas las pantallas— pero con su propia conexión y su propio registro (`fv_vuelta`).

## La poda

A las 00:00 se vacía el **payload crudo** de las descargas viejas (`purgar_descargas`, retención `INGESTA_CRUDO_DIAS`, 1 día por defecto), porque con las ventanas solapadas a propósito son **90–250 MB al día** del mismo dato. Nadie re-lee ese JSON: una orden que madura se **re-descarga** de BOLT.

El dato bueno (`bolt_state_log`, `bolt_order`, `mapon_zona_evento`, `fv_*`) no se toca: son tablas aparte e idempotentes. Detrás va un `VACUUM` normal —que no bloquea lecturas ni escrituras, al contrario que `VACUUM FULL`— para reutilizar el hueco muerto del TOAST. Y el registro de ejecuciones se queda 7 días (28 los fallos).

Ver también: [[Base de datos]], [[Migraciones]], [[Flota viva]], [[Reglas de la casa]], [[Glosario]].
