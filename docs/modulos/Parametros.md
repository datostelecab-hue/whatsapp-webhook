---
tags: [modulo, parametros, hoja-de-ruta]
actualizado: 2026-11-13
---

# Parámetros

`/parametros` (13/11/2026, db/243): los **números de las reglas** de la [[Hoja de ruta]] —plazos, topes, días del mes— y el horario de la oficina, cada uno con su historia. Es la pieza A3 y responde a su convención 4: «Todo número de regla es un parámetro […] editable por un administrador, no en el código».

## Cómo está hecho

- **Qué parámetros hay** lo dice el código: el `CATALOGO` de `services/parametros.js`. Cada entrada lleva:
  - su clave, su tipo y su unidad;
  - sus límites;
  - su valor por defecto, que es el número de la hoja de ruta;
  - quién lo usa, o qué ítem lo usará.
- **La base guarda solo los cambios**: `parametro_cambio`, una fila por cambio con el valor nuevo, desde cuándo vale, por qué y quién. **No se cambia ni se borra**: lo impide un disparador (convención 5). El valor de hoy es el último cambio que ya empezó; sin cambios, el del código.
- Un parámetro nuevo es **una entrada más en el catálogo**, sin migración.
- **Un plazo que ya corre no cambia.** Quien calcula una fecha límite la guarda al nacer: cambiar un parámetro solo afecta a lo que nazca después.

Los tipos:

| Tipo | Ejemplo |
|---|---|
| Entero, con unidad | días hábiles, horas hábiles, días, años, día del mes |
| Importe | el tope de 100 € de los reintegros |
| Texto | el acuse fijo del taller |
| Horario | los días de la semana y la hora de abrir y cerrar |

```js
const parametros = require('../../services/parametros');
const dias = await parametros.valor('sanciones.plazo_dias_habiles');   // 5
```

El valor se pide **cada vez** (hay una caché de un minuto): guardarlo en una constante al arrancar haría que un cambio no se notara hasta el siguiente despliegue.

## Lo que hay hoy

- **En uso:** el horario de la oficina de Madrid, que lee el [[Calendario laboral]].
- **Aún sin usar:** los números de los ítems 2, 4 a 8, 10, 14 a 19, ya con el valor de la hoja de ruta. Están para que Ignacio los vea y los revise desde ya; la pantalla avisa de que cambiarlos no cambia nada hasta que se haga su ítem.

## Quién entra

**El desarrollador por su rol, o quien tenga la llave `/parametros`**. De inicio la tiene Ignacio: db/243 se la da por id y nombre. Se puede dar a más gente en [[Usuarios y permisos]]. El superadmin **no** entra por serlo: lo comprueba `sesion.requiereDesarrolladorOLlave`, igual que la llave de Usuarios.

Camilo, 13/11/2026: «Llave propia: Ignacio y desarrollador».

Está en el menú, en el grupo Sistema.

## Por qué no las tablas que ya había

- **`config_app`** sobrescribe el valor y pierde el anterior, y no sabe de unidades.
- **`agreement_parameter`** es del convenio, con su artículo y su grupo profesional: mezclar ahí los plazos de la oficina confundiría lo que dice la ley con lo que decide la empresa.
- **`nomina_config`, `visibilidad_config` y `alerta_control_config`** son de su módulo y se quedan como están.

Los números de regla que aún viven en el código o en variables de entorno (`DIA_CORTE`, los 2 días del aviso de citas, los días de aviso del taller…) se pasan aquí al tocar cada módulo.

## Pruebas

`test/parametros.test.js` comprueba:
- los valores por defecto;
- que cambiar exige motivo y un valor de su tipo y en sus límites;
- que el cambio vale desde ese momento y lo de antes se sigue sabiendo;
- que el historial no se deja cambiar ni borrar;
- que todo el catálogo es coherente.

Ver [[Pruebas automáticas]].
