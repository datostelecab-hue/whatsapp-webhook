---
tags: [modulo, rrhh, ausencias, absentismo]
ruta: /ausencias
codigo: modules/RRHH/ausencias*
---

# Ausencias (las que valida RR. HH.)

**Módulo 1, primera parte**, del [[Plan RRHH y nominas]] (25/11/2026, db/289). El encargo: *«El ERP asigna ausencias automáticamente a quien no ficha. Ninguna ausencia se descuenta como absentismo sin validación. Tarea diaria para Diana: revisar las ausencias nuevas y confirmar que no son una baja médica»*. Lo que espera al fichero del INSS (bajas, prórrogas, reincorporación) es la segunda parte.

```
modules/RRHH/ausencias.repo.js        el SQL (ausencia_rrhh, plantilla propia, % de baja)
modules/RRHH/ausencias.service.js     la detección, la tarjeta, decidir, el % de baja
modules/RRHH/ausencias.controller.js  /ausencias
public/assets/js/vistas/RRHH/ausencias.js
test/ausencias-rrhh.test.js
```

## De dónde sale una ausencia

De la [[Bitacora]], con **su** regla: con plaza, le tocaba, y no salió sin nada que lo explique (ni horas, ni J, ni libranza, vacaciones, baja o permiso, ni una situación sin marca). La regla vive **una sola vez**, en `bitacora.service.claseDelDia`, y la usan el [[Promedio de horas]] de la casa y esta pantalla: la bandeja de Diana y la letra de la persona no pueden decir cosas distintas del mismo día.

Decidido por Camilo el 25/11/2026:
- **Solo plantilla propia** (un contrato propio que cubre ese día). La nómina de la ETT la hace la agencia.
- **Desde el 26/10/2026**: las nóminas van **del 26 al 25** (`nomina.dia_corte` en [[Parametros]]), y el 26/10 es donde empieza la de noviembre. Lo de antes no se toca.

## Cada día a las 13:00

La tarea `ausencias.detectar` ([[Tareas programadas]]) a esa hora ya tiene las horas del turno de noche de ayer, que entran hasta las 12:00:
- Las ausencias nuevas hasta ayer se apuntan **pendientes** (`ausencia_rrhh`, una por persona y día).
- **La que ya no es ausencia** (le pusieron una J, entraron sus horas, una libranza, unas vacaciones) se cierra sola: «Ya no es ausencia».
- **La que cae dentro de una baja médica o un permiso se reclasifica sola**, también si ya estaba decidida («es retroactivo», dice el encargo). La baja se mira en la base, no en la caché de la bitácora.
- **La que vuelve a serlo** (se anuló la J, se borró la baja) vuelve a pendiente.
- Si hay nuevas, **nace la tarjeta del día** en el [[Tablero de tareas]] («Revisar N ausencias nuevas»), a quien tenga la función **«ausencias_validar»** ([[Organizacion]], el puesto de Diana), con plazo de un día. **Se cierra sola** cuando no queda ninguna de las suyas por revisar. Si vence, avisa a Ignacio, como todas.

## Lo que decide RR. HH.

En `/ausencias` (menú RR. HH. → Ausencias, con su número de pendientes), con la llave `/ausencias/validar`:

| Decisión | Qué pasa |
| --- | --- |
| **Injustificada** | Cuenta como **absentismo**: ese día no devenga salario (cuando llegue el módulo 4, a la nómina). |
| **Justificada** | Con nota obligatoria. No es absentismo. La bitácora no cambia. |
| **Baja médica** | Se abre la baja en su ficha (la misma puerta que Plantilla y la Ticketera), del día que se diga al que se diga (o abierta). Las ausencias suyas de esas fechas se resuelven con ella. |
| **Permiso** | Igual, con su tipo del convenio (art. 22). |

- **Varias a la vez**: se marcan las casillas y «Injustificadas» o «Justificadas». La baja y el permiso, de una en una, porque llevan fechas.
- **El justificante**, en el bloque «Justificante» de la ficha ([[Almacen de ficheros|adjuntos]], dueño `ausencia_rrhh`).
- Lo ya decidido se puede cambiar entre injustificada y justificada. Una baja o un permiso no se deshace aquí: se corrige en Plantilla, y la detección siguiente la vuelve a poner pendiente si hace falta.
- La ficha enseña los **días seguidos sin salir** (tres o más suelen ser una baja), las **llamadas de Control** de ese día y sus otras ausencias.
- **Todo al libro de auditoría** (`auditoria_vigilar`): quién, cuándo y con qué baja. Lo que hace el sistema lleva `automatica`.

