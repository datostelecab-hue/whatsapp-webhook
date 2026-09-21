---
tags: [nucleo, flota-viva, km, bolt, mapon]
fecha: 2026-09-17
estado: en producción
---

# Flota viva

El motor que cada cinco minutos pregunta a [[BOLT]] **quién va en cada coche y en qué estado**, y a [[Mapon]] **dónde está ese coche y cuánto ha rodado**. Vive en `services/flotaViva/` y es de donde salen las horas, los kilómetros y el panel *En directo* de [[Control]].

Lo arranca un cron en `app.js` (`programar('*/5 * * * *')`, zona `Europe/Madrid`) que llama a `pasada()` de `services/flotaViva/motor.js`. Si no hay base de datos configurada, el módulo no arranca y lo dice: sin tablas no puede contestar «cuánto lleva así», que es el módulo entero.

## Lo que se guarda son TRAMOS, no fotos

La decisión de fondo está en la cabecera de `services/flotaViva/esquema.sql`: se guarda **una fila por racha**, no una foto cada cinco minutos.

Con fotos, «¿cuánto lleva este coche desconectado?» obliga a recorrer el historial hacia atrás en cada consulta. Con tramos es leer una fila: ya trae `desde` y los km acumulados. Y los km por situación salen gratis.

### `fv_tramo` — una línea de tiempo POR VEHÍCULO

Esto es lo que más se malinterpreta: **`fv_tramo` no es la jornada de una persona, es la vida de un coche**. La clave es `vehiculo_uuid`; el conductor es una columna que puede estar vacía.

La base lo garantiza con un índice parcial: `uq_fv_tramo_abierto ON fv_tramo (vehiculo_uuid) WHERE hasta IS NULL`. **Un solo tramo abierto por coche**, y lo impide PostgreSQL, no la aplicación.

**El conductor se HEREDA.** Al abrir un tramo nuevo (`aplicar` en `motor.js`) el conductor es `l.conductor || anterior.conductor_uuid`: si BOLT no manda quién es, se arrastra el del tramo anterior. Y cuando llega un apunte del mismo estado que el tramo abierto —un latido, no un cambio— se aprovecha para rellenar el conductor si faltaba.

> El conductor **no abre tramo por sí solo**: BOLT deja de mandar `driver_uuid` al desconectarse, y tratarlo como cambio partía en dos la misma racha.

Consecuencia que hay que tener presente: un tramo desconectado **sí suele llevar conductor** (el último que iba al volante), así que sus km se le imputan aunque ya no estuviera trabajando. Por eso «¿ha salido?» en el cockpit mira **minutos**, nunca kilómetros.

### `fv_ruta` — los trayectos del GPS

Una fila por trayecto de Mapon (`route/list`), con sus metros. Clave `(unit_id, route_id)`, así que **la ingesta es idempotente**: repetir una ventana no duplica, solo refresca los metros y la hora de fin de un trayecto que aún se estaba cerrando.

No se usa el `mileage` de `unit/list`: llega estancado y la resta entre vueltas da 0.

### `fv_odometro` — los tramos del odómetro CAN

La misma forma que `fv_ruta` **a propósito**: un tramo con sus horas y sus metros. No son lecturas sueltas, son los trozos entre lectura y lectura. Esa simetría es lo que permite que el reparto entre conductores y ventanas sea *el mismo prorrateo por solape* y no una segunda matemática que mantener.

El dato viene del bus CAN del coche (`unit_data/can_period.json`), llega cada 90 segundos de mediana mientras el coche anda y es acumulado. Detalle completo en [[Km por odometro CAN]].

La ingesta va **de una unidad en una** —la API no deja pedir la flota de un golpe, a diferencia de `route/list`—, unas 85 llamadas por pasada, con cola de 4. En la mayoría de vueltas solo se pregunta por los coches «activos» (con trayectos en Mapon **o** con alguien conectado en BOLT), y al filo de cada hora se barre la flota entera.

> Los dos caminos para decidir «activo» no sobran: con uno solo se cae justo el coche que más falta hace. El **0454MMZ**, con el GPS medio muerto, apenas tiene trayectos — y es precisamente donde el odómetro salva el dato.

