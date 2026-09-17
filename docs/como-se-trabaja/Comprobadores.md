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

Contexto en [[ARQUITECTURA]] y en [[Reglas de la casa]].

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
- Que los **campos editables** declarados en `services/repo/conductores.js` existan
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
  o una vista, que nunca debe.
- **`inventario-muerto.js`** — qué ficheros ya no alcanza nadie. Es la lista que se
  usa para borrar de verdad al final de la Fase 2, así que un falso positivo ahí no
  es ruido: **es un despliegue roto**.
- **`comprobar-convenio.js`, `comprobar-cobertura.js`, `comprobar-directo.js`** —
  comprobaciones de dominio de sus módulos.

---

## Las dos averías que han tenido los propios comprobadores

Merecen quedarse escritas, porque explican cómo se lee la salida de todos ellos.

**1. Dejaron de mirar sin avisar.** Cuatro de los siete no miraban en `modules/`, y
la Fase 2 mueve código justo ahí: **cada módulo mudado salía del alcance de las
reglas sin que nadie lo decidiera**. Una herramienta que deja de mirar no avisa de
que ha dejado de mirar: sigue diciendo "todo bien", con menos ficheros dentro. Al
arreglarlo aparecieron dos ficheros llamando a BOLT/Mapon sin permiso, tres
huérfanos falsos y una cuenta que había bajado de 259 llamadas comprobadas a 117.

**2. Gritaron en falso.** Un comprobador que se equivoca enseña a ignorarlo, así
que cada falso positivo se arregló y se dejó anotado en el propio fichero: la coma
dentro de un comentario, el `\b` delante del alias, la URL escrita dentro de un
comentario de una vista, el punto de `/informe.xlsx`, la barra final de
`'/api/ficha/' + id`, la clave de permiso que parecía URL. **Si un comprobador te
acusa de algo que sabes que está bien, lee su cabecera antes de tocar el código.**

Después de arreglar uno, se **sabotea a propósito** para comprobar que sigue
cazando lo que dice cazar.
