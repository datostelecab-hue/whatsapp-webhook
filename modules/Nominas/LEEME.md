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

## Las seis reglas

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

**Las J cuentan también para el exceso.** La diferencia contra el objetivo se mide con las
justificadas dentro: quien rodó 205,6 h y tuvo dos días justificados lleva 221,6 contra un
objetivo de 176, y su exceso son **45,6 h, no 29,6**. Un día justificado no puede restarle
a nadie sus horas extra.

Y **no regala horas extra**, justo por el tope de arriba: como la J nunca sube un día por
encima de la jornada, las justificadas solo pueden llevar a alguien **hasta** su objetivo.
Para pasarse hay que haber rodado de más los otros días, que es lo que la hora extra paga.

Las dos reglas van juntas —la J vale el día entero, pero topada— y separarlas rompe el
cálculo: sin el tope, quien rodó 3 h un día justificado sumaría 11 h de ese día y cobraría
extras por horas que no hizo.

**La hora extra se paga por conducir, no por estar conectado.** Las horas efectivas son
viaje + espera, así que quien pasa el mes con la app abierta y poca carrera acumula horas
igual que quien no para. El caso que lo destapó: 211,4 h en el mes y 35,4 de exceso sobre el
objetivo… con un **52,7 % de utilización**. De sus 211 horas, 100 fueron espera.

Así que todo el mundo tiene que llegar a una **utilización mínima** (65 %, editable desde el
panel). A quien no llega se le quitan horas **de espera** —nunca de viaje— hasta que la
alcanza, y eso sale en su propia columna: *Horas quitadas en espera para llegar a la
utilización mínima*.

```
utilización = viaje ÷ (viaje + espera)
X           = (viaje + espera) − viaje ÷ mínimo
```

Dos propiedades que la hacen segura, comprobadas sobre agosto de 2026 (86 personas
afectadas, 1.138,9 h retiradas):

- **X nunca pasa de la espera que esa persona tuvo.** Sale de la propia fórmula: `X ≤ espera`
  equivale a `viaje ≤ viaje ÷ mínimo`, cierto siempre que el mínimo sea menor que 1. No se
  le puede quitar ni un minuto de viaje a nadie, por mal que esté su utilización.
- **Después del recorte todos quedan exactamente en el mínimo.** Quien ya llegaba no pierde
  nada.

La única excepción es quien no hizo **ningún** viaje: 0 dividido entre lo que sea es 0 %, así
que no hay recorte que lo lleve al mínimo. El límite es quitarle toda la espera, y es lo que
se hace (4 personas en agosto).

La columna de **% Utilización** sigue enseñando la **real**, la de antes del recorte: es el
diagnóstico, y esconderla dejaría la cifra retirada sin explicación.

**El mes es el mes: del día 1 a las 00:00 al último a las 23:59.** Sin cortes raros y sin la
jornada operativa 05→05 del resto del ERP.

La bitácora y el reporte de horas miden por **jornada** (05:00 a 05:00), que es lo correcto
para control de turnos: quieren ver la noche entera junta. Una nómina no es eso: paga lo que
pasó **en el mes**. Quien rueda la madrugada del 1 de septiembre cobra esas horas en
septiembre, aunque para la bitácora sean del turno del 31 de agosto. Igual con las J: una J
del 1 de septiembre cubre ese día natural entero.

Así **horas, dinero y J miran la misma ventana**. Cuando las horas se cortaban a las 05:00 y
el dinero a medianoche —que es como agrupa `v_ordenes_conductor`— las dos mitades del
cálculo no cuadraban en el borde del mes: la facturación de la madrugada del 1 de septiembre
(2.825,85 € en 914 pedidos) quedaba fuera de agosto mientras sus horas quedaban dentro, y a
dos personas eso les cambiaba si superaban o no el umbral del MBO FAS.

> **Las horas de la nómina no coinciden con las de la bitácora para quien trabaja de noche, y
> no es un fallo.** Son dos preguntas distintas —"¿cuántas horas cayeron en este mes?" y
> "¿cómo fue ese turno?"— y cada una tiene su ventana.

**El MBO es solo de plantilla propia.** A quien viene por ETT lo contrata la agencia y es
ella quien le paga: no le debemos horas extra ni participación en la facturación. A esas
filas se les pone a **cero** todo el MBO —el de horas y el FAS— y con él los días extra.

Pero **sí entran en la nómina, y con sus variables**: nocturnidad, propinas y peajes son
suyas se las pague quien se las pague. Las horas, el objetivo y la diferencia también se les
calculan y se enseñan: son una medida, no un pago. Lo que se pone a cero es lo que se cobra.

Para pasárselas a la agencia está el **parte de trabajo de la ETT**
(`GET /nominas/ett.xlsx`), que no es una nómina: es **lo que le costamos**. Sale con el
formato que ella ya usa, columna por columna, y con una única añadida —la fecha de baja—:

```
Conductor · DNI/NIE · Fecha incorporación · Fecha baja · HORAS · €/h · €/Total ·
Horas Nocturnas · Plus Nocturnidad · Total Plus Nocturnidad ·
Total coste trabajador · Propinas € · Peajes €
```

Las tres cuentas, que son las que la agencia repasa:

```
€/Total                = HORAS × €/h                         (15,20 €)
Total Plus Nocturnidad = Horas Nocturnas × Plus Nocturnidad  (1,31 € POR HORA)
Total coste trabajador = €/Total + Total Plus Nocturnidad
```

