---
tags:
  - telecab
  - como-se-trabaja
  - trampas
  - depuracion
  - lecciones
aliases: [Fechas sin toISOString]
---

# Trampas conocidas

Lo que ya costó tiempo, con su cifra y su remedio. Todas están sacadas de los
comentarios del propio código: si una de estas te muerde otra vez, el fichero ya
lo avisaba.

El denominador común de casi todas: **fallan en silencio**. Compilan, arrancan,
no lanzan, la pantalla se ve perfecta — y el número está mal. Por eso se escriben.

Ver [[Reglas de la casa]], [[Comprobadores]] y [[Glosario]].

---

## Fechas, husos y la jornada

### `toISOString()` sobre un DATE devuelve el día ANTERIOR en Madrid

`services/repo/vigencia.js`, `modules/Conductores/fantasma.repo.js`,
`modules/Ticketera/ticketera.repo.js`

El driver devuelve una columna `date` como un `Date` a **medianoche local**, y
pasarlo a UTC desde Madrid lo tira al día de antes. Salió un mensaje que decía
*"pisa el tramo del 12"* cuando el tramo empezaba el 13.

**Remedio:** la fecha se formatea en SQL con `to_char(col,'YYYY-MM-DD')`, o en JS
con `getFullYear/getMonth/getDate`. Nunca `toISOString`.

**Y la trampa hermana:** `String(fecha).slice(0,10)` devuelve `"Fri Sep 11"`. Se
cuela sin romper nada y después los rangos se comparan como texto y dejan de tener
sentido.

### `new Date('2026-07-09')` es medianoche UTC, o sea el 8 en Madrid

`modules/Nominas/nominas.excel.js`, `modules/Administracion/recaudacion.repo.js`

**Coste:** se coló entera en el Excel de la gestoría — **249 fechas de ingreso,
todas un día antes**.

**Remedio:** construir con `Date.UTC`, o a **mediodía UTC**, que es inmune a
cualquier cambio de huso. Segundo filo en recaudación: `dd/mm/aaaa` lo lee
`new Date()` a la inglesa, y el calendario de la casa escribe justo en ese
formato — un recibo del día 10 entraba con fecha de octubre y **caía en otra
quincena**. Ahí hay parser propio por formato.

### Restar 24 horas se salta una jornada el día del cambio de hora

`services/visibilidad.js`, `modules/Control/control.service.js`,
`modules/Operaciones/auditoria.service.js`, `modules/Planificacion/eventos.repo.js`

El día del cambio tiene 23 o 25 horas. **Síntoma:** el día después de adelantar el
reloj, entre las 00:00 y la 01:00 "ayer" salía **anteayer**, y arrastraba la
tarjeta de Ayer, el lunes de la semana, el gráfico y qué días refresca el cron.
En auditoría, con el salto fijo se contaba una hora dos veces en marzo y se perdía
en octubre.

**Remedio:** caminar el calendario desde el **mediodía UTC**, y calcular el fin del
día como el **inicio del día siguiente**, no sumando 86.400.

### Octubre tiene 31 días y UNA HORA

`services/bolt.js`

Del 1 a las 00:00 al 31 a las 23:59 hay 31 días y una hora, porque esa madrugada
se atrasan los relojes — y eso **supera el límite de rango de la API de BOLT**.

**Remedio:** `fetchRangoCompleto` parte el rango y **fusiona antes de procesar**,
para que un turno que cruce el corte se siga midiendo entero.

### `getHours()` en un servidor UTC desplaza la franja nocturna

`modules/Nominas/nominas.repo.js`

El servidor corre en UTC: allí las 23:30 de Madrid son las 21:30, y la franja
nocturna se desplazaría **una hora en invierno y dos en verano**.

**Remedio:** `PARTES_MADRID` con `Intl.DateTimeFormat` y `timeZone: 'Europe/Madrid'`.

### La jornada operativa: cinco horas ciegas cada noche

`modules/Control/cockpit.service.js`

Cuando el cockpit usaba fecha de calendario, entre las 00:00 y las 05:00 enseñaba
el plan del día siguiente: **la noche en curso no salía en ninguna pestaña** —NN
vacío, 0 personas— mientras las llamadas y las J se grababan en la jornada
anterior. Consecuencia real: **dos operadores llamando al mismo conductor**.

**Remedio:** la jornada la dice `repo/llamadas.diaOperativoHoy()`, y es la única.
Ver [[Jornada y turnos]].

### Sellar a las 05:30, no a las 03:25

`app.js`

La jornada va de 05:00 a 05:00, así que a las 03:25 el turno de noche **todavía
está rodando**: sellar ahí guardaba la foto a medias.

### La nómina va por día natural, y NO es un fallo

`modules/Nominas/nominas.repo.js` (`HORA_CORTE = 0`)

Cuando las horas se cortaban a las 05:00 y el dinero a medianoche, las dos mitades
no cuadraban en el borde del mes: **2.825,85 € en 914 pedidos** de la madrugada del
1 de septiembre quedaban fuera de agosto mientras sus horas quedaban dentro, y **a
dos personas les cambiaba si superaban el umbral del MBO FAS**.

**Consecuencia que hay que saber:** las horas de la nómina no coinciden con las de
la bitácora para quien trabaja de noche. Es deliberado.

### `desde <= NULL` en SQL no es falso: es DESCONOCIDO

`services/repo/vigencia.js`

**Síntoma:** no casa **ninguna** fila. Y decirlo en JavaScript no basta, porque el
`null` llega igual a la consulta.

**Remedio:** todas las comparaciones van en `COALESCE(…, CURRENT_DATE)`.

### Los días de la semana empiezan en lunes, y `getDay()` no

`services/nucleo.js`

Había **seis copias** del array de días repartidas por el código. Y miércoles es
**X**, no M.

---

## [[Mapon]]: lo que devuelve no es lo que parece

### `mileage` NO es el odómetro del coche

