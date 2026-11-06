---
tags: [modulo, barcelona, sedes, planificador, horas, taller]
ruta: /barcelona
codigo: modules/Barcelona
fecha: 2026-10-07
---

# Barcelona

Camilo, 07/10/2026: «en el login ahora va a aparecer Barcelona o Madrid». Barcelona **no necesita fichas ni altas**: sus conductores son sus **cuentas de BOLT** (nombre y teléfono) y sus matrículas, los **coches de su empresa de BOLT**. Lo que necesita es:

- un **planificador**: cada conductor en una matrícula, de día o de noche; desde el 06/11/2026 (db/234), **el de Madrid**, con zonas, cuadrantes, libranzas de la plaza, correturnos (desactivados por defecto) y el promedio de horas de cada uno, sin letra;
- un **reporte de horas** con la misma regla que Madrid, «No salió» cuando le tocaba y no hizo horas, y «Libra» el día que libra;
- su **Visibilidad**, con las mismas métricas que la de Madrid;
- y, desde el 04/11/2026, sus **Mantenimientos**: el taller por kilómetros de sus coches.

Las piezas de datos (de dónde salen sus horas y sus coches, y por qué van en tablas suyas) están en [[Sedes]].

## Se entra eligiendo la sede en el login

El login tiene un selector **Madrid / Barcelona** (se recuerda el último en ese navegador). La sede viaja en la cookie de sesión como el tema (`services/sesion.js`, `SEDES` y `sedeValida`), y se conserva al re-emitirla (cambiar el tema o la contraseña). Ver [[Usuarios y permisos]].

- **Madrid** es el ERP de siempre.
- **Barcelona** cae en `/barcelona` y su menú solo tiene sus pantallas: Planificador, Reporte de horas, Visibilidad y Mantenimientos.
- En las dos, arriba del menú, **«Ir a Madrid» / «Ir a Barcelona»** cambia de sede sin volver a entrar (`POST /sede`).
- **Cualquier usuario** puede elegir Barcelona (Camilo). Por eso `/barcelona` no tiene clave en el catálogo de permisos: lo que no está en el catálogo es libre para quien está dentro.

## El planificador (`/barcelona`)

### Desde el 06/11/2026: el de Madrid con los datos de Barcelona (db/234)

Camilo, 06/11/2026: *«Vamos ahora con el planificador de Barcelona. En estos momentos no hay RRHH así que no sé quién está de alta desde qué fecha, solo nos basamos si está activo o no en BOLT, bueno, pues ahora necesito agregarle días de libranzas desde el planificador, además de agregar los promedios de cada uno como en el planificador de Madrid, sin letra ya que no nos interesa la utilización y avisos de velocidad, por el momento. Además de que ahora también se van a agregar zonas de Barcelona así como en Madrid, no sé todavía si habrá o no CT allá pero actívalo de una vez, por defecto todos deben de venir con los CT desactivados.»* Y: *«Prácticamente será el mismo diseño de Madrid, solo que la arquitectura y flujo de datos cambia ya que no tenemos lo mismo, pero está empezando de 0 para ir cogiendo forma.»*

Lo que decidió al preguntarle: las libranzas son **de la plaza** (matrícula + turno), como en Madrid; el **CT como en Madrid, con su bloque**; las **zonas en grupos tipo cuadrante** (la zona es del cuadrante); y el **promedio igual que el de Madrid**.

Es el mismo diseño y el mismo lenguaje que [[Planificacion]] y [[Coches sin correturnos]] (zonas, cuadrantes, «Sin correturnos», «libra L M», sol y luna), sin letra. Lo que cambia es de dónde salen los datos, porque Barcelona no tiene lo mismo:

| | Madrid | Barcelona |
|---|---|---|
| Las personas | fichas, con alta, ausencias y libranza excepcional | **cuentas de BOLT** de su empresa: activa = `estado_externo = 'active'` |
| La plaza | `plaza` + `vehiculo_id` | **la matrícula** (hay coches que solo están en BOLT) |
| El CT | se quita (`vehiculo_sin_ct`: sin fila, lleva CT) | **se activa** (`sede_coche_ct`: sin fila, NO lleva CT; lo de por defecto) |
| Quién trabaja cada día | `f_cobertura` (SQL) | `barcelona.plan.js` (JS puro) |
| Las tablas | `base_zona`, `cuadrante`, `vehiculo_descanso`, `asignacion` | `sede_zona`, `sede_cuadrante`, `sede_coche`, `sede_coche_ct`, `sede_descanso`, `sede_asignacion` (con `sede`) |

**Todo va en tablas de la sede**, por lo de siempre ([[Sedes]]): de las tablas de Madrid beben `f_cobertura`, Control, el bot y las nóminas, y un coche o una cuenta de Barcelona saldría allí como un hueco o un NN. Madrid no cambia en nada.

### Las reglas (`barcelona.plan.js`)

Las de Madrid (`f_cobertura` con db/203), escritas en JS:

- **Un coche SIN CT** (todos, de entrada) tiene **el descanso de cada fijo** (`sede_descanso` con `turno` 'dia' o 'noche'). El día que libra el fijo de un turno, **ese turno el coche no sale y es lo planificado: no es un hueco**.
- **Un coche CON CT** tiene **un descanso, el del coche entero: el bloque** (`turno` NULL). Sus dos fijos libran esos días y su CT los cubre. El coche siempre sale: si el día del bloque no hay CT, eso sí es un hueco.
- **Un fijo** trabaja todos los días menos los que libra su plaza. **Un CT** trabaja solo los días de la semana que cubre en esa matrícula (`sede_asignacion.dias`), y solo mientras el coche lleve CT.
- **Hueco** = el turno sale y nadie lo cubre (sin fijo, o el fijo libra y ningún CT cubre ese día).

`P.crear({ asignaciones, cts, descansos })` devuelve las preguntas de un día: `conCT`, `descansoDe`, `libra`, `trabaja`, `turnoDelCoche` ('sale'/'libra'), `quienCubre`, `estadoDelTurno` ('trabaja'/'libra'/'hueco') y **`planDelDia(dia)`: las asignaciones que TRABAJAN ese día**. Es lo que leen **todos** los que preguntan «¿a quién le tocaba?»: el tablero, el reparto de horas por turno (`barcelona.horas.planDesde`), el reporte diario, el semanal, el promedio y la Visibilidad. Antes leían las asignaciones en crudo: con libranzas, eso daría «No salió» a quien libraba.

**Nadie lleva dos coches del mismo turno a la vez** (`P.choques`, la regla de `comprobarPlan` de Madrid reducida al mismo turno, que es lo que Barcelona dejaba hacer: un fijo de día de un coche puede ser fijo de noche de otro). Se mira la semana desde el día que se escribe, con las libranzas de cada plaza: un CT en dos coches del mismo turno vale si sus días no se pisan; un fijo no puede ser CT de otro coche de su turno en los días que trabaja el suyo. El error dice con cuál y qué días.

### Las escrituras

Todas valen **desde el día que se mira**, como Madrid: lo vigente ese día se **cierra la víspera** (el reporte de un día viejo sigue sabiendo qué había), lo que empezaba ese mismo día **se borra** (no llegó a valer) y lo escrito para más adelante **se respeta**: lo nuevo dura hasta su víspera. Vale para los descansos y, desde la revisión del 06/11/2026, también para las plazas (`repo.asignarEn`, como `colocar` y `liberar` de Madrid): poner a Hanss desde el 08 en una plaza que Miguel tiene escrita desde el 16 deja a Hanss del 08 al 15 y a Miguel desde el 16; dejarla libre desde el 08 solo quita lo que vale el 08. Antes se borraba lo de Miguel sin decir nada. Si lo siguiente es de la misma persona (con los mismos días, si es CT), se le adelanta el «desde» en vez de abrir dos filas, y un fijo que tiene otra plaza fija escrita para más adelante en ese turno acaba la víspera de esa.

**Una plaza de CT dura, como mucho, lo que dura el periodo con CT de su coche.** Si ya está escrito que se le quita el CT, la plaza acaba ese día (`hasta`). Antes quedaba abierta: en un coche sin CT la pantalla no la deja vaciar (pinta el aviso «Este coche no tiene correturnos…») y, al reactivarle el CT, la persona volvía sola. La base lo para también (db/235, abajo).

La fecha va de un mes atrás a dos meses adelante; lo del CT, **nunca antes de hoy**. **Una fecha que no existe** (`2026-11-31`, `2026-13-01`) no se cambia por otra: *«Esa fecha no existe: elígela en el calendario.»* (antes acababa en un error de PostgreSQL en inglés, o V8 la pasaba al día 1 del mes siguiente); sin fecha, vale desde hoy, y el tablero de una fecha que no existe es el de hoy. Las validaciones están en el servicio con mensajes para la pantalla; la base garantiza el resto (los índices únicos, las exclusiones y el disparador de abajo).

| Ruta (bajo `/barcelona`) | Qué hace |
|---|---|
| `GET /api/tablero?fecha=` | El tablero de ese día (la forma, abajo) |
| `POST /api/asignar` `{ matricula, turno, rol, uuid, desde, dias? }` | Pone o quita a alguien. Un **fijo** que ya era fijo de otra matrícula en ese turno **se mueve** (como siempre). Un **CT** exige que el coche lleve CT ese día; sin `dias`, los del bloque. No se mueve: lleva varios coches. |
| `POST /api/descanso` `{ matricula, turno: null\|'dia'\|'noche', dias, desde }` | El bloque (`turno` null) solo en un coche con CT, y sin compartir día con otro bloque de su cuadrante **en ningún día desde el que vale** (*«Esos días chocan con 2222BBB (S/D) en el cuadrante desde el 20/11/2026»*); el de un fijo, solo sin CT. Sin días, deja de librar. |
| `POST /api/ct` `{ matricula, activar, dias?, desde }` | **Activar**: pide el bloque, cierra los descansos de cada fijo y abre el periodo con CT y el descanso común. Si el periodo anterior acaba justo la víspera (se le quitó el CT desde ese mismo día), se alarga ese en vez de abrir otro pegado: con dos pegados, una plaza de CT puesta antes de la junta acabaría en ella aunque el coche siga con CT. A quien se quitó al desactivar no se le devuelve. **Desactivar**: como «Sin correturnos» de Madrid: fuera sus CT (devuelve `quitados`), cada fijo pasa a librar el bloque, y se cierra el periodo. Un CT escrito para más adelante se quita desde que empieza. |
| `POST /api/zonas` · `PUT /api/zonas/:id` | Crear, renombrar o retirar (`activa: false`) una zona. Nombre único en la sede, «Sin zona» reservado; no se retira con cuadrantes vivos. |
| `POST /api/cuadrantes` · `PUT` · `DELETE /api/cuadrantes/:id` | Crear (con **el siguiente número libre** de la sede: borrado el C1, el próximo vuelve a ser el C1), cambiar zona o nombre, dar de baja (solo sin coches). |
| `POST /api/cuadrantes/:id/coche` `{ matricula, quitar?, fecha? }` | Meter o sacar un coche. Uno con CT (hoy o escrito para más adelante) entra si su bloque no comparte día con los del cuadrante **de hoy en adelante**: el cuadrante de un coche no tiene fechas. `fecha` es solo el día del tablero que vuelve (la pantalla manda el que mira). |
| `POST /api/cuadrantes/:id/ct` `{ turno, uuid, desde }` | **El CT del cuadrante** (como `asignarCTcuadrante`): esa persona de CT de ese turno en cada coche **con CT** del cuadrante, con el bloque de cada uno y hasta el último día con CT de cada coche; los sin CT se saltan; si otro ya lleva un coche, o su bloque aún no tiene días, ese no se toca y sale en `saltados` con su `motivo` (y `nombre`, si lo lleva otro). Sin persona, quita el CT de ese turno de todos desde ese día. `cambiados` cuenta los que de verdad cambian. Todo en una transacción. |

