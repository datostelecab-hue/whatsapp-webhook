---
tags:
  - modulo
  - conductores
  - plantilla
  - identidad
  - bolt
  - auditoria
  - postgres
---

# Conductores

Quién trabaja aquí y en qué condiciones: la ficha de la persona, su contrato, sus papeles y su cuenta de [[BOLT]]. El módulo está en `modules/Conductores/` y se entra por `modules/Conductores/plantilla.service.js`, nunca por un `.repo`.

```
/plantilla                    la pantalla
/plantilla/api/lista          quién hay, con su resumen
/plantilla/api/ficha/:id      la ficha administrativa
/plantilla/api/ficha360/:id   la hoja de un vistazo
/plantilla/api/gestoria.xlsx  el Excel para la gestoría
```

`/conductores` redirige aquí con un 301.

## Dos áreas, dos fichas

La misma plantilla la miran dos áreas y buscan cosas distintas: **Tráfico** quiere saber quién puede conducir hoy, **RRHH** quién está de alta y con qué contrato. De ahí salen dos decisiones de diseño:

- **Hay dos fichas.** La **administrativa** (`modules/Conductores/conductores.repo.js`), con sus historiales y sus acciones, y la **de un vistazo** (`modules/Conductores/ficha360.repo.js`): calificación, horas, dinero, papeles que faltan, excesos de velocidad y lo hablado con esa persona. La segunda solo se pide cuando alguien abre a alguien, no en cada listado.
- **Lo editable depende del rol.** La pantalla pregunta `/api/campos` y enseña unos campos abiertos y otros de solo lectura, en vez de dejar intentarlo y fallar. El ámbito de cada campo es `sensible` u `operativo`; el rol `trafico` solo toca lo operativo.

La ficha de un vistazo **no calcula nada nuevo**: la letra la pone `calificacion`, las horas la bitácora, el dinero la capa BI, los papeles el almacén de documentos. Cada bloque va con su propio `.catch()` — que falte el dinero de un mes no puede dejar sin ficha a una persona. Y los bloques para los que aún no hay datos (siniestralidad, multas, pluses, finiquito) **salen marcados como pendientes en vez de desaparecer**: un hueco visible es una lista de lo que queda por conectar, y un bloque ausente no es nada.

**Salen TODOS por omisión**: activos, ausentes y quien ya causó baja. La pregunta más frecuente incluye a los que se fueron ("¿este trabajó aquí?"). Con `?vigentes=1` se limita a los contratados ahora mismo.

**`momento` deja mirar una fecha pasada**: quién estaba de alta, en qué turno y en qué coche. Con las hojas esto no se podía preguntar.

## La lista va por la fecha que enseña, de la más reciente a la más antigua

Alfabético ordena una guía de teléfonos, no una plantilla. En una lista de más de doscientas personas, **las recién incorporadas son las que hay que mirar** —les falta documentación, no tienen cuenta de BOLT, están en periodo de prueba— y estaban repartidas por toda la lista según su apellido.

`ORDER BY COALESCE(ultimo.baja, e.alta) DESC NULLS LAST`, con el nombre de desempate para que dos fechas iguales salgan siempre en el mismo orden: sin él, dos recargas de la misma pantalla podían dar dos ordenaciones distintas de las mismas personas.

**Se ordena por la MISMA columna que se pinta.** La columna «Desde» enseña el alta de quien está vigente y la **baja** de quien ya no está —de quien se fue, lo que importa es cuándo se fue—. `ultimo.baja` solo existe si no está vigente, así que ese `COALESCE` dice exactamente lo mismo que la celda: los recién llegados arriba en una bandeja, los que acaban de irse arriba en la otra. Ordenar por el alta a secas dejaba la bandeja de bajas con fechas que parecían puestas al azar.

**Sin fecha van al final**, no al principio: una fecha que no existe no es una incorporación de hoy. De las 427 fichas hay 208 sin `alta`, pero **ninguna de ellas está vigente** — son fichas antiguas, y con el filtro de siempre («de alta») no se ven.