`services/mapon.js`, `modules/Vehiculos/vehiculos.repo.js`, `docs/API_MAPON.md`

Son los km **desde que se instaló el dispositivo**. Se estuvo guardando ese, y
`/vehiculos` enseñaba **30.723 km en un coche que lleva 629.100** (5886LBZ,
contrastado contra el taller el 09/09/2026). De 27 coches con los dos datos, **25
daban un imposible**.

**Remedio:** el odómetro bueno es `include[]=can` → **`can.odom`**, la lectura del
CAN, o sea el número del cuadro: **26 de 26 cuadran**. Lo dan 90 de 144 unidades;
los demás se quedan **sin dato en vez de con uno falso**, y necesitan un *ancla*
manual. Ver [[Km por odometro CAN]].

### El `state` de Mapon es un OBJETO, no una cadena

`services/mapon.js`

Es `{name, start, duration, debug_info}`, y hay además un `movement_state` aparte.
Tratarlo como texto daba **`[object Object]` en las 144 unidades**.

### La ignición viene como `{gmt, value:'on'|'off'}`

`services/mapon.js` (`contactoPuesto`)

`!!Number(u.ignition)` sobre ese objeto da `NaN`, y `NaN` es `false`: **el sistema
se pasó semanas creyendo que ningún coche tenía nunca el contacto puesto**. Y eso
no era cosmético — era lo que debía frenar el corte de motor.

**Remedio:** `contactoPuesto()` acepta objeto, booleano, número o texto
(`on`/`off`/`ign_on`…) y devuelve **`null` cuando no lo sabe**. *"No lo sé" nunca
puede leerse como "no".*

### `include` con varios valores va como ARRAY

`services/mapon.js`

`include[]=relays&include[]=ignition`. Separados por comas, **Mapon los ignora en
silencio** y devuelve la unidad sin esos bloques: parece "no tiene relés" cuando lo
que pasa es que no se pidieron bien.

**Remedio:** el helper `incluir(...)`.

### `status: ok` del relé confirma que la orden salió, no que el relé cambiara

`services/mapon.js`

**Remedio:** toda operación de relé **relee** `unit/list` con `include=relays`
(`cambiarReleConfirmado`, 5 reintentos cada 2 s).

Relacionado, y probado en flota el 18/08/2026: `unit_commands/execute` respondió
`{"status":"ok"}` a un `open_windows` y **las ventanillas no se abrieron**, en dos
marcas distintas. Ese `ok` es un acuse de recibo de Mapon, no una confirmación del
vehículo.

### El error 1006 no distingue "sin permiso" de "esa ruta no existe"

`services/mapon.js`, `docs/API_MAPON.md`

Comprobado el 16/09/2026: `unit/change_relay_list.json`, que es **inventada**,
devuelve el mismo 1006. Un 1006 nunca prueba por sí solo que un método exista.

**Remedio:** `probarRele` pide una ruta inventada **como control** para poder
distinguir los dos casos.

### `route/list` devuelve el trayecto entero aunque solo roce la ventana

`services/mapon.js`

**Caso 0348MMZ:** "60,7 km en descanso" que eran de toda la mañana; lo real tras
las 11:41 eran unos 2 km.

**Remedio:** `kmEnVentanaExacto` recorta con haversine sobre `decoded_route`.

### `unit_id[]=a&unit_id[]=b` devuelve solo la PRIMERA

`services/flotaViva/fuentes.js`

Hay que pedir las unidades de una en una. Y `include[]=total_distance` baja la
respuesta de **240 KB a 27 KB**. Una serie vacía **no es un error**: es un coche
sin CAN.

### El tipo de alerta más frecuente no estaba en el catálogo

`services/mapon.js`

**102 de 193 alertas de una semana** salían en pantalla con su código crudo,
`not_in_obj`.

### Límites duros que hay que respetar

`docs/API_MAPON.md`

Ventana máxima de **31 días**, 150 resultados por página, y **5 peticiones
concurrentes** por cuenta (error 1011). El poller ya consume: cualquier barrido de
flota va con cola de concurrencia ≤ 4.

---

## [[BOLT]]: errores que llegan como éxito

### `fetchAllPaginated` devuelve datos PARCIALES en silencio

`services/bolt.js`, `modules/Operaciones/auditoria.service.js`

Si una página falla, deja lo que llevaba y sigue. **Media lectura de logs convierte
a un infractor en "espera" y el día quedaría congelado como limpio.**

**Remedio:** ante datos incompletos, la auditoría **aborta el día entero**. Y el
adaptador grita: compara con `total_rows` y escribe `INCOMPLETO` en el log si leyó
menos.

### BOLT responde HTTP 200 con el error DENTRO del cuerpo

`services/bolt.js`

Si no se mira, **un error se confunde con "no hay datos" y el mes se escribe vacío
sin avisar**. Los 498xxx son de negocio (no se reintentan); 998 y 999 son
transitorios (sí).

### `CLIENT_TIMEOUT` llega como HTTP 200 con 0 registros

`services/bolt.js`

Si no se reintenta, **se pierde el tramo entero creyendo que no había datos**.

### El tope de páginas cortaba justo los primeros días del mes

`services/bolt.js`

La API devuelve los logs **del más reciente al más antiguo**, así que al cortar en
100 páginas se perdían los primeros días. Ahora `MAX_PAGINAS = 2000`.

### Resetear el contador de reintentos antes de tiempo = bucle infinito

`services/bolt.js`

`reintentosTimeout = 0` va **después** de confirmar que la página trajo datos, no
al ver un HTTP 200.

### El `fetch` de Node no trae tiempo límite

`services/bolt.js`, `services/mapon.js`

Si la API acepta la conexión y no contesta, la petición **se cuelga** y con ella lo
que la lanzó: un cron, una pantalla, el botón que alguien acaba de pulsar. *"En
Mapon esto ya se arregló, precisamente porque pasó; aquí seguía sin arreglar."*

