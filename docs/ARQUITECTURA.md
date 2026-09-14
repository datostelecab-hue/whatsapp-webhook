# Arquitectura

Cómo está organizado el código, qué puede llamar a qué, y cómo se mueve una
pantalla de sitio sin romper nada.

Esto no es un ideal: los números de aquí salen de `node scripts/comprobar-capas.js`,
que lee el código de verdad. Cuando el código cambie, los números cambian.

---

## Las capas

```
Petición HTTP
     ↓
Controlador      routes/*.js              traduce HTTP ↔ dominio
     ↓
Servicio         services/*.js            las reglas del negocio
     ↓
Repositorio      services/repo/*.js       el SQL, y nada más
     ↓
Base de datos    PostgreSQL
```

Ejemplo, de arriba abajo:

```
POST /conductores/123/baja
     ↓
routes/conductores.js        lee el id y el motivo, llama a una función, devuelve JSON
     ↓
services/conductores.js      decide QUÉ es dar de baja: cerrar el periodo de empleo,
                             liberar su plaza del cuadrante, avisar a RRHH
     ↓
services/repo/conductores.js UPDATE conductor_periodo_empleo SET baja = …
     ↓
PostgreSQL
```

### Y dos cosas que NO son una capa

**El núcleo** (`services/nucleo.js`): constantes y funciones puras. Ni base de
datos, ni red, ni decisiones — nada que pueda fallar, nada que haya que simular
para probarlo. Las horas que parten la jornada (05→05), el normalizador de
nombres, el mapa de columnas de la agenda. Lo usa cualquier capa.

Nació al ordenar esto: de los diez repositorios que llamaban hacia arriba, cinco
no querían el servicio — querían una constante atrapada dentro de él. Y dos de
esas constantes estaban **duplicadas** en dos módulos distintos.

**Los adaptadores**

`services/whatsapp.js`, `drive.js`, `sheets.js`, `mapon.js`, `bolt.js`,
`correo.js`, `cripto.js`, `geocoding.js`, `excelEstilo.js`…

Hablan con el mundo de fuera o son herramienta pura. **No saben nada del
negocio**, y por eso los puede usar cualquiera, igual que `fs` o `path`. Son el
suelo, no un piso.

La distinción entre adaptador y servicio de dominio es la que hace que la regla
"un repositorio no llama a un servicio" sea aplicable: sin ella, `alertasControl` llamando a `whatsapp` daría
una infracción falsa y en dos semanas nadie miraría el comprobador. La lista
está escrita a mano en `scripts/comprobar-capas.js`; añadir uno es una decisión
que se ve en el commit, no algo que se adivina por el nombre.

Lo mismo con los **transversales** (`repo/actor`, `sesion`, `permisos`): quién
eres y qué puedes. Los usa todo el mundo y no cuentan como dominio.

---

## Las reglas

### El controlador no decide nada

Es la regla que importa. Un controlador hace tres cosas y ninguna más:

1. Sacar los datos de la petición (`req.params`, `req.query`, `req.body`).
2. Llamar a **una** función de dominio.
3. Convertir lo que devuelve —o el error— en una respuesta HTTP.

Lo que **no** puede hacer:

- Llevar SQL dentro, ni importar el pool de la base.
- Decidir reglas: si una baja cierra la asignación, eso no se sabe en una ruta.
- Encadenar tres módulos para conseguir algo. Eso es orquestar, y orquestar es
  negocio: vive en un servicio.

### La flecha va hacia abajo

Un repositorio puede llamar a otro repositorio y a los adaptadores. **No puede
llamar a un servicio de dominio.** Si lo hace, la capa de datos pasa a depender
de las reglas y ya no se puede leer ni probar una sin arrastrar la otra.

### El repositorio solo sabe de datos

SQL y mapeo de filas a objetos. Ni cálculos de negocio, ni decisiones. Hoy esto
se cumple a medias y es deuda conocida (ver más abajo).