> [!note] Los filtros no reordenan nada
> El orden lo pone la base UNA vez y la pantalla solo filtra: `visibles()` del componente **Listado** ([[Reglas de la casa]]) es un `.filter()` puro sobre las mismas filas, y el buscador tampoco ordena por relevancia. Por eso el criterio vale igual mirando a todos, a los de baja, a los que entran o escribiendo en la caja de búsqueda — y lo que se exporta sale en ese mismo orden.

> [!tip] Una fecha imposible sube sola a lo más alto
> Efecto secundario del orden: un año mal tecleado deja de esconderse en mitad de la lista. Willian Azier Benavides Guaman sale con **baja el 16/08/2033** y ahora encabeza la bandeja. 17 bajas más no tienen fecha y caen al final.

## La regla de identidad

> **El nombre NO identifica.** Sirve para leer la fila, nada más. Quien identifica es el id, y hacia fuera el **DNI** y la **cuenta de BOLT**.

Por eso el listado trae siempre esos dos y avisa de quién no tiene ninguno. Y por eso `buscarPersona()` —lo que usa la ticketera cuando llega un formulario— tiene un orden que no es caprichoso:

1. **DNI**, que es lo único que identifica a una persona por ley y no se repite.
2. **Teléfono**, por los **9 últimos dígitos**, que es como se guardan (`sufijo9`).
3. **Nombre de BOLT**, el último y solo si es exacto.

Si dos personas distintas responden a la misma pista con el mismo criterio, **devuelve null**: no se elige. Hay homónimos en el padrón real —**tres**— y casar a alguien por nombre le imputa las vacaciones (o las horas) a otro.

### El teléfono es único

El sufijo de 9 dígitos es **único entre los vigentes**. Lo garantiza la base; se comprueba antes solo para poder decir **de quién es**: *"Ese teléfono ya es de Fulano"*.

### Un choque de DNI o de teléfono casi nunca es un error de tecleo

Es que **esa persona ya existe**. Puede estar trabajando (y entonces el dato está mal) o estar de baja (y entonces lo que toca es volver a darle de alta, **no crear un duplicado**). Por eso el error no es solo un texto: viaja con `conflicto`, que dice de quién se trata y si está de alta, para que la pantalla pueda ofrecer el paso siguiente en vez de dejar a alguien delante de un mensaje sin salida.

### El nombre que se muestra

En todas las pantallas manda **el nombre de BOLT**. Si no tiene cuenta de BOLT con nombre, el suyo con `(sin nombre de BOLT)` para que aparezca algo y no un guion; y si tampoco, su id. Es la regla de la casa ([[Reglas de la casa]]) y se repite idéntica en el planificador, en los reportes y en la cobertura.

`nombre_bolt` se **copia** a la ficha del conductor enlazado en vez de resolverse por subconsulta: lo leen 29 consultas repartidas por 15 ficheros, algunas sobre cientos de filas, y un `SELECT` por fila se paga. Con varias cuentas manda la **activa**; entre varias activas, la vista antes.

### Lo que la base garantiza y el código solo traduce

Todo lo que tiene historial —empleo, situación, turno, teléfono, coche, libranza— pasa por `services/repo/vigencia.js`, que **cierra la anterior y abre la nueva en una sola transacción**. En este módulo no se escribe ni un `hasta` a mano, y no se repite ni un `hasta IS NULL`.

## Situación, altas y bajas

La situación de la ficha se decide así: **quien no tiene el empleo vigente está de baja, diga lo que diga su historial**. El contrato manda sobre el estado. Antes esto miraba la fecha de alta, y el día de una baja la persona seguía saliendo "Activo".

Al revés también: **contratado pero aún sin empezar no es una baja**. Quien tiene alta para dentro de dos días está contratado, y sale como `Entra el 18/09` — se distingue por la **etiqueta** y no por el código, para que los filtros por situación sigan funcionando. Antes esa gente salía como "Baja en la empresa", que es lo contrario de lo que pasa, y además el planificador —que nunca miró esa fecha— la daba por planificable: **dos pantallas contradiciéndose sobre alguien que empieza el jueves**.

Un solo periodo por persona: el abierto manda; si no, el de alta más reciente de los que aún no han terminado. Antes se unían **todos** los no terminados, y el día en que se cierra uno y se abre otro (una re-alta el mismo día) la persona salía **duplicada**, las dos filas como "Activo".

El detalle de altas, bajas, ausencias y cambios de jornada está en [[RRHH]].