**Remedio:** `AbortController` — 20 s en Mapon, 120 s en BOLT (generoso a
propósito: un barrido de 15 días tarda minuto y medio de forma legítima).

### `has_cash_payment: false` no es lo mismo que "no vino el dato"

`services/bolt.js`, `modules/Conductores/cazamiento.repo.js`

Convertirlo a booleano perdería la diferencia. *"Decir 'no tiene efectivo' cuando
en realidad no lo sabemos sería peor que no decir nada."*

### `ON CONFLICT` falla si BOLT manda la misma cuenta dos veces

`modules/Conductores/cazamiento.repo.js`

Error literal: *"cannot affect row a second time"*.

**Remedio:** deduplicar por uuid en un `Map` antes de insertar.

---

## Kilómetros: la zona de guerra

### Los km NO son "odómetro final − odómetro inicial"

`services/flotaViva/motor.js`

Un equipo sin cobertura se pone al día de golpe y el salto entero cae en el tramo
abierto. **Sacó 18,9 km en un coche que llevaba tres minutos parado.**

**Remedio:** se mide cada trozo contra el **reloj del equipo** (`senal_at`), no el
nuestro; nada por encima de 50 m/s (180 km/h) se suma, y lo dudoso se marca
(`km_dudoso`).

### El total del intervalo caía entero en el último tramo

`services/flotaViva/motor.js`

Quien se ponía en descanso, hacía veinte kilómetros y volvía a espera entre dos
vueltas **aparecía con los veinte km en "descanso"**.

**Remedio:** reparto proporcional al tiempo; el último tramo se lleva el resto para
que cuadre al metro.

### Un tramo "desconectado" abierto absorbe días de km ajenos

`services/flotaViva/rutas.js` (`FIN_KM`)

**Caso:** un conductor se desconectó del 7550KYT el 15/09 a las 06:41, se fue a
otro coche, y el reporte le apuntó **256 km "fuera de servicio"** que eran 217 de
ese coche más sus 38 reales. Había **21 tramos abiertos de más de 12 h imputando
~2.500 km** a gente que no iba dentro.

**Y volvió dos veces más:** al cerrarse el tramo (58 h de duración) dejó de
cortarse y sus 219 km reaparecieron; y una guarda por rendimiento dejaba fuera al
conductor que aparece en dos coches a la vez. Medido: **512 tramos cerrados de más
de 12 h en treinta días, 11.327 horas**.

**Remedio:** el corte vale para tramos abiertos **y cerrados**. Ver
[[Corte de tramos]].

### Los km salen de `fv_ruta`, nunca de `fv_tramo.km_m`

`services/flotaViva/rutas.js`

El odómetro solo llega a ratos y sus metros caen en el tramo que estuviera abierto
cuando Mapon habló: **11 km imputados a un descanso de 12 minutos**. Y el `mileage`
de `unit/list` llega **estancado** entre vueltas, así que la resta da cero.

`fv_ruta` es la fuente que cuadró con el informe de BOLT **al 0,03 %**.

### El GPS miente en los coches donde falla; manda el CAN

`services/flotaViva/rutas.js`

Medido el 16/09/2026: el GPS va un 4 % por debajo del odómetro en el conjunto de la
flota (mediana coche a coche 0,4 %), pero **el 0454MMZ marcó 45 km de GPS contra
518 reales**.

**Remedio:** elección coche a coche y ventana a ventana; si el CAN queda por debajo
del 85 % del GPS es que calló, y se pasa a GPS **con aviso** ("KM POR GPS").

### El filtro de velocidad imposible se comía km buenos

`services/flotaViva/rutas.js`

Dos lecturas separadas veinte segundos con un kilómetro de diferencia son 180 km/h
en el papel y un coche normal en la calle. **Le quitaba 16 de 292 km a uno y 30 de
414 a otro.**

**Remedio:** `HOLGURA_CUENTA_KM = 2` km antes de juzgar la velocidad.

### Dos unidades de Mapon con la misma matrícula

`modules/Vehiculos/vehiculos.repo.js`

Pasa al cambiar el GPS sin dar de baja el viejo. **No se elige por nosotros:** el
odómetro dependería de cuál se leyera la última. Se informa y se deja sin enlazar,
y el descuadre se pinta en pantalla, *"porque es el descuadre que deja a un coche
sin kilómetros sin que nadie se entere"*.

---

## El nombre no identifica

### Cruzar por nombre: 752 h contra 825,3 h del mismo día

`modules/Control/reporteHoras.repo.js` — reescrito el 07/09/2026

El reporte del domingo 06/09 decía 752 h y Visibilidad 825,3 h. No era el cálculo:
las filas venían de las hojas y las horas de PostgreSQL, y se cruzaban **por el
nombre**. Quien se escribiera distinto entraba con 0 h; quien no estuviera en
ninguna hoja no entraba.

**Remedio:** lista y horas del mismo sitio, cruzadas por `conductor_uuid`. Lo mismo
en el reporte 5-5, donde *"una persona con dos cuentas con nombres distintos salía
dos veces, o ninguna"*.

### Homónimos: hay tres en el padrón real

`modules/Conductores/cazamiento.repo.js`

Una cuenta enlazada con la persona equivocada **le imputa las horas a otro**. El
cazamiento automático solo casa por **teléfono 1:1**; quién es quién lo confirma
una persona.

**La única excepción razonada** es la matrícula: *"es un identificador legal y único
del vehículo, no una forma de escribir algo"*.

### Caracteres invisibles pegados al copiar de un PDF

`services/nucleo.js`

Espacios de ancho cero, marcas de dirección de texto, guiones suaves: **dos nombres
idénticos en pantalla que no lo son**.

**Remedio:** `normClave()` los quita, y además **ordena las palabras**, para que
"GARCIA LOPEZ, Juan" y "Juan García López" den la misma clave.

### El ID_BOLT se le pide a `v_agenda`, no se recalcula