---

## Dónde estamos hoy

Salida de `node scripts/comprobar-capas.js` a 14/09/2026:

| | |
|---|---|
| Controladores | 47 ficheros · 420 rutas · 6.894 líneas |
| Repositorios | 42 ficheros · 16.204 líneas |
| Servicios y adaptadores | 67 ficheros · 20.900 líneas |
| Vistas | 54 · 21.714 líneas |

**La buena noticia:** los controladores ya están casi limpios. De 420 rutas,
**solo una lleva SQL** y cuatro ficheros importan un pool de base. Eso no es lo
normal en un proyecto de este tamaño, y quiere decir que la Fase 1 no es
reescribir: es cerrar quince agujeros concretos y poner el comprobador a vigilar.

**Se empezó con 15 incumplimientos. Quedan 7.**

Cerrados:

| Qué | Cómo |
|---|---|
| 4 controladores importaban el pool | `migraciones` lo pide a su servicio; `control` y `flotaViva` ya no preparan el esquema a mano (lo aseguran los propios módulos con `db.conEsquema`) |
| `routes/tablero.js` llevaba la ÚNICA consulta SQL de las 420 rutas | se fue a `repo/vehiculos.estadosVehiculo()` |
| 5 repositorios llamaban hacia arriba por una constante | las constantes bajaron a `services/nucleo.js` |

Pendientes — estas son inversiones de verdad, no constantes:

| Repositorio | Llama a |
|---|---|
| `repo/campanas`, `repo/historicoControl` | `flotaViva/directo` |
| `repo/inicio` | `visibilidad` y `flotaViva/rutas` |
| `repo/reporteHoras` | `flotaViva/rutas` |
| `repo/conductores` | `cazamientoBolt` |
| `repo/compararAgenda` | `planificadorV2` |

Cuatro de los siete apuntan a `flotaViva/*`, que es un caso aparte: ese módulo
tiene **su propia base de datos** (`FLOTA_VIVA_DB_URL`) y se enganchó al ERP por
el lateral. Arreglarlos de uno en uno antes de decidir si ese módulo se integra
o se queda fuera sería trabajo tirado.

**Los 20 avisos** son manejadores largos (el peor: 105 líneas en
`GET /operaciones/auditoria/excel`) y rutas que orquestan tres o más módulos.
No son errores; son el mapa de dónde está la lógica que tiene que bajar a un
servicio.

### Lo que NO tenemos, y conviene decirlo

No hay pruebas automáticas, ni linter, ni `npm scripts`. La red de seguridad de
este refactor son cuatro comprobadores que no necesitan nada instalado:

```bash
node scripts/inventario-rutas.js     # las 420 URL siguen montadas donde estaban
node scripts/comprobar-capas.js      # nadie se ha saltado una capa
node scripts/comprobar-modulos.js    # todo carga y exporta lo que dice
node scripts/comprobar-vistas.js     # el JavaScript de las pantallas compila
```

`inventario-rutas.js` es el importante para mover ficheros: levanta la
aplicación de verdad, recorre el árbol de routers de Express y compara con
`scripts/rutas-base.json`. Si mover un módulo pierde una URL, sale ahí y no seis
semanas después cuando alguien pulse ese botón.

---

## Fase 2 — un módulo por negocio

El objetivo es pasar de agrupar por *qué tipo de fichero es* a agrupar por *de
qué habla*:

```
modules/
├── Conductores/
│   ├── conductores.controller.js
│   ├── conductores.service.js
│   ├── conductores.repo.js
│   └── vistas/
├── Vehiculos/
├── Planificacion/
└── …
```

Hoy, para tocar "conductores" hay que abrir `routes/plantilla.js`,
`routes/fichas.js`, `services/conductores.js`, `services/repo/conductores.js`,
`services/repo/ficha360.js`, `services/repo/alta.js` y `views/plantilla.ejs`:
siete carpetas distintas. Después, una.

