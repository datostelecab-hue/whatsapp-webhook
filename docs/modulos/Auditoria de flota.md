---
tags: [modulo, operaciones, auditoria, km]
ruta: /operaciones/auditoria
codigo: modules/Operaciones/auditoria.service.js
---

# Auditoría de flota

Compara los **kilómetros que hizo el coche** con lo que ese coche **facturó en [[BOLT]]**, y reparte cada metro según en qué estado estaba el conductor cuando lo recorrió. La pregunta que contesta es una: **quién rueda km "por fuera"** —sin pedido, o con la app cerrada—.

Vive en `modules/Operaciones/auditoria.service.js` (el cálculo), `auditoria.repo.js` (el SQL) y `auditoria.excel.js` (los descargables). La pantalla es `modules/Operaciones/vistas/auditoriaFlota.ejs`.

## El método, en dos reglas

**La DISTANCIA la pone siempre el coche.** Una sola regla para todos los cubos, así que los cubos suman exacto al total y no hay descuadres entre APIs.

**El ESTADO lo ponen los timestamps de BOLT**, que son medidos, no el GPS, que va demasiado espaciado para medir nada.

## Los cinco cubos

| Cubo | Cuándo | Qué significa |
|---|---|---|
| **pasajero** | entre `pickup` y `dropoff` del pedido | llevaba a alguien |
| **ida** | entre `accepted` y `pickup` (o la cancelación) | iba a recogerlo; incluye los aceptados que se cancelan |
| **espera** | sin pedido y `waiting_orders` | disponible: es trabajo normal |
| **descanso** | sin pedido y `busy` | **no disponible** para BOLT |
| **fuera** | sin pedido y `inactive` | **app cerrada** |

`descanso` + `fuera` es lo que la pantalla llama **KM no disponible**, y es la columna por la que se ordena todo. Rodar marcándose ocupado sale igual de caro que rodar con la app cerrada: hay sesiones de `busy` de horas.

Los cuatro estados de BOLT —`has_order`, `waiting_orders`, `busy`, `inactive`— están verificados sobre datos reales: no hay más.

**Es conservador a propósito.** Si no consta el estado, cuenta como `espera`. Un `has_order` suelto —pedido de otra flota o fuera de ventana— también se trata como trabajo normal. El módulo no acusa cuando no sabe.

## De dónde salen hoy los km: del cuadro si se puede, del GPS si no

Esto es lo que hay que entender antes de leer una cifra. Ver [[Km por odometro CAN]].

- El **odómetro CAN** es el número del cuadro, que el coche cuenta solo. No estima.
- El **GPS** estima: une los puntos por los que pasó el coche y mide esa línea. Corta las curvas y, cuando el equipo pierde cobertura, pierde el trozo entero.

La columna **`fuente_km`** de `auditoria_km` dice con qué vara se midió cada línea: `'can'` o `'gps'`. En pantalla y en el Excel sale como *Odómetro* / *GPS*, y en un rango de varios días puede salir **`mixta`**, que es un equipo que calla unos días y habla otros. Las filas viejas no la llevan y valen `null`: se calcularon antes de que hubiera odómetro.

**La decisión se toma una vez por coche y día, no por tramo.** Si la mañana fuera por odómetro y la noche por GPS, el día completo no sería la suma de sus partes. Y con el **mismo umbral que Control** (`UMBRAL_CAN`, 0,85, en `services/flotaViva/rutas.js`, configurable con `FV_UMBRAL_CAN`), para que dos pantallas no puedan discrepar del mismo día.

El odómetro no se le pide otra vez a la API: sale ya ingerido del núcleo de [[Flota viva]], por `flotaRutas.odometroDeUnidad()`.

**El reparto del odómetro va en rodajas de un minuto** (`atribuirOdometro`). Entre dos lecturas del odómetro pasan **90 segundos de mediana** y un cambio de estado puede caer en medio; sin trocear, un tramo a caballo entre "en viaje" y "desconectado" se iría entero a uno de los dos.

## Un trayecto se reparte por donde pasa, no cuenta entero donde empieza

