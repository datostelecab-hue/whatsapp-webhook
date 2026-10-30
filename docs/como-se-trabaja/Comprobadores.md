---
tags:
  - telecab
  - como-se-trabaja
  - comprobadores
  - calidad
  - herramientas
---

# Comprobadores

En este proyecto **no hay pruebas automáticas, ni linter, ni `npm scripts`**. La
red de seguridad son los scripts de `scripts/comprobar-*.js`: no necesitan nada
instalado, se ejecutan con `node`, devuelven código de salida 1 cuando hay algo
que arreglar, y están escritos para **equivocarse por defecto hacia no acusar**.

Ninguno sustituye a probar contra la realidad. Todos documentan en su cabecera
hasta dónde llegan, porque *una herramienta que promete más de lo que da es peor
que una que avisa de dónde acaba*.

Contexto en [[Arquitectura]] y en [[Reglas de la casa]].

---

## Cuándo se pasan

| Momento | Qué se pasa |
|---|---|
| Antes de cualquier commit | `comprobar-modulos`, `comprobar-vistas` |
| Al mover ficheros o un módulo entero | `inventario-rutas` **primero**, después `comprobar-capas`, `comprobar-modulos`, `comprobar-vistas`, `comprobar-rutas`, `comprobar-ingesta` |
| Al tocar una vista o renombrar una URL | `comprobar-rutas`, `comprobar-vistas` |
| Al escribir SQL o una migración | `comprobar-sql`, `comprobar-migraciones` |
| Antes de desplegar | los seis, más `comprobar-ingesta` |

La tanda corta, de una sentada:

```bash
node scripts/comprobar-capas.js
node scripts/comprobar-rutas.js
node scripts/comprobar-vistas.js
node scripts/comprobar-modulos.js
node scripts/comprobar-sql.js
node scripts/comprobar-migraciones.js
```

---

## `comprobar-capas.js` — que el dibujo de la arquitectura sea verdad

**Qué revisa.** Lee `routes/`, `services/repo/` y `modules/*/` (controladores y
repos) y comprueba cuatro cosas concretas:

- SQL escrito dentro de un controlador (saltarse dos capas de golpe).
- El pool de la base importado desde un controlador (lo mismo, por la puerta de
  atrás).
- Manejadores largos (más de 25 líneas útiles) y rutas que orquestan tres o más
  módulos de dominio: es donde se esconde la lógica de negocio.
- Un repositorio llamando **hacia arriba** a un servicio de dominio, o a un
  controlador: la flecha al revés.
- Entrar al **repositorio de otro módulo** en vez de a su servicio.

No es un analizador sintáctico: quita comentarios y cadenas con expresiones
regulares y lee el resto. Por eso los `require()` dinámicos no los ve y se
declaran a mano.

**Modos.**

```bash
node scripts/comprobar-capas.js            # los incumplimientos
node scripts/comprobar-capas.js --todo     # además, la foto completa y de qué come cada controlador
node scripts/comprobar-capas.js --medir    # solo los números, sin juzgar
```

**Cómo se leen sus avisos.** La salida tiene cuatro bloques y no significan lo
mismo:

- **INCUMPLIMIENTOS** (`x`) — hay que arreglarlos. Tumban la comprobación (salida 1).
- **SE SALTAN LA CAPA DE SERVICIO** — deuda conocida de la Fase 2: controladores de
  `routes/` que hablan con un repositorio. Va **resumido a propósito**, porque
  listarlo cuarenta veces tapaba lo demás. Dentro de `modules/` esto mismo ya es
  incumplimiento: es *el trinquete*, la regla aprieta hacia adelante.
- **PARA MIRAR** — manejadores largos y rutas que orquestan. No son errores: son el
  mapa de dónde está la lógica que tiene que bajar a un servicio. **No tumban la
  comprobación.**
- **REEXPORTADORES** — las rutas viejas vivas a propósito. Se borran cuando
  `inventario-muerto.js` diga que no las apunta nadie.

**Lo que hay que saber antes de creerle.** Dos listas escritas a mano deciden qué
es cada fichero: `ADAPTADORES` (quién es "suelo" y no una capa) y `CAPA_DECLARADA`
(qué es de verdad cada fichero de `services/flotaViva/`). Si un fichero sale
acusado, la primera pregunta no es "cómo lo refactorizo" sino **"¿está bien
clasificado?"**: cuatro de las siete infracciones históricas desaparecieron solo
con ponerle a cada fichero el nombre de lo que hace.

---

## `comprobar-rutas.js` — toda URL que pide una vista existe como ruta

**Qué revisa.** Recorre los pares vista ↔ controlador declarados en su lista
`PARES`, saca del `.ejs` todas las cadenas literales que empiezan por el prefijo
del módulo (`/ett/api/…`) y comprueba que casan con algún `router.verbo('…')` del
controlador.

Caza **el fallo más tonto y más frecuente al portar una pantalla**: renombrar una
ruta y dejar la vista llamando a la vieja. No revienta al arrancar, no lo ve
ningún editor, y aparece cuando alguien pulsa ese botón concreto y recibe un 404
que nadie sabe explicar.

**Cuándo se pasa.** Siempre que se toque una vista, se renombre una URL o se mueva
un controlador. **Si se añade una pantalla nueva hay que añadirla a `PARES`**, o
no la mira nadie.

**Cómo se leen sus avisos.** Una línea por vista:

```
  ok modules/Seleccion/vistas/ett.ejs: 41 URL(s)
  x  modules/Control/vistas/alertas.ejs: 18 URL(s) — SIN RUTA: /alertas/api/anular
  ?  views/algo.ejs: falta el fichero, se salta
```

El `?` no es un fallo: es que el par apunta a un fichero que ya no está, y
conviene limpiarlo.

**Hasta dónde llega, y está comprobado.** Solo ve cadenas literales. De
`'/ett/api/solicitud/' + id + '/enviado'` solo lee `/ett/api/solicitud/`, porque
`/enviado` es otra cadena que no empieza por el prefijo: si alguien escribe
`/enviadoo`, esto no se entera. Lleva tres excepciones aprendidas a base de falsos
positivos, y todas siguen vivas en el código:

- Las **líneas que empiezan por `//`** se tiran: una vista explica en un comentario
  de qué permiso depende un botón, y eso es prosa, no una URL.
- El **punto cuenta como parte de la URL** (`/informe.xlsx`), porque hay rutas que
  lo llevan a propósito para que el navegador nombre bien la descarga.
- Una **URL que acaba en barra lleva algo detrás**: se trata como parámetro y la
  comparación va al revés (¿alguna ruta empieza por esto?). Probarlo del otro lado
  parecía equivalente y no lo era: la ruta `/` es principio de todo y daba por
  buena cualquier cosa.
- Una **clave de permiso no es una URL** aunque se escriba igual: los permisos del
  ERP *son* prefijos de ruta, y `permisos.includes('/alertas/config')` es una
  pregunta, no una petición.

---

## `comprobar-vistas.js` — el JavaScript de las pantallas compila

**Qué revisa.** Saca el contenido de cada `<script>` en línea de todos los `.ejs`
de `views/` y de `modules/*/vistas/`, sustituye las interpolaciones de EJS
(`<%= %>`, `<%- %>`) por un valor neutro y comprueba la sintaxis con `vm.Script`.

**Por qué existe.** `node --check` no sabe leer un `.ejs`: se atraganta con las
etiquetas `<% %>`. El JavaScript de las pantallas era **lo único del proyecto que
nadie comprobaba**, y un error de sintaxis ahí no avisa en ningún sitio: el
navegador deja de ejecutar el script **entero** y la pantalla se queda a medias,
cargando para siempre, sin un solo mensaje en el servidor.

**Cuándo se pasa.** Siempre que se toque un `.ejs`. Es de los dos que conviene
pasar antes de cualquier commit.

**Cómo se leen sus avisos.**

```
  x Control/callCenter.ejs (hacia la linea 412): Unexpected token '}'
```

El número de línea es el del fichero completo: ya suma dónde empieza el `<script>`.
Lo que comprueba es el código escrito a mano, que es donde está el error humano;
los scripts externos (`src=`) y los bloques con `type` raro (plantillas, JSON) se
saltan porque ya se comprueban solos.

---

## `comprobar-modulos.js` — todo carga y exporta lo que dice

Son **tres comprobaciones** en un fichero, y las tres cazan la misma familia de
avería: reorganizar código y dejar un nombre apuntando al vacío.

**1. Los repositorios cargan.** Hace `require()` de verdad de todos los
`services/repo/*.js` y `modules/*/*.repo.js`. `node --check` solo mira la
sintaxis: un `module.exports = { hacerAlgo }` con `hacerAlgo` ya no declarado
compila perfectamente y **revienta al cargar**, o sea al arrancar el servidor.
Cargar `repo/` es seguro porque el pool de `services/db.js` es **perezoso**: no
conecta hasta la primera consulta. Por eso no se requiere `services/` entero, que
levantaría clientes de Google y crones.

```
  x repo/horas.js: exporta "ventanaTurnos" como undefined
  x Control/alertas.repo.js: no carga — Cannot find module '../../services/repo/rechazos'
  x repo/vacio.js: no exporta nada
```

**2. Lo que una ruta llama, el servicio lo exporta.** Busca
`const exp = require('../services/explorador')` seguido de `exp.escribir(...)` y
comprueba que el destino exporta ese nombre. Compila, arranca, y revienta el día
que alguien pulsa ese botón.

```
  x routes/x.js: llama a exp.escribir() y services/explorador no lo exporta
```

**3. Las funciones de casa existen.** Dentro de cada fichero de `services/`,
`routes/`, `scripts/` y `modules/`, marca los nombres que solo aparecen como
llamada y no están declarados. Es el caso que más veces ha pasado: se sustituye un
bloque, se lleva por delante una función auxiliar de al lado, y revienta con un
mensaje que no dice de dónde viene ("aDiaMesAnio is not defined").

```
  x services/x.js: llama a aDiaMesAnio() y no está declarado en el fichero
```

**Cómo se leen sus avisos.** Los tres bloques terminan con su cuenta, y cualquiera
de los tres tumba la comprobación. **Si acusa a algo que sí existe, sospecha del
comprobador y mira su cabecera antes de tocar el código**: este script ya mintió
dos veces, y las dos están escritas dentro:

- Partía la lista de exportaciones por comas **antes** de quitar los comentarios, y
  una coma dentro de un comentario se llevaba por delante el nombre siguiente. Por
  eso `visibilidad` parecía no exportar `ventanaTurnos`, que exporta desde siempre.
- Usaba `\b` delante del alias, y entre un punto y una letra también hay frontera:
  `f.alta.split(…)` casaba con el alias `alta` y acusaba a `repo/alta` de no
  exportar `split`.

