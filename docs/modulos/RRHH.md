---
tags:
  - modulo
  - rrhh
  - convenio
  - jornada
  - ausencias
  - justificantes
  - nomina
  - postgres
---

# RRHH

Lo que el convenio VTC obliga a llevar: la jornada de cada trabajador contra su objetivo, el cierre del periodo, la nómina que se manda a la gestoría y el cuadro de absentismo. El módulo está en `modules/RRHH/` y se entra por `modules/RRHH/convenio.service.js`, nunca por `convenio.repo`.

```
/convenio             la jornada del mes
/convenio/cierre      cerrar un periodo (y regularizar en el siguiente)
/convenio/nomina      la nómina, con su export a la gestoría
/convenio/absentismo  el cuadro por módulos del convenio
/pendientes           el buzón (sus datos salen de /notificaciones)
```

Alrededor del módulo, y por razones que se explican abajo, hay tres cosas que son de RRHH pero **no viven aquí**: las ausencias y las altas/bajas están en la ficha del conductor ([[Conductores]]), los justificantes en `services/repo/justificantes.js`, y las vacantes en `modules/Seleccion/vacantes.repo.js`.

## Qué cuenta como hora, y qué no

Esta es la pregunta que el módulo existe para contestar, y tiene **dos respuestas distintas a propósito**, porque el convenio y la operación no miden lo mismo.

### La cuenta del convenio (art. 18.6)

`modules/RRHH/jornada.repo.js` coge el hilo de cambios de estado que BOLT reporta de un conductor en un día y lo convierte en **asientos** del ledger, cada uno etiquetado con su supuesto del art. 18.6. La regla **no está en el código**: está en la tabla `cat_estado_te` de la base. Cambiar cómo cuenta la espera es un `UPDATE` allí, no tocar el fichero.

- **Viaje con pedido** (`has_order`) → asiento `EFFECTIVE_WORK`, supuesto **TE_A3**. Trabajo efectivo sin discusión.
- **Espera** → genera asiento **siempre**, para que las horas totales sean `has_order + waiting`, pero el supuesto cambia: **TE_A1** si está dentro del área, **TE_NO** si no. TE_NO suma en las totales y **no** en las estrictas.
- **Tareas auxiliares** → **20 minutos** automáticos al día si hubo algo de actividad (art. 18.6.c), supuesto TE_C. Un solo asiento diario, no por tramo.
- **Descanso y desconexión** → nada.

Un tramo va desde su log hasta el siguiente, con la hora **real** del apunte. Un estado que dura más que el tope se **recorta a 12 horas** (`JORNADA_MAX_TRAMO_MIN`): si BOLT deja de reportar sin pasar por `inactive`, ese hueco no es tiempo trabajado. La idempotencia es por tramo (`bolt:<conductor>:<inicio>`), así que rederivar un día no duplica nada.

> **LA ESPERA NO CUENTA COMO TRABAJO, Y NO ES UN FALLO DEL CÓDIGO.** El art. 18.7 dice que estar conectado esperando solo es trabajo efectivo si estás **dentro del área**. El área se prueba con las zonas de Mapon, y hoy hay **17 cruces de zona en dos semanas, sobre 2 zonas**, para una flota de ~100 coches. Consecuencia: de los minutos derivados, **138.481 de espera caen a TE_NO y CERO a TE_A1**. Son **2.308 horas en trece días** que el convenio no reconoce como trabajo.
>
> El cálculo es correcto; lo que falta es configurar las zonas en Mapon. Hasta que se haga, el "cumplido estricto" del panel va a salir muy por debajo del total, y la diferencia es exactamente la columna `espera_fuera_area`.

### La cuenta de la operación

La otra medida —la que usan la bitácora, el reporte de Control, la nómina variable y la [[Calificacion de conductores|calificación]]— es **horas efectivas de BOLT (viaje + espera, sin descanso) más las horas justificadas del día**, y **se suman**: dos horas en el taller con su J más seis rodando son ocho horas, no seis. Esa es la cuenta que entiende un conductor.

Las dos conviven porque contestan preguntas distintas: una es una obligación legal con su propia definición de trabajo efectivo, y la otra es cuánto trabajó alguien de verdad. Ver [[Jornada y turnos]].

### Los minutos van en minutos

No en horas decimales. El convenio los cuenta así y la gestoría los teclea así.

## El motor: lo que estaba escrito y no estaba enchufado

