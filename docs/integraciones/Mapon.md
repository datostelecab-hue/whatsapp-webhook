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

Lo que se pide con `include`: `can` (odómetro real), `ignition`, `relays`, `fuel`, `device`, `ev_values`. `in_objects` y `saved_values` solo funcionan pidiendo **una única unidad**. El padrón (`mapon.unidades()`) y la vuelta del motor (`fuentes.flotaMapon()`) piden `can` y `relays`: con eso se elige equipo cuando una matrícula tiene dos.

### Lo que da `unit/list` de verdad (08/10/2026, la flota entera)

Mirado con un script de análisis (fuera del repo) sobre las **109 unidades** de la cuenta, pidiendo todos los `include` que admite (`io_din`, `fuel`, `fuel_tank`, `can`, `reefer`, `drivers`, `temperature`, `ambienttemp`, `humidity`, `device`, `depot`, `supply_voltage`, `battery_voltage`, `battery_level_percentage`, `relays`, `weights`, `ignition`, `tachograph`, `altitude`, `technical_details`, `trailer_connections`, `ev_values`; `in_objects` solo con una unidad):

- **`can`** en 94: `odom` (94), `engine_rpm_avg` (92), `fuel_total` (38) y `can_fuel` (9).
- **`fuel` viene en las 109, aunque esté vacío**: `[{ type: 'CAN', value: null }]`. Solo 88 traen litros. Contar el bloque como «tiene combustible» daría la flota entera.
- **`ignition`** es `{ gmt, value: 'on'|'off' }`, y su `gmt` es **la hora a la que se encendió o se apagó**, no la de la lectura. Si el dato es reciente lo dice `last_update`. Leído al revés, dejaba terminar turnos con el coche encendido (ver [[Trampas conocidas#La hora del contacto es la del encendido, no la de la lectura]]).
- **`ev_values`** (los híbridos): `can_ev_battery_rel` es el % de la batería y `ev_charging` si carga (parado desde junio: son híbridos que no se enchufan). Lo del combustible, en [[#Combustible]].
- **`relays`**: cada equipo enseña sus tres salidas, y **el corte cuenta solo con `enabled: 1`**. Hay corte configurado pero desactivado (`engine_block` con `enabled: 0`) en unidades que tienen otro activo; el título varía a mano («Bloqueo motor», «Bloque Motor», «Blqueo Motor»), así que se mira el `type`, nunca el título.
- **`device`** solo trae `id`, `serial_number`, `imei` y `sim`: el modelo está en **`device/list.json`** (`model` + `model_ver`): 97 TELTONIKA FMC130 y 11 FMC880. `device/supported_models.json` da 1006 (sin permiso).
- **No hay cámaras.** Ningún campo de vídeo en `unit/list`, ningún equipo de cámara en `device/list` y ningún método de vídeo en la documentación de la API: lo de cámaras de Mapon vive en su web (directo, eventos, tarjeta de memoria), no en esta API.
- Nada de `tachograph`, `io_din` ni `temperature` en esta flota. Dos unidades tienen la matrícula «-».

El catálogo de órdenes (`unit_commands/get_available`) de **97 unidades** es el mismo: `open_doors`, `close_doors`, `open_trunk`, `hazard_lights`, `open_windows`, `close_windows`. Las otras no tienen ninguna (o dan 1006). Preguntarlo para las 109 tarda unos 4 segundos.

## Una matrícula, un equipo

Hay coches con **dos equipos** dados de alta con la misma matrícula: el viejo, que se quedó en la cuenta al instalar el nuevo, y el bueno. El 28/09/2026 eran tres: **5886LBZ** (se usa 932730, sobra 898080), **5912LBZ** (se usa 893953, sobra 898092) y **3031LTV** (se usa 893946, sobra 885388; ninguno de los dos da CAN ni relé).

Todo el ERP usa **`mapon.elegirEquipo()`**: gana el que da CAN, luego el del relé de corte, luego el que tiene GPS; a igualdad se queda el que ya se usaba y, si no, el de `unit_id` más alto. Lo aplican `unidadPorMatricula` (fichaje, puertas del fichaje, diagnóstico), `flotaMapon` + el motor (`fv_vehiculo.mapon_unit`, del que cuelgan los km, el odómetro CAN y el mapa) y el enlace de Vehículos (`vehiculo_alias`). Por qué hacía falta, en [[Trampas conocidas]].

> [!note] Las puertas del bot van por el Apps Script
> El bot abre y cierra por matrícula a través de un despliegue de Apps Script que no está en el repo: qué equipo coge ahí no lo decide esta regla. Con la unidad vieja dada de baja en Mapon, deja de haber duda.

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

Hubo también una lectura de la flota entera por día (`leerKmPorDia`, para la auditoría): troceaba el rango en ventanas de **5 días pedidas en serie** y deduplicaba por `route_id` los trayectos del corte. Ya no la pedía nadie y se quitó el 01/10/2026, igual que `leerExcesosGraves` (los excesos llegan por la ingesta, ver [[Sanciones de velocidad]]). Si vuelve a hacer falta, está en el historial de git.

## Alertas — `alert/list.json`

**Mapon no tiene webhook.** Sus canales son email, SMS y pop-up en su plataforma, así que la única forma de traerse los eventos es preguntando. Devuelve lo ya disparado por los *setups* configurados en la cuenta (se listan con `listarSetups()`, `alert/list_setups.json`).

Tipos que la cuenta tiene activos: `speeding`, `in_object`, `not_in_obj`, `no_power`, `supply_voltage`, `battery_level`, `moving`. El más frecuente resultó ser `not_in_obj` —**102 de 193 alertas en una semana**— y no estaba en la tabla de traducción: salía en pantalla con su código crudo.

Trampas de esta llamada:

- **`alert_val` cambia de forma según el tipo.** En `speeding` y `no_power` es un JSON metido dentro de un string; en `in_object` es `'Zona|IN'`. `parseValor()` devuelve siempre un objeto para que quien lo use no tenga que saber de dónde venía.
- **Los eventos no traen id propio.** La clave única es `unit_id | hora | tipo`, y es lo que evita repetir avisos cuando el cron consulta con solape. (`include=id` existe y daría un id de alerta de verdad: mejor dedupe, aún sin usar.)
- **Paginación de 150 por página con tope de 10 páginas.** La respuesta trae `truncado: true` cuando había más: una lista truncada no puede darse por completa.

El umbral de gravedad (`MAPON_UMBRAL_VELOCIDAD`, 150 por defecto) es **nuestro**, no de Mapon: el setup de la cuenta avisa a 130, así que todo lo que pasa de 150 ya viene incluido y cambiar el umbral no obliga a tocar la configuración de Mapon.

## Combustible

Medido el **21/10/2026** sobre las 106 unidades de la cuenta, con un script de análisis de solo lectura (fuera del repo). Camilo pidió saber qué datos de combustible hay y de dónde salen. Hay tres, y **solo uno sirve para sacar números**. En ningún coche hay sonda ni varilla: todo sale del bus CAN.

### El gastado de la centralita: `can.fuel_total` (el bueno)

Son los litros que la centralita lleva gastados desde siempre (con un decimal). Funciona como el odómetro: es acumulado, así que dos lecturas se restan y ya está. **Solo sube al quemar gasolina: al repostar no se mueve** (ver [[#Repostajes: se ven en el nivel, no en el gastado]]). La foto viene en `unit/list` (`include[]=can`) y la serie en `unit_data/can_period.json` con **`include[]=total_fuel`** (junto a `total_distance` salen los km del mismo tramo).

- **Solo lo dan 38 Toyota Corolla.** Ningún Ioniq ni Ford lo trae.
- **Llega cada pocas horas**: de 30 a 126 lecturas por semana, contra una cada 90 segundos del odómetro. Vale para semana, mes o día. Para un turno sale aproximado, porque el borde puede caer horas antes o después.
- **Contrastado del 14 al 21/10/2026**: 33 de los 38 dan serie, y suman **5.478 L en 114.811 km, 4,77 L/100 km**. Coche a coche va de 4,22 (0730MMZ) a 5,71 (1212MJY), creíble para un Corolla híbrido haciendo VTC. No dan serie el 0715MMZ, el 0756MMZ, el 0870MMZ, el 1073MJY y el 1223MJY.

### El nivel del depósito: `fuel` de `unit/list`

`[{ type: 'CAN', no: 1, metrics: 'L', value, last_update }]` son los litros que marca el aforador, leídos por el CAN, en litros enteros. La serie está en **`fuel/data.json`** (`unit_id` sin corchetes, `from`, `till`): `data.can.values = [{ gmt, value }]`.

- Trae valor en 88 unidades: 57 de 64 Toyota, 22 de 24 Ioniq, los 9 Ford y ninguna de las 9 sin modelo. 16 tienen la lectura de hace más de un día.
- **En vivo solo con el coche encendido.** Lee cada **28 segundos** de mediana mientras anda, y en `unit/list` la lectura va una mediana de **1,6 minutos** por detrás (47 coches en marcha el 21/10/2026). Apagado, el CAN se duerme y se queda la última: en los 41 parados la lectura tenía una mediana de 7 horas.
- Baila poco: en dos minutos, 1 L como mucho (p95). Toyota, unas 6.100 lecturas por semana; Ioniq, unas 450, que también bastan.
- **Techo del aforador**: 31 Toyota no marcan nunca más de **40 L**, 19 llegan a 45 y los Ioniq a 43–44. Lo que se eche por encima del techo no se ve.
- **Solo litros enteros, en todas partes.** Ni `unit/list`, ni `fuel/data.json`, ni `unit_data/can_point.json` dan décimas ni porcentaje: en `can_point`, `fuel_level` sale vacío (`value: null`). Es la boya del depósito, la misma que mueve la aguja del cuadro, no un contador de caudal como el del surtidor.
- **Los Ford Mondeo van en PORCENTAJE y su serie está en otro sitio** (comprobado el 21/10/2026). En `fuel/data.json` les llega a ceros, pero `unit_data/can_period.json` con **`include[]=fuel_level`** trae la serie buena: una lectura cada 3 minutos, de 0 a 99 (tras repostar marca 94–97). En la foto (`fuel` y `can.can_fuel`, el mismo número) Mapon pone «L», pero es el % del depósito. Los repostajes se ven igual: 15, 13 y 16 en 14 días en el 2350LHP, el 5886LBZ y el 5912LBZ. Para pasarlo a litros hace falta la capacidad del depósito, de la ficha técnica o sacada de un par de tickets (litros ÷ % subido). No dan gasto de la centralita. Los Ford Tourneo (en «Reserva») llevan semanas sin datos.
- `fuel_tank` (la capacidad del depósito) solo está puesta en **una unidad**, el 3035LTX (43 L).

### Lo que Mapon calcula del nivel: `fuel/changes.json` y `fuel/summary.json` (hoy no vale)

`fuel/changes.json` da subidas (repostajes) y caídas bruscas (posible robo), con lugar y nivel previo. `fuel/summary.json` da por unidad el nivel de inicio y de fin, lo repostado, lo drenado y lo consumido. Cada dato viene por fuente, `sensor` (varilla) y `can`. Aquí `sensor` sale vacío en todas, así que se usa `can`. Ventana de 31 días.

> [!warning] En Madrid no detecta ni un repostaje
> En la semana medida, la flota gastó unos 5.500 L según la centralita y Mapon **no vio ni un repostaje en Madrid**. Solo tiene eventos el **3035LTX** (Barcelona), que es justo la única unidad con la capacidad del depósito puesta. Todo apunta a que sin `fuel_tank` no detecta nada, pero no está confirmado con Mapon.
>
> Ni ahí es fiable: de 24 eventos, los de verdad son 5, de +24 a +32 L, todos en la gasolinera de Carrer de la Ciutat d'Asunción (08030). El resto son subidas de +5 o +6 L en mitad de la calle cada pocas horas, el aforador bailando.

Sin repostajes, `total_consumed` (nivel de inicio − nivel de fin + repostado) no dice nada: **43 coches salen con consumo negativo**. Los 33 Toyota de arriba suman −59 L según el nivel, contra 5.478 L reales. Caso del **0348MMZ**: 15 L según el nivel y 140,5 L según la centralita.

Otros campos que parecen de combustible y no lo son:

- **`avg_fuel_consumption`** es `{ norm, measurement: 'l/100km' }`: una norma puesta a mano (0 en casi todas, 4,3 en algunas), no una medida.
- **`fuel_type`** (P, D o vacío) también es de la ficha de Mapon, puesta a mano.
- Los eventos traen `driver_id: 0`: Mapon no sabe quién conducía. El conductor sale del libro de turnos, como en `route/list`.

### Repostajes: se ven en el nivel, no en el gastado

Camilo, 21/10/2026: *«si alguien reposta, ¿el fuel_total sube y así podemos decir "Repostó"?»*. No: el gastado solo cuenta lo quemado. Lo que delata un repostaje es **el nivel, que sube de golpe**. Medido sobre la semana del 14 al 21/10/2026, solo lectura (scripts fuera del repo, en «Scripts de análisis», carpeta `mapon-combustible`):

- **El gastado no reacciona.** En 31 Toyota, 1.472 pasos, ninguno hacia abajo, y nunca más de 4,7 L/h, que es lo que quema un coche en autovía. En 50 repostajes con lecturas del gastado a menos de una hora a cada lado, se movió una mediana de **0,5 L** (máx. 3,6) mientras el nivel subía de 10 a 28 L.
- **El nivel salta en segundos**: 11 → 39 L en una lectura (0454MMZ, 15/10 04:40), 26 → 39 L en 17 segundos (1210MJY). Detector usado: mediana de las 5 lecturas siguientes − mediana de las 5 anteriores **≥ 10 L**, y como mucho uno cada 45 minutos.
- **509 repostajes en 68 coches** (51 Toyota y 17 Ioniq), unos 7 por coche y semana, con una subida mediana de **17 L**: repostan a medias, no llenan.
- **Caen en gasolineras.** Con la última posición GPS antes del salto (`unit_data/history_point.json` con `include[]=position`; `datetime` en UTC), el **73 %** cae en sitios con 3 repostajes o más. Los tres primeros: Vicálvaro, junto a Calle del Parque Biológico 7 (61 repostajes, 21 coches; sin confirmar qué gasolinera es), Calle Valgrande, Alcobendas (42 repostajes, 16 coches; hay una Petroprix en el n.º 11 y una Ballenoil en el 30) y Calle Secoya 12, 28054 (35 repostajes, 20 coches; Petroprix).
- **El litro de cada repostaje sale corto.** Por el techo del aforador, en 18 Toyota la semana cuadra en **2.971 L repostados** (nivel final − nivel inicial + gastado) contra **2.364 L** sumando las subidas: un **20 % menos**. Cuántas veces, cuándo y dónde, sí. Los litros de la semana, por el cuadre, solo en los Toyota con gastado.
- **Cuánto se equivoca el aforador** (21/10/2026, script `7-calibrar-aforador.js`). En los 24 Toyota que dan aforador y gastado, se comparó lo que baja el aforador con lo que gasta la centralita, en tramos sin repostajes. De media acierta: 1.302 L contra 1.304 L. Pero por zonas no: en la parte alta del depósito (30 L o más) marca un **9 % menos**, en medio un **3 % más**, y coche a coche va de un 33 % menos (0802MJY) a un 13 % más (1085MJY). Todos esos tienen el techo en 40 L. **Los de techo 45 no dan gastado**, así que no se pueden calibrar contra la centralita.
- **El primer ensayo contra un ticket**: el 9001LWJ (techo 45) repostó **26,5 L** según la gasolinera, el 21/10/2026 a la hora que dio Mapon. El aforador subió de 15 a 45 L: **30 L, un 13 % de más**. La hora y el sitio se clavaron. Los litros de un repostaje suelto, sin calibrar el coche, van a ±10–15 %. Para afinarlos hace falta el litro real de varios repostajes por coche (tickets o tarjeta).
- Por debajo de 10 L hay de todo: 81 subidas de 7 a 10 L (pueden ser rellenos hasta arriba) y cientos de 3 a 5 L, que son el baile. El umbral de 10 L deja fuera algún relleno pequeño.
- Mapon no vio **ninguno** de estos repostajes en `fuel/changes.json` (ver arriba).

**En el ERP** lo usan dos:

- La auditoría de flota: `mapon.leerCombustible` (changes + summary) desde `modules/Operaciones/auditoria.service.js`, una pantalla que casi no se usa (ver [[Auditoria de flota]]). Con lo de arriba, sus repostajes de Madrid salen vacíos.
- **La auditoría de cada repostaje de [[Combustible]]** (23/10/2026, db/213), con lo aprendido aquí y en el ensayo del 9001LWJ: el aforador (`nivelDeposito`, `fuel/data.json`), el % de los Ford (`nivelPorcentaje`, `can_period` con `fuel_level`), el gastado y los km para corregir el techo (`gastadoYKm`, `can_period` con `total_fuel` y `total_distance`), las paradas (`paradasUnidad`, `route/list`), la posición en un instante (`posicionEn`, `history_point` con `include[]=position`) y la capacidad del depósito (`capacidadDeposito`, `fuel_tank`). Todo GET, de una unidad y en ventanas de horas. Dos cosas que salieron ahí: **`route/list` parte una parada a medianoche** (y a veces con un «trayecto» de segundos y 0 km), y **`can_period` no trae lecturas con el coche aparcado**, así que una serie pedida desde el instante que se quiere interpolar puede empezar después. → [[Trampas conocidas]]

  Y con Petroprix por Excel (db/215): **la hora del Excel es la del final del repostaje** y a veces llega con el coche ya andando (hasta 192 s después de arrancar), así que para esas filas vale la parada que acabó hasta 5 minutos antes; y las lecturas de un coche se piden una vez por tramo de 4 días (`combustible.memoria`). Una cosa de la boya que aún no se resuelve: la aguja de un Ioniq que sigue subiendo más allá de los 5 minutos tras arrancar. Y una que sí (revisión del 23/10/2026): **`route/list` da como parada el rato en que el GPS no se mueve o el equipo no manda nada**, en el último sitio visto: el 9521MMX, con el GPS roto, salía «parado» 24 h con el aforador bajando dentro de 31 a 17 L; el 0454MMZ, «parado» 5,8 h y al arrancar con 13 L más. Una parada de más de una hora en la que el aforador se mueve, o lejos de la gasolinera y tras la cual el depósito subió 5 L, no se toma por parada.

  Y dos más de la revisión del 23/10/2026: **el reloj de Mapon y el del correo de Ballenoil no son el mismo** (el 7909LRJ arrancó un minuto antes de la hora del correo y a esa hora seguía a 14 m del surtidor), así que una parada que no cubre la hora se toma solo si a esa hora el coche seguía junto a ella; y **una parada de al lado no dice dónde estaba**: el 8997LDK acabó una parada a las 00:00:10 y a las 00:04:59 ya iba a 1.676 m. `history_point` en ese instante es lo que vale. El techo del aforador se toma como el valor más alto que se repite, no el máximo: una lectura rota del CAN (255, 65535) lo fijaría.

## Relés: el corte de motor

**Funciona desde el 16/09/2026**, cuando Mapon concedió el permiso. `unit/change_relay.json` por POST con `unit_id`, `relay_id` y `relay_state`. Los coches llevan `relay_id: 1`, `type: engine_block`, título "Bloqueo Motor". Semántica comprobada en coche real: **0 = motor libre, 1 = motor bloqueado**.

Probado en el **7222LVG (unit 893958, Toyota Corolla)**: se manda el 1, se relee y en **dos segundos** el coche lo confirma. Con el corte puesto **no arranca**: el bloqueo es real, no un estado en el servidor.

> [!danger] NUNCA cortar con el contacto puesto
> Si el relé entra con el coche encendido, el Corolla arranca y anda **pero ya no se deja apagar**: el corte está metido en la línea que el coche necesita para completar el apagado, y el conductor se queda con un coche encendido que no responde al botón. Es peor que no bloquearlo. Por eso el fichaje no deja terminar turno con el contacto puesto (`puedeInmovilizar`, en `services/fichaje.js`).

Otras cosas que hay que saber:

- **`status: ok` solo confirma que la orden salió.** Para saber si el relé cambió hay que releer `unit/list.json` con `include[]=relays`: eso hace `cambiarReleConfirmado()`, que reintenta hasta 5 veces cada 2 s. `ok:false` con `confirmado:false` significa que la orden salió y el equipo no la aplicó (sin cobertura, por ejemplo).
- **Solo se acciona `engine_block`.** Antes, si el coche no tenía ese tipo, se devolvía el primer relé que hubiera — o sea, accionar a ciegas un relé desconocido de un coche real. Un coche sin corte de motor tiene que decir que no tiene corte de motor.
- **Tres relés no son tres cortes.** Cada equipo enseña sus **tres salidas** aunque no haya nada conectado. El 5775KKL (28/09/2026) sale con las tres en `type: basic`, deshabilitadas y sin título: no tiene corte configurado. Un coche con corte tiene la salida 1 como `engine_block`, habilitada y titulada «Bloqueo Motor» (el 7222LVG). Eso se arregla en Mapon o con el instalador, no en el código: **la API no tiene ningún método para configurar un relé** (mirado en la documentación el 28/09/2026: `change_relay` solo cambia el estado, y `unit/edit` no toca relés). Comparado con el 0261MFX (unit 893940, mismo modelo y misma tanda de equipos), al 5775KKL (893945) le falta justo esa configuración de la salida 1.
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
> - **Con la cuenta suspendida, Mapon contesta a TODO con un error** (`{"error":{"msg":"Company suspended"}}`, 05/10/2026, por un pago pendiente). `fetchMapon` lo detecta en cada respuesta y `disponible()` lo dice: el bot ficha solo en la base y no toca puertas ni motores. Ver [[Fichaje]], «Con Mapon caído». Un error así **no es un padrón vacío**: `unidades()` ya no lo guarda en caché como si no hubiera coches.
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
| La auditoría de [[Combustible]] (fuera de la ingesta, con su motivo) | 10 min, detrás del buzón | hasta 60 repostajes por pasada, **de una en una con 150 ms entre preguntas**; los de un coche en 4 días con UNA lectura del aforador (`fuel/data`) y una de paradas (`route/list`), y aparte la posición o los km cuando hacen falta. Un Excel de Petroprix de tres semanas (1.866), en unas 5 horas. Ver [[Combustible#El ritmo de la auditoría]] |

Cada tarea declara además `reintentoMin`: sin eso, una tarea que falla se reintenta en cada latido de 5 minutos, y para la auditoría —144 llamadas por vuelta— sería gastarse la cuota del día en una hora repitiendo el mismo error.

## A futuro: `data_forward`

`data_forward/save.json` hace que Mapon **empuje** datos a un endpoint nuestro por packs (posición, ignición, entrada/salida de zona, comportamiento, odómetro, altas/bajas). Sustituiría el polling de posición y zonas; las alertas seguirían por polling porque no entran en data forwarding. La cola por endpoint tiene TTL de **12 h** y máximo **100.000** elementos: si el webhook cae más que eso se pierden packs, así que habría que diseñarlo con reconciliación por polling de respaldo.
