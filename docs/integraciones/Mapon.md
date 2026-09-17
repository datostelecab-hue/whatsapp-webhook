---
tags: [integracion, mapon, gps, km, telemetria]
aliases: [API de Mapon, GPS]
---

# Mapon

Mapon es el GPS de la flota: ~144 turismos con equipo instalado. Dice **dónde está el coche, cuánto ha rodado, si está encendido y qué marca el cuadro**. Lo que no dice es quién lo conduce — eso lo pone [[BOLT]]. Ninguna de las dos fuentes sirve sola: BOLT no sabe que un coche "en descanso" lleva cuarenta kilómetros hechos, y Mapon no sabe quién lo lleva.

El cliente vive en `services/mapon.js`, con una segunda vía en `services/flotaViva/fuentes.js` (duplicación pequeña y consciente, que desaparece cuando las ramas se junten). El mapa completo de la API está en [[API_MAPON]] (`docs/API_MAPON.md`).

## Cómo se entra

Base `https://mapon.com/api/v1/`, con la clave **por parámetro `key` en la URL**. Vive en la variable de entorno `MAPON_API_KEY` y solo está puesta en el servidor; si falta, las llamadas a Mapon simplemente no se hacen y el resto del sistema sigue.

> [!warning] La clave es sensible de verdad
> Con esa clave se pueden **abrir puertas y ventanillas de cualquier coche de la flota** y —desde el 16/09/2026— **cortar el motor**. No es una clave de lectura: es una llave.

Fechas siempre **ISO 8601 en UTC** (`2026-08-11T12:00:00Z`); Madrid va +1/+2. Los errores llegan como `{"error":{"code":<int>,"msg":"..."}}`: códigos ≥1000 globales, 1–999 propios de cada método. Corte de tiempo a **20 s** (`MAPON_TIMEOUT_MS`); sin él, una petición que Mapon no contesta cuelga el cron o la pantalla que la lanzó — ya pasó una vez con el enlace de unidades.

## `unit/list.json` — la foto viva

Toda la flota en **una sola llamada, sin paginación**: matrícula (`number`), lat/lng, `speed`, `state`, `last_update`. El padrón de unidades (`unit_id` → matrícula) se cachea **10 minutos**, y si una lectura viene vacía se conserva la anterior en vez de dejar la flota sin nombres.

Lo que se pide con `include`: `can` (odómetro real), `ignition`, `relays`, `fuel`, `device`, `ev_values`. `in_objects` y `saved_values` solo funcionan pidiendo **una única unidad**.

## 🚨 `mileage` NO es el odómetro

Esto es lo más importante de esta nota. `mileage` parece el cuentakilómetros y no lo es: son **los km recorridos desde que se instaló el dispositivo**.

Contrastado el **09/09/2026** contra los km de la última revisión del taller: de 27 coches con los dos datos, **25 daban un imposible**. El 5886LBZ marcaba `mileage` 30.723 contra **629.100 km reales**. Y lo confirman los propios datos: en 87 de 95 unidades el `mileage` equivale a entre 1 y 4 meses de su propio ritmo (mediana 2,3 — la flota se instaló en verano de 2026), y una unidad recién dada de alta marca casi cero.

**El odómetro de verdad está en `include[]=can` → `can.odom`**, en kilómetros con decimal y con su propio `gmt`. Es la lectura del bus CAN, o sea el número del cuadro. Contrastado contra los mismos coches: **26 de 26 cuadran, ninguno imposible**. Lo dan **90 de las 144 unidades**; las demás llevan un equipo que no lee el CAN, y eso no es un error: ese coche irá por GPS y la pantalla lo dice.

En el código: `mapon.unidades()` devuelve `odometroM` (el malo, sirve para medir recorrido) y `odometroCanM` (el bueno), y de ahí sale `vehiculo.km_odometro_m`.

## La serie histórica del odómetro

Para km por día o por turno no vale la foto: hace falta la serie. Es `unit_data/can_period.json` con **`include[]=total_distance`** (ver [[Km por odometro CAN]]).