## Desde el corte del 26/11/2026 las confirma Tráfico (db/311, 27/11/2026)

Camilo: *«a partir de ayer, que empieza el corte del mes, tienen que confirmarlas Tráfico, o darlas como justificadas, Diana no»*.

- **Quién**: **William y Ángel**. Tienen la llave `/ausencias/trafico` (y `/ausencias` para entrar) y la función «Confirma las ausencias de cada día (Tráfico)». La tarjeta diaria de las ausencias nuevas les nace a ellos. Las tarjetas que seguían abiertas desde el 27/11 se pasaron a William.
- **Qué deciden**, en las ausencias **del 26/11 en adelante**:
  - **Injustificada**: absentismo, como siempre.
  - **Justificada**: pide **las horas** (por defecto 8) y el motivo. **Su J de Tráfico nace ya aprobada** con esas horas, sin pasar por la cola de J, porque lo decidieron ellos. La J dice «Ausencia justificada por Tráfico: …».
- **Lo que sigue siendo de RR. HH.** (Diana, `/ausencias/validar`): las ausencias **de antes del 26/11** y **abrir una baja médica o un permiso**, sea del día que sea. Si Tráfico ve que es una baja, avisa a RR. HH.
- El servidor no deja a cada uno decidir lo del otro: lo dice con el nombre y el día de la ausencia.
- En los pendientes del día 20 (ítem 7), la tarjeta de ausencias sin validar va también a Tráfico.

## El % de plantilla de baja

En las cifras de arriba, el de hoy: plantilla propia de alta con una baja médica abierta (el 25/11/2026, 30 de 161, un 18,6 %; el encargo decía «en torno al 17 %»). En **«Plantilla de baja»**, los últimos 90 días y la media de cada mes, con su día más alto y más bajo, desde el 01/07/2026.

## Llaves

- `/ausencias`: mirarlas y el % de baja. Diana e Ignacio (db/289).
- `/ausencias/validar`: decidir y subir el justificante. Diana.

Son datos de salud: no se dan a nadie más sin pensarlo.

## Los permisos: quién los valida y su saldo (db/290)

El encargo: *«Permisos retribuidos: validador configurable (de momento, Diana), con el saldo por conductor y tipo de permiso siempre visible según el convenio. Se pueden modificar o anular, con registro y recálculo del saldo»*. Decidido por Camilo el 25/11/2026: **la llave en todas las puertas, también los asuntos propios**, y **pasarse del convenio avisa y pide motivo**.

```
services/aprobarPermisos.js              la llave '/permisos/aprobar' (como la de vacaciones, pero de varias personas)
modules/Conductores/permisosConvenio.js  lo que da cada permiso, lo que lleva cada persona y el aviso
test/permisos-convenio.test.js
```

- **La llave `/permisos/aprobar`** (en /usuarios, «Aprobaciones»; de inicio, Diana): sin ella nadie pone, cambia ni borra un permiso retribuido o unos asuntos propios, por ninguna puerta: Plantilla (añadir una ausencia, cambiar la situación, corregirla, borrarla, corregir unas vacaciones a permiso), la Ticketera (aplicar) y Ausencias. Se mira en la matriz de verdad: ni el superadmin ni el desarrollador validan por su rol.
- **Lo que da cada uno** sale del catálogo del convenio (`leave_type`, art. 22) y se ve al elegirlo: «Fallecimiento… · 2 días laborables por hecho causante (+2 días si requiere desplazamiento)».
  - **Por hecho causante** (matrimonio 15 naturales, enfermedad grave 5 laborables, fallecimiento 2, traslado 1): se mira cada permiso.
  - **Al año** (asuntos propios 2 días, acompañamiento médico 8 h): se suman los del año natural. Cada día de un permiso por horas cuenta 8 h.
  - Lo indispensable, el crédito sindical, las reducciones y la lactancia no tienen un número de días que contar.
  - **Laborables** = los que le tocaba trabajar: la semana menos lo que libra (su plaza o, sin plaza, lo apuntado).
