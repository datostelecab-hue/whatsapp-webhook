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
| `test/tareas-programadas.test.js` | Las [[Tareas programadas]]: una vez por periodo, otro proceso en curso, la que se quedó a medias, el reintento tras un fallo y el criterio del ítem 7 (el 20 o el hábil anterior) |
| `test/organizacion.test.js` | La [[Organizacion]]: el superior (puesto o por su área), los círculos, una función que se mira en la persona y no en el rol, las de una sola persona y los suplentes, que dar y quitar quedan en el libro y que la contraseña no, el equipo de un responsable y las llaves que se salen de su rol. Y lo que encontró la revisión del 13/11/2026: el círculo por el responsable del área, el superior bloqueado, el titular bloqueado de una función de una sola persona, quitar a un recién bloqueado, las llaves hijas y que `/usuarios` firma en el libro |
| `test/adjuntos.test.js` | Los [[Adjuntos]]: subir por trozos con huella, el tope que corta según llega sin dejar nada, vacío no, rangos, If-Range y 304, ver, adjuntar y quitar como tres permisos, que un HTML o un SVG se descargan siempre, la CSP del PDF, nombres raros (también los invisibles), ids imposibles, anular con su libro, sin R2 en Render no hay almacén, las variables de R2 mal puestas y sus errores en español, «Probar conexión» y, por HTTP, multipart, Range, HEAD, el 413 sin leer el cuerpo, quitar, el formulario mal cerrado, el fallo que no enseña la base, el navegador que se va antes de que conteste el almacén y las cuatro subidas a la vez. **La de R2 solo corre con un S3 de pruebas:** `S3_PRUEBAS=http://127.0.0.1:9090 npm test`, con el contenedor `telecab-s3` del [[Entorno de pruebas local]] |
| `test/tiempoReal.test.js` | El [[Tiempo real]], sin base: a quién llega cada aviso (canal y `para`), el tope de 16 KB, lo perdido al volver o «reinicio», los canales sin permiso, el tope de pestañas y el navegador lento y, por HTTP con la compresión puesta, que no se comprime, el retry y el «suscrito» con su id, el latido, el corte al cerrar la sesión y al perder un canal |
| `test/notificacionesPush.test.js` | Las [[Notificaciones al dispositivo]]: solo direcciones de los servicios de los navegadores (nada de la propia red), las claves y el aviso comprobados, activar con sesión y lo de otra persona, confirmar que no resucita lo quitado, solo a las sesiones abiertas, la baja con 410/403 y tras cinco fallos, el aviso cifrado de verdad (se descifra con las claves del navegador) y, por HTTP, el 503 sin claves y el tope de la de prueba |
| `test/contadores.test.js` | Los [[Contadores]]: lo que da una fuente, limpio; una que falla o tarda no tapa a las demás; lo contado se recuerda y un cambio lo olvida y avisa por el tiempo real (a todos o a unos); los cuadros de tickets con sus partes y «Otros», solo las bandejas que puede abrir; la campana y las correcciones solo para quien le tocan; y por HTTP, todo en una petición |
| `test/tablero.test.js` | El [[Tablero de tareas]], una prueba por decisión: la tarea a mano espera a Ignacio y el plazo cuenta al aprobarla; cada ticket nuevo crea su tarjeta y se asigna con responsable y plazo; cerrar el ticket cierra la tarjeta y al revés; «me hago cargo», las bajas médicas sin nombre y los tickets de antes del corte; cerrar sin aprobación y con motivo de demora; reasignar y bloquear con motivo; quién ve qué; la historia intocable y el libro; el aviso de vencidas; los contadores; y la API |
| `test/avisos.test.js` | Los [[Avisos]] (ítem 3): el de un área le llega a su gente y no a otra; leído, cada uno el suyo y el libro de lecturas intocable; resuelto con nota, de todos; a una persona; un área vacía, a quien reparte; con hora, caduca; su módulo lo cierra; y cada cita del taller de Madrid avisa a Control, y la llamada o el cambio de estado la cierran |
| `test/novedades.test.js` | Las [[Novedades]]: la ventana sale hasta que se ve una vez, el recorrido queda y un «hecho» no se pisa; solo la versión de ahora |
| `test/tablero-colas.test.js` | Las colas del tablero (1c): la J nace a nombre de quien lleva su tipo con 2 días hábiles y aprobarla la cierra; cambiar su tipo la pasa a quien toca (salvo reparto a mano), editarla aprobada la reabre y rechazarla la cierra con el motivo; sin titular, por asignar; la −J; una anulada no vuelve; la corrección de fichaje a quien tiene la llave, y retirarla la cierra; las vacaciones a quien las aprueba y los tickets de antes del corte sin tarjeta; y el paso de una vez |
| `test/parametros.test.js` | Los [[Parametros]]: valores por defecto, validación, historia y que el historial no se cambia ni se borra |

Un servicio con caché (parámetros, calendario) exporta `invalidar()`: `conBase` la llama en todos los de `services/` antes de cada test, para que ninguno vea lo que dejó en caché el anterior.