`modules/Planificacion/LEEME.md`

Es la clave con la que el motor cruza las dos mitades del cuadrante **y es un
nombre, no un uuid**: armarlo con otra expresión, *aunque fuera "la misma" escrita
dos veces*, bastaría para que un conductor apareciera en la agenda y no en su coche.

### Las cabeceras de la hoja no corresponden con el contenido

`scripts/cargar-conductores.js`

La columna rotulada "Telefono" trae la fecha de ingreso, y la rotulada
"Fecha Ingreso" trae un estado.

---

## Lo sellado no se recalcula solo

### Enlazar una cuenta de BOLT no mueve ni una hora

`modules/Conductores/plantilla.service.js`

Una jornada ya sellada no se vuelve a calcular sola. **Pasó de verdad:** a una
persona se le enlazó su cuenta el 10/09 y sus casi **cinco horas del día 2** —
sellado el día 8 — no llegaron nunca a su ficha: ni a la bitácora, ni a la
asistencia, ni al promedio, ni a la nómina. **Se descubrió comparando el cálculo
con lo sellado, no porque nadie lo notara.**

**Remedio:** `rehacerDiasDeLaCuenta()` re-sella el rango afectado. En cuentas
fantasma, ese re-sellado *"es la mitad del trabajo"*.

### Al recortar un enlace fantasma hay que rehacer los días que PIERDE

`modules/Conductores/fantasma.service.js`

Si a un enlace del 1 al 10 se le recorta el `hasta` al día 4, los días 5–10 cambian
de dueño **aunque ya no pertenezcan al enlace**.

### La nómina no puede fiarse de la bitácora

`modules/Nominas/LEEME.md`

La bitácora sella y no recalcula; a quien se le enlace la cuenta más tarde no
aparece allí. *"La nómina no puede permitirse eso — dejaría a alguien sin cobrar
137 horas."*

**Cuidado al leer el panel:** la lista de "quien la bitácora no tiene" **no** es la
lista de "a quién le bailan las horas entre pantallas". A los de noche les bailan
siempre, a propósito.

### Un día sin nadie trabajando también se sella

`modules/Operaciones/bitacora.repo.js`

Sin la marca en `bitacora_sello`, se recalculaba para siempre: **junio entero, en
cada carga de la pantalla**.

---

## Concurrencia: el `if` no basta

### "Un mensaje por alerta" lo garantiza un índice único, no la aplicación

`modules/Control/alertas.repo.js` (índice de `db/97`)

Aunque dos revisiones se crucen —dos crons, o el botón "Revisar ahora" pulsado
mientras corre el cron—, la base solo deja entrar la primera, y **solo se manda
WhatsApp por la fila que de verdad se insertó**.

### Dos jornadas de fichaje abiertas

`modules/Fichaje/LEEME.md`

Dos pulsaciones seguidas en un móvil con mala cobertura llegan como dos peticiones,
**y el `if` las deja pasar a las dos**.

**Remedio:** índice único parcial `uq_fichaje_abierto`.

### Dos pestañas, dos dueños para el mismo día

`modules/Conductores/fantasma.repo.js`

El no-solape de cuentas fantasma lo hace un `EXCLUDE` de la base: si se comprobara
antes de insertar, **las horas se contarían dos veces**.

### Dos conductores, un mismo bono de lavado

`services/codigosBallenoil.js`

Entre leer el código libre y marcarlo como usado pasa medio segundo: **los dos se
llevaban el mismo bono y el segundo se lo encontraba gastado en el surtidor**.

**Remedio:** una sola sentencia con `FOR UPDATE SKIP LOCKED`.

### Un solo envío masivo: 409, no cola

`modules/Planificacion/cobertura.service.js`

Dos a la vez se pisarían el contador y, peor, **duplicarían mensajes**.

---

## Express, red y plataforma

### `trust proxy` tiene que ser 2, y nunca `true`

`app.js`

Se puso 1 y se comprobó contra la realidad: una acción hecha desde la oficina (IP
pública `80.103.26.249`) quedó apuntada como `188.114.111.197`, **que es el proxy
de delante**. Con 1 se guardaba esa IP —la misma para todo el mundo—, y eso
*"convertía el libro de cuentas fantasma en un campo inútil y el freno del login en
un contador compartido por la empresa entera"*.

**No es `true`:** eso se fía de la cadena entera, que es lo mismo que no fiarse de
nada, porque el cliente puede escribir por delante lo que quiera. Con un número,
Express cuenta **desde la derecha**, donde solo escriben los proxies.

**Remedio para el futuro:** `/mi-red` expone la cadena `X-Forwarded-For` y el valor
real de `saltosDeConfianza`, para reajustarlo sin adivinar.

### El `express.json` global de 2 MB capaba las subidas en silencio

`app.js`

Si el parser global corre antes, **rechaza la petición por tamaño y el límite mayor
de dentro del router no llega a aplicarse nunca**.

**Remedio:** la lista `SUBEN_ARCHIVOS` se salta el parser global.

### Un `require` construido con plantilla se rompe en silencio

`modules/Vehiculos/taller.service.js`

Era `` require(`../services/taller${formato}`) ``. Esa dependencia **no la ve
nadie**: ni un `grep`, ni `comprobar-modulos.js`, ni quien lea el fichero —
`tallerPdf` y `tallerExcel` parecían código muerto—. Y no da la cara hasta que
alguien pulsa "descargar informe", algo que se usa una vez por semana.

**Remedio:** los dos formatos declarados a mano.

### `/api/:ambito/:id` se come a `/api/archivo/:id`

`modules/Documentos/documentos.controller.js`

Los dos son tres segmentos y **gana el declarado antes**. *"Es de las cosas que se
rompen al reordenar un fichero sin darse cuenta."*

**Remedio:** prefijos obligatorios `de/` y `doc/`.

### La cuota de Google Sheets tumbó el ERP entero