### Dar de baja borra lo que empieza DESPUÉS

Un tramo que arranca el 21 no se puede cerrar el 14 — la base lo prohíbe, y con razón: eso **nunca existió**. Así que al dar de baja, lo posterior a la fecha **se borra** (asignaciones y sus días de cuadrante, situaciones, turnos y libranzas) y lo que ya estaba en marcha se **recorta** a ese día.

Es la misma función que usa la rama de "alta futura cancelada": **una sola definición de dar de baja**, en vez de dos que cierran cosas distintas. → [[Trampas conocidas]]

### Un tramo "Activo" abierto es el fondo, no un obstáculo

Al añadir una ausencia, un tramo abierto que **no sea ausencia** se **parte**: se cierra la víspera y se vuelve a abrir al día siguiente de la vuelta, todo en una transacción.

Sin eso, a quien vuelve de una baja —y se le queda un `activo` abierto— **no se le podía poner ninguna ausencia más**. Dos ausencias solapadas siguen siendo un error y siguen avisando.

### De dónde salió cada tramo

El **Historial de situaciones** enseña, además de las fechas, **quién lo puso** y —si vino de la [[Ticketera]]— el **ticket** y el **justificante de Drive**, los dos leídos del ticket cada vez que se pinta, no copiados. El tramo solo guarda el número: `conductor_estado_hist.ticket_id`.

## La libranza sale del cuadrante

**Ya no se teclea.** El fijo libra el descanso de su coche; el CT, los días que no le pusieron. La columna "Libra" lo enseña y el tooltip distingue si viene del cuadrante o de un patrón puesto a mano. La regla vive **una sola vez**, en la vista `v_conductor_libranza` (`db/113`), para que Plantilla y la agenda de PostgreSQL no puedan decir cosas distintas de la misma persona.

El turno que se pinta es el del historial si alguien lo puso a mano y, si no, el de su **plaza**, que es donde vive de verdad. Ver [[Jornada y turnos]].

## Las cuentas de BOLT

**Nada de aquí llama a BOLT.** Los datos los trae la ingesta cada pocos minutos y aquí solo se lee de PostgreSQL. Lo único que se ofrece es saber **de cuándo son** (`/api/frescura`), que es lo que sustituye a preguntar.

`modules/Conductores/cazamiento.repo.js` mantiene al día el inventario de cuentas de BOLT (`conductor_externo`), pero **no enlaza a nadie**:

- Cuenta de BOLT sin conductor → *"ID de BOLT libre"*.
- Conductor sin cuenta de BOLT → *"pendiente de asignar ID de BOLT"*.

Es a propósito que no haya nada automático por nombre. **Más vale una lista de pendientes que un dato falso.** Lo único automático es la pasada que casa **por teléfono 1:1**, y aun así quién es quién lo confirma una persona.

Detalles del inventario que son decisiones:

- **Una sola fila por cuenta** antes de escribir: si BOLT devolviera la misma dos veces, el `ON CONFLICT` fallaría con *"cannot affect row a second time"*.
- **`has_cash_payment` distingue el `false` del hueco.** Lo primero es un dato y lo segundo es que no vino en la respuesta; decir "no tiene efectivo" cuando no lo sabemos sería peor que no decir nada. Si una vuelta no trae el dato, se conserva el anterior.
- Las cuentas que hoy **no ha devuelto BOLT** y seguían activas han desaparecido sin pasar por `deactivated`: se marcan `no_vista` para que no ensucien el desplegable.

### Enlazar una cuenta no basta: hay que rehacer sus días

Las horas viven en `bitacora_horas`, que se sella por jornada. Una jornada ya sellada **no se vuelve a calcular sola**, así que enlazar hoy una cuenta que rodó la semana pasada dejaba esas horas en tierra para siempre: no salían en la bitácora, ni en la asistencia, ni en el promedio, ni en la nómina.

> Pasó de verdad: a **Oualid Saguiri** se le enlazó su cuenta el **10/09** y sus casi **cinco horas del día 2** —sellado el día 8— no llegaron nunca a su ficha. Se descubrió comparando el cálculo con lo sellado, no porque nadie lo notara.

