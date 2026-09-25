---
tags: [modulo, fichaje, turno, mapon, whatsapp, bloqueo-motor, registro-jornada]
aliases: [Fichaje, Fichar jornada, Fichaje de turno, Bloqueo de motor]
---

# Fichaje

Bajo el mismo nombre hay **dos cosas distintas**, y conviene no mezclarlas:

| | Fichaje de oficina | Fichaje de turno |
|---|---|---|
| Dónde | `modules/Fichaje/` → `/fichaje` | `services/fichaje.js` + `services/fichajeBot.js` |
| Quién | la gente de oficina, desde el navegador | el conductor, por [[WhatsApp]] |
| Qué registra | entrada y salida de su jornada laboral | quién lleva **qué coche** y desde cuándo |
| Tabla | `fichaje` (`usuario_id`) | el libro de turnos (`db/125`) |

Y hay una tercera con nombre parecido que no tiene nada que ver: **`registro_jornada`** es del conductor en la calle, la escribe el sistema desde los logs de [[BOLT]], y mezclarla con `fichaje` habría sido el error caro.

---

# Parte 1 · Fichar la jornada de oficina

El registro de entrada y salida, pulsado por la propia persona.

```
modules/Fichaje/fichaje.controller.js    la pantalla y la API
modules/Fichaje/fichaje.service.js       LA PUERTA: quién ficha, qué se puede corregir
modules/Fichaje/fichaje.repo.js          el SQL
modules/Fichaje/vistas/fichaje.ejs       /fichaje
```

## Dónde está el botón

**En la barra de arriba, en todas las pantallas.** No en su página: fichar se olvida, y si hay que ir a buscarlo se olvida más. Desde el 23/09/2026 hay además una entrada **«Fichar jornada» en el menú lateral**, que es donde la gente la fue a buscar.

La entrada del menú **no se puede filtrar con `puedeVer`**, porque esa función esconde todo lo que no sea una clave del catálogo y `/fichaje` no lo es a propósito. Nace oculta y la enseña el mismo `GET /fichaje/api/estado` que pinta el botón de la barra; quien lleva el registro (`/fichaje/revisar`) la ve siempre, desde el servidor. Verde mientras la jornada corre, ámbar cuando falta fichar la entrada, y en ámbar de aviso si quedó una jornada de **otro día** sin cerrar — que es el error más común y el que menos se nota.

Quién ve el botón **lo dice el servidor, no la sesión**. La cookie se firmó al entrar y puede ser de antes de que le activaran el fichaje; si esto mirara la cookie, a alguien recién marcado no le saldría hasta volver a entrar y parecería que no funciona. Por eso `GET /fichaje/api/estado` lo pregunta en cada pantalla y por eso el servicio cachea el usuario solo unos segundos.

Quién tiene que fichar se elige **persona a persona** en `/usuarios` (`usuario.ficha_obligatorio`) y nace apagado para todos — ver [[Usuarios y permisos]].

## Qué se guarda, y qué no

**Entrada, salida y dónde estaban al pulsar. Sin pausas**: dos pulsaciones al día se olvidan mucho menos que cuatro, y un registro con pausas a medias es peor que uno sin ellas.

**La ubicación se pide siempre y nunca bloquea el fichaje.** El registro de jornada es obligatorio por ley (RD 8/2019): si el navegador deniega el permiso, el GPS no coge o el móvil está en modo avión, esa persona **no puede quedarse sin fichar**. El fichaje se guarda marcado como `denegada` o `error`, y así el hueco se ve y se puede reclamar, en vez de perder el registro que la ley obliga a tener. El parte del día cuenta cuántos se guardaron sin posición.

> **Es dato personal.** Guardar dónde está un empleado obliga a informarles por escrito de que se recoge, para qué y cuánto se guarda. Eso no lo arregla el código.

Un detalle que sorprende: la geolocalización del navegador **solo funciona sobre HTTPS** (o en localhost). Si algún día se sirviera por HTTP plano, todas las ubicaciones llegarían como `error` sin que nadie tocara nada.

Cada uno ve **su semana** (`GET /fichaje/api/mi-semana?dia=AAAA-MM-DD`), y el id sale de la **sesión**, nunca de la petición: si no, cualquiera pediría la de otro cambiando un número.

## La semana, y los siete días

Se mira **por semana, de lunes a domingo**, no por mes: lo que se pregunta es qué llevas *esta* semana. El campo es el [[Componentes de la casa|calendario de la casa]] (`js-fecha`, dd/mm/aaaa) con dos flechas al lado; se le pasa **cualquier día** y el servidor devuelve su semana.

