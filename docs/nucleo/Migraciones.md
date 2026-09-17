---
tags: [nucleo, postgresql, migraciones, despliegue]
fecha: 2026-09-17
estado: en producción
---

# Migraciones

El esquema de la [[Base de datos]] no se toca a mano: se cambia añadiendo un fichero a `db/`. El **corredor** (`services/migraciones.js`) aplica los `.sql` en orden, **una sola vez cada uno**, y lleva el registro de lo aplicado.

Se puede ejecutar mil veces sin miedo. Lo que no se puede hacer es saltárselo.

## El registro: `_migracion`

Una fila por fichero aplicado:

| Columna | Qué guarda |
|---|---|
| `fichero` | el nombre, clave primaria |
| `huella` | SHA-256 (los 16 primeros caracteres) del contenido |
| `aplicada_at` | cuándo |
| `duracion_ms` | cuánto tardó |
| `sentencias` | cuántos `;` traía |

La tabla la crea el propio corredor (`asegurarRegistro`), así que una base vacía no necesita preparación previa.

**La huella no puede depender del sistema operativo.** Con `core.autocrlf=true` el mismo fichero tiene CRLF en Windows y LF en el repositorio y en Render, así que hashear el texto crudo marcaba *todas* las migraciones como modificadas en cuanto se aplicaban desde un sitio y se leían desde otro. Se normalizan los saltos de línea y el espacio final antes de calcularla (`normalizar` en `services/migraciones.js`).

## Cómo se numeran

`NN-nombre-en-kebab-case.sql`. Del `01` al `12` está la base (núcleo, planificación, ausencias, documentos, auditoría, ingesta); a partir de ahí el número es correlativo y cada fichero hace **una cosa** y la dice en el nombre: `130-jornada-la-que-diga-el-contrato.sql`, `137-auditoria-fuente-km.sql`.

**El orden es por número, no por nombre.** Con un `.sort()` a secas se ordena como texto, y el texto dice que `100` va *antes* que `99` (compara el `1` con el `9`). Mientras los ficheros fueron de dos cifras daba igual; al llegar a la 100 el corredor habría empezado a aplicar las nuevas antes que las viejas, y una migración que depende de la anterior habría reventado en producción sin motivo aparente. Por eso `ficheros()` ordena por el número de delante y, a igualdad, por el nombre.

Cada `.sql` trae **su propio `BEGIN` / `COMMIT`** y se ejecuta tal cual para respetarlo: cada fichero va en su propia transacción, así que uno que falle no deja la base a medias ni impide reintentarlo tras corregirlo. Si uno falla, **el corredor se para ahí**: las siguientes suelen depender de esa.

Y cada uno lleva cabecera contando el **porqué**, no el qué. Ejemplo real (`db/130`): el `CHECK` de la jornada solo admitía 20, 25, 30, 32, 35 y 40 horas, escrito mirando lo que hacíamos nosotros; en la relación de contratos de gigroup a 15/09/2026 había jornadas de 18, 21, 24, 27 y 29 horas — ocho personas de 73. *«Una lista cerrada que la realidad desmiente es un dato disfrazado de código.»*

## Cómo se lanza

**Desde la línea de órdenes:**

```
node services/migraciones.js --ver    # solo dice qué haría, no escribe nada
node services/migraciones.js          # aplica lo pendiente
```

`--ver` es `aplicar({ soloVer: true })`: devuelve aplicadas, pendientes y modificadas sin tocar la base. **Aplicar es la orden sin bandera.** El `--go` de otros comandos del repo (`scripts/cargar-datos-gestoria.js`, `scripts/migrar-plantilla.js`…) es la convención de los *scripts sueltos*, que ensayan por defecto y solo escriben si se lo pides; el corredor no lo usa.

**Desde el panel `/migraciones`** (`routes/migraciones.js`), detrás de `requiereDesarrollador` porque cambiar el esquema queda tras el rol más alto:

| Ruta | Qué hace |
|---|---|
| `GET /migraciones/api/estado` | conexión + aplicadas, pendientes y **modificadas** |
| `GET /migraciones/api/simular` | el `--ver`, sin tocar nada |
| `POST /migraciones/api/aplicar` | aplica; **es POST a propósito**, para que no se dispare abriendo una URL |
| `GET /migraciones/api/inventario` | la radiografía de lo creado |
| `POST /migraciones/api/reiniciar` | vacía y reconstruye; solo con `MODO_PRUEBAS=1` |

Quien lanza una aplicación queda en el log con su correo.

**El día de una migración grande** está `scripts/migrar-todo.js`, que aplica lo pendiente y luego corre los cargadores en el orden obligatorio (conductores → vehículos → tablero → ausencias), parándose si uno falla.

## La regla de oro

> **Nunca ejecutar un `db/*.sql` a mano contra producción. Nunca editar una migración ya aplicada.**

Las dos mitades por separado:

**Ejecutarlo a mano** hace el cambio pero **no escribe la fila en `_migracion`**. Para el corredor ese fichero sigue pendiente, así que en el siguiente despliegue lo intentará otra vez: si crea una tabla que ya existe, revienta, y como el corredor se para en el primer fallo, **todo lo que venga detrás se queda sin aplicar**. Producción y pruebas dejan de parecerse y nadie sabe por dónde va cada una.

**Editar una ya aplicada** no la vuelve a ejecutar —PostgreSQL no tiene forma de saberlo— pero **cambia su huella**. Entonces aparece en la lista `modificadas`, y el panel `/migraciones` la pinta **en rojo** con el aviso de que se aplicó con otra huella. Creer que editarla la reaplica es la forma más rápida de que la base de producción y la de pruebas dejen de parecerse.

Si hace falta corregir algo ya aplicado: **una migración nueva**, con su número, que arregle lo anterior. En `db/` hay varias así — `47-fix-set-returning.sql`, `49-fix-tipo-ancho.sql`, `53-fix-liquidacion-ambigua.sql`, `60-fix-orden-estado.sql` — y ese es el camino correcto, no el error.

Corolario práctico: muchas migraciones usan `CREATE TABLE IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS` precisamente para sobrevivir a una base que ya traía algo de un arranque anterior. Y ojo con `CREATE TABLE IF NOT EXISTS`: **no añade columnas a una tabla que ya existe**, por eso las columnas nuevas van siempre en su propio `ALTER`.

## Vaciar la base

`reiniciar()` hace `DROP SCHEMA public CASCADE` y lo aplica todo desde cero. Durante el ensayo de una migración hace falta muchas veces: cargar, comprobar, corregir y repetir.

Exige **las dos cosas**:

- `MODO_PRUEBAS=1` — en un servidor normal se niega.
- La confirmación literal `'BORRAR TODO'`.

> Borrar el esquema de producción por una URL sería el peor accidente posible, **y aquí ya ha pasado que dos entornos compartan credenciales**.

Ver también: [[Base de datos]], [[Ingesta]], [[Reglas de la casa]], [[Glosario]].
