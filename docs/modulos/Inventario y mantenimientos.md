---
tags: [modulo, taller, vehiculos, inventario, mantenimientos, facturas]
ruta: /inventario · /taller
codigo: modules/Vehiculos/inventario.* · modules/Vehiculos/taller.* · public/assets/js/mantenimientosCoche.js
---

# Inventario y mantenimientos (12/11/2026)

Camilo, 12/11/2026: *«Hay que crear un módulo de "Inventario" para las cosas que no tengan matrícula, como los de HERGAR. Toca también re diseñar el módulo de "Mantenimientos" y en la ficha del vehículo listar sus mantenimientos, uno por uno […] que se liste por debajo del historial de situaciones»*. Los datos salieron de las facturas en PDF de Discom, iPark (neumáticos) y Hergar.

```
db/241-mantenimientos-e-inventario.sql     el sitio: piezas, origen, inventario, llaves
db/242-facturas-taller-leidas.sql          los datos leídos de los PDF (generado, ver abajo)
modules/Vehiculos/inventario.controller.js /inventario — rutas y candado
modules/Vehiculos/inventario.service.js    LA PUERTA del inventario
modules/Vehiculos/inventario.repo.js       el SQL; las reglas del stock, en transacción
modules/Vehiculos/vistas/inventario.ejs    la pantalla (Listado)
public/assets/js/mantenimientosCoche.js    los mantenimientos de un coche, uno por uno
```

## Un mantenimiento lleva sus piezas y dice de dónde sale

`mantenimiento` ya no es solo km, fecha y coste: lleva sus **piezas** (`mantenimiento_pieza`: descripción, código, cantidad, precio, descuento, importe sin IVA y **categoría**) y su **origen**:

| origen | qué es |
|---|---|
| `manual` | lo apuntado a mano en Mantenimientos, como siempre |
| `factura` | una reparación de Discom o un albarán de iPark, con su factura y su línea |
| `inventario` | una pieza del almacén que se ha puesto en ese coche |

Las **categorías** de una pieza: aceite y filtros, frenos, neumáticos, suspensión y dirección, alumbrado, batería, chapa y pintura, mecánica, otro; y dos que no cuentan para decir qué se le hizo al coche, `mano_obra` (mano de obra, diagnosis) y `nota` («RECAMBIO TRAE EL CLIENTE», «FECHA 07/09/2026»). El mantenimiento guarda en `categorias` las que tiene, para filtrar sin abrir las piezas, y en `tipo` la principal.

> [!important] El semáforo de «le toca revisión» cuenta SOLO lo apuntado a mano
> Lo eligió Camilo (12/11/2026): las facturas salen en el historial pero no mueven la revisión por km. `taller.repo.cuadro` filtra `origen = 'manual'`.

## La pantalla de Mantenimientos (`/taller`)

Tres pestañas: **Mantenimientos** (la de entrada), **Revisión por km** (el estado de la flota de siempre) y **Citas del taller**.

- **Mantenimientos** es un Listado: cada paso por taller de cada coche, con lo que se hizo (categorías y resumen de las piezas), los km, el taller, la factura y el coste sin IVA. Se filtra por categoría, taller y origen. Arriba: los últimos 30 días, su gasto, el gasto del año y cuántos no traen km. La ficha de uno trae sus líneas de la factura, «Ver el coche» y «Anular».
- **La pestaña que se ve va en `?vista=`** (`flota`, `citas`), no en el `#`: el `#id` es del Listado, que abre con él la ficha de un mantenimiento. El `#citas` de antes (los enlaces de Control) se pasa a `?vista=citas` antes de montar el Listado, que si no lo tomaría por un id.
- **Las cifras siguen a los filtros** (12/11/2026). Camilo: *«que se actualice el contador de euros cuando se filtre algo […] si filtro por Discom, que me muestre lo que hemos gastado en total históricamente, y también en lo que va del año, asimismo con los tipos de mantenimientos y de partes»*.
  - Las tarjetas se calculan con lo que se ve: el gasto total, el del año y el de los últimos 30 días, sin IVA.
  - Con una **pieza** elegida, la cuarta tarjeta dice lo facturado solo en las líneas de esa pieza, que no es el mantenimiento entero. En Discom muchas piezas van a 0 € porque las pone Telecab, y ahí se paga la mano de obra.
  - Para esto el Listado tiene una opción nueva, `kpisDeLoVisible`.
- **Las piezas** (`PARTES`, en `taller.repo`) se reconocen en la descripción de cada línea, por palabras y en orden: filtro de habitáculo, de aceite, de aire, aceite de motor, pastillas, discos, neumáticos, pinchazos, lámparas, batería, paragolpes, diagnosis, mano de obra… La lista del historial trae, por mantenimiento, sus piezas y lo facturado en cada una.
- **El taller se filtra sin distinguir mayúsculas.** Los apuntes a mano decían «DISCOM» y las facturas «Discom», y filtrar por uno dejaba fuera el gasto del otro.
- La ficha de un coche en Revisión por km enseña sus mantenimientos con el mismo componente que la ficha del vehículo.
- **Barcelona** (`/barcelona/mantenimientos`) es la misma pantalla con sus coches: también tiene la pestaña, con `/api/historial` en su controlador.