El Hito 2 —convertir los cambios de estado de BOLT en asientos del convenio— estaba **escrito desde hacía meses y no lo llamaba nadie**. `jornada.repo` no aparecía en un solo `require` del proyecto. Resultado: cero contratos, cero objetivos, cero asientos, cero registros, y las cuatro pantallas de `/convenio` en blanco pareciendo rotas.

Lo que faltaba está en `modules/RRHH/convenio.motor.js`, en el orden en que hay que hacerlo:

```
1. CONTRATOS   sin contrato no hay objetivo: objetivo_mensual cuelga de contrato
2. OBJETIVOS   sin objetivo no hay contra qué comparar
3. DERIVACIÓN  los asientos y el registro del art. 18.9
```

La derivación sí se puede hacer sin lo anterior —cuánto trabajó alguien es un hecho, no depende de su contrato— y por eso se hace **para todos**.

Se enchufa por tres sitios: el **cron de las 05:50** (deriva ayer; el día 1 de cada mes abre contratos y publica objetivos), las **rutas `/convenio/api/motor/*`** (para arrancar, ponerse al día o saber por qué algo sale vacío) y `convenio.service`, que es la puerta por la que entra el cron.

El cron va **después** del sellado de la bitácora (05:35) a propósito: las dos leen lo mismo y no hay razón para que se pisen en el pool. Y deriva **ayer y no hoy**: la jornada de hoy no ha terminado, y la de un turno de noche ni siquiera ha empezado a cerrarse. Los objetivos se **comunican por anticipado** (art. 18.1), así que tienen que existir el día 1, no el 30.

### Las cuatro decisiones que se tomaron

**Contrato solo para plantilla propia.** El objetivo mensual, el cierre y la nómina son obligaciones nuestras; a la gente de la ETT la contrata la agencia. Lo que sí se les calcula es el **registro de jornada**, porque cuántas horas hizo alguien en nuestros coches es un hecho y hace falta para el parte de la agencia.

**Grupo G3A por omisión** (conductores de aplicación): es lo que son casi todos y lo que el propio esquema documenta como normal. Quien no lo sea se corrige a mano — abrir un contrato mal es mejor que no abrirlo, porque **uno equivocado se ve y uno que falta no**.

**40 horas cuando no consta.** 77 de las 215 personas no tenían `jornada_horas` anotada; 40 es la jornada completa y la que tienen 123 de las 138 que sí la llevan. Sale contado aparte en el resultado, para que RRHH sepa a cuántos hay que mirarles la ficha.

**El contrato empieza el día del alta**, aunque sea de 2022. El objetivo se prorratea por días de alta **en el mes**, así que una antigüedad larga no inventa objetivos de meses viejos.

### El agujero que apareció al generar objetivos de verdad

`f_objetivo_min` prorrateaba las **1.776 h** del convenio por días de alta **y nada más**: a quien tiene 32 horas le exigía lo mismo que a quien tiene 40, **un 25 % de más todos los meses**. Con `contrato` vacío no se notaba.

`db/112` añadió `contrato.horas_semana` y escala el objetivo por ella, leyendo la semana completa de `agreement_parameter` (`NON_DRIVER_WEEKLY_HOURS`) y no de una constante. Comprobado contra las seis combinaciones que hay en producción: 40 h y mes completo → **8.758 min**; 32 h → **7.007**; y los prorrateos de 28, 27, 26 y 23 días de alta, todos clavados.

### Dos consultas que hacían la derivación inviable

Derivar un día tardaba **cuatro minutos**, y esto corre cada noche:

- `enArea` se preguntaba **una vez por tramo de espera** —~1.700 al día— contra una base que está en Frankfurt. Pasó a una sola ida y vuelta (`staging.enAreaVarios`): medido, **37× más rápido** y la misma respuesta.
- `guardarAsientos` insertaba **de uno en uno**. Ahora es un `unnest` con el mismo `ON CONFLICT`: la idempotencia no depende de cuántas filas viajen juntas.

Con las dos, un día baja a **17 segundos**, y los 13 días de historia que había en `bolt_state_log` se derivaron en dos minutos.

## El panel del mes, el cierre y la regularización

**El mes por defecto es el ÚLTIMO CON OBJETIVOS, no el de hoy.** Los objetivos se cargan por adelantado y el mes en curso casi nunca es el que se está revisando. Se resuelve en el servidor para que el selector y la primera carga salgan ya en el mes correcto, sin un parpadeo. Y si la base no contesta, se cae al mes natural y la pantalla sale igual: **un fallo de lectura no puede dejarla en blanco**.

