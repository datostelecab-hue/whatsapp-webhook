---
tags: [modulo, control, cockpit, trafico, bolt, mapon]
aliases: [En directo, Cockpit de tráfico]
---

# Control · En directo

El cockpit de tráfico: el plan del cuadrante fundido con lo que rueda ahora mismo, para contestar una sola pregunta — **a quién hay que llamar**. Vive en `modules/Control/cockpit.service.js` y se pinta en `modules/Control/vistas/controlDirecto.ejs`; se entra por `/control` (API: `/control/api/directo`).

## Las tres cosas que junta

`cockpit.service.js` lo dice en su cabecera:

- **PLAN** — quién DEBÍA ir hoy en cada coche, día y noche. Sale del Cuadrante (`modules/Planificacion/tablero.service`, PostgreSQL).
- **REALIDAD** — quién está conectado AHORA, en qué (viaje / espera / descanso), cuánto lleva y cuántos km. Sale de [[Flota viva]] (`fv_ahora`).
- **ALERTAS** — lo que hay que llamar: las incidencias abiertas del coche, con sus botones (Justificar / He llamado) y el teléfono.

**No se hace JOIN en SQL entre los dos mundos.** El Cuadrante vive en la base principal y Flota Viva puede vivir en otra (`FLOTA_VIVA_DB_URL`, variable de entorno). Se piden por separado —cada uno a su pool— y se cruzan aquí en JS por matrícula normalizada, que es lo único que comparten. Y cada fuente va con red: si Flota Viva se cae, el plan se ve igual, y al revés. La respuesta lleva `hayCuadrante`, `hayFlotaViva` y `hayActividad` para que la pantalla lo diga en vez de mentir en verde.

## El AHORA sale de la noticia más fresca de BOLT (23/09/2026)

Hay **dos tuberías** que traen lo mismo desde BOLT, y ninguna es de fiar siempre:

| | Quién la escribe | Cada cuánto | Cómo es |
|---|---|---|---|
| `bolt_state_log` (el **apunte crudo**) | la ingesta | 10 min | una tabla tonta: un apunte por cambio de estado. **Aguanta.** |
| `fv_tramo` → `fv_ahora` (el **tramo**) | el motor de Flota viva | 5 min | además km, franjas, odómetro, rutas. **Más listo y más frágil.** |

Los dos traen la **hora del apunte de BOLT**, así que se comparan y **gana el más reciente**. Afecta a los dos sitios que enseñan el ahora:

- **`salidaDe()`** — `conectadoAhora` y `situacionAhora` en `rutas.actividadPorConductor`. Es lo que decide **«NO HA SALIDO»**, o sea a quién se llama por teléfono.
- **La tarjeta del coche** — `panel.service.estado()`, que es el `vivo` de cada fila.

> [!warning] Los MINUTOS siguen saliendo de los tramos, y tienen que seguir
> De un solo apunte no se puede sumar tiempo. Lo que cambia es **en qué está
> ahora**, no cuánto lleva hecho. Y si la situación la pone el apunte y no
> coincide con la del tramo, el contador de «lleva así» se rehace desde la hora
> del apunte: decir *«en descanso desde hace 2 h»* a alguien que lleva una hora
> de viaje es peor que decir un rato de menos.

**En un día pasado no se toca nada**: no hay ningún «ahora» que corregir, y lo
garantiza `ventana_viva` en la propia consulta.

Medido el 23/09/2026 a las 14:40, con el motor ya recuperado: **10 de 88 coches**
se corrigieron. El peor, `0348MMZ` — el tramo decía **desconectado desde las
11:46** y el apunte decía **viaje a las 14:33**. Ese es exactamente el que salía
en rojo pidiendo una llamada. Ver [[Trampas conocidas]] y [[Mapa de flota]].

## La jornada: 05→05, y las cinco horas que nadie veía

El día del cockpit es la jornada operativa, no la fecha del reloj: de madrugada (00:00–05:00) seguimos en la de **ayer**, porque la noche que está rodando empezó la víspera. Es la misma regla del telefonito y de la J (`services/repo/llamadas.diaOperativoHoy()`).