`services/sheets.js`, `modules/Operaciones/LEEME.md`

60 peticiones por minuto, **y el login también lee de Sheets**: un backfill largo
puede dejar sin servicio a toda la aplicación.

**Remedio:** `conReintento` con espera 1,5/3/6 s, `MODO_PRUEBAS=1` que bloquea toda
escritura, y una parada de emergencia que se acepta **por GET a propósito**, para
poder cortarla desde la barra del navegador sin reiniciar nada.

### Borrar filas de una hoja, de abajo arriba

`services/sheets.js`

Si no, el borrado desplaza a las siguientes **y se acaba eliminando la equivocada**.

### La geolocalización del navegador solo funciona sobre HTTPS

`modules/Fichaje/LEEME.md`

Si algún día se sirviera por HTTP plano, **todas las ubicaciones llegarían como
`error` sin que nadie tocara nada**. Y la ubicación nunca bloquea el fichaje
(RD 8/2019): se guarda marcada `denegada`/`error`.

### Una sesión de 30 días sin corte hace que bloquear a alguien no haga nada

`services/sesion.js`, `modules/Usuarios/LEEME.md`

La cookie es HMAC y el servidor no la consulta contra la base: **su firma seguiría
siendo válida durante un mes**.

**Remedio:** la columna `usuario.sesiones_desde` (db/105) — *"una columna en vez de
un almacén de sesiones"*. Solo se comprueban las sesiones largas, el corte se cachea
30 s, y **si la base no contesta no se echa a nadie**: un fallo de red dejaría la
aplicación entera sin acceso.

### Esconder un botón no es una autorización

`modules/Administracion/LEEME.md`, `services/permisos.js`

El permiso de apuntar un descuento de nómina se comprueba **al apuntar**, no solo
al pintar la pantalla: quien conozca la URL la llama igual. Y **si la consulta de
permisos falla, la respuesta es NO**.

Relacionado: las acciones de cuenta fantasma cuelgan de un **prefijo limpio** a
propósito. Si colgaran de `/plantilla/api/conductor/…` caerían bajo `/plantilla` por
prefijo, y **cualquiera que abra la plantilla podría mover horas y dinero de una
persona a otra**.

### Meta #132001 no significa "la plantilla no existe"

`services/whatsapp.js`

La plantilla sí existe y está aprobada, **pero no en el idioma que se le pide**: al
crearla se elige "Español" (`es`) o "Español (España)" (`es_ES`) y no son
intercambiables.

**Remedio:** se tantean `es, es_ES, es_MX, es_AR` y se memoriza el que funcionó,
pero **solo se reintenta si el error es de idioma**.

---

## [[Base de datos]] y [[Migraciones]]

### El orden de las migraciones es por NÚMERO, no por nombre

`services/migraciones.js`

Con `.sort()` a secas se ordena como texto, y **el texto dice que "100" va antes que
"99"**. Al llegar a la 100, el corredor habría empezado a aplicar las nuevas antes
que las viejas y una migración dependiente habría reventado en producción sin motivo
aparente.

### La huella de la migración no puede depender del sistema operativo

`services/migraciones.js`

Con `core.autocrlf=true`, el mismo fichero tiene CRLF en Windows y LF en Render:
hashear el texto crudo **marcaba todas las migraciones como modificadas**.

**Remedio:** se normalizan saltos de línea y espacio final antes de calcular el
SHA-256.

### `CREATE OR REPLACE VIEW` solo deja añadir columnas AL FINAL

`scripts/comprobar-sql.js`

Cambiar el orden, quitar una o renombrarla lo rechaza PostgreSQL con *"cannot change
name of view column"*. **Eso no se ve leyendo el fichero nuevo:** hay que acordarse
de cómo era la vista dos migraciones atrás, y nadie se acuerda.

**Remedio:** `DROP VIEW IF EXISTS` delante, y la vista se rehace entera.

### El DELETE de vigencias borraba tramos futuros ya planificados

`services/repo/vigencia.js`

A quien tenía 13 días en septiembre y 3 en noviembre, **dar de alta el de septiembre
le borraba el de noviembre**. Y antes solo se recortaban las vigencias abiertas, así
que a quien volvía antes de tiempo **sus vacaciones seguían cubriendo esos días**.

### Escribir en una columna GENERADA es un error de PostgreSQL

`scripts/comprobar-sql.js`

Y **se descubre cuando alguien intenta guardar**. Por eso el comprobador contrasta
los campos editables de la ficha contra las `GENERATED ALWAYS AS` del `.sql`.

### El pool de 10 conexiones no es un detalle menor

`services/db.js`

Render Postgres no trae PgBouncer, y agotar conexiones es *"la causa número uno de
caídas de base de datos en aplicaciones pequeñas"*.

### Un CTE mal colocado: 15 segundos contra medio

`modules/Control/alertas.repo.js`

Metido en el `ON` del cruce, PostgreSQL resuelve el corte **una vez por cada pareja**
de tramo y trayecto.

**Remedio:** `MATERIALIZED` en su propia CTE.

### Derivar un día del convenio tardaba CUATRO MINUTOS, y corre cada noche

`modules/RRHH/LEEME.md`

`enArea` se preguntaba **una vez por tramo de espera** (~1.700 al día) contra una
base en Frankfurt, y `guardarAsientos` insertaba de uno en uno.

**Remedio:** `enAreaVarios` (37× más rápido) y `unnest` con el mismo `ON CONFLICT`.
**Resultado: de 4 minutos a 17 segundos.**

### La lista de valores va pegada a la lista de columnas a propósito

`modules/Nominas/nominas.repo.js`

Si se añade una columna arriba y no abajo, el INSERT **falla en voz alta** en vez de
guardar los números corridos una posición.

### Dos pools sobre una sola base

`modules/Control/LEEME.md`