Las tres partes están escritas **a propósito estrechas**: un nombre solo se marca
si *todas* sus apariciones son llamadas, y lo que no se entiende con seguridad no
se marca. Prefiere el olvido al grito.

---

## `comprobar-sql.js` — el esquema, sin base de datos

**Qué revisa.** Lee los 137 `db/*.sql`, construye el mapa de tablas, columnas y
vistas, y luego contrasta contra él todo el SQL que encuentra en `db/*.sql`,
`services/repo/*.js`, `services/*.js` y `scripts/*.js`:

- `alias.columna` que no existe en esa tabla.
- Listas de columnas de un `INSERT INTO tabla (…)`. Era el hueco grande: un INSERT
  escribe veinte o treinta nombres de una sentada, sin alias delante.
- Columnas **sin cualificar** en consultas de una sola tabla y un solo SELECT
  (`SELECT codigo, etiqueta FROM cat_estado_conductor`). Así se descubrió un
  `es_fin_contratoo`.
- `CREATE OR REPLACE VIEW` que cambia el orden, quita o renombra una columna:
  PostgreSQL solo deja **añadir al final**, y lo rechaza con *"cannot change name
  of view column"*. El aviso incluye el remedio: poner un `DROP VIEW IF EXISTS`
  delante.
- Que el **mapa de vigencias** de `services/repo/vigencia.js` cuadre con las tablas
  de verdad. Ese fallo ya costó una pantalla vacía.
- Que los **campos editables** declarados en `modules/Conductores/conductores.repo.js` existan
  en la tabla `conductor`, **no sean columnas GENERADAS** (escribir en una es un
  error de PostgreSQL, y se descubre cuando alguien intenta guardar) y tengan
  etiqueta y grupo.

**Cuándo se pasa.** Siempre que se escriba una consulta o una migración. El error
que de verdad se comete es escribir `a.hasta` cuando esa tabla usa `baja`: no se ve
leyendo, no lo detecta ningún editor, y en PostgreSQL no aparece hasta que alguien
ejecuta esa consulta concreta, que puede ser semanas después.

**Cómo se leen sus avisos.** Acusa y **propone**:

```
  x repo/horas.js: a.hasta — "conductor_periodo_empleo" no tiene esa columna
      ¿querías decir baja, alta?
  x scripts/cargar-x.js: INSERT INTO conductor — no existe la columna "telefon"
  x campo editable "empleo_vigente": es una columna GENERADA, no se puede escribir
  · columnas sin declarar editables (a propósito o no): nss, observaciones
```

La línea con `·` **no es un error**: son columnas escribibles que nadie declaró
editables. No hay que arreglarlas, hay que mirarlas y decidir a conciencia.

**Hasta dónde llega.** Solo ve el SQL entre comillas invertidas (y cadenas simples
de una línea sin escapes) — por eso ahí se escribe. Los trozos interpolados
`${…}` se sustituyen por un hueco y no se comprueban: no es un error, es que no se
ven. Un alias ambiguo, un `SELECT *` o una vista que hereda columnas se dejan pasar
en vez de inventarse un error.

---

## `comprobar-migraciones.js` — cazar lo que PostgreSQL rechazaría

**Qué revisa.** No hay una base a mano para aplicar, así que hace análisis estático
**cruzando todos los ficheros de `db/` en orden** — el agujero estaba justo ahí: un
valor de la migración 48 contra una columna definida en la 45. Es **preciso a
propósito**: solo caza las clases de error que **ya han reventado**, y cualificadas
por tabla, no por nombre suelto:

1. Un valor de un `CHECK … IN` **más largo que el ancho final** de su columna
   (evaluado contra el último `ALTER` que la toca, no contra el primero).
2. Una función *set-returning* (`RETURNS TABLE`/`SETOF`) extraída como escalar con
   `(fn(...)).columna`. Es el patrón exacto que rompió la migración 46.
3. Un `ALTER COLUMN … TYPE` sobre una tabla de la que depende una **vista viva**,
   sin soltar la vista antes.
4. Una variable de plpgsql con el **mismo nombre** que una columna que la función
   asigna con `SET col = …` → *"column reference X is ambiguous"*. Es lo que rompió
   la 52 (variable `total` contra columna `total`).

Y, por fichero: `BEGIN`/`COMMIT` descuadrados, paréntesis descuadrados y
`$func$` sin cerrar.

**Cómo se leen sus avisos.**

```
  MAL  52-x.sql: calcular(): la variable "total" colisiona con la columna en SET total = ...
  MAL  46-y.sql: fn() extrae como escalar la set-returning otra(...).col -- ilegal
  MAL  61-z.sql: parentesis descuadrados (14 vs 13)
```

Cada `MAL` es un error que PostgreSQL rechazaría: se corrige **antes** de
desplegar. Cuando no hay ninguno dice cuántas migraciones revisó y repite su propio
límite:

> No sustituye a aplicar contra Postgres: coge lo que se repite, no todo.

Ver [[Migraciones]] y [[Base de datos]].

---

## Los otros de la familia

No son de los seis, pero forman parte de la misma red:

- **`inventario-rutas.js`** — el importante para mover ficheros. Levanta la
  aplicación **de verdad**, recorre el árbol de routers de Express y compara con
  `scripts/rutas-base.json`. Si mover un módulo pierde una URL, sale ahí y no seis
  semanas después cuando alguien pulse ese botón. Es el **primer** comando de una
  mudanza y el último.
