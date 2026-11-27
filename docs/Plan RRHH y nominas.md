---
tags: [plan, rrhh, nominas, gestoria]
actualizado: 2026-11-25
---

# Plan: automatización de RR. HH. y nóminas

El 25/11/2026 llegó un encargo para automatizar RR. HH. y nóminas: la persona que llevaba RR. HH. ha salido y **Diana** asume el puesto. La idea: el ERP prepara y propone, y a Diana le quedan las decisiones y las validaciones. Son nueve módulos, en este orden: **8** (plantilla de la gestoría y altas) → **1** (bajas médicas y ausencias) → **4** (nóminas) → **6 y 9** (firma digital y SMS certificado) → **7, 2, 3 y 5** (finiquitos, vacaciones, sanciones, informe para el SMAC).

Esta nota es el plan: qué hay ya, qué falta, dónde el encargo choca con el ERP de hoy, qué hace falta de fuera y las fases. **Construido** (ver las fases): la fase 0, la primera parte de los módulos 8 y 1, y el módulo 5.

> [!warning] Cómo se hizo el inventario
> Lo leyeron agentes en paralelo (uno por área) y un revisor. Comprobado a mano en el código: el `legajo`, las tarjetas del tablero, las funciones del convenio que nadie llama, los parámetros de RR. HH. y el recuento de legajos. **Lo demás se confirma al empezar cada fase**, con la nota del módulo y el código delante. El área de firma y SMS no devolvió inventario: se sabe que en el repositorio no hay nada de ninguna de las dos.

## Lo más importante, en seis líneas

1. **El «código de la gestoría» ya existe**: es `conductor.legajo` (db/01), único, con la etiqueta «el identificador que usa la gestoría», y es la primera columna del Excel que se le manda. No hace falta un campo nuevo: falta hacerlo obligatorio y **rellenarlo** (a 25/11, de 165 personas de plantilla propia en alta lo tienen 94; de 72 de ETT, 2).
2. **La gestoría solo recibe, nunca se le lee**: el ERP exporta la PLANTILLA, pero no hay ningún importador de lo que ella manda (plantilla en alta, bajas del INSS, proforma, borrador). Es el hueco común a los módulos 8, 1 y 4.
3. **El motor del convenio está a medio enchufar** (db/30 a db/53): contratos, objetivo, registro de jornada y cierre funcionan; **incidencias económicas, liquidaciones, ausencias del convenio y faltas disciplinarias tienen tablas y funciones que ninguna pantalla llama**. Son la base de los módulos 4, 7, 1 y 3, pero hay que cablearlas (o decidir que no se usan).
4. **Las piezas comunes existen**: tarjetas con vencimiento y origen ([[Tablero de tareas]]), tareas programadas, parámetros con historia, calendario de días hábiles con festivos, libro de auditoría, adjuntos con huella sha256, PDF (pdf-lib) y Excel (ExcelJS).
5. **El mayor riesgo técnico es el Excel de nóminas**: hay que escribir valores en el archivo protegido de la gestoría sin tocar nada más, y ExcelJS no garantiza devolverlo intacto. Se resuelve con una prueba sobre el archivo real antes de construir nada del módulo 4.
6. **De firma digital y SMS certificado no hay nada en el código.** Se probó la API de Yousign en sandbox el 20/11 (firma simple con código por SMS); el encargo dice «cualificada»: hay que cerrar el nivel con legal antes de contratar.

## Módulo a módulo

