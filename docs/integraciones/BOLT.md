---
tags: [integracion, bolt, ingesta, api, jornada]
aliases: [Fleet Integration Gateway, API de Bolt]
---

# BOLT

BOLT es el operador con el que trabaja la flota, y su API —el *Fleet Integration Gateway*— es la que dice **quién conduce, en qué estado está y cuánto ha facturado**. De aquí salen tres cosas de las que depende medio ERP: la identidad externa del conductor (`driver_uuid`), la jornada laboral (de los cambios de estado) y el dinero (de los pedidos).

El adaptador vive en `services/bolt.js` —"cómo se le pregunta a BOLT" y nada más— y el padrón de conductores en `services/conductoresBolt.js`. Ninguna pantalla llama a BOLT: lo trae la [[Ingesta]] y todo lo demás lee de PostgreSQL.

## Cómo se entra

OAuth de tipo `client_credentials` contra el emisor de BOLT, con scope `fleet-integration:api`. El token se guarda en memoria y se da por caducado a los **9 minutos**, aunque BOLT diga que dura más: es margen, no exactitud. Un `401` o un `403` tira el token y repite la llamada una vez.

> [!danger] Riesgo abierto: credenciales en el código
> El `client_id` y el `client_secret` de BOLT están **escritos dentro de `services/bolt.js`**, no en variables de entorno. Es la única credencial del sistema que no vive en el entorno (Mapon, WhatsApp, Google y SMTP sí). Quien lea el repositorio tiene acceso a la API de la flota. Pendiente de sacar a variables de entorno.

## Las dos flotas

`CONFIG_BOLT.flotas` tiene dos empresas y **toda llamada recorre las dos y concatena**. Una de ellas ya no está operativa, pero conserva el histórico de horas hasta junio: se mantiene en la lista para que los meses antiguos salgan completos. Que una flota cerrada devuelva cero registros **no es un aviso**, es lo esperado.

## Los cuatro endpoints

La API tiene **seis** (`open-api.json`): los cuatro de abajo más `test` —un ping— y `getCompanies`, que devuelve las empresas del acuerdo y que no se usa porque las dos flotas están escritas en `CONFIG_BOLT`.

| Endpoint | Clave de datos | Para qué | Quién lo pide |
|---|---|---|---|
| `getFleetStateLogs` | `state_logs` | la jornada y el panel en vivo | ingesta cada 10 min (ventana de 2 h, solapada) |
| `getFleetOrders` | `orders` | dinero, cancelaciones, rechazos | ingesta cada hora (48 h) y cada 10 min (2 h) |
| `getDrivers` | `drivers` | el padrón de conductores | ingesta cada hora |
| `getVehicles` | `vehicles` | modelo, año, color, plazas, VIN, licencia | ingesta cada 6 h |

Todos son `POST`, todos piden `company_id` y una ventana `start_ts`/`end_ts` en epoch de segundos. `getFleetOrders` quiere además `company_ids` (array) y `time_range_filter_type: 'created'`.

**Por qué dos tareas de órdenes.** La de 48 h es para el dinero: una orden *madura* durante horas y hay que volver a por su precio final. Pero con esa ventana las alertas de [[Control]] llegaban con hasta 60 minutos de retraso — para cuando sonaba el aviso, el conductor ya había hecho el turno entero. La de 2 h son ~2.000 órdenes por pasada en vez de las ~50.000 de la de 48 h: veinticinco veces más barata, y por eso se puede pedir cada diez minutos. Escriben en la misma tabla por la misma puerta idempotente, así que no se estorban. La de 2 h **no guarda el crudo**: repetir ese payload cada diez minutos serían cientos de MB al día de lo mismo.

## Los estados

Los estados que usa BOLT son cuatro —verificado sobre datos reales, no hay más:

| Estado | Qué significa | Cómo se cuenta |
|---|---|---|
| `has_order` | tiene pedido asignado (yendo a recoger o con pasajero) | trabajo efectivo, supuesto **TE_A3**, siempre |
| `waiting_orders` | conectado y disponible, sin pedido | trabajo efectivo **TE_A1** si está en área; si no, **TE_NO** |
| `busy` | conectado pero **no disponible** para BOLT (descanso) | no es trabajo |
| `inactive` | la aplicación está cerrada | fuera |

El total de horas efectivas es **`has_order` + `waiting_orders`**: las dos generan asiento aunque el supuesto cambie. La "efectiva estricta" es solo `has_order`. Ver [[Glosario]].

**Son eventos de CAMBIO, no fotos periódicas.** El 89 % de los pares consecutivos son transiciones, así que la duración entre dos logs es fiable. Eso tiene dos consecuencias:

- La ventana que se pide tiene que ser **generosa**. Un conductor desconectado tres horas no emite ni un log en esas tres horas: con ventana corta ese coche desaparece del mapa en vez de salir como desconectado.
- Hay un tope de hueco de **12 horas** para no imputar estado a un coche que simplemente dejó de reportar. No puede ser corto: en la muestra real había **21 sesiones de `busy` de más de 2 h y una de 7,5 h**, que son justo las que interesan.

**El empate del mismo segundo.** Cuando dos logs caen en el mismo segundo se ordenan por `RANGO_ESTADO` (`inactive` 0 < `busy` 1 < `waiting_orders` 2 < `has_order` 3) y gana el último: ante un empate se impone el estado que NO acusa. Sin eso, el ganador lo decidía el orden de la respuesta de BOLT y el resultado ni siquiera era reproducible.

**Un coche, dos conductores.** El turno de día y el de noche comparten coche y sus logs llegan mezclados. Si se mira solo "el último log", el `inactive` que emite el saliente al cerrar sesión cae encima de los km del entrante y lo acusa sin motivo. Por eso se mira el último estado de **cada** conductor y manda el que esté más trabajando. Ver [[Auditoria de flota]].

## El neto y el resto del dinero

El dinero de una orden viene en `order_price`, y se aterriza en `bolt_order` (`services/repo/staging.js`):

- `net_earnings` → **neto**. Es lo que se reparte por conductor, por día y por turno en el BI.
- `tip` → propina, `toll_fee` → peaje. Van aparte: no son facturación.
- `ride_price`, `cash_discount`, `booking_fee` → el desglose. Con ellos se calcula la **recaudación en efectivo**, que es la deuda del conductor con la empresa: Σ (`ride_price` − `cash_discount` + `booking_fee`) de los pedidos con `payment_method` en efectivo y estado `finished`.

> [!warning] Cancelado no es cero
> En los pedidos cancelados BOLT manda **todo el precio a NULL**. Se guarda NULL y no cero, porque "no cobró" y "cobró cero" no son lo mismo y confundirlos falsea cualquier media.

La clave de una orden es `(driver_uuid, creado_ts)` y el aterrizaje **actualiza**, no duplica: por eso se puede volver a pedir la misma ventana una y otra vez mientras la orden madura.

## Paginación

`fetchAllPaginated(endpoint, body, dataKey, pageSize, etiqueta)` pide páginas de `limit`/`offset` (1.000 registros, 100 en vehículos) hasta que una viene corta o vacía.

El tope son **2.000 páginas**. Antes eran 100 (100.000 registros) y no bastaba: un mes movido de dos flotas lo supera, y como **la API devuelve los logs del más reciente al más antiguo**, al cortar se perdían justo los primeros días del mes.

Ante un `HTTP 429` (límite de peticiones, típico cuando un backfill coincide con los crons) se reintenta el **mismo offset** con espera creciente: 5 s, 10 s, 20 s, 40 s.

Ninguna llamada puede quedarse esperando para siempre: el `fetch` de Node no trae tiempo límite, así que hay un corte en **120 s** (`BOLT_TIMEOUT_MS`). Es generoso a propósito — un barrido de state logs de 15 días tarda minuto y medio de forma legítima. No es un límite de rendimiento, es el seguro de que algo termina.

