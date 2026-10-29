---
tags: [modulo, rrhh, vacaciones]
actualizado: 2026-10-14
---

# Vacaciones

`/vacaciones` (`modules/Vacaciones/`): el **saldo de vacaciones** de cada persona con contrato abierto, debajo de su nombre, y en su ficha de dónde sale cada número. Solo se mira. Poner, corregir o borrar unas vacaciones sigue siendo de [[Conductores|Plantilla]], con la llave de aprobar, que tiene una sola persona: Laura Blanco ([[Ticketera#Las vacaciones las aprueba una sola persona (09/10/2026)]]).

Se construye sobre el histórico de vacaciones cargado de los Excel de RRHH ([[RRHH#Las vacaciones de los Excel de RRHH, cargadas (14/10/2026, db/195)]]).

## La cuenta (Camilo, 14/10/2026)

| | Qué | Cómo |
|---|---|---|
| **+** | Generadas | **0,0821 días por cada día natural** desde el alta que dice el sistema (la del contrato abierto). Cuentan la libranza, la **baja médica**, las vacaciones y los permisos. **No** cuentan los días de **suspensión** (de empleo y sueldo, o por retirada del permiso de conducir). |
| **+** | Festivos trabajados | **1 día entero** por cada festivo nacional o de la Comunidad de Madrid en el que trabajó **más de 6 horas** (6 justas no). |
| **−** | Vacaciones disfrutadas | Los días de vacaciones que ya pasaron. |

**Los asuntos propios ya no restan de aquí** (desde el 29/10/2026): tienen su banco aparte, abajo. Ningún permiso toca el saldo de vacaciones.

- **Quien entró antes de 2026 empieza el 01/01/2026** (desde el 19/10/2026; hasta entonces, el 01/01/2025): lo anterior no cuenta para nada. Quien entró después, desde su alta. Las vacaciones de un contrato anterior no cuentan. Ver [[#Todo empieza el 01/01/2026 (19/10/2026)]].
- **Lo programado** (vacaciones de mañana en adelante, ya puestas en la ficha) no toca el saldo de hoy. Se enseña aparte, con lo que quedará después.
- El saldo puede ser **negativo**: ha disfrutado más de lo generado.

Las decisiones de Camilo, el 14/10/2026: los permisos se descuentan del saldo, y luego, *«Solo restan los de asuntos propios»*; para los antiguos, desde el 01/01/2025; las suspensiones no generan; y el festivo suma solo si se trabajó más de 6 h.

## Asuntos propios: un banco aparte (29/10/2026, db/225)

Camilo: *«siempre, por conductor, debe de sumarse dos días al año de asuntos propios; si no lo ha usado, en vacaciones debe de quedarse el banco de asuntos propios aparte. En la suma que haces me sale que resta a las vacaciones: que no reste, él se restará solo»* y *«habrá una nueva situación en la plantilla, aparte de suspendido, vacaciones, etc.: asuntos propios, que resta él mismo en el módulo de vacaciones, pero ambos serán separados»*.

| | Qué | Cómo |
|---|---|---|
| **+** | Sumados | **2 días por cada año natural** desde el que se le calcula (2026, o el año de su alta). Enteros, **sin prorratear**: quien entra en octubre tiene sus 2. **Lo que no coge se queda en el banco**: en 2027 suma otros 2 encima. |
| **−** | Cogidos | Cada día en la situación **«Asuntos propios»** resta uno entero. Un permiso de los de antes con el tipo de asuntos propios cuenta igual. |

- **No toca el saldo de vacaciones**, ni lo programado. Los días de asuntos propios **sí generan** vacaciones, como un permiso.
- **Es una situación de la plantilla**, al lado de «Permiso retribuido» (`cat_estado_conductor.asuntos_propios`, db/225): ausencia de un día con vuelta, no libera la plaza, en la bitácora es una «P», en el planificador sale «con PERMISO», y **en la nómina cuenta como un día de permiso retribuido** (las 8 h de siempre, `nominas.repo.ausenciasDelPeriodo`). Lleva el tipo del convenio `PR_ASUNTOS_PROPIOS` sin preguntarlo. No necesita la llave de vacaciones.
- **«Asuntos propios» ya no es un tipo de permiso**: no sale en «¿Qué permiso es?» de Plantilla ni de la Ticketera, y el servidor lo rechaza en un permiso con el aviso de que se elija la situación. En la Ticketera, «Aplicar» ofrece «Asuntos propios» en la lista de ausencias.
- **El de Víctor Rafael Requena Obispo** (01/09/2026, el único del año según Camilo) pasa con db/225 de permiso a la situación nueva: con los datos del 27/10 le quedaban 19,79 días de vacaciones (antes 18,79) y le queda **1 día de asuntos propios** (2 − 1).
- **En la pantalla**: debajo de cada nombre, al lado del saldo, «Asuntos propios N días»; una columna con «lo que queda de lo sumado»; un KPI con los días por coger entre todos; y en la ficha un **extracto aparte** (sumados, cogidos, le quedan, lo programado). En el Excel, sumados, cogidos y programados.
- Lo cuenta la misma función pura (`saldoDe` → `asuntosPropios`); el comprobador lo prueba (2 al año, sin prorratear, acumulado en 2027, en negativo, el permiso viejo).

### El tipo de un permiso se dice al ponerlo

Si un permiso es de asuntos propios lo dice su **tipo**: los del convenio (art. 22, `leave_type`), guardado en `conductor_estado_hist.leave_type_code`. Hasta el 14/10/2026 no lo pedía nadie (solo lo tenía el de Víctor Requena, de db/196). Ahora:

- **Plantilla** (cambiar la situación o añadir un tramo): al elegir «Permiso retribuido», un segundo paso pregunta «¿Qué permiso es?», con «Otro (ninguno de estos)» al final (asuntos propios ya no está: es su propia situación desde el 29/10/2026). **Corregir** un tramo de permiso deja cambiar el tipo, y el historial de situaciones lo enseña debajo de la etiqueta («Sin tipo» si no lo tiene).
- **Ticketera**: «Aplicar» un permiso pregunta lo mismo antes de ponerlo.
- El servidor comprueba el tipo contra el catálogo (`conductores.repo.tipoDePermiso`). Solo vale en un permiso: en otra situación se ignora. «Otro» o vacío guardan NULL.
- db/199 pone las tildes a los nombres del catálogo («Acompanyamiento» → «Acompañamiento»). Los códigos no cambian.

La cuenta es una función pura, `vacaciones.service._saldoDe`, con su comprobador: `node scripts/comprobar-vacaciones-saldo.js` (32 casos).

## Los festivos

`festivo` (db/197) guarda los doce de cada decreto de la Comunidad de Madrid: los nacionales y los que fija la Comunidad. Los dos locales de cada municipio no entran.

- 2025: Decreto 93/2024 (BOCM del 26/09/2024).
- 2026: Decreto 75/2025 (BOCM del 25/09/2025).
- **Los de 2027 hay que añadirlos con una migración** cuando salga su decreto (hacia septiembre de 2026).

**Las horas de cada persona en cada festivo** van en `festivo_horas`. Son las de la [[Nominas|nómina]]: viaje más espera de BOLT, por día natural de Madrid, y dos cuentas que se pisan cuentan una vez (`nominas.service.horasDelDia`). Hay tres tramos:

| Festivos | De dónde salen las horas |
|---|---|
| Desde el 01/07/2026 | Las calcula el sistema desde `fv_tramo`: un cron horario en `app.js` (minuto 20). Se rehacen hasta 4 días después del festivo, porque BOLT manda tramos con retraso. Mientras tanto la ficha dice «Calculándose». |
| Del 25/07/2025 al 02/05/2026 | db/198: sacadas del historial de cambios de estado de BOLT con la misma cuenta que `fv_tramo` (script «Scripts de análisis/vacaciones-modulo/festivos-horas-bolt.js»). Se comprobó contra la nómina el 15/08/2026: 106 de 107 personas iguales al minuto, y nadie cambia de lado de las 6 h. |
| De enero a mayo de 2025 | **Sin datos.** BOLT no devuelve nada de antes de mediados de junio de 2025: el 01/06/2025 sale vacío y el 20/06/2025 ya trae datos. No suman, y la ficha lo dice. |

## La pantalla

Se diseñó con la skill de UI/UX, sobre la identidad de la casa ([[Identidad visual]]).

- **El saldo va debajo de cada nombre**, como lo pidió Camilo. El número lleva su signo y la palabra «Saldo», y en rojo solo si es negativo: el color no va solo. Si tiene algo programado, al lado va lo que le quedará. Si está de vacaciones hoy, una etiqueta lo dice.
- Columnas: contrato, desde cuándo se le calcula, generadas, festivos, disfrutadas, asuntos propios y programadas. En el Excel de la lista van además el saldo, el saldo tras lo programado y el DNI.
- KPIs: personas, días por disfrutar (la suma de los saldos a favor), en negativo y de vacaciones hoy. Los dos últimos son atajos a su filtro. Filtros por saldo (en negativo, más de 30 días, de vacaciones hoy) y por contrato.
- **La ficha es un extracto**: cada línea con su signo y de dónde sale, y el saldo debajo de la raya. Detrás, las tablas de festivos (horas trabajadas y si suma), de vacaciones (con la celda o fila del Excel de donde salieron) y de permisos y suspensiones. Arriba, «Abrir en Plantilla».

## Cambiar unas vacaciones ya aprobadas (16/10/2026)

Camilo: *«que en el módulo de vacaciones se puedan editar las vacaciones aprobadas pero solo a futuro, las que pasaron no, pero siempre ligado todavía al ticket de requerimiento»*.

En la ficha, la tabla de **Vacaciones** lleva una columna **«Ticket»** (el chip con su código, que abre la Ticketera) y, en las que todavía no han pasado, un lápiz **«Cambiar las fechas»**. Solo lo ve —y solo lo puede usar— quien tiene la llave de aprobar (Laura Blanco): la exige el servidor, la pantalla solo esconde el botón.

| Cómo están | Qué se puede cambiar |
|---|---|
| **Ya pasaron** (terminaron antes de hoy) | nada |
| **Empezadas** (desde hoy o antes) | solo la **vuelta**: adelantarla —como pronto, que terminen hoy— o retrasarla. El primer día ya pasó y se queda; el diálogo ni lo pregunta |
| **Aún no han empezado** | las dos fechas, **a partir de mañana** |

Hoy cuenta como pasado: es un día que ya se está viviendo. También se puede cambiar el motivo.

**Siguen unidas a su ticket.** Se corrige la MISMA fila (`conductor_estado_hist`, con su `ticket_id`), no se borra y se crea otra. Si salieron de un ticket, el ticket **no se reabre ni cambia de estado** (sigue «ejecutado»), pero:

- su **resolución** pasa a decir las fechas nuevas: *«Aplicado: Vacaciones del 23/10/2026 al 03/11/2026 (cambiadas el 16/10/2026)»*;
- su **historia** apunta el cambio y quién lo hizo: *«Vacaciones cambiadas desde Vacaciones: antes del 21/10/2026 al 01/11/2026, ahora del 23/10/2026 al 03/11/2026.»*

Las que no salieron de un ticket (las de los Excel, las puestas a mano) se cambian igual, sin ticket que apuntar.

Por debajo: `PUT /vacaciones/api/conductor/:id/vacaciones/:filaId` → `vacaciones.service.cambiarVacaciones` (las reglas, en `validarCambio`, pura) → `plantilla.service.editarAusencia` (la llave y la corrección del tramo) → `ticketera.service.anotarCambioDeVacaciones`. Al corregir el tramo, el «Activo» de fondo se parte como al añadirlo ([[Conductores#Un tramo "Activo" abierto es el fondo, no un obstáculo]]): sin eso, alargar o mover unas vacaciones de quien volvió de una baja chocaba con su tramo «Activo» y no se podía. Otra ausencia en medio sigue avisando de cuál estorba.

Ensayado sobre copias temporales de los estados y los tickets reales (21 casos, entre ellos las vacaciones del ticket RH-20261016-10659, del 21/10 al 01/11, y las de la ficha 69, con dos «Activo» de fondo). Las reglas puras, en `scripts/comprobar-vacaciones-saldo.js`.

**Y lo mismo en Plantilla** (16/10/2026, Camilo: *«Sí, bloquéalo también en Plantilla»*). Las dos puertas pasan por la misma regla, `services/vacacionesAFuturo.js`:

- **Corregir** unas vacaciones en Plantilla: las mismas tres filas de la tabla de arriba.
- **Borrar** unas vacaciones: solo las que **aún no han empezado**. Borrar unas empezadas es borrar días que ya pasaron; si vuelve antes, se adelanta la vuelta.
- En la ficha de Plantilla, las vacaciones pasadas ya no tienen lápiz, y las empezadas no tienen papelera. El servidor lo vuelve a mirar.
- **Solo las vacaciones**: una baja médica, un permiso o una suspensión se siguen corrigiendo y borrando como antes, porque el parte de una baja suele llegar después.

Ensayado también por la puerta de Plantilla, sobre copias temporales (28 casos en total).

## Solo plantilla propia (16/10/2026)

Camilo: *«quita a la gente de la ETT, a ellos no les damos vacaciones»*. La lista y las fichas del módulo son **solo de plantilla propia** (136 personas ese día, de 223 con contrato abierto): a los de ETT las vacaciones se las da la agencia, y aquí no llevan saldo. Si alguien abre por enlace la ficha de uno de ETT, se le dice: *«… es de ETT: sus vacaciones se las da la agencia, no nosotros, así que aquí no lleva saldo»*. Ya no hay columna «Contrato» ni filtro Propia/ETT.

Sus ausencias **se siguen poniendo en su ficha** de Plantilla (es lo que lo aparta del cuadrante); solo dejan de salir en este módulo.

## Todo empieza el 01/01/2026 (19/10/2026)

Camilo: *«Reinicia las vacaciones desde el 1, si están dados de alta antes pues muy de malas, perdieron esos días, que empiecen a contar desde este año»*.

- El saldo de quien entró **antes de 2026** se calcula desde el **01/01/2026**. Lo de antes **no cuenta para nada**: ni lo generado en 2025, ni las vacaciones que cogió entonces, ni los permisos, ni los festivos trabajados. Unas vacaciones que cruzan el 1 de enero cuentan solo sus días de 2026.
- Quien entró en 2026 sigue igual: desde su alta.
- Es una sola constante, `DESDE_HISTORICO` (`vacaciones.service.js`): `saldoDe` ya recortaba a esa fecha lo generado, las vacaciones, los permisos, las suspensiones y los festivos. Los festivos «sin datos» (los de antes de junio de 2025, que BOLT ya no guarda) dejan de salir.
- **Lo que cambió ese día** (134 personas de plantilla propia, con db/209 ya aplicada): 46 arrancan ahora el 01/01/2026 y cambian de saldo, 42 a menos y 4 a más (quien había gastado en 2025 más de lo que generó). El saldo medio pasa de 13,11 a 9,74 días; los saldos negativos, de 5 a 12. Lo que más baja: Javier Sánchez Núñez (65,94 → 30,97) y José Miguel Cañas del Olmo (53,94 → 23,97); lo que más sube: Leslie Andrea Arbeláez Vargas (−2,06 → 23,97) y Luis David Sarzosa Garzón (6,94 → 23,97).

## Las previstas de Caverel, fuera desde mayo (19/10/2026, db/209)

Camilo: *«nosotros nos hicimos cargo de los trabajadores de mayo en adelante … Caverel tenía vacaciones previstas, pero las que se hicieron efectivas sí o sí es de las vacaciones de la plantilla de RRHH»*, y *«Sí, quítalos del ERP»*.

`db/209` borra los **9 tramos de mayo en adelante que solo venían del Excel de Caverel** (su motivo dice Caverel y no nombra la PLANTILLA TRABAJADORES de RRHH), de las 8 personas que se le enseñaron: Carlos Eduardo Gómez Quirama (15–31/07), Elian Fernando Bonilla Ruiz (17/06–06/07), Jamal Halbouz El Kariraa (24–28/05), Juan Francisco Ruiz Cano (01–03/05), Juan Manuel Álvarez Akieme (30–31/05), Kevin Johan Ferreira Montilla (04–30/05), Soufyane El Hadri (28–30/05 y 01–08/06) y Aquila Daniel Andrade da Silva (06–13/05, baja voluntaria el 19/10).

- **El saldo sube esos días**: ensayado, Carlos Eduardo 8,82 → 25,82; Elian 26,86 → 46,86; Jamal −2,47 → 2,53; Juan Francisco 10,94 → 13,94; Juan Manuel 11,89 → 13,89; Kevin 12,30 → 39,30; Soufyane 8,94 → 19,94.
- **Se salta la llave de Laura y el «solo a futuro»**, a propósito: lo pidió y lo autorizó Camilo, y firma él (usuario 7). Cada borrado queda en `cambio_campo` como cuando la pantalla borra una ausencia, con origen `migracion`.
- Solo actúa sobre lo que está como se vio; se puede pasar dos veces.
- **Quedan sin tocar** los de tres personas que ya no estaban: Emilio Espinoza, Laurentiu Teodor Meran y Younes Hammaouda.
- Lo de antes de mayo no se toca: Caverel llevaba entonces a esa gente.

## Quien se fue: su saldo a la baja (21/10/2026)

Camilo: *«quiero ver las vacaciones generadas de la gente que fue dada de baja también»*. La pantalla trae ahora también a quien se fue **desde el 01/01/2026** (plantilla propia), con su **último contrato**. Su saldo es la misma cuenta que la de todos (`saldoDe`), pero con «hoy» en el día de su baja (`saldoPara`). Es lo que generó y no disfrutó hasta que dejó la empresa, lo que entra en su finiquito. Lo de después de la baja no cuenta: nada programado y nada que cambiar.

- La lista se abre con **«De alta»** (`filtrosIniciales`). El filtro «Situación» enseña **«De baja»** o las dos cosas. Las cifras de arriba son de la gente de alta, más una aparte, **«Dados de baja»**, con los días sin disfrutar a su baja, que filtra al pulsarla.
- Debajo del nombre: *«Baja el 21/10/2026 · saldo a esa fecha»*. En la ficha: *«Saldo a su baja (…)»*. En el Excel van la baja y su motivo.
- Quien tiene la **baja programada** (más adelante) sigue contando a hoy, como cualquiera de alta, con la etiqueta *«Baja programada el …»*. Hasta ahora esa gente no salía, porque se miraba solo el contrato sin baja.
- **Las suspensiones no generan**, ni aquí ni en la nómina. Wilson Santos Martínez (ficha 94) no se fue el 04/09: estuvo suspendido de empleo y sueldo del 04/09 al 21/10/2026 y causó baja el 21/10 (corregido directo en la base ese día, firmado por Camilo). Del 09/04 al 21/10 son 196 días, menos 48 de suspensión: 148, que dan 12,15, más 2 festivos = **14,15 días a su baja**.

Medido el 21/10/2026: **134 de alta** y **161 que se fueron desde el 01/01/2026**, con **941,5 días sin disfrutar** a su baja (3 en contra). Ojo: **11 de plantilla propia tienen la baja el 04/09/2026**, que puede ser la fecha de relleno de la carga inicial (7 sin motivo). Su saldo sale cortado ese día hasta que RRHH confirme la fecha real.

## La llave

`/vacaciones`, en el grupo RRHH del catálogo ([[Usuarios y permisos]]). db/197 se la da a quien ya tenía `/rrhh` o la de aprobar vacaciones, que son 8 usuarios. **Mirar los saldos no da permiso para aprobar**: `/vacaciones/aprobar` se mira exacta (`services/aprobarVacaciones.js`) y no por prefijo.

## Lo que hay que saber

- **Los permisos que había el 14/10/2026 no tienen tipo**, salvo el de Requena: entre ellos, una baja por paternidad, dos «no se le entregó el coche» y un día compensatorio. Uno dice **«permiso por asuntos personales»** (la ficha 283, del 06/10), pero según Camilo (29/10/2026) el único día de asuntos propios del año es el de Requena: ese se queda como permiso.
- **«De dónde sale»** es el motivo del tramo. Las de los Excel lo traen desde db/195 y db/196. Las 28 de la carga inicial (03/09/2026) entraron sin él y db/201 se lo pone: la fila de la pestaña VACACIONES de PLANTILLA TRABAJADORES y, si también está, la celda de Caverel. Dos lo dicen con matiz: Molina (el sistema hasta el 29/09, el Excel de hoy el 30/09) y Aboulghazi (Caverel desde el 01/08, no el 02/08). Si un tramo no trae motivo pero sí usuario, la pantalla dice **«Lo puso X el dd/mm/aaaa»** (quién y el día que se metió; se lee de la fila, no se copia). Así salen nueve que se pusieron a mano en Plantilla sin motivo; de ellas, siete son de personas con contrato abierto y se ven en el módulo. Solo siguen con guion los dos del 04/09 que entraron sin usuario (Kevin Ferreira y Daniel Castillo).
- Wellim Matos (ficha 75) se fue 33 días, del 03/09 al 05/10/2026 (fila 29). BOLT lo confirma: de la jornada del 02/09 a la del 07/10 no tiene ni una hora. Con alta el 16/02/2026 le salen −11,2: o RRHH le adelantó vacaciones o parte no fueron vacaciones.
- ETT: sale todo el que tiene contrato abierto. Las vacaciones de quien está por ETT las paga la agencia; el filtro de contrato los separa.
- Con los datos del 14/10/2026 (ensayado en copia, antes de aplicar db/197 y db/198): 214 personas, saldo medio de 9,1 días, 8 en negativo y 15 con más de 30.