| Módulo | Ya hay | Falta |
| --- | --- | --- |
| **8 · Plantilla gestoría y altas** | `legajo`; periodos de empleo (alta, baja, propia/ETT); baja programada (db/191); «anular el alta»; [[Proximas incorporaciones]]; Excel a la gestoría | Importar el listado semanal y cruzarlo (tres discrepancias); coste estimado de Seguridad Social; correo de correcciones con seguimiento; alta «solicitada» y «confirmada» por la gestoría; bloqueo en el planificador; alerta de no presentación con contador; tarjeta del lunes |
| **1 · Bajas médicas y ausencias** | Situaciones con tramos (`conductor_estado_hist`: baja médica, permiso, vacaciones, suspendido…); tipos de permiso del convenio (art. 22); la ausencia de quien no ficha, calculada al leer; coste del absentismo (db/51, vacío) | Importador del fichero del INSS (formato pendiente); la baja como entidad (prórrogas, alta real, versiones, fichero de origen); ausencia guardada con «pendiente de validar»; bandeja diaria de Diana; reclasificación a IT, también hacia atrás; saldo de permisos por tipo; % de plantilla de baja |
| **4 · Nóminas** | Variable del mes y base por horas ([[Nominas]]); plus de calidad, bonus y garantía (db/46, db/48); periodo con cierre y huella (db/44); incidencia económica con estados (db/50, sin uso); movimiento «nómina» de Recaudación; calendario hábil; parámetros `nomina.*` | Todo el circuito proforma → lienzo → borrador → aprobación; escribir en el Excel de la gestoría sin romperlo; catálogo de conceptos; bruto y coste de empresa; validación del borrador con tolerancia y versiones; rectificaciones; IT precalculada y doble comprobación; calendario del cierre con tarjetas; panel |
| **Descuentos (4.2)** | Recaudación (cobrar, transferencia, cambio); [[Banco de KM]] (en km, sin euros); [[Revision de fotos]] del taller (daños e imágenes no válidas, sin importe); [[Combustible]] auditado | «Aplicar descuento en nómina» por línea y saldar al cerrar; km en euros; siniestro con importe y aprobación de Taller; caso de sustracción de combustible; descuento pendiente con saldo y aplazamiento |
| **6 y 9 · Firma y SMS certificado** | Nada en el código. Sirven de modelo: WhatsApp con estado por mensaje, adjuntos en R2, webhooks de Meta verificados | Entidad de comunicación (canal, plantilla, destinatarios, estado, evidencia); integración con el proveedor de firma y con Mensatec; plantillas; envío masivo con seguimiento; expediente |
| **7 · Finiquitos** | `liquidacion` y sus funciones (db/52-53), **sin pantalla ni llamada**; saldo de vacaciones ([[Vacaciones]]); finiquito de la variable en Excel | La pantalla entera: historial, vacaciones netas, recaudación al 100 %, descuentos y bonus pendientes, aprobación, exportación a la gestoría, firma y aviso |
| **2 · Vacaciones** | Saldo; la petición llega como ticket y se «aplica»; el planificador lo refleja solo; cambiar fechas; una sola persona con la llave de aprobar | La bandeja de decisión con los cuatro datos (letra, saldo, quién está fuera, cobertura); aviso al conductor; alerta de solape con una baja; cupos y fechas bloqueadas |
| **3 · Suspensiones y sanciones** | Situación «suspendido» que el planificador respeta; catálogo de faltas del convenio (art. 39, sin uso); parámetros `sanciones.*` y `cartas.*`; pdf-lib | Ticket o tarjeta de sanción con evidencias; la carta (borrador con IA, plantilla, validación de Diana); envío certificado y acuse |
| **5 · Informe para el SMAC** | Estados de BOLT por conductor (`bolt_state_log`); registro diario de jornada del convenio (db/42), solo en JSON; Excel de horas por día de toda la plantilla | El informe por persona y rango en PDF y Excel, con conexión y desconexión, totales por día, semana y mes y el origen de cada dato |
| **Comunes** | Tablero, tareas programadas, parámetros, calendario, auditoría, adjuntos | Fichero importado genérico (tipo, periodo, huella, estructura, incidencias); tarjeta semanal; aviso de vencidas a Dirección; llaves por tipo de dato (salud, nómina); expediente del conductor; parámetros del encargo |

## Los choques: lo que el encargo dice y el ERP hace de otra manera

Se deciden antes de construir el módulo que tocan.