Y salen **los siete días siempre**, aunque no se fichara ninguno: una semana con tres renglones no deja ver lo que falta, y con siete el hueco se ve solo. Cada día dice lo que le pasa —`Libra`, `sin fichar`, o sus fichajes, que pueden ser dos.

> [!note] Sábado y domingo son «Libra», salvo que se trabajen
> Aquí se libra el fin de semana, así que esos dos días salen como **Libra** por omisión. Pero **manda el fichaje**: quien tiene horas un sábado no libró, su fila se pinta como la de cualquier otro día —en dorado, que son las horas de más— y **suman a la semana**. Arriba se dice aparte cuántas fueron en fin de semana.

Las cuentas de fechas se hacen sobre ISO montado a **mediodía UTC** (`+ 'T12:00:00Z'`): así ni el cambio de hora ni la zona del servidor pueden mover un día. Probado con la semana del cambio de hora, la que cruza de mes y la que cruza de año.

## Los candados, que no son iguales

| | Quién |
|---|---|
| **Fichar** | cualquiera que haya entrado y tenga el fichaje activado en su ficha |
| **Pedir que se corrija lo suyo** | lo mismo: viene con el fichaje, sin llave aparte (desde el 25/09/2026) |
| **Ver el registro de todos** | quien tenga la llave **`/fichaje/revisar`**, y los roles de acceso total |
| **Corregir a mano, confirmar horas y aprobar correcciones** | **solo** quien tenga esa llave **en su matriz**: una sola persona |

> [!important] La llave de aprobar es de UNA persona, y no va con el rol (25/09/2026)
> Camilo: *«solo una persona puede aprobar esas correcciones, a la cual solo yo le daré el permiso»*. Por eso:
> - **La base no deja que la tengan dos** (`uq_permiso_fichaje_revisar`, db/159). Para dársela a otra persona hay que quitársela antes a quien la tenga; si no, `/usuarios` lo dice con su nombre y no guarda nada.
> - **Ni superadmin ni desarrollador aprueban por su rol.** Ven el registro de todos, pero corregir, confirmar y aprobar lo exige el **servicio** mirando la matriz (`permisos.clavesDe`), no la sesión. En su pantalla sale un aviso con quién es el que aprueba.
> - El que aprueba **se aprueba también lo suyo**: lo decidió Camilo, a sabiendas de que se pierde el control cruzado.
>
> Hoy la tiene **Laura**.

`/fichaje` **no está en el catálogo de permisos, a propósito**: lo que no está en el catálogo queda abierto a quien haya entrado. Si fichar necesitara un permiso habría que concedérselo a cada uno, y sería una forma más de que alguien no pueda fichar el día que le toca.

Hasta el 23/09/2026 corregir iba por **rol de desarrollador**. Ahora va por llave, porque quien lleva el registro de la jornada no tiene por qué ser quien toca el código. La llave nace **sin dueño** (`manual` en el catálogo: no la siembra ningún rol y **no entra ni en `TODO()`**, así que gerencia y dirección tampoco la reciben por llevar el catálogo entero) y se da persona a persona desde `/usuarios`. Las horas que aquí se aprueban son las que luego se cobran: quién las firma no se decide por descarte.

De esa misma llave son el **parte del día** (quién fichó y quién no), la lista de **jornadas sin cerrar** y la **cola de aprobación**.

> [!tip] El prefijo ES el permiso
> Las rutas de revisión cuelgan de **`/fichaje/revisar/`** y no de `/fichaje/api/`. Así no hace falta un middleware por ruta: las cierra el control de acceso general por prefijo (`sesion.controlAcceso` → `permisos.claveDeRuta`), y el día que alguien añada un endpoint nuevo ahí dentro **nace cerrado** sin acordarse de nada. Fichar sigue colgando de `/fichaje/api/`, que no casa con ninguna clave del catálogo y por tanto sigue abierto.

> [!bug] La hora que se escribe es de Madrid, y hay que decírselo a la base
> Corregir a las 11:00 guardaba **las 13:00**. La zona de la sesión de PostgreSQL
> es UTC, así que un texto sin zona casteado a `timestamptz` se lee como UTC.
> Ahora se pasa por `::timestamp AT TIME ZONE 'Europe/Madrid'`, y el servicio
> **rechaza** lo que no venga como `AAAA-MM-DDTHH:MM`. Arreglado el 23/09/2026;
> ver [[Trampas conocidas]].

## Por qué corregir no pisa nada