El **plus nocturno es € por hora**, no un porcentaje. No se parece en nada al de la nómina
de casa —que es `€ hora × horas × factor`— y mezclarlos sería facturar mal. Los dos precios
se editan desde el panel, como el resto.

Las **HORAS llevan el recorte por utilización**, igual que las de casa: la hora de espera de
quien no llega al mínimo no se le paga a un conductor nuestro y tampoco se le factura a la
agencia. Es la misma hora y vale lo mismo, la cobre quien la cobre.

> Por eso el fichero lleva una **segunda pestaña, "Horas descontadas"**: a quién se le ha
> quitado, cuánto, con qué utilización y cuánto supone en euros. Un descuento sin su
> argumento al lado es un número que la agencia no puede comprobar, y lo primero que hace un
> número así es no creerse.

La **fecha de baja** solo sale cuando cae **dentro del mes** que se pide: una de hace tres
meses no pinta nada en ese parte, y una del mes que viene todavía no ha pasado.

> **Ese Excel va por mes TRABAJADO**, no a mes vencido: se elige agosto y salen los datos de
> agosto. La nómina va a mes vencido porque es un pago; un parte de trabajo lleva el mes que
> dice. Por eso tiene su propio selector en la pantalla, separado del de la nómina.

## La fórmula

```
objetivo de horas = objetivo de SU jornada × (días desde el arranque ÷ días del mes)
                    40 h → 172      32 h → 172 × 32/40 = 137,6
horas en espera   = (viaje + espera) − viaje ÷ utilización mínima   (0 si ya llegaba)
  quitadas
diferencia        = (horas rodadas − horas quitadas + horas justificadas) − objetivo
MBO horas extra   = diferencia × € hora extra × utilización     (solo si la diferencia es positiva)
MBO FAS           = (facturación neta − umbral) × % MBO FAS     (solo si supera el umbral de SU jornada)
nocturnas         = € hora nocturna × horas nocturnas × factor

horas justificadas    = Σ, por cada día con J aprobada, max(0, jornada − lo rodado ese día)
horas NO justificadas = la diferencia cuando sale negativa, o sea max(0, −diferencia)

TOTAL = nocturnas + peajes + propinas + el MAYOR de los dos MBO
```

**Los dos MBO no se suman**: se cobra el que salga más alto. Por eso en muchas filas la
columna "Compensación" va a cero aunque "MBO horas extra" tenga un número — ese mes ganó
el FAS.

**El objetivo sale de su jornada**, por regla de tres sobre el de 40 h: 172 para jornada
completa, 137,6 para la de 32 h. El umbral FAS y el sueldo base también son distintos por
jornada. Quien no tenga jornada anotada cuenta como 40, y no es pereza: es la de casi todos,
y suponer menos le bajaría el objetivo por un dato vacío —le regalaría horas extra— además
de dejarle el umbral FAS bajo.

`€ por hora extra` vale **7, no 9**. El AppScript original traía 9, pero sus fórmulas leían
la celda de configuración, y la celda real de mayo y junio tenía 7. Reproduciendo junio con
7 cuadran las 164 nóminas al céntimo. Si algún día se cambia, se cambia desde el panel.

## De dónde sale cada número

| Dato | Fuente |
|---|---|
| Horas efectivas | `fv_tramo`, situaciones efectivas (viaje + espera), **día natural**, solapes fundidos |
| Nocturnas | El trozo de esas horas entre las 22:00 y las 06:00 (hora de Madrid) |
| Utilización | viaje ÷ (viaje + espera) — el `has_order` de BOLT sobre el tiempo conectado. La columna enseña la REAL, antes del recorte |
| Propinas, peajes, facturación neta | `v_ordenes_conductor`, sobre `bolt_order` |
| DNI, jornada, ETT, fecha de alta | `conductor` + `conductor_periodo_empleo` |
| Días justificados | `justificante` (solo las aprobadas), la misma tabla que pinta la bitácora |
| Los dos nombres | `conductor.nombre_bolt` y `conductor.nombre_ss` |
| ETT o plantilla propia | `conductor_periodo_empleo.tipo` |

**Ni una hoja de cálculo ni una llamada a ninguna API.** Antes las horas salían de la hoja
mensual del libro de horas, el DNI y el alta de AGENDA_V2, y la configuración, el snapshot
y los meses cerrados vivían en tres hojas más; encima había una ruta de diagnóstico que
preguntaba a BOLT en caliente. Todo eso está en PostgreSQL.

## La gente que la bitácora no tiene

La bitácora **sella** las horas el día que la jornada cierra y ya no las recalcula, para que
el pasado no se mueva. Consecuencia: a quien se le enlace su cuenta de BOLT más tarde no
aparece allí, aunque sí trabajara.

La nómina no puede permitirse eso — dejaría a alguien sin cobrar 137 horas —, así que
calcula ella y **cuenta a todo el que trabajó**. El panel nombra a quien la bitácora no tiene
en absoluto, que sí conviene saberlo; se arregla resellando el mes
(`POST /bitacora/api/resellar`, del desarrollador).

Eso **no** es la lista de "a quién le bailan las horas entre las dos pantallas": a quien
trabaja de noche le bailan siempre, porque las dos miden ventanas distintas a propósito.

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
