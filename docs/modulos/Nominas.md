---
tags: [modulo, nominas, rrhh, horas, bolt, ett]
aliases: [Nóminas, Compensación variable, MBO]
---

# Nóminas

La **compensación variable** del mes: lo que se suma al recibo por encima del sueldo base — nocturnas, propinas, peajes y el MBO (por horas extra o por facturación). Vive en `modules/Nominas/` y se ve en `/nominas`.

**No es la nómina entera**: el sueldo base lo lleva la gestoría. Aquí sale la parte que depende de lo que cada uno hizo ese mes, y que antes se calculaba a mano en un Excel con AppScript.

```
nominas.controller.js   HTTP. No decide nada.
nominas.service.js      el cálculo y el prorrateo. Aquí está lo que cobra la gente.
nominas.repo.js         SQL y nada más.
nominas.excel.js        los ficheros para la gestoría y para la agencia.
vistas/nominas.ejs      la pantalla.
```

Tablas: `nomina_config`, `nomina_mes`, `nomina_fila` (`db/108`). Desde fuera se entra por `nominas.service`, nunca por el repo — ver [[Reglas de la casa]].

## Las rutas

| | |
|---|---|
| `GET /nominas/cargar` | el mes: lo congelado, o el cálculo en vivo |
| `POST /nominas/calcular` | simular con otras tarifas, **sin guardarlas** |
| `GET/POST /nominas/config` | las tarifas y parámetros |
| `POST /nominas/congelar` | cerrar el mes |
| `POST /nominas/descongelar` | reabrirlo — **solo el desarrollador** |
| `GET /nominas/congeladas` | qué meses están cerrados |
| `GET /nominas/nomina.xlsx` | el Excel de la nómina (mes de **pago**) |
| `GET /nominas/ett.xlsx` | el parte de trabajo de la agencia (mes **trabajado**) |

Desaparecieron `POST /generar` y `GET /estado`: existían porque bajar el mes de [[BOLT]] tardaba minutos y había que sondear una barra de progreso. Ahora calcular es una consulta a PostgreSQL. Y desapareció `GET /diagnostico`, que llamaba a la API de BOLT en caliente desde una ruta: sin hoja de por medio no hay descuadre que perseguir, y **una pantalla no debe depender de una API ajena**.

## De dónde salen las horas

Ni una hoja de cálculo ni una llamada a ninguna API. Todo sale de PostgreSQL — ver [[Adiós a las hojas]] y [[Base de datos]]:

| Dato | Fuente |
|---|---|
| Horas efectivas | `fv_tramo`, situaciones **efectivas** (viaje + espera), **día natural**, solapes fundidos |
| Nocturnas | el trozo de esas horas entre las 22:00 y las 06:00 (hora de Madrid) |
| Utilización | viaje ÷ (viaje + espera) — el `has_order` de BOLT sobre el tiempo conectado |
| Propinas, peajes, facturación neta | `v_ordenes_conductor`, sobre `bolt_order` |
| DNI, jornada, ETT, **fecha de alta** | `conductor` + `conductor_periodo_empleo` |
| Días justificados | `justificante`, **solo las aprobadas** (la misma tabla que pinta la bitácora) |
| Los dos nombres | `conductor.nombre_bolt` y `conductor.nombre_ss` |

## El mes es el mes

**Del día 1 a las 00:00 al último a las 23:59.** Sin la jornada operativa 05→05 del resto del ERP.

La bitácora y el reporte de horas miden por **jornada** (05:00 a 05:00), que es lo correcto para control de turnos: quieren ver la noche entera junta. Una nómina no es eso: **paga lo que pasó en el mes**. Quien rueda la madrugada del 1 de septiembre cobra esas horas en septiembre, aunque para la bitácora sean del turno del 31 de agosto.

Así **horas, dinero y justificantes miran la misma ventana**. Cuando las horas se cortaban a las 05:00 y el dinero a medianoche —que es como agrupa `v_ordenes_conductor`— las dos mitades no cuadraban en el borde del mes: la facturación de la madrugada del 1 de septiembre quedaba fuera de agosto mientras sus horas quedaban dentro, y a dos personas eso les cambiaba si superaban o no el umbral del MBO FAS.