- Llega cada **90 segundos de mediana** mientras el coche anda.
- Es **acumulado**: dos lecturas se restan y ya está, no hay nada que escalar.
- Resolución de 1 km, así que entre lectura y lectura puede haber hasta 4 km de salto legítimo.
- `include[]=total_distance` baja la respuesta de **240 KB a 27 KB**: sin él vienen además las revoluciones (5.201 puntos en un día) y el combustible, que aquí no se miran.
- **Es de una unidad en una.** `unit_id[]=a&unit_id[]=b` devuelve solo la primera, y sin `unit_id` da error. No hay forma de pedir la flota entera de un golpe, como sí la hay con `route/list`. Por eso quien la usa va con **cola de 4**.

Por qué se prefiere al GPS: `route/list` da los km que Mapon **calcula** uniendo puntos, corta las curvas y pierde el trozo entero cuando el equipo pierde cobertura. Medido el 16/09/2026 sobre la flota, el GPS sale un **4 % por debajo**; coche a coche la mediana de diferencia es 0,4 % —dicen lo mismo—, pero el **0454MMZ** marcó **45 km de GPS contra 518 reales** y el **9521MMX** no tenía ni un trayecto en Mapon habiendo hecho **511 km**. No era un problema de precisión: eran coches enteros mal medidos.

## `route/list.json` — trayectos

Viajes y paradas por unidad: inicio/fin, `distance` en metros, duración, direcciones. Las paradas (`type != 'route'`) no suman km.

- `include=decoded_route` da la **traza punto a punto** (lat/lng + hora), y **solo se obtiene pidiendo una única unidad** — de ahí una llamada por coche, que es lo que hace cara la auditoría (se ejecuta en el cron de madrugada, no en cada consulta).
- `include=driver_id` dice si Mapon atribuye el trayecto a alguien. Como los conductores no están en Mapon salvo por el fichaje, la atribución buena es la del libro de turnos.

> [!warning] `route/list` devuelve el trayecto ENTERO aunque solo toque la ventana
> Un tramo de conducción que venía de antes se contaba completo. Caso real **0348MMZ**: "60,7 km en descanso" que en realidad eran de toda la mañana — después de las 11:41 Mapon daba ~2 km. Por eso existe `kmEnVentanaExacto()`, que recorta: trayecto entero dentro → su distancia Mapon; trayecto que cruza el borde → suma haversine de los segmentos interiores; sin traza → solo cuenta si **empezó** dentro.

Para la flota entera (`leerKmPorDia`), el rango se trocea en ventanas de **5 días pedidas en serie** y los trayectos que caen justo en el corte se deduplican por `route_id`. Un trayecto que cruza la medianoche cuenta entero en su día de inicio.

## Alertas — `alert/list.json`

**Mapon no tiene webhook.** Sus canales son email, SMS y pop-up en su plataforma, así que la única forma de traerse los eventos es preguntando. Devuelve lo ya disparado por los *setups* configurados en la cuenta (se listan con `listarSetups()`, `alert/list_setups.json`).

Tipos que la cuenta tiene activos: `speeding`, `in_object`, `not_in_obj`, `no_power`, `supply_voltage`, `battery_level`, `moving`. El más frecuente resultó ser `not_in_obj` —**102 de 193 alertas en una semana**— y no estaba en la tabla de traducción: salía en pantalla con su código crudo.

Trampas de esta llamada:

- **`alert_val` cambia de forma según el tipo.** En `speeding` y `no_power` es un JSON metido dentro de un string; en `in_object` es `'Zona|IN'`. `parseValor()` devuelve siempre un objeto para que quien lo use no tenga que saber de dónde venía.
- **Los eventos no traen id propio.** La clave única es `unit_id | hora | tipo`, y es lo que evita repetir avisos cuando el cron consulta con solape. (`include=id` existe y daría un id de alerta de verdad: mejor dedupe, aún sin usar.)
- **Paginación de 150 por página con tope de 10 páginas.** La respuesta trae `truncado: true` cuando había más: una lista truncada no puede darse por completa.

