---
tags: [modulo, barcelona, sedes, planificador, horas, taller]
ruta: /barcelona
codigo: modules/Barcelona
fecha: 2026-10-07
---

# Barcelona

Camilo, 07/10/2026: «en el login ahora va a aparecer Barcelona o Madrid». Barcelona **no necesita fichas ni altas**: sus conductores son sus **cuentas de BOLT** (nombre y teléfono) y sus matrículas, los **coches de su empresa de BOLT**. Lo que necesita es:

- un **planificador**: cada conductor en una matrícula, de día o de noche; desde el 06/11/2026 (db/234), **el de Madrid**, con zonas, cuadrantes, libranzas de la plaza, correturnos como casillas del cuadrante (db/236: ninguna por defecto) y el promedio de horas de cada uno, sin letra; se exporta a Excel;
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

Lo que decidió al preguntarle: las libranzas son **de la plaza** (matrícula + turno), como en Madrid; las **zonas en grupos tipo cuadrante** (la zona es del cuadrante); y el **promedio igual que el de Madrid**. El CT empezó «como en Madrid, con su bloque» (CT por coche, db/234 y db/235) y ese mismo día se rehízo: **el CT es una casilla del cuadrante** (db/236, abajo).

Es el mismo diseño y el mismo lenguaje que [[Planificacion]] (zonas, cuadrantes, «libra L M», sol y luna), sin letra. Lo que cambia es de dónde salen los datos, porque Barcelona no tiene lo mismo:

| | Madrid | Barcelona |
|---|---|---|
| Las personas | fichas, con alta, ausencias y libranza excepcional | **cuentas de BOLT** de su empresa: activa = `estado_externo = 'active'` |
| La plaza | `plaza` + `vehiculo_id` | **la matrícula** (hay coches que solo están en BOLT) |
| El CT | por coche (`vehiculo_sin_ct`: sin fila, lleva CT) | **una casilla del cuadrante** por jornada (`sede_cuadrante_ct`): sin casilla, el cuadrante no lleva CT, que es lo de por defecto |
| Quién trabaja cada día | `f_cobertura` (SQL) | `barcelona.plan.js` (JS puro) |
| Las tablas | `base_zona`, `cuadrante`, `vehiculo_descanso`, `asignacion` | `sede_zona`, `sede_cuadrante`, `sede_coche` (el cuadrante de hoy) y `sede_coche_cuadrante` (su historial, db/237), `sede_cuadrante_ct`, `sede_descanso`, `sede_asignacion` (con `sede`); `sede_coche_ct`, solo historial |

**Todo va en tablas de la sede**, por lo de siempre ([[Sedes]]): de las tablas de Madrid beben `f_cobertura`, Control, el bot y las nóminas, y un coche o una cuenta de Barcelona saldría allí como un hueco o un NN. Madrid no cambia en nada.

### Los correturnos son casillas del cuadrante (db/236, 06/11/2026)

Camilo: *«Ahora necesito una reconstrucción. En el planificador de Barcelona, si los coches pertenecen a un cuadrante y tienen correturnos, los correturnos sí o sí van a ser una sola casilla cogiendo los coches que estén ahí, ojo, ninguna plaza se puede repetir, si el coche xxxx tiene como libranza el de día el L, no puede haber otro coche descansando de día el L ya que el correturno debe de coger las plazas que no se trabajan, por lo que no puede coger dos coches a la vez. Pero otra cosa, que se pueda agregar la casilla por jornada, tipo: Agregar CT al cuadrante, se abre con 3 opciones: día, noche, todoturno. Si se escoge día o noche no se puede elegir luego el todoturno y viceversa. Si es todoturno es una sola casilla sin logo. Si es día es una sola casilla con logo de sol. Si es noche es una sola casilla con logo de luna. Si es día y noche cada casilla con su logo. El correturno puesto tendrá como día de libranza el día que no coja ninguno de los coches en el cuadrante.»*

Lo que decidió al preguntarle: **el CT cubre a TODOS los coches del cuadrante** (desaparece «Sin correturnos» por coche; un coche sin cuadrante no lleva CT), y **si el cuadrante no tiene CT de un turno, el día que libra el fijo de ese turno el coche no sale**: no es un hueco, y en ese turno sí pueden coincidir libranzas entre coches.

