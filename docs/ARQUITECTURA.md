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
| **Conductores** | `plantilla`, `fichas`, `agenda`, `libranzas` |
| **Documentos** ✓ | `documentos` — **hecho** |
| **Vehiculos** ✓ | `vehiculos`, `taller` — **hecho, el módulo entero** |
| **Planificacion** | `tablero` (planificador), `cobertura`, `vacantes` **(?)** |
| **Control** | `control`, `alertas`, `callCenter`, `justificantes`, `flotaViva` **(?)** |
| **Operaciones** | `operaciones`, `sanciones`, `bitacora` |
| **RRHH** | `rrhh`, `nominas`, `convenio`, `peticiones`, `ticketera`, `pendientes` |
| **Seleccion** | `seleccion`, `ett`, `generador`, `matching`, `vacantes` **(?)** |
| **Informes** | `reportes`, `exportar`, `bi`, `visibilidad`, `resumen` |
| **Administracion** | `administracion`, `recaudacion` |
| **Usuarios** | `usuarios`, `auth` |
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

~~**Vehiculos**~~ (hecho) →
**Usuarios** → **Seleccion** → **Conductores** → **Planificacion** → **Control**
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
