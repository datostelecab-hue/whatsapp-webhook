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

Ni una hoja de cálculo ni una llamada a ninguna API. Todo sale de PostgreSQL — ver [[Google Drive y Sheets|Adiós a las hojas]] y [[Base de datos]]:

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

## Cada justificante vale sus horas (16/10/2026)

Un día con **J aprobada** no es un día sin trabajar: es un día que alguien dio por bueno. De ahí salen dos columnas — **horas justificadas** (lo que cubren las J) y **horas no justificadas** (lo que sigue faltando para el objetivo después de sumar BOLT y las J).

Cada J vale **las horas que se le pusieron al justificarla**, y se **suman** a las de BOLT de ese día. Es el estándar de la [[Bitacora|bitácora]], de la letra y del reporte de horas ([[Promedio de horas]]): la nómina cuenta igual que ellos. Una J aprobada **sin horas** no suma nada, y el panel dice cuántas hay (en septiembre de 2026, 9 de 323).

Camilo, 16/10/2026: *«las J ya tienen valor propio, no todas valen 8, eso era antes cuando el sistema apenas estaba naciendo, ahora que está más completo tenemos las J más exactas»*. Hasta ese día toda J valía la **jornada entera (8 h) topada** por lo que faltara de ese día, porque las horas de la tabla eran un "8" puesto a ojo: en agosto, 114 de 182. En septiembre la media ya es de **5,2 h** y en octubre de **3,8**. El parámetro `horasMetaDia` se queda solo para la columna «Días extra».

Las J **cuentan también para el exceso**: la diferencia contra el objetivo se mide con las justificadas dentro, así que un día justificado no le resta a nadie sus horas extra.

Solo cuentan las **aprobadas**. Las pendientes no (el panel avisa de cuántas hay en la cola) y las rechazadas tampoco.

### Una J en un día de vacaciones, permiso o baja no cuenta (20/10/2026)

**Manda la marca**, como en la bitácora: ese día la bitácora pinta la V, la P o la B, no la J. Camilo, con Juan Manuel Álvarez Akieme: *«Por qué aparece con 16 horas justificadas cuando en la bitácora claramente me sale solo 1 de 8 horas»*.

Akieme tenía dos J de 8 h aprobadas. La del 07/09, con la nota «vacaciones», caía en el primer día de sus vacaciones (del 07/09 al 28/09). La nómina pagaba ese día **dos veces**: como vacaciones (5,84 h) y como J (8 h). Le sobraban 8 h, y su total pasa de 270,48 € a **215,77 €**. Y las de baja tampoco: *«y las de baja que tampoco cuenten»*.

- Las marcas son los estados con `marca_bitacora`: **vacaciones, permiso y baja médica**, los mismos que pinta la bitácora. Lo decide `justificantesDelMes`, así que vale igual en las variables, en la base, en el día a día y en el parte de la ETT.
- Esas J van aparte (`jTapadas`). El panel avisa de cuántas hay; «Cómo sale su total» dice cuál no ha contado: *«+ 8,0 de J (sin la J del 07/09, de vacaciones)»*; y el día a día lo apunta en su nota.
- En septiembre de 2026 eran **8 J (45 h)**, 6 en plantilla propia y 2 de la ETT. A la ETT se le dejan de facturar las 8 h de Joselyn Quishpe del 10/09, de baja («urgencias»): **121,60 €**.
- Si una J así era buena (alguien trabajó parte del día antes de irse de baja), lo que hay que corregir es la marca o la fecha de la baja, no la J.

## Las vacaciones y los permisos cuentan para el objetivo (16/10/2026)

Camilo: *«las vacaciones cuentan, pero como día natural porque coge también días de libranza y así está bien, entonces cada día de vacaciones se calculan como el 73 % de 8 horas para hacer la regla de 3 y así les suba las horas para alcanzar el target»*. Y los permisos retribuidos, *«8 horas puras»* también para el objetivo.

