---
tags: [modulo, planificacion, cuadrante, libranza, postgresql]
aliases: [Sin correturnos, Coche sin correturnos, Libranza por fijo]
---

# Coches sin correturnos

Función del coche en el [[Planificacion|planificador]] (15/10/2026, `db/203`). Camilo: *«Hay unos coches que no tienen correturnos y los fijos descansan en días diferentes. La idea es hacer una nueva función en el coche llamada "Sin correturnos": quita los correturnos (si los tiene) y oculta las columnas para agregar correturnos, y deja asignarle días de libranza diferentes a los dos fijos que queden. Se podrán agregar a los cuadrantes, pero que diga que este coche no tiene correturnos y no se pueden agregar personas en esta matrícula: será sobre todo para poder asignarles un cuadrante»*.

## Lo que cambia en el modelo

Hasta ahora el fijo libraba **el descanso del coche** (`db/56`): un bloque de días por matrícula, igual para el fijo de día y el de noche, y esos días los cubría el correturnos. Un coche sin correturnos rompe las dos cosas: nadie cubre los días que libra su fijo, y cada fijo libra los suyos.

| Pieza | Qué es |
|---|---|
| `vehiculo_sin_ct` | La marca, **con fecha** (desde/hasta). El pasado del coche tuvo correturnos y su cobertura tiene que seguir cuadrando. |
| `vehiculo_descanso.turno_id` | `NULL` es lo de siempre: el coche entero, el bloque del cuadrante. `1` o `2` es el fijo de día o el de noche. La libranza sigue viviendo en el coche (en su plaza), no en la persona: si cambia el fijo, el nuevo libra lo mismo. |
| Exclusión por turno | Un descanso común choca con cualquier otro de las mismas fechas; uno de día, solo con otro de día. Se hace con `int4range(COALESCE(turno_id,1), COALESCE(turno_id,2))`. |
| `tg_asignacion_sin_ct` | Disparador: nadie entra en una plaza de correturnos de un coche sin ellos, venga de donde venga (el tablero, el CT del cuadrante, un evento, la vuelta de un apaño o un intercambio). El pasado, antes de la marca, sí se puede escribir. |

Quien lee el descanso para un **fijo** mira el común **o el de su turno**: `f_cobertura`, `v_conductor_libranza`, `v_plaza_ct_sugerida` y `v_vacante_plaza` en la base, y en el código la Plantilla, la ficha 360, la asistencia, la auditoría de los lunes, las vacantes, `comprobarPlan` y las salidas por coche. Las vistas se reescribieron **desde su definición viva** (`pg_get_viewdef`), tocando solo esa condición: las columnas no cambian y lo que cuelga de ellas (`v_agenda`, `v_vacante`, `v_plaza_comprometida`) sigue igual.

## Ponerlo y quitarlo

Botón del coche, con el icono de la persona tachada (`planificador.repo.quitarCorreturnos`, `POST /planificador-v2/api/sin-correturnos`). Vale **desde el día que se mira, nunca antes de hoy**:

1. **Fuera sus correturnos**: a quien lo llevaba se le cierra la víspera y lo escrito para después se borra. El diálogo dice quiénes antes de hacerlo y, si no tienen otra plaza, pasan al banquillo. Si una vacante viva tenía prometida una de esas plazas, se avisa para decírselo a Selección; la vacante no se toca.
2. **Cada fijo, su descanso**: los dos empiezan librando lo que libraba el coche, y luego se cambia el de cada uno con su botón (sol para el de día, luna para el de noche).
3. **La marca.** Puede seguir en su cuadrante; está para eso.

**La vuelta** (`volverConCorreturnos`, el mismo botón con `activar: false`) pide el descanso que vuelve a tener el coche, el que cubrirá su correturnos. Tiene la regla de siempre: no puede compartir día con otro bloque de su cuadrante. Los correturnos se ponen después, como en cualquier coche.

## Cómo se ve

- **Tabla**: la marca «Sin correturnos» bajo la matrícula y, en «Descanso», dos botones (el del fijo de día y el de noche). Debajo de cada fijo sale «libra» con sus días. Si en la tabla hay coches con correturnos, en esta fila sus columnas se juntan en una celda con el aviso *«Este coche no tiene correturnos: no se pueden agregar personas en esta matrícula»*. Si **todos** los coches de la tabla son así, las columnas desaparecen.
- **Tarjetas** (vista vertical): lo mismo, con el aviso en el lugar de los CT.
- **Cuadrante**: la cabecera dice «N bloques · M sin correturnos». El CT del cuadrante se reparte solo entre los coches que llevan correturnos; los otros no salen en «¿Qué bloques cubre?». «+ Bloque» no los ofrece, porque no tienen bloque: entran con «Meter en un cuadrante».
- **Parrilla impresa**: en GRUPO pone «Día L/M · Noche X/J», y en las columnas de CT, «Sin correturnos» en blanco, no en amarillo.

## Lo que no es un hueco

El día que libra un fijo, ese turno el coche **no sale, y es lo planificado**:

- En el tablero esa celda lleva `libra: true` y **no suma a «días sin cubrir»**. Tampoco pide correturnos (`falta.ct = 0`), así que el iceberg puede dar el coche por completo.
- En **salidas por coche** (el reporte de turnos) hay un grupo nuevo, `libra` («Libra su fijo · coche sin correturnos»), en lugar de «NO SALE · sin nadie planificado».
- En [[Control]], el cockpit pasa ese `libra` en cada coche y el [[Informe de salidas]] no lo cuenta entre los «coches sin conductor».

**Intercambiar matrícula** mueve la marca con el bloque (tripulación, cuadrante y descanso, ahora por fijo). La marca se cruza **antes** de recolocar, para que la tripulación con CT caiga en un coche que los admita. **Cambiar de coche** (llevarse la tripulación a una matrícula libre) no mueve el descanso, igual que antes; si el destino es un coche sin correturnos, el disparador para a los CT con su mensaje.

## Cómo se probó

Se ensayó contra la base real **sin escribir en ella**, el 15/10/2026. Todo fue en una transacción: copias temporales de las tablas que se escriben y la migración aplicada sobre ellas (vistas y funciones en `pg_temp`). Después, `SET TRANSACTION READ ONLY` (comprobado con el 25006) y el código del planificador por esa conexión; al final, `ROLLBACK`. Con el 0348MMZ salió todo lo esperado:

- se quitan sus dos CT (cerrados ayer);
- cada fijo empieza con L M;
- el de noche pasa a X J;
- la cobertura de 14 días respeta los dos descansos;
- el CT no entra (ni por la pantalla ni por una inserción directa);
- el lunes sale como «libra» en salidas por coche;
- el intercambio con el 8083KXD mueve la marca y los CT de vuelta;
- volver con los días de otro bloque del cuadrante se para.

**Despliegue**: el tablero y la lista de la Plantilla tienen red para el rato entre desplegar y aplicar `db/203`: salen como antes. Del tablero cuelgan Control y el bot, y la Plantilla la usa RRHH a todas horas. Lo demás (salidas por coche, vacantes, asistencia, ficha 360) da error hasta aplicarla, así que hay que aplicarla nada más desplegar.

## Ver también

- [[Planificacion]] · [[Jornada y turnos]] · [[Control]] · [[Informe de salidas]]