1. **Código gestoría = `legajo`.** Se reutiliza el campo; no se crea otro. Pendiente: si los ceros a la izquierda cuentan y si la ETT lleva código.
2. **ETT.** El Excel de la gestoría es solo de plantilla propia, a propósito (a la ETT la contrata la agencia). ¿El control semanal y el bloqueo por «alta confirmada» son solo para la propia?
3. **Bloqueo en el planificador.** Hoy se planifica a quien entra en una fecha futura y se reservan plazas a candidatos en proceso. «Nadie se planifica sin alta confirmada» hay que afinarlo: ¿bloquea planificar, o bloquea salir a trabajar ese día?
4. **No presentación.** En el ERP «anular el alta» no es «dar de baja» y exige las horas de BOLT al día. El contador de días cotizados y la alerta van encima de eso.
5. **Quién aprueba qué.** La llave de aprobar vacaciones es de una sola persona (la que se ha ido); las tareas las aprueban hoy tres personas de Tráfico y Dirección; los descuentos de `incidencia_economica` exigen la autorización de Dirección, y el encargo se los da a Diana y a Taller. Hay que fijar la tabla de quién aprueba cada cosa.
6. **Las vencidas avisan a Ignacio.** Hoy avisan al responsable y a sus superiores del organigrama. O Diana cuelga de Ignacio en [[Organizacion]], o se añade una regla fija.
7. **Absentismo.** Hoy la base se paga por horas de BOLT (no se descuenta la ausencia como tal), la ausencia de quien no ficha cuenta en los informes desde que se calcula, y el cuadro de coste mete la IT y los permisos dentro del absentismo. El encargo quiere: nada cuenta sin validar, la IT y los permisos fuera, y los días injustificados reducen el devengo.
8. **Sueldo base.** Desde el 16/10 el ERP calcula la base por horas; el encargo da por hecho que el bruto se arma en el lienzo de la gestoría. Hay que ver con la proforma real qué cifra manda.
9. **Kilómetros.** El [[Banco de KM]] da crédito de km por hora de viaje con un tope diario y no tiene euros; el encargo quiere una franquicia fija al día y un precio por km de exceso. ¿Sustituye a la regla de hoy o es otro concepto?
10. **Taller.** El encargo habla de tres fotos y de «siniestro» con retención; hay cinco fotos revisadas una a una, sin importe. Falta el siniestro con su importe y su aprobación.
11. **Solape de vacaciones y baja.** La base impide dos situaciones el mismo día; el encargo quiere que convivan con una alerta para decidir si se devuelven los días.
12. **Cierre de nómina.** Hay dos cierres (el de /nominas y el del convenio), los dos de un paso. Las cuatro etapas con versiones los sustituyen por uno.
13. **Firma «cualificada».** Lo probado es firma simple con código por SMS. El nivel que exijan finiquitos y sanciones lo dice legal.
14. **Informe para el SMAC.** En el ERP conviven tres definiciones de espera y tres cortes del día, y hay una sospecha de que el registro de jornada de un día arrastre minutos del anterior (sin comprobar). Antes del informe: fijar las definiciones y comprobar el registro contra BOLT.
15. **Descuentos y ley.** La [[Hoja de ruta]] ya avisaba: quitar sueldo como castigo es multa de haber. El descuento por km, por negligencia y por combustible, y el tope sobre el salario, necesitan el visto bueno de legal antes de automatizar nada.
16. **La Hoja de ruta de Ignacio.** Su fase de RR. HH. (ítems 4 a 9) y el siniestro (18) cubren lo mismo con otras personas y otras reglas. Hay que decir si este encargo los sustituye.

## La proforma real de A3NOM (noviembre de 2026)

El 25/11 llegó el primer fichero real de la gestoría: `E07735_…_nom_nov2026.xls`, enviado el lunes 23/11. **Es la plantilla de importación de conceptos de A3NOM**: la proforma y el lienzo del módulo 4. Lo que tiene, visto en Excel en solo lectura:

- **Formato `.xls` antiguo** (binario de Excel 97-2003), no `.xlsx`. Una sola hoja, **«Conceptos»**, **protegida**.
- **Fila 1 oculta** con un código de A3 (con el código de empresa 7735 y la fecha 23/11/2026). Filas 2 a 5: empresa («7735 · TIBUS LUXURY SERVICES SLU»), selección («Todos los trabajadores») y fecha. Hay **11 nombres definidos** que usa A3 (`CodEmpresa`, `CodTrabajador1`, `Concepto1`, `NomTrabajador1`…). **Sin fórmulas ni validaciones**.
- **Fila 8, la cabecera**: `Código` (B), `Nombre` (C) y una columna por concepto, como «066 - PACTO PR (I)». Las columnas C a F están **agrupadas** (el «+» de encima de las letras las pliega y despliega).
- **Filas 9 a 174, 166 trabajadores**: solo plantilla propia, ninguno de ETT. El **código y el nombre están bloqueados**; las celdas de los importes, **desbloqueadas**. Esas son las que se escriben.
- **El «Código» es el legajo** sin los ceros: de los 92 códigos que el ERP ya tenía, 89 son la misma persona.
- **Los 17 conceptos de noviembre** (columnas D a T; de la U a la DK, vacías):

