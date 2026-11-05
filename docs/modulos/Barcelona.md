---
tags: [modulo, barcelona, sedes, planificador, horas, taller]
ruta: /barcelona
codigo: modules/Barcelona
fecha: 2026-10-07
---

# Barcelona

Camilo, 07/10/2026: «en el login ahora va a aparecer Barcelona o Madrid». Barcelona **no necesita fichas, altas ni libranzas**: sus conductores son sus **cuentas de BOLT** (nombre y teléfono) y sus matrículas, los **coches de su empresa de BOLT**. Lo que necesita es:

- un **planificador**: cada conductor en una matrícula, de día o de noche;
- un **reporte de horas** con la misma regla que Madrid, y «No salió» cuando no hizo horas;
- su **Visibilidad**, con las mismas métricas que la de Madrid;
- y, desde el 04/11/2026, sus **Mantenimientos**: el taller por kilómetros de sus coches.

Las piezas de datos (de dónde salen sus horas y sus coches, y por qué van en tablas suyas) están en [[Sedes]].

## Se entra eligiendo la sede en el login

El login tiene un selector **Madrid / Barcelona** (se recuerda el último en ese navegador). La sede viaja en la cookie de sesión como el tema (`services/sesion.js`, `SEDES` y `sedeValida`), y se conserva al re-emitirla (cambiar el tema o la contraseña). Ver [[Usuarios y permisos]].

- **Madrid** es el ERP de siempre.
- **Barcelona** cae en `/barcelona` y su menú solo tiene sus pantallas: Planificador, Reporte de horas, Visibilidad y Mantenimientos.
- En las dos, arriba del menú, **«Ir a Madrid» / «Ir a Barcelona»** cambia de sede sin volver a entrar (`POST /sede`).
- **Cualquier usuario** puede elegir Barcelona (Camilo). Por eso `/barcelona` no tiene clave en el catálogo de permisos: lo que no está en el catálogo es libre para quien está dentro.

## El planificador (`/barcelona`)

Una fila por **matrícula** y dos plazas: **día** y **noche**. Al pulsar una plaza se elige el conductor (con buscador, entre las cuentas **activas** de BOLT Barcelona) y **desde qué día**.

**Fijo hasta que se cambie** (lo eligió Camilo frente a planificar día a día). Un cambio no borra el pasado: la asignación de antes se **cierra el día anterior**, así que el reporte de un día viejo sigue sabiendo a quién le tocaba. Si la de antes empezaba ese mismo día o después (una corrección), no llegó a valer y se borra.

- **Una persona por plaza, y una plaza por persona y turno**: lo garantiza la base (`uq_sede_asig_plaza`, `uq_sede_asig_conductor`). Si eliges a alguien que ya estaba en otra matrícula del mismo turno, **se mueve** y la pantalla lo dice.
- «Sin dato» deja la plaza libre.
- La fecha va de **un mes atrás** (para corregir lo que se olvidó) a **dos meses adelante**.
- **Los coches salen de dos sitios**: los de la empresa de BOLT de Barcelona y los de **Vehículos con sede Barcelona** que no están de baja (`barcelona.repo.coches`). Camilo, 07/10/2026: hay coches de Barcelona que aún no están dados de alta en BOLT (la 3035LTX) y hay que poder planificarlos. Vehículos dice de qué sede es cada coche y BOLT, si puede trabajar.
  - Si BOLT conoce el coche, manda BOLT: activo, se ofrece; desactivado, solo sale si alguien lo lleva, atenuado y con su estado.
  - Si BOLT no lo conoce pero Vehículos lo tiene en Barcelona, se ofrece con el aviso **«No está dado de alta en BOLT»**: hasta que se dé de alta, nadie puede trabajar con él en BOLT.
  - El 07/10 eran 18: los 15 activos de BOLT y tres que solo están en Vehículos (3035LTX, 3814KYG y 8512LDS). Un coche que no sea de Barcelona se quita cambiándole la sede en Vehículos.
- Una cuenta desactivada en una plaza sale tachada.
- Abajo, **Sin plaza**: los activos que ese día no están en ninguna matrícula.

Sin db/181 la pantalla lo dice («Falta aplicar la migración db/181») en vez de dar un error.

## El reporte de horas (`/barcelona/reportes`)

Solo descargable, como los reportes de Madrid ([[Control Reportes]]): se eligen las fechas (hasta **31 días**; atajos Ayer, Últimos 7 días y Este mes) y baja un Excel con tres pestañas:

- **Por día**: una fila por día y plaza con conductor. Sus horas en **su turno**, viaje y espera, el coche de BOLT en que trabajó y si salió. Las horas llevan los colores del reporte de Madrid (verde desde 7,6 h, amarillo de 6,4 a 7,5, rojo menos).
- **Por conductor**: su **turno asignado y la matrícula** de su plaza, los días que le tocaba, los que salió y los que no, sus horas y la media de los días que salió. Arriba, quien más días no salió.
- **Sin plaza**: quien trabajó un día sin tener plaza ninguna ese día.

**La regla de las horas es la de Madrid, no una copia**: `repartoTurnos.repartir` ([[Jornada y turnos]]) con el plan del planificador de Barcelona. Quien tiene plaza de **día** cuenta de 00:00 a 24:00; quien la tiene de **noche**, de 12:00 a 12:00 del día siguiente (Camilo: «de 00:00 a 23:59… desde las 12 PM hasta el día Y hasta las 12 PM»). Quien trabaja sin plaza va por su hora de inicio, como los NN. Cuenta el trabajo (viaje y espera), no el descanso; el catálogo de estados es el de Madrid (`fv_estado_bolt`).

**Los estados de cada plaza:**

| Estado | Cuándo |
|---|---|
| Salió | hizo algo en la ventana de su turno y la ventana ya cerró |
| Salió · en curso | ha hecho algo y su ventana sigue abierta |
| Aún no ha salido | su ventana está abierta y no ha hecho nada todavía |
| Por empezar | su ventana no ha empezado |
| **No salió** | tenía plaza y no hizo ni un minuto en su ventana, ya cerrada. Barcelona no tiene libranzas: no hay otra explicación que dar (Camilo) |

En las observaciones se dice si trabajó **en otro coche** que el de su plaza, y lo que hizo **fuera de su turno** ese día (no se suma a su plaza).

**De los apuntes a las horas** (`barcelona.horas.js`). BOLT apunta cambios: cada apunte dura hasta el siguiente del mismo conductor. Dos en el mismo segundo se desempatan como en Madrid (`desempate.js`). Para saber cómo estaba cada uno al empezar la ventana se lee un día más de apuntes por detrás. Y **un estado de trabajo no dura más de 6 h sin otro apunte** (`BARCELONA_TOPE_ESTADO_H`): si el móvil se apaga en espera, BOLT no avisa y la espera duraría días. Con los datos reales del 04 al 07/10 (1.704 apuntes, 1.368 ratos de trabajo) el rato más largo fue de 3 h: el tope no recorta nada normal.

## Las horas semanales (en `/barcelona/reportes`)

Camilo, 07/10/2026: *«las horas semanales también en los reportes de Barcelona, solo de conductores, semanal de horas efectivas en BOLT; también se podrá la semana cursante»*.

- **Un Excel por semana**: cada conductor, de lunes a domingo, con sus horas efectivas en BOLT, el total, los días que trabajó y la media de esos días. Va de menor a mayor, así que arriba queda quien menos ha hecho, como la semanal de Madrid.
- **El turno asignado va al lado del nombre** (Camilo, 07/10: *«faltó la columna del turno asignado»*): columnas **Turno** (Día / Noche) y **Matrícula** detrás del teléfono. Si en la semana cambió de turno o de coche salen los dos («Día / Noche», «1111AAA, 2222BBB»); quien no tuvo plaza ningún día pone **Sin plaza**. Sale de las plazas de cada día (`plazasDistintas` en `barcelona.horas.js`), no de la de hoy.
- **Las horas de un día** son las de su turno de día más las de su turno de noche, con la misma regla que el reporte diario (`barcelona.horas.semana`). Un día no se cierra hasta las 12:00 del siguiente.
- **Salen** las cuentas activas de BOLT Barcelona y cualquiera que haya trabajado esa semana. Las que ya no están activas llevan «(ya no activa en BOLT)».
- **Cada día lleva su nota** con cuánto fue de día y cuánto de noche y en qué plaza estaba (o «Sin plaza»). Un **0 en rojo** significa que tenía plaza y no salió.
- **La semana en curso** también se puede sacar. Los días que aún no han terminado van en azul y los que faltan, en blanco.
- **La semana se elige con el calendario de la casa** (`js-fecha`): cualquier día vale por su semana. Debajo se dice cuál es, y hay atajos para «Esta semana» y «La pasada».

