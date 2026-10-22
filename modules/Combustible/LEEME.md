# Combustible (`/combustible`)

Los repostajes que llegan por correo. Cada repostaje con la tarjeta DNI & GO de
Ballenoil manda un correo a `datos@telecab.es`; el ERP lee ese buzón cada 10
minutos **en solo lectura**, guarda cada correo como una fila de `repostaje`
(db/212) y la enseña con su coche, su sede, la persona de la tarjeta y quién
llevaba el coche en BOLT a esa hora. Petroprix está preparado: se reconoce y se
guarda, pero aún no se sabe leer. Auditarlos con Mapon es la tanda siguiente.

```
combustible.controller.js   /combustible: la pantalla y la API (lista, ficha, lecturas, «Leer el buzón ahora»)
combustible.service.js      LA PUERTA: leer el buzón, guardar, casar con el coche, la tarjeta y BOLT
combustible.repo.js         el SQL (repostaje, repostaje_lectura)
combustible.lector.js       puro: de quién es cada correo (por remitente) y leerlo con su lector
lector.comun.js             puro: el correo a texto, números con coma o punto, fechas, «Etiqueta: valor»
lector.ballenoil.js         puro: la estructura del correo de Ballenoil (DNI & GO)
lector.petroprix.js         puro: preparado, sin estructura todavía
combustible.casar.js        puro: de quién es la tarjeta y si es quien llevaba el coche en BOLT
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
- `app.js`: la ruta y el cron (`4,14,24,34,44,54 * * * *`, se apaga con
  `COMBUSTIBLE_CORREO=off`; con `MODO_PRUEBAS=1` no arranca).
- `services/permisos.js`: `/combustible` (mirar) y `/combustible/leer`
  (`escribir`: cualquier petición que no sea un GET la exige).
- `scripts/comprobar-combustible.js`: las reglas, sin base ni buzón.

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

## La puerta

Desde fuera del módulo se entra por `combustible.service`, nunca por el
repositorio. Hoy solo entran su controlador y el cron de `app.js`
(`leerBuzon({ origen: 'cron' })`).

La nota completa: `docs/modulos/Combustible.md`.
