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

## Las bases y el iceberg (05/10/2026)

Camilo: *«lo que necesitamos resolver del planificador es que no tenemos ordenada la información de forma ejecutiva para poder asignar los conductores a cada uno de los coches»*. Hasta ese día los cuadrantes salían por su **número**, que es el orden en que se crearon y no dice nada de cómo van.

**El planificador empieza por las cinco bases**: Alcobendas, Alcorcón, Canillejas, Getafe y Usera, por nombre. Cada base es una tarjeta que dice de un vistazo cómo está: una barra con su iceberg (verde completos, naranja con plazas vacías, rojo sin nadie) y debajo lo que le falta («Faltan 2 fijos · 10 CT»).

**Sin pulsar nada se ven todos los cuadrantes** (Camilo, 06/10/2026): base a base en el orden de las tarjetas, cada base con su cabecera (coches, cuadrantes, lo que le falta y «Ver solo …»), y dentro de cada una su iceberg. Los coches sin cuadrante van al final, bajo «Sin base». El primer día (05/10) sin base abierta no se pintaba ningún cuadrante; a Camilo le servía más verlo todo de un golpe.

> [!note] El orden de las bases, y Aravaca
> El 05/10/2026 a las 16:32 se aplicó `db/178` desde otra copia del código: `base_zona.orden` (Alcobendas, Aravaca, Canillejas, Alcorcón, Getafe), Aravaca nueva y Usera apagada. A las 18:18 `db/179` la deshizo: sin `orden`, sin Aravaca, y Usera activa otra vez con 12 cuadrantes. Ninguno de los dos ficheros está en el repositorio. El tablero lee las bases con `SELECT *` y sin `orden` las ordena por nombre, que es justo como las quiere Camilo; por eso no se cayó con la columna yendo y viniendo.

Al pinchar una base queda solo la suya, y además:

- **Las mismas tarjetas de siempre cuentan solo esa base** (`resumen.porZona`): coches, fijos y CT de día y de noche, CT sin días, fijos y CT que faltan, huérfanos. El banquillo sigue siendo de todas: la gente no tiene base hasta que se le da coche. La columna de huérfanos también se filtra.
- **Sus cuadrantes salen de mejor a peor**, en tres escalones con su franja:
  1. **Completos**: todas sus plazas tienen dueño, hoy o ya escrito.
  2. **Con plazas vacías**: les falta un fijo o días de correturnos.
  3. **Sin nadie**: ni una persona puesta ni por llegar.

  Debajo de todo, los cuadrantes **sin coches** (recién creados).

Dentro de cada escalón, primero los coches que **ruedan**, luego los que están en cobertura sin rodar (reservado, transporte) y al fondo los del taller o el siniestro (Camilo eligió «al fondo de su escalón»: un coche parado no da horas aunque tenga la tripulación entera). Entre iguales, **más horas instaladas** primero.

> [!important] Las horas instaladas
> Las de la semana que se mira: por cada día y turno (14), el **promedio de horas por día trabajado de quien lo cubre** —su calificación, la del chip «9,4 h · A»—. Un turno sin nadie suma 0, y quien está de vacaciones no cubre (sale de `f_cobertura`). Así pesan a la vez estar completo y tener buenos conductores, que es lo que pidió Camilo: *«los mejores conductores: la capacidad instalada de la matrícula en horas los días que se trabajan»*. Quien aún no tiene calificación (N/E) cuenta con la **mediana de la flota** y se dice en la ayuda: contarlo como 0 hundiría el coche que se acaba de completar. Quien trabajó y no hizo horas cuenta 0 de verdad. La barra llena son 14 turnos a 9 h (la S).

Un **cuadrante** va en el escalón de sus coches —completo si lo están todos, sin nadie si no hay nadie en ninguno, si no con plazas vacías— y se ordena por la **media de horas por coche**, no por la suma: con la suma, uno de tres coches flojos pasaba delante de uno de dos muy buenos solo por tener más coches. La cabecera enseña las dos («227 h · 114 h por coche»).