Por eso `enlazarBolt` y `soltarBolt` llaman a `rehacerDiasDeLaCuenta()`, que vuelve a sellar desde el primer día que esa cuenta rodó. Al soltarla el problema es el mismo al revés: sus horas dejan de ser de esa persona.

### El cazamiento y una infracción de capas que murió

`cazamiento.repo.js` era `services/cazamientoBolt.js`. Al entrar en el módulo pasó de ser "un servicio al que un repositorio llamaba hacia arriba" a ser el repositorio de al lado, y con eso cayó una de las **siete infracciones de capas** que arrastraba el proyecto.

Al moverlo apareció otra: pedía el padrón de BOLT a `services/conductoresBolt.js`, que es un padrón **sobre hojas de cálculo** con la llamada a la API metida dentro. Eso convertía a este repositorio en uno que depende de Sheets sin necesitarlo. La llamada se mudó a `services/bolt.js` —el adaptador, donde vive "cómo se le pregunta a BOLT"— y los dos la usan de ahí.

## Cuentas fantasma

### Qué son, y por qué existen

A veces BOLT suspende la cuenta de alguien y, para que no se quede en tierra, Tráfico le da una cuenta que está a nombre de otro. Esa persona sale a trabajar y hace sus horas, pero el sistema se las apunta a **la cuenta**, no a quien de verdad conducía: sus días salen en blanco, y eso **le baja la media, lo marca como falta y lo hunde en el reparto del cuadrante**.

Tráfico sí sabe quién iba dentro. `cuenta_fantasma` (`db/134-cuenta-fantasma.sql`) es el sitio donde decirlo.

Una cuenta fantasma es una cuenta de BOLT **sin dueño** (`conductor_externo.conductor_id IS NULL`) que durante un periodo la usó una persona concreta. No se enlaza como cuenta propia —no lo es, y mañana puede usarla otro— sino **por fechas**. Un `hasta` en blanco significa que la sigue usando.

El código está en dos ficheros con un reparto claro:

- `modules/Conductores/fantasma.repo.js` — la tabla y nada más.
- `modules/Conductores/fantasma.service.js` — **la puerta**, y lo que decide es **qué pasa después** de tocar un enlace.

### La regla que no puede romperse

**Una misma cuenta no puede estar prestada a dos personas a la vez.** Las horas de un día son de alguien, y solo de uno.

Eso lo garantiza un **EXCLUDE de PostgreSQL** (`ex_fantasma_sin_solape`, sobre `btree_gist`), **no la aplicación**. Si lo vigilara el código, dos pestañas abiertas a la vez colarían el solape y las horas se contarían dos veces. Lo que sí hace el repositorio es **traducir ese rechazo** a un mensaje que diga con quién choca y en qué fechas, que es lo que hace falta para arreglarlo sin ir a mirar la tabla.

**Una cuenta con dueño no se presta.** Si tiene dueño, sus horas ya son de alguien, y prestarla sería quitárselas sin que esa persona se entere. El desplegable de cuentas prestables ni siquiera las ofrece, y el servicio lo vuelve a rechazar con su razón: *"si de verdad es de esta persona, enlázala como cuenta propia"*.

### Cómo llegan las horas a su sitio

**No se copia nada.** `bitacora.horasCalculadas` resuelve, **por día**, de quién son las horas de una cuenta: si ese día hay fantasma vigente manda el fantasma, y si no, el dueño de siempre. Como `sellarHoras` reescribe el rango que se le pida, **enlazar una cuenta hacia atrás es volver a sellar esos días** — y de ahí salen solas la bitácora, la asistencia, el promedio y la nómina, que todas leen `bitacora_horas`.

Ese re-sellado es **la mitad del trabajo**, y por eso vive en el servicio y no en el repositorio:

- `rangoAfectado()` coge los días del enlace **nuevo y del viejo**: si a un enlace del 1 al 10 se le recorta el `hasta` al día 4, los días 5 a 10 también cambian de dueño y hay que rehacerlos aunque ya no pertenezcan al enlace. Un `hasta` en blanco se cierra en HOY, porque **el futuro no se sella**.
- `rehacer()` vuelve a sellar y **rehace el promedio del mes**: se calcula sobre las horas selladas, así que sin eso la media sigue siendo la de antes hasta que pase el cron de la noche.
- Si el re-sellado falla, **se avisa en la respuesta en vez de tragárselo**. El enlace ya está guardado y las horas se quedarían a medio camino; *"lo guardé pero no se ven las horas"* es justo el fallo que nadie sabría diagnosticar.