> Las horas de la nómina **no coinciden** con las de la bitácora para quien trabaja de noche, y **no es un fallo**. Son dos preguntas distintas y cada una tiene su ventana.

Además, la bitácora **sella** las horas cuando la jornada cierra y no las recalcula, así que a quien se le enlace su cuenta de BOLT más tarde no aparece allí. La nómina no puede permitirse eso —dejaría a alguien sin cobrar 137 horas—, así que calcula ella y **cuenta a todo el que trabajó**; el panel nombra a quien la bitácora no tiene, que se arregla resellando el mes.

## A mes vencido, y el prorrateo desde la fecha de alta

La nómina de un mes se calcula con los datos del mes **anterior**: la de julio paga el trabajo de junio; la de enero, el de diciembre del año pasado. El mes que se elige en la pantalla es el del **pago**, y la cabecera dice siempre de qué mes son los datos (`mesVencido` en `nominas.service.js`).

**El prorrateo arranca en la fecha de alta**, no en el primer día con horas:

| Su alta | Qué se le pide |
|---|---|
| Anterior al mes de trabajo | el mes completo, sin prorratear |
| Dentro del mes | prorrateado desde su día de alta |
| Posterior al mes | no entra en esa nómina (y si tiene horas, se lista aparte: la fecha está mal) |
| Sin fecha | criterio antiguo —su primer día con horas— y se marca en el panel |

Con el criterio viejo, a un veterano que libraba la primera quincena se le partía el objetivo por la mitad y le bastaba media jornada para "hacer extras". El cuarto caso era el frecuente cuando la fecha venía de la columna G de una hoja escrita a mano; ahora sale de `conductor_periodo_empleo.alta`, que la tiene el 100 % de la plantilla.

## Los justificantes valen el día entero, pero topados

Un día con **J aprobada** no es un día sin trabajar: es un día que alguien dio por bueno. De ahí salen dos columnas — **horas justificadas** (lo que cubren las J) y **horas no justificadas** (lo que sigue faltando para el objetivo después de sumar BOLT y las J).

Cada J vale la **jornada entera** (8 h), sin distinguir tipo ni motivo. La tabla `justificante` tiene una columna de horas, pero no dice nada útil: de las 182 J aprobadas de agosto de 2026, 114 traían un "8" puesto a ojo y otras 13 traían las **mismas** horas que esa persona ya había rodado ese día — sumarlas sería contar dos veces el mismo rato.

Y **topada por lo que falte de ese día**: quien rodó 3 h y tiene J ese día suma 5 justificadas, y el día queda en 8, no en 11. Para los 104 días de agosto en que no se rodó nada, la J vale las 8 enteras.

Las J **cuentan también para el exceso**: quien rodó 205,6 h y tuvo dos días justificados lleva 221,6 contra un objetivo de 176, y su exceso son **45,6 h, no 29,6**. Un día justificado no puede restarle a nadie sus horas extra. Y **no regala horas extra**, justo por el tope: como la J nunca sube un día por encima de la jornada, las justificadas solo pueden llevar a alguien **hasta** su objetivo. Las dos reglas van juntas y separarlas rompe el cálculo.

Solo cuentan las **aprobadas**. Las pendientes no (el panel avisa de cuántas hay en la cola) y las rechazadas tampoco.

## La hora extra se paga por conducir, no por estar conectado

Las horas efectivas son viaje + espera, así que quien pasa el mes con la app abierta y poca carrera acumula horas igual que quien no para. El caso que lo destapó: 211,4 h en el mes y 35,4 de exceso sobre el objetivo… con un **52,7 % de utilización**. De sus 211 horas, 100 fueron espera.

Así que todo el mundo tiene que llegar a una **utilización mínima** (65 %, editable desde el panel). A quien no llega se le quitan horas **de espera** —nunca de viaje— hasta que la alcanza, y eso sale en su propia columna:

```
utilización = viaje ÷ (viaje + espera)
X           = (viaje + espera) − viaje ÷ mínimo
```