## La trampa: datos PARCIALES en silencio

> [!danger] `fetchAllPaginated` puede devolver media lectura sin que nadie se entere
> Si una página falla, la función **no lanza**: devuelve lo que llevaba acumulado. Para una pantalla es tolerable; para la [[Auditoria de flota]] es inaceptable — media lectura de logs convierte a un infractor en "espera" y el día queda congelado como limpio.

Hay tres formas de quedarse corto y todas son silenciosas:

1. **Error HTTP a mitad de paginación** → se devuelven las páginas ya leídas.
2. **Tope de páginas alcanzado** → hay datos sin leer.
3. **HTTP 200 con el error dentro del cuerpo.** BOLT responde 200 y mete el código real en `data.code`: `498805` INVALID_START_DATE, `498806` INVALID_DATE_RANGE, `498809` COMPANY_NOT_ACTIVE. Y los transitorios `998`/`999` (CLIENT_TIMEOUT) llegan igual, como 200 con **cero registros**: si no se miran, un error se confunde con "no hay datos" y el mes se escribe vacío sin avisar.

Las defensas:

- **`total_rows` / `total_orders`.** La API dice cuántos registros existen de verdad; si se han leído menos, la lectura se quedó corta y se grita en el log.
- **`fetchAllPaginated.ultimoDiagnostico`** guarda `{ paginas, registros, motivo, errorHttp, codigoCuerpo, mensajeCuerpo, totalRows }` de la última llamada. `motivo` es una de: `fin-de-datos`, `sin-datos`, `timeout`, `error-http`, `tope-paginas`.
- **`comprobarCompleto()`** en `modules/Operaciones/auditoria.service.js`: ante `error-http`, `tope-paginas`, `timeout` o `registros < totalRows`, **aborta el día entero** en vez de guardarlo a medias.

Quien use `fetchAllPaginated` para algo que se escribe en la base **tiene que mirar el diagnóstico**. Ver [[Trampas conocidas]].

## La ventana de 31 días

La API rechaza rangos más largos con `498806 INVALID_DATE_RANGE`. `fetchRangoCompleto()` parte el rango y junta los tramos **antes de procesar nada**, así que un turno que cruce el corte se sigue midiendo entero.

Pasa en **octubre**: del día 1 a las 00:00 al 31 a las 23:59 hay 31 días *y una hora*, porque esa madrugada se atrasan los relojes.

Y se parte también por **timeout**: si el servidor contesta `998`/`999` con cero registros, el rango pesa demasiado para una consulta y insistir con el mismo rango vuelve a fallar. Se divide por la mitad, hasta 4 niveles (16 tramos) y nunca por debajo de 6 horas. Un timeout se reintenta **una sola vez** y corto: lo que lo arregla es partir, no insistir.

## El padrón de conductores

`traerDrivers()` pide `getDrivers` en **dos ventanas de 30 días** (la API no admite más), lo que cubre ~60 días: de sobra para ver a todo el que sigue vivo. Devuelve `Map(driver_uuid → registro)`.

Si alguien está en **varias flotas**, gana el registro más vivo (`state === 'active'`): si no, dar de baja en una flota marcaría de baja a quien sigue trabajando en la otra. `has_cash_payment` se pasa tal cual —`true`, `false` o `undefined`— para que quien lo guarde distinga "no tiene" de "no se sabe".

**BOLT no dice cuándo se creó un conductor.** La fecha nos la fabricamos: la primera vez que se ve un `driver_uuid` se sella `visto_desde` en `conductor_externo` y no se vuelve a tocar nunca. Con ella se sabe que alguien ha aparecido en BOLT sin esperar a que nos avisen — es la señal del puente Selección → RRHH.

Desde el **15/09/2026 se dejó de escribir la hoja `CONDUCTORES_BOLT`**: la ingesta ya hacía lo mismo contra PostgreSQL desde la misma fuente, y eran dos sitios donde podía decirse una cosa distinta del mismo conductor. La equivalencia:

| hoja `CONDUCTORES_BOLT` | `conductor_externo` (sistema `'bolt'`) |
|---|---|
| `driver_uuid` | `externo_id` |
| nombre / email / phone | `externo_nombre` / `_email` / `_telefono` |
| `state` | `estado_externo` |
| `created_at` (inmutable) | `visto_desde` (el UPSERT no la toca) |
| `updated_at` | `visto_at` |

No sobreviven `partner_uuid`, `flota` ni `veces_visto`: no los leía nadie.

**El rescate de las fechas, una sola vez.** La hoja llevaba más tiempo que la base, así que casi todos tenían `visto_desde` del día de la migración (21/08/2026) y no del día en que aparecieron. Eso es lo único que la hoja tenía y la base no, y no se recupera de ninguna API. La primera lectura se trae de la hoja los `created_at` **anteriores** a lo que diga la base —nunca hacia adelante— y lo apunta en `config_app` para no repetirlo. Ver [[Google Drive y Sheets]].

**Buscar por teléfono** (`buscarPorTelefono`) va contra `externo_sufijo9`, una columna generada con los 9 últimos dígitos sin signos y con índice. Antes leía el padrón entero de la hoja y lo recorría.

## La nota del cliente: `driver_rating` y `driver_score`

`getDrivers` trae dos números por conductor que **hoy no se guardan** (`conductor_externo` no tiene columna para ellos y `traerDrivers` no los copia). Están en la especificación oficial, los dos como *number* nullable y **sin una línea de descripción**; lo que significan sale de mirar los datos:

| Campo | Qué es | Cuántos lo traen | Rango real |
|---|---|---|---|
| `driver_rating` | **la nota de los clientes**, en estrellas | 247 de 1.576 cuentas · 222 de los 421 activos | 3,5 – 5 (mediana 4,89) |
| `driver_score` | la puntuación de actividad que calcula Bolt | las 1.576 | 58 – 100 (mediana 98) |

Medido el 23/09/2026 contra las dos flotas.

**El rating no lo tiene todo el mundo, y eso es información.** De los que no traen nota, 1.064 están `deactivated` y 66 `suspended` —cuentas viejas—, pero hay **199 activos sin rating**: quien no acumula viajes suficientes no tiene media publicada. Un `null` aquí no es un cero ni un "mal conductor": es "todavía no se sabe", y quien lo guarde tiene que distinguirlo, igual que con `has_cash_payment`.

De los 247 con nota, **190 son gente con contrato abierto aquí**.

> [!note] No hay endpoint de calificaciones
> Ni en la especificación ni probando a ciegas: `getDriverRatings`, `getFleetDriverRatings`, `getRatings`, `getDriverScore` y `getFleetOrderRatings` devuelven **404**. La nota del cliente solo llega por el padrón, y por conductor —no por viaje—: no se puede saber qué carrera bajó la media.

Nada de esto entra hoy en la [[Calificacion de conductores]], que pondera horas (50 %), utilización (30 %) y excesos de velocidad (20 %) — todo lo que mide es lo que el conductor hace, no lo que el cliente opina.

## Quién llama a BOLT

| Fichero | Para qué |
|---|---|
| `services/ingesta.js` | las cinco tareas periódicas: padrón, vehículos, state logs, órdenes (48 h y 2 h) |
| `services/repo/vehiculosBolt.js` | catálogo de coches; casa por matrícula normalizada y **no pisa lo que ha escrito una persona** (`datos_origen = 'manual'`) |
| `modules/Operaciones/auditoria.service.js` | la [[Auditoria de flota]] forense, con `comprobarCompleto` |
| `services/flotaViva/fuentes.js` | [[Flota viva]]: quién lleva el coche y en qué está |
| `services/conductoresBolt.js` | el padrón |

Nadie más. Una respuesta se interpreta **una vez** y se deja en PostgreSQL; si BOLT se cae, las pantallas siguen leyendo lo último que entró y pueden decir de cuándo es.
