# Combustible (`/combustible`)

Los repostajes que llegan por correo. Cada repostaje con la tarjeta DNI & GO de
Ballenoil manda un correo a `datos@telecab.es`; el ERP lee ese buzón cada 10
minutos **en solo lectura**, guarda cada correo como una fila de `repostaje`
(db/212) y la enseña con su coche, su sede, la persona de la tarjeta y quién
llevaba el coche en BOLT a esa hora. PETROPRIX NO MANDA CORREOS: manda un Excel,
que se sube con «Importar Excel» (db/215); cada fila es un repostaje sin correo,
en la misma lista. Sin nombre: quién lo llevaba lo dicen BOLT y el BOT DE
WHATSAPP (el turno abierto con esa matrícula), también para los de Ballenoil. Y
cada repostaje se AUDITA CON MAPON (db/213), en solo lectura: a cuántos metros
de su gasolinera estaba el coche (GPS) y cuánto le FALTA a lo que subió el
aforador para llegar a lo pagado (boya; subir de más no cuenta), con el nivel
15 MINUTOS ANTES y 30 MINUTOS DESPUÉS de la hora del correo o del Excel (db/216).
La fila se pinta con el peor de los dos.

```
combustible.controller.js   /combustible: la pantalla y la API (lista, ficha, lecturas, importaciones, «Leer el buzón ahora», importar)
combustible.service.js      LA PUERTA: leer el buzón, importar el Excel, guardar, casar con el coche, la tarjeta, BOLT y el bot
combustible.repo.js         el SQL (repostaje, repostaje_lectura, repostaje_importacion, gasolinera…)
combustible.lector.js       puro: de quién es cada correo (por remitente) y leerlo con su lector
lector.comun.js             puro: el correo a texto, números con coma o punto, fechas, «Etiqueta: valor»
lector.ballenoil.js         puro: la estructura del correo de Ballenoil (DNI & GO)
lector.petroprix.js         puro: el CORREO de Petroprix, preparado (no mandan: mandan un Excel)
lector.petroprixExcel.js    puro: el EXCEL de Petroprix: la cabecera, las filas, la clave, el cambio de hora, los avisos
combustible.casar.js        puro: de quién es la tarjeta, si es quien llevaba el coche en BOLT, y si BOLT y el bot dicen la misma persona
combustible.auditoria.js    la auditoría con Mapon: cuándo, qué se le pregunta y qué se guarda
combustible.memoria.js      lo que ya se le preguntó a Mapon en una pasada (las ventanas de un coche, una vez)
combustible.gasolinera.js   puro: con qué gasolinera casa la estación (por palabras, o por el texto exacto del Excel), y la distancia
combustible.boya.js         puro: cuánto subió el aforador (la ventana fija T − 15 / T + 30, lo gastado entre medias, el techo y su corrección) y lo que FALTA
combustible.semaforo.js     puro: los umbrales de Camilo y el color de la fila (el peor de los dos)
vistas/combustible.ejs      el Listado (lista → ficha → atrás) con las fechas encima
```

Fuera de la carpeta:

- `services/correo.js` → `leerCorreos()`: abre un buzón por IMAP con EXAMINE
  (`readOnly: true`), INBOX y Spam en la misma conexión, baja los sobres y solo
  el cuerpo de lo que se elige; un correo que no se puede bajar vuelve con su
  `error` y no para a los demás. No sabe de repostajes.
- `services/dkim.js`: comprueba la firma DKIM del correo en crudo (DonDominio no
  deja su veredicto en la cabecera). Así se sabe si un correo «de Ballenoil» lo
  es de verdad (`remitente_verificado`).
- `services/mapon.js` → `nivelDeposito`, `nivelPorcentaje`, `gastadoYKm`,
  `paradasUnidad`, `posicionEn`, `capacidadDeposito`: lo que la auditoría le
  pregunta a Mapon, de UN coche y en ventanas de horas. Todo GET.
- `app.js`: la ruta y el cron (`4,14,24,34,44,54 * * * *`): el buzón y, detrás,
  la auditoría. Cada uno con su bandera, `COMBUSTIBLE_CORREO=off` y
  `COMBUSTIBLE_AUDITORIA=off`: con el correo apagado, el cron hace `repasar`
  (BOLT pendiente y el bot, que los del Excel también esperan) y audita igual.
  Con `MODO_PRUEBAS=1` no arranca.
- `services/permisos.js`: `/combustible` (mirar) y `/combustible/leer`
  (`escribir`: cualquier petición que no sea un GET la exige). La segunda abre
  «Leer el buzón ahora», «Auditar ahora» y corregir la gasolinera.
- `db/213`: las 143 gasolineras de Ballenoil del Excel de Camilo, los nombres
  puestos a mano (`gasolinera_alias`) y las columnas de la auditoría.
- `db/214`: las coordenadas de Clot, que el Excel no traía (de Camilo, con la
  precisión `validada`).
- `db/215`: las 30 gasolineras de Petroprix con su texto exacto del Excel como
  alias (`gasolinera_alias.tipo = 'texto'`), `repostaje_importacion`, de dónde
  viene cada repostaje (`origen`, `excel_clave`, `excel_crudo`), lo que trae el
  Excel (pago, «Vehículo»), quién llevaba el coche en el bot (`bot_*`) y la boya
  rehecha como lo que falta.