`FLOTA_VIVA_DB_URL` nació apuntando a otra base; hoy seis repositorios leen `fv_*`
por el pool principal contra la misma. *"Conviene colapsarlos antes de que alguien
dé por hecho que son bases distintas."* Consecuencia viva: el cockpit **no hace
JOIN en SQL** entre cuadrante y flota viva, los cruza en JS por matrícula
normalizada.

---

## Corte de motor: lo único irreversible del ERP

### NUNCA cortar con el contacto puesto

`services/fichaje.js`, `docs/API_MAPON.md`

Comprobado en el Corolla el **16/09/2026**: si el relé entra con el coche encendido,
**arranca, anda… y ya no se deja apagar**, porque el corte está metido en la línea
que el coche necesita para completar el apagado. El conductor se queda con un coche
encendido que no responde al botón: es peor que no bloquearlo.

Fallaba por **dos motivos a la vez**: `porOrden` se saltaba la comprobación **y** la
ignición se leía siempre como `false` (ver la trampa de `{gmt,value}`).

**Regla:** el contacto puesto para a todo el mundo, también a quien lo pide.

### Negarse a SOLTAR el motor crea un bucle sin salida

`services/fichaje.js`

El **16/09/2026** el 5646MDM se quedó parado con el corte puesto y, como Mapon lo
daba por "Conduciendo" a 0 km/h, **no había forma de soltarlo**: hubo que mandar la
orden a mano saltándose la comprobación.

**Regla:** *"Soltar no deja tirado a nadie nunca; negarse a soltar, sí."* Solo
**bloquear** pasa por la comprobación de marcha.

### El interruptor de seguridad apaga el BLOQUEO, no el desbloqueo

`services/fichaje.js`

Apagar la función entera **dejaría encerrados para siempre a los coches ya
cortados**, y el interruptor de seguridad sería justo lo que impide arreglarlo.

### "Velocidad 0" no prueba que nadie use el coche

`services/fichaje.js`, `services/mapon.js`

Un taxi recogiendo a alguien va a 0 km/h. Se exige tiempo parado **+** sin contacto
**+** señal fresca, y `null` ("no lo sé") significa **no actuar**.

### Un coche bloqueado que se mueve es un corte que no corta

`services/fichaje.js`

Es un fallo de instalación, y **aquí solo se nombra**: en silencio parecería que la
flota está cerrada.

---

## Los comprobadores también mintieron

### Cuatro de siete no miraban en `modules/`

`scripts/comprobar-ingesta.js`, `inventario-muerto.js`, `comprobar-modulos.js`,
`comprobar-vistas.js`

La Fase 2 mueve código a una carpeta que ninguno conocía, así que **cada módulo
mudado salía del alcance de las reglas sin que nadie lo decidiera**. Y una
herramienta que deja de mirar **no avisa de que ha dejado de mirar**: sigue diciendo
"todo bien" con menos ficheros dentro.

Al arreglarlo: dos ficheros llamando a BOLT/Mapon sin permiso, tres ficheros vivos
dados por huérfanos, y una cuenta que había bajado **de 259 llamadas comprobadas a
117**.

### Una coma dentro de un comentario se comía el nombre siguiente

`scripts/comprobar-modulos.js`

Partía la lista de exportaciones por comas **antes** de quitar los comentarios. Por
eso `visibilidad` parecía no exportar `ventanaTurnos`, que exporta desde siempre.

### `\b` delante del alias: entre un punto y una letra también hay frontera

`scripts/comprobar-modulos.js`

`f.alta.split(…)` casaba con el alias `alta` y acusaba a `repo/alta` de no exportar
`split`.

### Una URL escrita dentro de un comentario de una vista

`scripts/comprobar-rutas.js`

Una vista explica en un `//` de qué permiso depende un botón, y el comprobador la
leía como una petición. Igual que `/informe.xlsx` (se cortaba en el punto), la barra
final de `'/api/ficha/' + id` (que significa "aquí viene un parámetro") y
`permisos.includes('/alertas/config')` (que es una clave, no una URL).

**Y al arreglarlo apareció un segundo fallo:** la ruta `/` era principio de todo y
daba por buena cualquier URL, incluido un `/api/anularrr/` mal escrito a propósito.

### Los identificadores se escriben `[a-z_][a-z0-9_]*`, nunca `[a-z_]+`

`scripts/comprobar-sql.js`

El segundo se para en el primer dígito: `externo_sufijo9` se leía como
`externo_sufijo`. **El fallo no se ve**: la columna simplemente no existe para el
comprobador, y entonces una referencia correcta sale marcada como error y una
escritura prohibida pasa sin avisar.

### Regla general

Después de arreglar un comprobador, se **sabotea a propósito** para verificar que
caza lo que dice cazar. Y si un comprobador te acusa de algo que sabes que está
bien: **lee su cabecera antes de tocar el código**.

---

## Lo que compila, arranca y no lanza

### Un posicional donde la función desestructura

`modules/Planificacion/LEEME.md`

El controlador pasaba `req.query.dia` como posicional a una función que
desestructura `{ dia }`: **el tablero ignoraba la fecha y pintaba siempre la semana
de hoy**. Compila, no lanza, y la pantalla se ve perfecta.

**Lo cazó una comprobación en vivo** que pide dos semanas distintas y exige que las
respuestas difieran — que es el tipo de prueba que hay que escribir cuando no hay
tipos.

### Un parche anclado en una forma que se repite

`docs/ARQUITECTURA.md`

Al reescribir `services/ingesta.js` se buscó por un `async ejecutar() {` suelto y se
cogió el bloque equivocado: **se comió la tarea `alertas_mapon` entera** y el cuerpo
de `zonas_mapon`. Compilaba y arrancaba.

**Regla:** *un parche se ancla en el nombre de lo que cambia, no en una forma que se
repite.*

### `'SI'` en vez de booleano: 214 conductores sin una sola libranza

`modules/Conductores/LEEME.md`

