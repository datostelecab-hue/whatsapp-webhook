---
tags: [modulo, rrhh, sanciones, convenio]
ruta: /disciplina
codigo: modules/RRHH/sanciones*
---

# Faltas y sanciones

**Módulo 3** del [[Plan RRHH y nominas]] (25/11/2026, db/295). Las faltas del **art. 39 del convenio**, desde que alguien las ve hasta que la sanción está comunicada y, si es una suspensión, puesta en la ficha. Va en `/disciplina` porque `/sanciones` ya es la de los [[Sanciones de velocidad|excesos de velocidad]].

```
modules/RRHH/sanciones.repo.js        el SQL (sancion, el catálogo, lo que mira el ERP para proponer)
modules/RRHH/sanciones.service.js     abrir, aprobar, la carta, las propuestas y lo que pasa al cerrarse la firma
modules/RRHH/sanciones.controller.js  /disciplina
public/assets/js/vistas/RRHH/sanciones.js
test/sanciones.test.js
```

## Lo que decidió Camilo (25/11/2026)

- **Abre la oficina** (Tráfico, Control, Taller, RR. HH.), con los hechos y sus pruebas, y **aprueban Ángel, William o Ignacio**. Después **Diana prepara la carta**.
- **El ERP propone** con el catálogo del convenio (`disciplinary_rule`, db/31), **y una persona decide**: la abre o la descarta. Nunca sanciona solo.
- **La carta, con una plantilla con huecos** en YouTrust, sin IA y sin que salgan datos del ERP: los hechos los escribe quien la abre; la calificación y la sanción, el ERP.
- **Una suspensión entra en el planificador al firmarse la carta**, o cuando no la firma o caduca.

## El camino

`propuesta` (la vio el ERP) → `abierta` (por aprobar) → `aprobada` (la carta, por preparar) → `en_firma` (en la cola de [[Firmas]]) → `comunicada`; y `descartada`.

1. **Entra.** **A mano** («Nueva sanción»): la persona, la falta (una del catálogo u «otra», con su gravedad), el día y qué pasó, y las pruebas (fotos, capturas, el parte) como adjuntos. O **la propone el ERP** (abajo); entonces RR. HH. la revisa y la **abre** o la **descarta**.
2. **Se aprueba** dentro de la **horquilla del convenio**, la misma en todas sus reglas:
   - **leve**: amonestación por escrito o suspensión de empleo y sueldo de 1 a 2 días;
   - **grave**: suspensión de 3 a 30 días;
   - **muy grave**: suspensión de 31 a 60 días (el despido se lleva aparte, con Legal).

   Desde la aprobación corre el **plazo para comunicarla**: `sanciones.plazo_dias_habiles` (5 días hábiles) en [[Parametros]].
3. **La carta** (Diana): con las fechas de la suspensión si lo es, entra en la cola de Firmas como «Carta de sanción» (o «Suspensión de empleo y sueldo») y, como quien la manda también aprueba Firmas, queda **aprobada a la vez**. Si a la ficha le falta el email o el móvil, se queda por aprobar en Firmas y lo dice.
4. **Se manda y se cierra** como cualquier envío de Firmas: Claude la manda en nombre de Diana, con un «sí» en el chat. Firmada, **o no la firmó, o caducó**: queda **comunicada** y, si es una suspensión, la situación **«suspendido»** entra en su ficha con esas fechas (y el planificador ya la respeta). Si no cabe porque pisa otro tramo, se apunta en la sanción y a RR. HH. le nace la tarjeta de ponerla a mano.
5. **Si la carta se descarta en Firmas**, la sanción vuelve a «carta por preparar».

Todo al libro de auditoría (`auditoria_vigilar('sancion')`); lo que hace el ERP solo, como «Bot telecab».

## Lo que propone el ERP

Cada día a las 13:30 (`sanciones.proponer`, desde el 26/11/2026), después de [[Ausencias]]:

- **Las ausencias que RR. HH. da por injustificadas**, por persona y **mes natural**, desde el 26/10/2026: 1 día, leve (art. 39.1.b); 2, grave (39.2.b); 4 o más, muy grave (39.3.c). Los hechos ya vienen escritos («No acudió a su puesto de trabajo, sin justificarlo, los días 3 y 9 de noviembre de 2026»). Si en el mes **sube de grado** y la de antes sigue sin abrir, la de antes se descarta sola («sustituida»).
- **La reincidencia**, con las sanciones **comunicadas**: 3 leves en tres meses (grave, 39.2.r); 2 graves en seis meses (muy grave, 39.3.t).
- **No propone** los rechazos de servicios (REJ_*) ni el rendimiento (LOW_*): el ERP no tiene todavía el dato. Esas, y las de un hecho concreto (uso personal del coche, efectivo sin ingresar, daños, no comunicar una incidencia), se abren a mano desde el catálogo.

Una propuesta no nace dos veces (`origen_id`: `ABS|persona|mes|regla`, `RECID_L|persona|última sanción`).

## Los avisos

- **Prescripción** (art. 60.2 del Estatuto): leves a los 10 días, graves a los 20, muy graves a los 60, desde que la empresa lo supo. En la lista y en la ficha se cuenta **desde los hechos**, como aviso: en rojo si ya pasó.
- **El plazo para comunicarla**, en rojo si ya venció.
- **La nómina**: del día `sanciones.dia_limite_suspension` (el 26) en adelante, una suspensión de ese mes entra en la nómina del mes siguiente.

## La carta y su plantilla

Los huecos de la plantilla **«Carta de sanción»** de YouTrust (`textosCarta`): **Fecha**, **Hechos**, **Calificación** («Falta grave, artículo 39.2.q del convenio colectivo: …») y **Sanción** («Suspensión de empleo y sueldo de 5 días, del … al …, ambos incluidos.»). Firma simple **con código por SMS**. En Firmas va por su **origen** (`sancion`), no por su tipo: una suspensión preparada a mano sigue llevando su PDF. `bot.js pendientes` da los `huecos` ya rellenos.

> [!warning] Falta crear la plantilla en YouTrust
> Hasta que exista, `plantillaId` es `null` en `firmas.service` (`COMO.carta_sancion`) y la carta no se puede mandar.

## Llaves y funciones

- `/disciplina`: mirar. `/disciplina/abrir`: abrir y subir pruebas, y abrir o descartar las propuestas. `/disciplina/aprobar`: aprobar o descartar. `/disciplina/carta`: mandar la carta a firmar. Todas `manual`: se dan una a una en [[Usuarios y permisos]].
- De inicio: Ignacio, William y Ángel, mirar, abrir y aprobar; Diana, mirar, abrir y la carta. Al resto de la oficina, `/disciplina` y `/disciplina/abrir` desde Usuarios.
- Funciones ([[Organizacion]]): `sanciones_aprobar` (los puestos de los tres; la tarjeta va al primero, los demás lo ven en la lista y en el número del menú) y `sanciones_rrhh` (el de Diana: las propuestas y las cartas).

Relacionado: [[Plan RRHH y nominas]] · [[Firmas]] · [[Ausencias]] · [[Convenio]] · [[Parametros]]
