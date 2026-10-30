---
tags: [modulo, control, bitacora, justificantes, auditoria]
ruta: /justificantes (pestaña «−J · Perjuicios»)
codigo: services/repo/menosJ.js, services/repo/auditoriaJ.js, public/assets/js/menosJ.js
---

# La −J y la auditoría de las J

## La −J (30/10/2026, db/227)

Camilo: *«Vamos a implementar algo nuevo llamado −J. Por el momento con una casuística (cluster), "Perjuicios a la empresa": que el motivo sea obligatorio y, opcional, que se enlace a un nombre del compañero. Alex no le da el coche temprano a Carlos, Carlos sale tarde por culpa de Alex: le dejamos una −J a Alex por perjuicio a la empresa, ya que Carlos no va a poder cumplir su horario. Puede que no sea con un compañero sino por otra cosa, y ahí lo dirá el motivo»*.

Lo que decidió al preguntarle:

| | |
|---|---|
| **Efecto** | **Solo constancia.** Queda en su bitácora y se cuentan las que lleva. **No toca horas, ni nómina, ni la letra.** (Quitar sueldo como castigo sería una «multa de haber», que el Estatuto de los Trabajadores prohíbe, art. 58.3.) |
| **Aprobación** | **Nace pendiente** y la aprueba un área en [[Control\|/justificantes]], en su pestaña «−J · Perjuicios». Hasta entonces no cuenta. Rechazada, se queda con quién y por qué. |
| **Datos** | Casuística (por ahora una: *Perjuicios a la empresa*), **motivo obligatorio**, **compañero perjudicado opcional** y **tiempo que costó opcional** (horas y minutos). |
| **Desde dónde** | **Bitácora** (panel del día, «−J · Poner una −J»), **Control** (botón «−J» en la fila de quien lo causó) y **desde la J del perjudicado**: una J «Por compañero» ofrece la −J de quien lo causó al ponerla en Control, al aprobarla en /justificantes, y con el botón «−J a quien lo causó» mientras no la tenga. |

- **Tabla propia `menos_j`**, no una J con signo: una −J no justifica nada ni marca el día, y la misma persona puede tener ese día su J y su −J. Puede haber varias el mismo día. Enlaza la J de la que nace (`justificante_id`) y guarda `origen` (bitácora, control, justificante).
- **Un cluster nuevo** es una línea en `CASUISTICAS` (`services/repo/menosJ.js`) y su valor en el CHECK `ck_menosj_casuistica`, con una migración.
- **En la Bitácora**: una etiqueta «−J» abajo a la derecha del día (discontinua si está pendiente; las rechazadas no se pintan), el bloque del día con su estado, perjudicado, tiempo y quién la puso, y el dato «−J» en la ficha del periodo (cuentan las aprobadas; las pendientes y el tiempo, debajo).
- **El formulario es uno** (`MenosJ.poner`, en `public/assets/js/menosJ.js`, cargado en `layout-gestion`): pide lo mismo en las tres pantallas.
- **Permisos**: ponerla en la Bitácora es el mismo permiso que justificar (`/bitacora/justificar`); en Control, el de Control; aprobarla, el de `/justificantes`.

## La auditoría de las J y las −J (30/10/2026, db/228)

Camilo: *«Ojo, las −J y J tienen que ser bien auditadas en todo el flujo, asegura eso»*.

**Cada alta, cambio o borrado de una J o una −J deja una fila en `justificante_auditoria`, y la deja la BASE**, con un disparador en cada tabla: venga de la aplicación, de una migración o de SQL a mano. Guarda la fila entera de antes y de después, los campos que cambiaron (`cambios`: `{campo: [antes, después]}`), quién, desde qué pantalla, la acción y la hora.

- **Quién y desde dónde lo dice el código** con `auditoriaJ.firmar(cli, { usuarioId, origen, accion })`, dentro de la MISMA transacción que escribe (`set_config(…, true)` solo vale ahí; una consulta suelta del pool iría por otra conexión). Por eso **todo** lo que escribe una J o una −J va en `db.transaccion` y firma primero.
- **Si un camino no firma**, la fila se apunta igual: con quien firme la columna (aprobado_por, anulado_por…) o sin usuario y con origen «sin decir (SQL a mano o migración)». Lo que no puede pasar es que un cambio no deje rastro.
- **El libro no se toca**: UPDATE, DELETE y TRUNCATE dan error (disparador `trg_jaud_intocable`). No lleva claves ajenas: borrar una persona no borra su historia.
- **Lo de antes del 30/10 se reconstruyó** de las columnas (puesta, aprobada, anulada/rechazada, cerrada), con origen «reconstruido (db/228)». En la copia local del 27/10: 717 J. Una J editada antes de esa fecha conserva solo su último editor.
- **El historial se ve** con el botón del reloj en cada J y −J de /justificantes y con «Historial» en el panel del día de la Bitácora (`MenosJ.historial`; `GET /justificantes/api/historial` y `/bitacora/api/historial`, `?entidad=j|menos_j&id=`).

### Los huecos que se cerraron

| Antes | Ahora |
|---|---|
| Editar una J **pisaba `usuario_id`**: quien la puso desaparecía. | `usuario_id` es quien la puso y no se toca; quién editó, en el libro. |
| Una J **aprobada se podía editar** (otras horas, otro motivo, otra área) **y seguía aprobada**: las horas nuevas entraban en la nómina sin que nadie las mirara. | **Editar una J aprobada la devuelve a PENDIENTE** y hay que aprobarla otra vez. La pantalla lo avisa («Estaba aprobada: vuelve a PENDIENTE»). Guardarla igual no cambia nada. |
| **Anular desde la Bitácora** no guardaba ni quién ni por qué. | Pide el **motivo** (obligatorio) y guarda **quién** (`anulado_por`, `anulado_motivo`). |
| **Reabrir** una rechazada no guardaba quién. | Lo firma y queda en el libro. |
| De ningún cambio quedaba **el valor de antes**. | `cambios`, `antes` y `despues` en cada fila del libro. |

## Comprobadores

`node scripts/comprobar-menos-j.js` (42 casos, contra el [[Entorno de pruebas local]], dentro de una transacción que se deshace): lo que se rechaza al ponerla, la cola y su contador, aprobar y rechazar, la −J que nace de una J «Por compañero», los CHECK, la Bitácora (sale al momento y no toca horas) y la auditoría entera (cada paso con su quién y su pantalla, editar una aprobada, anular sin motivo, un cambio a mano sin firmar, el libro intocable). Saboteado quitando el aviso de caché: falla. `comprobar-cache-justificantes.js` sigue pasando con el motivo de anular.

Ver [[Control]], [[Bitacora]], [[Nominas]].