- **Una casilla por jornada**: `dia` (sol), `noche` (luna) o `todoturno` (sin icono). Un cuadrante tiene ninguna, la de día, la de noche, las dos, o la todoturno sola: **nunca la todoturno junto a la de día o la de noche**. Una casilla existe aunque esté vacía y se puede quitar.
- **Qué coge** («las plazas que no se trabajan»): la de día, cada día de la semana, la plaza de día del coche del cuadrante cuyo fijo libra ese día; la de noche, igual de noche; la todoturno, las de día y las de noche juntas. Coge todos los coches del cuadrante.
- **Su libranza** son los días de la semana en que no coge ninguna plaza. Se calcula, no se escribe.
- **Ninguna plaza se repite**: dentro de lo que coge una casilla, dos plazas no libran el mismo día de la semana (en la todoturno, entre todos los fijos de día y de noche del cuadrante). Se comprueba **al poner una libranza, al meter un coche en el cuadrante y al agregar una casilla**, día a día con el plan como quedaría, desde el día de la escritura hasta lo último que puede haber escrito (`topeEscrito`: hoy + 60 días, lo más adelante que empieza una escritura, + 6, una semana entera del último estado; hasta el 10/11/2026 eran 62 días y una libranza puesta desde dentro de 60 solo se miraba tres días): lo escrito para más adelante también cuenta. Solo cuenta lo que toca la escritura: un choque que ya hubiera en otras plazas no la para. El aviso dice con qué coche y turno choca: *«El L librarían el 1111AAA (de día) y el 2222BBB (de día) en el C1, y el CT de día no puede coger dos plazas a la vez: ninguna plaza se puede repetir. Elige otro día.»* Lleva «desde el dd/mm/aaaa» solo si el choque no cae en la primera semana (viene de algo escrito para más adelante): en la primera semana «el L» ya es el próximo lunes. Sin casilla de un turno, los fijos de ese turno sí pueden librar el mismo día.
- **Si aun así hay una repetida** (la puede dejar db/236), la casilla coge la primera (el día antes que la noche y, dentro, por matrícula) y las demás quedan en hueco: una persona no lleva dos coches a la vez. El tablero la trae en `repetidas` y la casilla lo dice en rojo hasta que se cambie una de esas libranzas.
- **Una persona, en una sola casilla** a la vez, y no de fijo en un turno que se pise con lo que coge (`P.choques`: el mismo turno, **de `desde` hasta `topeEscrito`**, con el plan cargado hasta ahí; fijo de día y casilla de noche sí pueden ir juntos). No se mueve sola: se dice dónde está (*«Ana ya es CT de día del C2: una persona está en una sola casilla. Quítala antes de allí.»*). Hasta el 10/11/2026 «no doblar» miraba solo la semana desde el día de la escritura (y `asignar` cargaba solo esa semana): con una plaza fija de día escrita desde el 20/11, poner hoy a esa persona en la casilla de día dejaba que doblara el 23/11. Ahora el aviso dice desde cuándo: *«Fran ya lleva el 6666FFF los L M V S D de día desde el 01/12/2026: como CT de día del C1 tendría que coger otro coche esos días…»*.
- **Si aun así una persona dobla** (la conversión de db/236 pudo dejarlo: un CT por coche que también era fijo de otro coche en el mismo turno pasa a una casilla que coge a TODOS los coches del cuadrante), el tablero lo trae en `dobles` de la casilla (`P.doblesSemana`, con lo que vale ese día) y la casilla lo dice en rojo: *«Dobla turno: Eva también es fija del 4444DDD de día (los L M V D). Quítala de una de las dos.»*; en el Excel, en ámbar. db/237 lo avisa también (`RAISE NOTICE`) al aplicarse.

### Las reglas (`barcelona.plan.js`)

Las de Madrid (`f_cobertura` con db/203) escritas en JS, con las casillas:

- **Las libranzas son siempre de cada fijo** (`sede_descanso` con `turno` 'dia' o 'noche'). Un fijo trabaja todos los días menos los que libra su plaza.
- **El día que libra un fijo**: si el cuadrante tiene ese día una casilla que coge ese turno (la suya o la todoturno), lleva el coche su persona (**hueco** si está vacía); si no la tiene, **el coche no sale**: es lo planificado, no un hueco. Un coche sin cuadrante, igual que sin casilla.
- **Hueco** = el turno tiene que salir y nadie lo lleva: sin fijo un día que su plaza no libra, o la casilla vacía el día que le toca coger esa plaza.
- Cada turno de cada coche, en el tablero: `'trabaja'` (su fijo), `'cubre-ct'` (libra y lo coge la casilla), `'hueco'` o `'libra'` (no sale).

`P.crear({ asignaciones, casillas, descansos, cochesCuadrante, cts })` devuelve las preguntas de un día: `cuadranteDe` (en qué cuadrante estaba un coche ese día), `descansoDe`, `libra`, `trabaja`, `casillasEn`, `cubreEl` (lo que coge una casilla ese día), `cubreSemana`, `libraCasilla`, `repetidasSemana`, `doblesSemana`, `estadoDelTurno`, `plazasRepetidas` y **`planDelDia(dia)`: quién TRABAJA ese día y dónde**, con la persona de cada casilla en la matrícula y el turno que coge ese día (una todoturno puede ir de día un día y de noche otro). Es lo que leen **todos** los que preguntan «¿a quién le tocaba?»: el tablero, el reparto de horas por turno (`barcelona.horas.planDesde`), el reporte diario, el semanal, el promedio y la Visibilidad. Así el reparto de horas por turno, el «No salió» o «Libra» del reporte y el promedio siguen saliendo bien con CT.

**Lo de antes de db/236 sigue contando para sus días** (se cerró, no se borró): el descanso común del coche (`turno` NULL) y el CT por coche (`cts`, de `sede_coche_ct`, y las plazas `rol = 'ct'` con sus `dias`). El reporte de un día viejo dice lo mismo que decía.

