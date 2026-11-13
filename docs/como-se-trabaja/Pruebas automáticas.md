---
tags:
  - telecab
  - como-se-trabaja
  - pruebas
  - calidad
actualizado: 2026-11-13
---

# Pruebas automáticas

Desde el 13/11/2026 el ERP tiene **tests automáticos**: `npm test`. Es la pieza A1 de la [[Hoja de ruta]] y responde a su convención 11: «Cada criterio de aceptación es un test automático. Nunca se prueba con datos reales de conductores».

No sustituyen a los [[Comprobadores]]. Los comprobadores revisan el código o miran la copia de producción; los tests prueban que una regla se cumple, con datos inventados.

## Cómo se usan

```
npm run pruebas:base     # crea la base de pruebas (unos 4 s). Hace falta Docker abierto.
npm test                 # corre todos los test/**/*.test.js
```

`pruebas:base` se vuelve a pasar cuando entra una migración nueva: la base se rehace entera desde cero.

## La base de pruebas

Es **otra base en el mismo Docker** del [[Entorno de pruebas local]]: `telecab_pruebas`, al lado de `telecab` (la copia de producción). La hace `scripts/pruebas/crear-base.js`:

1. La crea vacía.
2. Le aplica **todas las migraciones** de `db/` con el corredor de siempre, así que su esquema es el de producción. Cuando una pide las tablas de Flota viva (`fv_*`, que viven en `services/flotaViva/esquema.sql`), aplica ese esquema y sigue.
3. **Salta las migraciones que solo cargan datos reales** y en vacío no pueden (`SOLO_DATOS`: hoy la 155, la 162 y la 232, ninguna con esquema). Una que falle y no esté en la lista para el script: podría llevar esquema, y saltarla dejaría una base distinta de la de producción.
4. **Vacía lo que las migraciones cargan de personas** (las horas por cuenta de BOLT de la 231 y los códigos de lavado) y **comprueba que no queda nadie**:
   - no hay conductores salvo el centinela «(sin mapear)»;
   - no hay usuarios ni cuentas de BOLT;
   - ninguna columna con nombre de dato personal (`dni`, `tel`, `email`, `correo`, `iban`, `naf`, `uuid`, `pin`…) tiene un valor.

   Si una migración futura carga gente de verdad, el script falla y dice dónde. Los datos de empresas (el teléfono y el NIF de los proveedores del taller) están en `DE_EMPRESAS`.
5. Le pone la marca `base_de_pruebas`. Sin ella, los tests no conectan.

La dirección (127.0.0.1:5433) está escrita en el script y en `test/apoyo/base.js`, no se lee de ninguna variable: **los tests no pueden apuntar a producción ni a la copia**.

## Cómo se escribe un test

```js
const { conBase } = require('./apoyo/base');   // PRIMERO: antes que el código a probar
const { test } = require('node:test');
const assert = require('node:assert/strict');
const inventario = require('../modules/Vehiculos/inventario.repo');

test('ítem 20: dar salida a un recambio baja las existencias', () =>
  conBase(async ({ fabrica, consulta }) => {
    const coche = await fabrica.vehiculo();
    …
  }));
```

- **`conBase(fn)`** abre una transacción y **la deshace siempre** al acabar: ningún test ve lo de otro y la base queda como estaba. El `transaccion()` del código probado va con un SAVEPOINT dentro, así que su «si falla, se deshace todo» se sigue cumpliendo y se puede probar. Una consulta fuera de `conBase` falla a propósito.
- **`test/apoyo/base.js` sustituye `services/db` y `services/flotaViva/db`** por una conexión de ese fichero. Por eso va el primero: lo que ya se cargó con la base de verdad no se puede cambiar, y si pasa, lo dice. Además fija `MODO_PRUEBAS=1`, así que no sale ningún WhatsApp, correo ni orden a Mapon.
- **`fabrica`** mete datos inventados: `usuario({ rol })`, `conductor({ alta, tipo, jornadaHoras })` y `vehiculo({ estado })`. Usa nombres de «Prueba», correos en `.invalid` y matrículas de la serie PRB. Cada ítem añade las piezas que necesite con el mismo estilo.
- **`fijarAhora(t, '2026-11-13T09:00:00+01:00')`** (`test/apoyo/reloj.js`) fija el reloj de JavaScript en un test, para los plazos. No cambia el `now()` de PostgreSQL: el código nuevo recibe «hoy» como argumento o lo calcula en JavaScript.
- **El nombre del test cita el criterio** de la hoja de ruta cuando prueba uno: `'ítem 20: …'`.

## Dónde no corren

- **No corren en Render**: el `postinstall` solo pasa `comprobar-vistas` y ESLint, y allí no hay Docker. Se pasan en local antes de subir.
- `comprobar-capas` no mira `test/`, y ESLint solo revisa `public/assets/js`.

## Lo que hay hoy

| Fichero | Qué prueba |
|---|---|
| `test/base-de-pruebas.test.js` | El banco de pruebas: que es la base sintética, que un test no ve lo de otro, que el `transaccion()` se deshace, que no se consulta fuera de `conBase`, que las fábricas valen y que el reloj se fija |
| `test/inventario.test.js` | Ítem 20, que ya se cumple: dar salida a un recambio baja las existencias y suma su coste a la matrícula, y no se saca más de lo que hay |
| `test/calendario.test.js` | El [[Calendario laboral]] y los criterios de la hoja de ruta que son cuenta de calendario (ítems 1, 5, 6, 7, 10 y 18) |
| `test/libro.test.js` | El [[Libro de auditoria]], con una tabla inventada que se crea dentro del test: alta firmada, cambio de estado, anulación sin firmar, reasignación con motivo, columnas que no se apuntan, lecturas y que el libro no se toca |
| `test/parametros.test.js` | Los [[Parametros]]: valores por defecto, validación, historia y que el historial no se cambia ni se borra |

Un servicio con caché (parámetros, calendario) exporta `invalidar()`: `conBase` la llama en todos los de `services/` antes de cada test, para que ninguno vea lo que dejó en caché el anterior.