### Las fechas

- El mínimo es **2026-06-01**: antes de eso no hay rejilla que tocar (la bitácora arranca ahí), así que un enlace anterior no movería nada y lo más probable es que sea una fecha mal tecleada.
- El **futuro sí se admite** en el `desde` — dejar preparado un préstamo — pero no una fecha a más de un año vista, que delata un error de tecleo.
- Las fechas se piden ya formateadas desde PostgreSQL (`to_char`) y **no se convierten en JavaScript**. Un `DATE` llega como objeto `Date`, y `String(fecha).slice(0,10)` devuelve `"Fri Sep 11"`: se cuela sin romper nada y luego los rangos se comparan como texto y dejan de tener sentido. Es la misma trampa de `toISOString`, que además resta un día en Madrid. Ver [[Reglas de la casa]].

### Las acciones

| Acción | Qué hace |
|---|---|
| `enlazar` | Presta una cuenta sin dueño a una persona por un periodo |
| `cambiarFechas` | Mueve el periodo. Rehace los días **viejos y los nuevos** |
| `cerrarHoy` | Cierra hoy un enlace abierto ("ya le han devuelto su cuenta") |
| `anular` | Las horas vuelven a quien las tuviera antes — la cuenta, si no es de nadie |

`cerrarHoy` se separa de `cambiarFechas` a propósito: es un botón de un clic y el error de teclear la fecha a mano no compensa.

**Un enlace equivocado no se borra: se anula.** Las horas que movió ya pasaron por nóminas y por el cuadrante, y hay que poder contar qué se hizo y quién. Los anulados van al final de la lista de la ficha, **no se esconden**.

### El libro de auditoría

Cada acción sobre una cuenta fantasma se apunta en `cuenta_fantasma_log` con **quién y desde dónde**. Va en tabla aparte —y no en columnas de `cuenta_fantasma`— porque un enlace se toca varias veces y lo que hace falta es **la serie entera, no la última vez**.

Se apunta **siempre**, también al `cambiarFechas` —que es la acción con la que se estiran unas horas sin que se note— y por eso esa acción guarda el **antes y el después**, no solo lo que queda.

Si el apunte fallara **no se tumba la operación**: el enlace ya está hecho y negarlo a posteriori sería peor. Se deja dicho en consola.

Lo que se guarda de la sesión (`modules/Conductores/plantilla.controller.js`):

- `ip` — `req.ip`, no la cabecera a mano: con `trust proxy` Express descarta lo que el cliente pueda haber metido delante.
- `cadena` — el `x-forwarded-for` entero. **La prueba, no solo la conclusión**: `ip` es lo que Express *dedujo* contando saltos de proxy, y si ese número está mal la IP guardada es la de un proxy. Con la cadena delante eso se ve y se corrige sin adivinar.
- `ipCliente` — el `cf-connecting-ip`, si hay un Cloudflare delante.
- `agente` y el nombre del usuario.

El **"dentro / fuera de la empresa"** se decide al leer y **no se guarda**: las líneas de empresa cambian de IP, y una etiqueta guardada haría que las filas viejas mintieran para siempre. Guardando solo la IP, se recalcula sola. Y es `null` —no `false`— cuando no hay IP: *"no se sabe"* y *"desde fuera"* no son lo mismo.

Esto es lo que justifica todo el aparato: si alguien entrara con la cuenta de otro para mover horas —y por tanto dinero—, el libro es lo único que lo delataría.

### Quién más lo consulta

- La **bitácora** pide `enRango(desde, hasta)` para pintar "horas de cuenta fantasma" en las celdas que toca.
- **Control** pide `vigentesHoy()` para avisar de que quien va en ese coche no es el titular de la cuenta.
- La **ficha** los pinta como una tarjeta más, con su propio `.catch()`: si eso fallara, la ficha se ve sin ellos. Y el libro solo se pide si la persona tiene enlaces, porque a la inmensa mayoría de fichas le sobra una consulta más para devolver una lista vacía.