`entrada_original` y `salida_original` guardan lo que se pulsó, y **solo se escriben la primera vez**: una segunda corrección no puede tapar el original. Corregir **exige motivo** —lo comprueba la base con un CHECK, no solo la aplicación— y queda con quién y cuándo. Un registro que se edita sin rastro no vale delante de un inspector, y ese es justo el momento en que hace falta que valga.

## La semana de todos

La pantalla que contesta las dos preguntas que de verdad se hacen —**cuánto lleva cada uno esta semana** y **qué día falta**— sin abrir siete partes diarios y sumarlos a mano. Una fila por persona, una columna por día, el total a la derecha y el de toda la plantilla en el pie. Lleva **su propio** selector de semana, aparte del de «Mis jornadas»: quien revisa suele querer mirar la semana pasada de la gente sin perder de vista la suya.

En **ámbar** lo que aún no ha confirmado nadie —un número que todavía puede cambiar no se lee igual que uno cerrado— y en verde quien está fichando ahora mismo. El fin de semana lleva el fondo más apagado y dice «libra» cuando no hay nada.

Sale **toda la plantilla que ficha**, aunque no fichara ni un día: el `LEFT JOIN` es a propósito, porque el que falta es justo a quien se busca. Y entra también **quien ya no tiene que fichar pero fichó esa semana**, marcado con una chapa: si a alguien se le quita el fichaje un jueves, sus tres días anteriores no pueden desaparecer del registro.

`GET /fichaje/revisar/semana?dia=AAAA-MM-DD` → va con la llave `/fichaje/revisar`, como todo lo que cuelga de ese prefijo.

## Las horas hay que confirmarlas (23/09/2026)

Una jornada **cerrada no cuenta hasta que alguien la da por buena**. Si fichas a las 9 y sales a las 18, son nueve horas *propuestas*: quien lleva el módulo las mira, las corrige si hace falta y las sella.

El estado **no se guarda, se deduce** —así no puede contradecir a las horas—:

| | |
|---|---|
| `salida IS NULL` | **abierta**, sigue trabajando |
| cerrada y `aprobado_at IS NULL` | **por confirmar** |
| `aprobado_at IS NOT NULL` | **aprobada**, y consta por quién |

Dos reglas que viven en la base (`ck_fichaje_aprobado`, db/132) y no en un `if`: no se puede aprobar una jornada **abierta** —todavía no se sabe cuánto duró— ni aprobar **sin decir quién**.

> [!warning] Corregir tumba la aprobación
> El mismo `UPDATE` que cambia las horas pone `aprobado_at` a NULL. Si no, se aprobarían 8 h, se editarían a 12 y el sello seguiría ahí diciendo que alguien las dio por buenas. **Un sello que sobrevive a lo que sella no es un sello.**

### El ajuste único de arranque

El 23/09/2026, con `db/133`, se normalizó de una vez todo lo recogido desde el 13/09: el fichaje llevaba diez días apuntando sin que nadie hubiera confirmado que estaba en marcha. **El día que no llegaba a ocho horas se completó a ocho** —el día, no cada fichaje: hay quien ficha dos veces y subir cada uno a ocho le daba dieciséis— y se estiró el **último** fichaje del día, que es el que se alargaría en la realidad.

Se cerraron además **tres jornadas olvidadas** de días pasados. No era solo un dato feo: con `uq_fichaje_abierto` solo cabe una abierta por persona, así que **esas tres personas no podían fichar** desde que se dejaron la suya sin cerrar.

Lo que **no** se tocó: los días que ya pasaban de ocho horas. Ahí están las barbaridades —73 h, 56 h, 53 h— y son justo las que hay que mirar una a una; nacen pendientes y se corrigen desde la pantalla, con su motivo. Todo lo ajustado quedó marcado como corregido, con la hora original al lado.

## El invariante vive en la base

Una persona no puede tener **dos jornadas abiertas a la vez**. Eso **no** se defiende con un `if`: dos pulsaciones seguidas en un móvil con mala cobertura llegan como dos peticiones y el `if` las deja pasar a las dos. Lo garantiza un índice único parcial, `uq_fichaje_abierto`, que es lo único que no se puede burlar. Ver [[Base de datos]].

## Cada uno pide corregir lo suyo (db/159, 25/09/2026)

Quien ficha puede **pedir** que se corrija su fichaje desde «Mis jornadas»: la hora de entrada, la de salida, o **una jornada entera que no fichó**. Es una **petición, no un cambio**: el fichaje no se toca hasta que lo aprueba quien lleva el registro. Si se rechaza, se queda como estaba y la persona lee en su semana **por qué** (rechazar exige escribirlo). Mientras nadie la resuelve, la puede **retirar**.