El umbral de gravedad (`MAPON_UMBRAL_VELOCIDAD`, 150 por defecto) es **nuestro**, no de Mapon: el setup de la cuenta avisa a 130, así que todo lo que pasa de 150 ya viene incluido y cambiar el umbral no obliga a tocar la configuración de Mapon.

## Combustible — `fuel/*`

`fuel/changes.json` da subidas (repostajes) y caídas bruscas (posible robo) con lugar y nivel previo; `fuel/summary.json` da repostado, drenado y consumido por unidad. Cada dato viene **por duplicado** desde la fuente `sensor` (varilla) y `can` (centralita): en turismos sin varillas la fuente real es el CAN, así que se prefiere `can` y se cae a `sensor` solo si el CAN no trae nada. Ventana de 31 días.

## Relés: el corte de motor

**Funciona desde el 16/09/2026**, cuando Mapon concedió el permiso. `unit/change_relay.json` por POST con `unit_id`, `relay_id` y `relay_state`. Los coches llevan `relay_id: 1`, `type: engine_block`, título "Bloqueo Motor". Semántica comprobada en coche real: **0 = motor libre, 1 = motor bloqueado**.

Probado en el **7222LVG (unit 893958, Toyota Corolla)**: se manda el 1, se relee y en **dos segundos** el coche lo confirma. Con el corte puesto **no arranca**: el bloqueo es real, no un estado en el servidor.

> [!danger] NUNCA cortar con el contacto puesto
> Si el relé entra con el coche encendido, el Corolla arranca y anda **pero ya no se deja apagar**: el corte está metido en la línea que el coche necesita para completar el apagado, y el conductor se queda con un coche encendido que no responde al botón. Es peor que no bloquearlo. Por eso el fichaje no deja terminar turno con el contacto puesto (`puedeInmovilizar`, en `services/fichaje.js`).

Otras cosas que hay que saber:

- **`status: ok` solo confirma que la orden salió.** Para saber si el relé cambió hay que releer `unit/list.json` con `include[]=relays`: eso hace `cambiarReleConfirmado()`, que reintenta hasta 5 veces cada 2 s. `ok:false` con `confirmado:false` significa que la orden salió y el equipo no la aplicó (sin cobertura, por ejemplo).
- **Solo se acciona `engine_block`.** Antes, si el coche no tenía ese tipo, se devolvía el primer relé que hubiera — o sea, accionar a ciegas un relé desconocido de un coche real. Un coche sin corte de motor tiene que decir que no tiene corte de motor.
- Error propio **7**: *"Can not block engine while vehicle is driving"*.
- **Error 1006 "Method not available"** es falta de permiso sobre la clave, no un fallo de parámetros. Y **el 1006 no distingue "sin permiso" de "esa ruta no existe"**: comprobado el 16/09/2026, una ruta inventada devuelve exactamente el mismo 1006. Un 1006 nunca prueba por sí solo que un método exista.

## `unit_commands`: la vía que no sirve

Soporte de Mapon nos mandó aquí cuando `change_relay` daba 1006. Son dos métodos: `get_available.json` (catálogo de comandos de esa unidad; los nombres los define cada instalación, **no se adivinan, se preguntan**) y `execute.json`.

Probado en la flota el **18/08/2026** y el resultado es doble negativo:

1. La unidad 893954 (Toyota Corolla) ofrece `close_doors`, `open_doors`, `open_trunk`, `hazard_lights`, `open_windows`, `close_windows`. Son órdenes de carrocería y confort de *connected car*: **ninguna inmoviliza el vehículo**.
2. **Ni siquiera llegan al coche.** En la unidad 893922 (Hyundai Ioniq, parado), `open_windows` responde `{"status":"ok"}` y las ventanillas no se abren. Mismo resultado en dos marcas distintas, así que no es cosa de un coche: ese `ok` es un acuse de recibo de Mapon, no una confirmación de ejecución. La hipótesis es que hace falta el servicio conectado del fabricante, que es una suscripción aparte.

