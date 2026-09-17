---
tags:
  - modulo
  - planificacion
  - cuadrante
  - trafico
  - postgres
  - whatsapp
---

# Planificación

Quién conduce qué coche, qué día y en qué turno. De aquí sale el plan contra el que Control compara la realidad, el WhatsApp que le dice a cada conductor cuándo trabaja y la parrilla que se imprime y se cuelga en la oficina.

El módulo vive en `modules/Planificacion/`. Se entra por dos puertas y nunca por un `.repo`:

- `modules/Planificacion/tablero.service.js` — el cuadrante y todo lo que lo escribe.
- `modules/Planificacion/cobertura.service.js` — la semana de cobertura y el aviso de turnos.

## Las pantallas

```
/planificador  ·  /planificador-v2      el tablero (la misma pantalla, dos URL)
/planificador-v2/api/tablero            el cuadrante de una semana
/planificador-v2/api/guardar     POST   mover gente entre plazas
/planificador-v2/api/eventos            el modo eventos (CT2 abiertas unos días)
/planificador-v2/api/incorporaciones    la alerta de quien acaba de entrar
/cobertura                              qué plazas quedan sin cubrir
/cobertura/enviar-turnos         POST   el aviso por WhatsApp
```

## El clásico y el V2: ya no son dos

El planificador viejo corría sobre la hoja `PLANIFICADOR_V2` y el V2 nació al lado, sobre PostgreSQL, en vez de compartir API. La razón de peso no era técnica sino de idioma: **el viejo se entendía por el NOMBRE de BOLT y el nuevo por el id del conductor**. Compartir la API habría obligado a los dos a hablar el mismo idioma, y eso era arrastrar justo la limitación que se venía a quitar (`modules/Planificacion/tablero.controller.js`).

Hoy el legacy sobre hojas está **eliminado**: `app.js` monta el mismo controlador en `/planificador` y en `/planificador-v2`. La URL vieja se mantiene porque es la que la gente tiene en favoritos, y el front lleva desde siempre llamando a `/planificador-v2/api/*`.

Lo que se fue con la hoja:

- El ID de BOLT como clave. Todo el tablero colgaba de que un texto coincidiera carácter a carácter; ahora la clave es el id del conductor, que no cambia porque alguien corrija una tilde. La cuenta de [[BOLT]] pasa a ser un dato más de la persona.
- Los días escritos a mano ("L M X"). Ahora son filas en `asignacion_dia`. Se siguen **aceptando** escritos porque es como los teclea Tráfico, pero si hay una letra que no se entiende **no se guarda nada**: antes un "L y M" se convertía en solo el lunes, en silencio.
- La foto del presente. La hoja solo sabía decir quién está HOY en cada plaza; `asignacion` tiene `desde` y `hasta`.

Queda un resto: `services/planificadorV2.js`, el motor viejo, sigue vivo porque ~18 sitios lo llaman. Ya **no lee Google**: `hoja.repo` le sirve desde PostgreSQL filas con forma de hoja, a propósito, porque reescribir su `calcularTablero` —mil líneas de reglas probadas contra 87 coches— es el cambio que no se puede revisar de un vistazo. Se comprobó plaza a plaza: el motor viejo leyendo de PostgreSQL y el planificador del módulo dicen lo mismo en las **480 plazas de los 80 coches**, sin una sola diferencia.

## Cómo se planifica

El tablero son filas por zona y coche, y columnas Fijo día / Fijo noche / CT día / CT noche. La regla de **quién cubre qué día no está en el código**: está en `f_cobertura`, en la base ([[Base de datos]]). El módulo la consulta y le da forma de tablero. Si mañana cambia lo que significa un correturnos, se cambia en un sitio.

Cuatro reglas gobiernan cada escritura (`modules/Planificacion/tablero.service.js`, `modules/Planificacion/planificador.repo.js`):

**1. Lo que se guarda vale DESDE el día que se está mirando.** Lo que hubiera antes se cierra la víspera. Así se puede poner a uno el 25 y a otro el 28 en la misma plaza sin borrar lo del 25. Ninguna escritura pisa el pasado: `liberar` **cierra y no borra** —quien estuvo ahí el mes pasado estuvo, y la cobertura de esas semanas tiene que seguir cuadrando—, y solo borra la asignación que aún no había empezado, porque esa no llegó a pasar.

**2. Toda escritura devuelve el tablero recalculado.** No es comodidad: el front lo sustituye entero y así no se queda pintando algo que la base ya no dice. Cuando cada botón se refrescaba solo, dos personas moviendo el mismo cuadrante veían cosas distintas hasta recargar.

