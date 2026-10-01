# scripts/archivo — lo que ya hizo su trabajo

Scripts de **un solo uso** que ya se ejecutaron: la migración de agosto y septiembre
desde los Excel a PostgreSQL, el reset que la precedió y dos rellenos puntuales. Se
archivaron el 01/10/2026 para que `scripts/` enseñe solo lo que se usa hoy.

**Siguen funcionando.** Al moverlos se subió un nivel cada `require('../…')`, así que
se lanzan igual que antes con la ruta nueva (`node scripts/archivo/<nombre>.js`) y
`comprobar-modulos` comprueba que sus `require` resuelven. Lo que **ya no** se mira es
su SQL: `comprobar-sql` solo lee `scripts/` de primer nivel. El esquema ha seguido
cambiando desde que se escribieron, así que **antes de volver a lanzar uno, léelo
entero y ensáyalo**: todos ensayan por defecto y solo escriben con su bandera
(`--go`, `--si`, `--aplicar`, `--commit`).

Los datos que leían se quedan donde estaban: `scripts/datos/` (fuera de git) y los
Excel en `C:/Users/ricar/Downloads`.

| Script | Qué hizo | Cuándo |
|---|---|---|
| `perfilar-plantilla.js` | Medir `PLANTILLA TRABAJADORES.xlsx` antes de cargarlo: qué cruza por DNI, NAF o nombre | 24/08 |
| `vaciar-conductores.js` | Vaciar la plantilla para volver a cargarla. **Destructivo** (`--si`) | 24/08 |
| `cargar-plantilla.js` | Cargar la plantilla desde el fichero de RRHH (sustituyó a `cargar-conductores`) | 24/08 |
| `cargar-conductores.js` | La primera carga, cruzando cuatro Excel por nombre. Murió por eso: ver [[Trampas conocidas]] | 21/08 |
| `cargar-vehiculos.js`, `cargar-tablero.js`, `cargar-ausencias.js` | Coches, plazas del cuadrante y ausencias desde `Trafico 2.0.xlsx` / AGENDA_V2 | 21/08 |
| `migrar-todo.js` | La orden del día de la migración: aplicar lo pendiente y lanzar los cargadores en orden | 21/08 |
| `reset.js` + `reset-migracion.sql` | El reset de producción antes de la migración real: dominio en blanco, catálogos y usuarios a salvo. **Destructivo** (`--commit`) | 03/09 |
| `migrar-preflight.js` | Pre-vuelo sin base: qué entraría de `migracion.xlsx` + `justificantes.tsv` | 03/09 |
| `migrar-plantilla.js` | La migración real de la plantilla (`--go`), reutilizando las funciones del repositorio | 03/09 |
| `sembrar-km-dia.js` | El primer punto del ritmo de km del taller; «se ejecuta UNA vez» | 09/09 |
| `cargar-datos-gestoria.js` | Los seis campos de la gestoría que la migración se dejó (`--go`) | 14/09 |

**No están aquí**, aunque se parezcan, porque se siguen usando: `cargar-mantenimientos.js`
(el taller manda la lista entera cada vez y se vuelve a cargar con `--sustituir`),
`km-mantenimiento.js`, `backfill-tramos.js`, `recalcular-visibilidad.js`, los `diag-*` y
`crear-plantillas-whatsapp.js`.