`repo/agenda` escribía `'SI'` en ACTIVO y en los siete días de libranza; el motor
las lee con `esCheck`, que solo acepta `true`/`'TRUE'`/`'VERDADERO'`. En la hoja
eran **casillas** y Google devolvía booleanos; al reconstruirlas desde la base se
escribió texto.

**Resultado: los 214 conductores salían con `activo: false` y sin una sola
libranza, en silencio, sin que nada fallara.** Lo consumían tres servicios. Llevaba
roto desde que la agenda pasó a PostgreSQL y apareció por casualidad, al ir a borrar
`/libranzas`. Tras el arreglo: **de 0 a 171 conductores con libranza**.

### El Hito 2 llevaba meses escrito y no lo llamaba nadie

`modules/RRHH/convenio.motor.js`

`jornada.repo` no aparecía en un solo `require` del proyecto: **cero contratos, cero
objetivos, cero asientos**. Las cuatro pantallas de `/convenio` salían vacías y
parecían rotas.

### Un repositorio que se muda arrastra a sus hermanos

`docs/ARQUITECTURA.md`

`candidaturas.repo` requería por ruta relativa a otros siete repos. Eso **no lo dice
el comprobador de capas**: lo dice `node -e "require(…)"`, que es el primer comando
después de un `git mv`.

### Una fila mala tumbaba TODA la pasada, pasada tras pasada

`modules/Ticketera/ticketera.service.js`

Una respuesta con la prioridad larga —"Incidencia grave (requiere…)"— no cabía en su
columna, la excepción subía, **y con ella se quedaban fuera todas las respuestas
posteriores. No una: todas.**

### El bot de fichaje robaba mensajes al bot de puertas

`services/fichajeBot.js`

Devolvía `true` a todo: **apuntar a alguien a las pruebas del fichaje le quitaba las
puertas sin que nadie lo hubiera decidido**.

---

## Números de negocio que engañan

### Una ausencia sin fecha de vuelta no termina NUNCA

`modules/Conductores/conductores.repo.js`

Se guardaba `hasta` en NULL y cobertura, planificador y bitácora lo leen como "está
fuera indefinidamente". **Pasó: unas vacaciones del 13/09 sin cerrar dejaron a esa
persona de vacaciones hasta fin de año.**

**Y la línea anterior tiraba la fecha escrita:** un parte de un solo día no tenía
forma de entrar. **La regla que queda:** `fin_previsible` decide si la fecha es
**obligatoria**, nunca si está **permitida**.

### La J vale el día entero, PERO topada

`modules/Nominas/nominas.service.js`

De las 182 J aprobadas de agosto de 2026, **114 traen un "8" puesto a ojo** y 13
traen las mismas horas que la persona ya había rodado ese día — sumarlas sería
contar dos veces el mismo rato. Por eso se ignora la columna de horas. *Sin el tope,
quien rodó 3 h un día justificado sumaría 11 h y cobraría extras por horas que no
hizo.*

Y las J **sí cuentan para el exceso**: 205,6 h rodadas + 2 días justificados = 221,6
contra un objetivo de 176 → **45,6 h de exceso, no 29,6**.

### La hora extra se paga por conducir, no por estar conectado

`modules/Nominas/LEEME.md`

El caso que lo destapó: **211,4 h en el mes y 35,4 de exceso, con un 52,7 % de
utilización — de sus 211 horas, 100 fueron espera.**

**Remedio:** utilización mínima del 65 %; se quitan horas **de espera, nunca de
viaje**. Verificado sobre agosto de 2026: 86 personas, **1.138,9 h retiradas**,
nadie pierde viaje y todos quedan exactamente en el mínimo. La columna
"% Utilización" sigue enseñando la **real**, porque esconderla dejaría la cifra
retirada sin explicación.

### La hora extra son 7 €, no 9

`modules/Nominas/LEEME.md`

El AppScript traía 9, pero sus fórmulas leían la celda de configuración, y la celda
real de mayo y junio tenía 7. Reproduciendo junio con 7 **cuadran las 164 nóminas al
céntimo**.

### Los dos MBO no se suman: se cobra el mayor

`modules/Nominas/LEEME.md`

Por eso "Compensación" va a cero en filas donde "MBO horas extra" tiene número: ese
mes ganó el FAS. Y el plus nocturno de la ETT es **€ por hora**, no un porcentaje:
no se parece en nada al de la nómina de casa y mezclarlos sería facturar mal.

### `f_objetivo_min` exigía a los de 32 h lo mismo que a los de 40

`modules/RRHH/LEEME.md`

Prorrateaba las 1.776 h del convenio **solo por días de alta**: un 25 % de más todos
los meses. Con `contrato` vacío no se notaba; apareció al generar objetivos de
verdad.

### La espera no cuenta como trabajo, y no es un fallo del código

`modules/RRHH/LEEME.md`

Art. 18.7: esperar conectado solo es trabajo efectivo **dentro del área**, y el área
se prueba con las zonas de Mapon — que hoy tienen **17 cruces de zona en dos semanas
sobre 2 zonas** para ~100 coches. Resultado: **138.481 minutos de espera caen a
`TE_NO` y cero a `TE_A1`**, o sea **2.308 horas en trece días**.

El cálculo es correcto; **falta configurar las zonas en Mapon**. La diferencia es
exactamente la columna `espera_fuera_area`.

### Apuntar un movimiento al revés descuadra la caja por el doble

`modules/Administracion/vistas/recaudacion.ejs`

`ingreso` entra en caja y baja la deuda; `cambio` sale de caja y la **sube**.
**Contar 600 € y apuntarlos al revés descuadra la caja por 1.200.**

### "Salió" con 0,0 h y 20,7 km — que no salió

`services/flotaViva/rutas.js`

El de noche que terminó a las 03:51 y dejó el coche rodando hasta las 07:50
**aparecía como "Salió" en el turno de día**. Un tramo desconectado sí suele llevar
conductor, *"por eso 'salió' no puede mirar km: mira minutos"*.