El panel es un trabajador por fila con su conciliación del mes al lado. Va con `LEFT JOIN` a propósito: si el mes no tiene objetivo ni movimientos, la fila sale igual con huecos, que es más honesto que esconderla.

**Cerrar un mes es irreversible y deja rastro.** Fotografía, congela y sella con un **manifiesto**, y queda apuntado quién lo hizo. Es la pieza que hace que un periodo cerrado siga diciendo lo mismo dentro de un año, que es lo que pide una inspección.

**La regularización va al mes abierto siguiente, no hacia atrás.** Corregir un mes cerrado rompería el sello; lo que sobra o falta se apunta en el primer mes abierto. Si no se dice cuál, se toma el siguiente al cerrado.

`modules/RRHH/convenio.repo.js` **solo lee**. Ni una cuenta del convenio vive ahí: todas están en funciones y vistas de la base ([[Base de datos]]). Es el cristal por el que se miran, no otra copia de la lógica.

## La nómina a la gestoría

`modules/RRHH/nomina.excel.js` genera el libro. Tres reglas que parecen de formato y no lo son:

- **La nómina y los finiquitos van en hojas separadas**, y la segunda **solo si la hay**. Son dos trámites con dos plazos distintos: la nómina se presenta el mes que viene y un finiquito se paga al irse la persona. Mezclados en una tabla, el finiquito se cuela como un trabajador más con un importe raro. Y una hoja vacía en un libro que va a la gestoría es una pregunta garantizada por correo.
- **Un hueco vacío no es un cero.** `null` deja la celda en blanco y un cero dice "se calculó y salió cero". En una nómina esa diferencia se discute.
- Los minutos, en minutos.

## Ausencias

Las ausencias se ponen desde la ficha del conductor y viven en `conductor_estado_hist`, con su catálogo `cat_estado_conductor` (`modules/Conductores/conductores.repo.js`). Lo que hay que saber:

**Una ausencia NO cierra la asignación**: la persona conserva su plaza. Para que otro lleve su coche mientras tanto está *cubrir ausencia* en el [[Planificacion|planificador]].

**La fecha de vuelta es obligatoria en lo que tiene vuelta** (vacaciones, permiso). Sin ella la ausencia no termina **nunca**: se guardaba `hasta` en NULL y todas las pantallas —cobertura, planificador, bitácora— leen eso como "está fuera indefinidamente". Pasó de verdad: unas vacaciones del 13/09 sin cerrar dejaron a esa persona de vacaciones **hasta fin de año**. En una baja médica no se pide, porque ahí la fecha la pone el alta; pero **si la hay, se guarda** — `fin_previsible` decide si la fecha es obligatoria, nunca si está permitida. Antes la línea tiraba la fecha escrita en cualquier ausencia sin fin previsible, y el 09/09 dos partes que decían "del 08 al 10" y "hasta el jueves" se guardaron abiertos: esas dos personas desaparecieron del cuadrante indefinidamente. Un parte de **un solo día** no tenía forma de entrar.

La ausencia nace **cerrada** en esa fecha, no solo "prevista": así el día que toca vuelve al cuadrante sola, sin que nadie tenga que acordarse. Si no vuelve, se amplía — que es justo lo que se quiere mirar.

Hay tres operaciones distintas y no son intercambiables:

| Operación | Qué hace | Cuándo |
|---|---|---|
| **Cambiar situación** | Abre una situación nueva desde una fecha y cierra la anterior | Algo cambia de verdad: alguien vuelve antes, alguien se pone malo |
| **Añadir ausencia** | Mete un tramo suelto sin tocar nada de lo que ya hay | Vacaciones partidas: 13 días este mes y 3 en noviembre |
| **Editar / borrar ausencia** | Corrige la fila que ya está | Hay un **error**: el 13 en vez del 15, unas vacaciones a quien no le tocaban |

Añadir no cierra ni recorta nada: o el tramo cabe en un hueco libre, o se dice **cuál** es el que estorba, con su etiqueta y sus fechas. Y si el que estorba está abierto sin fecha de vuelta se dice también, porque mientras siga así no cabe ningún tramo después y el otro se quedaría probando fechas a ver cuál entra.