Las escrituras devuelven `{ tablero }` del día desde el que valen (y lo propio de cada una: `movidaDe`, `cambio`, `quitados`, `saltados`, `cuadrante`, `zona`). Las de zonas y cuadrantes no tienen día: devuelven el tablero solo si se manda `fecha` (en el cuerpo o en `?fecha=`); si no, la pantalla vuelve a pedir el del día que mira. Devolver el de hoy la haría saltar de día al renombrar una zona.

**Dos bloques del cuadrante no comparten día, mirado día a día.** Al fijar un bloque, al activar el CT y al meter un coche en un cuadrante, el servicio monta el plan **como quedaría** tras la escritura (`trasDescanso`, `trasActivar`) y lo recorre día a día hasta lo último que puede haber escrito (`topeEscrito`: dos meses adelante y un margen). Lo que otro coche tiene escrito para más adelante, o un CT que empieza más adelante, también cuenta, y el aviso dice desde cuándo choca. Antes solo se miraba el día de la escritura y el cuadrante podía acabar con dos bloques en los mismos días. Lo que el propio coche ya tiene escrito para después se respeta, así que eso no choca: solo se miran los días en que vale lo nuevo, hasta la víspera de lo siguiente que el coche tiene escrito. También al **dejar de librar** (bloque sin días): un choque que ya hubiera más adelante, y que esa escritura no toca, no impide quitar el bloque (verificación del 06/11/2026).

**Debajo de la pantalla, la base** (db/234 y db/235): un fijo y un CT por coche y turno (`uq_sede_asig_plaza`), una plaza fija por persona y turno (`uq_sede_asig_conductor`, el CT no), los periodos con CT y los descansos sin solaparse (la técnica de db/203 con `int4range` por turno), los días bien escritos (`f_sede_dias_validos`) y un disparador, `tg_sede_asignacion_ct`, que no deja entrar a nadie de CT si la plaza **entera** (de `desde` a `hasta`) no cabe en un periodo con CT del coche, venga de donde venga. db/235 (revisión del 06/11/2026) lo amplió: el de db/234 solo miraba el día que empieza y no saltaba al cambiar `hasta`. **Acortar una plaza de CT vale siempre** (cerrarla la víspera, quitar el CT del coche); alargarla más allá del periodo o dejarla sin fin, no (*«El 0970LJJ lleva correturnos hasta el 08/11/2026: la plaza de CT no puede pasar de ese día»*). db/235 recorta también las que ya estuvieran mal.

### La forma del tablero (el contrato con la pantalla)

```js
{ fecha, hoy,
  zonas: [{ id, nombre, cuadrantes, coches }],                    // las vivas, por nombre
  cuadrantes: [{ id, numero, nombre, zonaId, zona, coches: ['MAT'],
                 ct: { dia: [persona + matriculas], noche: [...] },  // quién es CT de cada turno en sus coches
                 bloques: [{ matricula, dias }] }],               // los coches con CT y su bloque
  coches: [{ matricula, modelo, enBolt, enErp, activo, estadoBolt, cuadranteId,
             conCT, conCTDesde, descanso, descansoTurno: { dia, noche },
             plazas: { fijoDia, fijoNoche, ctDia, ctNoche },
             turnos: { dia: 'trabaja'|'libra'|'hueco', noche } }],
  conductores: [persona + plazas],                                // los activos en BOLT
  sinPlaza: [persona],                                            // activos sin ninguna plaza ese día
  resumen: { coches, turnos, cubiertos, huecos, libran, sinPlaza, conCT } }
// persona: { uuid, nombre, telefono, activa, desde, hasta, rol, dias, libraHoy, trabajaHoy, promedio }
```