Conclusión: para bloqueo de motor vale `unit/change_relay` y nada más.

## Las trampas, juntas

> [!danger] Lo que rompe si no se sabe
> - **`state` es un OBJETO**, no una cadena: `{name, start, duration, debug_info}`, y hay un `movement_state` aparte. Tratarlo como texto daba `[object Object]` en las 144 unidades. El nombre (`driving`/`standing`/`nodata`/`nogps`/`service`) está en `state.name`.
> - **La ignición no es 0/1: es `{ gmt, value: 'on'|'off' }`.** El código hacía `!!Number(u.ignition)` sobre ese objeto —que da NaN, y NaN es `false`—, así que el sistema se pasó **semanas creyendo que ningún coche tenía nunca el contacto puesto**, y por eso nunca frenaba el corte. Se interpreta con `contactoPuesto()`, que devuelve **`null` cuando no lo sabe**: "no lo sé" no puede leerse como "no".
> - **`include` con varios valores va como ARRAY**: `include[]=relays&include[]=ignition`. Separados por comas Mapon los **ignora en silencio** y devuelve la unidad sin esos bloques — parece "no tiene relés" cuando en realidad no se pidieron bien.
> - **5 peticiones concurrentes por cuenta** (error 1011). El poller de sanciones ya consume, así que cualquier barrido de flota va con cola ≤4 (la auditoría usa 3 para dejar hueco) o directamente en serie.
> - **Ventana máxima de 31 días** en casi todos los históricos: `route/list`, `alert/list`, `fuel/*`, `can_period`, informes. Se valida antes de llamar y se avisa con el número de días pedidos.
> - **`driver/list.json` no pagina**: `limit`/`offset`/`page` se ignoran y siempre devuelve la lista entera.
> - **El teléfono es único entre CONDUCTORES Y USUARIOS a la vez.** `driver/create` con un teléfono que ya usa un *usuario* de la plataforma devuelve `error 1002: The phone has already been taken`, y ese usuario **no aparece en `driver/list`**, así que buscarlo allí no lo encuentra nunca (los usuarios se listan con `user/list.json`). Dejó cuatro turnos sin enlazar el 16/09/2026. El fichaje, al chocar con el 1002, crea el conductor **sin teléfono**: el nombre sobre el coche vale más que la ficha completa.
>
> Más en [[Trampas conocidas]].

## Quién llama a Mapon

Solo la [[Ingesta]] y los trabajos de fondo; ninguna pantalla pregunta a Mapon en vivo. Antes sí: las alertas se pedían en **cada carga** de la pantalla de Operaciones, así que si Mapon estaba caído la pantalla no decía "esto es de hace un rato", decía error — y como la ventana de la API es de 31 días, lo anterior no existía para nadie.

| Tarea | Cada | Qué pide |
|---|---|---|
| zonas (`in_object`) | 15 min | decide si la espera cuenta como área (TE_A1) |
| alertas | 15 min | velocidad, zonas, alimentación, batería |
| [[Auditoria de flota]] | 1 vez al día, de madrugada | una llamada `route/list` **por coche** — la tarea más cara con diferencia |

Cada tarea declara además `reintentoMin`: sin eso, una tarea que falla se reintenta en cada latido de 5 minutos, y para la auditoría —144 llamadas por vuelta— sería gastarse la cuota del día en una hora repitiendo el mismo error.

## A futuro: `data_forward`

`data_forward/save.json` hace que Mapon **empuje** datos a un endpoint nuestro por packs (posición, ignición, entrada/salida de zona, comportamiento, odómetro, altas/bajas). Sustituiría el polling de posición y zonas; las alertas seguirían por polling porque no entran en data forwarding. La cola por endpoint tiene TTL de **12 h** y máximo **100.000** elementos: si el webhook cae más que eso se pierden packs, así que habría que diseñarlo con reconciliación por polling de respaldo.