**Irse de la empresa no es una situación en la que se esté**: es el final del contrato. Pero la gente la busca en la lista de situaciones, que es donde tiene sentido buscarla, así que se sigue ofreciendo y hace **exactamente lo mismo** que el botón de dar de baja — no algo parecido. Dos puertas, un solo camino. Antes escribía una fila de estado y ya: la ficha decía "Baja en la empresa" con el contrato abierto, y el resto del sistema seguía contando con esa persona.

## Justificantes

Tráfico justifica el día a un conductor que no llegó a horas (`services/repo/justificantes.js`). Un justificante:

- guarda (o actualiza) el justificante **vivo** del día — uno solo por conductor y día, por índice parcial;
- escribe la marca **'J'** en `bitacora_dia`, con enlace al justificante;
- y sus **horas se SUMAN** a las de BOLT (`horas_seg_momento`).

Todo por `conductor_id`, siempre. La resolución por nombre que hubo aquí se retiró con la ruta que la usaba: **el nombre no identifica a nadie**.

Hay **cinco tipos de J**, y el criterio es **quién responde de ella**: `trafico`, `rrhh`, `bolt`, `taller`, `companero`. Una J de tráfico la aprueba Tráfico; una de RRHH, RRHH. El tipo agrupa y enruta; la observación —que es **obligatoria**— explica.

Dos protecciones que vienen de fallos reales:

- **Una libranza puesta a mano por RRHH no se pisa con una J sin que nadie lo vea.** Antes la J la machacaba y, al anularla, se borraba la fila entera y la L manual desaparecía sin aviso. Ahora hay que quitar la libranza primero.
- **"7,5" vale.** Es lo que escribe una persona en España; sin eso acababa en `NaN` y PostgreSQL contestaba con un error críptico. Ni negativas ni más de 24.

Un justificante **vivo protege el día** aunque no sume horas: no cuenta como cero en el promedio. Ver [[Calificacion de conductores]].

## Vacantes y recambios

Una vacante es un conjunto de **plazas reales** que se prometen a alguien que todavía no está (`modules/Seleccion/vacantes.repo.js`). Antes era una fila de la hoja `VACANTES` con las matrículas dentro de una celda en JSON; ahora es una fila con sus plazas colgando, y eso cambia tres cosas que se notan al usarlo:

- Se sabe **qué plaza está comprometida**, así que el planificador puede pintarla reservada y no se puede prometer el mismo sitio dos veces.
- Existe el **RECAMBIO**: una vacante sobre una plaza que **tiene dueño** y que se va a quedar libre. Antes solo se sabían generar vacantes de huecos vacíos, que es la mitad del trabajo. Colocar al nuevo cierra la asignación del que se va la víspera, así que el relevo queda encadenado **sin un solo día de coche parado**.
- Selección la señala por clave foránea, así que se puede contestar *"quién viene a esta plaza y cuándo"*.

**La jornada no se teclea: sale de las plazas.** Un fijo lleva su coche toda la semana, son 40 h. Un correturnos cubre los días de descanso de los fijos de dos o tres coches: con 4 días son 32 h y con 6 son 40. Quien monta la vacante elige plazas; el contrato que se ofrece lo dice el catálogo (`cat_jornada.dias_ct`).

Cuando alguien se da de alta con vacante nace la **incorporación**, la alerta que Tráfico acepta o rechaza desde el planificador. Antes la vacante guardaba matrículas, así que aceptar significaba salir a buscar una plaza libre de ese coche y turno: si entre la promesa y el alta alguien la ocupaba, el alta fallaba en el último paso **con la persona ya contratada**.

## Altas y bajas

Se hacen desde la ficha (ver [[Conductores]]), pero las reglas son de aquí:

- **Existir y estar contratado son dos cosas distintas.** `crearPersona` mete a alguien sin contrato —un candidato de Selección—; `darDeAlta` abre su periodo de empleo. Desde el primer momento tiene las garantías de la base: su DNI no se puede repetir y su teléfono no puede ser el de otro.
- **Dar de baja cierra TODO en la misma transacción**: empleo, situación, turno, libranzas y asignaciones. Dejar una asignación abierta de alguien que ya no está haría que su coche siguiera apareciendo cubierto.
- **Un alta futura no se da de baja: se cancela.** Es un contrato que nunca arrancó —una prueba, un alta cancelada—, así que se borra lo que empieza en el futuro y se cierra a hoy lo que ya estuviera en marcha.
- **Pasar de ETT a plantilla propia no es una baja seguida de un alta.** La persona sigue en su coche y en su turno, y la antigüedad de la ETT se arrastra al contrato nuevo.
- **Cambiar la jornada (40 → 32) es una novación, no un contrato nuevo.** Toca la fila que hay: la antigüedad, el número y la relación laboral siguen siendo los mismos, y partir el periodo dejaría dos altas donde solo hubo una. Queda en el historial quién lo cambió y de qué a qué — lo que se preguntará el día que una nómina no cuadre.
- La lista de jornadas del desplegable (18, 20, 21, 24, 25, 27, 29, 30, 32, 35, 40) **ya no decide qué es válido**: la relación de contratos de la ETT trajo jornadas de 18, 21, 24, 27 y 29 horas, así que la lista cerrada era un dato disfrazado de código. Lo que manda es el CHECK de la base (`db/130`): un entero de 1 a 40.