**3. Todo en una transacción.** Mover a alguien toca dos plazas, y a medias deja el coche de origen con un hueco y el de destino con dos personas.

**4. "El coche ya lo lleva otro" no es un error: es una pregunta.** Viaja con su código y con la comprobación entera, para que la pantalla ofrezca planificar a la fuerza sin volver a consultar.

### Las dos imposibilidades, y cuál se puede forzar

`comprobarPlan()` contesta, antes de guardar, qué días va a trabajar esa persona en esa matrícula y qué se lo impide. Mira **una semana** desde el día de entrada, que es el ciclo completo del cuadrante. Hay dos veredictos y no se arreglan igual:

- **Doblar coche el mismo día es imposible y no se puede forzar.** Da igual que uno sea de día y otro de noche. Primero hay que sacarlo del otro coche, y eso es otra decisión con su propio motivo. Se compara el **vehículo**, no el turno: hacer día y noche del MISMO coche es un TodoTurno, existe desde siempre y es justo lo que hace falta en un fin de semana de evento.
- **El coche ocupado sí se puede forzar**, apartando al otro con nombre y motivo. Eso escribe en `plan_relevo`: el día que llegue, Control sabrá a quién llamar, que es de lo que va todo esto. El motivo libre es **obligatorio** y va con código (`no_sale`, `otras_funciones`, `descansa`, `no_localizado`, `baja_o_permiso`, `refuerzo`, `otro`).

Ojo con quién **no** cuenta como ocupante: el que tiene esa MISMA plaza. Ponerse en una plaza ocupada es la sustitución de toda la vida —el que estaba la suelta y punto— y pedir un motivo por eso convertía en "a la fuerza" el movimiento más normal del cuadrante. Lo que hay que preguntar es por quien lleva el coche desde **otra** plaza (el fijo cuando entras de refuerzo, el CT1 cuando entras de CT2).

Trabajar en la propia libranza **sí vale** —un correturnos vive de eso—; lo que se mira es que ese día no le toque estar en otro sitio.

La pantalla pregunta antes de guardar, pero `guardar()` vuelve a comprobarlo: la API también se puede llamar a pelo.

### Cubrir una ausencia sin quitar la plaza

`cubrirAusencia()` es lo que se pide cuando alguien se va de vacaciones: que otro lleve su coche mientras tanto y que **la plaza vuelva sola a su dueño** el día que regresa. Con `colocar` a secas no salía: esa le quita la plaza al titular y a la vuelta había que acordarse de devolvérsela a mano.

Por dentro son tres tramos en la misma plaza, porque la base no admite dos asignaciones solapadas (`ex_asig_plaza`):

```
titular ─────┤   sustituto ├───────┤   titular ├─────────
           víspera        D        H         H+1
```

Sin fechas se cogen las de la ausencia: la vuelta prevista de las vacaciones **es** el último día del reemplazo. El tercer tramo solo se escribe si el reemplazo termina; si la ausencia no tiene vuelta (una baja médica), no hay fecha que poner y se avisa desde la pantalla.

Los días del sustituto, si no se dicen, son **los mismos que tenía el titular**: un correturnos que cubre a otro cubre sus días, no unos nuevos.

## Los turnos

Un conductor no "tiene turno" escrito aparte: **lo dice el conjunto de sus plazas**. La regla la puso Tráfico: quien cubre las DOS plazas fijas de un coche es **TodoTurno**, porque lleva ese coche de punta a punta. No basta con "dos plazas fijas" a secas —dos plazas de día en dos coches distintos es un doble apunte que hay que mirar—, así que se cuentan **turnos distintos**, no plazas. Y los fijos mandan sobre los correturnos: quien es fijo de noche y además hace de CT de día sigue siendo de noche, que es donde está su coche.

`recordarTurno()` lo deja apuntado al colocar. Antes el turno se **leía** de la plaza en vez de guardarse, y por eso al sacar a alguien del cuadrante se quedaba "sin turno" en el banquillo: la plaza era lo único que lo decía. De 220 personas, **3 tenían turno propio y 172 lo heredaban de su coche**. Lo puesto a mano no se toca —Tráfico puede decir "este es de noche aunque hoy lo pongas de día"—; lo que se corrige es lo que puso el propio código antes. Soltar una plaza también recalcula: quien deja una de sus dos fijas vuelve a ser de un turno solo.

La **libranza** tampoco se teclea: el fijo libra el descanso de su coche (`vehiculo_descanso`), y el CT los días que no le pusieron. Ver [[Jornada y turnos]].

## El plantel y los avisos

