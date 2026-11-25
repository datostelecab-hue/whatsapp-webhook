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

## El % de plantilla de baja

En las cifras de arriba, el de hoy: plantilla propia de alta con una baja médica abierta (el 25/11/2026, 30 de 161, un 18,6 %; el encargo decía «en torno al 17 %»). En **«Plantilla de baja»**, los últimos 90 días y la media de cada mes, con su día más alto y más bajo, desde el 01/07/2026.

## Llaves

- `/ausencias`: mirarlas y el % de baja. Diana e Ignacio (db/289).
- `/ausencias/validar`: decidir y subir el justificante. Diana.

Son datos de salud: no se dan a nadie más sin pensarlo.

## Lo que falta (segunda parte del módulo 1)

- El **fichero del INSS** (FIE) que manda la gestoría: el importador, la baja con sus prórrogas, confirmaciones y altas, el campo de cruce configurable (aún no se sabe si viene por DNI, nombre o código de la gestoría) y la tarjeta de reincorporación dos días hábiles antes del fin previsto.
- **Los permisos con su saldo** por persona y tipo, y su validador configurable.
- Lo retroactivo **con la nómina ya cerrada**: proponer la corrección en la rectificación o en la nómina siguiente (va con el módulo 4).

Relacionado: [[Plan RRHH y nominas]] · [[Bitacora]] · [[Conductores]] · [[RRHH]] · [[Tablero de tareas]]