**La pertenencia al cuadrante tiene historial (db/237, 10/11/2026)**: `sede_coche_cuadrante`, una fila por coche y cuadrante con `desde`/`hasta`, sin solaparse (`ex_sede_coche_cuadrante_solape`). Lo que coge una casilla un día sale de los coches que estaban en su cuadrante **ESE día** (`cuadranteDe`), no de los de hoy. Hasta entonces la pertenencia era la de hoy (`sede_coche`, como `vehiculo.cuadrante_id` en Madrid) y **sacar o mover un coche reescribía el pasado**: los días ya cerrados en que la casilla lo cubrió dejaban de tenerla en `planDelDia`, las horas de su CT se iban a «Sin plaza» y el coche salía «Libra» en el reporte, la semana y la Visibilidad. Antes del primer periodo de un coche no se sabe dónde estaba: sus casillas no lo cogen.

- **Meter o sacar un coche se escribe siempre desde hoy** (`repo.cocheEnCuadrante`, en una transacción): lo que vale se cierra la víspera, lo que empezaba hoy se borra, lo escrito para más adelante se respeta (lo nuevo dura hasta su víspera) y lo que queda pegado al mismo cuadrante se junta (sacarlo y volver a meterlo el mismo día deja una sola fila).
- **`sede_coche.cuadrante_id` se queda como «el de hoy»**, por comodidad: lo escribe la misma transacción y lo leen quienes preguntan «¿dónde está hoy?» (`estructura`: meter un coche, borrar un cuadrante, `bajaCuadrante`). Para cualquier fecha manda el historial (`repo.planEntre` → `pertenencias`, también los periodos en un cuadrante ya dado de baja).
- **El tablero de un día** pinta cada coche en el cuadrante en que estaba ese día (mirando un día pasado, el coche que se movió sale donde estaba); si aquel cuadrante ya está dado de baja, en «cuadrantes libres». El Excel, igual (sale del tablero).
- **Una libranza cambiada desde un día pasado** mira las casillas de todos los cuadrantes en que estuvo el coche desde ese día (`cuadrantesDelCoche`).
- **Sin db/237** no se para nada: `pertenencias` cae a la pertenencia de hoy (con `desde` = `actualizado_at`, lo de antes) y `cocheEnCuadrante` escribe solo `sede_coche`. Al aplicarla, db/237 siembra el historial desde ahí.

### Las escrituras

Todas valen **desde el día que se mira**, como Madrid: lo vigente ese día se **cierra la víspera** (el reporte de un día viejo sigue sabiendo qué había), lo que empezaba ese mismo día **se borra** (no llegó a valer) y lo escrito para más adelante **se respeta**: lo nuevo dura hasta su víspera. Vale para las plazas (`repo.asignarEn`, como `colocar` y `liberar` de Madrid: poner a Hanss desde el 08 en una plaza que Miguel tiene escrita desde el 16 deja a Hanss del 08 al 15 y a Miguel desde el 16), las libranzas y las casillas (una casilla nueva que no puede convivir con otra ya escrita para después acaba la víspera de esa).

La fecha va de un mes atrás a dos meses adelante. **Agregar o quitar una casilla, nunca antes de hoy**: un día pasado vale como hoy (el pasado del cuadrante fue como fue y su reporte tiene que seguir cuadrando), y la pantalla lo dice. Poner a la persona de una casilla sí admite hasta un mes atrás, como una plaza. **Una fecha que no existe** (`2026-11-31`, `2026-13-01`) no se cambia por otra: *«Esa fecha no existe: elígela en el calendario.»*; sin fecha, vale desde hoy.

| Ruta (bajo `/barcelona`) | Qué hace |
|---|---|
| `GET /api/tablero?fecha=` | El tablero de ese día (la forma, abajo) |
| `POST /api/asignar` `{ matricula, turno, uuid, desde }` | Pone o quita al **fijo** de una plaza. Si ya era fijo de otra matrícula en ese turno, **se mueve**. Sin doblar con otra plaza suya del mismo turno ni con lo que coge su casilla. `rol: 'ct'` es un 400 que dice dónde está ahora el CT. |
| `POST /api/descanso` `{ matricula, turno: 'dia'\|'noche', dias, desde }` | La libranza de un fijo. Si una casilla del cuadrante coge ese turno, sin repetir plaza y sin que su persona acabe doblando. Sin días, deja de librar. Sin turno, un 400: el descanso común ya no existe. **Desde un día en que el coche aún tenía el descanso común** (antes de aplicar db/236), un 400 claro (abajo). |
| `POST /api/cuadrantes/:id/casillas` `{ jornada, desde }` | **Agrega una casilla vacía** (`dia`, `noche` o `todoturno`): una de cada jornada y la todoturno sola; sin repetir plaza en lo que cogería. |
| `POST /api/cuadrantes/:id/casillas/:jornada` `{ uuid\|null, desde }` | **Pone, cambia o vacía a la persona** de la casilla (el selector puede mandar `{ valor }`). Una cuenta activa de Barcelona, en una sola casilla y sin doblar. Cierra la fila la víspera y abre otra; dos filas pegadas de la misma persona se juntan en una. |
| `DELETE /api/cuadrantes/:id/casillas/:jornada` `{ desde }` o `?desde=` | **Quita la casilla** desde ese día (nunca antes de hoy). Lo que tenía escrito para más adelante también se va. |
| `POST /api/zonas` · `PUT /api/zonas/:id` | Crear, renombrar o retirar (`activa: false`) una zona. Nombre único en la sede, «Sin zona» reservado; no se retira con cuadrantes vivos. |
| `POST /api/cuadrantes` · `PUT` · `DELETE /api/cuadrantes/:id` | Crear (con **el siguiente número libre** de la sede), cambiar zona o nombre, dar de baja (solo sin coches y sin casillas de hoy en adelante). |
| `POST /api/cuadrantes/:id/coche` `{ matricula, quitar?, fecha? }` | Meter o sacar un coche, **desde hoy** (con historial, db/237: lo de antes se cierra la víspera). Al meterlo, sus plazas pasan a las que cogen las casillas del cuadrante: sin repetir plaza **de hoy en adelante** y sin que nadie doble. `fecha` es solo el día del tablero que vuelve. |
| `POST /api/ct` · `POST /api/cuadrantes/:id/ct` | Lo de antes (CT por coche y CT del cuadrante coche a coche): un 400 que dice *«Los correturnos ya no van por coche: son casillas del cuadrante (día, noche o todoturno). Usa «+ CT» en la cabecera del cuadrante…»*, para quien tenga abierta la pantalla de antes. |
| `GET /planificador/excel?fecha=&zona=&q=` | **El planificador de ese día en Excel**, con la zona y el buscador (abajo). |