El **Excel de la gestoría** (`modules/Conductores/gestoria.excel.js`) es la misma pestaña que nos mandan ellos, devuelta con nuestros datos, y **solo con plantilla propia**: a la gente de la ETT la contrata la agencia, y mandárselas a nuestra gestoría sería pedirle que tramite a gente que no es nuestra. El filtro está en la consulta, que es donde no se puede desactivar sin querer.

## El reporte de horas de la ETT

`modules/RRHH/reporteEtt.service.js` manda por correo, con su Excel, las horas de ayer de los conductores que vienen por ETT. Es de lo poco que este sistema escribe y lee alguien de fuera: **lo que diga ahí es lo que se factura**.

Salían de la hoja `Datos_API`, que un cron rellenaba desde BOLT. Esa hoja se cortó, y con motivo: **los crons que la llenaban llevaban apagados desde el 03/09**, así que el reporte habría salido con ceros para todo el mundo y con la misma cara de siempre.

Ahora las pide a la Bitácora, y eso tiene dos consecuencias:

1. **La jornada es 05→05, no el día natural.** Un turno de noche que empieza el lunes a las 21:00 y acaba el martes a las 05:00 cuenta entero en el lunes. En la hoja se partía por medianoche y esas horas aparecían en dos días distintos. Ahora la Bitácora, el reporte de Control, Visibilidad y este dicen lo mismo.
2. **Lo sellado no se mueve.** Si un día ya se cerró, se leen sus horas tal como quedaron. Enlazar hoy una cuenta de BOLT no cambia lo que se le facturó a la ETT la semana pasada.

Y "de la ETT" no es una etiqueta escrita a mano: es tener un periodo de empleo de tipo `ett` vigente **ese día**. Quien pasó a plantilla propia ayer sigue saliendo en el reporte de anteayer, que es cuando trabajó para ellos.

## La ticketera de RRHH: sigue fuera, y por qué

`/rrhh`, `/peticiones` y `/ticketera` **no se mudaron al módulo**. Las tres cuelgan de Google Sheets:

| Ruta | Motor | Además |
|---|---|---|
| `/rrhh` | `services/tickets.js` (880 líneas, sobre hojas) | lo usan también `administracion`, `botPuertas`, `fichas` y `notificaciones` |
| `/peticiones` | `services/peticiones.js` (hojas) + `planificadorV2` | |
| `/ticketera` | `services/ticketsRRHH.js` (hojas) + `planificadorV2` | |

Es la misma regla que dejó fuera a `agenda`, `fichas` y `libranzas`: meterlas en un módulo sería meter Sheets dentro, en la dirección contraria a la que va el proyecto. Y `tickets.js` tiene un agravante propio —lo consumen cuatro rutas de fuera—: mudarlo obligaría a media casa a entrar por la puerta de RRHH para algo que hoy es infraestructura compartida. Se mudan cuando esa parte pase a PostgreSQL. Ver [[Reglas de la casa]].

Lo que sí está en el módulo es `/pendientes` (`modules/RRHH/pendientes.controller.js`): una pantalla sin dominio detrás, cuyos datos salen de `/notificaciones`.

## Lo que aún no está bien

**Absentismo y nómina siguen vacíos**, y eso sí son otros hitos: las ausencias del convenio (Hito 4) y las variables de nómina (Hito 8) tienen sus propias tablas y nadie las ha llenado. El panel de jornada, que es lo que arregla el Hito 2, ya sale con sus **145 personas**.

Y queda pendiente lo de las zonas de Mapon: hasta que se configuren, el cumplimiento estricto del convenio seguirá saliendo muy por debajo del real.