- **Los coches** salen de dos sitios: los de la empresa de BOLT de Barcelona y los de **Vehículos con sede Barcelona** que no están de baja (`barcelona.repo.coches`). Camilo, 07/10/2026: hay coches de Barcelona que aún no están dados de alta en BOLT (la 3035LTX) y hay que poder planificarlos. Si BOLT conoce el coche, manda BOLT: activo, se ofrece; desactivado, solo sale si alguien lo lleva o está en un cuadrante, atenuado. Si solo está en Vehículos, se ofrece con el aviso «No está dado de alta en BOLT». Una matrícula que ya no es de la sede pero sigue en una plaza o en un cuadrante sale («ya no es de la sede») para poder vaciarla.
- **Las cifras**, de los coches que se pueden planificar: `turnos` son los que tienen que salir ese día (`cubiertos` + `huecos`); `libran`, los turnos que no salen porque libra el fijo de un coche sin CT (no son huecos); `conCT`, los coches con CT.
- `sinPlaza`: los activos sin **ninguna** plaza ese día. Quien libra o el CT al que no le toca ese día tiene plaza: no está sin plaza.
- Sin db/181 o sin db/234 el tablero devuelve `{ faltaMigracion: 'db/181' | 'db/234' }` y la pantalla lo dice en vez de dar un error. El reporte, la semana y la Visibilidad, sin db/234, siguen saliendo como antes (todos fijos y nadie libra, `planParaHoras`).
- **Un 42703 (no existe la columna) solo es «falta la migración» si `queFalta()` lo confirma**, y eso lo pregunta solo `migracionQueFalta` (el tablero y `planParaHoras`). `repo.faltaMigracion` es solo el 42P01: el reporte, la semana y la Visibilidad lo usan sin preguntar más, y con el 42703 dentro se tragaban una columna mal escrita como «falta la migración» (o como 0 €).

### La pantalla: lo que avisa (revisión del 06/11/2026)

`public/assets/js/vistas/Barcelona/barcelona-planificador.js` pinta el tablero tal cual llega; estas son las reglas que dice ella:

- **Los días de un CT no cambian solos al cambiar el bloque**, como en Madrid (que los copia una vez, al asignar). Si un día trabajan el fijo y el CT a la vez, la celda del CT no dice «cubre»: avisa en ámbar «trabaja … con el fijo» (sus días ya no son los del bloque). Y al guardar un bloque nuevo, si un CT del coche sigue con otros días, se dice quién y cuáles para cambiárselos en su columna.
- **El CT del cuadrante dice sus saltados por lo que son**: «2222BBB, lo lleva Eva: esos días ya los cubre otro» o «5555EEE no tiene días en su bloque: ponle antes el descanso», y cuántos se han puesto.
- **Con «Varios» CT en un cuadrante**, el selector sale sin nadie elegido: guardar así los quitaría a todos, así que antes se pregunta, con quiénes y de qué coches.
- **Un coche desactivado en BOLT** dice «desactivado» (BOLT lo manda como `deactivated`) y su turno sin nadie sale en gris, «no sale · coche desactivado»: no es un hueco y no cuenta en las tarjetas de zona, igual que en la cifra de Huecos del servidor.
- **«+ Coche» y «Meter en un cuadrante» mandan el día que se mira** (`fecha`), para que el tablero que vuelve sea ese.
- **La ayuda del chip del promedio** dice la regla de verdad: un día con horas cuenta siempre, tuviera plaza o no; no cuentan las libranzas ni los días sin plaza sin horas; el del mes anterior es de ese mes entero.

### El promedio (igual que Madrid, sin letra)

`barcelona.horas.promedios`, la regla de la casa ([[Promedio de horas]]): **horas ÷ (días que salió + ausencias a 0 h)**, a un decimal.

- **El periodo**: el mes corrido, del día 1 a ayer. Un día no está cerrado hasta las 12:00 del siguiente (acaba su noche): hasta entonces no cuenta.
- **Las horas de un día**: lo trabajado ese día, su turno de día más su turno de noche (viaje + espera), como la semana.
- **Salió**: un día cerrado con horas, **tuviera plaza o no**. **Ausencia**: un día cerrado en el que tenía una plaza que **trabajaba** ese día y no hizo nada. **No cuentan** las libranzas, los días sin plaza sin horas ni los de antes de su primera plaza. Barcelona no tiene fichas: no hay vacaciones ni bajas que mirar.
- **Mínimo, 5 días que salió**. Los primeros días del mes (el mes lleva menos de 5 días **cerrados**) se da **el del mes anterior** si llega a 5, rotulado, como la letra del mes cerrado de Madrid (db/175). Si no, **N/E** con el motivo («salió menos de 5 días en el mes (3)»). Se cuentan los cerrados y no los del calendario: el día 6 antes de las 12:00 el 05 aún no ha cerrado, el mes lleva cuatro y nadie puede llegar a cinco. Contando el calendario, toda Barcelona salía en N/E el día 6 de 00:00 a 12:00, también quien había salido todos los días (`periodosDelPromedio(hoy, ahoraMs)`).
- Cada persona lleva `{ horas, total, salio, ausencias, media, periodo, etiqueta, mesAnterior, ne }`: `horas` es el promedio, `total` las horas del periodo y `media` la de los días que salió (el detalle de la ayuda).
- **Al vuelo**, con tres minutos de memoria (`promediosGuardados`): Barcelona es pequeña. Con los datos reales de octubre (copia local, 19.232 apuntes) sale en 175 ms. Una escritura en un día ya pasado lo vuelve a calcular.