| Col. | Concepto | Con importe | Total |
| --- | --- | --- | --- |
| D | 066 Pacto productividad | 56 | 10.506,52 € |
| E | 753 Descuento efectivo | 12 | 2.774,96 € |
| F | 519 Propinas | 98 | 1.622,00 € |
| G | 059 Dietas | 0 | |
| H | 039 Horas de… | 0 | |
| I | 607 Peaje/parking | 66 | 193,90 € |
| J | 751 Descuento franquicia | 0 | |
| K | 752 Penalización | 0 | |
| L | 754 Descuento | 2 | 133,35 € |
| M | 609 Notas de gasto | 0 | |
| N | 015 Plus de calidad | 0 | |
| O | 012 Festivos | 0 | |
| P | 053 Nocturnidad | 99 | 4.054,00 € |
| Q | 145 Regularización | 4 | −601,16 € |
| R | 790 Descuento absentismo | 0 | |
| S | 008 Plus de actividad | 0 | |
| T | 758 Descuento vehículo | 3 | 789,15 € |

**Lo que cambia en el plan del módulo 4:**
- El **catálogo de conceptos** ya tiene forma: cada concepto es un código de A3 («066», «753»…) y se busca por ese código en la fila 8, no por la letra de la columna (así, si el mes que viene cambian de sitio, se sigue encontrando).
- **El riesgo técnico es el `.xls`**: ExcelJS no lee ni escribe ese formato. Hay que confirmar con la gestoría si A3NOM acepta el mismo fichero en `.xlsx`. Si no, hay que escribir el `.xls` sin rehacerlo (una librería que entienda el formato binario, o tocar solo los registros de las celdas), y comprobarlo celda a celda contra el original.
- Los **legajos**: la proforma trae 74 códigos que el ERP no tiene. 57 casan con nombre y apellidos con gente de plantilla propia en alta sin legajo, y 3 legajos del ERP no corresponden a la persona que dice la gestoría. Se resuelven en la carga inicial, revisando a mano los dudosos. **Hecho en db/286** (Camilo: «Sí, carga los 57 y corrige los 3»): se cargan 55, con la fecha de alta como control (sigue el orden de los códigos), y quedan fuera dos dudosos para revisarlos a mano. Los 3 conflictos se corrigen con lo que dice la gestoría (dos fichas en alta cambian de legajo y dos de baja se quedan sin él). Después quedan unas 16 personas de plantilla propia en alta sin legajo.

## La nómina de noviembre de A3, «sin variables» (25/11/2026)

El 25/11 Camilo pasó la **proforma**: `EXCEL NOVIEMBRE TIBUS LUXURY SL SIN VARIABLES.xlsx`. No es el fichero de arriba: aquel es la **plantilla de importación** (el lienzo, donde se escriben las variables); este es el **resultado de la nómina en A3 antes de las variables**, que la gestoría manda para revisar. Así que el circuito del módulo 4 queda: proforma (esto) → revisión → variables en el lienzo (`.xls`) → borrador → aprobación.

