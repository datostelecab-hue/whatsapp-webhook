# Vehículos

El maestro de coches: alta, ficha, estados, zonas, plazas y el enlace con Mapon.

```
vehiculos.controller.js   traduce HTTP ↔ dominio. No decide nada.
vehiculos.service.js      LA PUERTA. Todo el que quiera saber de coches entra aquí.
vehiculos.repo.js         el SQL contra PostgreSQL.
vistas/vehiculos.ejs      la pantalla (/vehiculos)
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
| `services/ingesta.js` | `diaria()` (el cron de Mapon) |
| `scripts/migrar-plantilla.js` | alta de coches |

## Lo que falta

**Hay reglas de negocio dentro del repositorio.** `crear()` no solo inserta el
coche: abre sus 6 plazas y su vigencia de estado y zona. Eso es una decisión de
negocio y su sitio es el servicio.

No se ha movido a propósito. Este módulo fue el primero en mudarse y la mudanza
tenía que ser mecánica y comprobable; mezclarla con una reescritura de reglas
habría dejado un cambio que ya no se puede revisar de un vistazo. Cuando se
mueva, el destino ya existe y no hay que tocar a nadie más.

## Los puentes

`routes/vehiculos.js`, `services/repo/vehiculos.js` y `services/sincroMapon.js`
siguen existiendo con una línea que reexporta lo de aquí. Están vivos a
propósito: si se me escapó una referencia, sigue funcionando en vez de dar un
500 en producción. Se borran cuando `node scripts/inventario-muerto.js` diga que
no los apunta nadie.