### Hecho: Vehículos (entero, con Taller)

El primero, y con él se estrenó la mecánica. Está en `modules/Vehiculos/`
(con su `LEEME.md`). Lo que enseñó:

- **Mover la carpeta es lo de menos; lo que cambia es la puerta.** El
  planificador entraba directamente a `repo/vehiculos`. Ahora le pide
  `estadosVehiculo()` al servicio. Mientras otro módulo pueda meter la mano en
  el repositorio, el módulo no puede cambiar por dentro — y poder cambiar por
  dentro es lo único que se gana agrupando. Lo comprueba `comprobar-capas.js`.
- **A veces el servicio ya existe sin llamarse así.** `sincroMapon.js` orquestaba
  el adaptador de Mapon y el repositorio: era el servicio de Vehículos. No hubo
  que inventar una capa.
- **Las vistas caben.** `app.js` pasa a tener dos raíces (`views/` y la carpeta
  `vistas/` de cada módulo mudado) y `res.render('vehiculos')` no cambia ni una
  letra. Cuidado con dejar una copia vieja en `views/`: Express serviría esa.
- **Mover código destapa lo que estaba escondido.** El controlador de Taller
  elegía el generador del informe con `` require(`../services/taller${formato}`) ``.
  Esa dependencia no la veía ni un `grep` —`tallerPdf` y `tallerExcel` parecían
  código muerto— ni ninguna herramienta, y un require así se rompe en silencio
  justo al mover ficheros. Ahora está declarado.
- **Lo que NO se hizo, y a propósito:** `crear()` abre las 6 plazas y las
  vigencias, o sea negocio viviendo en el repositorio. La primera mudanza tenía
  que ser mecánica y revisable de un vistazo; mezclarla con una reescritura de
  reglas habría dado un cambio que ya no se puede revisar.

### El reparto propuesto

Las 47 rutas actuales, agrupadas. Lo marcado con **(?)** es discutible y hay que
decidirlo antes de mover nada.

| Módulo | Rutas que se lleva |
|---|---|
| **Conductores** ✓ | `plantilla` — **hecho**. `fichas`, `agenda` y `libranzas` NO: cuelgan de las hojas (ver abajo) |
| **Documentos** ✓ | `documentos` — **hecho** |
| **Vehiculos** ✓ | `vehiculos`, `taller` — **hecho, el módulo entero** |
| **Planificacion** | `tablero` (planificador), `cobertura`, `vacantes` **(?)** |
| **Control** | `control`, `alertas`, `callCenter`, `justificantes`, `flotaViva` **(?)** |
| **Operaciones** | `operaciones`, `sanciones`, `bitacora` |
| **RRHH** | `rrhh`, `convenio`, `peticiones`, `ticketera`, `pendientes` |
| **Nominas** ✓ | `nominas` — **hecho**, y de paso salió de Google Sheets |
| **Seleccion** ✓ | `seleccion`, `ett`, `generador`, `vacantes` — **hecho, el módulo entero** |
| **Informes** | `reportes`, `exportar`, `bi`, `visibilidad`, `resumen` |
| **Administracion** | `administracion`, `recaudacion` |
| **Usuarios** ✓ | `usuarios`, `auth` — **hecho** |
| **Fichaje** ✓ | `fichaje` — **hecho**, nació ya en `modules/` |
| **WhatsApp** | `botPuertas`, `notificaciones` |
| **Bolt** | `boltHoras` |
| **Soporte** | `soporte`, `ticketsTelecab` |
| **Configuracion** | `configuracion`, `migraciones`, `explorador`, `inicio` |
| **Boda** | `boda` (favor aparte, oculto, se queda como está) |

`Mapon` no aparece: no tiene pantalla, es un adaptador. `Vacaciones` de la lista
original cae dentro de **Conductores** (las ausencias son estado del conductor,
`conductor_estado_hist`), no da para módulo propio.

### Cómo se mueve un módulo sin romper nada

