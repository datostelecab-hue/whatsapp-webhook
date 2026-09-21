---
tags:
  - telecab
  - como-se-trabaja
  - arquitectura
  - convenciones
  - reglas
---

# Reglas de la casa

Lo que se respeta sí o sí en este repositorio. No son buenas intenciones: casi
todas las vigila un script de `scripts/comprobar-*.js`, y las que no, están
escritas en el comentario de cabecera del fichero al que afectan.

Contexto general en [[Arquitectura]]. Las herramientas que las hacen cumplir, en
[[Comprobadores]]. Lo que ya salió mal por saltárselas, en [[Trampas conocidas]].

---

## 1. Las capas, y la flecha va hacia abajo

```
Petición HTTP
     ↓
Controlador      routes/*.js  ·  modules/<X>/*.controller.js    traduce HTTP ↔ dominio
     ↓
Servicio         services/*.js  ·  modules/<X>/*.service.js     las reglas del negocio
     ↓
Repositorio      services/repo/*.js  ·  modules/<X>/*.repo.js   el SQL, y nada más
     ↓
PostgreSQL
```

**El controlador no decide nada.** Hace tres cosas y ninguna más: sacar los datos
de la petición, llamar a **una** función de dominio, y convertir la respuesta —o
el error— en HTTP. No lleva SQL dentro, no importa el pool de la base, y no
encadena tres módulos para conseguir algo: encadenar es orquestar, y orquestar es
negocio.

**Un repositorio no llama a un servicio de dominio.** Si lo hace, la capa de datos
pasa a depender de las reglas y ya no se puede leer ni probar una sin arrastrar la
otra. Sí puede llamar a otro repositorio y a los adaptadores.

**El repositorio solo sabe de datos:** SQL y mapeo de filas a objetos. Esto hoy se
cumple a medias y es deuda conocida y apuntada.

### Dos cosas que NO son una capa

- **El núcleo** (`services/nucleo.js`): constantes y funciones puras. Ni base de
  datos, ni red, ni decisiones. Las horas que parten la [[Jornada y turnos]]
  (05→05), el normalizador de nombres, el mapa de columnas de la agenda. Lo usa
  cualquier capa sin saltarse nada, igual que `path` o `fs`. La prueba para saber
  si algo va aquí: *si para usarlo hay que levantar algo, no va aquí*.
- **Los adaptadores** (`services/whatsapp.js`, `drive.js`, `sheets.js`,
  `mapon.js`, `bolt.js`, `correo.js`, `cripto.js`, `geocoding.js`,
  `excelEstilo.js`…): hablan con el mundo de fuera o son herramienta pura. **No
  saben nada del negocio**, y por eso los puede usar cualquiera. Son el suelo, no
  un piso.

Y los **transversales** (`services/repo/actor`, `services/sesion`,
`services/permisos`): quién eres y qué puedes. Los usa todo el mundo y no cuentan
como dominio.

> La lista de adaptadores está **escrita a mano** en `scripts/comprobar-capas.js`,
> no adivinada por el nombre de la carpeta. Añadir uno es una decisión que se ve
> en el commit. Lo mismo con `CAPA_DECLARADA`, que dice fichero a fichero qué es
> de verdad cada cosa dentro de `services/flotaViva/`.

## 2. Desde fuera se entra por el `.service` del módulo, nunca por su repo

Es **la regla que hace que modularizar sirva de algo**. Si el planificador lee
directamente `vehiculos.repo`, entonces Vehículos ya no puede cambiar por dentro
sin romper al planificador — y poder cambiar por dentro era justo lo que se iba a
ganar agrupándolo. *Una carpeta sin esta regla es una carpeta, no un módulo.*

- Dentro de `modules/`, un controlador que habla con un repositorio es **FALTA**.
- En `routes/` (la casa vieja) es solo **aviso**: es deuda conocida que se cierra
  sola al mudar cada módulo. Se llama *el trinquete*: la regla aprieta hacia
  adelante y no afloja.