Dos propiedades que lo hacen seguro, comprobadas sobre agosto de 2026 (86 personas afectadas, 1.138,9 h retiradas): **X nunca pasa de la espera que esa persona tuvo** —`X ≤ espera` equivale a `viaje ≤ viaje ÷ mínimo`, cierto siempre que el mínimo sea menor que 1—, y **después del recorte todos quedan exactamente en el mínimo**, sin que pierda nada quien ya llegaba. La única excepción es quien no hizo **ningún** viaje: 0 dividido entre lo que sea es 0 %, así que el límite es quitarle toda la espera, y es lo que se hace.

La columna de **% utilización** sigue enseñando la **real**, la de antes del recorte: es el diagnóstico, y esconderla dejaría la cifra retirada sin explicación.

## La fórmula

```
objetivo de horas = objetivo de SU jornada × (días desde el arranque ÷ días del mes)
                    40 h → 172      32 h → 172 × 32/40 = 137,6
horas quitadas    = (viaje + espera) − viaje ÷ utilización mínima   (0 si ya llegaba)
diferencia        = (horas rodadas − horas quitadas + horas justificadas) − objetivo
MBO horas extra   = diferencia × € hora extra × utilización   (solo si la diferencia es positiva)
MBO FAS           = (facturación neta − umbral) × % MBO FAS    (solo si supera el umbral de SU jornada)
nocturnas         = € hora nocturna × horas nocturnas × factor

TOTAL = nocturnas + peajes + propinas + el MAYOR de los dos MBO
```

**Los dos MBO no se suman**: se cobra el que salga más alto. Por eso hay filas con "MBO horas extra" y compensación a cero — ese mes ganó el FAS.

**El objetivo sale de su jornada**, por regla de tres sobre el de 40 h. Quien no tenga jornada anotada cuenta como 40, y no es pereza: es la de casi todos, y suponer menos le bajaría el objetivo por un dato vacío —le regalaría horas extra— además de dejarle el umbral FAS bajo.

`€ por hora extra` vale **7, no 9**. El AppScript original traía 9, pero sus fórmulas leían la celda de configuración, y la celda real de mayo y junio tenía 7: reproduciendo junio con 7 cuadran las 164 nóminas al céntimo.

> `calcularFila` es la cadena del AppScript original, intacta. Cambiar algo ahí cambia lo que cobra la gente: no se toca sin rehacer la comprobación contra un mes ya pagado.

## Qué es configurable

Todo lo numérico se edita desde el panel y se guarda en `nomina_config`. Los valores por defecto están en `DEFAULTS` (`modules/Nominas/nominas.service.js`) y el orden y las etiquetas en `CONFIG_CAMPOS`; cada campo lleva `usado`, que dice si afecta al total o es solo informativo.

| Clave | Qué es | ¿Entra en el total? |
|---|---|---|
| `horasMetaDia` | lo que vale un día: cuánto cubre una J y cuántas horas hacen un "día extra" | sí |
| `horasMetaMes40` | el objetivo del mes con jornada de 40 h (172) | sí |
| `eurHoraExtra` | € por hora extra (7) | sí |
| `utilMinima` | utilización mínima exigida (0,65) | sí |
| `umbralFAS40` / `umbralFAS32` | neto a partir del cual hay MBO FAS, por jornada | sí |
| `pctMBOFAS` | fracción del exceso de facturación (0,4) | sí |
| `eurHoraNoc`, `factorNoc` | € hora nocturna y su multiplicador | sí |
| `sueldoBase40` / `sueldoBase32` | informativos, como en el Excel | no |
| `lUtilizacion` | informativo | no |
| `ettEurHora`, `ettPlusNocturno` | los dos precios del parte de la agencia | no (van al Excel de la ETT) |

Lo que llega del navegador se filtra: **solo claves conocidas y numéricas**, tanto al guardar como al simular. Un cálculo de dinero no se hace con lo que venga en un cuerpo de petición sin mirarlo.

## Los de ETT entran en la nómina, pero no cobran MBO

A quien viene por agencia lo contrata ella y es ella quien le paga: no le debemos horas extra ni participación en la facturación, así que a esas filas se les pone a **cero** todo el MBO —el de horas y el FAS— y con él los días extra.

Pero **sí entran, y con sus variables**: nocturnidad, propinas y peajes son suyas se las pague quien se las pague. Las horas, el objetivo y la diferencia también se les calculan y se enseñan: son una medida, no un pago.

