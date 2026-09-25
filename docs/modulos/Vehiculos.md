---
tags: [modulo, vehiculos, taller, flota]
ruta: /vehiculos
codigo: modules/Vehiculos/
---

# Vehículos

El maestro de coches —alta, ficha, estados, zonas, plazas y el enlace con [[Mapon]]—, el **mantenimiento por kilómetros** y las **facturas de taller**.

Son **tres áreas con las mismas capas cada una**. Comparten módulo porque hablan del mismo objeto —el coche— pero no de lo mismo: una lleva el maestro y otra cuándo le toca revisión. Un solo trío para las dos daría un fichero que no abre nadie entero.

## La sede manda, y ahora se puede cambiar

Cada coche pertenece a una **sede** (`vehiculo.sede`, contra `cat_sede`: hoy Madrid y Barcelona). No es la zona —la zona es la base dentro de la ciudad: Getafe, Usera, Canillejas— sino la delegación.

**Manda de verdad, y desde el 24/09/2026 es fija para todo el mundo.** La flota que se vigila es la de **Madrid**, la que lleva Óscar: el [[Mapa de flota|mapa]], Mantenimientos, las facturas de taller, las [[Operaciones|alertas de Mapon]], la [[Auditoria de flota|auditoría de km]] y las [[Sanciones de velocidad|sanciones]] enseñan solo Madrid. Los de Barcelona **solo se listan aquí**, en la lista de Vehículos, y ahí sigue mandando el permiso `/vehiculos/sedes`. En el [[Control Reportes|reporte de horas]] de Control la gente sigue saliendo, pero los km de un coche de Barcelona van rotulados «Barcelona» y no se cuentan.

La sede que se vigila es **una sola constante**, `SEDE_FLOTA` en `services/nucleo.js`, con la condición SQL `deLaFlotaVigilada(col)` que llevan los repositorios. Con una copia por pantalla bastaba que alguien cambiara una para que dos sitios dejaran de contar los mismos coches — que es justo lo que pasaba entre el mapa y Mantenimientos.

Hasta el 21/09/2026 la sede solo se podía cambiar por la base. Ahora está en **Editar datos**, con el selector de la casa — y solo para quien ve las dos: a quien solo ve Madrid no se le enseña un campo que no puede tocar, y como el formulario no lo manda, **el servidor no lo toca**.

> [!warning] Una sede equivocada hace desaparecer un coche
> No da error ni se ve raro: simplemente deja de salir en el mapa, en Mantenimientos, en las alertas y en las sanciones. Por eso el valor se valida contra `cat_sede` antes de guardarlo, y por eso no va con el resto de campos editables —que se escriben a pelo— sino aparte.
>
> Caso real, 24/09/2026: el **3814KYG** estaba marcado como Barcelona y Mapon lo situaba en Alcobendas, llevado por gente del cuadrante de Madrid. El **3035LTX** repostó en Madrid hasta el 21/09 y el 24 ya estaba en Barcelona: los traslados existen, y la sede hay que cambiarla cuando el coche se mueve.

El 24/09/2026, de las 89 fichas vivas: **81 en Madrid y 8 en Barcelona**.

## Las pantallas y sus permisos

| Ruta | Qué es | Permiso |
|---|---|---|
| `/vehiculos` | El maestro: lista, ficha, alta, baja | `/vehiculos` |
| `/taller` | El cuadro de mantenimiento por km | `/taller` |
| `/taller/tickets` | Bandeja de la Ticketera: averías que avisan los conductores | `/taller` |
| `/facturas` | Las facturas de taller y el gasto por coche | `/facturas` |

Y tres llaves que **no abren pantalla, sino acciones**:

| Permiso | Qué desbloquea |
|---|---|
| `/taller/apuntar` | Apuntar mantenimientos, anclar odómetros y cambiar intervalos |
| `/facturas/apuntar` | Dar de alta facturas y anularlas |
| `/vehiculos/sedes` | Ver **también** Barcelona en la lista de Vehículos. En el resto de pantallas no cambia nada: ahí es Madrid para todos |

