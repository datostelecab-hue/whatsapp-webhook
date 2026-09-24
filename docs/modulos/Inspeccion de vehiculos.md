---
tags: [modulo, taller, vehiculos, inspeccion]
ruta: /inspecciones
codigo: modules/Vehiculos/inspeccion.*
---

# Inspección de vehículos

El **primer submódulo de taller** (24/09/2026). Cada coche con su última inspección: dieciséis elementos revisados, los vencimientos de la ITV y de las pegatinas VTC, unas observaciones y el resultado. La base fue el Excel del taller «Inspección de Vehículos — Taller Telecab · Tibus elementos», y se sigue pudiendo importar desde la pantalla.

```
modules/Vehiculos/inspeccion.controller.js   /inspecciones — las rutas y el candado
modules/Vehiculos/inspeccion.service.js      LA PUERTA: leer el Excel, importar, apuntar, anular
modules/Vehiculos/inspeccion.repo.js         el SQL
modules/Vehiculos/vistas/inspecciones.ejs    la pantalla (Listado + formulario propio)
db/150-inspeccion-de-vehiculos.sql           catálogos, tablas y la llave repartida
```

## Qué se apunta

| Del Excel | Aquí |
|---|---|
| Matrícula del vehículo | el coche (`vehiculo_id`), por la matrícula normalizada |
| Marca, Modelo | `marca`, `modelo` de la inspección, tal como se anotaron |
| Los 16 elementos | una fila por elemento en `inspeccion_elemento` |
| ITV — mes / año | `itv_mes`, `itv_anio` |
| Pegatina VTC delantera — mes / año | `vtc_delantera_mes`, `vtc_delantera_anio` |
| Pegatina VTC trasera — año | `vtc_trasera_anio` (y `vtc_trasera_mes`, que el Excel no trae) |
| Observaciones adicionales | `observaciones` |
| Resultado final de la inspección | `resultado` |

Los **elementos son un catálogo** (`cat_elemento_inspeccion`), no dieciséis columnas: revisar algo más —el extintor, la mampara— es una fila nueva, no una migración. Cada uno lleva el título de su columna en el Excel (`cabecera_excel`), que es con lo que se importa. Están agrupados en Identificación, Documentación, Carteles, Imagen y Seguridad.

Cada elemento puede estar **Correcto**, **Deteriorado**, **Falta** o **No se requiere en normativa** (`cat_estado_elemento`). Los que cuentan como algo que arreglar son los dos del medio (`es_fallo`). **Un elemento sin fila es que no se revisó**: «sin revisar» no es un estado inventado.

El resultado puede ser **Apto — Todo en orden**, **Apto con observaciones** o **No apto** (`cat_resultado_inspeccion`). El Excel solo trae el primero (o nada); los otros dos cierran el abanico.

## Cada inspección queda

El Excel es una foto: la última inspección de cada coche, y la anterior desaparece al escribir encima. Aquí **cada inspección es una fila** con su fecha y quién la apuntó, y la del coche es la más reciente. Una mal apuntada se **anula con su motivo** (queda con quién y cuándo); no se borra.

**La fecha puede faltar.** El Excel no dice cuándo se inspeccionó cada coche, e inventarla haría creer que se revisaron el día de la importación. Lo importado lleva `origen = 'excel'` y la pantalla dice «del Excel · importado el …». Lo apuntado a mano exige fecha (lo comprueba la base: `ck_insp_fecha_manual`).

## La importación

Botón **Importar Excel** (quien puede apuntar). Las columnas se buscan **por su título, no por su posición**: si alguien mete una columna en medio, no se desplaza todo un sitio y se apunta la V16 donde iba el chaleco. Los valores se leen sin emojis ni acentos («✅ Correcto» → `correcto`, «Marzo» → 3).

Tres reglas, las tres de Camilo:

- **Solo los coches que están en nuestro sistema, de la sede que sean.** Barcelona también: si viene en el Excel, se apunta. Las matrículas que no están **se ignoran y se listan** al terminar, para darlas de alta a mano. En la primera importación fueron **0413MMZ, 5895LBZ, 5900LBZ y 5902JYZ**.
- **Los coches que no vienen en el Excel y no tienen ninguna inspección se apuntan con TODO EN «FALTA»**, para que salgan como pendientes de inspeccionar en vez de desaparecer. Solo los que no tienen ninguna: a uno que ya tenga inspección no se le pisa. En la primera fueron diez (nueve de Madrid y el 8512LDS de Barcelona). La pantalla no los cuenta como dieciséis averías: salen como «Pendiente de inspeccionar».
- **No duplica.** Cada fila deja una huella (`huella`); reimportar el mismo Excel no apunta nada, y uno nuevo solo añade inspección a los coches que cambiaron.

**Se comprueba todo antes de escribir nada**: un valor que no se entiende en cualquier fila para la importación entera y se dice cuál y dónde. La fecha de las inspecciones se puede dar al importar, si se sabe.

La primera importación (24/09/2026): 83 filas, 79 apuntadas, 4 ignoradas, 10 en «Falta». Ese día había **15 coches con la ITV caducada** y 4 que caducaban en 60 días.

## La pantalla

La lista es el [[Componentes de la casa|Listado]]: un coche por fila con la última inspección, el resultado, las **incidencias** (lo que falta o está deteriorado, en chips de color), la ITV y las dos pegatinas VTC con su vencimiento en rojo si pasó y en ámbar si caduca en 60 días. Filtros por estado, por elemento con problema, por resultado, por ITV, por pegatinas y por sede; las cifras de arriba filtran de un toque.

Salen los coches vivos de la flota que se vigila (Madrid) **y** los de cualquier sede con inspección: el Excel trae coches de Barcelona y se pidió verlos.

La ficha enseña la última inspección entera, por grupos, y el **historial** (ver cada una entera, anular). **Nueva inspección** abre un formulario con una fila por elemento y sus estados en línea —como se recorre el coche con el papel en la mano—, que viene con lo de la última para cambiar solo lo que no esté igual, y un botón «Todo correcto». Los vencimientos se escriben `mm/aaaa`.

## Quién

Dos llaves, como [[Vehiculos|Mantenimientos]]: **`/inspecciones`** para mirar y **`/inspecciones/apuntar`** para apuntar, anular e importar. La segunda está marcada `escribir` en el catálogo: cualquier petición que no sea un GET a `/inspecciones` la exige sola, así que un endpoint nuevo nace cerrado. La migración se la dio a quien ya tenía la de Mantenimientos: mirar a Ignacio, Óscar, William y Fernando; apuntar a Óscar, William y Fernando.

## Lo que falta

- **Las fechas de ITV de aquí no se copian a la ficha del coche** (`vehiculo.itv_caduca`, vacía en toda la flota). Es el siguiente módulo de taller: el Excel de ITV del taller.
- **No avisa a nadie** de una ITV o una pegatina que caduca: se ve en la pantalla, no llega.