**El orden lo pone el servidor** (`modules/Planificacion/iceberg.js`, puro y probado en `scripts/probar-iceberg.js`): le añade `iceberg` a cada coche y cuadrante (escalón, horas, lo que le falta, su base y su `orden`) y calcula `resumen.porZona`. La pantalla solo agrupa. Lo que le falta a cada coche lo apunta `planificador.repo` en `coche.falta` con **la misma regla que las tarjetas**, así que las bases suman lo mismo que el total: fijos, coches, personas y huérfanos cuadran al uno. Los **CT que faltan** se redondean base a base (días ÷ 6 hacia arriba), y por eso las bases pueden sumar uno o dos más que la tarjeta general: el 05/10/2026, 25 + 51 días daban 5 + 9 en total y 6 + 10 sumando bases. Un correturnos no se reparte entre bases, así que el de la base es el número para contratar en ella.

**La base de un coche** es la de su cuadrante y, si no está en ninguno, la suya. Los coches sin base activa no son una sexta base: salen como un aviso pequeño, «5 coches sin base», que los abre igual que una base.

**Dos vistas**, con un conmutador en la barra que se recuerda en el navegador:

- **Horizontal**: la tabla de siempre, una fila por coche y las plazas en columnas, con todo el detalle (teléfono, zona de casa, libranza excepcional). Bajo la matrícula, sus horas y lo que le falta.
- **Vertical**: cada coche es una tarjeta con sus plazas apiladas, **el día a la izquierda y la noche a la derecha**, para ver más coches de un golpe. El nombre se queda con toda la línea y el chip de horas va debajo (al lado, en una tarjeta estrecha el nombre se quedaba en «Carl…»). El teléfono y la zona de casa van en la ayuda del nombre; la libranza excepcional y la zona de casa se editan en la horizontal.

**La base abierta viaja en la dirección** (`/planificador#base=getafe`): recargar o pasar el enlace abre la misma base, y «atrás» vuelve a las bases en vez de salir del planificador. Crear un cuadrante con una base abierta lo crea en ella y lleva la vista hasta él (un cuadrante vacío va al fondo del iceberg).

Lo que **no** cambió: crear y editar cuadrantes, bloques, CT, eventos y fichaje funcionan igual. La **parrilla impresa** sigue por número de cuadrante: es papel colgado en la pared y ahí se busca por número.

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

**El turno de un fijo lo dice su plaza de fijo.** El de un correturnos sale de dónde tiene más días, que para él significa algo; para un fijo no, porque no tiene días puestos en ninguna parte —los suyos son todos menos el descanso del coche—. Un fijo de día que además llevara un correturnos de noche pesaba 0 contra 2 y salía como fijo de noche.

### Qué cuenta cada tarjeta, y de dónde lo saca