- **`.xlsx`**, dos hojas, sin proteger, sin nombres definidos. Periodo «DEL 01/11/26 AL 30/11/26» (mes natural; las variables van del 26 al 25).
- **Hoja «1»: un trabajador por COLUMNA** (D a FK, 164), no por fila: fila 4 el código (el legajo con sus ceros), filas 5 a 7 apellidos y nombre (cortados a 12 letras), y **filas 1 a 3 con notas a mano** de quien la revisa (49 columnas: «BAJA MEDICA», «RETIRADO», «suspensión empleo y sueldo hasta…», «ALTA ANULADA», «baja voluntaria»…).
- **Un concepto por fila** (B el código de A3, C el nombre): devengos de la 11 a la 28 (1 Salario base, 4 Antigüedad, 49 Plus permanencia, 53 Nocturnidad, 110 Prorrateo de pagas, 145 Regularización, 199 Vacaciones, 376 Plus productividad, Plus de calidad (sin código), 450-455 IT, 465 y 519 Propinas, 605 Abono, 607 Peaje, 790 Descuento por absentismo); fila 30 **TOTAL BRUTO** con fórmula (`SUM(D11:D29)-2*D28`: el 790 resta); deducciones de la 32 a la 46 (embargos, 724, cuota sindical, 751/753/754 descuentos, 791 anticipo, cotizaciones, 999 IRPF); 48 total deducciones, 50 **TOTAL LÍQUIDO**; y de la 52 a la 68 Seguridad Social, coste de empresa, bases, horas de presencia y **días cotizados**.
- **Hoja «2»: el total de la empresa**, sumando cada fila de la «1». **Le faltan las dos filas que se metieron a mano** (376 Plus productividad, 11.166,73 €, y Plus de calidad, 150 €): a partir de ahí sus filas van dos por debajo. Los totales siguen bien: bruto 219.246,28 €, líquido 195.407,65 €, coste de empresa 265.460,88 €.

**Cruzada con el ERP** (solo lectura, 25/11), lo que no cuadra: 23 códigos que ninguna ficha tiene (13 son de fichas sin legajo, 5 con otro legajo en el ERP, 5 sin encontrar o dudosos); 9 personas a las que la nómina paga noviembre sin contrato propio en el ERP; 10 bajas médicas del ERP que la nómina no recoge; 4 suspensiones que no cuadran (en un lado y no en el otro); 12 personas cuyos días cotizados no son sus días de contrato; y 43 de plantilla propia del ERP en noviembre que no están en la nómina (la mayoría, altas del 18/11 en adelante: los legajos de la nómina acaban en el 002716). El detalle, con nombres, se le pasó a RR. HH. en un Excel (no va al repositorio).

Esto es justo la **validación** que el módulo 4 tiene que hacer sola: subir la proforma y que el ERP diga estas seis cosas. **Hecho el 26/11 (db/296)**: pestaña «Proforma» en [[Gestoria]].

## Lo que hace falta de fuera

**Archivos reales** (anonimizados si hace falta):
- el listado de plantilla en alta de la gestoría (o el ITA) de una semana;
- un fichero de bajas del INSS tal como lo manda la gestoría, cuando haya uno;
- del cierre de noviembre: la proforma, el lienzo que se cerró a mano y los borradores, con sus rectificaciones;
- los códigos de empleado de quien no lo tiene puesto;
- los artículos de faltas y sanciones del convenio y las cartas que se usan hoy;
- cómo se le pasa hoy un finiquito a la gestoría.

**Decisiones de la empresa**: los choques de arriba, y además la tolerancia de validación, cómo se estima el coste diario de Seguridad Social, las tablas de IT de 2026 y 2027, los festivos de 2027, qué hacer cuando los descuentos superan lo que permite la ley, y qué proveedor de IA redacta las cartas y qué datos pueden salir del ERP.

**Accesos**: la documentación y las credenciales de la API de Mensatec; el plan y la clave de producción del proveedor de firma; el usuario de Diana con sus llaves; el correo de la gestoría para las correcciones.

## Las fases