Las escrituras devuelven `{ tablero }` del día desde el que valen (y lo propio de cada una: `movidaDe`, `cambio`, `casilla`, `cuadrante`, `zona`). Las de zonas y cuadrantes no tienen día: devuelven el tablero solo si se manda `fecha` (en el cuerpo o en `?fecha=`); si no, la pantalla vuelve a pedir el del día que mira.

**Debajo de la pantalla, la base**: un fijo por coche y turno y una plaza fija por persona y turno (db/234); los descansos sin solaparse; y, desde db/236, `sede_cuadrante_ct` con sus exclusiones: **una casilla de cada jornada a la vez y la todoturno sola** (`ex_sede_cuadrante_ct_solape`, la técnica de db/203 con `int4range`: la de día ocupa el 1, la de noche el 2, la todoturno los dos) y **una persona en una sola casilla a la vez** (`ex_sede_cuadrante_ct_persona`). Lo de antes es solo historial: dos disparadores (`tg_sede_asignacion_sin_ct`, `tg_sede_coche_ct_historico`) no dejan entrar plazas de CT por coche ni periodos con CT nuevos, y lo que ya hay solo se puede acortar. «Ninguna plaza se repite» lo mira el servicio: depende de los descansos de todos los coches del cuadrante, día a día, y eso un CHECK no lo ve. Si una escritura se cuela, `traducir` lo dice para la pantalla en vez del error de PostgreSQL (también el solape de libranzas, `ex_sede_desc_solape`, y el de la pertenencia, `ex_sede_coche_cuadrante_solape`).

**Corregir una libranza desde antes de db/236** (revisión del 10/11/2026). db/236 cerró el descanso común de cada coche (`turno` NULL) la víspera del día en que se aplicó y abrió uno de día y otro de noche desde ese día. Como una libranza se puede poner hasta un mes atrás, ponerla desde antes de ese día pisaba el común: la base lo paraba (23P01, `ex_sede_desc_solape`) y la pantalla decía «recarga el tablero y vuelve a probar», que no arreglaba nada. **Se rechaza con un aviso claro, sin partir el común**: *«Hasta el 09/11/2026 el 1111AAA tenía el descanso común del coche (S D), de cuando los correturnos iban por coche, y esos días no se cambian desde aquí. Pon la libranza desde el 10/11/2026.»* Por qué no partirlo: en esos días el coche llevaba CT por coche, que cubría justo los días del común; si el fijo librara otros, aquel CT doblaría o dejaría un hueco en días ya cerrados, y sus filas ya no se pueden tocar (db/236 solo deja acortarlas). Es una ventana de como mucho un mes tras aplicar db/236.

### db/236: qué convierte

db/234 y db/235 pueden estar aplicadas en producción: no se tocan. db/236 convierte lo que haya **desde el día en que se aplica** (en Madrid) y deja lo de antes como historial, cerrado la víspera y sin borrar ninguna tabla. Se aplica por el corredor de Migraciones; se puede pasar dos veces.

- **Las casillas**: cada cuadrante vivo con algún coche con CT por coche de hoy en adelante recibe **una casilla de día y una de noche** (con el bloque, ese coche salía siempre en los dos turnos: si nadie era CT de un turno, aquello era un hueco y lo sigue siendo, con la casilla vacía). Desde hoy (o desde que empezaba su CT), hasta que acababa (sin fin si algún coche lo llevaba sin fin). La persona es la que era CT de ese turno en sus coches; si eran varias, la que vale hoy y la más reciente, y se avisa. Si esa persona ya está en otra casilla, esta queda vacía, y se avisa.
- **Las plazas `rol = 'ct'` y los periodos de `sede_coche_ct`**: se cierran la víspera; los que empezaban más adelante se borran (no llegaron a valer).
- **El descanso común** (`turno` NULL) pasa a uno de día y otro de noche con los mismos días.
- **Avisa** (`RAISE NOTICE`) del CT de coches que no están en ningún cuadrante (se quita: un coche sin cuadrante no lleva CT) y de las **plazas que quedan repetidas** (no las arregla: es decisión de quien planifica), y acaba con los recuentos.
- Quita el disparador de db/235 y pone los dos de historial. Comenta `sede_coche_ct`, `rol` y `turno` NULL como «histórico».
- **Hasta aplicarla**, el tablero devuelve `{ faltaMigracion: 'db/236' }`: la pantalla lo dice y no deja escribir ni exportar (una escritura en ese rato daría un 500 con el error de la base). El reporte, la semana y la Visibilidad siguen saliendo con lo de antes (`planParaHoras` con `casillas: false`).

