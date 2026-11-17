# Parámetros

Los números de las reglas de la hoja de ruta (plazos, topes, días del mes) y el
horario de la oficina, editables y con su historia. Convención 4 de la hoja de
ruta de Ignacio; pieza A3 de `docs/Hoja de ruta.md` (13/11/2026).

```
parametros.controller.js   la pantalla /parametros y su API
vistas/parametros.ejs      la pantalla (Listado)
```

## Lo que NO vive aquí, y es una decisión

El catálogo y las cuentas están en `services/parametros.js`, no aquí: los usa
todo el ERP (el calendario laboral ya, y cada ítem de la hoja de ruta cuando se
haga), y si vivieran en este módulo todos dependerían de él. Es transversal,
como `services/permisos.js`.

Lo mismo el calendario laboral: `services/calendario.js` lee el horario de la
oficina de aquí y los festivos de `festivo` y `festivo_oficina`.

## Quién entra

El desarrollador por su rol, o quien tenga la llave `/parametros` (de inicio,
Ignacio; db/243). El superadmin no entra por serlo:
`sesion.requiereDesarrolladorOLlave`. Camilo, 13/11/2026: «Llave propia:
Ignacio y desarrollador».

Ver `docs/modulos/Parametros.md`.