- **Si se pasa**, no se guarda a la primera: sale lo que da el convenio y lo que llevaría, y para guardarlo hay que decir por qué (`Dialogo.loQuePide`, la misma pieza en las tres pantallas). El motivo queda en el del tramo («Más de lo que da el convenio (…): Desplazamiento a Galicia») y con él en el libro.
- **El saldo**, en la ficha de Vacaciones: bloque «Permisos del convenio», con lo que lleva este año de cada tipo y lo que le queda de los que son al año. Se recalcula al leer: cambiar o borrar un permiso lo cambia en el momento.
- **Las semillas de los roles ya no reparten lo marcado `manual`** (`services/permisos.js`, `G`): las llaves de Ausencias, que son datos de salud, se dan una a una.

## Las bajas médicas y sus partes (db/303, 26/11/2026)

La pestaña **«Bajas médicas»** de esta pantalla. El encargo: *«bajas nuevas, prórrogas o confirmaciones, rectificaciones y altas, con la fecha prevista de cada una… Dos días hábiles antes del fin previsto, comprobar si hay prórroga. Solo si se confirma el alta se crea una tarjeta a Diana para la reincorporación y se avisa a planificación»*. Camilo, 26/11/2026: **a mano** hasta que llegue el fichero del INSS (que meterá los mismos partes, `origen` 'fie'); con el alta **vuelve al día siguiente**; los apunta quien valida ausencias; el aviso, al área de **Planificación**.

```
modules/RRHH/bajas.service.js   los partes, las tarjetas y la tarea diaria
modules/RRHH/bajas.repo.js      el SQL (baja_parte)
public/assets/js/vistas/RRHH/bajas.js
test/bajas-medicas.test.js
```

- **La baja sigue siendo la situación «baja médica» de su ficha** (la que manda en el planificador y la bitácora). Cada parte (`baja_parte`) la mueve:

| Parte | Qué hace |
|---|---|
| **Baja** | la abre desde ese día (la misma puerta que Plantilla), con la fecha prevista y la contingencia (común, accidente no laboral, enfermedad profesional, accidente de trabajo) |
| **Confirmación (prórroga)** | cambia la fecha prevista (`hasta_previsto`) |
| **Alta** | la cierra **el día del alta**; vuelve al siguiente. Nace la tarjeta de **reincorporación** a quien valida ausencias y un **aviso al área de Planificación** («X vuelve de baja médica el dd/mm»), que se da por visto cuando ya está en el planificador ese día, o caduca |
| **Rectificación** | corrige el primer día o la fecha prevista, con motivo |

- **Cada día a las 08:00** (`bajas.revisar`, desde el 27/11/2026): a la baja abierta cuyo fin previsto está a **dos días hábiles** o menos (o ya pasó) le nace una tarjeta, «comprobar si hay prórroga o alta». Se cierra sola con la confirmación o el alta.
- **Los partes escaneados**, en la baja (adjuntos, dueño `baja_medica`), con las mismas llaves.
- La lista: abiertas y cerradas en 60 días, cómo va cada una (en plazo, comprobar, fin previsto pasado, sin fecha prevista, con el alta) y los partes de los últimos 7 días. Cada baja se abre en un panel (la lista de Ausencias usa la dirección para sus fichas); desde una tarjeta, `/ausencias?vista=bajas&baja=ID`.
- **Al empezar** (producción, 26/11/2026): 15 bajas abiertas de gente de alta, **ninguna con fecha prevista**: no nace ninguna tarjeta hasta que se apunten partes.

## Lo que falta (segunda parte del módulo 1)

- El **fichero del INSS** (FIE) que manda la gestoría: el importador, que meterá los partes de arriba solos (`origen` 'fie'), y el campo de cruce configurable (aún no se sabe si viene por DNI, nombre o código de la gestoría).
- Lo retroactivo **con la nómina ya cerrada**: proponer la corrección en la rectificación o en la nómina siguiente (va con el módulo 4).

Relacionado: [[Plan RRHH y nominas]] · [[Bitacora]] · [[Conductores]] · [[RRHH]] · [[Tablero de tareas]]