Se probó el 10/11/2026 contra la copia local **dentro de una transacción con ROLLBACK**, con CT por coche creado en la misma transacción: la conversión (dos pasadas), sus avisos, las exclusiones y los disparadores; y, de punta a punta, **la pantalla de verdad** (en un `vm`, con `api.js`) escribiendo por HTTP al controlador de verdad: agregar, poner, cambiar, vaciar y quitar casillas, la libranza que repetiría plaza, la plaza repetida que deja la conversión, quitar mirando un día pasado y el Excel que baja, leído celda a celda.

### db/237: el historial de la pertenencia (10/11/2026)

- **`sede_coche_cuadrante`** (id, sede, matricula, cuadrante_id, desde, hasta, creado/cerrado por y cuándo), con `ex_sede_coche_cuadrante_solape` (un coche en un solo cuadrante a la vez). No se toca db/236 (su huella la daría por modificada).
- **La siembra**: cada coche que hoy está en un cuadrante vivo, desde el día en que entró (`sede_coche.actualizado_at` en Madrid: la fecha que usaba el código hasta ahora). Solo los que aún no tienen ninguna fila: se puede pasar dos veces.
- Comenta `sede_coche` como «el de hoy, copia de comodidad del historial».
- **Avisa** (`RAISE NOTICE`) de las personas de una casilla que doblan con una plaza fija suya del mismo turno (lo que pudo dejar db/236 y db/236 ya no puede decir), con el cuadrante, la plaza y los días; no lo arregla (es decisión de quien planifica): el tablero lo enseña en la casilla.
- Se probó el 10/11/2026 en la copia local **dentro de una transacción con ROLLBACK** (con coches, cuadrantes, una casilla y una fija de prueba creados en ella): la siembra (dos pasadas), el aviso del doble turno, la exclusión, `repo.cocheEnCuadrante` de verdad (sacar, meter, volver el mismo día, mover, lo escrito para después), `repo.planEntre` leyendo el historial y, sin la tabla, cayendo a la pertenencia de hoy; y el choque de una libranza desde antes del común de db/236 en la base.

### La forma del tablero (el contrato con la pantalla)

```js
{ fecha, hoy,
  zonas: [{ id, nombre, cuadrantes, coches }],                    // las vivas, por nombre
  cuadrantes: [{ id, numero, nombre, zonaId, zona, coches: ['MAT'],
    casillas: [{ jornada: 'dia'|'noche'|'todoturno', desde, hasta,
      persona: persona|null,                     // con su promedio; null = vacía
      cubre: [{ dia: 1..7, matricula, turno }],  // lo que coge cada día de la semana
      libra: [1..7],                             // los días que no coge nada
      hoy: { matricula, turno }|null,            // lo que coge ese día, esté vacía o no
      repetidas: [{ dia, plazas: [{ matricula, turno }] }],      // no debería haber
      dobles: [{ matricula, turno, dias: [1..7] }] }],           // ni esto: su persona, fija de otro coche esos días
    puedeAgregar: { dia, noche, todoturno } }],                   // lo que admite «+ CT»
  coches: [{ matricula, modelo, enBolt, enErp, activo, estadoBolt, cuadranteId,   // el cuadrante de ESE día (db/237)
             descansoTurno: { dia: [1..7], noche: [1..7] },
             plazas: { fijoDia: persona|null, fijoNoche: persona|null },
             turnos: { dia: 'trabaja'|'cubre-ct'|'hueco'|'libra', noche } }],
  conductores: [persona + plazas],                                // los activos en BOLT
  sinPlaza: [persona + plazas],                                   // activos sin plaza ni casilla ese día
  resumen: { coches, turnos, cubiertos, huecos, libran, sinPlaza, casillas } }
// persona: { uuid, nombre, telefono, activa, desde, hasta, rol, dias, libraHoy, trabajaHoy, promedio }
// plazas[]: { matricula, turno, rol: 'fijo', desde, hasta, libraHoy, trabajaHoy }
//         o { matricula|null, turno|null, rol: 'ct', cuadranteId, cuadrante, jornada, dias, desde, hasta, libraHoy, trabajaHoy }
```

- **Los coches** salen de dos sitios: los de la empresa de BOLT de Barcelona y los de **Vehículos con sede Barcelona** que no están de baja (`barcelona.repo.coches`). Camilo, 07/10/2026: hay coches de Barcelona que aún no están dados de alta en BOLT (la 3035LTX) y hay que poder planificarlos. Si BOLT conoce el coche, manda BOLT: activo, se ofrece; desactivado, solo sale si alguien lo lleva o está en un cuadrante, atenuado. Si solo está en Vehículos, se ofrece con el aviso «No está dado de alta en BOLT». Una matrícula que ya no es de la sede pero sigue en una plaza o en un cuadrante sale («ya no es de la sede») para poder vaciarla.
- **Las cifras**, de los coches que se pueden planificar: `turnos` son los que tienen que salir ese día (`cubiertos` + `huecos`); `cubiertos`, los que lleva su fijo o coge una casilla; `libran`, los que no salen porque libra el fijo y no hay casilla que los coja (no son huecos); `casillas`, las casillas de CT de ese día.
- `sinPlaza`: los activos sin plaza de fijo ni casilla ese día. Quien libra, o la casilla que ese día no coge nada, tiene plaza.
- La plaza de una casilla en `plazas[]` lleva la matrícula y el turno que coge ese día (null el día que libra).
- **Un 42703 (no existe la columna) solo es «falta la migración» si `queFalta()` lo confirma**, y eso lo pregunta solo `migracionQueFalta` (el tablero y `planParaHoras`). `repo.faltaMigracion` es solo el 42P01: el reporte, la semana y la Visibilidad lo usan sin preguntar más, y con el 42703 dentro se tragaban una columna mal escrita como «falta la migración» (o como 0 €).