- Al poner la puerta, **conserva la firma del repositorio** si puedes.
  `tablero({ dia })` la conservó a propósito: cambiarla habría sido meter un error
  de firma en cinco sitios a cambio de nada.

Los **reexportadores** —un fichero de una línea en la ruta vieja que hace
`module.exports = require('../modules/X/x.repo')`— no incumplen esta regla: son su
trabajo, y existen para que una referencia que se haya escapado siga funcionando
en producción en vez de dar un 500. Pero son **deuda con fecha de caducidad**: se
borran todos juntos cuando `node scripts/inventario-muerto.js` diga que no los
apunta nadie. Un puente que se sabe que no apunta a nadie es deuda recién creada;
si se puede comprobar fichero a fichero que nadie lo usa, no se deja.

## 3. Los datos externos entran por UNA puerta

[[BOLT]] y [[Mapon]] se llaman desde `services/ingesta.js` y de ningún otro sitio.
Todo lo demás lee de PostgreSQL. Una ruta o una vista que llame a una API tarda lo
que tarde esa API y se cae cuando ella se cae: por eso en `routes/`, en `views/`,
en cualquier `*.controller.js` y en cualquier `modules/*/vistas/` está
**prohibido siempre**.

Lo que todavía llama por su cuenta vive en la lista `PERMITIDOS` de
`scripts/comprobar-ingesta.js`, **cada línea con su motivo escrito**. Esa lista
solo puede encoger, y el comprobador avisa también de los permisos que ya no hacen
falta: un permiso muerto engorda la lista y hace creer que la deuda es mayor de lo
que es.

## 4. Todo en español, comentarios incluidos

Ficheros, funciones, variables, tablas, columnas, rutas, mensajes y comentarios:
**español**. `conductor_periodo_empleo`, `plantilla.controller.js`,
`estadosVehiculo()`, `normClave()`, `asegurarRegistro()`. No hay mezcla de
idiomas ni traducción a medias.

Las únicas excepciones son las que vienen impuestas de fuera y no se traducen
porque dejarían de casar con su origen: los nombres de la API de [[BOLT]] y de
[[Mapon]] (`has_order`, `waiting_orders`, `can.odom`, `mapon_unit`), las tablas
del núcleo de ingesta (`fv_tramo`, `fv_ruta`) y las palabras de SQL.

## 5. Los comentarios explican el PORQUÉ, no el qué

Es el rasgo más característico del repositorio y no es decoración: **el saber de la
casa vive en los comentarios de cabecera**. Un comentario de aquí cuenta:

1. Qué hace el fichero, en una línea.
2. **Por qué está escrito así** y no de la forma obvia.
3. Qué pasó cuando se hizo de la forma obvia — con la cifra si la hay.

Ejemplo real, de `services/nucleo.js`:

> Estaban repetidas en `flotaViva/rutas.js` y en `auditoriaFlota.js` con la misma
> variable de entorno. Dos copias de la constante que parte el día es la forma más
> silenciosa de que dos pantallas no cuadren.

Reglas prácticas que se derivan de esto:

- **Un aviso en un comentario dura hasta que alguien tiene prisa.** Si la regla
  importa de verdad, se le pone un comprobador que la vigile. Es literalmente por
  lo que existen los `scripts/comprobar-*.js`.
- **Lo que se decidió NO hacer se escribe también, y con el motivo.** Media
  `docs/ARQUITECTURA.md` es eso: por qué `flotaViva` no es un módulo, por qué
  `tickets.js` no se muda, por qué `crear()` sigue abriendo las plazas desde el
  repositorio.
- **Una herramienta que promete más de lo que da es peor que una que avisa de
  dónde acaba.** Los comprobadores documentan su propio límite en la cabecera.
- **Los números se comprueban, no se estiman.** Las cifras de
  `docs/ARQUITECTURA.md` salen de ejecutar `comprobar-capas.js`, y cuando el
  código cambia, cambian.