### `fv_posicion` — dónde está cada coche AHORA (21/09/2026)

La excepción a la regla de arriba: **no es un tramo, es una foto**, y se
sobreescribe. Una fila por unidad de Mapon, 88 kB con la flota entera, y no
crece nunca.

Existe para [[Mapa de flota]]. La posición ya llegaba en cada vuelta —
`unit/list.json` la trae junto al estado y el odómetro — y el código la leía y
la tiraba; lo único que faltaba era guardarla.

La clave es `mapon_unit` y **no la matrícula**: hay unidades sin matrícula,
matrículas repetidas en dos equipos (el `3031LTV` tiene dos) y equipos que no
son coches de la flota.

La escribe `services/flotaViva/posiciones.js`, con **vuelta propia cada 30
segundos** —apagada por defecto, `MAPA_CRON=on`— aparte del motor: este corre
cada 5 minutos porque eso es lo que vale para medir horas y km.

> No guarda rastro. Serían 256.000 filas al día, y el recorrido ya lo tiene
> Mapon y los km ya están en `fv_ruta` y `fv_odometro`.

## De dónde salen los km: del cuadro si se puede, del GPS si no

La elección es **por coche y por ventana**, no una configuración. Está en la constante `FUENTE_KM` de `services/flotaViva/rutas.js`.

El criterio: se suman los metros de las dos fuentes dentro de la ventana y se compara. Si el CAN llega al **85 %** de lo que dice el GPS (`FV_UMBRAL_CAN`, 0.85), manda el CAN. Si se queda muy por debajo es que el equipo calló un rato, y entonces se va por GPS y **la pantalla lo dice** («KM POR GPS»).

El 85 % es holgado a propósito: medido sobre la flota el 16/09/2026, la diferencia normal entre las dos fuentes es de un 1 %, así que solo salta cuando de verdad falta serie.

| Medición (16/09/2026) | Resultado |
|---|---|
| GPS frente a odómetro, en el conjunto | **4 % por debajo** |
| Mediana coche a coche | **0,4 %** — donde los dos funcionan, dicen lo mismo |
| 0454MMZ | **45 km de GPS contra 518 reales** |
| Coches cuyo equipo no lee el CAN | **9** — esos van por GPS siempre |

Los filtros al ingerir el odómetro, también en `rutas.js`:

- `VELOCIDAD_IMPOSIBLE = 160` km/h de media. Por encima no es un viaje: es que el equipo cambió de coche o la lectura vino sucia.
- `HOLGURA_CUENTA_KM = 2`. El odómetro cuenta de kilómetro en kilómetro y el salto se apunta cuando cae, no cuando toca: dos lecturas separadas veinte segundos con un kilómetro de diferencia son 180 km/h en el papel y un coche normal en la calle. **Sin esta holgura el filtro se comía km buenos: a Carlos Borelli le quitaba 16 de 292 y a Macilon 30 de 414.**
- `HUECO_MAXIMO_H = 24`. Un hueco de más de un día no se reparte: colgárselo a un tramo sería inventar. Ese coche se queda sin CAN en esa ventana y pasa por GPS.

## El corte del tramo: hasta dónde cuentan sus km

Un tramo «desconectado» puede durar **días**: nadie vuelve a tocar ese coche y la línea se queda abierta. Estirarlo hasta su final le cuelga al último conductor todo lo que el coche hiciera después.

La regla vive en la constante `FIN_KM` de `services/flotaViva/rutas.js`. Un tramo cuenta hasta lo que pase **antes** de estas cuatro cosas:

0. **El final del propio tramo**, cuando lo hay. Un tramo normal dura minutos y manda él.
1. **Otro conductor se conecta a ese coche.** A partir de ahí los km son suyos: es el hecho más fuerte que hay.
2. **Él aparece en otro coche.** Nadie conduce dos a la vez.
3. **Un tope de 12 h** (`TOPE_TRAMO_ABIERTO`). Solo salta cuando no ocurre ninguna de las dos anteriores: el coche se va de la flota —a Barcelona, al taller— y nadie vuelve a conectarse con él en BOLT, así que ningún hecho cierra el tramo. Son 12 h para decir lo mismo que la auditoría de flota, que ya da por caduco un estado con esa edad.