### La pantalla

`public/assets/js/vistas/Barcelona/barcelona-planificador.js` pinta el tablero tal cual llega (las reglas son del servidor) y pide los cambios:

- **Descanso**: siempre los dos botones de cada coche, sol y luna («libra L M» / «no libra»).
- **Las casillas**: en la tabla del cuadrante, después de Fijo día y Fijo noche, **una columna por casilla con UNA celda que ocupa todas las filas del cuadrante** («una sola casilla cogiendo los coches que estén ahí»). Cabecera «☀ CT día», «☾ CT noche» o «CT todoturno» (sin icono). Dentro: la persona (nombre, chip del promedio, teléfono, «desde dd/mm»), «cubre L 1111AAA · M 2222BBB…» (en la todoturno, cada plaza con su sol o su luna; la de ese día, resaltada), «libra V S D», la plaza repetida en rojo si la hay, el doble turno de su persona en rojo si lo hay («Dobla turno: …», `dobles`), el estado del día («cubre hoy 1111AAA de día», «libra hoy» o, vacía, «hueco hoy · 1111AAA de día» en rojo) y «quitar la casilla». Vacía: «+ Asignar».
- **«+ CT»** en la cabecera del cuadrante («Agregar CT al cuadrante»): un formulario con «Qué casilla» y «Desde» (como pronto hoy). Ofrece solo lo que admite `puedeAgregar` y dice debajo por qué no lo demás («no va junto a la de día», «ya tiene la todoturno»…). Con día y noche, o con la todoturno, el botón no sale. La casilla nace vacía; la persona se pone pulsándola.
- **Quitar una casilla** pide confirmación y dice quién sale. Mirando un día pasado, dice que se quita **desde hoy** (hasta ayer sigue como estaba y los reportes no cambian) y la pide desde hoy.
- **Los fijos**, cómo está su turno ese día: «libra hoy · lo cubre el CT» (con la casilla), «libra hoy · hueco» (casilla vacía), «libra hoy» (sin casilla de ese turno: el coche no sale), «hueco hoy» (sin fijo) y «no sale · coche desactivado» (un coche desactivado en BOLT no es un hueco rojo, ni en las tarjetas de zona ni en la cifra de Huecos). Mirando otro día, «el S 08/11» en vez de «hoy».
- La ayuda de la libranza de un fijo dice lo que la casilla ya coge (esos días no puede librar ese fijo), y el selector de personas dice dónde está cada una («fijo de día en 1111AAA», «CT de noche del C1»).
- Un cuadrante sin casillas lleva «sin CT» en la cabecera. Uno sin coches pero con casilla se pinta con la fila «Cuadrante vacío» y la casilla, para poder asignarla o quitarla.
- **El buscador**: si coincide con la persona de una casilla, sale su cuadrante con todos sus coches (la casilla los coge a todos).
- **«+ Coche» y «Meter en un cuadrante» mandan el día que se mira** (`fecha`), para que el tablero que vuelve sea ese. Con casillas, la nota dice lo que ya cogen.
- **La ayuda del chip del promedio** dice la regla de verdad: un día con horas cuenta siempre, tuviera plaza o no; no cuentan las libranzas ni los días sin plaza sin horas; el del mes anterior es de ese mes entero.
- **Fuera desde db/236**: el interruptor «Sin correturnos» y el CT de cada fila, el botón del bloque común, las columnas «CT día / CT noche» por coche, el aviso «Este coche no tiene correturnos…», los chips de CT de la cabecera y **«Imprimir»** con todo lo de impresión (`@media print`, `data-solo-imprimir`, la cabecera de papel).

### Exportar a Excel (06/11/2026)

Camilo: *«Arregla de una vez la impresión del planificador, perdona, no era imprimir sino exportar en excel … de una vez actualiza el excel y elimina lo de "imprimir", no necesitamos eso en PDF sino en excel.»* «Exportar Excel» (donde estaba «Imprimir») baja lo que se está viendo: el día, la zona abierta y lo que deja el buscador.