Antes era fecha de calendario, y entre las 00:00 y las 05:00 el cockpit enseñaba el plan del día siguiente: la noche en curso no salía en ninguna pestaña, NN vacío, 0 personas, mientras las llamadas y las J se grababan en la jornada anterior. **Cinco horas cada noche sin ver a quien estaba trabajando.** Ver [[Jornada y turnos]].

## ¿Ha salido? Los cinco estados

`salidaDe()` reparte a cada persona en uno de estos:

| Estado | Qué significa |
|---|---|
| `pendiente` | su turno todavía no ha empezado (la noche, a las 09:00). No es lo mismo que "no ha salido": es que aún no le toca |
| `conectado` | está rodando ahora mismo |
| `descanso` | conectado pero en `busy` de BOLT: está con el coche y la app abierta y NO trabajando |
| `salio` | trabajó dentro de SU ventana, aunque ahora esté parado |
| `no_salio` | la ventana corre y de esta persona no hay ni rastro. A llamar |

**Trabajar es viaje o espera.** Los km rodados estando *desconectado* no cuentan: son el coche moviéndose sin que la persona esté disponible en [[BOLT]], casi siempre porque el relevo ya se lo llevó. Contarlos era lo que ponía "Salió" a quien había terminado su noche a las 03:51 — sus sobras cruzaban el corte de las 05:00 y se le imputaban al turno de día.

El descanso se dice aparte y no se pinta de verde, y sus minutos nunca cuentan como horas efectivas.

## Medir no es reclamar

La ventana de la noche **se mide desde mediodía** (`nocheControl`, 12:00→12:00), porque lo que hace un conductor de noche a las 06:00 es la cola de su turno de ayer y lo que empieza a las 13:00 ya es de hoy. Pero su hora de entrar siguen siendo las 17:00.

Por eso hay dos conceptos distintos: `empezada` (la ventana ya mide) y `reclamable` (ya toca llamar al que no está, `RECLAMA_TRAS`). Sin esa separación, a quien entra a las 17:00 se le llamaba a las 12:30 por no estar: **sesenta y dos falsas alarmas cada tarde**. Antes de su hora solo se dice algo de alguien si YA está rodando, y entonces la respuesta es que sí, ha salido.

## De dónde salen las horas y los km

- **Horas efectivas** — `rutas.actividadPorConductor(dia, ventana)` del núcleo, en minutos de viaje + espera. Una consulta por ventana: `dia` (05→17), `nocheControl` (12→12), `operativo` (05→05, la que sirve para los NN y para TodoTurno) y `noche` de reloj (17→05, solo para repartir a los NN).
- **Km** — del núcleo (`fv_ruta`, Mapon `route/list`), no del `mileage` estancado. Si aún no se ha ingerido, el coche muestra 0. La actividad trae `km` (en BOLT) y `kmFuera` (en descanso o desconectado), y `fuenteKm` dice con qué vara: `can` (odómetro del coche), `gps` (estimación de Mapon uniendo puntos, lo único que hay en los coches cuyo equipo no lee el CAN) o `mixta` cuando llevó más de un coche. Ver [[Mapon]].
- **Teléfono** — del padrón (`plani.contactos()`), no del trazo vivo: justo al que hay que llamar —el que no ha salido— no le queda ni un tramo del que sacarlo.
- **Promedio del mes** y su letra, de `services/repo/rendimiento`: quien llama tiene que saber a quién tiene al otro lado.

## El enlace plan ↔ trazo: por identificador, nunca por nombre

`conductor_externo.externo_id` **es** el uuid del conductor en BOLT, el mismo que guarda `fv_tramo.conductor_uuid`. Cruzar por ahí es exacto y no se rompe porque el nombre de la plantilla y el de BOLT difieran ("Tukieth" vs "Yulieth"). El nombre normalizado se deja solo de red, por si alguna cuenta vieja no trae el id.

Dos trampas reales que resuelve ese mapa:

- **Una persona puede tener varias cuentas de BOLT** (recontrataciones, altas duplicadas). Se guardan todas, la activa primero, y `fundirActividad()` las suma en una. Antes se quedaba con una sola —la última del SELECT— y a **11 personas** les tocaba justo la que no tenía actividad: el cockpit decía "No ha salido" a quien estaba rodando con la otra.
- **Las cuentas prestadas (fantasma).** Si a alguien le suspendieron su cuenta y hoy sale con la de otro, ese trazo es suyo. Sale con SU nombre, pero la fila avisa de que está rodando con la cuenta de otro (`fantasma`): si no, quien lo busque en BOLT no lo encuentra, y quien vea ese nombre en BOLT creerá que es otra persona. Solo cuentan las prestadas **vigentes hoy**.

## Las pestañas, y qué es un NN

Cuatro pestañas: **Día**, **Noche**, **TodoTurno** y **NN**.

- **Día / Noche** — una fila por persona del cuadrante de hoy, medida en la ventana de SU turno. Antes los dos se medían contra el día operativo entero y se pisaban el uno al otro.
- **TodoTurno** — quien hoy cubre el día Y la noche del mismo coche: está doblando. Esta pestaña llevaba siempre 0/0 porque nadie la rellenaba nunca. Se mide contra la jornada entera.
- **NN** — **todo el que ha salido hoy (o rueda ahora) sin estar pintado en las celdas del cuadrante de hoy.** Sin importar qué: de vacaciones, de baja, en el banquillo o ni siquiera en la plataforma. Si BOLT lo vio rodar, aquí sale con su nombre de BOLT y su porqué (`situacion`: *Solo en BOLT · sin ficha*, *De baja en la empresa*, *Ausente*, *En plantilla · sin plaza hoy*).

Dos correcciones que explican qué es exactamente un NN:

- Antes se excluía a **toda la plantilla** (`tab.conductores`), así que el de vacaciones que sí trabajó no salía en ninguna pestaña: invisible. Ahora el filtro son solo las **celdas del cuadrante de hoy**.
- Y solo las de **hoy**, más la noche de ayer (que remata pasadas las 05:00). Antes se recorría la semana entera y quien libraba hoy pero estaba pintado otro día —y salía a hacer un doble— no aparecía en Día, ni en Noche, ni en NN: invisible otra vez.

Los NN se parten en día y noche con el corte del **reloj, 17:00 en punto**, no con el de mediodía: un NN no tiene turno propio, se le imputa el que está en curso. Por eso quien sigue rodando a las 17:00 aparece **dos veces** en la pestaña —una fila con lo que hizo hasta las 16:59 y otra con lo de después—. No es un duplicado: son dos turnos distintos del mismo señor.

## La proyección: ¿va a terminar su jornada?

`proyectar()` es la cuenta que decide si hay que llamar AHORA y no mañana: lo hecho + lo que le queda de turno. Si eso no llega a las 8 h (`CONTROL_JORNADA_H`), ya no llega, siga conectado o no, y es el momento de preguntar qué ha pasado — si estuvo dos horas en el taller, eso se justifica con una J y la culpa es nuestra, no suya.

**El fallo gordo que arregló:** la proyección sumaba BOLT + lo que quedaba de turno y nada más, así que a alguien con tres horas de taller justificadas se le seguía diciendo "no terminará la jornada" y se le volvía a llamar para preguntarle lo que ya había contestado. No era el visto bueno lo que lo frenaba: **la J no entraba en la cuenta ni aprobada**.

Y no todas valen igual. Una **aprobada** es una hora; una **pendiente** es una hora *presunta* —vale para no volver a llamar, pero si la rechazan el agujero vuelve— y por eso van separadas: `soloPresunto` marca al que llega solo contando lo que nadie ha aprobado todavía, y la pantalla lo pinta en azul para que nadie lo dé por bueno antes de tiempo.

## Los avisos de la fila

`avisosDe()` genera el chip y su texto ya escrito; la pantalla solo pinta. Sustituyen a las alertas de Flota Viva, que eran del **coche** (se desconectó la baliza, rueda en descanso); estas son de la **persona** y de su jornada, que es lo que se llama por teléfono.