Con datos reales (07/10), la semana del 28/09 da 565,6 h entre 26 conductores, 19 de ellos con horas. **La historia de Barcelona empieza el 30/09 a mediodía**, los 7 días que trajo la ingesta al aplicar db/181: por eso ese lunes y ese martes salen a cero.

## La Visibilidad (`/barcelona/visibilidad`)

Camilo: «con las mismas métricas». Por eso **es la misma pantalla y son las mismas cuentas** que la Visibilidad de Madrid, no una copia: `views/visibilidad.ejs` recibe `api` (dónde preguntar) y `sedeNombre`, y las fórmulas salieron de `services/visibilidad.js` a funciones puras que usan las dos sedes:

- `metricas(h, d)`: horas efectivas, viaje, espera, descanso, utilización, conductores, neto, viajes, €·hora y viajes·hora de una ventana.
- `sliceDeTurno(x)`: las tarjetas de turno (día, noche y la jornada de ayer).
- `armarSerie({ fotos, dm, config, dinero })`: el acumulado, el ideal, el crítico y la brecha del mes, y sus totales.

Al separarlas se comprobó contra producción (solo lectura) que la Visibilidad de Madrid daba **lo mismo antes y después**: agosto, septiembre, octubre sin hoy y el resumen.

Lo que cambia es de dónde salen los datos (`modules/Barcelona/visibilidad.service.js`):

| | Madrid | Barcelona |
|---|---|---|
| Horas | Flota viva (`fv_tramo`) | sus apuntes de BOLT (`sede_bolt_state_log`), pasados a ratos como en el reporte |
| Neto y viajes | `bolt_order` | sus pedidos (`sede_bolt_order`, db/182) |
| Turnos | el cuadrante (`f_cobertura`) | su planificador; quien no tiene plaza, por su hora de inicio |
| Configuración | `visibilidad_config` · `parametros` | `visibilidad_config` · `parametros_barcelona` |
| La serie del mes | fotos diarias (`visibilidad_dia`) | al vuelo: son una veintena de conductores |
| Los gráficos largos (25/10/2026) | fotos + histórico de BOLT (db/217) | sus días al vuelo, desde su primer apunte (30/09/2026) |