Para pasárselas a la agencia está el **parte de trabajo** (`GET /nominas/ett.xlsx`), que no es una nómina: es **lo que le costamos**, con el formato que ella ya usa y una única columna añadida, la fecha de baja. Las tres cuentas que la agencia repasa:

```
€/Total                = HORAS × €/h
Total Plus Nocturnidad = Horas Nocturnas × Plus Nocturnidad   (€ POR HORA, no un porcentaje)
Total coste trabajador = €/Total + Total Plus Nocturnidad
```

El plus nocturno de la agencia es **€ por hora** y no se parece en nada al de la nómina de casa (`€ hora × horas × factor`): mezclarlos sería facturar mal.

Las **horas llevan el recorte por utilización**, igual que las de casa — es la misma hora y vale lo mismo, la cobre quien la cobre —, y por eso el fichero lleva una segunda pestaña, **"Horas descontadas"**: a quién, cuánto, con qué utilización y cuánto supone en euros. Un descuento sin su argumento al lado es un número que la agencia no puede comprobar.

La **fecha de baja** solo sale cuando cae dentro del mes pedido. Y ese Excel va por **mes trabajado**, no a mes vencido: se elige agosto y salen los datos de agosto. La nómina va a mes vencido porque es un pago; un parte de trabajo lleva el mes que dice. Por eso tiene su propio selector en la pantalla.

## Los dos nombres del Excel

La misma persona se llama de dos maneras y el fichero lo leen dos mundos distintos, así que van las dos columnas juntas: el **ID de BOLT** (`Muhammad Bilal Ashraf`) para cruzar con cualquier informe de BOLT, que es por donde lo busca Tráfico, y el **nombre de la Seguridad Social** (`ASHRAF MUHAMMAD, BILAL`), que es lo que entiende la gestoría y lo que va en un documento oficial.

El de la SS sale de `conductor.nombre_ss` si RRHH lo tiene escrito, y si no se compone como `APELLIDOS, NOMBRES`. **Lo que no se hace es adivinar**: a 63 de las 239 personas de agosto la ficha no les separa apellidos de nombres, y alguno va en el orden contrario. Partirlo a ojo cambiaría el nombre legal de alguien en un papel que va a la gestoría, así que se deja tal cual y el panel dice cuántos son.

## Las extras de quien se va

Quien causa baja a mitad de mes deja **dos** nóminas variables sin pagar: la del mes anterior —que se habría pagado el mes de la baja— y la del propio mes de la baja, que ya no llega por el camino normal. En la ficha de alguien de baja hay un botón **«Extras pendientes»** que baja el Excel con los dos meses (`GET /nominas/finiquito.xlsx?conductor=…`).

No recalcula nada: pide los dos meses al **mismo `calcular`** que pinta la pantalla y coge su fila. Un finiquito que saliera de otra cuenta acabaría diciendo algo distinto de la nómina.

> **El objetivo de horas no se prorratea por la baja, y así se queda.** Se prorratea desde el alta, pero no *hasta* la baja: a quien se va el día 11 se le pide el objetivo del mes entero y su diferencia sale muy negativa, así que no cobra MBO por horas extra. El Excel lo dice en sus notas y enseña los días que de verdad estuvo de alta.
>
> **Decidido el 18/09/2026:** no se prorratea. Lo que se paga al que se va son sus **horas**, que se calculan aparte y se cobran enteras; el objetivo mensual es otra cosa y no se toca. → «Extras pendientes» en [[Conductores]].

## Congelar

Una nómina congelada guarda **los números**, no una forma de recalcularlos, y guarda al lado la configuración con la que se hicieron. A partir de ahí no cambia pase lo que pase con los datos: **es lo que se pagó**, y un mes cerrado tiene que poder explicarse solo.

No hay "snapshot de datos crudos" como en las hojas: allí hacía falta porque volver a bajar el mes de BOLT tardaba minutos; aquí recalcular es una consulta.

**Descongelar** borra la nómina guardada y devuelve el mes al cálculo en vivo. Es del desarrollador, mismo candado que las migraciones: si el mes ya se pagó, los números pueden salir distintos.