## 6. Las migraciones, solo por el corredor

El esquema vive en `db/NN-nombre.sql`, numerado y en orden (137 ficheros a día de
hoy). Lo aplica **el corredor**: `services/migraciones.js`, desde el panel
`/migraciones`, que es solo del desarrollador.

**Nunca se ejecuta un `db/*.sql` a mano contra producción.** El corredor lleva el
registro en la tabla `_migracion` con la huella SHA-256 de cada fichero; aplicar
por fuera rompe ese registro y deja el panel en rojo, avisando de una modificación
que no existe.

Lo que el corredor garantiza, y que hay que respetar al escribir una migración:

- Cada fichero va en **su propia transacción**: uno que falle no deja la base a
  medias ni impide reintentarlo tras corregirlo.
- Se puede ejecutar mil veces: solo aplica lo pendiente.
- **El orden es por NÚMERO, no por nombre.** Con `.sort()` a secas, "100" va antes
  que "99".
- La huella normaliza saltos de línea: con `core.autocrlf` el mismo fichero tiene
  CRLF en Windows y LF en Render, y hashear el texto crudo marcaría todas las
  migraciones como modificadas.
- **Editar una migración ya aplicada no la vuelve a ejecutar.** El corredor avisa
  del cambio en vez de callar. Si hay que corregir algo, se escribe una migración
  nueva.
- Antes de desplegar, `node scripts/comprobar-migraciones.js` y
  `node scripts/comprobar-sql.js`. Ver [[Comprobadores]] y [[Migraciones]].

## 7. Las vistas no llevan color propio

La identidad visual entera vive en `public/assets/css/telecab.css` y en la
configuración de Tailwind de `views/layout-gestion.ejs`. **Ninguna vista lleva
colores propios.**

- Los colores son **tokens CSS** en `:root` (`--tc-gold`, `--tc-card`, `--tc-red`…)
  escritos como canales RGB (`"244 150 60"`) para que Tailwind pueda aplicarles
  opacidad: `bg-telecab-gold/15`, `border-telecab-red/40`.
- Hay un tema por `data-theme` (oscuro, claro, azul, verde, púrpura, rosa, cian,
  naranja, contraste…). Cambiar de tema solo cambia las variables.
- **Los colores crudos de Tailwind están remapeados** a los tokens: `text-red-500`
  ES el rojo de la marca, `bg-emerald-500/15` ES el verde de la marca al 15 %. Una
  vista que use el color crudo sigue quedando dentro de la identidad.
- Tailwind viene por CDN y pinta sus utilidades **después** de la hoja propia, así
  que los ajustes de aspecto se escriben con especificidad subida: `body .clase`.
- El tema del perfil se inyecta desde el servidor **antes** de pintar, para que no
  haya parpadeo; el menú contraído se decide igual, antes del primer pintado.
- Las pantallas se montan sobre las piezas compartidas: `layout-gestion.ejs`,
  `dialogo.js`, `listado.js`, `fichaConductor.js` y el overlay de carga. Una
  pantalla que liste algo usa el componente Listado (lista → ficha → atrás), no
  una tabla nueva.
- **Y si el navegador trae una versión de algo —`prompt`, `alert`, `confirm`,
  `<input type="date">`—, la casa tiene la suya y es la que se usa.** El
  inventario entero, con qué usar en cada caso, está en [[Componentes de la casa]]:
  **léelo antes de escribir una pantalla**, y apúntalo ahí cuando hagas una pieza
  nueva.

## 8. Cómo se mueve un módulo sin romper nada

Uno cada vez, y cada uno en su commit:

1. `node scripts/inventario-rutas.js` — tiene que decir "exactamente las mismas".
2. Crear `modules/<Modulo>/` y **mover** los ficheros con `git mv`, para que el
   historial siga pegado a ellos.