- **La ruta**: `GET /barcelona/planificador/excel?fecha=AAAA-MM-DD&zona=&q=` (`barcelona.service.planificadorExcel` arma el tablero del día y se lo da a `barcelona.planificador.excel.generar({ tablero, zona, q, ahora })`). Se llama **«Planificador Barcelona dd-mm-aaaa.xlsx»**, como los reportes de Barcelona («Horas Barcelona …»). La pantalla lo baja con fetch y blob: un error (o la sesión caducada) sale en un aviso, sin dejar la pantalla.
- **La hoja «Planificador»**, A4 apaisada a una página de ancho, con la banda de la casa (logo, «PLANIFICADOR · BARCELONA · <día largo>», la zona o «Todas las zonas», las cifras y «Exportado el dd/mm/aaaa a las hh:mm»), una línea de leyenda y el pie con el día y «Página X de Y».
- **Por zona**, un título; **por cuadrante**, «C1 · Nombre · Zona» y su tabla: **Matrícula** (con modelo y avisos), **Descanso** («☀ libra L M» / «☾ libra V»), **☀ Fijo día**, **☾ Fijo noche** (nombre, teléfono, promedio, «libra …», «desde dd/mm», el estado del día) y **una columna por casilla, con la celda combinada en todas las filas del cuadrante** (persona, cubre, libra, desde). Se reservan tantas columnas de CT como pida el cuadrante que más pide; la todoturno ocupa dos, combinadas. Los colores de los Excel de Madrid: fijo día azul `FFDDEBF7`, fijo noche caqui `FFEDE3C5`, CT día verde `FFE2EFDA`, CT noche morado `FFE4DFEC`, todoturno gris claro; los huecos en rojo, «libra» y el coche desactivado en gris. Como en Excel no hay ayuda al pasar el ratón: el nombre del CT entre paréntesis («libra hoy · lo cubre el CT (Eva)»), el desglose del promedio en la nota de la celda, y la plaza repetida y el doble turno de la persona de la casilla en ámbar («ojo: Eva también es fija del 4444DDD de día los L M V D: dobla turno»).
- Luego **«Cuadrantes libres»** (los coches sin cuadrante, sin casillas) y al final **«Sin plaza»** (nombre, teléfono, promedio).
- **Filtra igual que la pantalla** (`filtrar`, copia de `pintarCuadrantes`: si cambia uno, cambia el otro). `zona`: el id de la zona (o su nombre como va en la dirección, `eixample`); **`libres`** es la tarjeta «Sin zona» (los cuadrantes sin zona **y** los coches sin cuadrante; `sin` y `sin-zona` valen igual); vacío o una que no existe, todas. `q`: sin tildes y en minúsculas, sobre la matrícula, el modelo y el nombre o teléfono de los fijos; si coincide la persona de una casilla, sale su cuadrante entero; un cuadrante sin nada que coincida no sale; «Sin plaza» no se filtra nunca. Las cifras de la banda: sin zona, las del `resumen` del servidor; con zona, las de sus coches activos.

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
| **Libra** | era su día de libranza (db/234): no le tocaba, y no cuenta como «No salió». Si trabajó, se dice en las observaciones: si ese día trabajaba en otra plaza suya (la coge su casilla de CT en otro coche, o hace su turno de noche), sus horas van en la fila de esa plaza (*«Libraba; ese día trabajó en 2222BBB (CT)»*); si no tenía otra, van en «Sin plaza», por su hora de inicio |

**A quién le tocaba lo dice el plan del día** (`barcelona.plan.planDelDia`), no la asignación en crudo: el fijo que libra sale «Libra»; **la persona de una casilla de CT sale solo los días que coge una plaza**, en esa matrícula y ese turno (y con «· CT» en el turno); el día que no coge nada, libra y no sale. Hasta el 06/11/2026 Barcelona no tenía libranzas y todo el que tenía plaza tenía que salir.

En las observaciones se dice si trabajó **en otro coche** que el de su plaza, y lo que hizo **fuera de su turno** ese día (no se suma a su plaza).

### Utilización y viajes sin coger (10/11/2026)

Camilo: *«agrega al reporte de Barcelona el total de utilización de la jornada del conductor y el total de viajes rechazados a dedo y rechazados por no contestar separados»*. Las tres pestañas llevan tres columnas más, y el subtítulo de «Por día» los totales del periodo:

- **Utilización** = viaje / (viaje + espera), en %. Es la definición de la casa ([[Calificacion de conductores]], el BI y la nómina variable). Sin horas va vacía, no a 0 %: no hay nada que medir. En «Por conductor» se calcula con el tiempo de todos sus turnos con plaza del periodo, no como media de los días: pesa más el día que más trabajó.
- **A dedo** = `driver_rejected`: el viaje lo rechazó él. Va en rojo, porque rechazar no está permitido a ninguna hora ([[Control Alertas]]).
- **Sin contestar** = `driver_did_not_respond`: se le ofreció y no contestó.

Los rechazos salen de `sede_bolt_order` (db/182, `repo.rechazosEntre`). **Cada uno cae en el turno al que pertenece**, con la misma etiqueta con la que se reparten las horas (`repartoTurnos.etiquetaPlan`, o la hora si no tenía plaza). Así no se cuentan dos veces de 12:00 a 24:00, donde se pisan la noche y el día. Por eso el total de los dos días naturales que da la base no coincide con el del reporte: la noche del último día llega hasta las 12:00 del siguiente.

Hay tres casos que el reporte resuelve así:

| Caso | Dónde va |
|---|---|
| El de noche que se conecta por la mañana y rechaza | En su fila, como sus horas «fuera de su turno», con una observación |
| Rechazos en un día de libranza | Con sus horas: en su otra plaza de ese día o en «Sin plaza» (la fila «Libra» va a cero) |
| Quien no hizo ni un minuto pero tuvo ofertas | Fila de 0 h en «Sin plaza» (sin contar como «trabajó sin plaza») |