**Fase 0 · Cimientos** (no depende de nadie)
- ✔ 25/11, db/284: el `legajo` como código de la gestoría, **solo plantilla propia** (decidido por Camilo): formato de seis cifras, «Sin legajo» en Plantilla y la carga desde un Excel con sus incidencias. Ver [[Conductores#El legajo: el código de la gestoría (25/11/2026, db/284)]].
- ✔ 25/11, db/284: los [[Ficheros importados]]: tipo, periodo, huella (el mismo fichero no entra dos veces), estructura, resultado, incidencias y el original.
- ✔ 25/11: `cuando.semanal` en las [[Tareas programadas]], para la tarjeta del lunes. **La tarjeta va con el módulo 8** (es la de subir el listado de la gestoría, y antes tiene que existir dónde subirlo).
- ✔ 25/11, db/285: **las vencidas avisan a Ignacio**: llave `/tablero/vencidas` (ver [[Tablero de tareas]]).
- ✔ 25/11, db/285: **el traspaso a Diana** (usuario 20): la llave única de aprobar vacaciones pasa de Laura a ella, más `/convenio` y `/reportes`, que tenía Laura y ella no. El usuario de Laura sigue activo (darlo de baja es de /usuarios).
- ✔ 26/11 (db/301): las llaves de salud y de nómina, ver [[Ticketera#Los datos de salud y de nómina: cada uno con su llave (26/11/2026, db/301)]]. Decidido: «Datos de salud» (los casos de baja médica de la Ticketera y sus partes) a Diana, Ignacio, William y Ángel; «Datos de nómina» (casos de nómina y cambios de cuenta) a Diana, Ignacio y quien ya tenía /nominas; /nominas y Convenio, persona a persona; no se le quita nada a nadie.
- **El Excel de plantilla del 25/11** (pestaña PLANTILLA, 265 filas): 251 legajos ya estaban igual en el ERP, 1 nuevo (de alguien de baja) y 13 que no cuadran: los 6 últimos traen legajos (002592 a 002598) que en el ERP ya son de otras personas, una persona sale con dos legajos y una fila no tiene DNI. Los 69 de plantilla propia en alta sin legajo no vienen en ese Excel. No se cargó nada: se le pasa a Diana para aclararlo con la gestoría.
- Los parámetros del encargo en [[Parametros]].
- ✔ 26/11: el expediente del conductor, en la ficha de Plantilla: lo de cada módulo de RR. HH., cada sección con su llave; ver [[Conductores#El expediente de RR. HH. (26/11/2026)]].

**Fase 1 · Módulo 8** — ✔ primera parte el 25/11 (db/287), con la proforma: ver [[Gestoria]]. ✔ 26/11 (db/304) las altas: ver [[Gestoria#La pestaña «Altas»: las altas nuevas ante la gestoría (módulo 8, db/304, 26/11/2026)]]. Decidido: Diana lo marca a mano (pedida y confirmada con justificante); sin confirmar no vincula coche (planificar, sí, en rojo); no presentación a las dos horas del inicio del primer turno; carta de incorporación con plantilla de YouTrust. Falta la plantilla de la carta y las fechas, que necesitan el listado de plantilla en alta.
- ✔ 25/11 (db/287): subir el listado, cruzarlo por legajo y enseñar las diferencias con su coste; el correo de correcciones y su seguimiento.
- ✔ 27/11 (db/309): **las fechas que no coinciden**, con el listado de trabajadores de A3 (fechas de ingreso y baja, y la parcialidad): baja en la gestoría y de alta con nosotros, fecha de alta distinta, fecha de baja distinta y **jornada distinta**. Decidido: las decide Diana, una a una (corregir el ERP o pedírselo a la gestoría); también la jornada. Ver [[Gestoria#El listado de trabajadores de A3: fechas y jornada (db/309, 27/11/2026)]]. **Con esto el módulo 8 está completo**; solo falta que la gestoría mande ese listado al día cada lunes.
- ✔ 26/11: alta pedida y confirmada; el candado del coche y la marca en el planificador; la alerta de no presentación con el contador y el aviso a Ignacio a los dos días.

**Fase 2 · Módulo 1**
- ✔ 25/11 (db/289), sin esperar al fichero: la ausencia guardada con «pendiente de validar», la bandeja y la tarjeta del día, la reclasificación sola (también hacia atrás) y el % de plantilla de baja. Ver [[Ausencias]]. Decidido: solo plantilla propia, desde el 26/10/2026 (las nóminas van del 26 al 25), y cuatro decisiones (injustificada, justificada, baja médica, permiso).
- ✔ 25/11 (db/290): los permisos con su saldo por tipo y su validador (llave `/permisos/aprobar` en todas las puertas, también asuntos propios; pasarse del convenio pide motivo). Ver [[Ausencias#Los permisos: quién los valida y su saldo (db/290)]].
- ✔ 26/11 (db/303), a mano: la baja con sus partes (baja, prórroga, alta, rectificación), la tarjeta de «comprobar» dos días hábiles antes del fin previsto, la de reincorporación y el aviso a Planificación; ver [[Ausencias#Las bajas médicas y sus partes (db/303, 26/11/2026)]].
- ✔ 27/11 (db/312): el fichero FIE de la gestoría, en [[Ausencias#El fichero FIE de la gestoría (db/312, 27/11/2026)]].
  - Llega cada día a datos@telecab.es (Diana lo reenvía) y se lee solo.
  - Corrige las bajas del ERP: es lo legal. La Fecha Fin IT es el día del alta, y se juntan los tramos partidos.
  - Las bajas del ERP sin FIE se señalan.
  - Primero una previa y, tras «Aplicar», automático. Desde el 27/09/2026.

**Fase 3 · Módulo 4** (necesita los archivos de noviembre)
- ✔ 26/11 (db/296): revisar la proforma contra el ERP, en [[Gestoria#La pestaña «Proforma» (módulo 4, db/296, 26/11/2026)]]. Decidido: en Gestoría; cada caso, corregir en A3 (correo), en el ERP o está bien; avisa, no frena.
- ✔ 26/11: la prueba del Excel, hecha: el lienzo `.xls` (cifrado con la clave de Excel y protegido) se rellena sin rehacerlo, y Excel lo confirma celda a celda; ver [[Gestoria#Rellenar el lienzo de A3 (el .xls de la gestoría, 26/11/2026)]]. Ya no hace falta preguntar por el `.xlsx`; falta que la gestoría confirme que A3 importa el fichero escrito.
- ✔ 26/11 (db/299): el cierre del mes con sus cuatro etapas, la línea de progreso y las tarjetas, en [[Gestoria#La pestaña «Cierre del mes» (módulo 4, db/299, 26/11/2026)]]. Decidido: proforma revisada (sola) el 20, variables y descuentos enviados el 25, borrador revisado el 28 y nómina aprobada el 30; aprueba Ignacio (llave `/gestoria/nomina`).
- ✔ 26/11 (db/300): el catálogo de conceptos de A3 y las líneas del mes con su origen, en [[Gestoria#La pestaña «Variables»: el catálogo de conceptos de A3 y las líneas del mes (módulo 4, db/300, 26/11/2026)]]. Decidido: MBO → 066, nocturnidad → 053, propinas → 519, peajes → 607; descuentos con su concepto; lo demás a mano; lo gestiona quien gestiona la gestoría. El Excel sale con la forma del lienzo para copiarlo; escribir el `.xls` sigue pendiente de la gestoría.
- ✔ 26/11 (db/298): los descuentos en nómina, ver [[Descuentos en nomina]]. Decidido: km del Banco de KM a un precio por km; aprobar es una llave que se da a quien se quiera; sin tope (se aplaza a mano); conceptos 753/758/751/754. Falta: que alguien tenga la llave de aprobar, el precio por km y el visto bueno de Legal antes del primer cierre.
- ✔ 26/11: el panel del mes, encima del cierre en [[Gestoria#La pestaña «Cierre del mes» (módulo 4, db/299, 26/11/2026)]] (proforma, variables para A3 y descuentos, contra el mes anterior).
- ✔ 26/11 (db/307): el doble cruce de la IT con la gestoría, completo: la baja del ERP sin IT en la nómina (db/296) y ahora la IT de la nómina sin baja en el ERP, en la proforma.
- ✔ 26/11: en el finiquito, «Otros descuentos» son ya los de [[Descuentos en nomina]] aprobados o aplazados (los por aprobar se enseñan, no entran).
- ✔ 26/11 (db/308): el documento informativo del contrato (modelo oficial del SEPE) a firma con cada alta nueva, una sola firma; ver [[Firmas#El documento informativo del contrato (db/308, 26/11/2026)]]. Y las plantillas de YouTrust «Carta de incorporación» y «Carta de sanción», creadas.
- ✔ 26/11: el histórico por conductor y mes (4.7), en el expediente: proforma, variables y descuentos de cada mes, con la llave de Gestoría.
- El borrador: validación, versiones y rectificaciones (falta un borrador real de la gestoría). La IT precalculada (faltan las tablas de 2026 y 2027).

**Fase 4 · Módulos 6 y 9**
- ✔ 27/11: la comunicación reunida por persona. En el expediente, «Todo lo que se le ha comunicado»: firmas, comunicados y SMS por fechas, con su estado y su evidencia (el certificado, el «Lo he leído»). Ver [[Conductores#El expediente de RR. HH. (26/11/2026)]]. Las dos integraciones ([[Firmas]] con YouTrust y [[SMS certificado]] con Mensatek), hechas.
- ✔ 26/11 (db/305): los comunicados masivos con acuse, ver [[Comunicados]]. Decidido: el acuse es el «Lo he leído» del portal (día, hora, IP); aviso por correo y portal, sin WhatsApp; recordatorio cada 2 días hábiles, 3 como mucho; Diana prepara y aprueba otra persona (Ignacio). ✔ 27/11 (db/310): el PDF (solo en el portal; queda cuándo lo abrió cada uno) y el SMS certificado a quien no lo ha leído, cuando Diana lo decide.

**Módulo 5 adelantado** — ✔ 25/11 (db/288): el informe de jornada para el SMAC, ver [[Informe de jornada]]. Decidido: estricto del convenio, día natural, desde el 01/07/2026.

**Módulo 6** — ✔ 25/11 (db/293), sin API: la cola de firmas, ver [[Firmas]]. Plan Plus de YouTrust (aplicación, un asiento, Diana); Claude manda los aprobados en su nombre. Falta contratarlo, revisar sus condiciones de uso y confirmar con legal la firma simple con SMS. ✔ 26/11 (db/306): el SMS certificado de Mensatek, ver [[SMS certificado]]. Decidido: todo el módulo; remitente por defecto de la cuenta; abre con su DNI; lo manda Diana sola.

**Comunicación semanal de horas** — ✔ 25/11 (db/294): la carta de horas que quedó debiendo, cada martes, por la cola de Firmas con la plantilla de YouTrust (sin SMS). Ver [[Firmas#La comunicación semanal de horas (db/294, 25/11/2026)]].

**Módulo 7 adelantado** — ✔ 25/11 (db/291): los finiquitos, ver [[Finiquitos]]. Decidido: nace al dar la baja (propia y ETT), Diana revisa, Ignacio aprueba, vacaciones en días.

**Módulo 3** — ✔ 25/11 (db/295): las faltas y sanciones, ver [[Faltas y sanciones]]. Decidido: abre la oficina, aprueban Ángel, William o Ignacio, Diana la carta; el ERP propone (ausencias injustificadas y reincidencia) y una persona decide; carta con plantilla de YouTrust, sin IA; la suspensión entra en la ficha al firmarse, o no firmarla, o caducar. Falta crear la plantilla «Carta de sanción» en YouTrust, y los rechazos de servicios y el rendimiento (no hay dato).

**Módulo 2** — ✔ 25/11 (db/292): «Para decidir» en el ticket con los cuatro datos, el aviso al conductor en su portal y la baja encima de unas vacaciones (la baja manda y Diana decide). Ver [[Vacaciones#Para decidir una solicitud (25/11/2026, módulo 2 del plan de RR. HH.)]]. ✔ 26/11 (db/302): los cupos como **capacidad de la flota** (las horas del mes, +3 % por festivo, con el promedio de cada uno los días que trabaja) y las fechas bloqueadas; avisa en «Para decidir» y aprobar pide motivo. Ver [[Vacaciones#La capacidad de la flota y las fechas bloqueadas (módulo 2, db/302, 26/11/2026)]].

**Fase 5 · Módulos 7, 2, 3 y 5**
- Finiquitos (cableando `liquidacion`), la bandeja de vacaciones, las sanciones con su carta y el informe para el SMAC.

> [!tip] Dos cosas que se pueden adelantar
> El **informe para el SMAC** no depende de la gestoría ni de proveedores: si hay reclamaciones abiertas, puede ir antes. Y la **prueba del Excel de nóminas** conviene hacerla en cuanto lleguen los archivos, aunque el módulo 4 vaya tercero: si no sale, cambia el plan.

Relacionado: [[Hoja de ruta]] · [[RRHH]] · [[Nominas]] · [[Conductores]] · [[Vacaciones]] · [[Estado y pendientes]]