Uno cada vez, y cada uno en su commit:

1. `node scripts/inventario-rutas.js` — tiene que decir "exactamente las mismas".
2. Crear `modules/<Modulo>/` y **mover** los ficheros (`git mv`, para que el
   historial siga pegado a ellos).
3. Dejar en el sitio viejo un fichero de una línea que reexporta el nuevo:
   ```js
   module.exports = require('../modules/Conductores/conductores.repo');
   ```
   No es por elegancia: es para que una referencia que se me haya escapado siga
   funcionando en producción en vez de dar un 500. Los reexportadores se borran
   todos juntos al final, cuando ya no los apunte nadie
   (`node scripts/inventario-muerto.js` lo dice).
4. Pasar los cuatro comprobadores.
5. Commit. Si algo sale mal, se revierte UN módulo, no el refactor entero.

### El orden

Empezando por el más pequeño y aislado, para estrenar la mecánica donde el daño
posible es mínimo, y dejando para el final los que más gente toca:

~~**Vehiculos**~~ ~~**Documentos**~~ ~~**Usuarios**~~ ~~**Fichaje**~~ ~~**Nominas**~~
~~**Seleccion**~~ ~~**Conductores**~~ (hechos) → **Planificacion** → **Control**
→ el resto.

### Hecho: Documentos

**Sí es un módulo**, y de los importantes: es el archivo documental de la
empresa, la alternativa a tener los papeles en el ordenador de alguien. Lo que
NO era es lo que decía la primera versión de este reparto (ver abajo).

Está en `modules/Documentos/` (con su `LEEME.md`). Lo que tiene de propio:

- **Es genérico, no "del conductor".** El ámbito viaja como dato:
  `subir('vehiculo', 12, …)` y `subir('conductor', 83, …)` son la misma
  operación. Los dos ámbitos funcionan ya — la tabla tiene las dos columnas y el
  catálogo de tipos distingue ámbito —, así que el día que Vehículos quiera
  guardar una ficha técnica no hay que tocar nada.
- **El almacén también se cambia por dentro.** `ALMACEN` es un mapa de motores,
  hoy solo Drive. Si los bytes se mudan, ninguna pantalla se entera.
- **Se quitó la duplicación.** Plantilla y Selección tenían cada una su propia
  colección de rutas de documentos sobre el repositorio. Ahora las dos entran
  por la puerta del módulo.

### Lo que "Documentación" NO era (revisado el 14/09)

La primera versión de este reparto lo metió por el nombre, sin mirarlo:

- **No tiene pantalla.** No existe `views/documentos.ejs`. Sus 6 rutas son API
  y el OAuth de Google (`/auth`, `/auth/callback`).
- **`routes/documentos.js` no toca PostgreSQL.** Solo `services/drive`. Es
  fontanería del adaptador, y la usan también `rrhh`, `seleccion` y `soporte`.
- **El índice SÍ está en PG** (`repo/documentos`, tabla `documento`), pero lo
  consumen `plantilla` y `seleccion`, no `/documentos`.

Lo que se hizo: el módulo se queda con **el índice y la API genérica**, y
absorbe la fontanería de Drive (el OAuth vive ahí porque es de Drive, y Drive es
el almacén). Las tres rutas viejas que hablan con Drive a pelo se quedan
marcadas para borrar: ninguna vista las llama.

**Lo que falta no es arquitectura, son datos.** La tabla tiene 14 filas de 2
conductores (de 218), subidas el 3 y 4 de septiembre. Se notó en el caso de la
suspensión de BOLT del 12/09, donde no se pudo descartar una caducidad de
documentos porque ese conductor —como otros 216— no tiene ninguno cargado.

`flotaViva` no se mueve todavía: tiene base de datos propia y siete de los
quince incumplimientos. Primero se decide si se integra o se queda fuera; mover
de sitio algo que no se sabe si va a seguir existiendo es trabajo tirado.