| En su semana | Qué sale |
|---|---|
| una jornada | el botón **corregir**; con una petición en marcha, debajo: *«Pediste 08:30 – 17:00 · esperando a Laura»* y **retirar** |
| un día pasado sin fichar | **pedir jornada** (también sábados y domingos: quien trabajó y no fichó tiene que poder pedirlo) |
| una petición rechazada | debajo de la jornada, en rojo, quién la rechazó y su porqué |

**Las reglas, en el servicio:** hace falta motivo; nada en el futuro; ni más de 16 horas seguidas (eso es una hora mal escrita) ni más de **60 días atrás** (lo viejo ya se cobró: se habla con quien lleva el registro); **no se puede pisar con otra jornada suya**; y pedir lo que ya hay no es pedir nada. La hora se escribe como `hh:mm` del día de la jornada: si la salida queda antes que la entrada, es que se salió pasada la medianoche y va al día siguiente.

**Una sola petición abierta por jornada** (y por día, si es una jornada entera): lo garantiza la base con dos índices únicos parciales, por lo mismo que `uq_fichaje_abierto`.

### La jornada que se quedó abierta

Es el caso más común y el que más estorba: con una jornada abierta de ayer **no se puede fichar hoy** (`uq_fichaje_abierto`). Por eso es **la única petición que toca algo al momento**: al pedir la hora de salida de una jornada abierta de un día pasado, se **cierra ya con la hora de la pulsación** —como si hubiera pulsado «Salir», que es justo lo que habría hecho— y la hora buena queda pedida. Así puede volver a fichar sin esperar a nadie. El aviso ámbar del panel de fichar trae el botón **«Poner mi hora de salida»**.

### Qué hace aprobar

Aplica la corrección **con el mismo rastro que una a mano**: lo que había queda en `entrada_original` / `salida_original` (que solo se escriben la primera vez), la firma **quien la pidió** con su motivo (`corregido_por`) y la jornada queda **confirmada por quien aprueba** (`aprobado_por`): acaba de mirar esas horas exactas. Si lo que se pide es una jornada entera, se crea en ese momento. Todo en una transacción con la petición bloqueada: dos pestañas no pueden aplicar la misma corrección dos veces.

> [!warning] Una jornada con la corrección pedida no se confirma
> En «Horas por confirmar» sale marcada **«pide corrección»**, sin botón de confirmar, y la tanda «Confirmar las que se ven» se la salta. El servidor también (`aprobar()` la excluye): sería dar por buenas justo las horas que la persona dice que están mal. Se resuelve la corrección, que ya la deja confirmada.

El panel **«Correcciones pedidas»** enseña cómo está la jornada **ahora** y lo que **pide**, con la hora que cambia en dorado, y avisa si la jornada **cambió después** de pedirla (la corrigió alguien a mano). A quien aprueba le sale en el menú, junto a «Fichar jornada», cuántas le esperan.

Probado contra la base real dentro de una transacción deshecha (46 comprobaciones): `Scripts de análisis/probar-correcciones-fichaje.js`.

```
db/159-fichaje-correcciones.sql     la tabla fichaje_correccion y la llave de una sola persona
modules/Fichaje/fichaje.service.js  las reglas: qué se puede pedir y quién aprueba
modules/Fichaje/fichaje.repo.js     pedir, listar, aprobar/rechazar y retirar, en transacción
```

## Lo que falta

- **Nadie avisa por WhatsApp de una corrección.** Quien aprueba la ve en el menú y en su pantalla; quien la pidió, en su semana. Un aviso a cada uno sería lo natural, y la plantilla de Meta habría que pedirla.
- **Nadie avisa a quien se olvida.** El parte del día dice quién no ha fichado, pero hay que entrar a mirarlo. Un WhatsApp a las 10:00 sería lo natural, y la plantilla de Meta habría que pedirla.
- **Las horas del fichaje no entran en ningún informe**: están en su pantalla y en el parte, y no se cruzan todavía con nóminas ni con nada. Ahora que se aprueban, el paso natural es que **solo las aprobadas** viajen a donde sea que vayan.
- **Nadie avisa a quien tiene horas por confirmar.** La cola se ve entrando a `/fichaje`; si se llena, no se entera nadie.

---

# Parte 2 · Fichaje de turno: iniciar y terminar

`services/fichaje.js` (las reglas) y `services/fichajeBot.js` (la conversación). El conductor pulsa **Iniciar turno**, dice la matrícula, y al acabar pulsa **Terminar turno**.