Cuando manda el GPS (`atribuirRecorrido`), cada tramo entre dos puntos va al estado de su punto de **inicio**, y luego el trayecto entero se escala para que sume **exacto** los metros que dio Mapon.

La regla anterior —el trayecto entero al cubo donde arrancaba— funcionaba con trayectos cortos y era demoledora con uno largo:

> Carlos Arturo Borelli hizo un trayecto de **249 km y siete horas** que arrancó a las **04:45**, un cuarto de hora antes de abrir la jornada, y su mañana entera se contó en el día anterior. En diez días había **330 trayectos y 22.302 km mal colocados**.

La escala se calcula sobre el trayecto entero aunque luego solo se sumen los tramos de dentro de la ventana: es lo que hace que los trozos de dos ventanas sumen justo lo que dio Mapon, sin inventar ni perder.

## Quién llevaba el coche en cada instante

Un coche lo comparten el turno de día y el de noche, y los logs de los dos conductores llegan mezclados. Si se mira solo "el último log", el `inactive` que emite el saliente al cerrar sesión cae encima de los km del entrante y **lo acusa sin motivo**.

Por eso `estadoEn()` mira el último estado de **cada conductor** y gana el que esté más trabajando: `has_order` > `waiting_orders` > `busy` > `inactive`. Si alguien tiene el coche disponible, el coche está disponible.

Y en un empate exacto —dos logs del mismo segundo— gana **el que no acusa**. Sin esa regla el ganador lo decidía el orden de la respuesta de BOLT y el resultado no era ni reproducible.

**`MAX_HUECO_ESTADO` = 12 horas.** Es el tope para no imputarle un estado a un coche que simplemente dejó de reportar (parado días en el taller, por ejemplo). No puede ser corto: los logs son eventos de **cambio** y un descanso real llega a durar horas seguidas sin ningún log intermedio. Con un corte de 1 h se perdían justo las pausas largas, que son las que interesan — en la muestra real había **21 sesiones de `busy` de más de 2 h y una de 7,5 h**.

## Las horas por estado

Además de los km se miden las **horas**: `h_pedido`, `h_espera`, `h_descanso`, `h_fuera`.

Se puede hacer porque los state logs de BOLT son eventos de **cambio**: el **89 % de los pares consecutivos son transiciones**, así que la duración entre dos logs sí es fiable. Eso caza al que se pone en pausa media jornada aunque no haya rodado ni un km.

Se calcula **por conductor y se suma**. En un coche compartido, mezclar las dos líneas temporales trocearía los tramos de uno con los eventos del otro.

## Los cinco tramos

Estos coches suelen llevar dos conductores en 24 h, así que mirar solo el día natural mezcla los dos turnos y diluye lo que hizo cada uno. Se audita en cinco tramos, todos de la **misma** lectura de Mapon (ver [[Jornada y turnos]]):

| Tramo | Ventana |
|---|---|
| `completo` | día natural, 00:00 → 24:00 |
| `dia` | turno de día, 05:00 → 17:00 |
| `noche` | turno de noche, 17:00 → 05:00 del día siguiente |
| `manana` | primera mitad, 00:00 → 12:00 |
| `tarde` | segunda mitad, 12:00 → 24:00 |

> **`completo` NO es la suma de `dia` y `noche`**: el tramo 00:00–05:00 pertenece al turno de noche de la víspera. Por eso se guardan y se consultan por separado.

Las mitades existen porque el relevo no siempre cae a las cinco: no dependen de los turnos y dan un segundo flujo comparable entre coches.

Las horas de corte (`HORA_DIA`, `HORA_NOCHE`) salen de `services/nucleo.js`: eran la segunda copia de la misma constante.

### Cambios de hora

El fin del día se calcula con el **inicio del día siguiente**, no sumando 86.400 segundos: en los cambios de hora el día dura 23 o 25 h y con el salto fijo se contaba una hora dos veces (marzo) o se perdía (octubre). Y el desfase vigente a medianoche es **el de la víspera**, porque el cambio ocurre de madrugada.

