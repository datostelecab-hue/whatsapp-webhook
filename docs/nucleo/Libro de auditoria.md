---
tags: [nucleo, auditoria, hoja-de-ruta]
actualizado: 2026-11-13
---

# Libro de auditoría

Desde el 13/11/2026 (db/245, con los arreglos de su revisión en db/247) hay **un solo libro** donde queda quién hizo qué, cuándo, desde dónde y por qué: la tabla `auditoria`. Es la pieza A4 de la [[Hoja de ruta]] y responde a su convención 5: «Cada alta, cambio de estado, aprobación o lectura de un aviso guarda quién, qué y cuándo. Nada se borra: se anula, con motivo».

Es el libro de las J (db/228, [[Menos J]]) hecho para cualquier tabla. Lo viejo se queda como está (`cambio_campo`, `ticket_evento`, el libro de las J): esto es para lo que nazca a partir de ahora, empezando por el tablero de tareas y los avisos.

## Lo escribe la base, no el código

Una tabla nueva se pone bajo el libro **en su migración**:

```sql
SELECT auditoria_vigilar('tarea');                                   -- la clave es 'id'
SELECT auditoria_vigilar('usuario', 'id',
       ARRAY['pass_hash', 'pass_correo_cifrada', 'token_reset', 'token_expira']);   -- lo que no se apunta
```

**En la migración, ponla bajo el libro ANTES de sembrarla.** Lo que se inserta antes no deja su alta: le pasó a `cat_area` en db/248, cuyas siete áreas nacieron sin fila en el libro.

Desde ahí, un disparador apunta **cada alta, cambio y borrado**, venga de donde venga: la aplicación, una migración o SQL a mano. Cada fila lleva la de antes, la de después y los campos que cambiaron (`{ campo: [antes, después] }`). Un cambio que no cambia nada no se apunta. **Si un cambio mueve la clave**, se apunta en la historia de la clave nueva y también en la de la vieja.

**`auditoria_vigilar` no deja pasar lo que se quedaría mal para siempre**, porque lo que entra en el libro ya no sale:
- la clave tiene que tener un índice único de una sola columna (con una que se repite, dos registros compartirían historia);
- la clave no puede ser una fecha con hora, porque su texto cambia con la zona horaria;
- las columnas que no se apuntan tienen que existir: una errata dejaría pasar la contraseña;
- una columna con nombre de secreto (`pass`, `token`, `hash`, `secreto`, `cifrado`…) tiene que estar entre las que no se apuntan.

**La acción:**

| Qué pasó | Acción |
|---|---|
| Una fila nueva | `alta`, **siempre** |
| Se borra la fila | `borrado`, **siempre** |
| Un cambio con la acción firmada por el código | la firmada (`reasignacion`…) |
| `anulado_at` se rellena | `anulacion` (el motivo sale de `anulado_motivo` si no se firmó otro) |
| `aprobado_at` se rellena | `aprobacion` |
| Cambia `estado` | `estado` |
| Cualquier otro cambio | `cambio` |

**El autor:**
- quien firme el código;
- **si el código no firmó nada**, quien firme la columna: `creado_por` en un alta, `anulado_por` en una anulación, `aprobado_por` en una aprobación. **Nunca `usuario_id`**: en muchas tablas es el responsable o el destinatario, no quien escribe;
- si el código firmó un origen sin usuario (una tarea programada), **el autor queda vacío**: lo hizo el sistema.

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
- `accion` y `motivo` son opcionales y **valen para los cambios** de esa transacción. Un alta de otra fila en la misma transacción sigue siendo «alta», sin ese motivo.
- **La firma solo vale dentro de una transacción** (`set_config(…, true)`). `libro.firmar` lo comprueba y lanza si se llama fuera.
- **Si un camino se olvida de firmar, el cambio se apunta igual**, con el origen «sin decir (SQL a mano o migración)». Lo que no puede es no quedar.
- Quién y desde dónde (`telecab.usuario_id`, `telecab.origen`) son las variables del libro de las J; **la acción y el motivo van en variables propias** (`telecab.libro_accion`, `telecab.libro_motivo`) para no cruzarse con el vocabulario de las J. Por eso el origen va como mucho con 40 letras, lo que cabe en el libro de las J.

## Lo que no es una fila

Una **lectura** de un aviso, un aviso resuelto o una reasignación que se quiere dejar con su motivo se apuntan a mano:

```js
await libro.apuntar({ tabla: 'aviso', registro: id, accion: 'lectura', usuarioId, origen: 'avisos' });
```

El registro va como texto o número. **Un `Date` de JavaScript no vale**: su texto no es el `2026-11-09` que guarda la base (ver [[Trampas conocidas]]). En el `detalle`, una fecha de un día se guarda como su día, no como el anterior a las 23:00 de UTC.

## La historia de un registro

`libro.historial(tabla, registro)` devuelve la historia de un registro, de lo más viejo a lo más nuevo:
- la acción y su nombre («Reasignación», «Leído»…);
- quién, desde dónde y por qué;
- cuándo, en hora de Madrid;
- los campos que cambiaron.

**No mira permisos.** Quién puede ver la historia de un registro lo decide el módulo dueño: una baja médica no la ve cualquiera.

El SQL vive en `services/repo/libro.js` (regla 1 de la casa); `services/libro.js` solo decide.

## Lo que falta

- **Un componente para pintar la historia en una ficha.** Llega con el primer ítem que la enseñe: el tablero de tareas.
- **Cuánto se guarda el libro y quién puede consultarlo entero** (pregunta para Ignacio). Hoy no hay pantalla que lo enseñe.
- **`cambio_campo` convierte las fechas con `toISOString`** (ver [[Trampas conocidas]]). No se ha tocado: es de lo viejo.

## Pruebas

`test/libro.test.js` lo prueba con tablas inventadas que se crean dentro del test, puestas bajo el libro como lo hará cada módulo nuevo. Un test por cada regla de arriba, y además:
- la firma no pasa a la transacción siguiente;
- `firmar` fuera de una transacción lanza;
- las comprobaciones de `auditoria_vigilar`;
- la clave que se mueve y la clave larga;
- las fechas;
- el origen de 40 letras.

El `transaccion()` de las pruebas borra la firma al acabar, como una transacción de verdad.

Ver [[Pruebas automáticas]].