## La ficha del vehículo

Debajo de «Historial de estado», **«Mantenimientos»**: uno por uno, del más reciente al más antiguo, con el día, los km, las categorías, lo que se hizo, de dónde sale («Discom · Factura 2026/000566 · REPARACIÓN 2026/000888») y el coste. Las líneas de la factura se despliegan (un `<details>`, que va con teclado y sin JavaScript). Lo pinta `MantenimientosCoche.pintar` (`public/assets/js/mantenimientosCoche.js`), el mismo en las dos fichas. Si los mantenimientos fallan, la ficha sale igual sin ellos.

## El inventario (`/inventario`)

Lo que hay en el almacén y no lleva matrícula: los recambios de Hergar.

- Un **artículo** por referencia del proveedor (`inventario_articulo`), con su categoría, unidad y último precio (sin IVA, con el descuento).
- **El stock no se guarda**: es la suma de los movimientos no anulados (`v_inventario_stock`). Un número aparte acaba diciendo otra cosa que su historia.

| movimiento | | |
|---|---|---|
| **entrada** | + | llega: las facturas de Hergar, o a mano con «Sumar» |
| **salida** | − | «Restar: puesta en un coche»: **matrícula y fecha obligatorias** (y los km, si se miraron). Crea además un mantenimiento del coche de origen `inventario`, que es lo que la hace salir en su ficha |
| **ajuste** | ± | recuento, rotura, pérdida, devolución: con el **motivo** obligatorio |

- **El stock no baja de cero**: la fila del artículo se bloquea (`FOR UPDATE`) y se comprueba dentro de la misma transacción, así que dos salidas a la vez no dejan el almacén en negativo.
- **Nada se borra, se anula.** Anular una salida anula su mantenimiento (y al revés: anular desde Mantenimientos un mantenimiento del inventario devuelve la pieza). Una entrada no se anula si deja el stock en negativo: esas piezas ya se pusieron en coches.
- **Llaves**: `/inventario` para mirar y `/inventario/mover` (marcada `escribir`) para mover. db/241 se las dio a quien ya tenía `/taller` y `/taller/apuntar`.

### Las facturas de recambios no son NN

Una factura de Hergar trae albaranes sin matrícula porque es una compra para el almacén. `factura_taller.para_inventario` la aparta de la cuenta de NN («se le reclama al taller») y del gasto sin coche; en Facturas de taller sale con la etiqueta «Inventario». Las de Hergar que se apuntaron el 16/09 a nombre de Discom (35241, 37219) pasan a Hergar.

## La carga de los PDF (db/242)

- **Cómo se leyó.** 571 páginas pasadas a imagen. Quitadas las repetidas, quedaron 404 páginas y 339 facturas. Las leyeron 28 agentes Haiku **de la imagen**, porque algunas son escaneadas y en Discom la línea de matrícula y km ni siquiera está en el texto del PDF.
- **Cómo se comprobó.**
  - Cada número de factura, fecha e importe se cruzó con el texto del PDF donde lo había, y cuadraron.
  - En iPark, la cabecera de los 143 albaranes (matrícula, km y fecha) coincide con el texto.
  - Cinco albaranes seguidos de julio tenían las líneas desplazadas de uno a otro, y se corrigieron con el texto.
  - Cada matrícula de Discom lleva un solo bastidor, sin cruces.
- **Lo que entra.**
  - 329 facturas y 460 mantenimientos con 2.227 líneas.
  - 195 artículos con 318 entradas.
  - Las facturas que ya estaban no se duplican: se les completa el coche de la línea que estaba sin matrícula.
- **El inventario se monta el 01/11/2026.** Camilo: *«Pon la fecha como montada el 01/11/2026, no hoy»*. Todas sus entradas llevan ese día, y el de la compra va en la nota.
- **Lo que no entra.** Camilo: *«Las matrículas que no coincidan con el sistema solo déjalas por fuera de la base de datos. Pero déjamelos en un fichero a parte»*. Quedan fuera:
  - las reparaciones con una matrícula que no está en Vehículos;
  - las facturas a otros clientes (Formentera, Jataza, un particular);
  - los dos abonos.

  Todo va en «Taller - facturas fuera de la carga.xlsx» (se le pasó a Camilo; fuera del repo).
- **Los km imposibles.** Discom teclea a veces mal los km: 0348MMZ «195.853 Km» el 08/06, cuando en julio iba por 12.753, y está así en el papel. También imprime «1 Km» cuando no los mira.
  - Un km se vacía si pasa del odómetro de hoy o si choca con la serie del coche: se quita el punto que más choca hasta que la serie cuadra.
  - El mantenimiento entra igual, sin el km.
  - Van en la hoja «Km que no cuadran» del mismo Excel.
- **Los scripts.** Pasar a imagen, repartir, leer, cruzar y generar el SQL viven fuera del repo, en el borrador de la sesión. db/242 es su resultado y no se regenera: es una carga de una vez.

## Ver también

[[Vehiculos]] · [[Inspeccion de vehiculos]] · [[Citas del taller]]