El tablero no solo pinta: cuenta. `plantel()` da **dos números por puesto, no uno**:

- el **bruto** es quién tiene esa plaza en el papel — la plantilla que se paga;
- el **neto** descuenta a quien está de vacaciones o de baja — la gente con la que se puede contar mañana.

Con un solo número, 61 fijos de día de los que 5 están de vacaciones se leen como 61 coches saliendo.

Un correturnos se da por bien puesto con **4 días o más** y con **6 como tope** (lo que marca el convenio). Menos de 4 es una alerta: ni cubre lo suyo ni cobra lo suyo. El recuento va **por persona** y no por plaza, porque un correturnos puede estar repartido entre cuadrantes —L y M con una matrícula del cuadrante 3, X y J con otra del 20— y eso es UN correturnos de cuatro días, no dos de dos.

`avisosDe()` dice con nombres lo que hay que mirar: huecos de fijo, conflictos (dos personas en la misma celda), gente colocada sin turno, gente sin cuenta de BOLT, ausentes que ocupan plaza y correturnos con menos días de los que le tocan por contrato.

## El modo eventos

La F1 en Madrid, una marcha, un concierto: días en los que hay que sacar más coches de los que el cuadrante tiene puestos. Las plazas ya existían —los **slots 4 y 5 son CT día 2 y CT noche 2**, creados desde el primer día para los 100 coches— pero estaban ocultas, porque abrirlas a mano significa que alguien tiene que acordarse de cerrarlas, y nadie se acuerda (`modules/Planificacion/eventos.repo.js`).

Un evento tiene **desde y hasta obligatorios**, dura como mucho **21 días** —más que eso ya no es un evento, es otra plantilla— y se cierra solo. Pero no el día que dice el papel:

> **El evento acaba cuando termina el último turno planificado en refuerzo.**

Los turnos no caben en un día natural: el de noche empieza a las 17:00 y muere a las 05:00 del siguiente. Si la última en salir es un CT2 de noche el domingo, el cuadrante vuelve a la normalidad el **lunes a las 05:00**, aunque el evento dijera "viernes, sábado y domingo". Esa hora **no se guarda**: se calcula al leer, porque cambia cada vez que alguien toca el cuadrante y guardada mentiría. Los instantes los monta PostgreSQL con `AT TIME ZONE`, porque el servidor va en UTC y `new Date('...T17:00:00')` daría las 19:00 de Madrid en verano.

Al crear el evento se toma una **foto** de todas las plazas (`evento_foto`), en la misma transacción: si el cuadrante cambiara entre una cosa y otra, la foto ya no sería "cómo estaba antes" y la vuelta devolvería a quien no era.

### El fallo que rompió el finde de la F1

Se vaciaron las plazas de correturnos para dejar solo fijos. Como "dejar vacía" cerraba la asignación **sin fecha de vuelta**, el lunes esa gente no tenía plaza — y el WhatsApp se lo dijo tal cual: *"la semana que viene no tienes turnos"*.

La corrección está en `liberar()` y en `colocar()`: **quitar a alguien durante un evento es quitarlo esos días, no para siempre**. En el mismo movimiento, el apaño se cierra el último día del evento aunque no se diga, y al que sale se le repone ya, con entrada el día siguiente y los mismos días y el mismo "hasta" que tenía. Hacerlo entonces y no al cerrar el evento tiene una consecuencia que se nota: **la base dice la verdad sobre el futuro desde el primer minuto**, así que el WhatsApp de "tus turnos de la semana que viene" ya sale bien sin que nadie haya cerrado nada.

Y si al que se echa ya era otro apaño del mismo evento, **no se repone**: quien tiene que volver es el original, y su vuelta ya está puesta. Reponer al segundo dejaría dos personas en la misma plaza.

La **restauración** (a las 05:10 por cron, o a mano desde la pantalla) es solo la reconciliación: comparar plaza por plaza contra la foto y arreglar lo que se haya quedado torcido, normalmente plazas que el evento vació y que nadie repuso porque se tocaron por otra vía. Nunca hacia atrás: se reabre desde el día de la vuelta hacia delante.

El mensaje de WhatsApp durante un evento es distinto y dice cuatro cosas en este orden: que es **temporal** y por qué, qué hace esos días, **a quién entrega el coche** cuando se acabe —la frase que evita el lío del lunes— y sus turnos ya normales de la semana siguiente. Si no hay nada cargado para la semana siguiente **nunca se dice "no tienes turnos"**: a un conductor al que le acaban de cambiar el fin de semana eso le suena a que se ha quedado sin trabajo.