## Para qué existe

[[BOLT]] solo sabe quién conduce **mientras su app está abierta**. En cuanto el conductor se pone inactivo dejan de existir logs — y justo ahí está el km que persigue la auditoría de flota. Con el fichaje sabemos **quién tenía el coche en cada momento** aunque BOLT esté cerrado, así que la auditoría puede pasar de señalar matrículas a **señalar personas**.

El turno se apunta en un **libro** con conductor, matrícula y horas, y esa es la prueba: la atribución se hace **por ventana temporal**, igual que ya se hace con los timestamps de BOLT, sin depender de cómo trate [[Mapon]] el histórico.

El libro era una pestaña y desde el 15/09/2026 es una tabla (`db/125`). Lo que se gana no es velocidad: es que **un turno abierto por persona y por coche** lo garantizan dos índices únicos. En la hoja no había forma de impedirlo — dos personas abriendo turno sobre el mismo coche escribían dos filas y las dos se creían dueñas, que es justo lo que este libro tiene que poder contestar sin dudas.

## Quién ficha: persona a persona, desde el ERP (24/09/2026)

Hasta el 24/09/2026 el fichaje solo respondía a los teléfonos de una variable de entorno (`FICHAJE_TELEFONOS`), que **ya no se lee**. Ahora se enciende **persona a persona** (`db/148`), para empezar con unos conductores concretos y, cuando sea obligatorio para todos, quitar el interruptor:

| Quién | Dónde se enciende | Qué hace |
|---|---|---|
| **Conductor** | Planificador → botón **Fichaje** (`conductor.ficha_coche`) | **Turnos** |
| **Gente de la empresa** | `/usuarios` → «Puede coger coches por WhatsApp» (`usuario.ficha_coche`) | **Viajes** |

`usuario.ficha_coche` **no es** `usuario.ficha_obligatorio`: el segundo es fichar la jornada de oficina (Parte 1), el primero es coger un coche.

**Cómo se reconoce a quien escribe** (`fichaje.participa`), en el orden que dio Camilo:

1. **Primero, si el número es de un usuario del sistema** activo con el fichaje encendido → hace viajes.
2. **Si no, si es de un conductor de alta**, con **cualquiera** de sus teléfonos vigentes, con el fichaje encendido → hace turnos.
3. **De baja en la empresa no ficha**, aunque tenga el interruptor encendido: un ex-conductor no puede soltar el motor de un coche.
4. Quien tiene un turno **sin cerrar** participa aunque le apaguen el fichaje, pero **solo para cerrarlo**: si no, el coche se quedaría asignado hasta el cierre solo.

La respuesta se guarda **20 segundos** —se pregunta en cada mensaje que llega al bot— y se olvida al momento al encender o apagar a alguien, y al empezar o terminar.

El fichaje **solo se queda sus palabras** (`turno`, `fichar`, `fichaje`, `viaje`, `iniciar/terminar turno/viaje`, `km`) y devuelve el resto al bot de puertas. **No** se queda `turnos` ni `relevo`: esas enseñan la semana de cada uno, y quitárselas dejaría a la gente sin ver sus turnos.

## Quién ficha, con su nombre de verdad

El nombre no es un adorno de la conversación: **es el que se crea y se asigna en Mapon**, así que es el que Tráfico verá sobre el coche en el mapa y el que queda en el histórico de la plataforma. Sale de lo mismo que decide si participa: el nombre de BOLT de su ficha de conductor, o el de su usuario. Además, un turno se ata a su `conductor_id`, que es lo que permite a la auditoría señalar personas.

Si no se sabe su nombre, **el turno no se abre**: fichar sin nombre dejaría un coche asignado a nadie en Mapon, que es peor que no fichar.

## Los dos flujos del WhatsApp

**El conductor (turno).** Escribe `turno` y el bot le propone el coche que le da **hoy** el cuadrante —«Hoy tienes el *8203LTR* (turno de día). ¿Empiezas tu turno en él?»— con un botón **Iniciar 8203LTR** y otro **Otro coche** por si lleva otro. Es un paso menos que escribir la matrícula, y un error menos. «Hoy» es el **día operativo** (05→05): el de noche que escribe a la 01:00 sigue en la jornada de ayer.

**La empresa (viaje).** Es el flujo que pidió Camilo: *«Por favor, indica la matrícula» → empieza el viaje (se suelta el motor) → al terminar se bloquea*. Escribe `viaje` (o `turno`) y el bot le pide la matrícula directamente. La espera de la matrícula **caduca a los 10 minutos**: sin eso, quien la dejaba a medias y escribía «hola» tres horas después recibía «eso no parece una matrícula».