- **`comprobar-ingesta.js`** — nadie llama a [[BOLT]] o a [[Mapon]] por su cuenta
  sin apuntar el motivo. Su lista `PERMITIDOS` solo puede encoger, y avisa también
  de los permisos que ya no hacen falta. Marca con `X` mayúscula lo que es una ruta
  o una vista, que nunca debe. **Importar una regla pura de `services/mapon.js` no es
  llamar** (`PURAS`, 01/10/2026): `const { elegirEquipo } = require('../mapon')` no
  habla con la API, y el motor del mapa y el repositorio de Vehículos salían como
  infracción solo por eso. Se saboteó con tres ficheros: solo la regla pura pasa; la
  regla más una llamada, o el módulo entero, saltan. El 23/10/2026 la lista creció por
  primera vez, a conciencia: la auditoría de [[Combustible]] pide el aforador y las
  paradas de un coche alrededor de su repostaje (el motivo, en la propia lista).
- **`inventario-muerto.js`** — qué ficheros ya no alcanza nadie. Es la lista que se
  usa para borrar de verdad al final de la Fase 2, así que un falso positivo ahí no
  es ruido: **es un despliegue roto**.
- **`inventario-exports.js`** — un escalón más abajo: funciones exportadas que no llama
  nadie de fuera. Lo que se decide dejar sin uso va a su lista `A_PROPOSITO`, **con el
  porqué**, y deja de salir como muerto; si un día alguien lo usa o desaparece, la
  salida dice que sobra en la lista. Los exports que empiezan por `_` son **ganchos de
  prueba** (`_situarAlta: situarAlta`) y se listan aparte. El 01/10/2026 quedó en
  **cero** sin uso: de 30, 15 quitados, uno enchufado (`JORNADAS`, que ahora pinta la
  ficha de Plantilla), 7 a propósito y 8 ganchos de prueba.
- **`comprobar-convenio.js`, `comprobar-cobertura.js`, `comprobar-directo.js`,
  `comprobar-reparto-turnos.js`** — comprobaciones de dominio de sus módulos. La última
  (06/10/2026) guarda de quién es cada hora: día 00→24, noche 12→12, NN por su hora de
  inicio, sin contar nada dos veces.
- **`comprobar-jornada-semanal.js`** (07/10/2026) — las reglas del informe semanal de
  Control: la J suma a BOLT solo aprobada, la baja médica deja su B y no suma, lo que cae
  fuera del contrato no cuenta, la semana abierta dice «En curso» y el orden va de menor
  a mayor.
- **`comprobar-whatsapp-chat.js`** (07/10/2026) — el chat de WhatsApp sin base ni Meta:
  qué es cada mensaje que entra o sale, la ventana de 24 h, la pausa del bot (los botones
  pasan siempre) y que cada envío de `services/whatsapp.js` quede apuntado con su origen,
  también el rechazado por Meta.
- **`comprobar-visibilidad-tendencia.js`** (25/10/2026) — las reglas de los gráficos
  largos de [[Visibilidad]], sin base: qué vale cada día (la foto del núcleo si tiene
  horas y, si no, el histórico de BOLT de db/217; sin ninguna, el día no está), el
  rango que se pide (topes, fechas que no lo son, lo que pasa de hoy), los cubos por
  semana (de lunes a domingo, la del cambio de hora con sus 7 días, la de fin de año
  entera) y por mes, hoy fuera de las medias, la proyección de cierre, el mes contra el
  anterior a la misma altura y el crecimiento mes a mes. Desde la revisión del mismo
  día, también: el periodo anterior con la longitud de los días cerrados (con semanas
  idénticas no cambia nada), el ritmo de la meta ponderado por días, el mes cerrado
  comparado entero y el mes sin datos, `agrupar=constructor` y compañía como 400, «Todo»
  recortado al tope y los días del núcleo sin foto que rellena el rango (7 como mucho).
  No mira el SQL ni la pantalla.
- **`comprobar-barcelona.js`** (07/10/2026) — Barcelona sin base: el tablero del
  planificador, lo que se comprueba al asignar, de los apuntes de BOLT a los ratos de
  trabajo (desempate, tope, el apunte de antes de la ventana) y el reporte de horas (día
  00→24, noche 12→12, «No salió», sin plaza, otro coche, fuera de su turno, el Excel).
- **`comprobar-contrato-candidatura.js`** (13/10/2026) — la candidatura y el
  contrato no dicen cosas distintas: si una edición cambia el tipo de contrato
  (ETT o propia) y la ficha tiene abierto otro, se pregunta en vez de guardar; con
  «corregir», se corrige también el contrato si es de hasta 30 días. Quien ya pasó
  a propia, un cambio que no cambia el tipo o alguien aún sin contrato se guardan
  sin preguntar.
- **`comprobar-alta-rapida.js`** (14/10/2026) — el «Alta rápida» de /ett no da de alta
  sin jornada (día o noche) ni contrato (40, 32 o 20 h), y lo dice antes de crear nada. La
  jornada llega a la ficha y a la candidatura; con vacante sale de ella si no se marca, y
  si no coincide no se da el alta. Quien vuelve también recibe su turno.