- Cada día de **vacaciones** suma `horasMetaDia × pctDiaVacaciones` = 8 × 0,73 = **5,84 h**, por **día natural** (libranzas incluidas: por eso el 73 %).
- Cada día de **permiso retribuido** suma `horasMetaDia` = **8 h**.
- Solo los de su ventana: desde el arranque del mes (su alta, si entró ese mes) y hasta su baja.
- Salen de los tramos de estado del conductor (`conductor_estado_hist`, estados `vacaciones` y `permiso`, los mismos que lee [[Vacaciones]]), recortados al mes; un tramo abierto llega hasta el final. Si dos tramos se pisan, el día cuenta una vez (gana el permiso). **No suman** `suspendido`, `suspension_permiso` (sin sueldo) ni la baja médica (la paga la mutua).
- Entran en la **diferencia** igual que las J, y con ella en el MBO por horas extra. También entra quien no rodó nada pero estuvo de vacaciones o de permiso.
- La pantalla lo enseña en la columna **«Vac./perm.»**; el Excel, en «Horas de vacaciones» y «Horas de permiso», y en el resumen por conductor.

Medido al cambiarlo, con la nómina de octubre (trabajo de septiembre): **27 personas con 276 días de vacaciones (1.606 h)** y 3 con permisos (64 h); las variables pasan de 17.854 € a **18.943 €**.

## La hora extra se paga por conducir, no por estar conectado

Las horas efectivas son viaje + espera, así que quien pasa el mes con la app abierta y poca carrera acumula horas igual que quien no para. El caso que lo destapó: 211,4 h en el mes y 35,4 de exceso sobre el objetivo… con un **52,7 % de utilización**. De sus 211 horas, 100 fueron espera.

Así que hay **dos listones**, los dos editables desde el panel (16/10/2026, Camilo: *«a los que tengan 75 % de utilización o más no les quitaremos horas, pero los que no lleguen ni a 75 % se les exige hasta el 85 %»*):

- quien llega al **75 %** (`utilUmbral`) no pierde ninguna hora;
- a quien no llega se le exige el **85 %** (`utilExigida`): se le quitan horas **de espera** —nunca de viaje— hasta dejarlo exactamente ahí, y eso sale en su propia columna.

```
utilización = viaje ÷ (viaje + espera)
X           = (viaje + espera) − viaje ÷ exigida        (solo si utilización < umbral)
```

Quedarse corto sale más caro a propósito: el 74 % no se lleva al 75, se lleva al 85. Hasta ese día había un solo listón del 65 %, y quien no llegaba se quedaba en el 65.

Dos propiedades que lo hacen seguro: **X nunca pasa de la espera que esa persona tuvo** —`X ≤ espera` equivale a `viaje ≤ viaje ÷ exigida`, cierto siempre que la exigida sea menor que 1—, y **después del recorte quedan exactamente en la exigida**. La única excepción es quien no hizo **ningún** viaje: 0 dividido entre lo que sea es 0 %, así que el límite es quitarle toda la espera, y es lo que se hace. Con una config al revés (umbral por encima de la exigida) no se quita nada.

Medido al cambiarlo, con la nómina de octubre de 2026 (trabajo de septiembre, plantilla propia): **38 de 145** no llegan al 75 %, se les quitan **835,8 h** de espera, y con los dos cambios juntos (este y las J con sus horas) el total baja **334 €** (de 18.188 a 17.854): a 21 personas les cambia, 9 bajan y 12 suben. Baja poco porque la mayoría de los recortados ya estaban por debajo de su objetivo. Con agosto, un mes de utilización mucho más baja (126 de 165 por debajo del 75 %), la bajada habría sido de 4.724 €.

La columna de **% utilización** sigue enseñando la **real**, la de antes del recorte: es el diagnóstico, y esconderla dejaría la cifra retirada sin explicación.

## La fórmula