El reparto es siempre el mismo: **mirar lo quiere media empresa, apuntar es del taller**. Tráfico necesita saber qué coche se le va a caer la semana que viene; dirección quiere ver lo que se gasta en la flota. Pero apuntar es lo que mueve los números que deciden qué coche entra a taller, y eso es de Óscar.

> **El botón escondido en la vista no es un candado.** El controlador comprueba el permiso de verdad (`exigeApuntar`), y quién hace cada cosa sale **de la sesión, nunca del cuerpo de la petición**. Ante cualquier fallo al resolver permisos: Madrid, y sin apuntar — nunca de más.

## Sede y zona son dos preguntas distintas

- **`vehiculo.sede`** (`madrid` / `barcelona`) es de qué **operación** es el coche.
- **`vehiculo.base_zona_id`** es desde qué **barrio** sale dentro de ella.

Con un solo campo habría que elegir entre saber que un coche está en Barcelona o saber que sale de Usera.

> ⚠️ En `modules/Vehiculos/facturas.repo.js` el filtro de sedes es **obligatorio** —se niega a listar sin él— y en `vehiculos.repo.js` y `taller.repo.js` es **opcional**. No es una incoherencia: por esos dos también entran el cron de Mapon y el planificador, y **a un coche de Barcelona hay que seguir apuntándole los kilómetros aunque Óscar no lo vea**. Quien filtra es la pantalla.

## La ficha del coche

`GET /vehiculos/api/ficha/:id` devuelve, además de los datos propios (matrícula, marca y modelo, año, matriculación, ITV, aseguradora y vencimiento del seguro, notas):

- **Las 6 plazas** del coche, con su turno, su rol y quién las ocupa hoy.
- **Los enlaces externos** vigentes (`vehiculo_alias`): con qué `unit_id` de Mapon está casado, y con qué matrícula lo tiene escrito Mapon.
- **El historial de estado y de zona**, que sale de la capa común de vigencias (`services/repo/vigencia`) y no de SQL repetido aquí.

El estado y la zona **no se escriben a pelo**: pasan por `vigencia`, que cierra la anterior y abre la nueva en una sola transacción y deja constancia de cuándo cambió y quién lo hizo.

**Las 6 plazas se crean con el coche**, en la misma transacción del alta: un coche sin plazas no se puede planificar.

## El odómetro bueno de Mapon es `can.odom`, no `mileage`

Esto es lo más importante de todo el módulo. Ver [[Km por odometro CAN]].

El padrón de unidades se pide con `unit/list.json?include[]=can` (`services/mapon.js`). Sin ese `include`, lo único que llega es `mileage`.

> 🚨 **`mileage` NO es el odómetro del coche**, por mucho que lo parezca: son los **km recorridos desde que se instaló el dispositivo**. Comprobado el **09/09/2026** contra los km de la última revisión del taller: **25 de 27 coches daban un imposible**. El **5886LBZ** marcaba **30.723 contra 629.100 reales**.

El odómetro de verdad llega en **`can.odom`**, en **kilómetros con decimal** (por eso se guarda como `odometroCanM`, multiplicado por 1.000). Solo lo dan los coches cuyo GPS lee el bus CAN: **90 de 144 en septiembre de 2026**.

`mileage` no se tira —sirve para medir recorridos y es lo que mantiene vivas las anclas—, pero se guarda aparte, en `vehiculo.km_gps_m`.

*(Otro campo con trampa del mismo sitio: `state` **no es una cadena**, es un objeto `{name, start, duration, debug_info}`. Con `String()` salía `"[object Object]"` en las 144 unidades.)*

## El ancla manual, para los coches sin CAN

Un coche cuyo equipo no lee el CAN no tiene odómetro, y **un odómetro inventado es peor que ninguno**. La salida es el **ancla**: alguien del taller mira el cuadro, apunta los km de verdad, y desde ahí el sistema suma lo que recorra el GPS.

Se apunta en `POST /taller/api/ancla` y vive en la tabla `odometro_ancla`, junto con la lectura del GPS en ese momento (`gps_m`), que es lo que permite calcular el avance.

> Si el coche **ya da su odómetro por el CAN**, anclarlo se rechaza: *"ya da su odómetro por el CAN: no hace falta anclarlo a mano"*.

