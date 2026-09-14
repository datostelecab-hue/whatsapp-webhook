# Nóminas

La **compensación variable** del mes: lo que se suma al recibo por encima del sueldo base.
Nocturnas, propinas, peajes y el MBO (por horas extra o por facturación).

No es la nómina entera: el sueldo base lo lleva la gestoría. Aquí sale la parte que
depende de lo que cada uno hizo ese mes, y que antes se calculaba a mano en un Excel.

```
/nominas                      la pantalla
GET  /nominas/cargar          el mes: lo congelado, o el cálculo en vivo
POST /nominas/calcular        simular con otras tarifas, sin guardarlas
GET  /nominas/config          las tarifas y parámetros
POST /nominas/config          guardarlos
POST /nominas/congelar        cerrar el mes
POST /nominas/descongelar     reabrirlo — solo el desarrollador
GET  /nominas/congeladas      qué meses están cerrados
GET  /nominas/nomina.xlsx     el Excel
```

## Las dos reglas

**A mes vencido.** La nómina de un mes se calcula con los datos del mes **anterior**: la de
julio paga el trabajo de junio; la de enero, el de diciembre del año pasado. El mes que se
elige en la pantalla es el del **pago**, y la cabecera dice siempre de qué mes son los datos.

**El prorrateo arranca en la fecha de alta**, no en el primer día con horas:

| Su alta | Qué se le pide |
|---|---|
| Anterior al mes de trabajo | El mes completo, sin prorratear |
| Dentro del mes | Prorrateado desde su día de alta |
| Posterior al mes | No entra en esa nómina (y si tiene horas, se lista aparte: la fecha está mal) |
| Sin fecha | Criterio antiguo: su primer día con horas, y se marca en el panel |

El cuarto caso era el frecuente cuando la fecha venía de la columna G de una hoja escrita
a mano. Ahora sale de `conductor_periodo_empleo.alta`, que la tiene el 100 % de la
plantilla, así que casi no se da.

## La fórmula

```
objetivo de horas = (días desde el arranque ÷ días del mes) × días objetivo × horas meta
diferencia        = horas hechas − objetivo
MBO horas extra   = diferencia × € hora extra × utilización     (solo si la diferencia es positiva)
MBO FAS           = (facturación neta − umbral) × % MBO FAS     (solo si supera el umbral de SU jornada)
nocturnas         = € hora nocturna × horas nocturnas × factor

TOTAL = nocturnas + peajes + propinas + el MAYOR de los dos MBO
```

**Los dos MBO no se suman**: se cobra el que salga más alto. Por eso en muchas filas la
columna "Compensación" va a cero aunque "MBO horas extra" tenga un número — ese mes ganó
el FAS.

El umbral FAS y el sueldo base son **distintos por jornada** (40 h y 32 h). Quien no tenga
jornada anotada cuenta como 40: es la de casi todos, y dejarle el umbral bajo regalaría
MBO FAS que no le toca.

`€ por hora extra` vale **7, no 9**. El AppScript original traía 9, pero sus fórmulas leían
la celda de configuración, y la celda real de mayo y junio tenía 7. Reproduciendo junio con
7 cuadran las 164 nóminas al céntimo. Si algún día se cambia, se cambia desde el panel.

## De dónde sale cada número

| Dato | Fuente |
|---|---|
| Horas efectivas | `fv_tramo`, situaciones efectivas (viaje + espera), jornada 05→05, solapes fundidos |
| Nocturnas | El trozo de esas horas entre las 22:00 y las 06:00 (hora de Madrid) |
| Utilización | viaje ÷ (viaje + espera) — el `has_order` de BOLT sobre el tiempo conectado |
| Propinas, peajes, facturación neta | `v_ordenes_conductor`, sobre `bolt_order` |
| DNI, jornada, ETT, fecha de alta | `conductor` + `conductor_periodo_empleo` |

**Ni una hoja de cálculo ni una llamada a ninguna API.** Antes las horas salían de la hoja
mensual del libro de horas, el DNI y el alta de AGENDA_V2, y la configuración, el snapshot
y los meses cerrados vivían en tres hojas más; encima había una ruta de diagnóstico que
preguntaba a BOLT en caliente. Todo eso está en PostgreSQL.

Las horas son **la misma definición** que la bitácora y que el Reporte de horas. Están
comprobadas: en agosto de 2026, las 225 personas comparables salen idénticas a la bitácora
sellada.

## Las horas que la bitácora no tiene

La bitácora **sella** las horas el día que la jornada cierra y ya no las recalcula, para que
el pasado no se mueva. Consecuencia: a quien se le enlace su cuenta de BOLT más tarde no
aparece allí, aunque sí trabajara.

La nómina no puede permitirse eso — dejaría a alguien sin cobrar 137 horas —, así que
calcula ella y **cuenta a todo el que trabajó**. A cambio, los dos números se separan para
esas personas, y en vez de callarlo el panel las nombra. Si el desfase molesta, se arregla
resellando el mes desde la bitácora (`POST /bitacora/api/resellar`, del desarrollador).

## Congelar

Una nómina congelada guarda **los números**, no una forma de recalcularlos, y guarda al lado
la configuración con la que se hicieron. A partir de ahí no cambia pase lo que pase con los
datos: es lo que se pagó. Un mes cerrado tiene que poder explicarse solo.

No hay "snapshot de datos crudos" como en las hojas. Allí hacía falta porque volver a bajar
el mes de BOLT tardaba minutos; aquí recalcular es una consulta.

**Descongelar** borra la nómina guardada y devuelve el mes al cálculo en vivo. Es del
desarrollador, mismo candado que las migraciones: si el mes ya se pagó, los números pueden
salir distintos.

## Capas

```
nominas.controller.js   HTTP. No decide nada.
nominas.service.js      El cálculo y el prorrateo. Aquí está lo que cobra la gente.
nominas.repo.js         SQL y nada más.
nominas.excel.js        El fichero para la gestoría.
vistas/nominas.ejs      La pantalla.
```

Desde fuera del módulo se entra por `nominas.service`, nunca por `nominas.repo`.

Tablas: `nomina_config`, `nomina_mes`, `nomina_fila` (db/108).

## Si hay que tocar la fórmula

`calcularFila` es la cadena del AppScript original, intacta. Cambiar algo ahí cambia lo que
cobra la gente: no se toca sin rehacer la comprobación contra un mes ya pagado.