```
objetivo de horas = objetivo de SU jornada × (días desde el arranque ÷ días del mes)
                    40 h → 172      32 h → 172 × 32/40 = 137,6
horas quitadas    = (viaje + espera) − viaje ÷ exigida (85 %)   (0 si llega al umbral, 75 %)
diferencia        = (horas rodadas − horas quitadas + horas justificadas) − objetivo
MBO horas extra   = diferencia × € hora extra × utilización   (solo si la diferencia es positiva)
MBO FAS           = (facturación neta − umbral) × % MBO FAS    (solo si supera el umbral de SU jornada)
nocturnas         = € hora nocturna × horas nocturnas × factor

TOTAL = nocturnas + peajes + propinas + el MAYOR de los dos MBO
```

**Los dos MBO no se suman**: se cobra el que salga más alto. Por eso hay filas con "MBO horas extra" y compensación a cero — ese mes ganó el FAS.

**El objetivo sale de su jornada**, por regla de tres sobre el de 40 h. Quien no tenga jornada anotada cuenta como 40, y no es pereza: es la de casi todos, y suponer menos le bajaría el objetivo por un dato vacío —le regalaría horas extra— además de dejarle el umbral FAS bajo.

`€ por hora extra` valía **7, no 9**: el AppScript original traía 9, pero sus fórmulas leían la celda de configuración, y la celda real de mayo y junio tenía 7 (reproduciendo junio con 7 cuadran las 164 nóminas al céntimo). El 16/10/2026 se guardó **8,16** desde el panel, y la **hora nocturna a 9,9 €** (antes 8,16): con el factor 0,1, cada hora nocturna suma **0,99 €**.

Los dos MBO —el de horas extra y el FAS— **no cambiaron de fórmula** el 16/10/2026; lo que cambió es lo que entra en la diferencia (las J con sus horas y el recorte con los dos listones).

> `calcularFila` es la cadena del AppScript original, intacta. Cambiar algo ahí cambia lo que cobra la gente: no se toca sin rehacer la comprobación contra un mes ya pagado.

## Qué es configurable

Todo lo numérico se edita desde el panel y se guarda en `nomina_config`. Los valores por defecto están en `DEFAULTS` (`modules/Nominas/nominas.service.js`) y el orden y las etiquetas en `CONFIG_CAMPOS`; cada campo lleva `usado`, que dice si afecta al total o es solo informativo.