### El umbral de descanso en 45 minutos ocultaba el caso que importa

`services/flotaViva/franjas.js`

**Veinte minutos en descanso con dieciocho kilómetros hechos no llegaba a la lista
nunca.**

**Regla:** el tiempo y los kilómetros son **dos auditorías, no una**.

### La franja de noche cruza medianoche y se estiraba a las 23:59

`services/flotaViva/franjas.js`

Un coche que solo se conecta a las 22:00 contaba, pero **uno que empieza a la una de
la mañana no contaba nunca: su ausencia no se reclamaba jamás**.

### La alerta de rechazos llegaba con 60 minutos de retraso

`services/ingesta.js`

**Para cuando sonaba el aviso, el conductor ya había hecho el turno entero.**

**Remedio:** tarea nueva de 2 h cada 10 min (~2.000 órdenes en vez de ~50.000),
misma tabla e idempotente.

### `anulado_at IS NULL` mezclaba pendientes, aprobadas y rechazadas

`services/repo/llamadas.js`

Una J pendiente se contaba igual que una aprobada, **y una rechazada desaparecía sin
dejar rastro: el conductor se quedaba sin sus horas y nadie se enteraba**. Además la
alerta de rechazada no se apagaba nunca y el conductor arrastraba el aviso para
siempre.

### Una J machacaba en silencio la libranza manual de RRHH

`services/repo/justificantes.js`

Al anularla se borraba la fila entera **y la L manual desaparecía sin aviso**.

### Un "simulado" no es un aviso

`modules/Operaciones/velocidad.repo.js`

*"Los tuve juntos y estaba mal. Decirle 'te hemos avisado cinco veces' cuando no ha
recibido ni uno es la peor manera posible de empezar esa conversación."*

### Media hora de silencio en los logs y la atribución deja de ser un dato

`modules/Operaciones/sanciones.service.js`

Entre que uno deja el coche y el otro se conecta hay un hueco: con 45 minutos de
antigüedad, **el exceso puede ser del que acaba de recibirlo**. Si no se sabe con
confianza quién conducía, **no se avisa**.

### Empate de logs en el mismo segundo: gana el que NO acusa

`modules/Operaciones/auditoria.service.js`

Sin esa regla, el ganador lo decidía el orden de la respuesta de BOLT **y el
resultado no era ni reproducible**.

### Renombrar un motivo del Call Center deja huérfano lo que apuntaba a él

`modules/Control/callcenter.service.js`

*"Estos textos no son solo etiquetas. AÑADIR es libre; renombrar pide migración."*

Y antes de `db/131`, el Call Center **copiaba** las llamadas de Control y las
copiaba mal: todas entraban como "Asistencia → Conexión → No se ha conectado a su
puesto". *"Copiar da dos versiones de un hecho y la copia envejece; leer no puede
desincronizarse."*

### Reordenar la tabla de clasificación manda el ticket a otra bandeja

`modules/Ticketera/clasificar.js`

**El orden ES la regla:** gana la primera que encaja. "Baja por permiso retribuido"
contiene «baja» y «permiso», y cae en BAJA_AUSENCIA porque esa regla va antes.

### El vacío del formulario pisaba al nombre configurado de la ETT

`modules/Seleccion/ett.service.js`

El formulario manda el nombre **vacío** cuando no se escribe nada, y el último
recurso no puede ser el literal "ETT": **llenó la base de 99 periodos que decían
"ETT" a secas** y no se sabía con quién estaban contratados.

### Un hueco vacío no es un cero

`modules/RRHH/LEEME.md`

*"`null` deja la celda en blanco y un cero dice 'se calculó y salió cero'. En una
nómina esa diferencia se discute."* Y los minutos van en minutos, no en horas
decimales.

### Lo que no se hace es adivinar

`modules/Nominas/nominas.repo.js`

**63 de 239 nombres no se pueden separar** en nombre y apellidos: `PICO CABEZAS JOSE`
—¿dos apellidos y un nombre, o uno y dos?—, y `RAZVAN OCTAVIAN TIRNOVAN` va al revés.
*"Partirlo a ojo cambiaría el nombre legal de alguien en un papel que va a la
gestoría."*

### Una descarga del navegador no sabe enseñar un error

`modules/Seleccion/LEEME.md`

Si el servidor se niega, **el fichero simplemente no aparece**. Por eso se pregunta
antes por `/api/comprobar`.

### Un coche fuera de `fv_matricula` se ingiere pero no se ve

`services/flotaViva/motor.js`

**En agosto de 2026 se perdieron así 513 horas del 3035LTX.**

**Remedio:** la verdad es la tabla `vehiculo` del dominio; `fv_matricula` pasa a ser
solo un ajuste, y las que faltan se apuntan solas.

### Un estado desconocido de BOLT no se calla

`services/flotaViva/motor.js`

*"Es la única forma de enterarse de que BOLT ha cambiado su vocabulario, que es la
avería silenciosa de este tipo de módulos."*

### `/documentos/api/vencen` lista lo de TODO EL MUNDO

`modules/Documentos/LEEME.md`

El control de acceso mapea por **prefijo más largo**, y todo cae bajo `/documentos`.

---

## Dos simplificaciones deliberadas que hay que saber al leer los números

No son trampas: son decisiones, y están dichas para que nadie lea el número como lo
que no es.

- **La asistencia proyecta la libranza de hoy hacia atrás**
  (`modules/Control/asistencia.repo.js`). Si el cuadrante cambió mucho, el número se
  queda **corto** — *"que es el lado bueno por el que equivocarse en algo que se usa
  para llamar a la gente"*.
- **La auditoría de los lunes proyecta el plan de hoy a los cuatro lunes**
  (`modules/Control/auditoriaLunes.repo.js`), porque en PostgreSQL no hay
  planificación anterior al 3 de septiembre. Se dice en la cabecera del Excel *"para
  que nadie lo lea como una foto histórica"*.