- **`comprobar-correo-pruebas.js`** (19/10/2026) — en modo pruebas el correo no le llega a
  nadie de verdad: con SMTP y `CORREO_PRUEBAS_A` sale desviado a esa única dirección (con
  `[PRUEBAS]` y a quién habría ido), también el que va «como» un usuario; dos direcciones
  o sin contraseña, al buzón falso; un buzón falso que no es de este PC, o nada, se frena.
- **`comprobar-nomina.js`**, desde el 20/10/2026 también: una J aprobada en un día de
  vacaciones, permiso o baja no suma (manda la marca, como en la bitácora), se avisa y
  «Cómo sale su total» dice cuál no ha contado.
- **`comprobar-portal.js`** (19/10/2026) — el portal de conductores, con dobles: el DNI se
  limpia; a quien no está, no tiene email o no tiene contrato se le contesta lo mismo; tres
  códigos cada 15 minutos y solo vale el último; el código no se guarda en claro, sirve una
  vez, caduca a los 10 minutos y se anula al quinto fallo; la sesión guarda la huella del
  testigo y deja de valer al salir; y por el dominio del ERP el portal deja pasar. Y el
  dinero del mes: el objetivo es el umbral del FAS de la nómina (40 h → 4.750, 32 h → 3.750,
  las demás el de 40 h), por día natural del 1 a hoy y el mes pasado entero, a mes vencido;
  la ETT sin objetivo pero con propinas y peajes. Y el efectivo: desde junio (lo de antes,
  saldo de partida), sin anulados, en orden de fecha, sin observaciones ni quién ni billetes,
  con lo que llegaba de la quincena anterior, y cobrado − entregado + lo dado = el pendiente.
- **`comprobar-puntuacion-semanal.js`** (19/10/2026) — la puntuación de cada semana del
  portal de conductores: las semanas van de lunes a domingo desde el 01/09/2026 (la primera,
  la del 31/08, cuenta desde el martes 01/09), solo se sellan las cerradas que faltan, lo
  sellado no se pisa (ON CONFLICT DO NOTHING), una semana sin nadie se reintenta, y sin el
  promedio de la casa no se sella. Y la letra del mes no cambia por esto.
- **`comprobar-vacaciones-saldo.js`** (14/10/2026) — el saldo de vacaciones: 0,0821 por día
  natural desde el alta o el 01/01/2026 (lo de 2025 no cuenta, ni sus vacaciones ni sus festivos), sin suspensiones (la baja médica sí genera);
  vacaciones que cruzan hoy, de antes del alta y programadas; ningún permiso resta
  (desde el 29/10/2026 los asuntos propios tienen su banco aparte: 2 al año, sin prorratear, acumulados); un festivo suma con MÁS de 6 h (6 justas no), «sin datos» antes de junio de 2025
  y «calculándose» si el sistema aún no tiene sus horas. Y el cálculo de las horas de los
  festivos, con dobles.
- **`comprobar-vacaciones.js`** (09/10/2026) — las vacaciones las aprueba una sola
  persona: las siete puertas (aplicar, cerrar y mover un ticket de vacaciones; cambiar
  la situación, añadir, corregir y borrar un tramo en Plantilla) se cierran sin la llave
  `/vacaciones/aprobar`, también al superadmin, sin escribir nada. Bajas, permisos, la
  vuelta al trabajo y poner un ticket «en curso» siguen abiertos. Ningún rol recibe la
  llave al crearse. Desde el 13/10, también: un ticket de vacaciones o de baja no se
  puede dejar en «Aprobado» (se aplica), y uno de nómina sí.
- **`comprobar-largos.js`** (09/10/2026) — lo que no cabe en su columna se dice antes de
  guardar, con el nombre de la casilla, sin abrir la transacción: la ficha de la persona
  (un piso «Entreplanta») y el proceso de Selección (el tipo de carné).
- **`comprobar-estado-coche.js`** (08/10/2026) — el estado del coche y su historial van
  juntos: ensaya `planificador.repo.guardar` con una transacción de mentira (cambiar el
  estado abre historial, el mismo estado no, la zona con el suyo) y falla si algún
  fichero de `modules/`, `services/` o `routes/` escribe `estado_operativo` sin
  `reemplazar('estadoVehiculo'`. Contra el código anterior al arreglo, fallan 5 de 8.
- **`comprobar-citas-taller.js`** (08/10/2026) — las [[Citas del taller]] sin base ni
  Meta: cómo se lee el Excel (fechas y horas de Excel o escritas, la fila mala con su
  número), qué no se cita y por qué (Barcelona, fuera del sistema, de baja), el turno
  que tiene el coche a esa hora, que el mensaje para copiar sea la plantilla rellena,
  la importación (nuevas, otra hora, iguales, pasadas, las que ya no vienen), el aviso,
  los botones «Confirmo» / «No puedo ir», las llamadas de Control y dónde las clasifica
  el Call Center.
- **`comprobar-incorporaciones.js`** (15/10/2026) — las [[Proximas incorporaciones]]
  sin base: quién es NUEVO (primer día con plaza, la re-alta, el «Sin plaza») y quién
  no (de la ETT a propia, quien ya cubrió, quien tenía plaza de antes, de baja); quién
  vuelve de VACACIONES (aunque librara después, sin plaza, con otra ausencia detrás);
  una vez por persona y por fecha; la llamada (lo que pide nota) y que el Call Center
  la clasifique como confirmación de turno. 25 casos.