La lista de cuentas prestables se manda **entera** (~1.200 filas, tope 3.000) y el filtro va en la pantalla: cortar a sesenta hacía que la cuenta que buscabas sencillamente no estuviera, sin decir por qué. Va **sin el uuid**, que son 36 caracteres por fila que la pantalla no usa y que en mil doscientas cuentas son 60 KB de los 219 que viajan al abrir.

## Los papeles

Van a la tabla `documento`, que es **de la persona**; los bytes siguen en Drive. Se entra por la puerta del módulo de Documentos, no por su repositorio, para que el archivo pueda cambiar por dentro sin tocar esta pantalla.

Los archivos llegan en base64 dentro del JSON, y `/api/documento` tiene su propio límite de 30 MB: el parser global es de 2 MB y un DNI escaneado se pasa de largo.

**Retirar un documento solo lo saca del índice por omisión**, y el archivo se queda: son papeles laborales y borrarlos de verdad no tiene vuelta atrás.

La documentación obligatoria que falta sale de `v_documento_falta`, que es **la única definición de "obligatorio"** del sistema.

## La ficha de alta, también desde Plantilla (24/09/2026)

En **Documentos**, al lado de «Subir documento», un botón **Generar la ficha de alta** (o **Rehacer**, si ya la tiene). Es **opcional**: la misma ficha que genera Selección, con sus papeles dentro, y queda guardada en sus documentos (tipo `ficha_alta`, `db/149`).

Se pide **por la persona** y no por su candidatura (`paraFichaDeConductor`): de los 220 de alta el 24/09 solo 30 tenían candidatura, y la ficha es casi entera de la persona. Sin candidatura, la fecha de inicio es la de su alta y el nº de hijos va en blanco. La consulta es **la misma** que la de Selección (`FICHA_COLUMNAS` / `FICHA_UNIONES` en `candidaturas.repo.js`): dos copias serían dos fichas que un día dejan de parecerse.

Si le faltan datos **no se genera**, y el aviso los enumera uno a uno. **Tráfico no la genera**: lleva el DNI, la cuenta y la dirección.

### Lo que pide la ficha, también en «Datos»

Para que la ficha se pueda completar desde Plantilla, el formulario de **Datos** trae lo que pide y no era una columna de la persona (`plantilla.service.campos`):

- **Fecha de expedición y de caducidad del carné**, detrás del estado civil, como en Selección. Se guardan en el **documento del carné** (`documentos.service.prepararFechasCarne`): sin el carné subido no hay dónde ponerlas, y se dice. Caducar antes de expedirse se rechaza.
- **IBAN / nº de cuenta**, con la Seguridad Social. Va **cifrado** y **nunca sale a la pantalla**: el campo aparece vacío y su ayuda dice si ya hay uno («Guardado: •••• 1234»); vacío no lo toca. En la auditoría queda que cambió y sus cuatro últimas cifras.

**Se comprueba todo antes de guardar nada**: si las fechas no valen, el formulario entero se queda sin guardar. Tráfico no ve ni cambia ninguno de los tres. La hoja de la persona enseña **Carné** y **Cuenta** en «Datos personales».

Las dos reglas viven en un solo sitio y las usan Selección y Plantilla: las fechas en Documentos (`prepararFechasCarne`, `fechasCarne`) y el IBAN en Conductores (`guardarIban`, `ibanEnmascarado`). Antes solo estaban en Selección. De paso, la ficha de Plantilla **dejó de mandar al navegador el IBAN cifrado**, que viajaba con el resto de la fila.

## La foto de la persona (24/09/2026)

La ficha lleva la foto de cada persona **en la cabecera, al lado del nombre**: un cuadrado fijo de 96 px en el que la foto **se ajusta** (`object-fit: cover`). Da igual que sea vertical, apaisada o un selfie: llena el cuadro sin deformarse y se recorta lo que sobra.

**Sin foto se pinta una silueta** con los colores del tema: el fondo de las tarjetas (`--tc-card2`) y el gris apagado (`--tc-muted`). No hay una imagen por tema: cambia sola al pasar de claro a oscuro o al azul. Si la foto existe pero el almacén no la da, también sale la silueta, y no el icono de imagen rota.