**La regla vive en un solo sitio**, la vista `v_vehiculo_odometro` (`db/82-taller-mantenimiento.sql`), y todo lo demás lee de ahí. No puede estar repartida entre la pantalla, el cron y los informes: cada copia se desviaría por su lado.

| Situación | Odómetro | `fuente` |
|---|---|---|
| El GPS lee el CAN | ese, y punto | `can` |
| No, pero hay ancla y hay GPS | ancla + lo recorrido desde ella | `ancla` |
| Solo hay ancla | el ancla tal cual; `visto_at` dirá lo vieja que es | `ancla_fija` |
| No hay nada | `NULL` | — |

En la sincronización diaria, **el odómetro solo se toca si vino el CAN** (`COALESCE` deja el anterior si esta vez no llegó), mientras que el contador del GPS se guarda siempre. Y el enlace coche ↔ unidad pasa **siempre por `vehiculo_alias`**: la matrícula de Mapon no se usa para casar, solo para diagnosticar descuadres.

## Taller: el mantenimiento por km

La pregunta del módulo es una sola:

```
km desde la última revisión = odómetro de hoy − km de la última revisión
```

Y ninguna de las dos cifras es obvia:

- **El odómetro** sale de `v_vehiculo_odometro`. Aquí **no se recalcula: se lee**. Si esa vista dice `NULL`, el coche no tiene odómetro y este módulo no se inventa uno.
- **El km de la última revisión** sale de `mantenimiento`, ordenado **por km descendente, no por fecha**: el fichero del taller trae los km pero no siempre la fecha, y entre dos revisiones la de más km es la más reciente.

### El ritmo

`vehiculo_km_dia` es una **foto diaria** del odómetro, una fila por coche y día (unas 95 al día, 35.000 al año; no hace falta podarla). De ahí sale el **km/día** de los últimos 30, y eso es lo que permite decir *"le quedan 12 días"* en vez de solo *"le quedan 6.000 km"* — que es lo que sirve para organizar el taller.

Hacen falta al menos dos fotos separadas por un día: con una sola no hay pendiente que medir. Un coche recién dado de alta **no tiene ritmo todavía, y se dice que no se sabe, no se pone un cero**.

Antes esto no existía porque `vehiculo.km_odometro_m` se pisa en cada sincronización: no había forma de saber cuánto rueda un coche sin preguntárselo a Mapon **coche por coche, 144 llamadas**.

### El semáforo

Cinco estados, y en este orden, que importa: **primero se descarta lo que no se puede afirmar, y solo después se juzga**.

| Estado | Cuándo |
|---|---|
| `sin_dato` | no hay odómetro o no hay revisión: no se puede decir nada |
| `revisar` | **dato imposible**: negativo, o más de `IMPOSIBLE` km |
| `toca` | pasó el intervalo |
| `pronto` | por encima del 85 % del intervalo, o quedan menos de 15 días al ritmo actual |
| `ok` | al día |

**`IMPOSIBLE` = 120.000 km.** Por encima de eso, "km desde la última revisión" no es una revisión pendiente: es un dato mal metido. El **5369LJH llegó con 207.831**.

El intervalo general son **15.000 km** (`TALLER_KM_REVISION`), y cada coche puede llevar el suyo (`vehiculo.km_revision_cada`, entre 1.000 y 200.000).

Solo los tipos marcados como `cuenta: true` valen como "última revisión" para el control por km — hoy, `revision`. El aceite, los neumáticos, la ITV, la chapa y las averías se apuntan igual pero no reinician el contador.

### Los informes

`/taller/informe.xlsx` y `/taller/informe.pdf`, **siempre de la flota entera, nunca de lo filtrado en pantalla**: el fichero acaba en un correo, y allí nadie sabe qué filtro estaba puesto al descargarlo. El Excel es el que se usa (se ordena, se filtra por zona y se le manda a cada taller su trozo); el PDF es para imprimirlo y llevarlo a la reunión.

Los dos formatos están **declarados a mano** en `taller.service.js`. Antes el controlador hacía:

```js
require(`../services/taller${formato}`)   //  'Excel' o 'Pdf'
```