**El corte vale para TODOS los tramos, abiertos y cerrados.** La primera versión solo cortaba los abiertos y el número volvió: el 17/09 el motor cerró el tramo de Macilon Dos Santos con **58 horas** de duración, dejó de ser abierto y sus 219 km reaparecieron en el reporte del día 16. Que un tramo esté cerrado no lo hace creíble; solo dice que alguien volvió a conectarse al fin.

> Medido el **17/09/2026**: 512 tramos cerrados de más de 12 h en treinta días, **11.327 horas** en total, todos desconectados. Miles de km colgados de gente que no iba dentro — y con esos números se llama por teléfono.

El caso que lo destapó: Macilon se desconectó del 7550KYT el 15/09 a las 06:41, se fue a otro coche, y el reporte le apuntó **256 km «fuera de servicio»** que eran 217 de ese coche más sus 38 reales.

Historia completa de los tres fallos en [[Corte de tramos]].

## El reparto: por solape, no por dónde empieza

Los metros de un trayecto se prorratean por el tiempo que pasa **dentro de la ventana y dentro del tramo** (`SOLAPE_KM` en `rutas.js`).

La regla anterior —«cuenta donde EMPIEZA»— funciona con trayectos cortos y es demoledora con uno largo: **Carlos Arturo Borelli hizo un trayecto de 249 km y siete horas que arrancó a las 04:45**, un cuarto de hora antes de que abriera la jornada. Su mañana entera se contó en el día anterior y a él le quedaron 52 km en 8,2 h de trabajo. Y el error iba doble, porque esos 249 km se los llevaba quien condujera a las 04:45. **Eran 330 trayectos y 22.302 km mal colocados en diez días.**

## Los km del tramo NO son la resta del odómetro

Dentro del propio motor hay una segunda cuenta de km (`kmDelTrozo` y `repartirKm` en `motor.js`), la que alimenta `fv_tramo.km_m` y el panel.

Aquí estaba el fallo que **sacó 18,9 km en un coche que llevaba tres minutos parado**: los km eran `odómetro final − odómetro inicial`, y eso da por hecho que el odómetro avanza a la vez que el coche. Un equipo que estuvo sin cobertura se pone al día de golpe y ese salto son kilómetros de horas antes.

Ahora se suma el trocito de cada vuelta, comparándolo con el tiempo pasado **según el reloj del equipo** (`senal_at`), no según el nuestro: si el equipo no ha vuelto a hablar, no hay kilómetros nuevos. El listón es `MAX_MS = 50` m/s (180 km/h), generoso a propósito. Lo que no cabe no se suma y se marca `km_dudoso` en vez de callarlo.

Si en el intervalo hubo varios tramos, el odómetro no dice en cuál se hicieron los km: se reparten por tiempo y **todos quedan marcados como dudosos**. Antes el total entero caía en el último tramo, y quien se ponía en descanso, hacía veinte kilómetros y volvía a espera entre dos vueltas aparecía con los veinte km en «espera».

## Los apuntes se reproducen uno a uno

Los tramos **no se cortan cuando miramos, sino cuando BOLT dice que pasó**. Sus apuntes traen la hora exacta y antes se tiraban, así que cada tramo arrastraba hasta cinco minutos de error y un viaje corto entre dos vueltas no existía.

La marca `fv_vehiculo.ultimo_log_at` dice hasta dónde se ha reproducido; sin ella, cada vuelta volvería a procesar las dos horas de ventana y duplicaría tramos.

**La ventana de BOLT es corta a propósito** (2 h, `FLOTA_VIVA_VENTANA_H`): BOLT no tiene un «dime cómo está todo ahora», tiene un **registro de cambios**. Un coche apagado seis horas no genera un solo apunte, así que pedir una ventana enorme para encontrarlo es tirar cuota. Si no hay apunte nuevo, su situación es la que ya teníamos — y de eso se encarga el tramo abierto.

## Qué coches se vigilan

La verdad de la flota es la tabla `vehiculo` del núcleo: si un coche está de alta, sus horas cuentan. `fv_matricula` se queda como **ajuste, no como fuente**:

- `activa = TRUE` → se vigila aunque no esté en el dominio (un coche que solo existe en BOLT).
- `activa = FALSE` → no se vigila aunque esté de alta (exclusión a propósito).

Antes la lista salía *solo* de `fv_matricula` y había que mantenerla a mano: **en agosto de 2026 se perdieron así 513 h del 3035LTX**, que rodaba con conductores y no aparecía en el panel porque nadie lo había apuntado. Ahora `vigiladas()` da de alta sola lo que falte.

## Vocabulario: conectado ≠ trabajando

`fv_cat_situacion` traduce lo que dice BOLT. Dos columnas que parecen lo mismo y no lo son:

| Situación | `conectado` | `efectivo` |
|---|---|---|
| viaje | sí | **sí** |
| espera | sí | **sí** |
| descanso (`busy`) | sí | no |
| desconectado | no | no |
| otro (sin clasificar) | sí | no |

`conectado` es «tiene la app abierta»; `efectivo` es «esto cuenta como trabajo». Confundirlas costó caro: cuatro consultas de horas filtraban por `conectado` creyendo que significaba trabajar, y **a un conductor con 4h29 de viaje y 1h03 de espera el reporte le ponía 14,4 h y «Muy efectivo» porque le sumaba 8h51 de descanso**.

Un estado de BOLT que no sabemos traducir **no se calla**: se apunta en `fv_estado_bolt` como `otro`, con la palabra exacta, y sale en el panel. Es la única forma de enterarse de que BOLT ha cambiado su vocabulario, que es la avería silenciosa de este tipo de módulos.

## El resto de la vuelta

Después de los tramos, y en este orden:

1. `franjas.revisar()` — las incidencias que obligan a llamar (ver [[Jornada y turnos]]). Va después a propósito: lee `fv_ahora`, y antes miraría la foto anterior.
2. `rutas.ingestarRutas()` — trayectos de las últimas 3 h.
3. `rutas.ingestarOdometro()` — odómetro CAN de las últimas 3 h.

Cada una en su propio `try`: si `route/list` falla o Mapon tose, **la vuelta no se cae**. Y todo queda apuntado en `fv_vuelta` (coches, conectados, cambios, ms, error), que es lo que deja ver si esto sigue vivo o lleva horas fallando.

## Rendimiento, que aquí no es cosmética

Dos cotas que parecen arbitrarias y no lo son:

- **`VENTANA_ATRAS = '14 days'`.** Sin ella, `desde < fin` lo cumple casi toda la tabla y PostgreSQL recorría los ~3.300 tramos de cada coche para quedarse con 3: cuatro segundos de pantalla en blanco en el cockpit. Comprobado contra la consulta sin cota en siete jornadas: mismo resultado fila a fila, entre 2 y 12 veces más rápido. Con 2 días ya aparecían diferencias; con 14, ninguna.
- **`tramo_km AS MATERIALIZED`.** Sin el `MATERIALIZED`, el corte —con sus dos subconsultas— se resolvía una vez por cada pareja (tramo, trozo de km): tres mil por cincuenta mil, y la consulta pasaba de segundos a minuto y medio.

## Ficheros

| Fichero | Qué hay |
|---|---|
| `services/flotaViva/motor.js` | la vuelta de cinco minutos, `aplicar`, `kmDelTrozo`, `repartirKm` |
| `services/flotaViva/rutas.js` | `fv_ruta`, `fv_odometro`, `FUENTE_KM`, `FIN_KM`, `SOLAPE_KM`, `TURNOS` |
| `services/flotaViva/franjas.js` | las franjas críticas y las incidencias |
| `services/flotaViva/fuentes.js` | las llamadas a BOLT y a Mapon |
| `services/flotaViva/esquema.sql` | todas las tablas `fv_*` (no están en `db/`) |
| `services/flotaViva/db.js` | su propio pool; la variable es `FLOTA_VIVA_DB_URL` |

La conexión vive **solo** en esa variable de entorno (con `DATABASE_URL` como respaldo). Puede apuntar a la misma base que todo lo demás: las tablas empiezan por `fv_` y no pisan nada.

Ver también: [[Base de datos]], [[Ingesta]], [[Jornada y turnos]], [[Reglas de la casa]], [[Glosario]].