**Desde el panel de puertas.** Tras escribir una matrícula para abrir o cerrar, el tercer botón **empieza el turno o el viaje en ese coche** (`turno_iniciar:MATRÍCULA`), sin volver a pedirla. Con algo abierto, el botón lleva al panel («Mi turno» / «Mi viaje»). Y alguien de la empresa con el fichaje encendido pero **sin** el permiso de puertas ya no recibe «no tienes permiso»: se le lleva a su panel.

## El relevo: «Voy al relevo»

El conductor pulsa **Voy al relevo** **justo antes de arrancar** hacia el sitio donde le da el coche a su compañero. Las palabras están elegidas a propósito: «entregando coche» no decía si era antes o después de dárselo, y lo que importa es el **momento**. El mensaje lo repite: *«Al salir, no al llegar»*. Si lo pulsa sin querer, **Aún no he salido** lo deshace.

- Se apunta la hora (`fichaje_turno.relevo_at`) y, al cerrar, los **km de ese trayecto** (`km_relevo`). Son km de trabajo aunque BOLT esté cerrado, y hasta ahora caían en «sin nadie fichado».
- **Si el compañero ficha y empieza su turno antes** de que él termine, su turno se cierra solo, como **relevado** (estado nuevo), sin bloquear nada: el coche sigue trabajando.
- **Sin haber pulsado el relevo**, el compañero no puede coger el coche: se le dice quién lo tiene y que le pida que pulse *Voy al relevo* o *Terminar turno*.
- Un **viaje** no tiene relevo: no hay compañero. Lo impide también la base (`ck_ft_relevo`).

## Cuándo se bloquea: el compañero que todavía no ficha

El motor se bloquea **por coche**, pero el fichaje se enciende **por persona**, y un coche lo comparten el de día y el de noche. Si al terminar se bloquea y el que lo coge después no ficha, se encuentra el coche cortado y sin forma de arrancarlo. Por eso (`decidirBloqueo`):

| | Se bloquea al terminar… |
|---|---|
| **Turno** de un conductor | solo si **todos** los que llevan ese coche **hoy o mañana** (f_cobertura, con eventos) fichan. Si no, **se queda libre** y el mensaje dice quién no ficha. Y como no se va a bloquear, no se le pide que apague el coche para terminar |
| **Viaje** de la empresa | **siempre**, que es lo que se pidió; si lo lleva alguien que no ficha, se le avisa con su nombre de que Tráfico tendrá que soltárselo |

**El repaso** sigue la misma regla: nunca toca el coche que lleva hoy o mañana alguien que no ficha (`cochesConQuienNoFicha`, una consulta para toda la flota). Si no puede saberlo, esa vuelta no bloquea nada. Y si no se puede saber quién lleva un coche al terminar, un turno **no** se bloquea: la duda no puede dejar a nadie sin coche.

## El panel «Fichaje» del planificador

Botón **Fichaje** en la barra del planificador (quien puede editarlo). Plegado hasta que se pulsa, con tres columnas:

- **Conductores que fichan**, con su casilla, y un buscador para encender a alguien más. Al lado de cada uno, si comparte coche con quien no ficha: *«8203LTR también lo lleva Oswaldo, que no ficha: el motor se quedará libre»*. Es la regla de arriba, contada coche a coche, que es como se entiende.
- **Ahora mismo**: los turnos y viajes abiertos, y quién va de camino al relevo.
- **Motores cortados**, preguntados a Mapon aparte para no hacer lento el panel, con un botón **Soltar**.

Y en el tablero, una **llave** junto al nombre de quien ficha.

**Soltar a mano** exige decir **por qué** y queda escrito con quién, cuándo y qué contestó el coche (`fichaje_orden_motor`): soltar un coche a mano es justo lo que alguien haría para dejar a otro usarlo sin fichar. Encender a alguien y soltar un motor son `POST`, así que los cierra la llave de **editar el planificador** sin tocar nada más.

## El enlace conductor ↔ coche en Mapon

Al abrir turno se **asigna** el conductor a la unidad en Mapon (`driver/update` con `unit`), y al cerrar se le quita, para que en su plataforma se vea el nombre en vivo. Al terminar se comprueba además si Mapon atribuyó los trayectos (`route/list` con `include=driver_id`), para saber de verdad si ese enlace queda **sellado** en el histórico o no.