- **`comprobar-videos-whatsapp.js`** (15/10/2026) — el envío de vídeos por WhatsApp
  sin base ni Meta: el catálogo (el fichero existe y cabe en 16 MB, sin «fichar»), el
  enlace solo https, cómo se apunta en el chat, que con la ventana cerrada o sin
  conversación no sale, y que con ella abierta sale con el 34, el enlace, su texto y
  firmado por la oficina. 12 casos.
- **`comprobar-historico-pdf.js`** (15/10/2026) — el [[Informe de salidas]] en PDF sin
  base: en qué grupo cae cada uno (salió aunque tuviera «No saldrá», avisó, sin avisar,
  aún no le tocaba), quién va en cada turno (TodoTurno en los dos), los coches sin
  conductor (también la celda sin nombre con alguien del plan en el coche), las llamadas
  y las alertas del turno, la frase, y que el PDF sale con emojis, flechas, textos
  largos, muchas páginas o un día vacío. También que el día que libra el fijo de un
  [[Coches sin correturnos|coche sin correturnos]] no es «sin conductor». 25 casos.
- **`comprobar-promedio-horas.js`** (15/10/2026) — el [[Promedio de horas]] de la casa
  sobre una rejilla inventada: la J aprobada suma y la pendiente no, libranzas y
  vacaciones fuera, la ausencia a 0, días sin plaza y suspensiones fuera, antes del alta
  solo si trabajó, hoy no cuenta, y los periodos con «desde» y «hasta». 11 casos.
- **`comprobar-combustible-excel.js`** (23/10/2026) — el Excel de Petroprix de [[Combustible]] (db/215), sin base, sin
  Mapon y sin el Excel de verdad: la cabecera exacta (y que otro Excel no se importa), la fecha con segundos, la
  coma decimal, las filas raras con su porqué, la clave contra duplicados (importar dos veces = 0 nuevas; uno que
  se solapa solo trae lo nuevo), el cambio de hora (con salto en el fichero y sin él), los avisos; los 30 textos
  exactos de la celda «Gasolinera» —con «CantueÃ±a», «Leganes 2 » y «C Plasencia»— contra las claves que
  trae db/215, **leídas del propio fichero de la migración** (si alguien cambia `textoExacto`, sale); que «Getafe
  2» no es «Getafe»; BOLT y el bot (la misma, distinta, solo el bot, solo BOLT, nadie); la parada de una fila del
  Excel (la que acabó 127 s antes sí, la que empieza 46 s después no); y la memoria y los grupos con que la
  auditoría pregunta a Mapon (lo recortado es igual que lo pedido). Desde la revisión del 23/10/2026, también:
  un turno del bot ya cerrado no es «distinto» de BOLT, Barcelona sin turno en el bot no se compara, una fila
  del futuro no entra, la misma fila con la hora corrida (una hora o un segundo) ya estaba, y un Excel de más
  de 20.000 filas o un zip que dice descomprimir a 4 GB no se abren. 48 casos.