**Los totales de arriba cuadran con la suma de las filas.** Comprobado con la copia local del 20 y el 21/10: 78 a dedo, 183 sin contestar y 74,7 % de utilización.

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

### Utilización y la pestaña «Por coche» (10/11/2026)

Camilo: *«en el reporte semanal de Barcelona también agrega la utilización semanal del conductor y haz otra pestaña por coche, cuántas horas hizo cada coche en la semana»*.

- **Utilización** de cada conductor: viaje / (viaje + espera) de toda su semana, con el tiempo de la semana entera. No es la media de los días: pesa más el día que más trabajó. Sin horas, va vacía (no a 0 %). En la cabecera va la de todos.
- **Por coche**: una fila por coche con las horas de cada día, el total, los días con horas, la media, la utilización y quién lo llevó, con cuántas horas cada uno.
  - Son las mismas horas que las de los conductores, repartidas por el coche en que se hicieron. Cada rato de BOLT lleva su coche, y va al día del turno de quien lo llevaba (`cochesDeLaSemana` en `barcelona.horas.js`). Por eso la suma de los coches es la de los conductores.
  - Salen todos los coches de la sede, también los parados, con un 0 en rojo los días cerrados. Lo que BOLT no dice en qué coche fue sale como «Sin coche».
  - Va de menor a mayor, como la de conductores.
- Con la semana del 19/10 de la copia local: 1.101,1 h de los conductores y 1.101,2 h de los coches (el redondeo), 78 % de utilización, y 14 de 22 coches con horas.

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
barcelona.plan.js         puro: las reglas del plan (quién trabaja, quién libra, qué coge cada casilla de CT,
                          dónde hay hueco, qué plaza se repite, quién dobla)
barcelona.horas.js        puro: de los apuntes de BOLT a los ratos de trabajo, el reporte y la semana con el
                          plan del día, y el promedio de horas
barcelona.excel.js        el Excel del reporte
barcelona.planificador.excel.js
                          el Excel del planificador (lo que se ve: el día, la zona y el buscador)
barcelona.repo.js         el SQL: cuentas, coches, el planificador (asignaciones, casillas de CT, descansos,
                          zonas y cuadrantes; y el CT por coche de antes, para leer días viejos), apuntes,
                          pedidos (con la sede como parámetro)
vistas/barcelona-planificador.ejs · vistas/barcelona-reportes.ejs
```

Comprobadores (sin base):

- `scripts/comprobar-barcelona.js`: el repositorio se sustituye por datos de mentira. Mira las reglas del plan (las casillas de día, de noche, las dos y la todoturno, lo que cogen y cuándo libran, la plaza que no se repite, los estados `cubre-ct`/`hueco`/`libra`, el plan del día con la persona de la casilla en la plaza que coge, y lo de antes de db/236 para los días viejos), el tablero con la forma del contrato, las comprobaciones de cada escritura, las rutas (también los 400 de lo que ya no existe), el reporte con «Libra», la semana, el promedio y lo que pasa sin db/181, db/234 o db/236. Lleva numerados los arreglos de la revisión del 06/11/2026 («[0]»…«[12]») y, desde la integración del 10/11/2026, «[13]» quitar una casilla mirando un día pasado (desde hoy), «[14]» la plaza repetida en rojo y «[15]» el Excel del planificador de verdad (la casilla, una celda combinada en todas las filas del cuadrante). Los de la revisión del 10/11/2026 van como «[R1]»…«[R4]»: la pertenencia con historial (en las reglas, el tablero de un día pasado y de uno futuro, el reporte que ya no manda a «Sin plaza» al CT de un coche sacado, meter y sacar desde hoy, mover de cuadrante, la libranza desde un día pasado en el cuadrante de entonces), «no doblar» hasta el tope de lo escrito (las reglas, asignar, la persona de la casilla y la libranza, y el tope de hoy + 66), la libranza desde antes del común de db/236 y el solape de libranzas dicho claro, y el doble turno de la persona de una casilla (reglas, tablero, pantalla y Excel). **La pantalla de verdad** se carga en un `vm` con los componentes de la casa de mentira.
- `scripts/comprobar-barcelona-planificador-excel.js [carpeta]`: el Excel del planificador con un tablero de mentira: la banda, las cabeceras, las casillas combinadas (la todoturno en dos columnas), los estados, los colores, los coches sin cuadrante, «Sin plaza» y quince combinaciones de zona y buscador con lo que dejaría la pantalla. Con una carpeta, deja allí `ejemplo.xlsx` para mirarlo.

Lo que vive en la base (db/236, sus exclusiones y disparadores, el SQL del repositorio) se probó el 10/11/2026 contra la copia local **dentro de una transacción con ROLLBACK**, como se cuenta en «db/236: qué convierte». Antes, el 06/11/2026, db/234 y db/235 se ensayaron igual: la migración entra dos veces, las exclusiones paran los solapes que tienen que parar, y el servicio con el SQL de verdad saca el reporte, la semana y la Visibilidad; el reporte de ayer dio lo mismo antes y después de aplicarlas.

## Ver también

[[Sedes]] · [[Planificacion]] · [[Vehiculos]] · [[Ingesta]] · [[Jornada y turnos]] · [[Usuarios y permisos]]