Cuatro cuidados que tiene esa parte:

- **El enlace no puede impedir fichar.** Si Mapon falla, el turno se abre igual y se anota el error: la prueba de quién llevaba el coche es **nuestro libro**, no Mapon.
- **`driver/update` con `unit` MUEVE al conductor de coche.** Si ya tenía uno puesto —el caso normal si es un conductor real que ya existía en Mapon— se apunta cuál era (`unitPrevia`) y **se le devuelve al terminar**. Un fichaje nunca deja peor la ficha de un conductor real de lo que estaba.
- **Se casa primero por teléfono y después por nombre exacto.** Buscar solo por nombre creaba un conductor nuevo cada vez que alguien tenía un acento de más o el apellido en otro orden, y en Mapon se acumulaban "Camilo Bedoya" y "Camilo Bedoya Corrales" como si fueran dos personas. Y el teléfono se busca en **todos** los campos del conductor, porque Mapon no documenta cómo se llama ese campo. Si no existe, se crea sobre la marcha con el nombre que decidimos nosotros.
- **Si alguien olvida cerrar**, el turno se cierra solo pasadas `FICHAJE_MAX_HORAS` horas (14 por defecto): así no queda un coche asignado indefinidamente en Mapon ni un turno abierto eterno.

La referencia del turno lleva **milésimas y no segundos**, y no es un detalle: terminar un turno y abrir otro dentro del mismo segundo daba dos veces la misma referencia, la base la rechazaba por repetida y el conductor recibía un "ya tienes un turno abierto" cuando acababa de cerrarlo. Un doble toque en el botón bastaba.

## La regla de oro del bloqueo de motor

Los vehículos llevan relé `engine_block` ("Bloqueo Motor"). Al iniciar turno se **libera** el motor; al terminar se **bloquea**, y queda así hasta que alguien vuelva a fichar en ese coche.

> **Nunca se corta con el contacto puesto.** Cortar con el coche encendido no lo apaga: **lo deja a medias**. Se comprobó en el Corolla el 16/09/2026 — arranca, anda… y ya no se puede apagar, porque el corte está metido en la línea que el coche necesita para completar el apagado. El conductor se queda con un coche encendido que no responde.

Esa comprobación **para a todo el mundo, también a quien lo pide**. Antes no frenaba nada por dos motivos a la vez: pedirlo a mano se saltaba la comprobación, y además la ignición se leía siempre como falsa. Los dos están arreglados — `contactoPuesto` en `services/mapon.js` acepta las tres formas en que puede venir el dato y **lo que no entiende lo devuelve como `null`**: *"no lo sé" nunca puede leerse como "no"*.

`puedeInmovilizar` es la función delicada del módulo, y su regla es al revés de lo normal: **ante la duda, NO**.

- **"Velocidad 0" no vale como prueba** de que nadie lo usa: un taxi parado recogiendo a alguien, en un semáforo o esperando en el aeropuerto va a 0 km/h.
- Sin que nadie lo pida (el **repaso**), hace falta: que no esté en marcha, que **no tenga el contacto puesto**, que lleve un buen rato quieto (`FICHAJE_MIN_PARADO`, 20 min) y que los datos sean **frescos** (`FICHAJE_MAX_SIN_SENAL`, 15 min). Si Mapon no dice cuánto lleva parado, eso **no es una autorización**.
- **Por orden** del conductor —pulsó "Terminar turno"— basta con que no esté rodando y sin contacto: acaba de decir que ha terminado, y eso es mejor información que cualquier sensor.

Y las asimetrías, que son deliberadas:

- **Bloquear está apagado por defecto** (`FICHAJE_BLOQUEO_MOTOR`). Inmovilizar un coche es irreversible desde el móvil del conductor, así que no se activa solo por desplegar.
- **El interruptor apaga el bloqueo, no el desbloqueo.** Si apagara los dos, apagar la función dejaría encerrados para siempre a los coches ya cortados, y el interruptor de seguridad sería justo lo que impide arreglarlo.
- **Con el coche en marcha no se corta, pero soltar sí se intenta siempre.** Antes la regla valía para las dos cosas y eso cerró una trampa: el 5646MDM se quedó parado con el corte puesto y, como Mapon lo daba por "Conduciendo" a 0 km/h, no había forma de soltarlo —y sin soltarlo no se podía apagar, y sin apagarlo no dejaba de estar "conduciendo"—. Hubo que mandar la orden a mano. **Soltar no deja tirado a nadie nunca; negarse a soltar, sí.**
- **Si ya está como se quiere, no se manda nada.** No es solo ahorrar una llamada: confirmar el cambio espera hasta diez segundos, y eso son diez segundos de silencio en una conversación de WhatsApp.
- La orden se **confirma** contra el coche: `change_relay` solo dice que la orden salió. Lo que no se confirma se marca `reintentable`, para que el conductor sepa si tiene que hacer algo.