- **`comprobar-combustible.js`** (22/10/2026) — los repostajes que llegan por correo
  ([[Combustible]]) sin base, sin buzón y sin BOLT, con nombres inventados: el lector de
  Ballenoil con los tres correos de ejemplo (PRAT con el «devuelto» de punto decimal,
  COSLADA sin él, MONTMELÓ de tarjeta provisional) y uno reenviado desde Outlook; números
  con coma o punto, el correo sin saltos de línea, lo que falta o no se entiende («no se
  pudo leer», con el motivo); de quién es cada correo (los demás no se tocan; Petroprix,
  preparado); de quién es la tarjeta y si coincide con BOLT; que el buzón se abre con
  EXAMINE sin marcar, mover ni borrar nada (con un IMAP falso); y la pasada entera: no
  duplica, el repetido, el correo que revienta, la contraseña que no vale, sin db/212, dos
  a la vez y el modo pruebas. Se saboteó abriendo el buzón sin `readOnly` y haciendo
  obligatorio el «devuelto»: los dos saltan. Tras la revisión del mismo día, además: el
  correo entero en una línea con la frase y el pie, los valores que la base no aceptaría
  (litros diminutos, km imposibles; 0 litros y 0 € sí), la fecha sin hora, `<br style>`,
  los correos de Ballenoil que no son repostajes, la firma DKIM (con un correo firmado
  ahí mismo y la línea partida como la parte sendmail, sin DNS), el correo que no se
  puede bajar, el oyente de `'error'` de imapflow, el tope, INBOX y Spam, la red cuando
  la base rechaza un correo, la contraseña que el cron no reintenta, la pasada colgada,
  volver a casar el coche y la sede, y el día que no existe en la lista. 88 casos. Se
  saboteó quitando el oyente, la red, el asunto obligatorio y el corte de la estación:
  saltan los cuatro. **Y la auditoría con Mapon** (23/10/2026), con la lista de
  gasolineras de verdad (las 143 de db/213, leídas del fichero) y un Mapon de mentira
  que apunta lo que se toca: los nombres de los correos reales (COSLADA es el I, el
  número manda, los dos apóstrofos, «BARCELONA» duda y no casa, la sede desempata, lo
  puesto a mano), la distancia, los umbrales en el borde (699/700/1.599/1.600 y
  34,9/35/64,9/65), el peor de los dos, el salto con lecturas de mentira (la aguja del
  Ioniq, sin parada, sin lecturas de después, la lectura vacía que no es un 0), el
  techo y su corrección (con km, con el gastado, el coche que aparca al poco), el
  mínimo que no se pinta, los Ford en %, sin aforador, sin Mapon, Mapon que falla a
  media auditoría o está caído (sin gastar intentos), las paradas partidas a
  medianoche, corregir y quitar la gasolinera a mano, la lista sin repetidos y con los
  no leídos aparte, y que a Mapon **solo se le pregunta**. 163 casos. Se saboteó el
  `<` de los umbrales, la espera de la aguja, el número de la gasolinera, el mínimo del
  techo, el punto de Mapon sin límite de tiempo, los repetidos en la lista y la
  ventana de los km: saltan los siete.

  Tras la revisión del 23/10/2026, **185 casos**: los subnombres que señalan a otra
  gasolinera («ALCORCON - EL CANO», «MATARO PARK», «MOSTOLES - AIDATER II»…: ambiguo,
  nunca la I) y los que tienen que seguir casando (Clot, El Prat, Cornellà II), la ida y
  vuelta de los 143 nombres de la lista, el borde con la cifra redondeada (34,96 % y
  699,6 m, amarillos), el mínimo que no da verde (13,6 % sin color, 70 % rojo), el techo
  con lecturas rotas (255, 65535, −3), la parada que no cubre la hora (el n.º 16: ya iba
  andando; relojes distintos: seguía a 30 m), el cambio de hora del 25/10/2026, el
  reintento que no borra el GPS ni la boya (el n.º 20 con las paradas caídas) y el
  repostaje que revienta y se apunta el intento. El doble de la base guarda ya todas
  las columnas, como el repo de verdad. Se saboteó cada una de las diez reglas nuevas:
  saltan las diez.

  Con la boya que solo cuenta lo que falta y la revisión del Excel (23/10/2026), **200
  casos**: el déficit en sus bordes (subir lo pagado o más es 0; 34,9/35/64,9/65 %),
  el % y los litros que no se contradicen (46 L de 46,04 son un 0,1 % y «faltan
  0,04 L»), el par en la misma parada contra la suma, y las paradas que no son de
  verdad: la de 24 h con el aforador moviéndose (el 9521MMX: GPS sin color y la boya
  sin parada), la de 5,8 h lejos sin lecturas y con 12 L más al arrancar (el
  0454MMZ), y las que sí valen (aparcado de verdad con el depósito quieto, una larga
  en la misma gasolinera, la de 2 h tras la que el depósito no sube, la larga «de al
  lado» de un coche que luego fue a repostar); y en el Excel, la parada de antes a
  1,5 km con el coche a 10 m de la gasolinera a esa hora (vale lo más cerca, nunca
  acusa más que la parada); y que la consulta de la auditoría no pide a secas columnas
  de db/215 (vale antes de aplicarla). Se saboteó cada regla nueva de los dos
  comprobadores (el aforador dentro de la parada, el depósito que sube en ella, la
  parada de antes lejos, los litros que nunca dicen 0, `to_jsonb`, el bot ya cerrado,
  Barcelona, la fecha del futuro, la hora corrida y los dos topes del Excel): saltan
  las once.
  **Y la boya con la ventana fija** (23/10/2026, db/216): el nivel a T − 15 y a T + 30
  con lecturas de mentira (la mediana de sus 10 minutos, la más cercana si son pocas),
  el de la captura (el 1212MJY: 9 L hasta las 17:44, 41 a las 17:45 y 39-40 después;
  con la regla de antes no subía, ahora verde y nunca rojo, también cuando baja del
  techo), el coche que anda entre medias (se suman sus km), el apagado sin lecturas
  cerca, el aforador que solo lee al cambiar, el techo, los Ford, «aún no
  hay lecturas de después» y «aún no son las T + 30», los vecinos entre las dos
  lecturas, y «solo la boya» (db/216: ni paradas ni posiciones a Mapon, el GPS de
  antes se queda y la marca sigue mientras quede a medias). Se saboteó con la ventana
  a 5 minutos y sin sumar lo gastado: saltan 11.
  **Y su revisión** (23/10/2026, tarde): aparcado 13 h antes y casi 20 h después de
  repostar (el 1210MJY y el 0524MMZ: se miden en toda la serie), sin lecturas de antes
  (no se reintenta, y queda hecha), la aguja que sube al despertar después de T + 30
  (16 → 39: vale lo de pasados 5 minutos) y la que no sube (el baile, que no se
  toca), el techo por km aunque haya centralita (la centralita, solo sin km y con
  lecturas a pocos minutos), la boya de la regla de antes que un reintento no
  devuelve, que el detalle va siempre con la versión 3 y que db/216 mira la versión y
  no la marca, el aviso de cuando la cifra la deciden los km (y que con 0,1 L no
  salta), y que el dibujo solo guarda de T − 60 a T + 90. Se saboteó cada una (el
  tope de 12 h, sin la aguja, la aguja siempre, la centralita mandando, el antes que
  se reintenta, restaurar la boya vieja, db/216 con la marca, sin el aviso, el aviso
  sin su mínimo y el dibujo con todo el tramo): salta su caso en las diez.
  **Y las malas lecturas de Mapon** (26/10/2026, db/218): la parada abierta lejos con
  el aforador moviéndose hasta la hora (el 0626MMZ: sin color, sin inventarse un
  final), abierta y sin lecturas (aparcado: rojo) y abierta o cerrada en el surtidor
  (no se mira por dentro); la parada desmentida por la ruta que arranca lejos y por
  un punto de dentro (los dos, al punto), el aparcado de verdad (rojo), el punto de
  más de 5 minutos y el que acusa más (se queda la parada); la hora repetida probada
  en las dos (cuadra la primera: se audita con ella, se corrige la hora, y la segunda
  auditoría no lo vuelve a probar) y lejos en las dos (roja, la segunda); que al
  juntar trozos se quede la ruta del último, y que la memoria no dé una ruta que
  empieza fuera de lo pedido. Se saboteó cada regla (la abierta sin mirar, por dentro
  también en el surtidor, sin desmentir, el punto que acusa más o de cualquier hora,
  solo el salto, sin probar las dos, probar siempre, la ruta del primer trozo y la
  memoria sin recortar): saltan las diez.