| Código | Cuándo salta |
|---|---|
| `km_parado` | ha rodado km fuera de la app **dentro de la franja** (ver abajo) |
| `j_rechazada` | alguien miró el caso y dijo que no: esas horas vuelven a faltar, hay que volver a llamar con el motivo delante |
| `j_presunta` | llega, pero solo contando una J pendiente de aprobar |
| `no_llego` / `no_llegara` / `se_fue_pronto` | la proyección no alcanza la jornada, según si el turno ya cerró, no ha salido, sigue conectado o se desconectó antes de tiempo |
| `rechazo_directo` | **al primero**: los rechazó él, con el dedo |
| `sin_respuesta` | dejó pasar ofertas sin contestar dentro de la franja |
| `aceptacion_baja` | ámbar, no rojo: es para mirar, no para llamar |

**Los dos rechazos no son la misma falta** y hasta ahora iban en un chip común ("14 rechazos") que los sumaba. Se separaron porque se miden distinto y se llaman distinto: rechazar a dedo no está permitido nunca —ni antes ni después de ver el viaje—, así que basta uno y cuenta en toda la jornada; no responder aguanta hasta cinco y solo dentro de la franja, porque fuera está el cambio de turno y ahí que se escape alguna oferta es lo normal.

Los avisos son **de quien los provocó, no de la plaza del cuadrante**: la incidencia guarda el `conductor_uuid` del que iba al volante, así que si hoy se han cambiado el coche —pasa a diario— el aviso viaja con la persona y no se queda colgado donde lo veía quien no tuvo nada que ver. Los que no tienen dueño (nadie conectado en ese momento) se quedan a la vista en la fila del coche, y lo que aun así no se puede atribuir se cuenta aparte en `resumen.alertasSinDueno` — la cabecera decía "3 avisos" y no había forma de llegar a ellos.

## La franja de vigilancia, y por qué la columna y el aviso no cuentan lo mismo

La columna **"Km fuera"** cuenta la jornada entera (05→05), y eso incluye el relevo, donde rodar fuera de BOLT es normal: ir a por el coche, la entrega, volver a la base. **Medido el 11/09:** una conductora llevaba 39,3 km fuera en la jornada y **30,6 eran del relevo** — no había nada que preguntarle.

Por eso la **alerta** mira solo desde que abre la franja de vigilancia (08:00 o 20:00), que es cuando rodar con la app apagada o en descanso sí hay que explicarlo. El cambio de número es brutal: con la jornada entera pasaban de 20 km **22 personas**; con la franja, **6**. Y esas 6 son llamadas de verdad.

La franja la da la configuración de [[Control Alertas]] (`alertas.repo.leerConfig()` + `franjaDe()`), así que la pantalla y el WhatsApp reparten los km con la misma regla. Solo hay franja viva en la jornada en curso: mirando un día pasado no hay "ahora" que vigilar.

Los km de la franja y los "sin contestar" van en **todas** las filas de esa persona, no solo en la del turno en curso. Se probó a atarlo a la ventana del turno para no repetirlo y **se perdían cuatro de los seis casos reales**: la gente que rueda fuera de la app a esas horas suele estar donde no toca, y filtrar por turno la escondía. Repetirlo no molesta, porque la llamada se apunta por conductor y contestar una vez apaga todas sus filas a la vez.

## Coches que ruedan sin que nadie esté conectado

Al final de la lista, fuera de las pestañas y a propósito: **esto no es una persona que no ha salido, es un coche rodando sin que nadie esté conectado a él.** La pregunta tampoco es la misma: no es "a quién llamo" sino "quién lo está usando".

Es la pregunta que el sistema nunca se hacía. Un coche solo avanza su línea de estados cuando llega un apunte suyo de BOLT; si nadie se conecta con él no llega ninguno y se queda "desconectado" para siempre — rodando, porque Mapon sí lo ve. Así estuvo el **7550KYT: 56 horas y 585 km**.

Antes esos km se le colgaban al último que lo condujo aunque llevara dos días en otro coche. Ya no, y por eso hay que enseñarlos: unos kilómetros que no son de nadie significan que alguien conduce sin fichar. El corte está en `CONTROL_MIN_KM_SIN_DUENIO` (5 km por defecto).

## Lo que se apunta desde aquí