3. `node -e "require('./modules/X/x.repo')"` — es el **primer** comando después de
   un `git mv`: un repositorio que se muda arrastra a sus hermanos por ruta
   relativa, y eso no lo dice el comprobador de capas.
4. Dejar reexportador en el sitio viejo, salvo que se pueda comprobar fichero a
   fichero que nadie apunta ahí.
5. Pasar los comprobadores.
6. Commit. Si algo sale mal, se revierte **un** módulo, no el refactor entero.

Y tres cosas que este proyecto ya aprendió moviendo módulos:

- **Una infracción de capas puede ser un error de diseño o un fichero mal
  clasificado.** Cuatro de las siete infracciones no se arreglaron:
  *desaparecieron* al ponerle a cada fichero el nombre de lo que hace. Conviene
  mirar cuál de las dos es antes de refactorizar.
- **El reparto en módulos es una hipótesis; lo que decide es de qué come cada
  ruta.** El nombre engaña: "Documentación" no era un módulo de documentos y
  `matching` no era de Selección. Y lo que cuelga de Google Sheets no se muda: se
  rehace cuando pase a PostgreSQL.
- **Un módulo que vivía sobre hojas no se muda, se rehace.** Mover ficheros es
  media hora; lo que cuesta es medir antes si PostgreSQL tiene TODO lo que el
  cálculo necesita.

## 9. La red de seguridad: lo que hay y lo que no

**No hay pruebas automáticas, ni linter, ni `npm scripts`.** `package.json` solo
tiene dependencias. La red de seguridad son los comprobadores de `scripts/`, que
no necesitan nada instalado: `node scripts/comprobar-*.js` y ya.

Dos consecuencias que son regla:

- **Un comprobador que grita en falso enseña a ignorarlo.** Todos están escritos
  para equivocarse *por defecto hacia no acusar*: ante la duda, se callan.
- **Una herramienta que deja de mirar no avisa de que ha dejado de mirar.** Cuatro
  de los siete comprobadores no miraban en `modules/`, así que cada módulo mudado
  salía del alcance de las reglas sin que nadie lo decidiera, y seguían diciendo
  "todo bien" con menos ficheros dentro. Al tocar la estructura de carpetas, hay
  que comprobar que los comprobadores siguen llegando.
- Cuando se arregla un comprobador, se **sabotea a propósito** para verificar que
  caza lo que dice cazar: se renombra a mano una función que se llama desde otro
  módulo, y tiene que salir.

## 10. Al escribir SQL y al escribir una consulta

- El SQL vive en el repositorio, entre **comillas invertidas**: es lo único que ve
  `comprobar-sql.js`.
- **Nunca se lee un `DATE` de PostgreSQL con `toISOString()`.** En Madrid devuelve
  el día anterior. Se usa `to_char(col, 'YYYY-MM-DD')`. Ver [[Trampas conocidas]].
- La cuenta de horas va por [[Jornada y turnos]] (05→05), no por día natural, y
  esas constantes salen de `services/nucleo.js`. No se hacen copias.
- El histórico sellado (`bitacora_horas`) **no se recalcula**: el pasado no se
  mueve porque alguien abra una pantalla.
- Los permisos se comprueban **al hacer la acción**, no solo al pintar la
  pantalla. *Esconder un botón no es una autorización: quien conozca la URL la
  llama igual.*

Ver también [[Base de datos]].

## Un formulario no se cierra solo

Los avisos y las confirmaciones se cierran haciendo clic en el fondo: no hay nada que perder. **Un formulario, no.** Ahí se teclean treinta campos —la ficha entera de una persona— y un clic despistado los tiraba todos sin preguntar.

`Dialogo.formulario` tiene una **X** en la cabecera, su botón de cancelar y responde a Escape: tres gestos deliberados. El fondo no cierra (`public/assets/js/dialogo.js`).

La misma idea por la que un sí/no se elige en una lista y no se teclea «true»: la pantalla no puede castigar a quien la usa por un descuido de un segundo.