Funcionaba, pero **esa dependencia no la veía nadie**: ni un `grep`, ni `comprobar-modulos.js`, ni quien leyera el fichero. Un `require` construido con una plantilla se rompe **en silencio** al mover ficheros de carpeta y no da la cara hasta que alguien pulsa "descargar informe" — que además es de las cosas que se usan una vez por semana.

## Facturas: una factura NO es de un coche

Es lo que hay que entender antes de tocar `facturas.*`, y se vio mirando las facturas de verdad:

- **iPark** manda una al mes con varios albaranes dentro, cada uno con su matrícula.
- **MotorLine** manda una por coche.
- **DISCOM** factura un bidón de aceite de 200 litros que no es de ninguno.

Por eso **la matrícula vive en las LÍNEAS**, no en la cabecera. Y una línea tiene tres estados que no se pueden mezclar, porque cada uno se arregla de una forma:

| Estado | Qué pasó | Qué se hace |
|---|---|---|
| enlazada | la matrícula casó con una ficha | el gasto va a ese coche |
| **NN** | el papel no dice de qué coche es | se le **reclama al taller** |
| no reconocida | el papel sí lo dice y no la tenemos | se **comprueba aquí** |

Los dos últimos empezaron contados juntos y lo destapó una prueba: **una matrícula mal tecleada salía como NN**, y entonces se le reclama al taller algo que sí había puesto.

Desde el **01/09/2026** (`EXIGE_MATRICULA_DESDE`) se le exige al taller que la matrícula venga siempre: un NN anterior es como se trabajaba, uno posterior es un incumplimiento que hay que reclamar. El aviso **no lo decide la pantalla**, lo decide esa fecha.

### El descuadre se mide contra la BASE, no contra el total

No se exige que las líneas sumen el total: una factura trae portes, descuentos y redondeos que no son de ningún coche, y obligar a cuadrarlo al céntimo acabaría con alguien **inventándose una línea para poder guardar**. Se avisa del descuadre y se guarda lo que dice el papel.

Pero el aviso compara contra la base imponible, porque los talleres facturan los artículos **sin IVA** y el total con él:

> Comparándolo con el total, una factura perfecta avisaba de que *"quedan 528,76 € sin repartir"* — que era justo el IVA. Se vio al cargar las **nueve facturas reales**: **siete daban descuadre y ninguna lo tenía**.

**Los importes van en céntimos.** En euros con decimales, sumar doscientas líneas acaba sacando céntimos de la nada.

### El PDF

El fichero va a **Drive** y el **índice a PostgreSQL**, que es como guarda documentos el resto del sistema: la base no es sitio para megas de papel escaneado, y Drive no es sitio para buscar "qué me gasté en este coche". Una carpeta por **mes**, y el nombre lo pone el sistema —`proveedor número`— para que dos facturas no se machaquen porque alguien subiera dos veces `escaneo.pdf`. La extensión es la que traiga el fichero: no todas las facturas son PDF, las escaneadas llegan en imagen, y llamar `.pdf` a un JPG hace que no abra.

**Si Drive falla, no se toca la factura**: mejor una factura sin PDF que una factura apuntando a un archivo que no existe. Las credenciales de Drive viven en la variable de entorno `GOOGLE_CREDENTIALS`; el servicio solo comprueba que esté configurada.

`/facturas/api/pdf` lleva su propio parser de JSON con límite de 30 MB, porque una factura escaneada en base64 pasa de largo los 2 MB del parser global — que por eso se salta esa ruta en `app.js`.

## La puerta

Desde fuera del módulo se entra por `vehiculos.service`, **nunca** por `vehiculos.repo`. Lo comprueba `node scripts/comprobar-capas.js`.

No es purismo: si el planificador leyera el repositorio directamente, Vehículos ya no podría cambiar por dentro sin romper al planificador — **y poder cambiar por dentro es lo único que se gana agrupando**.

| Quién entra hoy | A qué |
|---|---|
| su propio controlador | todo |
| `modules/Planificacion/tablero.controller.js` | `estadosVehiculo()` |
| `services/ingesta.js` | `diaria()` — el cron de Mapon |
| `scripts/migrar-plantilla.js` | alta de coches |