- **Llamada** (`POST /control/api/llamada`) — se escribe una sola vez, en `llamada_seguimiento`, con el `origen` que dice en qué pasada se etiquetó (`control` o `campana1|2|3`) y con la jornada que está mirando quien llama, para que caiga en la misma carta donde se apuntó. El buzón de resultados y el catálogo por tipo (seguimiento / taller / rrhh / tráfico / alerta) viven en `services/repo/llamadas.js`.
- **Justificar** (`POST /control/api/justificar-directo`) — por `conductor_id` y para la jornada en curso. La carta enseña luego "J · X h · quién", que es lo que le dice al segundo operador que no hace falta volver a llamar.

Un conductor puede tener tres alertas abiertas a la vez y se le llama **una** vez para preguntarle por las tres: por eso la respuesta va **por alerta**, en su propia fila de `llamada_alerta` (`db/98-llamada-por-alerta.sql`). Una sola nota para las tres no servía: al día siguiente nadie sabía qué contestó sobre cuál.

## Lo que cuesta pintar esta pantalla

Medido el **21/09/2026**: **45 consultas**, unos **21 s de SQL sumado** que caben en **3–4 s de reloj** porque van en paralelo. O sea que **el cuello no es el orden: es el trabajo**. Reordenar no la acelera; hacer menos, sí.

Lo que se ganó ese día fue quitar un `COALESCE` de ocho filtros —**32 s de SQL → 21 s**, y la consulta de tramos de **3,7 s a 0,4 s**— sin tocar un solo número. → [[Trampas conocidas]]

> [!info] Medir aquí es difícil, y hay que saberlo
> La base la comparten la aplicación de producción y el cron de cinco minutos, así que **una sola medida no dice nada**: la misma pantalla, seis veces seguidas, dio entre 3,0 y 7,0 s. Para comparar dos versiones hay que alternarlas y mirar medianas, y para comparar dos consultas hay que congelar el reloj.

### Las cuatro ventanas, una sola lectura de los km

El cockpit necesita cuatro ventanas del mismo día —día, la noche que mide desde mediodía, la jornada entera y la noche de reloj— y eran **cuatro consultas idénticas con distintas horas**. Cada una volvía a barrer `fv_odometro` (1,5 millones de filas) y `fv_ruta`, y a resolver el corte de cada tramo otra vez.

**Lo caro no era agrupar cuatro veces —eso son mil filas—, era LEER cuatro veces.** `kmPorVentanas` lee una vez, acotado por la ventana que envuelve a todas, y a partir de ahí cada CTE lleva su `codigo`.

| | antes | ahora |
|---|---|---|
| Consultas de la pantalla | 45 | **42** |
| SQL sumado | 31,7 s | **14,6 s** |
| Las de km | 20,9 s en 4 consultas | **5,9 s en 1** |

> [!warning] La fuente se elige POR VENTANA, no una vez para todas
> Un coche puede tener odómetro suficiente en la jornada entera y no tenerlo en la franja de noche, y ahí la vara de medir cambia. Por eso `fuente` agrupa por `(codigo, unit_id)`. Fundirla en una sola elección habría cambiado números sin que se notara.

Lo demás —los minutos por situación y los efectivos— **sigue yendo por ventana a propósito**: son consultas de décimas sobre `fv_tramo`, así que fundirlas añadiría riesgo sin ganar tiempo.

Y si la pasada única falla, cada turno vuelve a preguntárselo por su cuenta: más lento, pero la pantalla sigue en pie.

> [!note] Que dan lo mismo está comprobado
> Comparadas las dos formas en **cuatro días ya cerrados** —donde `now()` no entra y el resultado es determinista— y en **2.057 filas de persona-turno**: idénticas, campo por campo, incluidos los km, la fuente, las matrículas y la primera y última hora.

> [!warning] El reloj bajó menos que el trabajo
> De 3,9 s a 3,3 s de mediana, con las vueltas entre 2,8 y 7,2 s. Lo que de verdad cambió es que la base hace **la mitad de trabajo**, y eso lo nota todo lo demás que la comparte —la ingesta de cada cinco minutos, las otras pantallas—, no solo esta.

## Ver también

[[Control]] · [[Control Alertas]] · [[Control Reportes]] · [[Flota viva]] · [[BOLT]] · [[Mapon]] · [[Jornada y turnos]] · [[Glosario]]