- **`comprobar-cumpleanos.js`** (15/10/2026) — los [[Cumpleanos]] sin base: los del 29 de
  febrero el 28 en un año no bisiesto, quien cumple ve la felicitación y no «cumple hoy»,
  y los ids que Control pinta en azul. 6 casos.
- **`comprobar-sanciones.js`** (22/10/2026) — quién llevaba el coche cuando dos tramos de
  `fv_tramo` empiezan en el mismo segundo ([[Sanciones de velocidad]]). **El primero que
  necesita base**: un `ORDER BY` no se comprueba con una base fingida. Va contra la del
  [[Entorno de pruebas local]] (la dirección está escrita en el script y exige la marca
  `entorno_local`), con un coche y una conductora inventados, y **todo dentro de una
  transacción que se deshace**: la copia queda como estaba. Sin el entorno arrancado, lo
  dice y sale con 1. Seis empates (espera de 0 s → descanso, metido en los dos órdenes;
  → desconectado; una cadena de cuatro; el exceso después de los dos; el tramo abierto),
  `quienConducia`, `procesar` de punta a punta con un aviso de Mapon de mentira por caso
  (modo pruebas: si intenta mandar un WhatsApp, falla), y los «coches rodando sin nadie»
  de Control (`rutas.kmSinDuenio`). 21 casos. Se saboteó quitando el desempate, y
  dejándolo solo por `id DESC`: saltan 3 en los dos casos.
  **Cinco minutos entre avisos** (29/10/2026): un conductor inventado con teléfono, en
  modo real con un WhatsApp de mentira que solo apunta; excesos a las 10:00, 10:03,
  10:04:59, 10:05:30 y 10:30, tres pasadas y una alerta que llega tarde (10:28). Los de
  menos de 5 min van con su aviso, el aparte espera si el último WhatsApp salió hace
  menos de 5 min, y salen tres WhatsApps. 8 casos más (29). Saboteado con
  `SEPARACION_SEG = 0`: falla.
- **`comprobar-menos-j.js`** (30/10/2026) — la −J y la auditoría de las J ([[Menos J]]), contra
  la base del [[Entorno de pruebas local]] y dentro de una transacción que se deshace, con dos
  personas de la copia: poner (lo que se rechaza y lo que guarda), la pestaña de /justificantes,
  aprobar y rechazar, la −J que nace de una J «Por compañero», los CHECK, la Bitácora (sale al
  momento y no toca horas) y el libro de auditoría (cada paso con quién y pantalla, editar una J
  aprobada la devuelve a pendiente, anular pide el porqué, un cambio a mano sin firmar se apunta,
  el libro no se cambia ni se borra). 42 casos. Saboteado quitando el aviso de caché de `poner`: falla.

---

## Las dos averías que han tenido los propios comprobadores

Merecen quedarse escritas, porque explican cómo se lee la salida de todos ellos.

**1. Dejaron de mirar sin avisar.** Cuatro de los siete no miraban en `modules/`, y
la Fase 2 mueve código justo ahí: **cada módulo mudado salía del alcance de las
reglas sin que nadie lo decidiera**. Una herramienta que deja de mirar no avisa de
que ha dejado de mirar: sigue diciendo "todo bien", con menos ficheros dentro. Al
arreglarlo aparecieron dos ficheros llamando a BOLT/Mapon sin permiso, tres
huérfanos falsos y una cuenta que había bajado de 259 llamadas comprobadas a 117.

**1 bis. Las pruebas también se quedan atrás** (encontrado el 01/10/2026 al buscar
huérfanos). `probar-jornada`, `probar-registro` y `probar-variables` pedían un
fichero que se mudó el 15/09 y no arrancaban; `probar-bolt` interceptaba la base del
puente y no la del código de verdad; `comprobar-directo` daba cinco fallos desde el
11/09 porque sus ventanas de turno no traían `reclamable`. Ninguno era un fallo del
código: eran pruebas que nadie volvió a pasar después de cambiarlo. **Al mover un
fichero o cambiar una regla, se pasan también las pruebas que lo tocan**, no solo
los seis comprobadores.

**2. Gritaron en falso.** Un comprobador que se equivoca enseña a ignorarlo, así
que cada falso positivo se arregló y se dejó anotado en el propio fichero: la coma
dentro de un comentario, el `\b` delante del alias, la URL escrita dentro de un
comentario de una vista, el punto de `/informe.xlsx`, la barra final de
`'/api/ficha/' + id`, la clave de permiso que parecía URL. **Si un comprobador te
acusa de algo que sabes que está bien, lee su cabecera antes de tocar el código.**

Después de arreglar uno, se **sabotea a propósito** para comprobar que sigue
cazando lo que dice cazar.