Por la puerta de **Taller** no entra nadie de fuera todavía: solo su propio controlador. Mejor así — cuanto menos ofrezca una puerta, menos ata.

## El estado de las piezas: el dibujo del coche (db/158, 25/09/2026)

En la ficha del vehículo, un **coche visto desde arriba** donde se pincha una pieza y se dice cómo está. Lo pidió Camilo para el taller:

| Estado | Cómo se ve |
|---|---|
| **Buen estado** | verde suave; así está todo al principio |
| **Mal estado · Arreglar** | rojo |
| **Mal estado · Cambio** | rojo que parpadea |

Los dos malos llevan una **observación**. Dos dibujos, con **59 piezas**:

- **Exterior**: carrocería (paragolpes, capó, aletas, puertas, techo, portón, tapa del depósito, antena), cristales, luces, retrovisores, limpiaparabrisas, ruedas, matrículas y escape.
- **Interior y mecánica**: habitáculo (salpicadero, volante, multimedia, climatización, consola, asientos, cinturones, alfombrillas, retrovisor interior), maletero (suelo y rueda de repuesto) y mecánica (motor, batería, radiador, líquidos, frenos y suspensiones).

Al lado, el editor de la pieza elegida (estado, quién y cuándo, observación, historial) y la lista de todas por grupos, que también sirve para elegir las pequeñas. Arriba, cuántas hay en mal estado, con un botón por pieza. En la lista de vehículos, la columna **Piezas** dice de un vistazo qué coche tiene algo.

**Cómo se guarda.** Las piezas y los estados son catálogos (`cat_pieza_vehiculo`, `cat_estado_pieza`): una pieza nueva es una fila, y el dibujo la busca por su código. Cada cambio es una fila de `vehiculo_pieza_estado` (quién, cuándo, qué, observación) y **el estado de ahora es la última de cada pieza**. **Una pieza sin filas está en buen estado**: un coche nuevo no necesita 59 filas para empezar. Volver a «Buen estado» también es una fila, sin observación (lo comprueba la base, `ck_vpe_obs`); apuntar lo mismo que ya hay no añade nada.

**Se marca en 2D.** En 3D, pinchar un retrovisor o una escobilla desde el móvil es una pelea. El dibujo es vectorial (`public/assets/js/piezasCoche.js`): nítido a cualquier tamaño y con los colores del tema.

### El resumen en 3D (25/09/2026)

La tercera pestaña, **3D**, enseña un **Toyota Corolla sedán** que se gira con el dedo o el ratón, con un **punto rojo encima de cada pieza en mal estado**: fijo si hay que arreglarla, parpadeando si hay que cambiarla. Camilo lo pidió así: *«que el 3D muestre el resumen del 2D, no hay que trocearlo»*. Por eso **no se edita en el 3D**: pinchar un punto abre la pieza en el mismo editor de al lado (y desde ahí sí se puede guardar), y al pasar por encima sale qué pieza es y la observación. Pinchar una pieza de la lista de arriba lleva la cámara hasta ella.

- **Ver por dentro** aclara la carrocería y deja ver asientos, salpicadero, motor, batería, frenos y rueda de repuesto. Si todo lo malo del coche está dentro, el 3D ya empieza así.
- Los puntos se pintan siempre por encima (una pieza de dentro tiene que verse), pero **si hay chapa entre la cámara y el punto, salen más flojos**: así se distingue la puerta izquierda de la derecha.
- Gira solo hasta que alguien pone el ratón encima (un punto que se mueve no se acierta). Con «menos movimiento» en el sistema, ni gira ni parpadea: el «Cambio» lleva un aro blanco.
- En el móvil la cámara se aleja lo que haga falta para que el coche quepa a lo ancho.

**El coche no se dibuja a mano: lo genera un script de Blender**, `scripts/modelo-coche-3d.py`, con las medidas reales del Corolla E210 (4,63 × 1,78 × 1,44 m, batalla 2,70 m, 205/55 R16). La carrocería son tres siluetas —lateral, planta y frontal— cruzadas, con los pasos de rueda restados y las aristas redondeadas; cristales, faros, pilotos, rejillas y juntas de las puertas son láminas finas pegadas encima. Por dentro, bloques simples a propósito. Sale `public/assets/3d/coche.glb` (~600 KB, 33 000 triángulos).

