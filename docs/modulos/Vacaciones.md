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
| **−** | Asuntos propios | **Cada día de permiso por ASUNTOS PROPIOS resta un día entero** del saldo. Los demás permisos retribuidos no restan. |

- **Quien entró antes de 2025 empieza el 01/01/2025**: el histórico de vacaciones empieza ahí y lo anterior se da por cerrado. Quien entró después, desde su alta. Las vacaciones de un contrato anterior no cuentan.
- **Lo programado** (vacaciones y permisos de mañana en adelante, ya puestos en la ficha) no toca el saldo de hoy. Se enseña aparte, con lo que quedará después.
- El saldo puede ser **negativo**: ha disfrutado más de lo generado.

Las decisiones de Camilo, el 14/10/2026: los permisos se descuentan del saldo, y luego, *«Solo restan los de asuntos propios»*; para los antiguos, desde el 01/01/2025; las suspensiones no generan; y el festivo suma solo si se trabajó más de 6 h.

### El tipo de un permiso se dice al ponerlo

Si un permiso es de asuntos propios lo dice su **tipo**: los del convenio (art. 22, `leave_type`), guardado en `conductor_estado_hist.leave_type_code`. Hasta el 14/10/2026 no lo pedía nadie (solo lo tenía el de Víctor Requena, de db/196). Ahora:

- **Plantilla** (cambiar la situación o añadir un tramo): al elegir «Permiso retribuido», un segundo paso pregunta «¿Qué permiso es?», con asuntos propios el primero y «Otro (ninguno de estos)» al final. **Corregir** un tramo de permiso deja cambiar el tipo, y el historial de situaciones lo enseña debajo de la etiqueta («Sin tipo» si no lo tiene).
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

## La llave

`/vacaciones`, en el grupo RRHH del catálogo ([[Usuarios y permisos]]). db/197 se la da a quien ya tenía `/rrhh` o la de aprobar vacaciones, que son 8 usuarios. **Mirar los saldos no da permiso para aprobar**: `/vacaciones/aprobar` se mira exacta (`services/aprobarVacaciones.js`) y no por prefijo.

## Lo que hay que saber

- **Los permisos que había el 14/10/2026 no tienen tipo**, salvo el de Requena. Por eso no restan: entre ellos, una baja por paternidad, dos «no se le entregó el coche» y un día compensatorio. Uno dice **«permiso por asuntos personales»** (la ficha 283, del 06/10). Si es de asuntos propios, hay que marcarlo en Plantilla (corregir el tramo → tipo) para que reste.
- ETT: sale todo el que tiene contrato abierto. Las vacaciones de quien está por ETT las paga la agencia; el filtro de contrato los separa.
- Con los datos del 14/10/2026 (ensayado en copia, antes de aplicar db/197 y db/198): 214 personas, saldo medio de 9,1 días, 8 en negativo y 15 con más de 30.