## Terminar con el coche en marcha (o encendido) no se puede

Terminar es lo que corta el motor, así que cerrar el turno rodando dejaría el bloqueo pendiente y el coche se inmovilizaría **donde quiera que pare**: un carril, una salida, la puerta de un cliente. El turno **se queda abierto** y se le pide que aparque primero — un minuto para él, y evita dejar un coche cruzado.

Con el contacto puesto, lo mismo un paso más cerca: el corte entra y el coche ya no se deja apagar. Primero se apaga, luego se termina.

Las dos comprobaciones solo se hacen **si el corte está encendido** —sin él, terminar no inmoviliza nada— y **solo si sabemos** que va en marcha: si Mapon calla o la medida es vieja se le deja cerrar, porque **no saberlo no puede dejar a nadie atrapado**. El mensaje se lo dice con todas las letras: *"tu turno sigue abierto: no has perdido nada"*.

## El repaso

Cada diez minutos, `app.js` llama a `repasarBloqueos()`: deja bloqueado todo coche que nadie esté usando. Existe porque sin él quedan dos agujeros, y los dos dejan un coche libre para siempre sin que nadie se entere — el bloqueo al terminar turno **falla a veces** (el coche estaba rodando, o sin cobertura) y no hay quien lo reintente; y un coche que nunca ha tenido un turno **no se bloquearía jamás**. Es idempotente, y no hace nada mientras el corte esté apagado.

**Hasta dónde llega**: dos límites. **El libro**: el repaso solo toca coches que han pasado por el fichaje, y al fichaje solo llega quien lo tiene encendido. Y **el cuadrante**: nunca el coche que lleva hoy o mañana alguien que todavía no ficha. `FICHAJE_MATRICULAS` queda para el día que esto sea de todos (vacío = solo los conocidos; `*` = toda la flota, y el asterisco se mira **antes** de normalizar, porque normalizado desaparecía).

Va cada diez minutos y no cada uno: un coche que acaba de parar tiene que esperar de todas formas a llevar un buen rato quieto, así que correr no sirve de nada y sí gasta cuota de Mapon.

**Un coche bloqueado que se mueve es un corte que no corta.** Si el relé dice 1 y el coche anda igual, lo que ese relé abre no es el circuito que enciende el motor: es un fallo de instalación y no hay orden por API que lo arregle. El repaso lo **nombra** en los logs — en silencio parecería que la flota está cerrada.

Y existe lo contrario, `liberarConocidos()`: **suelta el motor de todo lo que el fichaje haya podido bloquear**. Existe por lo mismo que existe el freno de mano — porque hay que poder deshacerlo —, sirve para dejar la flota como estaba después de unas pruebas, y no tiene condiciones: liberar no deja tirado a nadie.

## Las variables de entorno

Ninguna lleva credenciales; son los interruptores de seguridad. `FICHAJE_MAX_HORAS`, `FICHAJE_BLOQUEO_MOTOR`, `FICHAJE_MIN_PARADO`, `FICHAJE_MAX_SIN_SENAL`, `FICHAJE_MATRICULAS` y, por si alguna instalación viniera invertida, `FICHAJE_RELE_LIBRE` / `FICHAJE_RELE_BLOQUEADO` (verificado en el coche real: 0 = libre, 1 = bloqueado). `FICHAJE_TELEFONOS` **ya no se lee** desde el 24/09/2026: quién participa se decide en el ERP.

> [!warning] Sin `FICHAJE_BLOQUEO_MOTOR=1` en Render no se bloquea nada
> Se ficha, se apuntan los turnos y los relevos, pero ningún motor se corta. El panel del planificador lo dice arriba a la derecha («Corte de motor apagado en el servidor»).

## La herramienta de diagnóstico

`modules/Operaciones/mapon.diagnostico.js` es la consola para todo esto: qué relé tiene un coche, a quién enlazaría un teléfono, qué devuelve Mapon tal cual, simular o aplicar el repaso, y soltar la flota. **Es solo lectura por omisión** y las opciones que actúan sobre un coche están marcadas una a una. **No está enlazada en ninguna pantalla, a propósito**: se llama por URL cuando hace falta, y quien la escribe sabe lo que hace. Ver [[Mapon]].
