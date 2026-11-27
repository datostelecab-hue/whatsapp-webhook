---
tags: [modulo, rrhh, gestoria]
ruta: /gestoria
codigo: modules/Gestoria/
---

# Plantilla de la gestoría

**Módulo 8** del [[Plan RRHH y nominas]] (25/11/2026, db/287). Camilo: *«Sí, arranca el módulo 8 con la proforma»*. El problema que ataca: aparecen en la nómina conductores ya finiquitados, hay bajas que la gestoría nunca tramitó (y se sigue cotizando) y altas que nunca llegaron.

```
modules/Gestoria/listado.js            leer el listado (.xls o .xlsx) y cruzarlo: puro
modules/Gestoria/gestoria.service.js   LA PUERTA: subir, la lista, resolver, poner el legajo, el correo, la tarjeta del lunes
modules/Gestoria/gestoria.repo.js      el SQL (gestoria_discrepancia)
modules/Gestoria/gestoria.controller.js  /gestoria
public/assets/js/vistas/Gestoria/gestoria.js
services/xls.js                        el lector de .xls, sin librerías
test/gestoria.test.js · test/apoyo/ficheros/*.xls (muestras de mentira, hechas con Excel)
```

## El fichero de la gestoría, y por qué hay un lector propio

Lo que manda la gestoría sale de **A3NOM** en **`.xls`** (Excel 97-2003, binario), y además **cifrado**: Excel cifra con su contraseña por defecto («VelvetSweatshop») los libros con la estructura o la escritura protegidas, y por eso lo abre sin preguntar. ExcelJS solo lee `.xlsx`. En vez de añadir una dependencia, `services/xls.js` lee el formato: el contenedor, los dos cifrados de Excel (el RC4 de Office 97 con MD5 y el RC4 CryptoAPI con SHA-1, que es el de la proforma) y las celdas (textos compartidos, números, fórmulas). Con la proforma de noviembre cuadra al céntimo con Excel (166 trabajadores y las sumas de cada concepto). Un fichero con **contraseña de apertura de verdad** no se puede leer, y se dice. Solo lee: escribir el `.xls` es del módulo 4. La estructura de la proforma está en [[Plan RRHH y nominas#La proforma real de A3NOM (noviembre de 2026)]].

El listado se reconoce por su cabecera: una columna «Código» (o «Legajo», «Nº empleado») y otra «Nombre» (o «Trabajador»), en las 20 primeras filas de cualquier hoja. Arriba, la empresa («EMPRESA:») y la fecha («FECHA:», «23 de Noviembre de 2026»). Si la cabecera trae columnas de conceptos («066 - PACTO PR (I)»), es una **proforma**; si no, un **listado** de plantilla. El código es el legajo sin ceros.

## El cruce: por legajo, nunca por el nombre

Contra la **plantilla propia** (la ETT no está en la gestoría) y sin la ficha de pruebas. Las diferencias:

| Tipo | Qué es | Va en el correo |
| --- | --- | --- |
| **En la gestoría y de baja con nosotros** | sale en su listado y se fue antes de la fecha de corte; con los días desde su baja y, si hay coste en Parámetros, lo estimado | Sí: «tramitad la baja» |
| **De alta con nosotros y no en la gestoría** | plantilla propia de alta desde antes de la fecha del listado, con legajo, que no sale | Sí: «¿se tramitó el alta?», con su DNI |
| **Legajo cambiado** | un legajo que el ERP no tiene cuyo nombre casa con una sola persona de alta cuyo legajo no sale: la misma persona con otro legajo (pasa al volver a contratar) | No |
| **Legajo que no está en el ERP** | con la ficha a la que se parece, si es una: de alta, **de ETT** o **de baja** | Sí, si para nosotros es de ETT o está de baja |
| **El legajo es de otra persona** | el legajo es de alguien del ERP que no se llama así | No |
| **Sin legajo** | de alta con nosotros y sin legajo: no se puede cruzar | No |

- **La fecha de corte**: en un listado, su fecha; en una **proforma**, el primer día de su mes. Quien se va a mitad de mes sale en la nómina de ese mes y no es una diferencia. La proforma no trae fechas de alta y baja, así que **«fechas que no coinciden» no se puede mirar con ella**: llegará con el listado de plantilla en alta (o el ITA).
- El nombre solo sirve para avisar y proponer. Dos palabras largas en común cuentan como el mismo nombre.

## Cómo viven las diferencias

- **Una viva por diferencia** (`clave` = tipo + ficha + legajo, índice único sobre las pendientes). La misma diferencia en el listado siguiente **sigue** (se apunta en qué listado salió la última vez); la que **ya no sale**, se **resuelve sola** («Ya no sale en el listado de la gestoría del 30/11/2026»).
- **Resuelta** (con nota opcional) o **descartada** (con motivo obligatorio). **Una descartada no vuelve a salir**: alguien decidió que no es un problema. Una resuelta sí, si vuelve a pasar.
- **Poner el legajo de la gestoría**: en un legajo cambiado, o en uno desconocido con su ficha propuesta. Por el mismo camino que la ficha (normalizado, y si es de otra persona dice de quién), y la diferencia queda resuelta con lo que se hizo.
- **El correo a la gestoría**: el texto con lo que tienen que corregir ellos, listo para copiar o abrir en el correo (el destinatario es el parámetro «Correo de la gestoría»). «Ya lo he mandado» apunta la fecha en cada diferencia (columna «A la gestoría»).
- Todo al [[Libro de auditoria]]; el fichero, en [[Ficheros importados]] (el mismo no se sube dos veces), con el original descargable.

## La tarjeta de los lunes

Cada lunes a las 08:00 (`gestoria.tarjeta_lunes`, `cuando.semanal`) nace en el [[Tablero de tareas]] «Pedir a la gestoría el listado de plantilla en alta y subirlo (semana del …)», **a quien tenga la función «Sube el listado de plantilla de la gestoría»** de [[Organizacion]] (db/287 se la pone al puesto «Administración de personal y nómina», el de Diana), con **vencimiento ese mismo día**. **Se cierra sola al subir un listado.** Si vence, avisa como todas, también a quien tiene la llave de las vencidas (Ignacio). La primera, el lunes 30/11/2026.

## Llaves, parámetros y número del menú

- `/gestoria` (mirar) y `/gestoria/gestionar` (subir, resolver, el correo; marcada `escribir`). db/287: las dos a Diana, mirar a Ignacio.
- Parámetros: **«Coste diario estimado de Seguridad Social por trabajador»** (`gestoria.coste_ss_dia`, a 0 no se calcula) y **«Correo de la gestoría»** (`gestoria.correo`). Ninguno inventado: los pone quien lleve RR. HH.
- RRHH → **Gestoría** en el menú, con las diferencias pendientes (en ámbar si hay de las que van a la gestoría).

## La primera carga (la proforma de noviembre, comprobado el 25/11 en solo lectura)

27 diferencias: **3 personas en la nómina de la gestoría que se fueron hace semanas** (una el 15/10 y dos el 04/09: 39 y 80 días), **5 legajos cambiados**, **15 legajos que el ERP no tiene** (13 con su ficha propuesta: 6 de ellos son de ETT para nosotros —uno sale dos veces, con dos legajos— y 3 están de baja), **2 de alta con nosotros que no salen** y **2 sin legajo**.

## La pestaña «Proforma» (módulo 4, db/296, 26/11/2026)

La **proforma** es la nómina del mes que calcula A3 **antes de las variables** y que la gestoría manda para revisar (`EXCEL NOVIEMBRE … SIN VARIABLES.xlsx`); ver [[Plan RRHH y nominas#La nómina de noviembre de A3, «sin variables» (25/11/2026)]]. Camilo (25/11/2026): *en Gestoría; cada caso se marca y con los de A3 el ERP prepara el correo; avisa, no frena*.

```
modules/Gestoria/proforma.js           leerla (un trabajador por columna) y cruzarla con el ERP: puro
modules/Gestoria/proforma.service.js   subir, la lista, decidir, el correo, la tarjeta
modules/Gestoria/proforma.repo.js      el SQL (proforma_caso)
public/assets/js/vistas/Gestoria/proforma.js   la pestaña (y las dos pestañas de la pantalla)
test/proforma.test.js                  con una proforma de mentira hecha en el test
```

- **Leerla**: la fila con los códigos de seis cifras (desde la D), las tres de debajo con el nombre, las de arriba con las **notas a mano**; el mes del «DEL 01/11/26 AL 30/11/26»; los conceptos por su código (B) y los totales por su nombre (A: «TOTAL BRUTO», «TOTAL LIQUIDO», «COSTE EMPRESA», «DIAS COTIZADOS»). La IT, de los conceptos 450, 451, 452 y 455.
- **El cruce**, contra el ERP en ese mes:

| Caso | Qué es |
| --- | --- |
| Código que el ERP no tiene | con la ficha que se le parece por el nombre (si es una) |
| Cobra el mes sin contrato propio | para el ERP no es plantilla propia ese mes (o es de ETT) |
| Baja médica que la nómina no recoge | baja del ERP que ya había empezado al subirla, sin IT ni nota; avisa si es de un día |
| IT en la nómina sin baja en el ERP | (db/307, 26/11/2026) la nómina le imputa IT (450-455) y el ERP no tiene ninguna baja médica que toque el mes: falta apuntarla con su parte, o la IT no corresponde. Es la otra mitad del doble cruce del encargo. Sin la 307 aplicada no se apunta |
| Suspensión que no cuadra | suspendido en el ERP y cotiza los días enteros; o la nota dice suspensión y el ERP no la tiene |
| Días cotizados distintos a su contrato | días de contrato propio en el mes, **menos los suspendido** |
| Plantilla propia fuera de la nómina | dice si es un alta reciente (código posterior al último de la nómina): lo normal es que llegue después |

- **Decidir** cada caso (o varios marcados): **corregir en A3** (con nota: va al correo), **corregir en el ERP** o **está bien**; se puede volver a «por decidir».
- **A quién se parece un código** (26/11/2026): dos palabras largas **distintas** en común (antes contaba dos veces la misma: «MEDINA MEDINA MÓNICA» casaba con «MEDINA ROMERO CRISTIAN JEF»); una palabra que A3 corta («JEF») vale si es el principio de la otra («JEFFERSON»); entre varias fichas parecidas, la que comparte más. Lo usa también el cruce del listado de plantilla.
- **La cifra de cada trabajador** (26/11/2026): con la carga se guarda su código, días cotizados, IT, bruto y líquido (`resultado.trabajadores`), para el histórico de su nómina en el expediente ([[Conductores]]). Las cargadas antes, al volver a cruzarlas.
- **Volver a cruzar**: la última proforma subida de un mes, contra el ERP de ahora, con el original guardado (sin subirla otra vez): después de poner un legajo, una baja o una suspensión. Lo decidido se conserva y lo que ya no sale se cierra solo.
- **Otra proforma del mismo mes**: lo decidido se conserva; lo que estaba por decidir y ya no sale, se cierra solo («ya no sale»). La misma no entra dos veces ([[Ficheros importados]], tipo `proforma_a3`).
- **El correo**: los «corregir en A3» sin mandar, con su frase y la nota; «Ya lo he mandado» los apunta.
- **La tarjeta**: «Revisar la proforma de noviembre de 2026: N casos», a quien sube los listados de la gestoría, con vencimiento el día del corte (`nomina.dia_corte`); se cierra sola al no quedar ninguno por decidir. **No frena nada.**
- Mismas llaves que la pestaña de plantilla. El número de la pestaña: los casos por decidir.

**Con la de noviembre** (comprobado el 26/11 en solo lectura): 164 trabajadores, bruto 219.246,28 €, líquido 195.407,65 €; 100 casos: 23 códigos, 9 sin contrato propio, 8 bajas médicas, 3 suspensiones, 10 de días y 47 fuera de la nómina (36 de ellos, altas recientes).

## La pestaña «Variables»: el catálogo de conceptos de A3 y las líneas del mes (módulo 4, db/300, 26/11/2026)

Lo que se escribe en el **lienzo de A3NOM** (la plantilla «Conceptos» que manda la gestoría: un trabajador por fila, una columna por concepto) de cada mes de nómina, **una línea por persona y concepto, con su origen**. Camilo, 26/11/2026:

| Origen | Conceptos |
|---|---|
| **La variable del mes** ([[Nominas]], la del mes de pago; la congelada si lo está, si no la calculada) | el MBO (el mayor de horas extra y FAS) → **066**, la nocturnidad → **053**, las propinas → **519**, los peajes → **607**. Solo plantilla propia: la ETT va en el parte de la agencia |
| **[[Descuentos en nomina]]** | lo ya descontado al cerrar el mes y lo aprobado o aplazado a él, cada uno con **su** concepto (753, 758, 751, 754) |
| **A mano**, con motivo | lo demás: dietas, plus de calidad, festivos, regularización (que puede ir en negativo)… |

```
modules/Gestoria/variables.service.js   el catálogo, preparar, a mano, anular y el Excel
modules/Gestoria/variables.repo.js      el SQL (nomina_concepto, nomina_linea)
public/assets/js/vistas/Gestoria/variables.js
test/variables-a3.test.js
```

- **El catálogo** (`nomina_concepto`, botón «Conceptos»): los 17 conceptos del lienzo de noviembre, cada uno con su **cabecera exacta** («066 - PACTO PR (I)», leída del lienzo con Excel en solo lectura), si se paga o se descuenta, de dónde sale y su orden. Cada pieza de la variable va a un solo concepto. Se cambian y se añaden desde la pantalla.
- **«Preparar desde el ERP»** rehace entero lo que sale del ERP de ese mes; **lo de a mano no se toca**. Dice cuántas líneas, a cuántas personas, cuánto de variable y de descuentos, si la variable estaba congelada y qué no salió (un concepto que falta en el catálogo).
- **Lo de a mano** se anula con motivo; lo del ERP no se anula, se rehace.
- **Cuando en «Cierre del mes» las variables están marcadas enviadas**, el mes ya no cambia: ni preparar, ni apuntar, ni anular. Hay que deshacer esa etapa.
- **El cierre** pide como requisito de las variables que estén preparadas.
- **«Excel para A3»**: hoja «Conceptos» con la **cabecera en la fila 8** como el lienzo («Código», «Nombre» y la cabecera de cada concepto), el **código de la gestoría sin los ceros** (el lienzo lo trae así) y el total en fórmula. Quien no tiene legajo va en la hoja «Sin código» (A3 no lo puede importar), y la hoja «Detalle» trae cada línea con su origen. Sirve para revisarlo; el fichero para A3 es el lienzo rellenado (abajo).
- Llaves: mirar, `/gestoria`; preparar, a mano, anular y el catálogo, `/gestoria/gestionar` (Diana).

### Rellenar el lienzo de A3 (el .xls de la gestoría, 26/11/2026)

**«Rellenar el lienzo de A3»** (quien gestiona): se sube el `.xls` de importación de conceptos que manda la gestoría, se elige el mes, y el ERP devuelve **el mismo fichero** con las variables del mes escritas en sus celdas: cada línea en la fila de su código (el legajo sin ceros) y la columna de su concepto (por el código de la cabecera, «066 - …»). Dice cuántas escribió, **qué cifras que ya traía el lienzo sustituyó** (con la de antes y la nueva), quién no está en el lienzo, quién no tiene código y qué conceptos no trae.

- **Por qué un escritor propio** (`modules/Gestoria/lienzoXls.js`, sin dependencias): el lienzo es un `.xls` de Excel 97-2003 (BIFF8), con la hoja protegida, la fila 1 oculta, 11 nombres definidos que usa A3 y **cifrado con la clave por defecto de Excel** («VelvetSweatshop», RC4 CryptoAPI: lo que hace Excel con un libro protegido sin contraseña de apertura). ExcelJS no lee `.xls`, y reescribirlo entero perdería eso. Aquí se toca lo mínimo: se descifra, se escriben solo las celdas de los importes (con su mismo formato), se recalculan los índices de la hoja (INDEX, DBCELL) y la extensión de la fila, y se vuelve a cifrar con la misma clave.
- **Comprobado con el lienzo de noviembre** (en local, sin subirlo a ningún sitio): leído y montado sin cambios sale **idéntico byte a byte**; escrito, Excel lo abre y, celda a celda (700 con dato), **solo cambian las escritas**; siguen la protección de la hoja y del libro, la fila 1 oculta, los 11 nombres y qué celdas están bloqueadas.
- Las pruebas (`test/lienzo-xls.test.js`) usan dos lienzos **inventados** hechos con Excel (`test/fixtures`, sin nombres reales ni en las propiedades): uno en claro y otro cifrado (contraseña «prueba»).
- Con esto **ya no hace falta** que la gestoría acepte un `.xlsx`. Lo que falta es que A3NOM importe el fichero escrito: la primera vez, que la gestoría lo confirme.

## La pestaña «Cierre del mes» (módulo 4, db/299, 26/11/2026)

El mes de nómina (del 26 al 25) con sus **cuatro etapas** en una línea, cada una con su fecha, quién y cuándo, y en rojo si va con retraso. Camilo, 26/11/2026, eligió las etapas, los días y quién aprueba:

| Etapa | Fecha | Cómo se marca |
|---|---|---|
| **Proforma revisada** | el 20 (`nomina.cierre_proforma`) | **Sola**: la proforma del mes subida y sin casos por decidir en la pestaña «Proforma» |
| **Variables y descuentos enviados** | el 25 (`nomina.dia_corte`) | A mano, quien tiene `/gestoria/gestionar`. Antes mira si la variable del mes está **congelada en [[Nominas]]** y si los **[[Descuentos en nomina\|descuentos]] del mes están cerrados**. Avisa, no frena: si falta algo, la nota dice por qué |
| **Borrador revisado** | el 28 (`nomina.cierre_borrador`) | A mano, quien tiene `/gestoria/gestionar`, después de las variables |
| **Nómina aprobada** | el 30, o el último del mes (`nomina.cierre_aprobada`) | Quien tiene la llave nueva **`/gestoria/nomina`** («Gestoría · aprobar la nómina del mes»; db/299 se la da a Ignacio), con las tres anteriores hechas |

```
modules/Gestoria/cierre.service.js   las etapas, las fechas, marcar, deshacer y las tarjetas
modules/Gestoria/cierre.repo.js      el SQL (nomina_cierre_etapa)
public/assets/js/vistas/Gestoria/cierre.js
test/cierre-nomina.test.js
```

- **El panel del mes**, encima de las etapas (26/11/2026, el «panel» del módulo 4): lo que ya hay, junto y contra el mes anterior. De la **proforma** de A3 (lo guardado al subirla): bruto, líquido, coste de empresa, personas y casos por decidir. De las **variables para A3**: lo que se paga y lo que se descuenta, y cuántos no tienen código. De los **descuentos**: los que esperan aprobación. Nada se calcula: sale de lo guardado (`cierre.service.resumenDe`). Con producción, noviembre: 164 personas, bruto 219.246,28 €, 93 casos por decidir; 413 líneas de variables de 142 personas (19.645,43 €), 18 sin código.
- **Deshacer** (o «Reabrir» la aprobada) pide motivo y va de la última hacia atrás. Lo deshecho queda en la historia del mes. Todo al [[Libro de auditoria]].
- **Las tarjetas**: la tarea `nomina.cierre` (cada día a las 08:00, desde el 27/11/2026) mira este mes y el anterior. Cada etapa sin hacer a **tres días hábiles o menos** de su fecha hace nacer una tarjeta `nomina_cierre` («AAAA-MM|etapa»): a quien tiene la función «plantilla_gestoria» (Diana) y la de aprobar a quien tiene la llave. Se cierra sola al marcar la etapa. La de la proforma solo nace si no se ha subido; subida, la lleva su propia tarjeta.
- **El número de la pestaña**: las etapas con retraso del mes en curso y del anterior (se cuenta una vez por minuto, para todos).
- **Qué mes se abre**: el anterior mientras no esté cerrado; si no, el que está en curso. Con las flechas, los meses desde noviembre de 2026.
- Las rutas `/gestoria/api/cierre*` van por `RUTA_A_CLAVE` a `/gestoria`, y el servicio pide la llave de cada cosa. Si no, aprobar exigiría también `/gestoria/gestionar`.
- No sustituye los dos cierres que ya hay (congelar en /nominas y el del convenio). Los mira y deja constancia de que se mandaron, se revisaron y se aprobaron.

## La pestaña «Altas»: las altas nuevas ante la gestoría (módulo 8, db/304, 26/11/2026)

El encargo: *«dos riesgos igual de graves: trabajar sin alta y cotizar más de dos días por alguien que no se presenta»*. Lo que decidió Camilo el 26/11/2026: **Diana lo marca a mano**; sin el alta confirmada **no vincula coche** (planificarle, sí: sale en rojo); la no presentación, **pasadas dos horas del inicio de su primer turno**; la carta de incorporación, **con su plantilla de YouTrust**.

```
modules/Gestoria/altas.service.js   estados, candado del coche, tarea de cada hora
modules/Gestoria/altas.repo.js      el SQL (alta_gestoria)
public/assets/js/vistas/Gestoria/altas.js
test/altas-gestoria.test.js
```

- **Quién entra**: cada contrato (periodo de empleo) de **plantilla propia** con alta **desde el 27/11/2026**. La ETT no (el alta la da la agencia), ni los contratos de antes (ya trabajan). La ficha de pruebas tampoco. Se crean solos (al abrir la pestaña y cada hora), como **sin pedir**; su fecha sigue a la del contrato si se corrige en Plantilla.
- **Los estados**: sin pedir → **Alta pedida** (Diana se la pide a la gestoría) → **Alta confirmada** (hace falta adjuntar antes el **justificante** de la gestoría; se puede confirmar sin haberla marcado pedida) · **Anular** (no llegó a empezar; con motivo) · **Deshacer** (vuelve a sin pedir, con motivo). Lo marca quien tiene `/gestoria/gestionar`; lo ve quien tiene `/gestoria`. Todo al libro.
- **El candado del coche**: `fichaje.iniciar` pregunta a `altas.bloqueaCoche`. Con un contrato así sin el alta confirmada, el portal contesta que su alta aún no está confirmada (motivo `sin-alta`). **El bot de WhatsApp no lo mira** (Camilo, 27/11/2026: *«en el bot de WhatsApp, todavía no metas nada de estos flujos… como el flujo antiguo»*). Llama con `comprobarAlta: false`, así que vincula el coche y abre y cierra las puertas como siempre, sin mensajes de alta. Se encenderá cuando Camilo lo diga. Solo conductores (el viaje de la oficina no). **Si la base falla, deja pasar**: un error ahí no puede dejar a la plantilla sin coche.
- **El planificador** le deja planificar, pero pone **«Sin alta confirmada»** en rojo al lado del nombre (cuadrante y banquillo), con el estado en el título (`sinAlta` en la persona).
- **Cada hora** (tarea `gestoria.altas`, desde el 27/11/2026):
  - Apunta su **primer día con turno** desde el alta (`f_cobertura`, como el planificador) y de qué turno; mientras no se presente, se recalcula.
  - **El día antes** del primer turno (o el mismo día, o después) sin el alta confirmada: **aviso urgente** a Diana y a Ignacio.
  - **No presentación**: el turno de día empieza a las 05:00 y el de noche a las 17:00; **dos horas después**, si no ha vinculado ningún coche (libro de turnos del bot y del portal) ni BOLT le ha visto conectado con ninguna de sus cuentas, **aviso urgente** a los dos y **tarjeta a Diana** con plazo ese día: pedir la anulación del alta (o la baja).
  - **El contador**: días cotizados desde el alta hasta hoy (o su baja, o el día que se anuló), **solo si el alta se pidió**; el coste, con el parámetro `gestoria.coste_ss_dia`. **A los dos días** sin resolver, **aviso a Ignacio** (una vez).
  - **Si al final se presenta**, la tarjeta se cierra y los avisos se dan por vistos.
- **Quién es quién**: Diana = la función «Sube el listado de plantilla de la gestoría» (Organización); Ignacio = quien tiene la llave `/tablero/vencidas`. Los avisos van **uno por persona** (cada uno lo da por visto).
- **La carta de incorporación**: al crearse un alta cuyo día aún no ha llegado, entra en la cola de [[Firmas]] (tipo `incorporacion`, origen `alta`). Va con la plantilla «Carta de incorporación» de YouTrust (creada el 26/11/2026, a nombre de Tibus Luxury, con SMS). La lista enseña cómo va.
- **Tarjeta «Pedir el alta a la gestoría»** a Diana al crearse, con plazo el día antes de su alta; se cierra sola al marcarla pedida, confirmada o anulada.
- Número en la pestaña: las sin pedir, las urgentes y los no presentados. Desde una tarjeta o un aviso: `/gestoria?vista=altas&alta=ID`.

## El listado de trabajadores de A3: fechas y jornada (db/309, 27/11/2026)

El listado de trabajadores que sale de A3 («PLANTILLA TRABAJADORES»: Legajo, TRABAJADOR, DNI…, Fecha Ingreso, Fecha Baja, Contrato, Coeficiente Tiempo Parcial) trae **a todos, también a los que se fueron**. El lector reconoce esas columnas solas (`listado.js`). Lo que hay que saber de ellas:
- «00/00/0000» quiere decir sin fecha.
- Una fecha llega como fecha de Excel o como texto «dd/mm/aaaa», y en un .xls como número de serie.
- La parcialidad va en tantos por mil de 40 h: «000» es la jornada completa, «800» son 32 h y «750», 30 h.

Con fechas, el cruce cambia en dos cosas:
- Quien tiene **baja en la gestoría a la fecha del listado no está de alta para ellos**.
- De cada legajo cuenta **su fila de ahora**: la que no tiene baja, o la más reciente. A un recontratado, A3 lo saca dos veces.

Y salen cuatro diferencias más. Camilo decidió que **las decide Diana, una a una**:

| Tipo | Qué es | «Corregir el ERP» |
| --- | --- | --- |
| **De baja en la gestoría y de alta con nosotros** | la gestoría le dio de baja; para nosotros sigue trabajando | No: si se fue, se le da la baja en su ficha |
| **Fecha de baja distinta** | los dos le dieron de baja, en fechas distintas; si la de la gestoría es después, esos días cuestan (con el coste diario de Parámetros) | No: se corrige en la ficha |
| **Fecha de alta distinta** | la fecha de alta no es la misma | Sí, si el contrato sigue abierto: `cambiarAlta`, con sus reglas (no puede dejar fuera días trabajados) |
| **Jornada distinta** | las horas de su contrato no son las mismas (solo plantilla propia) | Sí: `cambiarJornada`, la misma novación que en Plantilla |

- **«Pedírselo a la gestoría»** marca la diferencia (`detalle.pedir`, con el día). Entra en el siguiente «Correo a la gestoría» y sigue pendiente hasta que deje de salir en su listado. La marca se conserva al subir listados nuevos. En la columna «A la gestoría» sale «Por pedir» hasta que se manda.
- **«Corregir el ERP»** cambia la ficha como la tiene la gestoría (queda en el libro de cambios de la ficha) y da la diferencia por resuelta.
- **La fecha del listado**: el de trabajadores de A3 no la trae, así que al subirlo se pide (por defecto, hoy). Si lo más reciente del fichero es de hace más de un mes, la vista previa avisa: cruzar a hoy un listado viejo llena la lista de diferencias falsas, con los que se fueron y los que entraron después. La proforma sigue sacando su fecha del fichero.
- **Comprobado el 27/11 en solo lectura** con el «PLANTILLA TRABAJADORES» que había, que es de mediados de septiembre (lo último que trae es una baja del 15/09). Cruzado a su fecha, el 16/09:
  - 14 en la gestoría y de baja con nosotros, 3 de alta y no en la gestoría;
  - 8 fechas de alta y 3 de baja distintas, 3 jornadas distintas y 3 de baja en la gestoría y de alta con nosotros;
  - además, 6 legajos de otra persona, 4 desconocidos, 1 cambiado y 1 sin legajo.

  Cruzado a hoy salían 56 y 56: por eso se pide la fecha. Pruebas en test/gestoria-fechas.test.js.

## Las altas que Diana manda al chat (27/11/2026)

Diana sube la «RYC» (el alta en la Seguridad Social) al canal **#2-altas-de-empresas**, con el nombre y la fecha. Camilo: *«cuando mande un alta en ese chat, de una vez confirme las altas por confirmar en ese módulo y le relacione el PDF»*. Está en `modules/Gestoria/altasChat.service.js`:

- **Al escribir en el canal con un PDF**, también en un hilo, se busca el alta sin confirmar de esa persona:
  - por el nombre del fichero («2026 11 30 JOSE ANGEL HERRERA PIMENTEL - RYC.pdf») y por el del texto, hasta la primera «/»;
  - con dos palabras en común como mínimo, como el cruce con la gestoría, y tiene que salir una sola;
  - y con el mensaje entre 20 días antes y 30 después de la fecha de alta.

  El PDF se copia como **justificante** del alta y el alta queda **confirmada por quien lo mandó** (con su llave `/gestoria/gestionar`). **Telecab contesta en el hilo**: confirmada, o que no la encontró y hay que hacerlo a mano.
- **Cada hora** se repasan los mensajes del canal desde el 20/11/2026 (`gestoria.altas_chat`). Así entra el PDF que llegó antes de que existiera el alta, porque Diana lo manda días antes. En ese repaso no se contesta en el chat.
- **No cuentan:** un mensaje cuyo hilo dice «anulada», ni un PDF que ya es el justificante de un alta (se mira por su huella).
- **Comprobado el 27/11 en solo lectura** con los mensajes reales: 9 PDF casan con sus 9 altas, sin dobles ni falsos.
  - No casa «Camilo Peñaranda Azad» con «Peñaranda Ventura, Jesús Fernando»: solo comparten una palabra.
  - Los del 26/11 (Díaz Tendero y Medrano Díaz) no tienen alta en el módulo, que empieza el 27/11.

## Lo que falta del módulo 8

- Que la gestoría mande cada lunes el **listado de trabajadores de A3 al día** (es el que pide la tarjeta del lunes).

Relacionado: [[Plan RRHH y nominas]] · [[Conductores]] · [[Ficheros importados]]