### Lo que NO se ha hecho todavía

La libranza excepcional, los eventos y el CT2, las vacantes y «Ver mis turnos» del bot para Barcelona. Son los siguientes pasos.

### Antes: fijo hasta que se cambie, sin libranzas (07/10/2026)

Una fila por matrícula y dos plazas, día y noche, **fijas hasta que se cambie** (lo eligió Camilo frente a planificar día a día). Un cambio no borra el pasado. Si eliges a alguien que ya estaba en otra matrícula del mismo turno, **se mueve**. Todo eso sigue igual; db/234 lo amplía.

## El reporte de horas (`/barcelona/reportes`)

Solo descargable, como los reportes de Madrid ([[Control Reportes]]): se eligen las fechas (hasta **31 días**; atajos Ayer, Últimos 7 días y Este mes) y baja un Excel con tres pestañas:

- **Por día**: una fila por día y plaza con conductor. Sus horas en **su turno**, viaje y espera, el coche de BOLT en que trabajó y si salió. Las horas llevan los colores del reporte de Madrid (verde desde 7,6 h, amarillo de 6,4 a 7,5, rojo menos).
- **Por conductor**: su **turno asignado y la matrícula** de su plaza, los días que le tocaba, los que salió y los que no, sus horas y la media de los días que salió. Arriba, quien más días no salió.
- **Sin plaza**: quien trabajó un día sin trabajar en ninguna plaza: sin plaza ese día, o en su día de libranza (columna «Por qué»: «Libraba (1111AAA)»).

En «Por conductor» va también **Libró** (los días que libró, que no son días que le tocaran).

**La regla de las horas es la de Madrid, no una copia**: `repartoTurnos.repartir` ([[Jornada y turnos]]) con el plan del planificador de Barcelona. Quien tiene plaza de **día** cuenta de 00:00 a 24:00; quien la tiene de **noche**, de 12:00 a 12:00 del día siguiente (Camilo: «de 00:00 a 23:59… desde las 12 PM hasta el día Y hasta las 12 PM»). Quien trabaja sin plaza va por su hora de inicio, como los NN. Cuenta el trabajo (viaje y espera), no el descanso; el catálogo de estados es el de Madrid (`fv_estado_bolt`).

**Los estados de cada plaza:**

| Estado | Cuándo |
|---|---|
| Salió | hizo algo en la ventana de su turno y la ventana ya cerró |
| Salió · en curso | ha hecho algo y su ventana sigue abierta |
| Aún no ha salido | su ventana está abierta y no ha hecho nada todavía |
| Por empezar | su ventana no ha empezado |
| **No salió** | le tocaba trabajar y no hizo ni un minuto en su ventana, ya cerrada |
| **Libra** | era su día de libranza (db/234): no le tocaba, y no cuenta como «No salió». Si trabajó, se dice en las observaciones: si ese día trabajaba en otra plaza suya (es CT en otro coche, o hace su turno de noche), sus horas van en la fila de esa plaza (*«Libraba; ese día trabajó en 2222BBB (CT)»*); si no tenía otra, van en «Sin plaza», por su hora de inicio |

**A quién le tocaba lo dice el plan del día** (`barcelona.plan.planDelDia`), no la asignación en crudo: el fijo que libra sale «Libra»; el **CT sale solo los días que cubre** (y con «· CT» en el turno). Hasta el 06/11/2026 Barcelona no tenía libranzas y todo el que tenía plaza tenía que salir.

En las observaciones se dice si trabajó **en otro coche** que el de su plaza, y lo que hizo **fuera de su turno** ese día (no se suma a su plaza).

**De los apuntes a las horas** (`barcelona.horas.js`). BOLT apunta cambios: cada apunte dura hasta el siguiente del mismo conductor. Dos en el mismo segundo se desempatan como en Madrid (`desempate.js`). Para saber cómo estaba cada uno al empezar la ventana se lee un día más de apuntes por detrás. Y **un estado de trabajo no dura más de 6 h sin otro apunte** (`BARCELONA_TOPE_ESTADO_H`): si el móvil se apaga en espera, BOLT no avisa y la espera duraría días. Con los datos reales del 04 al 07/10 (1.704 apuntes, 1.368 ratos de trabajo) el rato más largo fue de 3 h: el tope no recorta nada normal.

## Las horas semanales (en `/barcelona/reportes`)

Camilo, 07/10/2026: *«las horas semanales también en los reportes de Barcelona, solo de conductores, semanal de horas efectivas en BOLT; también se podrá la semana cursante»*.

