---
tags: [modulo, rrhh, finiquitos, nomina]
ruta: /finiquitos
codigo: modules/RRHH/finiquitos*
---

# Finiquitos

**Módulo 7** del [[Plan RRHH y nominas]] (25/11/2026, db/291). El encargo: *«El resumen de cierre incluye siempre vacaciones netas, el 100% de la recaudación pendiente, descuentos y bonus pendientes, cada uno con su soporte. Tras la aprobación, se dispara solo el envío a firma y el aviso a la gestoría»*.

```
modules/RRHH/finiquitos.repo.js        el SQL (finiquito, la baja de la persona)
modules/RRHH/finiquitos.service.js     el resumen, el camino, el aviso, la tarjeta, el repaso diario
modules/RRHH/finiquitos.pdf.js         el PDF del resumen de cierre
modules/RRHH/finiquitos.controller.js  /finiquitos
public/assets/js/vistas/RRHH/finiquitos.js
test/finiquitos.test.js
```

Decidido por Camilo el 25/11/2026:
- **Nace al dar la baja, de plantilla propia y de ETT.** La propia va a la gestoría y la de ETT, a la agencia. Queda guardado en la ficha, como las «Extras pendientes» de siempre, con los conceptos del encargo.
- **Diana revisa, Ignacio aprueba.**
- **Las vacaciones, en días**: el importe lo pone la gestoría.

## El resumen de cierre: nada se calcula aparte

Cada concepto sale del módulo que ya lo cuenta, para que el finiquito no diga algo distinto de su pantalla:

| Concepto | De dónde | Soporte |
| --- | --- | --- |
| **Vacaciones netas** (días) | el saldo de [[Vacaciones]] a la fecha de baja | generadas, festivos, disfrutadas. Las de ETT las liquida la agencia: «No aplica». |
| **Recaudación pendiente (100 %)** | lo que debe en [[Administracion\|Recaudación]] (`extractoDe`), al céntimo | cobrado de BOLT, entregado, cambio, saldo de partida. Si la casa le debe, sale a su favor. |
| **Variables y bonus pendientes** | las «Extras pendientes» de [[Nominas]] (`nominas.finiquito`): las dos nóminas variables que se van sin pagar | cada mes con su total y el Excel día a día |
| **Otros descuentos** | [[Descuentos en nomina]] (db/298) | Desde el 26/11/2026: lo que le queda por descontar de km, siniestros, combustible u otro, **aprobado o aplazado**, por su saldo. Los que están por aprobar se enseñan y no entran (como en el lienzo). El efectivo no: ya va entero en la recaudación. |

No incluye el salario base del mes, la indemnización ni la parte de las pagas: eso lo calcula la gestoría. Si una fuente falla, ese concepto sale con su error y no se puede dar por revisado hasta recalcularlo.

> [!note] La `liquidacion` del convenio (db/52) no se usa
> Calcula las vacaciones con otra regla (22 días al año prorrateados, no la de Vacaciones) y las variables de `variable_nomina`, que está vacía. Usarla habría dado un finiquito distinto de las pantallas.

## El camino

`borrador` (por revisar) → `revisado` (por aprobar) → `aprobado` → `enviado` → `firmado`; y `anulado`, con motivo.

1. **Nace solo** al dar la baja en Plantilla (en segundo plano: la baja no espera) o el día que llega una baja programada. Cada día a las 07:00 un repaso recoge las que se quedaron sin preparar, **de las bajas desde el 25/11/2026**. Las de antes se preparan a mano: botón **«Finiquito»** en la ficha de Plantilla de quien está de baja (si ya tiene, lo abre).
2. **Tarjeta a Diana** (función «finiquitos_revisar», su puesto): lo mira, puede **recalcularlo**, y lo da por **revisado**.
3. **Tarjeta a Ignacio** (quien tenga `/finiquitos/aprobar`): lo **aprueba** o lo **devuelve** con motivo.
4. **Al aprobarlo**, solo: el PDF se guarda en sus documentos (tipo «Finiquito») y se **manda por correo** con el PDF y el Excel de las variables al «Correo de la gestoría» (los propios) o al «Correo de la ETT para los finiquitos» (los de ETT), los dos en [[Parametros]]. Sin correo, o si no sale, queda «aprobado, sin enviar» y lo dice; se reintenta o se marca **«Lo mandé a mano»**. Aprobado, ya no se recalcula.
5. **A firmar**: al aprobarse, entra solo en la cola de [[Firmas]], a falta del finiquito de la gestoría (el documento con los importes). Cuando se firma allí, este queda **firmado**. También se puede subir el firmado aquí, en «Firmado», y marcarlo.

Todo va al libro de auditoría (`auditoria_vigilar('finiquito')`), y el menú cuenta lo que le toca a cada uno.

## Llaves

- `/finiquitos`: entrar y mirar. Diana e Ignacio.
- `/finiquitos/revisar`: preparar, recalcular, revisar, anular, marcar enviado y firmado. Diana.
- `/finiquitos/aprobar`: aprobar y devolver. Ignacio.

Son datos de nómina: `manual`, no las reparte ningún rol. No llevan `escribir`, porque una llave solo admite una hija de escritura y aquí hay dos: cada acción la exige el servicio.

## Lo que falta para que funcione del todo

- **Los correos de destino** en Parámetros: «Correo de la gestoría» y «Correo de la ETT para los finiquitos». Sin ellos, se manda a mano.
- **La firma digital** (módulo 6): hoy el firmado se sube a mano.
- ✔ 26/11: los otros descuentos en euros, desde [[Descuentos en nomina]] (prueba en `test/finiquitos.test.js`).

Relacionado: [[Plan RRHH y nominas]] · [[Nominas]] · [[Vacaciones]] · [[Administracion]] · [[Conductores]]
