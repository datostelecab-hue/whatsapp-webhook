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

### Y una quinta cosa que NO es una capa: los adaptadores

`services/whatsapp.js`, `drive.js`, `sheets.js`, `mapon.js`, `bolt.js`,
`correo.js`, `cripto.js`, `geocoding.js`, `excelEstilo.js`…

Hablan con el mundo de fuera o son herramienta pura. **No saben nada del
negocio**, y por eso los puede usar cualquiera, igual que `fs` o `path`. Son el
suelo, no un piso.

Esta distinción es la que hace que la regla "un repositorio no llama a un
servicio" sea aplicable: sin ella, `alertasControl` llamando a `whatsapp` daría
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

**Los 15 incumplimientos reales:**

| Qué | Dónde |
|---|---|
| Importan el pool de la base | `routes/control.js`, `routes/flotaViva.js`, `routes/migraciones.js`, `routes/tablero.js` |
| Llevan SQL dentro | `routes/tablero.js` |
| Repositorio llamando hacia arriba | `repo/agenda`, `repo/bitacora`, `repo/campanas`, `repo/compararAgenda`, `repo/conductores`, `repo/historicoControl`, `repo/inicio` (×2), `repo/justificantes`, `repo/reporteHoras` |

Los de `flotaViva/*` son un caso aparte: ese módulo tiene **su propia base de
datos** (`FLOTA_VIVA_DB_URL`) y se enganchó al ERP por el lateral. Siete de los
quince salen de ahí.

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

### El reparto propuesto

Las 47 rutas actuales, agrupadas. Lo marcado con **(?)** es discutible y hay que
decidirlo antes de mover nada.

| Módulo | Rutas que se lleva |
|---|---|
| **Conductores** | `plantilla`, `fichas`, `agenda`, `libranzas` |
| **Vehiculos** | `vehiculos`, `taller` |
| **Planificacion** | `tablero` (planificador), `cobertura`, `vacantes` **(?)** |
| **Control** | `control`, `alertas`, `callCenter`, `justificantes`, `flotaViva` **(?)** |
| **Operaciones** | `operaciones`, `sanciones`, `bitacora` |
| **RRHH** | `rrhh`, `nominas`, `convenio`, `peticiones`, `ticketera`, `pendientes` |
| **Seleccion** | `seleccion`, `ett`, `generador`, `matching`, `vacantes` **(?)** |
| **Documentacion** | `documentos` |
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

**Vehiculos** (2 rutas, controlador ya limpio) → **Documentacion** →
**Usuarios** → **Seleccion** → **Conductores** → **Planificacion** → **Control**
→ el resto.

`flotaViva` no se mueve todavía: tiene base de datos propia y siete de los
quince incumplimientos. Primero se decide si se integra o se queda fuera; mover
de sitio algo que no se sabe si va a seguir existiendo es trabajo tirado.