- `db/216`: la boya con la ventana fija. Devuelve a la cola lo auditado con la
  boya de antes (la versión 2 del detalle), marcado `soloBoya` (el GPS se queda
  y no se pregunta), con la boya vieja quitada de las columnas y guardada en
  `auditoria_detalle.boyaAntes`.
- `fichaje_turno` (db/125, `services/repo/fichajeTurno.js`): se lee en SQL para
  saber quién había abierto turno en el bot con esa matrícula. Solo se lee.
- `app.js`: `/combustible/api/importar` está en `SUBEN_ARCHIVOS` (el Excel viaja
  en base64 dentro del JSON, con su propio límite de 4 MB; si pasa, contesta
  con su mensaje en JSON).
- `scripts/comprobar-combustible.js`: las reglas, sin base, sin buzón y sin
  Mapon (con uno de mentira que grita si se le pide algo que no sea leer).
- `scripts/comprobar-combustible-excel.js`: el Excel de Petroprix (cabecera,
  fecha, coma, los 30 textos contra las claves de db/215, la clave, importar dos
  veces, los avisos, el cambio de hora), BOLT y el bot, la parada del Excel, la
  memoria y los grupos.
- `scripts/comprobar-ingesta.js`: la auditoría llama a Mapon por su cuenta, a
  conciencia y con el motivo apuntado en su lista.

## Lo que no se puede romper

- **El buzón no se toca.** Es el de Camilo en Thunderbird: nada se marca como
  leído, se mueve ni se borra. Lo garantiza `leerCorreos` (EXAMINE) y lo vigila
  el comprobador con un IMAP falso que grita si alguien llama a algo que marque.
- **La contraseña no se escribe en ningún sitio.** Es la de correo de la ficha
  de `datos@telecab.es` (Mi perfil), cifrada con `CRED_KEY`, y se descifra en
  memoria al entrar. Si falta algo, la pasada queda escrita con un error que dice
  qué arreglar y la pantalla lo pinta en rojo.
- **Una fila del Excel, un repostaje, y nunca dos.** Petroprix no da un
  identificador: la clave es la huella de la hora con segundos (tal cual la
  escribe el Excel), la matrícula, los litros y el importe (`excel_clave`, índice
  único). Importar dos veces el mismo Excel, o dos que se solapan, no duplica.
- **El Excel se reconoce por su cabecera exacta**; si no es, no se importa nada.
  Una fila que no se entiende se aparta con su porqué y no para a las demás. Ni
  una del futuro (con 10 minutos de margen): un día y un mes cambiados.
- **Lo que cabe en un Excel**: 4 MB, 20.000 filas con datos y 25 MB
  descomprimido (mirado en el directorio del zip ANTES de abrirlo). ExcelJS lo
  abre entero y sin soltar el hilo, en el proceso de todo el ERP.
- **La misma fila con la hora corrida (una hora, o unos segundos) ya estaba**,
  aunque su clave sea otra (`repo.casiIgualesDelExcel`): no entra y se avisa.
- **Petroprix se casa por el TEXTO EXACTO de la celda** (`textoExacto`), no por
  palabras: «Alcobendas» no es «Alcobendas 2». Si el texto no está, por su
  dirección; si no, por el nombre, y solo si es el mismo.
- **La hora del Excel es la del FINAL del repostaje**: la parada que acabó hasta
  5 minutos antes es la del repostaje, y la que empieza después no.
- **La boya mide con la ventana fija** (Camilo, 23/10/2026): el nivel a T − 15
  min y a T + 30 min, del lado bueno (la última lectura antes, la primera
  después, EN TODA LA SERIE que se pide: 72 h antes y 48 h después; la mediana
  de las de sus 10 minutos si son 3 o más, la más cercana si no), más lo que
  gastó andando ENTRE LAS DOS LECTURAS (los km de Mapon a 4,77 L/100 km). No
  mira la parada: la del 1212MJY empezaba con el depósito ya lleno y salía un
  95 % rojo. El techo y el mínimo, como antes; la corrección del techo, por km
  como lo de entre medias. Si al despertar la aguja sube 3 L o más, vale lo de
  pasados 5 minutos. Sin lecturas de antes no se reintenta: son del pasado.
- **db/216 solo toca lo del código de antes**: lo dice la versión del detalle
  (< 3), que el código de ahora escribe siempre, mida la boya o no. Y un
  reintento no devuelve una boya de la regla de antes (`restaurarBoya`).
- **Dos repostajes del mismo coche entre las dos lecturas de la boya**: la boya,
  contra la suma.
- **Un correo, una fila, y nunca dos.** Message-ID único; sin él, el UID del
  buzón con su carpeta; y el mismo repostaje en dos correos (el de Ballenoil y
  uno reenviado por la oficina) deja uno «leido» y otro «repetido».