| Clave | Qué es | ¿Entra en el total? |
|---|---|---|
| `horasMetaMes40` | el objetivo del mes con jornada de 40 h (172) | sí |
| `eurHoraExtra` | € por hora extra (8,16 desde el 16/10/2026) | sí |
| `utilUmbral` | utilización con la que no se quitan horas (0,75) | sí |
| `utilExigida` | utilización que se exige a quien no llega (0,85) | sí |
| `umbralFAS40` / `umbralFAS32` | neto a partir del cual hay MBO FAS, por jornada: 4.750 y 3.750 (el de 32 h era 4.750 hasta el 19/10/2026). Las demás jornadas, el de 40 h (`umbralDe`). Es también el objetivo que ve el conductor en su [[Portal de conductores\|portal]] | sí |
| `pctMBOFAS` | fracción del exceso de facturación (0,4) | sí |
| `eurHoraNoc`, `factorNoc` | € hora nocturna (9,9) y su multiplicador (0,1) | sí |
| `horasMetaDia` | lo que vale un día de permiso retribuido (8), la base del de vacaciones, y cuántas horas hacen un «día extra» | sí |
| `pctDiaVacaciones` | lo que vale un día de vacaciones de un día de permiso (0,73 → 5,84 h) | sí |
| `eurHoraBase` | € por hora de la [[#La nómina base (16/10/2026)\|nómina base]] (8,16) | sí (la base) |
| `sueldoBase40` / `sueldoBase32` | el **tope** de la base con 40 h (1.443) y con 32 h (1.154); otra jornada, el de 40 por regla de tres. Hasta el 16/10/2026 eran informativos | sí (la base) |
| `ettEurHora`, `ettPlusNocturno` | los dos precios del parte de la agencia | no (van al Excel de la ETT) |

Lo que llega del navegador se filtra: **solo claves conocidas y numéricas**, tanto al guardar como al simular. Un cálculo de dinero no se hace con lo que venga en un cuerpo de petición sin mirarlo.

Y lo que se **lee** de `nomina_config` también: siguen guardadas claves retiradas (`diasObjetivo`, `utilMinima`, `lUtilizacion`), y `leerConfig` solo deja pasar las de `DEFAULTS`, para que una nómina congelada no diga que se calculó con ellas.

## La nómina base (16/10/2026)

La nómina de un mes = **SALARIO BASE BRUTO + las variables**. Camilo: *«El salario base ya no vale, ahora será la hora base que en estos momentos la pagamos a 8,16 euros por hora»*.

| | Periodo | La de octubre |
|---|---|---|
| **Salario base bruto** | mes CORRIENTE, con **corte el 26**: del 26 del mes anterior al 25 de este | del 26/09 al 25/10 |
| **Variables** (lo de arriba) | mes VENCIDO: el mes anterior, del 1 al último | del 01/09 al 30/09 |

Mientras el periodo de la base no ha cerrado, va **hasta ayer** (hoy aún no ha terminado): el 16/10, del 26/09 al 15/10, 20 de 30 días.

```
horas base  = viaje + espera − espera quitada (el mismo recorte 75/85, sobre el periodo de la base)
              + horas de las J aprobadas + vacaciones × 5,84 + permisos × 8
importe     = horas base × € hora base (8,16)        ← con las horas a dos decimales, como se ven
BASE BRUTA  = el importe, con TOPE en el salario base de su jornada
              (40 h → 1.443 €, 32 h → 1.154 €; otra, por regla de tres),
              prorrateado por los días de contrato del periodo
TOTAL NÓMINA = base bruta + TOTAL de las variables
```

**El tope**, en palabras de Camilo: *«si se pasa de ahí significa que tiene su salario base asegurado, lo que se pasó se paga en las variables de MBO o FAS o de horas. Si no llegan significa que, a parte de que se va a descontar de una vez, solo tendrán variables de propinas, peajes, etc.»*. Así la base nunca paga horas de más: eso es cosa del MBO, que **no cambia de fórmula** (diferencia × € hora extra × utilización, o el FAS si es mayor).

- El tope se prorratea por los **días de contrato del periodo entero**: quien entra el día 6 de octubre tiene 20 de 30 días; quien se fue el 2, 7. Mientras el periodo está en curso el tope sigue siendo el del periodo entero, así que casi nadie llega todavía: es la base «hasta el momento».
- Entra quien tiene contrato de **plantilla propia** en el periodo hasta ahora, y quien tiene variables ese mes aunque ya se haya ido antes del 26 (base 0, cobra sus variables). Los de ETT no: los paga la agencia.
- Las variables son las de la pantalla, **la congelada si la hay**. La base **no se congela** todavía: se calcula al bajar el Excel.
- Las horas de BOLT del periodo cuentan todas, aunque caigan en un día sin contrato (un cambio de ETT a propia a mitad de periodo es el caso raro que podría colarse).

**Dónde se ve**: en el Excel de la nómina, la pestaña **«Nómina base»**, segunda, de mayor a menor TOTAL NÓMINA, con los grupos «Horas de la base», «Salario base» y «Nómina», y una nota por persona («Llega al tope: 68,48 € de más, que se cobran por las variables», «Le faltan 142,38 € para el tope», «Tope de 7 de 30 días (baja el 02/10/2026)»). La pantalla avisa de que está ahí. En el servicio: `nominaBase(mes, ano, { variables })`, con `ventanaBase` y `filaBase` puras y probadas en `scripts/comprobar-nomina.js`.

El 16/10/2026, con lo trabajado hasta el 15/10: 176 personas (26 solo con variables), 3 ya en el tope, y la nómina entera de octubre va por **101.484 €** (82.542 de base + 18.943 de variables).

**Lo congelado**: la fila guarda también los días y las horas de vacaciones y permisos desde `db/207` (y la facturación neta desde `db/206`, ya aplicada). Sin aplicar, se congela y se lee como antes (el repositorio mira qué columnas existen). Ensayado en copias temporales: sin la 207 y con ella, 146 filas iguales al céntimo.

## Los de ETT van en su parte, no en la nómina

A quien viene por agencia lo contrata ella y es ella quien le paga: no le debemos horas extra ni participación en la facturación, así que a esas filas se les pone a **cero** todo el MBO —el de horas y el FAS— y con él los días extra. Nocturnidad, propinas y peajes sí son suyas, se las pague quien se las pague.

**No salen en la nómina** desde el 16/10/2026 (Camilo: *«No necesito ver en ese listado a los de la ETT ya que lo descargo por el excel»*). `calcular` los sigue calculando con todos —el parte sale de esas mismas filas, y así no hay dos cuentas que algún día se separen— pero los devuelve aparte, en `filasETT`. La lista, sus totales, el Excel de la nómina y lo que se congela son **solo de plantilla propia**; la pantalla ya no tiene columna «Tipo» ni filtro Propia/ETT. El finiquito y las Extras de una persona de ETT buscan su fila en `filasETT`.

Para pasárselas a la agencia está el **parte de trabajo** (`GET /nominas/ett.xlsx`), que no es una nómina: es **lo que le costamos**, con el formato que ella ya usa y una única columna añadida, la fecha de baja. Las tres cuentas que la agencia repasa:

```
€/Total                = HORAS × €/h
Total Plus Nocturnidad = Horas Nocturnas × Plus Nocturnidad   (€ POR HORA, no un porcentaje)
Total coste trabajador = €/Total + Total Plus Nocturnidad
```

El plus nocturno de la agencia es **€ por hora** y no se parece en nada al de la nómina de casa (`€ hora × horas × factor`): mezclarlos sería facturar mal.

Las **horas llevan el recorte por utilización**, igual que las de casa — es la misma hora y vale lo mismo, la cobre quien la cobre —, y por eso el fichero lleva una segunda pestaña, **"Horas descontadas"**: a quién, cuánto, con qué utilización y cuánto supone en euros. Un descuento sin su argumento al lado es un número que la agencia no puede comprobar.

La **fecha de baja** solo sale cuando cae dentro del mes pedido. Y ese Excel va por **mes trabajado**, no a mes vencido: se elige agosto y salen los datos de agosto. La nómina va a mes vencido porque es un pago; un parte de trabajo lleva el mes que dice. Por eso tiene su propio selector en la pantalla.

## Todos los del mes, y quien pasa de la ETT a propia (30/10/2026)

Camilo: *«Deisy, fue dada de baja en la ETT para ser parte de nosotros, en ese caso debe de aparecer dos veces en la nómina. Una en donde se vea en plantilla propia y otra en la plantilla de la ETT de este mes pero como "Baja el xxxx". Y sin importar si tienen horas o no, que salgan todos los del mes, ya que me hacen falta por ejemplo Hassan Nouri de baja el 1 pero sin horas»*.

**Sale todo el que tuvo contrato algún día del mes**, aunque sea con 0 horas: en la nómina si el contrato era de propia y en el parte de la ETT si era de la agencia, con su «Fecha baja» si se fue ese mes. Los contratos salen de `conductor_periodo_empleo` (`periodosDelMes`). Antes solo entraba quien tenía horas, J aprobadas o vacaciones y permisos: en la nómina de octubre (trabajo de septiembre) eran 56 personas más, todas a cero.

**Quien cambia de la ETT a propia (o al revés) dentro del mes va dos veces**, una fila en cada sitio, y cada una con **sus días** (`partesDelMes` en el servicio):

- cada día va al contrato que lo cubre; con dos el mismo día, al que empezó más tarde; un día sin contrato, al de la ficha (el del final del mes);
- de cada parte salen solo sus horas, sus J, sus vacaciones y permisos y su dinero (este, día a día con `dineroPorDia`, porque el del mes viene sumado);
- la de la ETT lleva el alta de su primer contrato de la agencia y la baja del último, así que sale en el parte con «Fecha baja»; la propia lleva su alta, y **su objetivo se prorratea desde ella**;
- quien tiene un solo tipo de contrato en el mes (casi todos) sale exactamente igual que antes: una parte con todos los días.

**Lo que cambia en dinero**: hasta ahora la persona era una sola fila con el contrato del final del mes, así que **las horas que hizo para la agencia contaban para nuestro MBO**, contra un objetivo prorrateado desde su alta en propia. Ya no: esas horas van al parte de la ETT (se le facturan a la agencia) y el MBO de propia sale solo de lo que hizo con nosotros. Medido en la copia del 27/10 con octubre (aún sin cerrar): son **9 personas**, y las variables de propia de esas 9 bajan unos **1.450 €** (la que más, de 390,52 € a 43,90 €), mientras su parte de la ETT gana esas horas. Las nóminas de septiembre y octubre (trabajo de agosto y septiembre) salieron idénticas fila a fila: allí nadie cambió de tipo dentro del mes.

**En el finiquito y las Extras** de alguien así va el mes entero: las dos filas sumadas (`unirFilas`), con el objetivo y la diferencia de la parte propia, que es la única con MBO. Así cuadra con la suma de sus días.

**La base no cambia**: sigue contando todas las horas del periodo del 26 al 25 (ver arriba, «un cambio de ETT a propia a mitad de periodo es el caso raro que podría colarse»). En octubre de 2026 los nueve cambios caen antes del 26 y no tocan la base de noviembre.

## El diseño de los Excel (16/10/2026)

Los tres libros del módulo —la nómina, el parte de la ETT y el de una persona (finiquito o Extras)— salen con el **diseño de la casa** de `services/excelEstilo.js`: la banda oscura con el logo, la cabecera de tabla oscura, bordes finos, el pie con los totales en fórmula, el panel congelado y el filtro. Desde el 16/10/2026, además:

- la cabecera de tabla **parte los títulos largos en dos líneas** (`cabeceraTabla(…, { alto: 32, ajustar: true })`; sin opciones sale como siempre, así que los demás Excel del ERP no cambian);
- se imprimen **apaisados y a lo ancho de una hoja**, y el nombre queda fijo al desplazarse a la derecha;
- en la nómina los importes van en **formato de contabilidad** (un cero sale «- €») y los tonos dicen algo: **ámbar** para la espera quitada y la utilización por debajo del 75 %, **rojo** para las horas no justificadas, y el **oro** solo en el TOTAL, que es lo que se paga;
- la hoja **«Cómo se calculó»** son ahora tres tablas —los parámetros con su valor, cómo sale cada columna y de dónde salen los datos— en vez de un texto alineado a espacios, que en una letra proporcional nunca quedaba alineado. Se escribe con la config del mes, así que dice 75 %, 85 % y 0,99 € la hora nocturna con los valores de ese momento.

El parte de la ETT conserva **sus columnas**, que son las de la agencia; solo cambia la presentación y las notas (las J con sus horas y los dos listones de utilización).

### La pestaña «Resumen por conductor» (16/10/2026)

Camilo: *«Hazme una pestaña con el resumen del cálculo por cada conductor con su total»*. Va entre «Nómina» y «Cómo se calculó», una fila por persona **de mayor a menor total** (con el mismo total, por nombre), con las columnas **en el orden en que se calcula**, agrupadas encima:

| Grupo | Columnas |
|---|---|
| HORAS | rodadas · − espera quitada · + justificadas · = cuentan · objetivo · diferencia · utilización |
| MBO (SE COBRA EL MAYOR) | por horas extra · facturación neta · umbral FAS de su jornada · FAS · cuál gana |
| LO QUE COBRA | MBO · nocturnidad · propinas · peajes · **TOTAL** |

Y al final, **«Cómo sale su total»**, la cuenta escrita en palabras con la config del mes: *«211,4 h rodadas − 40,2 de espera (utilización 62,4 %, por debajo del 75 %: se le exige el 85 %) + 16,0 de J = 187,2 h contra 172,0 h de objetivo: +15,2 h. Horas extra: 15,2 h × 8,16 € × 62,4 % = 77,40 €. FAS: (6.200,00 − 4.750,00) × 40 % = 580,00 €. Se paga el FAS, que es el mayor. Total: 580,00 MBO + 12,30 nocturnidad + 5,00 propinas = 597,30 €.»* Es la que se abre cuando alguien pregunta por qué ha cobrado lo que ha cobrado.

Los números son los de la fila de la nómina, **no fórmulas**: la nómina redondea cada pieza a céntimos, y una fórmula sobre las piezas redondeadas podría diferir en un céntimo del TOTAL de la otra hoja.

**La facturación neta se guarda al congelar** desde `db/206` (columna `nomina_fila.neto`): antes solo se guardaba el FAS ya calculado, y de un mes cerrado solo se habría podido decir «no llegó al umbral». Sin la migración aplicada se congela y se lee como antes (el repositorio mira si la columna existe, por el `search_path`), y el resumen de esas filas da el FAS sin la facturación. Ensayado sobre copias temporales en las dos pasadas, sin la columna y con ella: 145 filas congeladas y leídas iguales, al céntimo.

`scripts/comprobar-nomina.js` (43 casos, sin base de datos) comprueba las reglas del 16/10/2026: las J con sus horas, los dos listones, la ETT aparte y que la config con claves retiradas no se cuele; la base; y, desde el 30/10/2026, los que pasan de la ETT a propia y los que no hicieron ni una hora.

## Los dos nombres del Excel

La misma persona se llama de dos maneras y el fichero lo leen dos mundos distintos, así que van las dos columnas juntas: el **ID de BOLT** (`Muhammad Bilal Ashraf`) para cruzar con cualquier informe de BOLT, que es por donde lo busca Tráfico, y el **nombre de la Seguridad Social** (`ASHRAF MUHAMMAD, BILAL`), que es lo que entiende la gestoría y lo que va en un documento oficial.

El de la SS sale de `conductor.nombre_ss` si RRHH lo tiene escrito, y si no se compone como `APELLIDOS, NOMBRES`. **Lo que no se hace es adivinar**: a 63 de las 239 personas de agosto la ficha no les separa apellidos de nombres, y alguno va en el orden contrario. Partirlo a ojo cambiaría el nombre legal de alguien en un papel que va a la gestoría, así que se deja tal cual y el panel dice cuántos son.

## Las extras de quien se va

Quien causa baja a mitad de mes deja **dos** nóminas variables sin pagar: la del mes anterior —que se habría pagado el mes de la baja— y la del propio mes de la baja, que ya no llega por el camino normal. En la ficha de alguien de baja hay un botón **«Extras pendientes»** que baja el Excel con los dos meses (`GET /nominas/finiquito.xlsx?conductor=…`).

No recalcula nada: pide los dos meses al **mismo `calcular`** que pinta la pantalla y coge su fila. Un finiquito que saliera de otra cuenta acabaría diciendo algo distinto de la nómina.

### Día a día (06/10/2026)

Camilo lo pidió *«desglosado por días: día a día del mes pasado y el cursante, cuánto hizo de nocturnidad, de peajes, propinas…»*. El Excel lleva ahora, además del resumen, **una pestaña por mes** («Día a día · Septiembre 2026») con una fila por día del mes:

| Columna | De dónde sale |
|---|---|
| Horas rodadas, en viaje, esperando | los tramos efectivos de BOLT del día natural, con los solapes fundidos |
| Horas justificadas (J) | las horas de la J aprobada, encima de lo rodado; solo desde el día en que arranca su mes |
| Horas nocturnas y Nocturnidad | el trozo de 22:00 a 06:00 de esas horas, y × € hora × factor |
| Propinas, Peajes, Facturación neta | `v_ordenes_conductor` del día |
| Extras del día | nocturnidad + propinas + peajes |
| Nota | día de la baja, de baja, J aprobada, J pendiente (no cuenta)… |

**Los días salen de las mismas consultas que la nómina**, pedidas solo para esa persona (`horasDelMes`, `justificantesDelMes` con `conductorId`, y `dineroPorDia`). Los totales del mes son la suma de los días, así que el desglose no puede contradecir a la nómina. Por eso debajo del total va la fila **«Según la nómina»**, con la fila de ese mes: tienen que coincidir. Se comprobó con seis bajas reales (agosto, septiembre y octubre): todas cuadran al céntimo. La nómina entera de agosto y septiembre (485 filas) salió idéntica antes y después del cambio.

**El mismo libro para quien sigue de alta**: el botón **«Extras»** de la ficha ([[Conductores#Extras (06/10/2026)]]) pide uno o varios meses, de julio de 2026 al mes en curso (`mesesDeExtras`), y baja `GET /nominas/extras.xlsx?conductor=…&meses=AAAA-MM,…`. El finiquito y las extras comparten `mesesDeTrabajo` en el servicio y `libroDeMeses` en el Excel: solo cambian el título, el total y los avisos. Un mes fuera de ese rango se rechaza con su motivo: lo de antes de julio no está en la base y saldría a cero, que no es lo mismo que «no hizo nada».

**Lo que no se reparte por días**, porque se decide con el mes entero, va aparte con su porqué: el **MBO** (horas del mes contra el objetivo, o facturación contra el umbral) y las **horas de espera descontadas** por baja utilización (la utilización es la del mes).

> [!bug] Dos cosas mal en el resumen, corregidas el mismo día
> - La línea **«MBO (el mayor de horas extra y facturación)»** enseñaba `compensacion`, que es solo lo que puso el MBO de **horas extra**: cuando ganaba el de facturación salía 0, aunque el total sí lo sumaba. Ahora enseña el mayor de los dos.
> - **«Horas rodadas (… ya descontada la baja utilización)»** no estaba descontada: `fila.horas` es lo rodado tal cual. La etiqueta ya no lo dice, y el descuento va en su propia línea.

> **El objetivo de horas no se prorratea por la baja, y así se queda.** Se prorratea desde el alta, pero no *hasta* la baja: a quien se va el día 11 se le pide el objetivo del mes entero y su diferencia sale muy negativa, así que no cobra MBO por horas extra. El Excel lo dice en sus notas y enseña los días que de verdad estuvo de alta.
>
> **Decidido el 18/09/2026:** no se prorratea. Lo que se paga al que se va son sus **horas**, que se calculan aparte y se cobran enteras; el objetivo mensual es otra cosa y no se toca. → «Extras pendientes» en [[Conductores]].

## Congelar

Una nómina congelada guarda **los números**, no una forma de recalcularlos, y guarda al lado la configuración con la que se hicieron. A partir de ahí no cambia pase lo que pase con los datos: **es lo que se pagó**, y un mes cerrado tiene que poder explicarse solo.

No hay "snapshot de datos crudos" como en las hojas: allí hacía falta porque volver a bajar el mes de BOLT tardaba minutos; aquí recalcular es una consulta.

**Descongelar** borra la nómina guardada y devuelve el mes al cálculo en vivo. Es del desarrollador, mismo candado que las migraciones: si el mes ya se pagó, los números pueden salir distintos.
