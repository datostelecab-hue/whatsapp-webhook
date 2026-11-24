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
modules/Vehiculos/revisionFotos.service.js      LA PUERTA: las parejas, la ficha, juzgar cada foto, el número del menú
modules/Vehiculos/revisionFotos.repo.js         el SQL (lotes de `adjunto` + `fichaje_turno`, ; `taller_revision_foto` y `taller_revision_fotos`)
modules/Vehiculos/vistas/revisionFotos.ejs      la pantalla
public/assets/js/vistas/Vehiculos/revisionFotos.js
test/revision-fotos.test.js
```

## Las reglas (decididas en el chat el 24/11/2026)

- **Cada lote con el anterior** del mismo coche: A-B, luego B-C, luego C-D. Cada lote se revisa **una vez**, contra el de antes. Se eligió así frente a «parejas sueltas» (A-B, C-D), que deja sin comparar lo que pasa entre B y C.
- **Foto a foto, tipo Tinder** (db/283). Camilo: *«la quiero tipo tinder jajaj, toca aprobar cada foto con su némesis (…) también poder poner si una foto está mal tomada o no muestra nada, para poder reportar al conductor por no hacer el trabajo, es comparación por comparación, dos, dos, dos, dos y dos, cada una con aprobar / con daños / Imagen no válida»*. Cada una de las cinco comparaciones (la foto n del lote nuevo contra la n del anterior) es:
  - **Aprobada**;
  - **Con daños**: pide qué se ve (obligatorio);
  - **Imagen no válida**: mal hecha o no enseña nada; el motivo es opcional, con botones rápidos (borrosa, oscura, no se ve el coche, es otra parte del coche, muy de cerca o tapada).
  Los daños y las imágenes no válidas son **del conductor del lote nuevo**.
- **La pareja se cierra con la quinta**: con daños si alguna foto lo tiene; si no, imagen no válida si alguna lo es; si no, aprobada. Mientras tanto sale «En curso · 2 de 5». Cambiar una foto después vuelve a calcular la pareja. El [[Libro de auditoria|libro de auditoría]] guarda cada veredicto y cada cambio («Revisión de fotos de 1234ABC · Frontal: aprobada»).
- **El primero de un coche** (o aquel cuyo anterior ya se borró) sale «Sin lote anterior»: se mira que el coche esté bien. Al estrenar el portal, cada coche tendrá uno así.
- **Las fotos se borran a los 20 días** (la tarea `portal.fotos_caducadas`, ver [[Portal de conductores]]), **salvo**: los dos lotes de una pareja con daños (el de después muestra el daño, el de antes prueba que no estaba) y el lote nuevo de una con alguna imagen no válida (la prueba para el conductor). La lista dice a cada pareja pendiente cuántos días le quedan, en rojo a partir de 3.
- **Solo la flota de Madrid**, como todo el taller.

## La pantalla

- **La lista** (componente Listado): una fila por pareja, con el lote anterior, el nuevo (quién y cuándo lo dejó), **cinco puntos** (uno por foto: verde aprobada, rojo daño, ámbar no válida, gris sin juzgar), el estado, cuándo se borran sus fotos y quién la revisó. Arranca filtrada en **«Por revisar»**, de la más vieja a la más nueva (la que antes se borra, arriba). Tarjetas: por revisar, se borran en 3 días o menos, con daños, con imagen no válida y aprobadas. Para reportar a un conductor: «Con imagen no válida» y buscar su nombre.
- **La ficha es una carta**: la foto de antes y la de después, grandes y una al lado de la otra, con la tira de las cinco arriba (se puede saltar a cualquiera). Se juzga:
  - con los **tres botones** (Imagen no válida · Con daños · Aprobar);
  - con el **teclado**: A aprueba, D daño, N no válida, ← → entre fotos, Esc cierra lo que se esté escribiendo;
  - o **arrastrando la carta** (ratón o dedo): a la derecha aprueba; a la izquierda pregunta si es un daño o una imagen no válida.
  Al juzgar, la carta se va (a la derecha, a la izquierda o hacia abajo) y entra la siguiente. Un toque en una foto la abre en grande (zoom y descarga). Con quien pide menos movimiento en el sistema, sin desplazamientos.
- **El final de la pareja**: el resultado, el responsable («1 daño y 2 imágenes no válidas») y las cinco con lo juzgado (cada una con «Cambiar»). **Siguiente** (Enter) va a la próxima por revisar: primero del mismo coche y luego la más vieja de los demás. «Saltar», arriba, deja una para luego.
- **Una ya revisada** enseña ese mismo resumen y «Revisar otra vez, foto a foto».
- **El número del menú** (Taller → Revisión de fotos): los lotes por revisar; en ámbar si alguno se borra en 3 días o menos. Se actualiza al momento cuando un conductor deja un coche con fotos (el portal avisa) y cuando se cierra una pareja.

## Llaves

- `/revision-fotos`: mirar. La tienen quienes ya miraban Mantenimientos (`/taller`).
- `/revision-fotos/calificar` (marcada `escribir`): aprobar o marcar con daños. La tienen quienes ya apuntaban en Mantenimientos (`/taller/apuntar`).

## Tablas

- `taller_revision_foto` (db/283): el veredicto de cada foto: `turno_id` (el lote nuevo) y `n` (1 a 5), `resultado` (`aprobada` | `danos` | `no_valida`), la nota (obligatoria con daños) y quién y cuándo.
- `taller_revision_fotos` (db/282): el cierre de la pareja, al juzgar la quinta: con qué se comparó (`turno_anterior_id`), el coche, el `resultado` que sale de las cinco y las fotos con daño. Las parejas pendientes no se guardan: se calculan de los lotes que hay.

Relacionado: [[Portal de conductores]] · [[Vehiculos]] · [[Inspeccion de vehiculos]]
