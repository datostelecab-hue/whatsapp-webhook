---
tags: [modulo, combustible, correo, imap, taller, bolt]
aliases: [Repostajes, Ballenoil DNI & GO, Combustible por correo]
ruta: /combustible
codigo: modules/Combustible/
---

# Combustible

Los repostajes que llegan **por correo**, leídos solos (22/10/2026). Camilo: *«Vamos con la conexión del correo telecab.es para que lea la estructura»*. Cada vez que alguien reposta con la tarjeta **DNI & GO de Ballenoil**, Ballenoil manda un correo a `datos@telecab.es`. El ERP lee ese buzón cada 10 minutos, guarda cada correo en `repostaje` (db/212) y lo enseña en `/combustible` con su coche, su sede, la persona de la tarjeta y **quién llevaba el coche en BOLT a esa hora**.

Es el primer paso de una auditoría: lo siguiente es cruzarlo con [[Mapon]] (¿estaba el coche en esa estación?, ¿cuadran los km?). Eso **no** está hecho; cada repostaje nace con `auditoria_estado = 'pendiente'` y con todo lo que esa auditoría va a necesitar.

| Pieza | Dónde |
|---|---|
| Leer el buzón, guardar, casar | `modules/Combustible/combustible.service.js` |
| Datos | `modules/Combustible/combustible.repo.js` · tablas `repostaje` y `repostaje_lectura` (db/212) |
| Qué correo es de quién, y leerlo | `combustible.lector.js` + un lector por proveedor: `lector.ballenoil.js`, `lector.petroprix.js` (piezas comunes en `lector.comun.js`) |
| De quién es la tarjeta | `combustible.casar.js` |
| Abrir el buzón en solo lectura | `services/correo.js` → `leerCorreos()` ([[Correo]]) |
| ¿Es de verdad de Ballenoil? (firma DKIM) | `services/dkim.js` |
| La pantalla | `modules/Combustible/vistas/combustible.ejs` (componente Listado) |
| El cron | `app.js`, `4,14,24,34,44,54 * * * *` · se apaga con `COMBUSTIBLE_CORREO=off` |
| Permisos | `/combustible` (mirar) y `/combustible/leer` («Leer el buzón ahora», `escribir`) |
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
- **La lista**: fecha y hora, matrícula, sede, estación, el conductor de la tarjeta —y debajo el de BOLT cuando no coincide o la tarjeta no es de una persona—, litros (con los tres decimales del correo), importe, €/litro y el estado: *Leído*, *Leído, con avisos*, *No coincide con BOLT*, *Esperando a BOLT*, *No se pudo leer* o *Repetido*. Filtros por sede, estado y proveedor; el buscador, por matrícula (también escrita «8997 LDK» o «8997-LDK»), conductor o estación. Las cifras de arriba (repostajes, litros, euros, €/L medio) son de lo que se ve y **solo cuentan los leídos**.
- **La nota** dice la última lectura del buzón: cuándo, quién (sola o a mano) y qué hizo, o, en rojo, por qué no pudo entrar y cuándo fue la última buena (y, si es la contraseña, que el cron no la reintenta sola). **También en rojo si la última lectura tiene más de media hora**: una lista sin nada nuevo puede ser que no ha habido repostajes o que nadie está leyendo el buzón. Donde la lectura automática está apagada (entorno de pruebas, `COMBUSTIBLE_CORREO=off`) lo dice en ámbar.
- **«Lecturas»**: las últimas 30 pasadas, una debajo de otra (en el móvil, la tabla de tres columnas dejaba fuera «qué pasó»). **«Leer el buzón ahora»**: solo con la llave `/combustible/leer`.
- **La ficha**: el repostaje entero, el coche (enlace a Vehículos), quién (la tarjeta, la ficha casada con enlace a Plantilla, BOLT a esa hora y si coincide), la lectura del correo (remitente, si es de verdad del proveedor, quién lo reenvió, carpeta, asunto, Message-ID, los repetidos) y **el correo tal cual se leyó** (todas sus partes, si no se entendió).

Probada a 1529×729, 1280×593 y en móvil (375 px) sin desplazamiento lateral de la página; a 1529×729 y 1280×593 la rejilla cabe entera en la pantalla (con `calc(100vh-23rem)`; con 19rem se salía 45 px y había doble barra). Para que en el móvil cupiera, la fila del buscador y los botones del Listado ahora **bajan de línea** en vez de salirse (`listado.js`, 22/10/2026): vale para todas las pantallas con Listado.

## Medido el 22/10/2026

Contra el buzón real, desde el [[Entorno de pruebas local]]: 12 correos desde el 01/10, **9 de Ballenoil (7 directos y 2 reenviados por la oficina), los 9 leídos sin un error**, cero repetidos. La segunda pasada: los 9 «ya estaban». Mientras se probaba llegó el décimo y entró con el botón. Seis de Barcelona, uno de Madrid y tres de coches que no están dados de alta en Vehículos (`5369LHJ`, `6450LSR`, `7043LJN`). Como la copia local de la base llegaba al 19/10, BOLT salió «pendiente» en todos; las consultas de BOLT se probaron sobre repostajes inventados dentro de esos días (Madrid: el último que lo llevó, hace 4 h; Barcelona: conectado en espera, y 37 min después de que lo dejara).

Tras la revisión (22/10/2026, tarde), de nuevo contra el buzón real: **11 correos de Ballenoil (INBOX y Spam), los 11 leídos**, dos pasadas seguidas sin duplicar nada y los sin leer siguen sin leer. **Los 9 directos, con la firma DKIM de ballenoil.es válida**; los 2 reenviados, «no se puede saber». `5369LHJ` ya sale de Barcelona (por la cuenta de BOLT de la tarjeta); `6450LSR` (provisional) y `7043LJN` (del taller) siguen sin sede: no hay persona de la que sacarla. Quién llevaba el coche se contrastó **en producción, en solo lectura**, con el SQL del módulo: de los nueve que se miraron, los 8 cuyo coche está en BOLT salen con alguien conectado o que lo acababa de dejar (5 y 18 min), y el de COSLADA lo llevaba en BOLT la misma persona que dice la tarjeta. Los empates de `fv_tramo`: de 200 medidos, 163 salían mal antes del desempate y 0 después.

## Lo que queda

- **Aplicar db/212 en producción** desde `/migraciones`. Hasta entonces la pantalla dice «Falta aplicar la migración db/212» y el cron lo avisa en el log una sola vez, no cada diez minutos.
- **Dar la llave** `/combustible` (y `/combustible/leer` a quien deba poder leer a mano) en `/usuarios`: el desarrollador y el superadmin la tienen por rol; los demás roles la reciben al crearse si llevan el grupo Taller, pero a los usuarios que ya existen hay que dársela.
- **La auditoría con Mapon**: ¿estaba el coche en la estación a esa hora?, ¿cuadran los km tecleados con el odómetro?, ¿cuadran los litros con lo que subió el depósito? `auditoria_estado` y `auditoria_detalle` esperan.
- **El lector de Petroprix**, cuando llegue el primer correo (y su asunto, para que sus promociones no se lean como repostajes).
- **`6450LSR` y `7043LJN`** (tarjeta provisional y del taller) salen sin sede hasta que se den de alta en Vehículos; entonces la pasada los casa sola. `5369LHJ` ya sale de Barcelona por la persona de la tarjeta, pero tampoco está en Vehículos.
- **`velocidad.repo.quienConducia`** ([[Sanciones de velocidad]]) tiene el mismo empate de `fv_tramo` que se arregló aquí, sin tocar: es de otro módulo y decide a quién se le atribuye un exceso.
