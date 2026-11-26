---
tags: [modulo, rrhh, nomina, descuentos]
ruta: /descuentos
codigo: modules/RRHH/descuentos*
---

# Descuentos en nómina

**Módulo 4.2** del [[Plan RRHH y nominas]] (26/11/2026, db/298). Lo que se le descuenta a alguien en la nómina, cada cosa con su origen, su prueba y su aprobación. El encargo: *«ningún descuento sin aprobación entra en el lienzo»*; el efectivo, *«solo se descuenta lo marcado; al cerrar la nómina la deuda queda saldada en Recaudación»*.

```
modules/RRHH/descuentos.repo.js        el SQL (descuento_nomina, descuento_aplicacion)
modules/RRHH/descuentos.service.js     proponer, aprobar, aplazar, cerrar el mes, los km del Banco de KM
modules/RRHH/descuentos.controller.js  /descuentos
public/assets/js/vistas/RRHH/descuentos.js
test/descuentos.test.js
```

## Lo que decidió Camilo (26/11/2026)

- **Los km salen del [[Banco de KM]]**: el exceso de cada semana cerrada (km fuera de BOLT menos lo justificado, contra su límite) a **`descuentos.km_euro` € por km** (1 € por defecto, en [[Parametros]]). No la franquicia diaria de 40 km del encargo.
- **Aprobar es una llave**, `/descuentos/aprobar`, que se da a quien se quiera desde [[Usuarios y permisos]]: *«crea una llave para personalizar quién puede aprobar eso»*.
- **Sin tope**: RR. HH. aplaza a mano, entero o una parte, y queda el saldo.
- **Conceptos de A3** (Parámetros): efectivo **753** Dto. devolución efectivo; km **758** Descuento vehículo; siniestro **751** Dto. franquicia; combustible y otros **754** Descuento.

## El camino

`pendiente` (por aprobar) → `aprobado` → `aplicado` (descontado entero) · `aplazado` (le queda saldo: sigue en el mes siguiente); y `anulado` (con motivo).

- **El mes de nómina** (`periodo`): la nómina va del 26 al 25 (`nomina.dia_corte`): un descuento del 20/11 va en la de noviembre; uno del 26/11, en la de diciembre.
- **Proponer** («Nuevo descuento», llave `/descuentos/proponer`: Taller, Control, RR. HH.): la persona, de dónde sale (efectivo, siniestro, combustible, otro), el importe, el día, el motivo y las pruebas (fotos del siniestro, el ticket, el parte). Si quien lo apunta tiene la llave de aprobar, sale aprobado.
- **El efectivo, desde [[Administracion|Recaudación]]**: el botón «Descuento de nómina» de Madrid ya **no salda en el acto**: deja el descuento aquí (por aprobar, o aprobado si quien lo apunta puede aprobar) y la deuda se salda **al cerrar la nómina**, con un movimiento `nomina` en Recaudación. Barcelona sigue como antes.
- **Los km, solos**: cada día a las 11:00 (`descuentos.km`, desde el 30/11/2026) se miran las semanas cerradas desde la del 23/11 y, de la **plantilla propia** que se pasó de su límite, nace un descuento pendiente (uno por persona y semana) con su cuenta: km, justificados, límite, horas de viaje, exceso, precio y coches. Si tenía km por justificar pendientes, la ficha lo avisa. Si la semana aún no está calculada entera, espera.
- **El combustible no se aprueba sin el visto bueno de Legal** (quién y cuándo): el encargo, *«nunca automático … y visto bueno de legal»*. También lo exige la base.
- **Aplazar** (quien aprueba): sin importe, todo a la nómina siguiente; con importe, eso se descuenta este mes y el resto se aplaza al cerrar.
- **Cerrar la nómina del mes** (quien aprueba): se descuenta lo aprobado o aplazado a ese mes (o su parte); lo que queda pasa al siguiente, **aplazado** con su saldo; cada descuento hecho queda en `descuento_aplicacion` y, si es efectivo, **el movimiento `nomina` de Recaudación** que salda la deuda (con fecha del día del corte, o de hoy si aún no ha llegado). No se deshace.
- **Excel del mes**: persona, legajo, concepto de A3, importe, origen y motivo de lo aprobado y lo ya descontado de una nómina, para la gestoría (hasta que esté el lienzo del módulo 4).
- **Anular**: quien aprueba, o quien lo propuso mientras siga por aprobar; con motivo. Uno que ya tiene algo descontado no se anula.

Todo al [[Libro de auditoria]] (`descuento_nomina` y `descuento_aplicacion`); lo que nace solo, como «Bot telecab».

## Llaves

- `/descuentos`: mirar. `/descuentos/proponer`: proponer y subir pruebas. `/descuentos/aprobar`: aprobar, anular, aplazar y cerrar el mes. Todas `manual`.
- db/298: mirar y proponer a Diana e Ignacio. **Aprobar no lo tiene nadie** hasta que se dé en Usuarios.
- El número del menú (RRHH → Descuentos): los que esperan aprobación, a quien tiene la llave de aprobar.

> [!warning] Los km pesan
> Con la semana del 16 al 22/11/2026 (solo lectura): 43 personas de plantilla propia se pasaban, 3.764 km de más (la mediana, 55 km; el que más, 316). A 1 €/km, unos 3.764 € en una semana. Antes del primer cierre: el precio por km y el visto bueno de Legal (el plan, choque 15).

Relacionado: [[Plan RRHH y nominas]] · [[Banco de KM]] · [[Administracion]] · [[Gestoria]] · [[Parametros]]