### Hecho: Nóminas (y de paso, fuera de las hojas)

Está en `modules/Nominas/` (con su `LEEME.md`). Es el primero que no solo se
muda: **cambia de fuente de datos**.

Antes leía las horas de la hoja mensual del libro de horas, el DNI y la fecha de
alta de AGENDA_V2, y guardaba su configuración, su snapshot y sus meses cerrados
en tres hojas más. Encima tenía una ruta `/nominas/diagnostico` que preguntaba a
la API de BOLT en caliente — una pantalla que dependía de una API ajena, que es
justo lo que `scripts/comprobar-ingesta.js` persigue.

Ahora:

| Dato | De dónde sale |
|---|---|
| Horas, nocturnas, utilización | `fv_tramo` (la ingesta de BOLT) |
| Propinas, peajes, facturación | `v_ordenes_conductor`, sobre `bolt_order` |
| DNI, jornada, ETT, fecha de alta | `conductor` + `conductor_periodo_empleo` |
| Días justificados | `justificante`, solo las aprobadas (db/109) |
| Recorte por utilización mínima | el reparto viaje/espera de `fv_tramo` (db/110) |
| ETT o plantilla propia | `conductor_periodo_empleo.tipo` — la ETT no cobra MBO (db/111) |
| Config y meses congelados | `nomina_config`, `nomina_mes`, `nomina_fila` (db/108) |

Las **fórmulas no se han tocado**: `calcularFila` es la cadena del AppScript
original. Lo comprobado es que las horas coinciden con la bitácora sellada
(225 de 225 comparables en agosto de 2026) y que el dinero coincide con las
órdenes al céntimo.

Se cayeron seis rutas a propósito, y el inventario las señala:

- `POST /generar` y `GET /estado` existían porque bajar el mes de BOLT tardaba
  minutos: había que lanzarlo en segundo plano y sondear una barra de progreso.
  Calcular ahora tarda cuatro segundos, así que `GET /cargar` lo hace y contesta.
- `GET /congelada` se funde en `GET /cargar`, que devuelve lo congelado cuando
  existe.
- `POST /recalcular` es ahora `POST /calcular`, y además **no guarda la config**:
  sirve para ver qué saldría con otras tarifas antes de decidir.
- `GET /descargar` es `GET /nomina.xlsx` (con el punto, para que el navegador
  nombre bien la descarga).
- `GET /diagnostico` no se sustituye: perseguía descuadres entre la hoja y el
  panel de BOLT, y sin hoja de por medio no hay descuadre que perseguir.

**Lo que se aprendió, y sirve para los que faltan**: un módulo que vivía sobre
hojas no se muda, se rehace. Mover los ficheros es media hora; lo que cuesta es
medir primero si PostgreSQL tiene TODO lo que el cálculo necesita. Aquí se midió
antes de escribir una línea, y apareció el único hueco real: `bolt_state_log`
solo llega a septiembre, así que las nocturnas y la utilización no podían salir
de ahí — sí de `fv_tramo`, que cubre desde julio y distingue viaje de espera,
que es exactamente `has_order` y `waiting_orders`.

### Hecho: Selección (las cuatro pantallas)

Está en `modules/Seleccion/` (con su `LEEME.md`). Es el módulo más grande hasta ahora: 44
rutas, cuatro pantallas y 2.000 líneas de repositorio.

Se hizo **en dos commits** —primero Vacantes y el Generador, después Selección y ETT—
porque una pantalla que se rompe al mover es fácil de encontrar en un commit de dos
ficheros y muy difícil en uno de catorce.

**Lo que costó no fue mover ficheros.** Dentro de `modules/` el trinquete aprieta: un
controlador que habla con un repositorio pasa de aviso a FALTA. Así que las cuatro
pantallas necesitaban la capa de servicio que no tenían, y ahí es donde estaba metida la
lógica de negocio:

| Se sacó del controlador | A |
|---|---|
| Qué es una vacante viva, y cuántas plazas suma | `vacantes.service` |
| El catálogo de documentos que se le piden a un candidato | `seleccion.service` |
| El resumen del embudo | `seleccion.service` |
| Subir un documento y armar la ficha de alta en PDF con sus adjuntos | `seleccion.service` |
| Cómo se decide el nombre de la ETT, y en qué orden | `ett.service` |
| Las dos altas con su reserva de vacante, que puede fallar sin tumbar el alta | `ett.service` |

La deuda de controladores que hablan con repositorios baja de **18 a 14**, y los avisos de
55 a 47. Los 7 incumplimientos siguen siendo los 7 de siempre.

**Dos cosas que este módulo enseñó, y sirven para los que faltan:**

`matching` **no era de Selección** pese al nombre: solo usa el tablero del planificador. Es
de Planificación. Segunda vez que el nombre de una ruta engaña sobre a qué módulo pertenece
—la primera fue "Documentación"—, así que la regla es mirar de qué habla, no cómo se llama.

Un repositorio que se muda arrastra **sus hermanos**: `candidaturas.repo` requería por
ruta relativa a otros siete repos de `services/repo/`. Cinco se quedan fuera (van a
`../../services/repo/`) y dos entran con él. Eso no lo dice el checker de capas: lo dice
`node -e "require(…)"`, que es el primer comando que hay que correr después de un `git mv`.

**Y un falso positivo que se arregló de camino.** `comprobar-rutas.js` acusaba de "sin ruta"
a ocho URL que existen, porque las vistas las construyen concatenando —`'/api/ficha/' + id`—
y el comprobador recortaba la barra final hasta dejar `/api/ficha`, que no casa con
`/api/ficha/:id`. Ahora la barra final se lee como lo que significa: aquí viene un
parámetro. Al arreglarlo apareció un segundo fallo —la ruta `/` era principio de todo y daba
por buena cualquier URL— que se cazó con una prueba de sabotaje. Y queda apuntado en el
propio fichero hasta dónde llega la herramienta: el trozo que va *después* de una
concatenación (`… + id + '/enviado'`) no lo ve, y eso está comprobado.

### Hecho: Conductores (solo `plantilla`, y el motivo importa)

Está en `modules/Conductores/` (con su `LEEME.md`).

**El reparto de arriba decía cuatro rutas y solo se movió una.** `agenda`, `fichas` y
`libranzas` cuelgan las tres de `services/planificadorV2.js`, que lee de las hojas
`AGENDA_V2`, `PLANIFICADOR_V2` y `BASES`. Meterlas en un módulo sería meter Sheets dentro,
en la dirección contraria a la que va el proyecto. Se mudan cuando esa parte pase a
PostgreSQL, y hasta entonces están mejor donde están.

Es la tercera vez que el reparto propuesto no sobrevive al código —antes fueron
"Documentación" y `matching`—, así que conviene decirlo como regla: **el reparto del
documento es una hipótesis, y lo que decide es de qué come cada ruta.**

**Y CAYÓ LA PRIMERA INFRACCIÓN DE CAPAS**, de 7 a 6. `services/cazamientoBolt.js` entró al
módulo como `cazamiento.repo.js`, y con eso `conductores.repo` dejó de llamar "hacia arriba"
a un servicio: ahora llama al repositorio de al lado.

Al moverlo apareció otra, y el arreglo enseña dónde estaba el problema de verdad: el
cazamiento pedía el padrón de BOLT a `services/conductoresBolt.js`, que es un padrón **sobre
hojas** con la llamada a la API metida dentro. La llamada se mudó a `services/bolt.js` —el
adaptador, que es donde vive "cómo se le pregunta a BOLT"— y ahora los dos la usan de ahí.
Una función en el fichero equivocado estaba obligando a un repositorio a depender de Sheets.

La deuda de controladores que hablan con repositorios baja de 14 a 13, y los avisos de 47
a 43.
