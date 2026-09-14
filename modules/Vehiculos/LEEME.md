# Vehículos

El maestro de coches: alta, ficha, estados, zonas, plazas y el enlace con Mapon.

Son dos áreas con las mismas capas cada una. Comparten módulo porque hablan del
mismo objeto —el coche— pero no de lo mismo: una lleva el maestro (alta, ficha,
zona, plazas) y otra cuándo le toca revisión. Un solo trío para las dos daría un
fichero que no abre nadie entero.

```
vehiculos.controller.js   traduce HTTP ↔ dominio. No decide nada.
vehiculos.service.js      LA PUERTA del maestro de coches.
vehiculos.repo.js         el SQL contra PostgreSQL.
vistas/vehiculos.ejs      la pantalla (/vehiculos)

taller.controller.js      idem para /taller
taller.service.js         LA PUERTA del mantenimiento
taller.repo.js            su SQL
taller.excel.js           el informe en Excel
taller.pdf.js             el mismo, para imprimir
vistas/taller.ejs         la pantalla (/taller)
```

## La puerta

Desde fuera del módulo se entra por `vehiculos.service`, **nunca** por
`vehiculos.repo`. Lo comprueba `node scripts/comprobar-capas.js`.

No es purismo: si el planificador leyera el repositorio directamente, Vehículos
ya no podría cambiar por dentro sin romper al planificador — y poder cambiar por
dentro es lo único que se gana agrupando.

Quién entra hoy por la puerta:

| Quién | A qué |
|---|---|
| su propio controlador | todo |
| `routes/tablero.js` (planificador) | `estadosVehiculo()` |
| nadie de fuera, de momento | el de Taller |
| `services/ingesta.js` | `diaria()` (el cron de Mapon) |
| `scripts/migrar-plantilla.js` | alta de coches |

## Lo que se arregló al mudar Taller

El controlador elegía el generador del informe así:

```js
require(`../services/taller${formato}`)   //  'Excel' o 'Pdf'
```

Funcionaba, pero **esa dependencia no la veía nadie**: ni un `grep`, ni
`comprobar-modulos.js`, ni quien leyera el fichero. Un require construido con
una plantilla se rompe en silencio al mover ficheros de carpeta y no da la cara
hasta que alguien pulsa "descargar informe" — que además es de las cosas que se
usan una vez por semana. Ahora los dos formatos están declarados en
`taller.service.js` y el grafo de dependencias vuelve a ser verdad.

## Lo que falta

**Hay reglas de negocio dentro del repositorio.** `crear()` no solo inserta el
coche: abre sus 6 plazas y su vigencia de estado y zona. Eso es una decisión de
negocio y su sitio es el servicio.

No se ha movido a propósito. Este módulo fue el primero en mudarse y la mudanza
tenía que ser mecánica y comprobable; mezclarla con una reescritura de reglas
habría dejado un cambio que ya no se puede revisar de un vistazo. Cuando se
mueva, el destino ya existe y no hay que tocar a nadie más.

## Los puentes

`routes/vehiculos.js`, `services/repo/vehiculos.js`, `services/sincroMapon.js`,
`routes/taller.js`, `services/repo/taller.js`, `services/tallerExcel.js` y
`services/tallerPdf.js` siguen existiendo con una línea que reexporta lo de aquí. Están vivos a
propósito: si se me escapó una referencia, sigue funcionando en vez de dar un
500 en producción. Se borran cuando `node scripts/inventario-muerto.js` diga que
no los apunta nadie.