**Es un documento más**, de tipo `foto` (db/147), en el mismo almacén que los papeles. Así se gana sin escribir nada nuevo: subir otra deja la anterior como no vigente en vez de pisarla, se sirve por el ERP con sus permisos (`GET /plantilla/api/conductor/:id/foto`) y queda en la auditoría quién la subió. No es obligatoria para nadie ni entra en lo que se exige para contratar.

Tres detalles que se decidieron a propósito:

- **Se reduce en el navegador antes de subirla**: la foto de un móvil pesa 4-5 MB y aquí se ve en 96 px. Con el lado largo a 640 px y en JPEG queda en ~100 KB. El servidor pone un tope de 3 MB para quien llame a la API sin pasar por la pantalla.
- **La ficha trae el id del documento, no la imagen**, y la pantalla la pide con `?v=<id>`: el navegador la guarda un día y solo la vuelve a bajar cuando alguien sube otra, que es otra URL.
- **Es dato personal**: la ve quien ve la ficha, y la cambia quien puede cambiar sus datos. Tráfico no ve el botón, y si llamara a la API a pelo, el servicio se lo niega.

**También en Selección y en la ETT** (24/09/2026), en la cabecera de la ficha de la candidatura, y es **la misma foto**: es de la persona, no de la candidatura, igual que el DNI. Se sube en cualquiera de las tres pantallas y se ve en las otras dos. En Selección **es opcional**: no sale en «Falta por completar» ni en la lista de papeles que se piden, y no frena ningún alta.

Para eso la lógica se movió a **Documentos** (`fotoDe`, `foto`, `subirFoto` en `documentos.service`), que es donde se guarda: las reglas —qué archivo, cuánto pesa, quién la cambia— se escriben una vez. Y el cuadro, la silueta y la subida son el componente compartido `FotoPersona` (`public/assets/js/fotoPersona.js`), cargado en todas las pantallas desde `layout-gestion`.

El botón de la cámara va **siempre visible** en la esquina, no al pasar el ratón: en un móvil no hay ratón. El hueco en la cabecera es una opción nueva del [[Componentes de la casa|Listado]], `detalle.avatar(d, hueco)`, que funciona como `pinta` en los bloques.

## Lo que se borró, y el fallo que apareció al ir a borrarlo

`/fichas`, `/libranzas` y `/agenda` **se borraron** el 15/09/2026. La agenda de tráfico era un segundo sitio para mirar lo que ya está aquí —turno, libranzas, coche, teléfono— y encima era la única pantalla que **escribía** en la hoja `AGENDA_V2`. `/fichas` era un expediente montado sobre un Excel para tapar la falta de información: dos sitios para lo mismo, y el de menos datos era el que tenía los papeles en una hoja.

Pero no se fueron de balde. Al mirarlas apareció un fallo que llevaba **desde que la agenda pasó a PostgreSQL**:

> `repo/agenda` escribía `'SI'` en las columnas de casilla —ACTIVO y los siete días de libranza— y el motor las lee con `esCheck`, que solo acepta `true`, `'TRUE'` o `'VERDADERO'`. En la hoja esas columnas eran **checkboxes** y Google devolvía booleanos; al reconstruirlas desde la base se escribió texto.
>
> **Resultado: los 214 conductores salían del motor con `activo: false` y sin una sola libranza.** En silencio, sin que nada fallara.

`activo` resultó no usarlo nadie. `libra` sí: de él cuelgan `services/control`, `services/reportes` y `services/vistaFinal` —que alimenta el reporte de horas de Control—. Los tres creían que no libraba nadie. Arreglado devolviendo booleanos: de 0 a **171 conductores con libranza**, los mismos 171 que enseña esta pantalla. Ver [[Flota viva]].

## Lo que aún no está bien

`modules/Conductores/conductores.repo.js` son ~1.236 líneas con reglas dentro que son de servicio: qué campos puede tocar cada rol, qué pasa al dar de baja. Se movió el módulo primero porque mover y partir a la vez es cómo se pierde una ruta sin enterarse.

`services/repo/alta.js` sigue fuera del módulo: es el traspaso desde Selección y lo usan también `tickets`, `candidaturas.repo` y `ett.service`. Si entrara aquí, Selección estaría entrando al repositorio de otro módulo.
