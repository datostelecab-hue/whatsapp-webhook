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

## Las tres reglas

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

**Las J cuentan, y valen el día entero.** Un día con justificante aprobado no es un
día sin trabajar: es un día que alguien dio por bueno. De ahí salen dos columnas:

| Columna | Qué es |
|---|---|
| **Horas justificadas** | Lo que cubren las J aprobadas |
| **Horas no justificadas** | Lo que sigue faltando para el objetivo después de sumar BOLT y las J |

Cada J vale la jornada entera (8 h), **sin distinguir tipo ni motivo**. La tabla
`justificante` tiene una columna de horas, pero no dice nada útil: de las 182 J aprobadas
de agosto de 2026, 114 traen un "8" puesto a ojo y otras 13 traen las **mismas** horas que
esa persona ya había rodado ese día — sumarlas sería contar dos veces el mismo rato.

Y **topada por lo que falte de ese día**. Una J cubre lo que no se pudo hacer, no ocho
horas encima de lo que sí se hizo: quien rodó 3 h y tiene J ese día suma 5 justificadas, y
el día queda en 8, no en 11. Para los 104 días de agosto en que no se rodó nada —la gran
mayoría— la J vale las 8 enteras.

Solo cuentan las **aprobadas**. Las pendientes no (el panel avisa de cuántas hay en la
cola) y las rechazadas tampoco: ese día vuelve a ser lo que era.

**Las J no dan extras.** El MBO de horas extra sigue saliendo solo de las horas rodadas: se
paga por conducir de más, y una J es precisamente no haber conducido. Quien tiene 100 h
rodadas y 80 justificadas ha cubierto su objetivo —no debe horas— pero no ha hecho ninguna
hora extra.

## La fórmula

```
objetivo de horas = (días desde el arranque ÷ días del mes) × días objetivo × horas meta
diferencia        = horas hechas − objetivo
MBO horas extra   = diferencia × € hora extra × utilización     (solo si la diferencia es positiva)
MBO FAS           = (facturación neta − umbral) × % MBO FAS     (solo si supera el umbral de SU jornada)
nocturnas         = € hora nocturna × horas nocturnas × factor

horas justificadas    = Σ, por cada día con J aprobada, max(0, jornada − lo rodado ese día)
horas NO justificadas = max(0, objetivo − horas rodadas − horas justificadas)

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
| Días justificados | `justificante` (solo las aprobadas), la misma tabla que pinta la bitácora |
| Los dos nombres | `conductor.nombre_bolt` y `conductor.nombre_ss` |

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

## Los dos nombres del Excel

La misma persona se llama de dos maneras y el fichero lo leen dos mundos distintos, así que
van las dos columnas, una al lado de la otra:

| Columna | Ejemplo | Para qué |
|---|---|---|
| **ID de BOLT** | `Muhammad Bilal Ashraf` | Cruzar la hoja con cualquier informe de BOLT. Es por donde lo busca Tráfico |
| **Nombre de la seguridad social** | `ASHRAF MUHAMMAD, BILAL` | Lo que entiende la gestoría y lo que va en un documento oficial |

El de la seguridad social sale de `conductor.nombre_ss` si RRHH lo tiene escrito, y si no se
compone de la ficha como `APELLIDOS, NOMBRES`. La coma se normaliza siempre a `, `, venga
como venga de la base.

**Lo que no se hace es adivinar.** A 63 de las 239 personas de agosto la ficha no les separa
apellidos de nombres: su nombre viene entero en una pieza (`PICO CABEZAS JOSE`), y no se
sabe si son dos apellidos y un nombre o uno y dos — y alguno, como `RAZVAN OCTAVIAN
TIRNOVAN`, va en el orden contrario. Partirlo a ojo cambiaría el nombre legal de alguien en
un papel que va a la gestoría, así que se deja tal cual y el panel dice cuántos son. Se
arregla rellenándoles los apellidos en su ficha.

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