**Cada pieza tiene su ancla en el modelo**: un punto invisible llamado `p_<código>` (el de `cat_pieza_vehiculo`), y los frenos y las suspensiones, que son dos por eje, uno más con `__2`. El visor pone el punto rojo en el ancla, así que las coordenadas viven en un solo sitio. **Una pieza nueva en el catálogo necesita su ancla en el script** (el diccionario `ANCLAS`); si no la tiene, sale en el 2D y en la lista, pero no en el 3D.

```
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
    -P scripts/modelo-coche-3d.py -- public/assets/3d/coche.glb [prueba.png]
```

(con la segunda ruta, además, saca tres fotos de comprobación: de delante, de detrás y de lado).

**three.js va servido por nosotros, no por un CDN**, y **solo se descarga al abrir la pestaña 3D**: `public/assets/vendor/three-coche.min.js` (~630 KB, 160 KB comprimido) lleva únicamente las clases que usa el visor, las que lista `scripts/visor-3d/three-coche.js`; la cabecera de ese fichero dice cómo regenerarlo con esbuild. El visor (`public/assets/js/coche3d.js`) es **uno por página** —el navegador limita los contextos WebGL—: cada ficha que lo enseña se lo lleva a su hueco, y el modelo se carga una sola vez. Por lo mismo, que haya WebGL se mira una sola vez. Sin WebGL, la pestaña lo dice y remite al dibujo.

**Quién.** Mirar va con `/vehiculos`. Cambiar un estado es **`/vehiculos/piezas`**, atada por `RUTA_A_CLAVE` a `POST /vehiculos/api/piezas/:id` y no con `escribir` (que cerraría también editar el coche). La migración se la dio a quien ya apuntaba en el taller o en las inspecciones: William, Fernando y Óscar.

```
modules/Vehiculos/piezas.service.js   las reglas (catálogo, sin observación en «bien», sin repetir)
modules/Vehiculos/piezas.repo.js      el SQL
public/assets/js/piezasCoche.js       el dibujo, el editor y las pestañas
public/assets/js/coche3d.js           el resumen en 3D (visor, puntos, «Ver por dentro»)
public/assets/3d/coche.glb            el Corolla, con un ancla p_<código> por pieza
scripts/modelo-coche-3d.py            el script de Blender que lo genera
scripts/visor-3d/three-coche.js       qué partes de three.js van en el paquete
public/assets/vendor/three-coche.min.js  el paquete de three.js (r186)
db/158-estado-de-las-piezas.sql       catálogos, historial y la llave
```

## Inspección de vehículos

Desde el 24/09/2026 el taller tiene un submódulo más: **[[Inspeccion de vehiculos]]** (`/inspecciones`), la última inspección de cada coche con su historial y el importador del Excel del taller. Vive en este módulo (`inspeccion.*`) porque habla del mismo objeto —el coche—, con su propia llave de permisos.

## Lo que falta

**Hay reglas de negocio dentro del repositorio.** `crear()` no solo inserta el coche: abre sus 6 plazas y su vigencia de estado y zona. Eso es una decisión de negocio y su sitio es el servicio.

No se ha movido a propósito: este módulo fue **el primero en mudarse** y la mudanza tenía que ser mecánica y comprobable. Mezclarla con una reescritura de reglas habría dejado un cambio que ya no se puede revisar de un vistazo. Cuando se mueva, el destino ya existe y no hay que tocar a nadie más.

## Los puentes

`routes/vehiculos.js`, `services/repo/vehiculos.js`, `services/sincroMapon.js`, `routes/taller.js`, `services/repo/taller.js`, `services/tallerExcel.js` y `services/tallerPdf.js` siguen existiendo con una línea que reexporta lo de aquí. **Están vivos a propósito**: si se escapó una referencia, sigue funcionando en vez de dar un 500 en producción. Se borran cuando `node scripts/inventario-muerto.js` diga que no los apunta nadie.

## Ver también

[[Km por odometro CAN]] · [[Mapon]] · [[Flota viva]] · [[Auditoria de flota]] · [[Operaciones]] · [[Base de datos]] · [[Glosario]]
