---
tags: [modulo, combustible, correo, imap, taller, bolt, mapon]
aliases: [Repostajes, Ballenoil DNI & GO, Combustible por correo]
ruta: /combustible
codigo: modules/Combustible/
---

# Combustible

Los repostajes que llegan **por correo**, leídos solos (22/10/2026). Camilo: *«Vamos con la conexión del correo telecab.es para que lea la estructura»*. Cada vez que alguien reposta con la tarjeta **DNI & GO de Ballenoil**, Ballenoil manda un correo a `datos@telecab.es`. El ERP lee ese buzón cada 10 minutos, guarda cada correo en `repostaje` (db/212) y lo enseña en `/combustible` con su coche, su sede, la persona de la tarjeta y **quién llevaba el coche en BOLT a esa hora**.

Y cada uno **se audita con [[Mapon]]**, en solo lectura (db/213, 23/10/2026): a cuántos metros de la gasolinera del correo estaba el coche (GPS) y cuánto se aleja lo que subió el aforador del depósito de los litros del correo (boya). La fila se pinta con el peor de los dos. Ver [[#La auditoría con Mapon (db/213)]].

| Pieza | Dónde |
|---|---|
| Leer el buzón, guardar, casar | `modules/Combustible/combustible.service.js` |
| Datos | `modules/Combustible/combustible.repo.js` · tablas `repostaje` y `repostaje_lectura` (db/212), `gasolinera` y `gasolinera_alias` y las columnas de la auditoría (db/213) |
| La auditoría con Mapon | `combustible.auditoria.js` (el servicio: cuándo, qué se pregunta, qué se guarda) |
| De qué gasolinera es, y la distancia | `combustible.gasolinera.js` (puro) |
| Lo que subió el aforador | `combustible.boya.js` (puro) |
| De qué color se pinta | `combustible.semaforo.js` (puro: los umbrales de Camilo) |
| Lo que se le pregunta a Mapon | `services/mapon.js` → `nivelDeposito`, `nivelPorcentaje`, `gastadoYKm`, `paradasUnidad`, `posicionEn`, `capacidadDeposito` (solo GET) |
| Qué correo es de quién, y leerlo | `combustible.lector.js` + un lector por proveedor: `lector.ballenoil.js`, `lector.petroprix.js` (piezas comunes en `lector.comun.js`) |
| De quién es la tarjeta | `combustible.casar.js` |
| Abrir el buzón en solo lectura | `services/correo.js` → `leerCorreos()` ([[Correo]]) |
| ¿Es de verdad de Ballenoil? (firma DKIM) | `services/dkim.js` |
| La pantalla | `modules/Combustible/vistas/combustible.ejs` (componente Listado) |
| El cron | `app.js`, `4,14,24,34,44,54 * * * *`: el buzón y, detrás, la auditoría · se apagan con `COMBUSTIBLE_CORREO=off` y `COMBUSTIBLE_AUDITORIA=off` |
| Permisos | `/combustible` (mirar) y `/combustible/leer` («Leer el buzón ahora», «Auditar ahora» y corregir la gasolinera; `escribir`) |
| Comprobador | `node scripts/comprobar-combustible.js` |

## El correo de Ballenoil

Remitente `noreply@ballenoil.es`; asunto *«Adjuntamos los datos del repostaje realizado el día 22/10/2026 en la estación de COSLADA. con DNI & GO⛽️»*. Dos partes, `text/plain` y `text/html`, **y la text/plain también es HTML**. En el cuerpo, una frase con el día y la estación, otra con lo que se ahorró, y el «Detalle del repostaje»:

```
Conductor: …                                    una persona, «PROVISIONAL 54» o «[TALLER GUTI]»
Matrícula: 9107LWS
KM: 123842                                      lo teclea el conductor
Fecha de cargo: 22/10/2026 06:50
Importe total recarga: 50,00€
Fecha repostaje: 22/10/2026 06:49
Importe repostaje: 47,43€
Importe devuelto a su saldo de recarga: 2.57€   OPCIONAL, y con PUNTO decimal
Litros: 27,432L
Carburante: Sin plomo
```

Lo que enseñaron los primeros diez correos de verdad (21-22/10/2026):

- **Los dos decimales en el mismo correo.** Los importes van con coma y el «devuelto» con punto, con dos decimales, con uno (`31.1€`) o con ninguno (`33€`). El lector acepta las dos: si hay coma y punto, el último es el decimal; si hay uno solo, es el decimal.
- **La estación** lleva espacios, guiones, paréntesis y tildes —`PRAT DE LLOBREGAT (EL).`, `HOSPITALET DE LLOBREGAT (L´).`, `BARCELONA - CLOT.`, `MONTMELÓ.`— y el punto final es de la frase, no suyo. Si la frase no está, se saca del asunto.
- **Los saltos de línea** vienen de cuatro maneras (`<br />`, `<br/>`, `<br / >` y hasta `</br>`); también valen con atributos (`<br style=…>`). Y por si un día desaparecen, cada dato se corta también donde empieza la etiqueta siguiente, la estación se corta en el punto que va antes de «En este repostaje» (o se saca del asunto, que acaba en «con DNI») y al carburante no se le pega el pie.
- **Las líneas de más de 990 caracteres llegan partidas** con `!`, salto y un espacio (*«comerciale! s»*): lo hace un servidor del camino después de que Ballenoil firme. El lector deshace el corte antes de leer. → [[Trampas conocidas]]
- **Sin hora no hay repostaje**: «Fecha repostaje: 22/10/2026» a secas queda «no se pudo leer»; leerla como las 00:00 haría mirar BOLT a medianoche.
- **Los km no son de fiar**: salen `20`, `30` y `400` en coches de más de cien mil. Se guardan tal cual; contrastarlos es de la auditoría.
- **El ahorro no siempre viene**, ni el «devuelto».
- **Dos llegaron reenviados por la oficina** (`admin@telecab.es`, «RV: Adjuntamos…»), de antes de que Ballenoil escribiera a `datos@`; uno de ellos no llegó de otra forma. Se leen también: ver abajo.

Las horas son **de Madrid** y vienen sin zona: se guardan con `::timestamp AT TIME ZONE 'Europe/Madrid'`, nunca pasándolas por un `Date` de JavaScript (en Render el huso es UTC). → [[Trampas conocidas]]

## Un lector por proveedor, elegido por el remitente

`combustible.lector.js` mira **el sobre** (remitente y asunto) y decide de quién es; solo entonces se baja el cuerpo. **Los correos de otros remitentes no se tocan, ni se abren**: el buzón es el de Camilo y tiene de todo.

- **Ballenoil**: cualquier dirección de `ballenoil.es/.com/.net` **con el asunto de un repostaje** («…datos del repostaje realizado…»). Lo demás de Ballenoil —promociones del Club, facturas, respuestas de cliente@— no se baja ni se guarda: serían filas rojas de «no se pudo leer» para siempre y la cifra «sin leer» dejaría de avisar de lo que importa. Se cuentan en la pasada (`otros`, y la nota lo dice) por si un día cambian el asunto.
- **Reenviado por la casa**: de `@telecab.es` y con el asunto de Ballenoil. Solo cuenta si dentro aparece la dirección de Ballenoil (la cabecera «De:» del reenvío); si no, era otra cosa con un asunto parecido y se deja.
- **Petroprix**: cualquier dirección de su dominio (aún no se sabe su asunto). Su lector **todavía no sabe leer** —el 22/10 no ha llegado ninguno—, así que sus correos se guardan como «no se pudo leer», con sus partes tal cual llegaron. El día que se escriba su lector (copiando el de Ballenoil), se ponga su asunto y suba su `version`, la pasada siguiente los relee desde lo guardado, sin ir al buzón.

Un correo que no se entiende **no se pierde**: queda «no_leido» con el motivo —*«No encuentro: Litros»*, *«No entiendo: Importe repostaje «cuarenta€»»*— y lo que sí se leyó. Se guardan **las partes tal cual llegaron** (`cuerpo_partes`), no solo el texto ya convertido: si lo que falla un día es la conversión, releer desde el texto no lo arreglaría. Uno que se entiende pero tiene algo raro (la recarga menos el repostaje no da lo devuelto, un precio por litro fuera de 0,80-3 €) se guarda «leido» **con avisos**.

**Lo que no puede ser no llega a la base.** Unos litros fuera de 0-200, un importe de más de 2.000 € o un precio por litro fuera de 0,30-10 € dejan el correo «no se pudo leer», diciendo los valores; 0 litros solo vale con 0 € (un repostaje anulado: se lee, con su aviso). Unos km de más de dos millones se dejan vacíos con un aviso. Y si aun así la base rechaza algo, el correo se guarda igual, «no_leido» y con el porqué: sin fila, se volvería a bajar y a fallar hasta perderse. → [[Trampas conocidas]]

**¿Es de verdad de Ballenoil?** La cabecera «De:» no prueba nada, y un repostaje se va a auditar contra un conductor. Cada correo se comprueba con su **firma DKIM** (`services/dkim.js`; DonDominio no deja su veredicto en la cabecera `Authentication-Results`, así que se hace aquí). Los nueve directos que hay cuadran todos. En la ficha sale *¿Es de verdad del proveedor?*: sí, **sin verificar** —y entonces el repostaje lleva un aviso: *«no te fíes de él sin mirarlo»*— o *no se puede saber* (los reenviados por la oficina: el reenvío pierde la firma del original; o el DNS no contestó).

## La pasada (cada 10 minutos, o el botón)

1. **Entrar.** La contraseña es la de correo de la ficha de `datos@telecab.es` (Configuración → Mi perfil), **cifrada** con `CRED_KEY`, y se descifra en memoria. No se escribe en ningún fichero ni en el log. El servidor es `imap.dondominio.com` (o `correo_imap_host` de `config_app`; el buzón, `combustible_buzon`).
2. **En solo lectura.** Las carpetas se abren con EXAMINE: **nada se marca como leído, ni se mueve, ni se borra**. Comprobado contra el buzón real el 22/10: los correos sin leer siguieron sin leer después de bajarlos enteros (también el correo en crudo, para la firma).
3. **INBOX y Spam.** El antispam de DonDominio puede mandar a Spam un correo con «⛽️» en el asunto; si no se leyera también, no se vería nunca. En la misma conexión, y cada correo con su carpeta (los UID son por carpeta, y la clave sin Message-ID la lleva). Una carpeta que no exista se apunta y no para la pasada.
4. **Desde cuándo.** Una semana atrás, o desde la última pasada buena si fue antes (el servidor estuvo parado); la primera vez, desde el 01/10/2026. Lo que ya está guardado ni se baja.
5. **Sin duplicar.** El Message-ID es único; sin él, el UID del buzón con su carpeta. Y el mismo repostaje en dos correos (mismo proveedor, coche, hora e importe) deja uno «leido» y el otro **«repetido»**, apuntando al primero: así no se suma dos veces.
6. **Nunca lanza.** Un correo que revienta se cuenta y se apunta, y los demás siguen. Uno que no se puede bajar (se movió o se borró mientras se leía) también: no se guarda y la pasada siguiente lo intenta otra vez. Si no se puede entrar, la pasada queda escrita con el porqué y su tipo —la contraseña que el servidor no acepta, la que no se puede descifrar (`CRED_KEY`), el buzón sin cuenta en el ERP, el servidor que no contesta— y la pantalla lo pinta en rojo.
7. **La contraseña que no vale no se reintenta sola.** Si el servidor la rechaza, el cron no lo vuelve a intentar hasta que la contraseña de la ficha cambie (se compara la huella de la contraseña **cifrada**, `pass_huella`; nunca se guarda la contraseña). 144 intentos fallidos al día desde la IP de Render podrían hacer que DonDominio la bloquee, y es la IP que manda los correos de todo @telecab.es. El botón sí lo intenta siempre, y la nota lo explica.
8. **Una a la vez, pero sin quedarse colgada.** Si el botón coincide con el cron, la segunda se salta (y el cron lo dice en el log). La lectura del buzón tiene un tope de 4 minutos, y una pasada que lleva más de 8 se da por muerta: se cierra su fila con el error y la siguiente entra.
9. **Después de los correos**, los «no_leido» que el lector de ahora ya entiende se releen; los leídos sin coche, sin sede o con un coche que BOLT no tenía **se vuelven a casar** (un mes: el coche puede darse de alta después); y los que esperaban a BOLT se vuelven a mirar.

Cada pasada deja su fila en `repostaje_lectura`: cuántos correos vio, cuántos eran de proveedores, cuántos ya estaban, nuevos, sin entender, repetidos, releídos, vueltos a casar, del proveedor que no eran repostajes y con error. Se guardan 30 días (90 las que fallaron).

**No va en el latido de la [[Ingesta]], a propósito.** El latido es de minuto y va en serie: un DonDominio colgado (15 s para conectar, 60 de socket) retrasaría los apuntes de BOLT de los que viven el mapa y En directo. Va en su propio cron, con su propia bandera.

**En modo pruebas** (`MODO_PRUEBAS=1`, el [[Entorno de pruebas local]]) el cron no arranca, como ninguno. El botón sí lee el buzón real —es solo lectura— y el log lo dice: *«🧪 [PRUEBAS] Combustible: se lee el buzón REAL datos@telecab.es en solo lectura…»*. La pasada queda marcada como de pruebas.

## Con qué casa cada repostaje

- **El coche y su sede.** Por la matrícula normalizada, en Vehículos. Si no está dado de alta, la sede de la empresa de BOLT que lo tiene (Barcelona en `sede_bolt_vehiculo`, Madrid en Flota viva). Si nadie conoce el coche, **la de la cuenta de BOLT de la persona de la tarjeta** (`5369LHJ`, de una persona con cuenta en Barcelona, salía «sin sede», se miraba BOLT en Madrid y quien entra con la sede de Barcelona no lo veía). Si tampoco, **sin sede**, y la matrícula sale en ámbar. No se queda así para siempre: cada pasada vuelve a casar los de un mes. Hay repostajes de **Madrid y de Barcelona**, y aquí se ven los dos: a diferencia de Taller o Facturas, que son solo de la [[Sedes|flota vigilada]], la tarjeta se usa en las dos sedes y la auditoría tiene que verlas. El filtro de sede los separa, y quien entra con la sede de Barcelona ve de entrada los suyos.
- **La tarjeta.** «PROVISIONAL 54» es una **tarjeta provisional**: no es de nadie y se marca. Lo que va entre corchetes es una nota (`[TALLER GUTI]`, `[chico de apoyo…]`). Si es una persona, se casa **por sus palabras** con las fichas (nombre y nombre de BOLT) y con las cuentas de BOLT: sin tildes ni mayúsculas, y vale también que las palabras de una estén todas en la otra (dos como mínimo). En Barcelona no hay fichas: la persona es su cuenta de BOLT. **Si el nombre vale para dos personas, no se enlaza con ninguna** («ambiguo»); la sede del coche desempata.
- **BOLT a esa hora.** En Madrid, el tramo de Flota viva de ese coche que contiene la hora (como hacen las [[Sanciones de velocidad]], pero desempatando los tramos que empiezan en el mismo instante, ver [[Trampas conocidas]]); en Barcelona, sus apuntes (`sede_bolt_state_log`), y «hace cuánto lo dejó» desde su último apunte con ESE coche. Sale *conectado* (lo llevaba alguien en la app), *el último que lo llevó* (con hace cuánto, hasta 12 h), *nadie*, *el coche no está en BOLT* (se vuelve a mirar un mes, por si se da de alta) o **pendiente**: BOLT aún no ha llegado a esa hora, y se vuelve a mirar sola en las pasadas siguientes. Esperar no es lo mismo que «nadie». A los tres días sin que BOLT llegue se cierra como **sin datos** y ya no se promete mirarlo.
- **¿Coincide?** La persona de la tarjeta contra la de BOLT: por la ficha, por la cuenta o por el nombre. Dos cuentas distintas no dicen que sean dos personas (hay 72 con más de una), así que ahí manda el nombre. Una tarjeta provisional no se compara: quien repostó lo dice BOLT.

## La pantalla

`/combustible`, en el grupo Taller del menú. Lista → ficha → atrás con el componente Listado ([[Componentes de la casa]]):

- **Arriba, las fechas** (del/al, con «Hoy», «7 días», «Este mes» y «30 días»): van al servidor. Por defecto, los últimos 30 días.
- **La lista son los repostajes leídos, y nada más** (23/10/2026). Camilo: *«quita lo del estado leído no sé qué»*. Fuera la columna de estado: **los repetidos no salen** ni en la lista ni en las cifras (se llega a ellos desde la ficha del bueno, «Llegó también en») y **los que no se pudieron leer van en un aviso rojo encima**, cada uno con el enlace a su ficha. Columnas: fecha y hora, matrícula, sede, estación (en ámbar si no casa con la lista), el conductor de la tarjeta —y debajo el de BOLT cuando no coincide o la tarjeta no es de una persona—, litros (con los tres decimales del correo), importe, **GPS** (los metros con su punto de color) y **Boya** (el error en % con su punto y lo que subió). El €/litro va al Excel y a la ficha: con las dos columnas nuevas, a 1280 px la tabla se salía de su caja.
- **Cada fila se pinta con el peor de sus dos colores**, con un fondo suave (los tres al 10 %, con los tokens de la casa, que cambian con el tema; el verde iba al 5 % y en oscuro apenas se distinguía de una fila sin color). Sin dato en los dos, sin color. **El color nunca va solo** (revisión del 23/10/2026): cada color tiene **su forma** —un visto para el verde, el triángulo de aviso para el amarillo, un aspa para el rojo y un círculo vacío sin color—, porque con daltonismo rojo-verde dos puntos de color no se distinguen; el icono dice su nombre al lector de pantalla (`role="img"` y `aria-label`); lleva su cifra al lado, y la ayuda de cada celda dice el color, de dónde sale y la regla. Lo pequeño de esas celdas va más oscuro que el gris de siempre: sobre una fila teñida, el gris se quedaba por debajo de 4,5:1.
- **Un mínimo se escribe con «≥»**: «≥ 13,6 %» y «≥ +29 L» cuando el aforador topó en su techo y aún no se ha podido corregir. Y no lleva verde (ver [[#Los colores]]).
- **Filtros**: sede, **color** (rojo, amarillo, verde, sin color, con cuántos), BOLT (no coincide, coincide, esperando) y proveedor. Las cifras de arriba son de lo que se ve; «en rojo» y «en amarillo» también filtran. El buscador, por matrícula (también «8997 LDK» o «8997-LDK»), conductor, estación o gasolinera de la lista.
- **La nota** dice la última lectura del buzón: cuándo, quién (sola o a mano) y qué hizo, o, en rojo, por qué no pudo entrar y cuándo fue la última buena (y, si es la contraseña, que el cron no la reintenta sola). **También en rojo si la última lectura tiene más de media hora**: una lista sin nada nuevo puede ser que no ha habido repostajes o que nadie está leyendo el buzón. Donde la lectura automática está apagada (entorno de pruebas, `COMBUSTIBLE_CORREO=off`) lo dice en ámbar: entonces tampoco se audita sola.
- **«Lecturas»**: las últimas 30 pasadas, una debajo de otra (en el móvil, la tabla de tres columnas dejaba fuera «qué pasó»). **«Leer el buzón ahora»**: solo con la llave `/combustible/leer`; lo nuevo sale ya con su gasolinera.
- **La ficha**: arriba, **la auditoría** (el color de la fila y por qué, las dos tarjetas de GPS y boya y en qué estado está: pendiente, a medias, hecha o sin datos, con cuántos intentos y el equipo de Mapon); **dónde estaba el coche** (la estación del correo, la gasolinera de la lista y cómo casó, la parada con su hora y su dirección y el enlace al mapa, la distancia con el enlace «el coche y la gasolinera», la más cercana de la lista); **el aforador** (antes y después con sus horas, lo que subió, el techo y su corrección, los litros de la boya y los del correo, el error, el porqué de lo que falte, y el dibujo de las lecturas con la parada en gris y las dos medianas); y luego el repostaje entero, el coche, quién y la lectura del correo, como antes.
- **«Auditar ahora»** (en la ficha) y **«Corregir la gasolinera»** / **«Quitar lo puesto a mano»** (en el bloque de dónde estaba el coche): con la llave `/combustible/leer`.

La rejilla llega justo hasta abajo de la ventana (`ajustarAlto` del Listado, 23/10/2026): la nota de la lectura ocupa una línea o dos y el aviso de los no leídos sale o no, y con un alto fijo la rejilla se salía 30 px a 1529×729 y había doble barra. Probada a 1529×729, 1280×593 y 375×812, en claro y en oscuro: la página no se desplaza de lado y, en las dos de escritorio, tampoco de arriba abajo; en el móvil la página baja como siempre y la rejilla tiene su alto de antes.

## La auditoría con Mapon (db/213)

Camilo, 22/10/2026: *«Con el criterio del GPS con un margen de error de menos de 700 m de verde, menos de 1600 m de amarillo y más de 1600 m de rojo. Para lo de la boya como me dijiste que llegaba hasta un 33 % de error, entonces de verde < 35 %, de amarillo < 65 % y rojo >= 65 %.»* Y el Excel `gasolineras_ballenoil_madrid_barcelona.xlsx`: *«esos son los alias que maneja Ballenoil con sus gasolineras, los nombres y las coordenadas»*.

**A Mapon solo se le pregunta**: seis lecturas nuevas de `services/mapon.js`, todas GET y de UN coche en una ventana de horas. Ninguna orden, ningún relé (el comprobador lo vigila con un Mapon de mentira que apunta todo lo que se toca). Es una excepción a la [[Ingesta|una sola puerta]], apuntada en `comprobar-ingesta.js` con su motivo: traer el aforador de toda la flota cada 5 minutos para mirar veinte repostajes al día no tiene sentido, y en el latido una pasada lenta de Mapon retrasaría los apuntes de BOLT. El resultado se guarda en el repostaje y **la pantalla lee la base**, nunca a Mapon.

### Las gasolineras

`gasolinera` (db/213) son las **143 de Ballenoil del Excel** (112 de Madrid, 31 de Barcelona), cargadas en la propia migración con su nombre, dirección, provincia, sede, coordenadas y **de dónde salen** (`precision`): las publica Ballenoil (`web`, 105), geocodificadas de la dirección con OpenStreetMap (`geocodificada`, 16), una carretera o un número que no se encuentra (`aproximada`, 14) o **ninguna** (`sin`, 8: Clot, La Trinidad, Colmenar Viejo I y II, Las Mercedes, Las Rejas, Pelayos de la Presa y Torrejón IV; la web solo da el código postal). Comparadas fila a fila con el Excel: las 143, sin una diferencia. `proveedor` deja sitio a Petroprix. Las coordenadas que no son de la web llevan **«≈»** en la lista y su aviso en la ficha.

**El correo y la lista no llaman igual a la misma gasolinera**, así que se casa **por sus palabras** (`combustible.gasolinera.js`), como el nombre de la tarjeta: sin «Ballenoil», sin tildes, mayúsculas ni signos, sin artículos ni preposiciones en castellano y catalán, y con el número romano aparte. **El número manda y sin número es el I**: «COSLADA» es Coslada I, no Coslada III; «CORNELLÀ DE LLOBREGAT II» es Cornellà II, no Cornellà. Exacto (las mismas palabras) o parecido (las de uno están todas en el otro: «PRAT DE LLOBREGAT (EL)» → El Prat; «ARGANDA III» → Arganda del Rey III). Una gasolinera con dos nombres («Cerdanyola del Vallès / Sardañola del Vallés») casa por los dos.

- **Si duda, ninguna, y lo dice**: «BARCELONA» a secas vale para Asunción y La Trinidad. Casar mal es peor que no casar: la distancia se mediría contra la que no es y pintaría de rojo a quien repostó donde decía. La sede del coche desempata.
- **Lo que le sobra al correo puede señalar a otra** (revisión del 23/10/2026). «Parecido» aceptaba que todas las palabras de la lista estuvieran en el correo y no miraba las que sobraban: «ALCORCON - EL CANO» casaba con **Alcorcón I** (sin número es el I) aunque «cano» es de Alcorcón II (El Cano). Igual «ARGANDA DEL REY - FULL OIL», «MATARO PARK», «MATARO - SANT SIMO», «LEGANES - LA FORTUNA», «ALCORCON - VIRGISA», «MOSTOLES - AIDATER» y «MOSTOLES - AIDATER II» (que tomaba el II por el número y casaba con Móstoles II, siendo la VII). Ahora, si al correo le sobran palabras y hay **otra gasolinera que tiene todo lo de la elegida y alguna de las que sobran**, es **ambiguo**, con las dos (o tres) de candidatas. Tiene que tener todo lo de la elegida, no basta la palabra suelta: en «BARCELONA - CLOT» sobra «barcelona», que está en otras cuatro de la lista, pero ninguna es Clot; y en «PRAT DE LLOBREGAT (EL)» sobra «llobregat», que es de Hospitalet. Esos casan como antes. Los 143 nombres de la lista, escritos como en un correo, siguen volviendo cada uno a la suya.
- **Nunca se casa por el GPS.** La auditoría mide si el coche estaba en la gasolinera del correo; elegirla por dónde estaba el coche sería darle la razón antes de mirarlo. El GPS solo enseña, aparte, **la más cercana de la lista** y a cuánto.
- **Lo que no casa se ve** (la estación en ámbar, «gasolinera sin casar» o «dudosa» en la columna del GPS) **y se pone a mano en la ficha**: «Corregir la gasolinera» abre la lista (por sede, la del coche primero, con buscador por nombre o dirección). Lo puesto vale **para ese nombre de estación y para siempre** (`gasolinera_alias`): los repostajes de antes y los que lleguen con ese nombre, escrito como sea, pasan a esa, y la distancia se rehace con la posición que ya había, sin preguntar a Mapon. «Quitar lo puesto a mano» los devuelve a casarse por el nombre.

Los 20 repostajes del 21 al 23/10/2026 casaron todos solos (14 por el mismo nombre, 6 por nombre parecido), sin dudas.

### El GPS: dónde estaba el coche

**La parada de Mapon** (`route/list`) que **cubre** la hora del correo: es donde estuvo apagado en el surtidor, y su posición es la de un coche quieto. El correo da el minuto, así que vale una que empiece dentro de ese minuto. **Las paradas que se tocan en el mismo sitio se juntan** (menos de un minuto entre una y otra, a menos de 100 m): Mapon parte una parada a medianoche, y a veces con un «trayecto» de 16 segundos y 0 km, y la ficha del 8997LDK decía «parado de 00:00 a 00:00».

Si ninguna la cubre, **su posición en ese instante** (`unit_data/history_point`), que Mapon da como el punto más cercano: si está a más de 20 minutos, no vale para decir dónde repostó, y se dice. Con la posición, los metros a la gasolinera casada (haversine). **Sin coordenadas en la lista o sin gasolinera casada, no hay metros ni color por el GPS**, y se dice por qué.

**Una parada de al lado no vale por sí sola** (revisión del 23/10/2026). Hasta entonces se aceptaba una que acabara 5 minutos antes o empezara 5 después, y se usaba sin mirar más. El n.º 16 (8997LDK, 00:05) cogió la de 23:14 a 00:00 en la Av. de Burgos y la ficha decía «parado allí», cuando a las 00:04:59 el coche ya iba a 1.676 m de allí. Y el 7909LRJ suele aparcar en Fernando Pessoa, a 1 km de Asunción, minutos después de repostar sin apagar el coche: medido desde ese aparcamiento saldría amarillo o rojo sin motivo. Ahora una parada a menos de 5 minutos que no cubre la hora solo se toma **si a esa hora el coche seguía a menos de 100 m de ella**, porque el reloj del correo y el de Mapon no son el mismo, o si Mapon no da su posición. Pasa de verdad: el n.º 17 (7909LRJ, 03:43) arrancó un minuto antes de la hora del correo y a esa hora seguía a 14 m. Si ya se había movido, manda su posición, y la ficha dice **«ya iba andando»** (o «aún iba andando») con la parada de al lado, su hora y a cuántos metros quedaba. La boya, en ese caso, se mide sin parada.

**La hora del correo, el día del cambio de hora.** El último domingo de octubre, de 02:00 a 02:59, cada hora pasa dos veces, y la base se queda con la segunda (`AT TIME ZONE 'Europe/Madrid'` elige el horario de invierno). Si el correo llegó **antes** de esa segunda, el repostaje fue en la primera: la auditoría mira una hora antes, y la ficha lo dice. Sin esto se auditaba una hora tarde, con el coche en otro sitio y el depósito ya sin subir, y salía rojo por los dos lados sin haber nada raro. El turno de noche de Barcelona reposta a esas horas. Lo guardado no se toca. → [[Trampas conocidas]]

### La boya: cuánto subió el depósito

El aforador de Mapon es la boya del depósito, leída por el CAN ([[Mapon#Combustible]]): **litros enteros, baila ±1 L y solo lee con el coche encendido.** Por eso nunca una lectura suelta: **la mediana de las 5 últimas antes de parar y la de las 5 primeras después de arrancar** (`combustible.boya.js`).

- **«Después» empieza 5 minutos después de arrancar**: en los Ioniq la aguja sube despacio (de 10 a 35 L en cuatro minutos). Si en ese rato vuelve a parar, valen las del principio.
- **Sin parada, 10 minutos a cada lado de la hora del correo.**
- **No se busca «la subida mayor»**: con la aguja bailando mientras anda, el máximo coge el valle de antes y el pico de después. Y **«después» tiene que ser después**: si Mapon aún no tiene lecturas de cuando arrancó, no es un «0 L» (un rojo de mentira): se espera y se vuelve a mirar.
- **El techo.** 31 Toyota no marcan nunca más de 40 L, 19 llegan a 45 y los Ioniq a 43-44: lo que entra por encima no se ve. El techo es **el valor más alto que se repite** en la serie (tres lecturas al menos), si llega a 38 L. No el máximo a secas: una sola lectura rota del CAN (255, 65535) lo fijaba ahí, el aforador ya no «topaba» nunca y el salto de un coche que de verdad topó se quedaba corto; lo imposible para un depósito (más de 80 L o menos de 0) ni se mira. Si después del repostaje el aforador está en su techo, se espera a que **vuelva a bajar de verdad** (mediana de 5 ≤ techo − 2) y se le suma lo que gastó hasta entonces: el gastado de la centralita (`can.fuel_total`, solo 38 Corolla) o los km a 4,77 L/100 km. Los km se piden **desde antes del repostaje**: con el coche aparcado no llegan, y si aparca al poco de repostar la serie empezaría pasado el «después» y no habría con qué corregir (3784LFV, 23/10/2026).
- **Mientras no se puede corregir, lo que subió es un mínimo.** Si se queda corto frente al correo, **no se compara** —puede ser solo el techo— y la celda dice «≥ 25 L · techo»: un rojo ahí acusaría al conductor de una limitación del aforador. Si ya pasa de los litros del correo, el error es **como poco ese**: vale para decir amarillo o rojo, **pero no verde**, porque el de verdad puede ser mayor (revisión del 23/10/2026: el n.º 20 salía verde con «13,6 %» cuando eran al menos 29 L). Se escribe «≥ 13,6 %» y «≥ +29 L», y un mínimo por debajo del 35 % va sin color. Si el aforador no baja antes del cierre, se queda así. El mínimo no se guarda aparte: se deduce de las columnas (`combustible.boya.esMinimo`: topó, `boya_despues ≥ boya_techo − 1`, y no se corrigió).
- **Los Ford Mondeo dan el nivel en %**, en otra serie (`can_period` con `fuel_level`). Sin la capacidad del depósito en Mapon (solo la tiene el 3035LTX) no se pasa a litros: se enseña el salto en % y **sin color**.
- **Sin aforador** (el coche no da el nivel por el CAN): sin color, y se dice.

**Error** = |litros de la boya − litros del correo| / litros del correo × 100, con un decimal. En pantalla va con su decimal y los metros sin pasar a km hasta los 10 km: redondeados, el borde de un color no se leería («35 %» podía ser un 34,6 verde o un 35,3 amarillo; «1,6 km», 1.599 m amarillo o 1.600 rojo).

**El umbral se aplica a la cifra que se ve** (decidido el 23/10/2026): los metros se guardan enteros y el error con un decimal, y con eso se decide el color. 699,6 m son «700 m», amarillo; un 34,96 % es «35,0 %», amarillo. Así lo que dice la pantalla y su color no se contradicen nunca («700 m» en verde no se entendería). La diferencia no significa nada: el GPS se mueve varios metros y el aforador va en litros enteros. El comprobador lo deja escrito con esos dos casos.

### Los colores

`combustible.semaforo.js`, con los umbrales de Camilo: **GPS** verde por debajo de 700 m, amarillo por debajo de 1.600 m, rojo desde 1.600; **boya** verde por debajo del 35 %, amarillo por debajo del 65 %, rojo desde el 65 %. El verde de la boya es ancho a propósito: el aforador se equivoca coche a coche de un 33 % menos a un 13 % más sin calibrar. **La fila, por el peor de los dos** (rojo > amarillo > verde); sin dato en uno, manda el otro.

**Un mínimo no da verde**: con el aforador en su techo sin corregir, el error es «como poco ese», y solo puede decir amarillo (desde el 35 %) o rojo (desde el 65 %); por debajo, sin color.

**Los colores no se guardan**: se calculan al leer. Si un día cambian los umbrales, cambia todo el histórico con ellos. Lo que se guarda (db/213, en el propio `repostaje`) son las medidas —la gasolinera y cómo casó, la posición y de dónde sale, los metros, la más cercana, el aforador antes y después, el salto, el techo, si se corrigió, los litros de la boya y el error— y, cuando falta algo, **el porqué** (`gps_motivo`, `boya_motivo`). Más `auditoria_detalle`: la parada, las horas de antes y después, la corrección y hasta 90 lecturas del aforador para el dibujo de la ficha.

### Cuándo

- **Después de cada lectura del buzón**: el mismo cron de 10 minutos, detrás y aparte (un Mapon caído no toca el correo, y un buzón que no entra no impide auditar lo guardado). Se apaga sola con `COMBUSTIBLE_AUDITORIA=off`; en modo pruebas no hay cron.
- **A los 45 minutos del repostaje**, para que haya lecturas de cuando arrancó.
- **Lo que queda a medias** (`incompleta`: Mapon no contestó, aún no hay lecturas de después, el coche sigue parado, el aforador sigue en su techo, la posición más cercana está lejos) se vuelve a mirar cada vez más espaciado: 30 min, 1, 2, 4, 8 y 12 h. **A las 48 horas del repostaje (con tres intentos al menos) o a los ocho intentos, `sin_datos`**, con lo que hubiera.
- **Un coche que no está en Mapon** (ni en Vehículos ni en el padrón de Mapon por la matrícula) queda **hecho** a la primera: no hay nada que esperar.
- **Un reintento no borra lo que ya se midió** (revisión del 23/10/2026). Cada intento empezaba de cero y guardaba todas las columnas: si Mapon tardaba en contestar las paradas, el n.º 20 —con el GPS a 12 m, esperando a que su aforador bajara del techo— perdía el GPS y la boya se medía sin parada. Ahora, si Mapon no contesta a una de las dos preguntas (o al buscar el coche, o a los km para corregir el techo, o a la capacidad del depósito), **esa se queda con lo de la vez anterior**, la boya se mide con la parada que se guardó, y el intento queda a medias. La ficha dice que en el último intento Mapon no contestó.
- **Nunca para nada.** Un repostaje que revienta (la base rechaza lo guardado, un fallo fuera de lo de Mapon) se cuenta, **se le apunta el intento** —queda a medias, con el error en el detalle y lo medido sin tocar— y sigue el siguiente. Sin apuntarlo seguía «pendiente», era el primero de cada pasada para siempre y veinte así tapaban a todos los demás. **Mapon caído o sin `MAPON_API_KEY` salta la pasada entera sin gastar intentos**; sin db/213 lo dice una vez en el log. Veinte por pasada y como mucho 4 minutos, y una pasada a la vez.
- **Las gasolineras se casan primero las nuevas.** Antes de auditar, cada pasada casa los que aún no tienen gasolinera y vuelve a probar los «ninguna» y «ambiguo» de 60 días, con tope de 500: primero los que nunca se casaron y del más nuevo al más viejo. Del más viejo al más nuevo, con 500 «ninguna» (los de Petroprix, sin lista, salen todos así) los recién llegados no entraban nunca.
- **A mano: «Auditar ahora»** en la ficha, con la llave de escribir. Solo los leídos.

## Medido el 23/10/2026: la auditoría de los 20 primeros

Con Mapon de verdad (solo lectura) desde el [[Entorno de pruebas local]], sobre una copia de producción de esa mañana con db/213 aplicada por el corredor. Los 20 repostajes del 21 al 23/10, auditados de cero en 4,6 s con el código tras la revisión: 19 hechos y uno a medias.

| # | Matrícula | Hora | Gasolinera (casada) | GPS | Boya (subió / correo) | Error | Fila |
|---|---|---|---|---|---|---|---|
| 2 | 5369LHJ | 21/10 08:50 | Hospitalet de Llobregat | — no está en Mapon | — | — | sin color |
| 1 | 7043LJN | 21/10 12:53 | Alcobendas II | — no está en Mapon | — | — | sin color |
| 3 | 6450LSR | 21/10 14:57 | Hospitalet de Llobregat | — no está en Mapon | — | — | sin color |
| 4 | 7909LRJ | 21/10 16:31 | Clot | — sin coordenadas (más cercana: Lope de Vega, 1.187 m) | 10,9 L (techo corregido) / 10,372 | 5,1 % | verde |
| 5 | 6584KZV | 22/10 01:55 | Barcelona - Asunción | 12 m | — sin aforador | — | verde |
| 6 | 7909LRJ | 22/10 03:19 | Barcelona - Asunción | 12 m | 12 L / 8,870 | 35,3 % | **amarillo** |
| 7 | 9107LWS | 22/10 06:49 | El Prat | 82 m | 30,9 L (techo corregido) / 27,432 | 12,6 % | verde |
| 8 | 8997LDK | 22/10 12:57 | Coslada I | 19 m | 24 L / 24,405 | 1,7 % | verde |
| 9 | 8477LTR | 22/10 14:45 | Montmeló | — no está en Mapon | — | — | sin color |
| 10 | 3031LTV | 22/10 15:36 | Hospitalet de Llobregat | 15 m | — sin aforador | — | verde |
| 11 | 6584KZV | 22/10 16:39 | Cornellà II | 465 m (≈) | — sin aforador | — | verde |
| 12 | 3814KYG | 22/10 16:57 | Barcelona - Asunción | 2 m | 25 L (techo corregido) / 21,901 | 14,2 % | verde |
| 13 | 7909LRJ | 22/10 17:09 | Clot | — sin coordenadas (sin parada; Lope de Vega a 1.169 m) | 13 L / 9,170 | 41,8 % | **amarillo** |
| 14 | 0101LTF | 22/10 17:18 | Galapagar | — no está en Mapon | — | — | sin color |
| 15 | 8997LDK | 22/10 18:44 | Arganda del Rey III | 272 m | 22,6 L (techo corregido) / 23,543 | 4,0 % | verde |
| 16 | 8997LDK | 23/10 00:05 | Alcalá de Henares | **24,2 km** (ya iba andando; más cercana: Fuencarral, 3.144 m) | **−1 L** (40 → 39) / 24,860 | 104 % | **rojo** |
| 17 | 7909LRJ | 23/10 03:43 | Barcelona - Asunción | 23 m (la parada acabó 1 min antes y seguía a 14 m) | 17 L / 12,802 | 32,8 % | verde |
| 18 | 6544LVX | 23/10 04:03 | El Prat | 83 m | 35,1 L (techo corregido) / 31,270 | 12,2 % | verde |
| 19 | 3784LFV | 23/10 05:22 | Hospitalet de Llobregat | 11 m | 27,3 L (techo corregido) / 25,221 | 8,2 % | verde |
| 20 | 3814KYG | 23/10 06:11 | Barcelona - Asunción | 12 m | ≥ 29 L (sigue en el techo) / 25,539 | ≥ 13,6 %, la boya sin color (un mínimo no da verde) | verde por el GPS, a medias |

Lo que dice:

- **El GPS clava la gasolinera** en todos los que se pueden medir: de 2 a 465 m (Cornellà II tiene coordenadas aproximadas).
- **El rojo, el n.º 16**: la tarjeta pagó 24,86 L en Alcalá de Henares a las 00:05 con la matrícula 8997LDK, y ese coche estuvo parado en Madrid (Av. de Burgos) de 23:14 a 00:00; a las 00:04:59 iba andando por Madrid, a 1.676 m de esa parada y a 24,2 km de Alcalá. Su depósito no subió (40 → 39 L). En BOLT lo llevaba otra persona que la de la tarjeta, en viaje desde las 23:56. Era su tercer repostaje en 11 horas (Coslada 12:57 y Arganda 18:44, los dos verdes). Mirado en crudo en Mapon: es así. Con la parada de al lado, la auditoría de antes decía «parado allí» y 23,3 km; el rojo era el mismo. **Lo decide Camilo.**
- **Los dos amarillos son del 7909LRJ**, con repostajes pequeños (8,9 y 9,2 L): en tres de sus cuatro repostajes su aforador marca 3-4 L de más, y en poco volumen eso es un 35-42 %. El del Clot de las 17:09 se midió sin parada (el coche no se apagó: el salto, 31 → 43 L, está a las 17:10).
- **Los dos del Clot, sin color por el GPS**: la lista no tiene sus coordenadas. Las dos veces el coche estaba en el Carrer del Clot, 4 (08018), a 1,2 km de Lope de Vega, la más cercana con coordenadas.
- **5 coches no están en Mapon** (5369LHJ, 7043LJN, 6450LSR, 8477LTR, 0101LTF) y **3 no dan el aforador** (6584KZV dos veces, 3031LTV).
- **El reloj del correo y el de Mapon no son el mismo**: el n.º 17 arrancó un minuto antes de la hora del correo y a esa hora seguía a 14 m del surtidor. Por eso una parada de al lado se toma si el coche seguía junto a ella.
- **El n.º 20 queda verde por el GPS y la boya sin color**: al menos 29 L de 25,539 da «como poco un 13,6 %», que no basta para decir verde. Se reintenta solo hasta que su aforador baje del techo.

## Medido el 22/10/2026

Contra el buzón real, desde el [[Entorno de pruebas local]]: 12 correos desde el 01/10, **9 de Ballenoil (7 directos y 2 reenviados por la oficina), los 9 leídos sin un error**, cero repetidos. La segunda pasada: los 9 «ya estaban». Mientras se probaba llegó el décimo y entró con el botón. Seis de Barcelona, uno de Madrid y tres de coches que no están dados de alta en Vehículos (`5369LHJ`, `6450LSR`, `7043LJN`). Como la copia local de la base llegaba al 19/10, BOLT salió «pendiente» en todos; las consultas de BOLT se probaron sobre repostajes inventados dentro de esos días (Madrid: el último que lo llevó, hace 4 h; Barcelona: conectado en espera, y 37 min después de que lo dejara).

Tras la revisión (22/10/2026, tarde), de nuevo contra el buzón real: **11 correos de Ballenoil (INBOX y Spam), los 11 leídos**, dos pasadas seguidas sin duplicar nada y los sin leer siguen sin leer. **Los 9 directos, con la firma DKIM de ballenoil.es válida**; los 2 reenviados, «no se puede saber». `5369LHJ` ya sale de Barcelona (por la cuenta de BOLT de la tarjeta); `6450LSR` (provisional) y `7043LJN` (del taller) siguen sin sede: no hay persona de la que sacarla. Quién llevaba el coche se contrastó **en producción, en solo lectura**, con el SQL del módulo: de los nueve que se miraron, los 8 cuyo coche está en BOLT salen con alguien conectado o que lo acababa de dejar (5 y 18 min), y el de COSLADA lo llevaba en BOLT la misma persona que dice la tarjeta. Los empates de `fv_tramo`: de 200 medidos, 163 salían mal antes del desempate y 0 después.

## Lo que queda

- **Aplicar db/213 en producción** desde `/migraciones` (db/212 ya lo está). Hasta entonces la pantalla dice «Falta aplicar la migración db/213» y el cron no audita (lo dice una vez en el log); la lectura del buzón sigue igual. Al aplicarla, la primera pasada casa las gasolineras de todos y empieza a auditar los pendientes, veinte cada diez minutos, del más antiguo al más nuevo.
- **Dar la llave** `/combustible` (y `/combustible/leer` a quien deba leer el buzón, auditar a mano y corregir gasolineras) en `/usuarios`: el desarrollador y el superadmin la tienen por rol; los demás roles la reciben al crearse si llevan el grupo Taller, pero a los usuarios que ya existen hay que dársela.
- **El rojo del 8997LDK** (23/10 00:05, Alcalá de Henares): el coche estaba en Madrid, andando, y el depósito no subió. Lo mira Camilo.
- **El cambio de hora en BOLT.** La auditoría ya mira la hora buena el día del cambio de hora (la primera pasada de las 02:00-02:59 si el correo llegó antes de la segunda), pero quién llevaba el coche en BOLT se sigue mirando con la hora guardada, la segunda. Afecta solo a los repostajes de esa hora, una noche al año (el próximo, el domingo 25/10/2026). Se arreglaría con la misma cuenta en las dos consultas de BOLT de `combustible.repo`.
- **Las 8 gasolineras sin coordenadas**, entre ellas **Clot**, donde reposta el 7909LRJ: sus repostajes no tienen color por el GPS. Las dos veces el coche paró en el Carrer del Clot, 4 (08018); si es ahí, ponerle esas coordenadas (una migración nueva, no editar la 213).
- **Los Ford** sin la capacidad del depósito en Mapon salen en % y sin color. Con un par de tickets de cada uno (litros ÷ % subido) o la ficha técnica se podría poner su `fuel_tank` en Mapon.
- **Los km tecleados** contra el odómetro de Mapon: no se contrastan todavía (salen `20`, `30` y `400` en coches de más de cien mil).
- **El lector de Petroprix**, cuando llegue el primer correo (y su asunto, para que sus promociones no se lean como repostajes). Su lista de gasolineras, cuando la haya (`proveedor` ya lo admite).
- **`6450LSR` y `7043LJN`** (tarjeta provisional y del taller) salen sin sede hasta que se den de alta en Vehículos; entonces la pasada los casa sola. `5369LHJ` ya sale de Barcelona por la persona de la tarjeta, pero tampoco está en Vehículos. Ninguno de los tres, ni el 8477LTR ni el 0101LTF, está en Mapon: sin GPS ni boya.