## La cobertura y el aviso de turnos

`/cobertura` lee del **tablero**, no de una hoja: lo que se ve ahí es exactamente lo que hay en el cuadrante. Devuelve, por día y turno, quién sale y —sobre todo— **qué coches no salen, cada uno con su motivo**: descansa, titular ausente, plaza vacía, conflicto, vehículo fuera de servicio.

La semana **no empieza de cero**. El lunes el coche se recibe de quien lo dejó el **domingo pasado**, y el último día se entrega a quien lo coge la semana siguiente. Por eso `cobertura.repo` consulta aparte los bordes de la semana.

El aviso por WhatsApp tiene cinco reglas (`modules/Planificacion/cobertura.service.js`):

1. **El apunte nunca tumba el envío.** Si el registro falla, el WhatsApp sale igual. No avisar a nadie porque no se pudo escribir una fila sería cambiar un problema de contabilidad por uno de operación.
2. **Se manda la PLANTILLA, no el detalle.** El mensaje lleva un botón; el conductor lo pulsa y es el bot quien le cuenta sus turnos. Por eso al enviar se marca la semana (`avisoTurnos.marcar`): cuando pulse, tiene que ver ESA y no la de hoy. El apunte vive en memoria y vale 12 días; si el servidor reinicia, se cae a la semana actual.
3. **Un envío a la vez.** Dos masivos a la vez se pisarían el contador y, peor, duplicarían mensajes. El segundo recibe un **409, no una cola**.
4. **1,2 segundos entre mensajes** (~50/min, por debajo de los límites de Meta). Doscientas personas son cuatro minutos: va en segundo plano y el panel sondea el progreso.
5. **Solo se avisa a quien trabaja.** Quien libra toda la semana no recibe nada; quien no tiene teléfono se apunta como `sin-telefono` —que es un dato para RRHH— en vez de contarse como error de envío. Y **a quien ya causó baja no se le manda nada**, aunque siga saliendo en la pantalla porque sus turnos de esa semana ocurrieron.

### El semáforo: la huella

`modules/Planificacion/avisos.repo.js` guarda con cada envío la **huella** de la semana de esa persona: sus tramos (día 1-7, turno, matrícula) ordenados y serializados. Si cualquier cosa cambia —otro día, otro turno, otra matrícula, ya no sale— la huella cambia, y eso es exactamente *"el cuadrante cambió: toca volver a avisar"*. De ahí sale el verde/rojo/gris de cada cuadrante.

El mensaje que lee el conductor lo arma `modules/Planificacion/turnos.service.js`. Dos detalles que son reglas:

- **Un día que no está cargado en el planificador no se menciona.** Ni trabaja ni libra: no hay dato. Antes salía como "libras" y era mentira — los días anteriores a la migración salían todos como libranza.
- El **cuándo** del relevo solo se dice cuando aporta: al cruzar la semana y cuando el coche queda parado en medio. En un relevo directo el coche pasa de mano en el momento y nombrar el día del turno anterior solo confunde.

De un teléfono a la persona se va **por el sufijo de 9 dígitos**, contra la base. Antes se comparaban nombres y fallaba con una tilde, con los apellidos en otro orden o si el teléfono no estaba en el padrón.

## La parrilla impresa

`modules/Planificacion/parrilla.excel.js` genera el ANEXO en xlsx, organizado **por cuadrante y en su orden** (Cuadrante 2, Cuadrante 3…), igual que la pantalla. Antes se agrupaba por correturno compartido —componentes conexos: si uno cubría A y B y otro B y C, los tres caían en el mismo bloque— y salía un papel imposible de seguir, con coches de distintos cuadrantes mezclados.

El papel imprimía solo a quien estaba HOY en cada plaza, y perdía las tres cosas que más se preguntan mirándolo. Ahora salen:

- **Quién llega.** `→ Cristian Jiménez · llega 18/09/2026`, con el año entero, porque esto se cuelga en la pared: "llega el 18/9" leído en diciembre no dice de qué año es.
- **Que el hueco ya está prometido.** Un hueco en vacante va en **azul** y no en amarillo, porque contarlos juntos infla la falta: uno hay que buscarlo, el otro hay que esperarlo.
- **El relevo de una ausencia.** El titular de vacaciones y quien le cubre son dos personas en la misma plaza; antes solo salía una.

El color de la celda pasó a decidirse por **si hay gente, no por si hay texto**. Con la regla vieja, las plazas por cubrir habrían dejado de salir amarillas justo al empezar a explicarse.

