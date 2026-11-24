---
tags: [modulo, taller, vehiculos, portal, fotos]
ruta: /revision-fotos
codigo: modules/Vehiculos/revisionFotos.*
---

# Revisión de fotos

Submódulo de taller (24/11/2026, db/282). Cada vez que un conductor deja el coche en el [[Portal de conductores]] hace **cinco fotos** (lateral conductor, frontal, lateral copiloto, parte trasera, asientos de los pasajeros): eso es **un lote**. Aquí cada lote se compara con el anterior del mismo coche y se califica a mano.

Camilo: *«un módulo en el ERP en taller, en el cual pueda comparar las dos últimos lotes de fotos de los conductores, por ejemplo, si lo coge hoy Carlos, toma las fotos y lo deja, el próximo hará lo mismo, entonces, en dicho módulo, por cada dos últimas fotos, debemos de comprobar a mano las fotos de los coches, para aprobar la revisión, una vez calificada, esperamos el próximo ciclo de dos lotes de fotos»*.

```
modules/Vehiculos/revisionFotos.controller.js   /revision-fotos — las rutas y el candado
modules/Vehiculos/revisionFotos.service.js      LA PUERTA: las parejas, la ficha, calificar, el número del menú
modules/Vehiculos/revisionFotos.repo.js         el SQL (lotes de `adjunto` + `fichaje_turno`, y `taller_revision_fotos`)
modules/Vehiculos/vistas/revisionFotos.ejs      la pantalla
public/assets/js/vistas/Vehiculos/revisionFotos.js
test/revision-fotos.test.js
```

## Las reglas (decididas en el chat el 24/11/2026)

- **Cada lote con el anterior** del mismo coche: A-B, luego B-C, luego C-D. Cada lote se califica **una vez**, contra el de antes, y si aparece un daño es **del conductor del lote nuevo**. Se eligió así frente a «parejas sueltas» (A-B, C-D), que deja sin comparar lo que pasa entre B y C.
- **El primero de un coche** (o aquel cuyo anterior ya se borró) sale solo, «Sin lote anterior»: se revisa que el coche esté bien. Al estrenar el portal, cada coche tendrá uno así.
- **Dos calificaciones**: «Aprobada» o «Con daños». Con daños pide **qué se ve** (nota) y **en qué foto** (una o varias de las cinco). Se puede cambiar después («Editar los daños», «Aprobar»): el [[Libro de auditoria|libro de auditoría]] guarda el alta y cada cambio, con el motivo («Revisión de fotos de 1234ABC: aprobada (antes, con daños)»).
- **Las fotos se borran a los 20 días** (la tarea `portal.fotos_caducadas`, ver [[Portal de conductores]]), **salvo los dos lotes de una pareja con daños**: el de después muestra el daño y el de antes prueba que no estaba. La lista dice a cada pareja pendiente cuántos días le quedan, en rojo a partir de 3.
- **Solo la flota de Madrid**, como todo el taller.

## La pantalla

- **La lista** (componente Listado): una fila por pareja, con el lote anterior, el nuevo (quién y cuándo lo dejó), el estado, cuándo se borran sus fotos y quién la revisó. Arranca filtrada en **«Por revisar»**, de la más vieja a la más nueva (la que antes se borra, arriba). Tarjetas: por revisar, se borran en 3 días o menos, con daños y aprobadas.
- **La ficha**: las cinco fotos de antes y de después, una al lado de la otra. Cada foto se abre en grande con el visor de la casa (zoom y descarga), y «Las dos en grande» las pone juntas a toda la pantalla. Con daños, la foto marcada lleva el borde rojo.
- **Calificar y seguir**: al aprobar (o guardar con daños) pasa sola a la **siguiente por revisar**, primero del mismo coche y luego la más vieja de los demás. Cuando no queda ninguna, vuelve a la lista. «Atrás» siempre vuelve a la lista.
- **El número del menú** (Taller → Revisión de fotos): los lotes por revisar; en ámbar si alguno se borra en 3 días o menos. Se actualiza al momento cuando un conductor deja un coche con fotos (el portal avisa) y cuando alguien califica.

## Llaves

- `/revision-fotos`: mirar. La tienen quienes ya miraban Mantenimientos (`/taller`).
- `/revision-fotos/calificar` (marcada `escribir`): aprobar o marcar con daños. La tienen quienes ya apuntaban en Mantenimientos (`/taller/apuntar`).

## Tabla

`taller_revision_fotos` (db/282): una fila por lote calificado (`turno_id`, el nuevo, único), con qué se comparó (`turno_anterior_id`), el coche, `resultado` (`aprobada` | `danos`), la nota, las fotos con daño (1 a 5) y quién y cuándo. Las parejas pendientes no se guardan: se calculan de los lotes que hay.

Relacionado: [[Portal de conductores]] · [[Vehiculos]] · [[Inspeccion de vehiculos]]