**Los gráficos de la tendencia** (25/10/2026: el rango de los días, «cómo vamos» y «cómo hemos crecido», ver [[Visibilidad#Los gráficos (25/10/2026)]]) son las mismas piezas de `services/visibilidadTendencia.js`; Barcelona solo pone sus días (`diasDeLaSede`) en `/barcelona/api/visibilidad/rango`, `/crecimiento` y `/como-vamos`. Su primer día es de media tarde y su septiembre, un día: por eso un % solo se da entre meses con 7 días con datos o más, y el «frente al periodo anterior» de un rango, con el 90 % de sus días.

**«A esta hora»** (30/10/2026, Camilo: *«ponlo también en la Visibilidad de Barcelona»*, ver [[Visibilidad#A esta hora (30/10/2026)]]): hoy contra ayer, anteayer y el mismo día de la semana pasada hasta la misma hora, por día natural, por turno y por jornada. La hora, los días y los % son los de Madrid (`momentoAEstaHora` y `armarAEstaHora` en `services/visibilidad.js`); Barcelona pone sus horas (sus ratos de ocho días) y sus turnos (`repartir` con el plan de su planificador, cortando cada día a esa hora). `/barcelona/api/visibilidad/a-esta-hora`. Al separar las piezas, Madrid dio exactamente lo mismo que antes (26/10 a las 12:28 y a las 10:15).

**Sin meta de partida.** No hay una meta de Barcelona que copiar, y una inventada pintaría un ideal y una brecha que no miden nada. Hasta que se ponga en *Config*, la pantalla enseña las horas sin el ideal, el crítico ni la brecha (en la tabla, «·»). Los coches, si no se dicen, son los activos en BOLT.

Con datos reales de BOLT (07/10, script `barcelona-visibilidad-prueba.js` de los análisis): el 06/10, 121,9 h efectivas, 78,2 % de utilización, 18 conductores, 2.810,98 € y 23,05 €/h.

## Mantenimientos (`/barcelona/mantenimientos`)

Camilo, 04/11/2026: *«habilitar en mantenimientos los coches de Barcelona, replica el módulo en el sistema de Barcelona, con los coches que estén en el ERP como sede Barcelona»*.

**Es el módulo de Madrid con sus coches, no una copia**, como la Visibilidad. La regla de cuándo toca revisión (odómetro de hoy menos el km de la última revisión, el ritmo de los últimos 30 días y el semáforo) vive en `modules/Vehiculos/taller.*` ([[Vehiculos#Taller: el mantenimiento por km]]), y las tablas son las mismas (`mantenimiento`, `odometro_ancla`, `vehiculo_km_dia`). Un apunte es de un coche, y el coche ya dice su sede. Con dos copias habría dos semáforos que tarde o temprano dirían cosas distintas del mismo coche.

- **Los coches** son los de Vehículos con **sede Barcelona** y sin baja: 20 el 04/11. 16 dan su odómetro por el CAN de Mapon (el cron diario los lee igual que los de Madrid). Los otros 4 salen «sin Mapon» y sin odómetro: 2127LZJ, 2928KGL, 8074LXG y 8477LTR. Un coche que se pase a Barcelona en Vehículos aparece aquí y deja de salir en el de Madrid.
- **La pantalla es la de Madrid** (`modules/Vehiculos/vistas/taller.ejs`), que recibe `base` (dónde preguntar), `sedeNombre` y `citasAgenda`. Las tarjetas, la tabla, la ficha, apuntar, anular, anclar el odómetro y el intervalo son los mismos.
- **Mirar** no tiene llave, como el resto de Barcelona. **Apuntar** pide la misma que en Madrid, `/taller/apuntar` (Óscar y los roles que lo pueden todo). La regla está en `taller.service.puedeApuntar`, una sola para las dos sedes.
- **La sede se fija en un solo sitio**, `mantenimientos.service.js`: todo lo que pasa por ahí lleva `sedes: ['barcelona']`, para leer y para escribir. El servicio del taller rechaza una escritura en un coche de otra sede («Ese coche es de otra sede…»), y la ficha no lo abre. El id va en el cuerpo de la petición, así que esconderlo de la lista no bastaba. Vale en los dos sentidos: desde Madrid tampoco se apunta en un coche de Barcelona.
- **El informe** (Excel y PDF) lleva solo sus coches, «· Barcelona» en cada título y se llama `taller-barcelona-AAAA-MM-DD`.
- **El estado «B»** (Baja) que llevan sus coches para que el planificador de Madrid no los ofrezca (db/173) **no se enseña**: en esta pantalla diría «Baja» de 20 coches que trabajan.
### Las citas del taller: solo agenda (04/11/2026)

Camilo: *«pon también las citas del taller para Barcelona… pero sin envíos de WhatsApp… ni confirmaciones, solo agregar citas»*.

- **Se añaden** como en Madrid ([[Citas del taller]]): con el **Excel del taller** o con **«Nueva cita»** (también desde la ficha del coche, «Poner cita»). Las reglas son las mismas: un coche, una cita por día; solo coches de Barcelona dados de alta; el Excel dice qué matrículas no entran y por qué («No es de Barcelona: es de Madrid»).
- **Se ven** en la pestaña «Citas del taller», con su día, su hora y de dónde salen (el Excel o quién la puso), y en el estado de la flota como «Cita puesta para revisión».
- **Se anulan** (Camilo, 04/11/2026: *«ponle también anular las citas»*): cada cita pendiente tiene «Anular», con el **motivo obligatorio**, que queda en su seguimiento con quién la anuló. Sale atenuada con la pastilla «Anulada» y deja de salir en el estado de la flota. Para volver a ponerla, «Nueva cita» ese mismo día: recupera la anulada con la hora nueva, como en Madrid. Solo anular: ni «hecha» ni «no se presentó» (`mantenimientos.service.anularCita`).
- **Y nada más.** Sin quién lleva el coche (eso lo dice el planificador de Madrid), sin aviso por WhatsApp, sin confirmación y sin llamadas de Control. En Barcelona no hay rutas para eso: devuelven 404.
- **Lo que lo decide es la sede del coche**, no la pantalla. Una cita de un coche que no es de Madrid es de agenda (`citas.service.esAgenda`), y avisar, marcarla avisada, la llamada de Control y la respuesta a un botón la rechazan aunque alguien mande su id a mano. El aviso automático de las 10:00 solo busca citas de Madrid (`repo.paraAvisar(fecha, sede)`, que sin sede se niega a buscar). Las listas de Madrid y de Control piden solo las de Madrid.
- Van en la **misma tabla** (`taller_cita`, db/187): no hace falta migración.

## La recaudación del efectivo (`/barcelona/recaudacion`, 05/11/2026, db/230)

Camilo: *«Déjame listo la recaudación de efectivo en Barcelona, de la misma forma»*. Es **la misma recaudación de Madrid** ([[Administracion]]): la misma pantalla y el mismo código, con quincenas, el cierre de BOLT congelado, ajustes con motivo, caja, cambio, transferencias y «¿Cuadra?». Lo que cambia:

- **Su caja y su deuda, aparte.** Van en sus tablas, `sede_recaudacion_cierre` y `sede_recaudacion_movimiento` (db/230: las de Madrid copiadas con `LIKE … INCLUDING ALL`, vacías). Nada de lo que se cobre aquí suma en Madrid, ni al revés.
- **Su efectivo sale de sus pedidos** (`sede_bolt_order`), no de `bolt_order`. db/182 no guardaba el método de pago ni el desglose del precio; db/230 los añade, y la ingesta los guarda desde entonces (`otrasSedes.guardarPedidos`).
- **Sin fichas: cada persona es su cuenta de BOLT** de la empresa de Barcelona (`soloCuentas`). Cobrar, la transferencia, el cambio, el ajuste y la ficha van por la cuenta (`bolt_uuid`), y una cuenta de Madrid se rechaza. En el cuadro salen las que deben algo, las que tienen movimientos y las que tienen el efectivo activado sin estar desactivadas. «En plantilla» quiere decir **cuenta activa en BOLT**.
- **La deuda empieza el 1 de noviembre de 2026** (lo eligió Camilo, para no sacar como deuda lo de octubre). Es el corte, y sale de `PAGO_DESDE` en `services/repo/otrasSedes.js`, que es también desde cuándo se relee el pago. No hay «Pegar a mano»: antes del corte no hay histórico que volcar.
- **Los pedidos de antes de db/230 se releen solos.** Del 1 de noviembre en adelante, los pedidos terminados sin método de pago se le vuelven a pedir a BOLT en la tarea de pedidos de otras sedes (`primerPedidoSinPago`, como mucho de los últimos 31 días). Releídos todos, la ventana vuelve a ser la de 48 h. Hasta entonces, la deuda de esos días sale baja.
- **Antes de aplicar db/230**, los pedidos de Barcelona se siguen guardando como hasta hoy (sin el pago), para que su Visibilidad no se quede sin datos. La recaudación de Barcelona da error hasta que se aplique, y su cron se calla.
- **Llaves propias** (lo eligió Camilo): `/barcelona/recaudacion` para entrar y cobrar, y `/barcelona/recaudacion/nomina` para los descuentos de nómina. Las dos nacen apagadas para todo el mundo, como las de Madrid, y se dan en `/usuarios`. El menú de Barcelona solo enseña «Recaudación» a quien tiene la llave.
- **El cron** de cada media hora (`app.js`) pone al día Madrid y, aparte, Barcelona.

Comprobador: `scripts/comprobar-recaudacion-sedes.js` (sin base: mira que cada sede solo nombre sus tablas y su efectivo).

## Las piezas

```
barcelona.controller.js   las rutas (sin lógica)
mantenimientos.controller.js · mantenimientos.service.js
                          Mantenimientos: el taller de Madrid con la sede fijada en Barcelona
visibilidad.service.js    la Visibilidad: los datos de Barcelona con las cuentas de Madrid
recaudacion.controller.js · recaudacion.service.js
                          la recaudación de Madrid armada con sus tablas, su efectivo y su llave
barcelona.service.js      el planificador (el tablero de un día, las comprobaciones al asignar) y el reporte
barcelona.horas.js        puro: de los apuntes de BOLT a los ratos de trabajo, y el reporte con el plan
barcelona.excel.js        el Excel del reporte
barcelona.repo.js         el SQL: cuentas, coches, asignaciones, apuntes, pedidos (con la sede como parámetro)
vistas/barcelona-planificador.ejs · vistas/barcelona-reportes.ejs
```

Comprobador: `scripts/comprobar-barcelona.js` (sin base: el repositorio se sustituye por datos de mentira).

## Ver también

[[Sedes]] · [[Planificacion]] · [[Vehiculos]] · [[Ingesta]] · [[Jornada y turnos]] · [[Usuarios y permisos]]