- **Un correo que no se entiende no se pierde**: «no_leido», con el motivo y sus
  partes tal cual llegaron (`cuerpo_partes`). Si el lector de su proveedor sube
  de versión, se relee solo desde ahí. Y uno que la base no acepta, igual:
  «no_leido» con el porqué. Sin fila, un correo se vuelve a bajar y a fallar
  hasta salir de la ventana y perderse.
- **Lo del proveedor que no es un repostaje no se guarda** (promociones, facturas):
  sus correos directos tienen que traer el asunto de un repostaje. Se cuentan en
  la pasada (`otros`) para verlo si un día cambian el asunto.
- **La contraseña que el servidor no acepta no se reintenta sola**: el cron
  espera a que cambie en la ficha (el botón sí lo intenta). Reintentarla cada 10
  minutos puede hacer que DonDominio bloquee la IP, que es la que manda todos los
  correos de @telecab.es.
- **Las horas del correo son de Madrid y no tienen zona**: se guardan con
  `::timestamp AT TIME ZONE 'Europe/Madrid'`, nunca pasándolas por un `Date`.
- **A Mapon solo se le pregunta.** Ni órdenes ni relés: la auditoría usa las
  seis lecturas de arriba y nada más.
- **Y sin ahogarla** (db/215): de una en una, con 150 ms entre pregunta y
  pregunta, hasta 60 repostajes por pasada (los de las últimas 48 h primero) y
  los de un coche en 4 días con UNA lectura del aforador, una de paradas y una
  de km (`combustible.memoria`). Un Excel de tres semanas se pone al día en unas
  5 h. Lo que db/216 devolvió a la cola (`soloBoya`) no pide ni paradas ni
  posiciones: su GPS no cambia de regla.
- **La gasolinera nunca se elige por el GPS**, solo por el nombre del correo (o
  lo puesto a mano). Si el nombre duda entre dos, ninguna, y se dice: casar mal
  pintaría de rojo a quien repostó donde decía. Y duda también cuando al correo
  le sobra una palabra que es de otra gasolinera del mismo sitio («ALCORCON - EL
  CANO» no es Alcorcón I: «cano» es de la II).
- **Dónde estaba el coche es la parada que CUBRE la hora del correo**, o su
  posición a esa hora. Una parada de al lado (5 min) solo vale si a esa hora el
  coche seguía a menos de 100 m de ella; si ya andaba, manda dónde estaba. En el
  Excel, si la parada de antes queda lejos, vale lo más cerca: ella o dónde
  estaba a esa hora.
- **Una parada de Mapon tiene que ser de verdad.** Una de más de una hora en la
  que el aforador se mueve 3 L, o lejos de la gasolinera y tras la cual el
  depósito tiene 5 L más, es un GPS clavado o un equipo sin señal (el 9521MMX,
  el 0454MMZ): el GPS va sin color (la boya no mira la parada). Una larga con
  el depósito quieto sí vale: un coche aparcado lejos es lo que hay que ver.
- **El día del cambio de hora**, la hora repetida se desempata con la llegada
  del correo (`instante` en `combustible.auditoria`). Lo guardado no se toca.
- **La boya solo cuenta lo que FALTA** (23/10/2026): max(0, pagado − boya) /
  pagado. Subir de más es verde (0 %): el aforador de muchos coches marca de más.
  Y los litros que faltan nunca dicen 0 si el % no es 0 (`boya.diferencia`).
- **Un turno del bot ya cerrado no contradice a BOLT**: solo se comparan si el
  bot lo tenía en turno a esa hora; si no, «el bot, ya cerrado», en gris y
  aparte de «distintos». En Barcelona, que casi no abre turno en el bot, «sin
  turno en el bot» no se dice.
- **Sin dato no hay color, y el color nunca acusa de más.** Sin coordenadas, sin
  gasolinera, sin aforador o en % sin capacidad: sin color y con el porqué. Si
  el aforador topó en su techo y aún no se ha corregido, lo que subió es un
  mínimo: si se queda corto frente a lo pagado no se compara (sin color), y si
  ya llega, es verde: como poco entró lo pagado (`combustible.boya.esMinimo`,
  al leer). En pantalla, con «≥».
- **Los colores no se guardan**: se calculan al leer con `combustible.semaforo`.
  Cambiar un umbral cambia el histórico entero. El umbral se aplica a la cifra
  que se ve (metros enteros, error con un decimal).
- **Un fallo de Mapon no para nada**: el correo ya se leyó antes, un repostaje
  que revienta no para a los demás (y se le apunta el intento, para que no tape
  a los demás para siempre), y con Mapon caído o sin clave la pasada se salta
  sin gastar intentos.
- **Un reintento no borra lo que ya se midió.** Si Mapon no contesta a una de
  las dos preguntas, esa se queda con lo de la vez anterior.

## La puerta

Desde fuera del módulo se entra por `combustible.service`, nunca por el
repositorio ni por `combustible.auditoria`. Hoy solo entran su controlador (con
`importarExcel` para el Excel de Petroprix) y el cron de `app.js` (`leerBuzon({ origen: 'cron' })`, o
`repasar()` con el correo apagado, y, detrás, `auditarPendientes({ origen: 'cron' })`).

La nota completa: `docs/modulos/Combustible.md`.