- **Un Excel por semana**: cada conductor, de lunes a domingo, con sus horas efectivas en BOLT, el total, los días que trabajó y la media de esos días. Va de menor a mayor, así que arriba queda quien menos ha hecho, como la semanal de Madrid.
- **El turno asignado va al lado del nombre** (Camilo, 07/10: *«faltó la columna del turno asignado»*): columnas **Turno** (Día / Noche) y **Matrícula** detrás del teléfono. Si en la semana cambió de turno o de coche salen los dos («Día / Noche», «1111AAA, 2222BBB»); quien no tuvo plaza ningún día pone **Sin plaza**. Sale de las plazas de cada día (`plazasDistintas` en `barcelona.horas.js`), no de la de hoy.
- **Las horas de un día** son las de su turno de día más las de su turno de noche, con la misma regla que el reporte diario (`barcelona.horas.semana`). Un día no se cierra hasta las 12:00 del siguiente.
- **Salen** las cuentas activas de BOLT Barcelona y cualquiera que haya trabajado esa semana. Las que ya no están activas llevan «(ya no activa en BOLT)».
- **Cada día lleva su nota** con cuánto fue de día y cuánto de noche y en qué plaza estaba (o «Sin plaza»). Un **0 en rojo** significa que le tocaba trabajar y no salió; una **L** en gris, que libraba.
- **La semana en curso** también se puede sacar. Los días que aún no han terminado van en azul y los que faltan, en blanco.
- **La semana se elige con el calendario de la casa** (`js-fecha`): cualquier día vale por su semana. Debajo se dice cuál es, y hay atajos para «Esta semana» y «La pasada».

Con datos reales (07/10), la semana del 28/09 da 565,6 h entre 26 conductores, 19 de ellos con horas. **La historia de Barcelona empieza el 30/09 a mediodía**, los 7 días que trajo la ingesta al aplicar db/181: por eso ese lunes y ese martes salen a cero.

## La Visibilidad (`/barcelona/visibilidad`)

Camilo: «con las mismas métricas». Por eso **es la misma pantalla y son las mismas cuentas** que la Visibilidad de Madrid, no una copia: `views/visibilidad.ejs` recibe `api` (dónde preguntar) y `sedeNombre`, y las fórmulas salieron de `services/visibilidad.js` a funciones puras que usan las dos sedes:

- `metricas(h, d)`: horas efectivas, viaje, espera, descanso, utilización, conductores, neto, viajes, €·hora y viajes·hora de una ventana.
- `sliceDeTurno(x)`: las tarjetas de turno (día, noche y la jornada de ayer).
- `armarSerie({ fotos, dm, config, dinero })`: el acumulado, el ideal, el crítico y la brecha del mes, y sus totales.

Al separarlas se comprobó contra producción (solo lectura) que la Visibilidad de Madrid daba **lo mismo antes y después**: agosto, septiembre, octubre sin hoy y el resumen.

Lo que cambia es de dónde salen los datos (`modules/Barcelona/visibilidad.service.js`):

| | Madrid | Barcelona |
|---|---|---|
| Horas | Flota viva (`fv_tramo`) | sus apuntes de BOLT (`sede_bolt_state_log`), pasados a ratos como en el reporte |
| Neto y viajes | `bolt_order` | sus pedidos (`sede_bolt_order`, db/182) |
| Turnos | el cuadrante (`f_cobertura`) | su planificador; quien no tiene plaza, por su hora de inicio |
| Configuración | `visibilidad_config` · `parametros` | `visibilidad_config` · `parametros_barcelona` |
| La serie del mes | fotos diarias (`visibilidad_dia`) | al vuelo: son una veintena de conductores |
| Los gráficos largos (25/10/2026) | fotos + histórico de BOLT (db/217) | sus días al vuelo, desde su primer apunte (30/09/2026) |