## Los repostajes

`leerFuelDia()` pide a Mapon los eventos de combustible del día (con un día de margen a cada lado) y se queda con los del día. Van a `auditoria_repostaje` con hora, litros, nivel antes, coordenadas y dirección, y de ahí sale el ranking de litros por coche.

## Qué coches se auditan

**Los que tuvieron actividad en BOLT ese día.** Mapon tiene coches que no son de esta flota —otras plazas, bajas, reservas sin dar de alta— y auditarlos ensucia los totales. La verdad la manda BOLT: si un coche tuvo un state log o un pedido, se audita; si no, ni se le pregunta a Mapon, lo que además ahorra una llamada por coche.

**Y se enseñan solo los de Madrid** (24/09/2026). Los de Barcelona se siguen calculando y guardando cada noche —no cuesta casi nada y así no queda un hueco si un día se quieren ver—, pero `consultar`, `repostajes` y `porConductor` los dejan fuera con `deLaFlotaVigilada` (`services/nucleo.js`). En los 30 días anteriores eran 516 líneas de 6 coches. Las matrículas que no casan con ningún coche dado de alta se siguen viendo: de esas no se sabe la sede.

## Cuándo se niega a guardar un día

Un día a medias es peor que un día que falta, porque queda congelado como limpio y nadie lo vuelve a mirar. Por eso se aborta el día entero si:

- **BOLT devuelve datos incompletos.** `fetchAllPaginated` devuelve datos parciales **en silencio** si una página falla. Media lectura de logs convierte a un infractor en "espera". `comprobarCompleto()` mira el diagnóstico (`error-http`, `tope-paginas`, `timeout`, o menos registros de los anunciados) y tira el día.
- **Mapon no devuelve unidades.** Guardar 0 filas borraría lo que ya hubiera de ese día.
- **BOLT no devuelve state logs.** Sin ellos todo saldría como "espera": un falso negativo perfecto.

Las tres lecturas de BOLT van **en serie a propósito**: `comprobarCompleto` se apoya en `fetchAllPaginated.ultimoDiagnostico`, que es un global compartido, y en paralelo el diagnóstico de una llamada pisa al de otra. Mapon sí puede ir a la vez porque no toca ese global.

## El histórico

Cuatro tablas en PostgreSQL (ver [[Base de datos]]):

| Tabla | Qué guarda |
|---|---|
| `auditoria_km` | una fila por día, tramo y matrícula: los cinco cubos, las cuatro horas, `km_bolt`, `viajes_bolt` y `fuente_km` |
| `auditoria_km_conductor` | quién vio BOLT en ese coche y tramo, enlazado a la ficha |
| `auditoria_repostaje` | los eventos de combustible |
| `auditoria_dia` | si ese día se calculó, si fue bien, cuántos coches y cuánto tardó |

**Un día se guarda entero o no se guarda.** Recalcularlo borra el suyo y escribe el nuevo en la misma transacción. Con la hoja de cálculo esto era leer el libro entero, filtrar en memoria y reescribirlo, y si fallaba a mitad el día quedaba a medias.

**Por qué `jsonb_to_recordset` y no 720 inserts:** un día son ~144 coches × 5 tramos = **720 filas**. De una en una son 720 idas y vueltas a Frankfurt. Pasando el lote como JSON, PostgreSQL lo convierte en filas y de paso resuelve en el mismo SELECT a qué coche y a qué conductor nuestro corresponde cada línea — justo lo que la hoja no podía hacer.

Un día que falla se anota como fallido **sin borrar lo que hubiera**: si ayer se calculó bien y hoy el reintento se cae, lo de ayer sigue estando. Y por eso la pantalla distingue **pendiente** (nunca se ha calculado) de **fallido** (se intentó y se cayó): el primero hay que programarlo, el segundo reintentarlo.

Si ese día la cuenta de BOLT estaba **prestada**, los km son de quien la usaba: manda `cuenta_fantasma` sobre el titular, igual que en las horas. Sin eso, los km de una cuenta sin dueño no llegaban a nadie.