Auditadas todas contra la base el **18/09/2026**. Dos daban un número que no era. Desde el 05/10/2026, con una base abierta, las mismas tarjetas cuentan solo esa base (ver [[#Las bases y el iceberg (05/10/2026)]]).

| Tarjeta | Cuenta | Sale de |
|---|---|---|
| Fijo día / noche | personas con plaza de fijo, por el turno de esa plaza, **más quien llega a una plaza de fijo VACÍA** | `asignacion` vigente, y la futura si la plaza está vacía |
| CT día / noche | correturnos con 4 días o más, **contando los días de las plazas VACÍAS a las que llegan** | días escritos en sus cuadrantes |
| Fijos que faltan | plazas de fijo **sin nadie, contando lo ya planificado** en coches operativos | `asignacion` vigente **y futura** |
| CT que faltan | días que libra un fijo y **nadie tiene escritos** (hoy o desde más adelante), ÷6 | el cuadrante, con las asignaciones futuras |
| Huérfanos | gente asignada a un coche fuera de cobertura | `v_conductor_huerfano` |
| Banquillo | activos sin plaza + correturnos a medio poner | ver más abajo |
| Próximas incorporaciones (panel lateral) | gente nueva y quien vuelve de vacaciones o baja médica **a otro cuadrante**, de hoy en adelante | `asignacion` futura, `conductor_estado_hist` (`proximasIncorporaciones`) |
| Bajas · últimos 5 días (panel lateral) | quién ha causado baja **de hoy a 4 días atrás** y no tiene otro contrato abierto; al pinchar el nombre, el motivo | `conductor_periodo_empleo.baja` y `motivo_baja` (`tablero().bajasRecientes`) |

> [!note] La tarjeta de bajas (29/09/2026)
> La pidió Camilo: los nombres de los que se han ido en los últimos cinco días y, al pinchar, **el motivo**. Vive en la **columna lateral**, entre *Coches de emergencia* y *Banquillo*, con la misma cara que los huérfanos, y sin nadie no sale (así la quiso Camilo; el primer rato estuvo a lo ancho bajo las tarjetas). Cada uno se despliega por su cuenta (motivo, ETT o plantilla, día de la baja y **el último coche que llevó**, que es la plaza que deja) y lo abierto sobrevive al repintado del tablero.
> - Cuenta **desde hoy**, mires la semana que mires: la pregunta es quién se ha ido estos días. Los días están en `DIAS_BAJAS` (`planificador.repo.js`).
> - **No sale quien tiene otro contrato abierto**: pasar de ETT a plantilla cierra un periodo («Pasa a plantilla propia») y abre otro el mismo día, y quien vuelve tiene uno nuevo. Con dos periodos cerrados en la ventana sale una vez, con el último (Macilon, 24/09, dos veces por la ETT).
> - Sin motivo apuntado sale **«Sin motivo apuntado»** en ámbar. El 29/09 pasa en casi todas las bajas de ETT: se dan sin motivo. **NSPP** lleva al lado «no superó el periodo de prueba».
> - El 29/09 salían tres: Marius Cristian Jura (28/09, baja voluntaria, 6663LCY noche), Helmuth Isaac Held (25/09, NSPP, 5912LBZ noche) y Diana Madeline Alvarez (25/09, ETT GiGroup, sin motivo, 1209MJY día).

> [!note] Próximas incorporaciones (06/10/2026)
> La pidió Camilo: quién va a entrar en un coche **de hoy en adelante**, en la columna lateral, encima de *Bajas*. Cada nombre lleva su etiqueta a la vista: **Nuevo**, **Vuelve de vacaciones** o **Vuelve de baja médica**. Al pincharlo se despliegan su **número**, la fecha de incorporación y cada plaza (matrícula, **Fijo o CT** con su turno, **cuadrante** y **base**). Para quien vuelve, además, dónde estaba y cuánto estuvo fuera. Debajo, **«Ver su cuadrante»**: lleva la vista a su cuadrante y lo marca un momento con el acento, junto con la fila de su coche, para ver a sus compañeros. Si el buscador o «solo con huecos» lo esconderían, se quitan, y si hay otra base abierta, se abre la suya. Sin cuadrante, el botón es «Ver su coche».
>
> Quién entra (`planificador.repo.proximasIncorporaciones`):
> - **Nuevo**: es la primera plaza de su contrato abierto. Una re-alta también cuenta.
> - **Vuelve de vacaciones o de baja médica**: la plaza empieza dentro de la ausencia o hasta 7 días después de acabarla, y **solo si le han cambiado de cuadrante**. Si su coche no está en ningún cuadrante, se compara el coche. Quien vuelve a lo suyo —lo normal, y lo que deja «Cubrir esta plaza»— no sale.
> - Quien ya trabaja aquí y solo cambia de coche no sale: no es una incorporación. Una persona sale una vez con todas sus plazas, y el mismo coche y puesto en dos tramos sale una vez.
>
> **«Antes» es su ÚLTIMA plaza anterior a la nueva**, no la que tenía la víspera de irse. Con la víspera, Wellim (se fue el 03/09, el día que arranca el cuadrante) y Rodrigo (con un hueco justo el 09/09) salían «sin coche» y, por tanto, como cambiados, aunque los dos vuelven a su coche de siempre. Cuenta **desde hoy**, mires la semana que mires, como la tarjeta de bajas. Con una base abierta, solo salen los que entran en un coche de esa base.
>
> El 06/10/2026 salían dos nuevos: Juan Francisco De la Fuente (06/10, 3110KSM) y José Amador López (10/10, CT en el 8203LTR y el 8930KVC). Probado con fechas de septiembre: salen las vueltas con cambio (Rachid Lakraa, Juan Carlos Vierma, Harold Torres…) y no las de quien vuelve a lo suyo.

> [!warning] «CT que faltan» decía 28 y eran 15
> Contaba los días que `f_cobertura` no llenó **en la semana abierta**. De los huecos de coches con fijo, **117 eran de días ya pasados** y 47 de hoy en adelante; 24 de ellos ya tenían dueño escrito. Se contrataba por un número que medía el pasado de la semana que tuvieras abierta. Ahora: 264 días de CT que pide el cuadrante, 181 con dueño, **83 sin nadie → 15 personas**.
>
> `diasSinCubrir*` **se queda con la cobertura**, y está bien: esa es otra pregunta —quién no va a salir esta semana— y ahí la fuente buena es `f_cobertura`. Lo que no se puede es contratar con ella.

> [!important] Lo planificado a futuro cuenta (28/09/2026)
> Camilo: *«faltan 7 fijos, pero si pongo a alguien del banquillo en una de esas plazas, ya faltan 6»*, aunque entre la semana que viene. Las dos tarjetas miran **cómo queda cada plaza con todo lo ya escrito**, en las dos direcciones:
> - **vacía hoy, con su próximo dueño escrito** → no falta: llega (`resumen.planificados`).
> - **ocupada hoy por alguien que se va** (su asignación tiene fin) **sin nadie detrás** → falta: se queda vacía (`resumen.seVan`).
>
> Sin lo segundo, quien cambia de coche contaba en los dos a la vez: Juan Manuel, del 7222LVG al 8203LTR el 05/10, tapaba las dos plazas. Un suplente con fin y con el titular escrito detrás no cambia nada. En los CT, los días con dueño son los del próximo correturnos si lo hay, y si no los del de hoy mientras no se vaya; y un coche cuyo fijo llega ya cuenta los relevos que necesitará.
>
> Efecto el 28/09/2026: salen **7 fijos y 10 CT** mirando esta semana, la del 05/10 o la del 12/10 — la cuenta ya no depende de la semana abierta. Debajo del número la tarjeta dice cuántas «ya planificadas» y cuántas «se quedan vacías», y al pasar el ratón, quién, dónde y cuándo.
>
> **Y las tarjetas de personas** (Fijo día/noche, CT día/noche) cuentan a **quien llega a una plaza VACÍA**, y a nadie más. Camilo, con el 0431MMZ delante: David y Hamid tienen su relevo escrito (Wellim el 06/10, Charlie el 04/10) —**cuatro nombres, dos fijos**—; en el 1194LCK, sin fijo, Jonathan entra el 29/09 y **ya cuenta**. Se cuentan personas, así que quien cambia de coche (Juan Manuel) sale una vez. Efecto el 28/09/2026: fijo día 66 → 68 (Jonathan y Abraham, que entra en el 1209MJY, hoy fuera de servicio), CT día 26 → 28 (Iván y Harold), CT noche 20 → 21 (Raúl completa sus días con el 5906LTT). Al pasar el ratón por la tarjeta se ve quién llega (`resumen.llegan`).

> [!tip] El banquillo dice quién ya tiene coche esperándole
> Estar sin plaza **hoy** no es estar libre: hay quien tiene su coche escrito para el lunes. Sin decirlo, Tráfico lo coloca en otro sitio y esa persona sale en dos cuadrantes a la vez. La ficha lo avisa: «ya entra el 21/09 en 0524MMZ · 8930KVC». Es el reverso de [[#El buscador ve también lo que aún no ha pasado]].

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

## El botón «Fichaje»

Desde el 24/09/2026 la barra del planificador tiene un botón **Fichaje**: es donde se enciende, persona a persona, quién ficha su turno por WhatsApp (iniciar suelta el motor del coche y terminar lo bloquea). Está aquí porque es donde Tráfico tiene a la gente delante; las reglas son del fichaje. Una **llave** junto al nombre marca a quien ficha. Todo en [[Fichaje#El panel «Fichaje» del planificador]].

**Desde el 28/09/2026 se llama «Bloqueo de motor»**: abrir turno por WhatsApp es de **todo conductor de alta** (Camilo lo confirmó el 29/09), y el botón ya solo decide a quién se le **bloquea el motor** al terminar.

## La cobertura y el aviso de turnos

`/cobertura` lee del **tablero**, no de una hoja: lo que se ve ahí es exactamente lo que hay en el cuadrante. Devuelve, por día y turno, quién sale y —sobre todo— **qué coches no salen, cada uno con su motivo**: descansa, titular ausente, plaza vacía, conflicto, vehículo fuera de servicio.

La semana **no empieza de cero**. El lunes el coche se recibe de quien lo dejó el **domingo pasado**, y el último día se entrega a quien lo coge la semana siguiente. Por eso `cobertura.repo` consulta aparte los bordes de la semana.

### De hoy a 7 días (28/09/2026)

Camilo: *«si hoy es martes, que me diga los turnos de hoy a 7 días: ignora el lunes, que ya pasó, y termina el martes»*. Lo que ve el conductor al pulsar **Ver mis turnos**, y la pestaña **Por conductor** de `/cobertura` en la semana actual, son sus turnos **de hoy al mismo día de la semana que viene**: ocho días, hoy incluido.

- `cobertura.repo.proximos()` carga las **dos** semanas que pisa la ventana y `ventana()` (pura, probada en `scripts/comprobar-cobertura.js`) las corta. Solo entra quien trabaja algún día de la ventana.
- «Hoy» es el **día operativo** (05→05): el de noche que pregunta a la 01:00 todavía ve su turno de ayer, que es donde está a quién entrega el coche a las cinco.
- Cada día lleva su **fecha**, y los relevos también (`recibeDe.fecha`, `entregaA.fecha`). Con la ventana, «lo deja el domingo pasado» ya no se sabe respecto a qué: se dice «lo deja el jueves 01/10», y solo si el coche se queda parado en medio (relevo no directo).
- Las **semanas que vienen** se siguen viendo de lunes a domingo en `/cobertura`: sirven para planificar, y ahí el lunes todavía no ha pasado. La pestaña **Por día** tampoco cambia: es la cobertura de la semana.

El aviso por WhatsApp tiene cinco reglas (`modules/Planificacion/cobertura.service.js`):

1. **El apunte nunca tumba el envío.** Si el registro falla, el WhatsApp sale igual. No avisar a nadie porque no se pudo escribir una fila sería cambiar un problema de contabilidad por uno de operación.
2. **Se manda la PLANTILLA, no el detalle.** El mensaje lleva un botón; el conductor lo pulsa y es el bot quien le cuenta sus turnos: los de **ese día a 7 días**, contados desde que pulsa. Hasta el 28/09/2026 se apuntaba en memoria la semana avisada (`avisoTurnos`) para enseñarle esa; ya no hace falta y se quitó. En la semana actual se avisa a quien trabaja **de hoy a 7 días** (Cobertura y el botón de cada cuadrante del planificador); en las siguientes, a quien trabaja esa semana.
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

## El banquillo es para planificar, y solo eso

Tres listas en la columna lateral, y cada una contesta a una pregunta distinta (`planificador.repo.js`):

| Lista | Quién va | Para qué |
|---|---|---|
| **Banquillo** | activos sin plaza **+ correturnos a medio poner** | a quién puedo poner en un coche ahora |
| **Vuelven** | vacaciones y permisos, con fecha | planificar su regreso |
| **Sin fecha de vuelta** | baja médica, suspensiones | no se planifican, pero su ausencia tiene que explicarse |

Antes era una sola lista con los de vacaciones dentro y su etiqueta al lado, y había que leérsela entera para saber quién servía. Los de baja médica no salían en ninguna parte.

**Un correturnos a medio poner sí es banquillo.** Con dos días puestos no está colocado: le faltan días de trabajo y de sueldo. Tenía su aviso arriba pero no había dónde ir a arreglarlo, porque la lista de a quién colocar lo daba por puesto.

Dos cosas que hay que mirar bien para no meter a quien no toca:

- **Quién es correturnos lo dice el ROL de su plaza**, no su jornada. `cat_jornada.dias_ct` lo tiene todo el mundo —fijos incluidos—, así que un fijo pasaba el filtro. A un fijo no se le ponen días: libra el descanso de su coche y trabaja el resto.
- **Se cuentan los días de su ASIGNACIÓN** (`asignacion_dia`), no los que cubre esa semana. Quien entró en el coche un jueves cubre tres días esa semana y no le falta ninguno: es que no estaba.

El corte son **cuatro días**, no «lo que le falte para su tope». Medido el 18/09/2026: con el tope por contrato entraban 92 personas y 85 eran «5 de 6» —el reparto normal de una semana, no un problema—; con el suelo de cuatro son 8, y son los de dos y tres días. El banquillo pasó de 99 nombres a 15.

### Los tres sitios que cuentan días cuentan lo mismo

La misma cuenta la miran **tres** pantallas: el banquillo, la tarjeta de «CT sin días» y la lista de avisos. Por eso el suelo es una constante del módulo (`CT_SUELO_DIAS`) y no tres cifras sueltas: con tres, la pantalla se contradecía a sí misma.

Y las tres cuentan lo mismo: **los días escritos en sus cuadrantes**, sumados sin repetir —dos en un coche y dos en otro son cuatro—, con el respaldo de los días que le tocarían por ser el correturnos de ese coche si la plaza no tiene ninguno escrito.

> [!warning] La cobertura no sirve para contar días de cuadrante
> `f_cobertura` dice **quién sale mañana**, así que solo ve lo que cae dentro de la semana mirada y descuenta a quien está de baja. La tarjeta contaba con ella y avisaba de doce correturnos de los que once tenían sus cuatro días puestos: a quien entró en sus dos coches el viernes 18 con L M X J escritos le salían **cero** días, porque sus cuatro días ya habían pasado cuando llegó. La columna «Reparto» de esa misma tarjeta ya enseñaba las letras buenas, así que la cifra y las letras se contradecían a la vista.
>
> Para saber si un cuadrante está completo hay que mirar el cuadrante. Medido el 18/09/2026: la tarjeta bajó de 12 a 1 y los avisos de 10 a 1.

## El buscador ve también lo que aún no ha pasado

El filtro del tablero mira la matrícula, quien está puesto, **quien está por llegar** (`p.futuro`) y la vacante que tiene prometida la plaza. Una plaza vacía hoy puede tener dueño para el lunes, y buscar su nombre contestaba «no hay nada» justo cuando querías ver dónde cae.

## Incorporaciones: el traspaso desde Selección

**El nombre lleva a su ficha** (08/10/2026): en los avisos de quien acaba de entrar («se dio de alta · Sin plaza prometida» y las incorporaciones con vacante), pinchar el nombre abre su ficha en Plantilla (`/plantilla#id`).


Cuando alguien se da de alta nace una alerta que Tráfico ve en el planificador. Desde el 18/09/2026 nace **siempre**, con vacante o sin ella, porque el caso que faltaba era justo el peor: alguien entra sin plaza prometida y el cuadrante no se entera de que hay una persona nueva esperando coche.

**Sin vacante** no hay nada que aceptar —no se le prometió ninguna plaza—, así que el aviso solo dice que hay alguien nuevo sin coche y **se va solo** en cuanto se le da una plaza. No hace falta que nadie lo cierre: la consulta de pendientes lo esconde cuando la persona tiene asignación viva.

> [!bug] La ETT no lo estaba mandando — arreglado el 23/09/2026
> Lo de arriba valía para Selección, pero el alta de la ETT **se salía antes de pedirlo**: si no había vacante elegida, no llamaba a `incorporaciones.crear` y no nacía ninguna alerta. Resultado: alguien entraba por el alta rápida, quedaba contratado y en la lista de la agencia, y el cuadrante no se enteraba. Le pasó a Óscar Góngora y por eso se vio.

**Con vacante**, la alerta trae la foto de lo prometido —y desde el 23/09/2026 la plaza **ya es suya** cuando la alerta aparece—:

- **Al dar el alta** se coloca en las plazas prometidas, **todo o nada**, desde su **fecha prevista de alta**. Antes esto esperaba a que alguien aceptara, y mientras tanto la plaza seguía libre a la vista de todos: se la podía llevar otro, y el recién contratado no estaba en ninguna parte.
- **Aceptar** → solo confirma. **No vuelve a colocar**: el cuadrante puede haberse tocado a mano desde que entró, y escribir encima con la foto vieja sería pisar trabajo de Tráfico. La vacante queda cubierta.
- **Rechazar** → ahora también lo **SACA** del cuadrante, y después lo deja en el banquillo y reabre la vacante.

> [!warning] Rechazar dejó de ser gratis
> Cuando la alerta era una propuesta, rechazar no tenía nada que deshacer. Ahora puede haber una persona ya metida en el cuadrante. Por eso existe `incorporacion.colocada_at` (db/135): sin ese dato, el rechazo o no limpia nada, o intenta limpiar lo que nunca se escribió. Y se vacían **solo las plazas que sigue ocupando él** —entre medias pueden haberle movido de coche—, comprobándolo una a una.

El reparto de responsabilidades importa: el repositorio de incorporaciones (`modules/Seleccion/incorporaciones.repo.js` desde el 01/10/2026; este módulo entra por `incorporaciones.service`) prepara **qué** plazas y **desde cuándo** (es quien guarda la foto de la vacante) y apunta el resultado; `tablero.service` **coloca**, que es escribir en el cuadrante (`colocarIncorporacion` al dar el alta, `aceptarIncorporacion` cuando todavía no lo estaba, `encargoDeQuitar` + `rechazarIncorporacion` para sacarlo). Y el orden importa: se marca aceptada **después** de colocar. Como `guardar` es todo o nada, si una plaza ya no existe la alerta sigue pendiente y se puede reintentar, en vez de quedarse cerrada sin haber colocado a nadie.

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

**Nadie entra en una plaza antes de su alta** (24/09/2026). Colocar a alguien «desde hoy» cuando su contrato empieza mañana lo dejaba de titular hoy: el planificador lo pintaba en el coche y Control lo esperaba y lo daba por «no ha salido». Le pasó a Víctor Jiménez Barbero (alta el 25, colocado el 24) y ese mismo día a otros cuatro. Ahora `colocar`, `cubrirAusencia` y la comprobación previa (`comprobarPlan`) empiezan el día del alta (`entraDesde`, que mira el contrato abierto): hasta entonces la plaza sale vacía con «→ llega el …», como cualquier llegada futura, y el que la llevaba se queda hasta que llega el nuevo. Si el «hasta» pedido cae antes del alta, se dice. `db/151` corrigió las cinco que había de gente que aún no había entrado. Las pasadas se corrigieron después (`db/152`) **solo si esa persona no hizo horas en BOLT esos días**: planificada y sin horas, salía como «Ausencia» un día en que aún no trabajaba aquí. Fueron cuatro (Pablo Molero, Jonatan San Segundo, Elena Cánovas, Abdelkader Kourrit); se dejaron las de Macilon Dos Santos (42,6 y 33 h hechas antes de su alta) y Abdelhak Harroun (0,2 h). La bitácora solo sella las horas, no el estado, así que esos días se leen bien sin tocar nada más.

- **El barrio no es la localidad.** `barrio` es la zona de casa del conductor ("Aluche", "San Blas") y sirve para repartir cuadrantes; `localidad` es el municipio de la gestoría. Se editan en sitios distintos y no se tocan. Ver [[Reglas de la casa]].
- **Cambiar la matrícula renombra el coche, no mueve a nadie**: la gente cuelga de sus plazas y las plazas del vehículo. Para mover la tripulación está el botón de cambiar de coche.
- **La zona viaja como texto** desde el front y la columna es una clave ajena: se busca por nombre y, si no existe, se dice cuál es en vez de dejar un error de tipos.
- **El permiso de verdad está en el servidor** (`/planificador/editar` sobre cualquier petición que no sea un GET). La pantalla envuelve `fetch` entera en vez de apagar botones uno a uno: en este cuadrante se escribe desde treinta sitios y una lista de botones se queda corta el día que se añada el treinta y uno.
- Los días de la semana viven **una sola vez** en `services/nucleo.js` (`DIAS_CORTOS`, `DIAS_LARGOS`, `LETRAS_DIA`). Había seis copias, y la del motor obligaba al tablero a llamar hacia arriba solo para saber cómo se abrevia "miércoles".

## Lo que aún no está bien

`modules/Planificacion/planificador.repo.js` son ~2.262 líneas con reglas dentro que son de servicio: qué pasa al cambiar un coche, cómo se encadena un relevo. Se movió el módulo primero — mover y partir a la vez es como se pierde una ruta sin enterarse.

`agenda` y `matching` se **borraron** el 15/09/2026: la agenda de tráfico era un segundo sitio para mirar lo que ya está en Plantilla y además era la única pantalla que **escribía** en `AGENDA_V2`. Ver [[Flota viva]] y [[Glosario]].