**Los gráficos de la tendencia** (25/10/2026: el rango de los días, «cómo vamos» y «cómo hemos crecido», ver [[Visibilidad#Los gráficos (25/10/2026)]]) son las mismas piezas de `services/visibilidadTendencia.js`; Barcelona solo pone sus días (`diasDeLaSede`) en `/barcelona/api/visibilidad/rango`, `/crecimiento` y `/como-vamos`. Su primer día es de media tarde y su septiembre, un día: por eso un % solo se da entre meses con 7 días con datos o más, y el «frente al periodo anterior» de un rango, con el 90 % de sus días.

**«A esta hora»** (30/10/2026, Camilo: *«ponlo también en la Visibilidad de Barcelona»*, ver [[Visibilidad#A esta hora (30/10/2026)]]): hoy contra ayer, anteayer y el mismo día de la semana pasada hasta la misma hora, por día natural, por turno y por jornada. La hora, los días y los % son los de Madrid (`momentoAEstaHora` y `armarAEstaHora` en `services/visibilidad.js`); Barcelona pone sus horas (sus ratos de ocho días) y sus turnos (`repartir` con el plan de su planificador, cortando cada día a esa hora). `/barcelona/api/visibilidad/a-esta-hora`. Al separar las piezas, Madrid dio exactamente lo mismo que antes (26/10 a las 12:28 y a las 10:15).

**Sin meta de partida.** No hay una meta de Barcelona que copiar, y una inventada pintaría un ideal y una brecha que no miden nada. Hasta que se ponga en *Config*, la pantalla enseña las horas sin el ideal, el crítico ni la brecha (en la tabla, «·»). Los coches, si no se dicen, son los activos en BOLT.

Con datos reales de BOLT (07/10, script `barcelona-visibilidad-prueba.js` de los análisis): el 06/10, 121,9 h efectivas, 78,2 % de utilización, 18 conductores, 2.810,98 € y 23,05 €/h.

## Mantenimientos (`/barcelona/mantenimientos`)

Camilo, 04/11/2026: *«habilitar en mantenimientos los coches de Barcelona, replica el módulo en el sistema de Barcelona, con los coches que estén en el ERP como sede Barcelona»*.

**Es el módulo de Madrid con sus coches, no una copia**, como la Visibilidad. La regla de cuándo toca revisión (odómetro de hoy menos el km de la última revisión, el ritmo de los últimos 30 días y el semáforo) vive en `modules/Vehiculos/taller.*` ([[Vehiculos#Taller: el mantenimiento por km]]), y las tablas son las mismas (`mantenimiento`, `odometro_ancla`, `vehiculo_km_dia`). Un apunte es de un coche, y el coche ya dice su sede. Con dos copias habría dos semáforos que tarde o temprano dirían cosas distintas del mismo coche.

- **Los coches** son los de Vehículos con **sede Barcelona** y sin baja: 20 el 04/11. 16 dan su odómetro por el CAN de Mapon (el cron diario los lee igual que los de Madrid). Los otros 4 salen «sin Mapon» y sin odómetro: 2127LZJ, 2928KGL, 8074LXG y 8477LTR. Un coche que se pase a Barcelona en Vehículos aparece aquí y deja de salir en el de Madrid.
- **La pantalla es la de Madrid** (`modules/Vehiculos/vistas/taller.ejs`), que recibe `base` (dónde preguntar), `sedeNombre` y `citasAgenda`. Las tarjetas, la tabla, la ficha, apuntar, anular, anclar el odómetro y el intervalo son los mismos.
- **Mirar** no tiene llave, como el resto de Barcelona. **Apuntar** pide la misma que en Madrid, `/taller/apuntar` (Óscar y los roles que lo pueden todo). La regla está en `taller.service.puedeApuntar`, una sola para las dos sedes.
- **La sede se fija en un solo sitio**, `mantenimientos.service.js`: todo lo que pasa por ahí lleva `sedes: ['barcelona']`, para leer y para escribir. El servicio del taller rechaza una escritura en un coche de otra sede («Ese coche es de otra sede…»), y la ficha no lo abre. El id va en el cuerpo de la petición, así que esconderlo de la lista no bastaba. Vale en los dos sentidos: desde Madrid tampoco se apunta en un coche de Barcelona.
- **El informe** (Excel y PDF) lleva solo sus coches, «· Barcelona» en cada título y se llama `taller-barcelona-AAAA-MM-DD`.
- **El estado «B»** (Baja) que llevan sus coches para que el planificador de Madrid no los ofrezca (db/173) **no se enseña**: en esta pantalla diría «Baja» de 20 coches que trabajan.
### Las citas del taller: solo agenda (04/11/2026)

Camilo: *«pon también las citas del taller para Barcelona… pero sin envíos de WhatsApp… ni confirmaciones, solo agregar citas»*.

- **Se añaden** como en Madrid ([[Citas del taller]]): con el **Excel del taller** o con **«Nueva cita»** (también desde la ficha del coche, «Poner cita»). Las reglas son las mismas: un coche, una cita por día; solo coches de Barcelona dados de alta; el Excel dice qué matrículas no entran y por qué («No es de Barcelona: es de Madrid»).
- **Se ven** en la pestaña «Citas del taller», con su día, su hora y de dónde salen (el Excel o quién la puso), y en el estado de la flota como «Cita puesta para revisión».
- **Se anulan** (Camilo, 04/11/2026: *«ponle también anular las citas»*): cada cita pendiente tiene «Anular», con el **motivo obligatorio**, que queda en su seguimiento con quién la anuló. Sale atenuada con la pastilla «Anulada» y deja de salir en el estado de la flota. Para volver a ponerla, «Nueva cita» ese mismo día: recupera la anulada con la hora nueva, como en Madrid. Solo anular: ni «hecha» ni «no se presentó» (`mantenimientos.service.anularCita`).
- **Y nada más.** Sin quién lleva el coche (eso lo dice el planificador de Madrid), sin aviso por WhatsApp, sin confirmación y sin llamadas de Control. En Barcelona no hay rutas para eso: devuelven 404.
- **Lo que lo decide es la sede del coche**, no la pantalla. Una cita de un coche que no es de Madrid es de agenda (`citas.service.esAgenda`), y avisar, marcarla avisada, la llamada de Control y la respuesta a un botón la rechazan aunque alguien mande su id a mano. El aviso automático de las 10:00 solo busca citas de Madrid (`repo.paraAvisar(fecha, sede)`, que sin sede se niega a buscar). Las listas de Madrid y de Control piden solo las de Madrid.
- Van en la **misma tabla** (`taller_cita`, db/187): no hace falta migración.

## La recaudación del efectivo (`/barcelona/recaudacion`, 05/11/2026, db/230)

Camilo: *«Déjame listo la recaudación de efectivo en Barcelona, de la misma forma»*. Es **la misma recaudación de Madrid** ([[Administracion]]): la misma pantalla y el mismo código, con quincenas, el cierre de BOLT congelado, ajustes con motivo, caja, cambio, transferencias y «¿Cuadra?». Lo que cambia:

- **Su caja y su deuda, aparte.** Van en sus tablas, `sede_recaudacion_cierre` y `sede_recaudacion_movimiento` (db/230: las de Madrid copiadas con `LIKE … INCLUDING ALL`, vacías). Nada de lo que se cobre aquí suma en Madrid, ni al revés.
- **Su efectivo sale de sus pedidos** (`sede_bolt_order`), no de `bolt_order`. db/182 no guardaba el método de pago ni el desglose del precio; db/230 los añade, y la ingesta los guarda desde entonces (`otrasSedes.guardarPedidos`).
- **Sin fichas: cada persona es su cuenta de BOLT** de la empresa de Barcelona (`soloCuentas`). Cobrar, la transferencia, el cambio, el ajuste y la ficha van por la cuenta (`bolt_uuid`), y una cuenta de Madrid se rechaza. En el cuadro salen las que deben algo, las que tienen movimientos y las que tienen el efectivo activado sin estar desactivadas. «En plantilla» quiere decir **cuenta activa en BOLT**.
- **La deuda empieza el 1 de noviembre de 2026** (lo eligió Camilo, para no sacar como deuda lo de octubre). Es el corte, y sale de `PAGO_DESDE` en `services/repo/otrasSedes.js`, que es también desde cuándo se relee el pago. No hay «Pegar a mano»: antes del corte no hay histórico que volcar.
- **Los pedidos de antes de db/230 se releen solos.** Del 1 de noviembre en adelante, los pedidos terminados sin método de pago se le vuelven a pedir a BOLT en la tarea de pedidos de otras sedes (`primerPedidoSinPago`, como mucho de los últimos 31 días). Releídos todos, la ventana vuelve a ser la de 48 h. Hasta entonces, la deuda de esos días sale baja.
- **Antes de aplicar db/230**, los pedidos de Barcelona se siguen guardando como hasta hoy (sin el pago), para que su Visibilidad no se quede sin datos. La recaudación de Barcelona da error hasta que se aplique, y su cron se calla.
- **Llaves propias** (lo eligió Camilo): `/barcelona/recaudacion` para entrar y cobrar, y `/barcelona/recaudacion/nomina` para los descuentos de nómina. Las dos nacen apagadas para todo el mundo, como las de Madrid, y se dan en `/usuarios`. El menú de Barcelona solo enseña «Recaudación» a quien tiene la llave.
- **El cron** de cada media hora (`app.js`) pone al día Madrid y, aparte, Barcelona.

Comprobador: `scripts/comprobar-recaudacion-sedes.js` (sin base: mira que cada sede solo nombre sus tablas y su efectivo).

## Las piezas

```
barcelona.controller.js   las rutas (sin lógica)
mantenimientos.controller.js · mantenimientos.service.js
                          Mantenimientos: el taller de Madrid con la sede fijada en Barcelona
visibilidad.service.js    la Visibilidad: los datos de Barcelona con las cuentas de Madrid
recaudacion.controller.js · recaudacion.service.js
                          la recaudación de Madrid armada con sus tablas, su efectivo y su llave
barcelona.service.js      el planificador (el tablero de un día, las comprobaciones de cada escritura) y el reporte
barcelona.plan.js         puro: las reglas del plan (quién trabaja, quién libra, dónde hay hueco, quién dobla)
barcelona.horas.js        puro: de los apuntes de BOLT a los ratos de trabajo, el reporte y la semana con el
                          plan del día, y el promedio de horas
barcelona.excel.js        el Excel del reporte
barcelona.repo.js         el SQL: cuentas, coches, el planificador (asignaciones, CT, descansos, zonas y
                          cuadrantes), apuntes, pedidos (con la sede como parámetro)
vistas/barcelona-planificador.ejs · vistas/barcelona-reportes.ejs
```

Comprobador: `scripts/comprobar-barcelona.js` (sin base: el repositorio se sustituye por datos de mentira). Mira las reglas del plan (con CT y sin él, cambios de descanso con fechas, CT con días), el tablero con la forma del contrato, las comprobaciones de cada escritura, el reporte con «Libra», la semana, el promedio (mes corrido, ausencias, libranzas, mínimo de 5 días, mes anterior) y lo que pasa sin db/181 o sin db/234. Desde la revisión del 06/11/2026 mira también los 13 arreglos (cada prueba lleva su número, «[0]»…«[12]»): la plaza de CT hasta el fin del periodo, los bloques con lo escrito para más adelante, las fechas que no existen, el día 6 del promedio, la fila «Libra» con otra plaza, el 42703, y **la pantalla de verdad** cargada en un `vm` con los componentes de la casa de mentira.

Lo que vive en la base o en el SQL del repositorio (db/235, el auto-corte de `asignarEn`, el choque de bloques y las fechas que no existen contra PostgreSQL) se probó el 06/11/2026 contra la copia local con el servicio de verdad, cada caso **en su transacción con ROLLBACK** comprobado por una huella de las tablas, la función y el disparador; también con db/235 puesta en todos los casos, para ver que el disparador nuevo deja pasar lo que tiene que dejar pasar (cerrar la víspera, quitar el CT, adelantar el «desde» de una plaza de CT).

db/234 se ensayó el 06/11/2026 contra la copia local **dentro de una transacción con ROLLBACK**: la migración entra dos veces, las exclusiones paran los solapes que tienen que parar, y el servicio con el SQL de verdad crea zonas y cuadrantes (con el número libre), fija descansos, activa y desactiva el CT, pone el CT del cuadrante, mueve a un fijo y saca el reporte, la semana y la Visibilidad. El reporte de ayer dio lo mismo antes y después de aplicarla.

## Ver también

[[Sedes]] · [[Planificacion]] · [[Vehiculos]] · [[Ingesta]] · [[Jornada y turnos]] · [[Usuarios y permisos]]