## El cron y el backfill

La tarea se llama **`auditoria_flota`** y está declarada en `services/ingesta.js` como una más, para que se vea en el panel de ingesta: cuándo corrió, cuánto tardó, si falló y por qué. Antes era un cron mudo y, si dejaba de funcionar, nadie se enteraba hasta que alguien echaba en falta un día en la pantalla.

- La dispara el cron de las **05:00** (Madrid) con `forzar`. El cron solo pone la hora; el trabajo y la contabilidad los lleva la ingesta.
- Si a las 5 falla, el latido lo reintenta solo, con **una hora de espera** entre intentos (`INGESTA_AUDITORIA_REINTENTO_MIN`): para 144 llamadas a Mapon, esa es la diferencia entre reintentar y machacar.
- **Se cura sola:** mira los últimos 7 días cerrados; si ayer ya está, se ocupa del **hueco más viejo**, uno por vuelta. Cada día son unos **20 segundos y 144 llamadas**, y no hay prisa por recuperar la semana de un golpe.

Las consultas **solo leen**: solo hoy y ayer tocan las APIs. Cargar un rango son tres consultas a PostgreSQL que traen solo ese rango; antes se leía el libro entero —los cinco tramos de todos los días habidos— y se descartaba en memoria, así que pedir una semana costaba exactamente lo mismo que pedir un año.

Para rehacer días a mano está `POST /operaciones/auditoria/procesar`, que corre en segundo plano y el panel sondea el progreso. Admite **una lista de días sueltos**, no solo un rango: los pendientes no tienen por qué ser contiguos, y pasando solo los extremos se reprocesaban de balde todos los días buenos de en medio. Tope de **31 días** por tanda. Un día que falle no aborta el resto.

Y tiene **parada de emergencia** (`/auditoria/procesar/detener`, también por GET): un backfill largo consume mucha cuota de Google y puede tumbar el ERP entero, porque el login también lee de Sheets.

## El ranking por conductor

`GET /operaciones/api/auditoria/conductores` va de la **persona** al coche y no al revés. No existía: con el histórico en una hoja, los conductores iban en una celda separados por comas y no había forma de ir de la persona a sus kilómetros.

> **Ojo al leerlo:** son los km **del coche** mientras esa persona estaba conectada con él, no los km que condujo ella. Si dos conductores comparten tramo, los dos cargan con el mismo total, así que **la columna no se puede sumar**. Para afinar, mirar por tramo `dia` o `noche`, que ya separa los turnos.

Los nombres salen de PostgreSQL (`nombresBolt()`), no del padrón en hoja. Aquello fallaba en silencio —el `catch` se lo tragaba— y el informe salía lleno de `#181f6feb` en vez de nombres. Un informe de quién rueda fuera de servicio lleno de identificadores no sirve para nada, así que ahora si esa lectura falla, falla el día entero y se ve.

## Los descargables

**Un Excel por tabla, no un libro de cinco hojas.** Quien pide "la auditoría" casi siempre quiere una de las cinco, y un libro obliga a buscar la suya antes de poder mandarla a nadie. Cada uno lleva **todas** sus columnas, incluidos los conductores que BOLT vio en ese tramo, que en pantalla no caben. La columna *Medido con* va pegada al total a propósito: quien lea el total tiene que ver en el acto si es el odómetro o el GPS, que no valen lo mismo.

`?tabla=` acepta `dia`, `noche`, `manana`, `tarde`, `completo`, `resumen-turnos`, `detalle-dia`, `repostajes` y `ofensores`.

El Sankey del flujo de km va aparte, en PDF vectorial (`services/auditoriaPdf.js`, compartido con Control): `?flujo=turnos` (05–17 / 17–05) o `?flujo=mitades` (00–12 / 12–24).

## Ver también

[[Operaciones]] · [[Km por odometro CAN]] · [[Mapon]] · [[BOLT]] · [[Flota viva]] · [[Jornada y turnos]] · [[Base de datos]] · [[Glosario]]