Un fallo que se vio ahí: la columna GRUPO salía en blanco en todas las filas porque leía la libranza del FIJO (`patron_libranza`), que **no tiene nadie**: 0 patrones frente a 132 coches con descanso. Lo que manda es el descanso del **coche**.

## Incorporaciones: el traspaso desde Selección

Cuando alguien se da de alta con una vacante nace una alerta que no se va hasta aceptarla o rechazarla, y Tráfico la ve en el planificador:

- **Aceptar** → se coloca en las plazas prometidas, **todo o nada**, y la vacante queda cubierta.
- **Rechazar** → el conductor queda en el banquillo para colocarlo a mano y la vacante vuelve a estar **abierta** (a esa vacante nunca llegó a entrar nadie).

El reparto de responsabilidades importa: `services/repo/incorporaciones.js` prepara **qué** plazas y **desde cuándo** (es quien guarda la foto de la vacante) y apunta el resultado; `tablero.service.aceptarIncorporacion()` **coloca**, que es escribir en el cuadrante. Y el orden importa: se marca aceptada **después** de colocar. Como `guardar` es todo o nada, si una plaza ya no existe la alerta sigue pendiente y se puede reintentar, en vez de quedarse cerrada sin haber colocado a nadie.

## Quién más lee de aquí

Cinco sitios entraban directamente a `repo/planificador`: Control (el cockpit, el reporte 5-5, el Excel de turnos y la parrilla), Selección (el generador de vacantes) y el bot de las puertas. Ahora entran por la puerta, que expone **solo lo que piden**:

```
tablero.service    tablero({dia}) · contactos() · salidasHoy() · salidasPorCoche()
                   lunesDe() · parrilla(dia) · GRUPOS_SALIDA
                   liberarPlaza() · reponer() · repasarEventos()
cobertura.service  datos(semana) · conductorPorTelefono(tel)
```

`tablero({ dia })` conserva **la firma del repositorio** a propósito: cambiarla al poner la puerta habría sido meter un error de firma en cinco sitios a cambio de nada. Y aun así se coló uno — el controlador pasaba `req.query.dia` posicional a una función que desestructura, y el tablero ignoraba la fecha y pintaba siempre la semana de hoy. Lo cazó la comprobación en vivo, no la lectura del código.

**`salidasPorCoche()`** merece mención aparte: va por coche y no por conductor, porque un coche sin nadie y un coche cuyo fijo está de baja **se ven exactamente igual** —no aparecen— y no son lo mismo: uno hay que cubrirlo hoy y el otro hay que reclutarlo. La clave es tener dos lecturas del mismo día: el **plan** (a quién le tocaba, sin descontar ausentes) y la **cobertura** (quién lo cubre de verdad). La diferencia entre las dos es, exactamente, el motivo. Así el reporte cuadra con la flota: si hay 71 coches operativos, salen 71 filas por turno, siempre.

## Detalles que muerden

- **El barrio no es la localidad.** `barrio` es la zona de casa del conductor ("Aluche", "San Blas") y sirve para repartir cuadrantes; `localidad` es el municipio de la gestoría. Se editan en sitios distintos y no se tocan. Ver [[Reglas de la casa]].
- **Cambiar la matrícula renombra el coche, no mueve a nadie**: la gente cuelga de sus plazas y las plazas del vehículo. Para mover la tripulación está el botón de cambiar de coche.
- **La zona viaja como texto** desde el front y la columna es una clave ajena: se busca por nombre y, si no existe, se dice cuál es en vez de dejar un error de tipos.
- **El permiso de verdad está en el servidor** (`/planificador/editar` sobre cualquier petición que no sea un GET). La pantalla envuelve `fetch` entera en vez de apagar botones uno a uno: en este cuadrante se escribe desde treinta sitios y una lista de botones se queda corta el día que se añada el treinta y uno.
- Los días de la semana viven **una sola vez** en `services/nucleo.js` (`DIAS_CORTOS`, `DIAS_LARGOS`, `LETRAS_DIA`). Había seis copias, y la del motor obligaba al tablero a llamar hacia arriba solo para saber cómo se abrevia "miércoles".

## Lo que aún no está bien

`modules/Planificacion/planificador.repo.js` son ~2.262 líneas con reglas dentro que son de servicio: qué pasa al cambiar un coche, cómo se encadena un relevo. Se movió el módulo primero — mover y partir a la vez es como se pierde una ruta sin enterarse.

`agenda` y `matching` se **borraron** el 15/09/2026: la agenda de tráfico era un segundo sitio para mirar lo que ya está en Plantilla y además era la única pantalla que **escribía** en `AGENDA_V2`. Ver [[Flota viva]] y [[Glosario]].
