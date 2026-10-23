# Combustible (`/combustible`)

Los repostajes que llegan por correo. Cada repostaje con la tarjeta DNI & GO de
Ballenoil manda un correo a `datos@telecab.es`; el ERP lee ese buzón cada 10
minutos **en solo lectura**, guarda cada correo como una fila de `repostaje`
(db/212) y la enseña con su coche, su sede, la persona de la tarjeta y quién
llevaba el coche en BOLT a esa hora. Petroprix está preparado: se reconoce y se
guarda, pero aún no se sabe leer. Y cada repostaje se AUDITA CON MAPON (db/213),
en solo lectura: a cuántos metros de su gasolinera estaba el coche (GPS) y cuánto
se aleja lo que subió el aforador de los litros del correo (boya). La fila se
pinta con el peor de los dos.

```
combustible.controller.js   /combustible: la pantalla y la API (lista, ficha, lecturas, «Leer el buzón ahora»)
combustible.service.js      LA PUERTA: leer el buzón, guardar, casar con el coche, la tarjeta y BOLT
combustible.repo.js         el SQL (repostaje, repostaje_lectura)
combustible.lector.js       puro: de quién es cada correo (por remitente) y leerlo con su lector
lector.comun.js             puro: el correo a texto, números con coma o punto, fechas, «Etiqueta: valor»
lector.ballenoil.js         puro: la estructura del correo de Ballenoil (DNI & GO)
lector.petroprix.js         puro: preparado, sin estructura todavía
combustible.casar.js        puro: de quién es la tarjeta y si es quien llevaba el coche en BOLT
combustible.auditoria.js    la auditoría con Mapon: cuándo, qué se le pregunta y qué se guarda
combustible.gasolinera.js   puro: con qué gasolinera de la lista casa la estación del correo, y la distancia
combustible.boya.js         puro: cuánto subió el aforador (medianas, la aguja, el techo y su corrección)
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
  la auditoría. Se apagan con `COMBUSTIBLE_CORREO=off` y
  `COMBUSTIBLE_AUDITORIA=off`; con `MODO_PRUEBAS=1` no arranca.
- `services/permisos.js`: `/combustible` (mirar) y `/combustible/leer`
  (`escribir`: cualquier petición que no sea un GET la exige). La segunda abre
  «Leer el buzón ahora», «Auditar ahora» y corregir la gasolinera.
- `db/213`: las 143 gasolineras de Ballenoil del Excel de Camilo, los nombres
  puestos a mano (`gasolinera_alias`) y las columnas de la auditoría.
- `scripts/comprobar-combustible.js`: las reglas, sin base, sin buzón y sin
  Mapon (con uno de mentira que grita si se le pide algo que no sea leer).
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
- **La gasolinera nunca se elige por el GPS**, solo por el nombre del correo (o
  lo puesto a mano). Si el nombre duda entre dos, ninguna, y se dice: casar mal
  pintaría de rojo a quien repostó donde decía. Y duda también cuando al correo
  le sobra una palabra que es de otra gasolinera del mismo sitio («ALCORCON - EL
  CANO» no es Alcorcón I: «cano» es de la II).
- **Dónde estaba el coche es la parada que CUBRE la hora del correo**, o su
  posición a esa hora. Una parada de al lado (5 min) solo vale si a esa hora el
  coche seguía a menos de 100 m de ella; si ya andaba, manda dónde estaba.
- **El día del cambio de hora**, la hora repetida se desempata con la llegada
  del correo (`instante` en `combustible.auditoria`). Lo guardado no se toca.
- **Sin dato no hay color, y el color nunca acusa de más.** Sin coordenadas, sin
  gasolinera, sin aforador o en % sin capacidad: sin color y con el porqué. Si
  el aforador topó en su techo y aún no se ha corregido, lo que subió es un
  mínimo: si se queda corto frente al correo no se compara, y si pasa, el error
  es «como poco ese» y **solo da amarillo o rojo, nunca verde**
  (`combustible.boya.esMinimo`, al leer). En pantalla, con «≥».
- **Los colores no se guardan**: se calculan al leer con `combustible.semaforo`.
  Cambiar un umbral cambia el histórico entero. El umbral se aplica a la cifra
  que se ve (metros enteros, error con un decimal).
- **Un fallo de Mapon no para nada**: el correo ya se leyó antes, un repostaje
  que revienta no para a los demás (y se le apunta el intento, para que no tape
  a los demás para siempre), y con Mapon caído o sin clave la pasada se salta
  sin gastar intentos.
- **Un reintento no borra lo que ya se midió.** Si Mapon no contesta a una de
  las dos preguntas, esa se queda con lo de la vez anterior (y la boya se mide
  con la parada guardada).

## La puerta

Desde fuera del módulo se entra por `combustible.service`, nunca por el
repositorio ni por `combustible.auditoria`. Hoy solo entran su controlador y el
cron de `app.js` (`leerBuzon({ origen: 'cron' })` y, detrás,
`auditarPendientes({ origen: 'cron' })`).

La nota completa: `docs/modulos/Combustible.md`.
