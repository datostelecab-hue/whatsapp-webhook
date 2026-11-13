---
tags: [nucleo, auditoria, hoja-de-ruta]
actualizado: 2026-11-13
---

# Libro de auditoría

Desde el 13/11/2026 (db/245) hay **un solo libro** donde queda quién hizo qué, cuándo, desde dónde y por qué: la tabla `auditoria`. Es la pieza A4 de la [[Hoja de ruta]] y responde a su convención 5: «Cada alta, cambio de estado, aprobación o lectura de un aviso guarda quién, qué y cuándo. Nada se borra: se anula, con motivo».

Es el libro de las J (db/228, [[Menos J]]) hecho para cualquier tabla. Lo viejo se queda como está (`cambio_campo`, `ticket_evento`, el libro de las J): esto es para lo que nazca a partir de ahora, empezando por el tablero de tareas y los avisos.

## Lo escribe la base, no el código

Una tabla nueva se pone bajo el libro **en su migración**:

```sql
SELECT auditoria_vigilar('tarea');                              -- la clave es 'id'
SELECT auditoria_vigilar('festivo_oficina', 'fecha');           -- otra clave
SELECT auditoria_vigilar('usuario', 'id', ARRAY['pass_hash']);  -- columnas que no se apuntan
```

Desde ahí, un disparador apunta **cada alta, cambio y borrado**, venga de donde venga: la aplicación, una migración o SQL a mano. Cada fila lleva la de antes, la de después y los campos que cambiaron (`{ campo: [antes, después] }`). Un cambio que no cambia nada no se apunta.

La acción la deduce la base:

| Qué pasó | Acción |
|---|---|
| Una fila nueva | `alta` |
| `anulado_at` se rellena | `anulacion` (el motivo sale de `anulado_motivo`) |
| `aprobado_at` se rellena | `aprobacion` |
| Cambia `estado` | `estado` |
| Cualquier otro cambio | `cambio` |
| Se borra la fila | `borrado` |

Y además:
- **El libro no se toca:** no admite UPDATE, DELETE ni TRUNCATE. No lleva claves ajenas: borrar a una persona no borra su historia.
- **Una tabla vigilada no se vacía:** TRUNCATE no pasa por los disparadores de fila y se llevaría la historia sin apuntarla, así que se impide.

## El código dice quién, desde dónde y por qué

Con `services/libro.js`, **en la misma transacción** que escribe:

```js
const libro = require('../../services/libro');

await libro.conFirma({ usuarioId, origen: 'tablero', accion: 'reasignacion', motivo }, async cli => {
  await cli.query('UPDATE tarea SET responsable_id = $2 WHERE id = $1', [id, nuevo]);
});
```

- `usuarioId` sale de la sesión, nunca del cuerpo de la petición.
- `accion` y `motivo` son opcionales; sin `accion`, la deduce la base.
- La firma va con `set_config(…, true)`, que solo vale dentro de esa transacción: una consulta suelta del pool iría por otra conexión y no llegaría.
- **Si un camino se olvida de firmar, el cambio se apunta igual.** Va con quien firme la columna, si la hay (`usuario_id` o `creado_por` en un alta, `anulado_por`, `aprobado_por`), y con el origen «sin decir (SQL a mano o migración)». Lo que no puede es no quedar.
- Las variables son las mismas que las del libro de las J. Una transacción que escriba a la vez una J y una tabla de este libro no debe pasar una `accion` de las de aquí, porque el libro de las J solo admite las suyas.

## Lo que no es una fila

Una **lectura** de un aviso, un aviso resuelto o una reasignación que se quiere dejar con su motivo se apuntan a mano:

```js
await libro.apuntar({ tabla: 'aviso', registro: id, accion: 'lectura', usuarioId, origen: 'avisos' });
```

## La historia de un registro

`libro.historial(tabla, registro)` devuelve la historia de un registro, de lo más viejo a lo más nuevo:
- la acción y su nombre («Reasignación», «Leído»…);
- quién, desde dónde y por qué;
- cuándo, en hora de Madrid;
- los campos que cambiaron.

**No mira permisos.** Quién puede ver la historia de un registro lo decide el módulo dueño: una baja médica no la ve cualquiera.

## Lo que falta

- **Un componente para pintar la historia en una ficha.** Llega con el primer ítem que la enseñe: el tablero de tareas.
- **Cuánto se guarda el libro y quién puede consultarlo entero** (pregunta para Ignacio). Hoy no hay pantalla que lo enseñe.
- **`cambio_campo` convierte las fechas con `toISOString`** (ver [[Trampas conocidas]]). No se ha tocado: es de lo viejo.

## Pruebas

`test/libro.test.js` lo prueba con una tabla inventada que se crea dentro del test, puesta bajo el libro como lo hará cada módulo nuevo:
- el alta firmada;
- el cambio de estado con su antes y su después;
- la anulación sin firmar;
- la reasignación con motivo;
- las columnas que no se apuntan;
- la lectura de un aviso;
- que el libro no se toca y que la tabla vigilada no se vacía.

Ver [[Pruebas automáticas]].
