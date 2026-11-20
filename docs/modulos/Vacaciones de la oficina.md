---
tags: [modulo, vacaciones, oficina]
actualizado: 2026-11-17
---

# Vacaciones de la oficina

Las vacaciones de **la gente de la oficina** (los usuarios del ERP, no los conductores: esos están en [[Vacaciones]]). Pantalla **`/mis-vacaciones`** («Mis vacaciones» en el menú), db/263.

Camilo, 17/11/2026: *«Vamos ahora con el módulo de vacaciones pero para los de la empresa, los que estén dentro de Telecab y tengan su fecha de alta … También que haya un simulador de vacaciones y que también escoja los días de libranza de cada quién. Los días de vacaciones se generan también igual, límite de 1,84 por mes, solo que sume los días de lunes a viernes como dicen los parámetros … No tengas en cuenta los fichajes sino los días que va trabajando hasta ahora, y que en el simulador, también sume los futuros días que ya tendrá generados para la fecha en que se va de vacas. Por ejemplo, hoy tengo 10, pero si en el simulador pongo que empiezo el otro mes las vacaciones, debe de contarme 11,84 días para usar»*.

## Lo que decidió Camilo (17/11/2026)

1. **Cada uno ve las suyas.** Quien tiene la llave de **Usuarios y permisos** (o el desarrollador) ve las de todos, en la pestaña «La oficina».
2. **La fecha de alta la pone quien tiene esa llave**, en [[Usuarios y permisos]] (la ficha de cada persona: «Fecha de alta en Telecab»). Sin fecha de alta no se genera nada ni se simula.
3. **Se piden desde el simulador**, con sus dos días de libranza, y **las aprueba o no** quien tiene la llave. Pedidas, no restan.
4. **El tope es 1,84 al mes**: un parámetro, `oficina.vacaciones.tope_mes` ([[Parametros]]). El de los conductores sigue siendo 1,85.
5. **Genera cada día del horario de la oficina**, de lunes a viernes como dice Parámetros, **aunque sea festivo o esté de vacaciones**.

## La cuenta

| | Qué | Cómo |
|---|---|---|
| **+** | Generadas | **Cada mes completo, 1,84 justos**, tenga los días laborables que tenga. **El mes que va en curso** (y el de la fecha de alta, si entró a mitad), **el promedio por cada día real del horario** (`oficina.madrid.horario`: de lunes a viernes), festivos y vacaciones incluidos, sin pasar de 1,84. Sin fichajes: los días que van pasando. Quien entró antes de 2026 empieza el **01/01/2026**, como los conductores. |
| **−** | Gastadas | Los días de unas vacaciones **aprobadas** que ya pasaron y no son **sus dos días de libranza** ni **festivos de la oficina**. |
| | Programadas | Lo mismo, de las aprobadas que aún no han llegado: no tocan el saldo de hoy; se enseña lo que quedará. |
| | Pedidas | Las que esperan aprobación: no restan. |

**Para usar hoy** = generadas − gastadas. Puede ser negativo.

## El promedio: 1,84 cada mes (17/11/2026)

Primero eran 0,084 por día laborable con un tope de 1,84. Camilo preguntó cuánto daba de verdad un día (0,0831: el tope recortaba los meses de 22 y 23 días, y febrero no llegaba) y decidió: *«saca un promedio con eso, y que se calculen los días así tal cual, pero que el límite sea 1,84. Si se pasa, se baja a 1,84 y si no alcanza, entonces que igual quede en 1,84»*.

- **Un mes completo da 1,84**, tenga 20 o 23 días laborables: 22,08 al año.
- **El promedio por día** es el tope entre los días del horario de un mes medio: 5 × 365,25 / 7 / 12 = **21,74**, y 1,84 / 21,74 = **0,0846**. Sale del parámetro del tope y del horario: si cambian, cambia.
- Se usa en el mes que aún no ha acabado (el de hoy) y en el de la fecha de alta si entró a mitad: días reales × 0,0846, sin pasar de 1,84. El último día del mes, el mes se completa y vale 1,84.

## El simulador

Las fechas y **sus dos días de libranza** (por defecto los dos que no son del horario: sábado y domingo). Dice:
- los días naturales, las libranzas y los festivos, y **los que gastaría** (lo ya aprobado no se cuenta dos veces);
- **lo que tendrá ese día**: lo de hoy **más lo que generará hasta el día antes de irse**, menos lo ya programado. Si se va el mes que viene, suma lo de este mes que falta y lo que haga falta del siguiente (el ejemplo de Camilo: hoy 10, el otro mes 11,84). Si empiezan mañana, no suma nada;
- **lo que le quedará al volver**: lo de antes, menos lo que gaste, **más lo que genera durante las propias vacaciones** (*«con el número promediado, súmale al banco de vacaciones para que simule bien con los días reales de esa fecha»*);
- un calendario con los días que gastan y, **debajo de cada día, el banco al acabarlo**: cada día laborable suma 0,0846 (también en vacaciones) y cada día que gasta resta 1; cuando un mes se completa, cuadra en 1,84.

Desde ahí **las pide** (con una nota si hace falta). Se piden de hoy en adelante, sin pisar otras pedidas o aprobadas.

## Pedir, aprobar, no aprobar, retirar, anular

- **Pedir**: llega una notificación a quien tiene la llave, y su menú lleva el número de las que esperan (`vacaciones_oficina.pedidas`).
- **Aprobar** o **no aprobar** (con motivo, que le llega a quien las pidió): quien tiene la llave.
- **Retirar**: quien las pidió, mientras esperan.
- **Anular** unas aprobadas (con motivo): quien tiene la llave.
- Nada se borra: todo cambia de estado (`pedida`, `aprobada`, `rechazada`, `anulada`) y queda en el libro de auditoría.

## La pantalla

- **Mías**: las cifras (para usar hoy, generadas, gastadas, programadas, pedidas), «Simular y pedir», sus vacaciones con su estado (y «Retirar» las que esperan) y el mes a mes.
- **La oficina** (quien tiene la llave), arriba **«Vacaciones por meses»**: la parrilla de la bitácora (abajo), y debajo el [[Componente Listado|Listado]] de todos con su alta, lo generado, lo gastado, lo programado, el saldo y lo que espera; filtros «Con algo por aprobar» y «Sin fecha de alta». Al pulsar a alguien, su ficha en el Panel: sus cifras, «Simular sus vacaciones», y aprobar, no aprobar o anular.

## Los festivos no gastan (17/11/2026)

Camilo: *«los festivos también se saltan en las vacaciones, ten en cuenta que el festivo seguro del otro año es el 1 de enero para que sepas que en diciembre hay varios días festivos y esos no restan»*.

- Son los del calendario de Madrid (`calendario.de('madrid').festivos`): los nacionales, los de la Comunidad y los locales de la oficina (San Isidro, la Almudena). En diciembre de 2026: el **7** (Constitución, trasladado), el **8** y el **25**.
- De los años que aún no están cargados, van siempre los seguros: el **1 de enero** y el **6 de enero** (Reyes; Camilo: *«añade eso»*), hasta dos años vista, lo que alcanza el simulador. Unas vacaciones del 28/12 al 03/01 gastan 4 días, no 5; del 04/01 al 08/01/2027, 4. Cuando se carguen los festivos de 2027 con su migración, son los mismos días y entran solos.
- **Antes de este día no se descontaba ninguno**: el calendario no enseñaba sus festivos fuera de `esHabil` y la cuenta los tomaba como vacíos. Ahora el calendario los expone (`festivos`, una copia).

## «Vacaciones por meses» de la oficina (17/11/2026)

Camilo: *«Hazlo tipo calendario para saber gráficamente quién se va y cuándo»* y, en seguida, *«ya hay algo parecido en bitácora llamado "Vacaciones por meses", recicla ese»*. Es esa parrilla, sacada a la pieza global `VacacionesPorMeses` (`public/assets/js/vacacionesPorMeses.js`, clases `.tc-vpm-*` en `telecab.css`), que usan las dos pantallas:

- **Seguida, no mes a mes** (Camilo: *«que no se vea mes a mes sino que se pueda arrastrar como en la bitácora general para saber quién pisa a quién en los lapsos y no se partan por los meses»*): una sola tira de días, de enero de 2026 a la última vacación (como mucho 15 meses vista), que **se arrastra con el ratón** (o con la rueda y Mayúsculas, o con los botones ‹ Ir a hoy ›). El nombre y la cabecera se quedan quietos; el nombre del mes, a la vista. Al abrirla, hoy con diez días de antes; al repintar (aprobar, registrar…), se queda donde estaba.
- Cada vacación es **una barra entera** aunque cruce de mes. Una fila por persona: primero quien tiene algo de hoy en adelante, por fecha de salida (la escalera de quién pisa a quién); después quien solo tiene pasadas.
- Dentro de la barra: **disfrutadas**, sólidas; **programadas**, rayadas; las que **esperan aprobación**, en ámbar con el borde discontinuo; y **en gris los días que no gastan** (sus dos de libranza y los festivos). Fines de semana y festivos, de fondo; hoy, con su columna.
- **«A la vez»**: cuánta gente falta cada día (solo lo aprobado y solo los días que gastan). Junto al nombre, los días que gasta en toda la tira (las que esperan, también).
- Cifras: de vacaciones hoy, con vacaciones programadas, **lo más lleno que viene** (cuántos a la vez y qué día), las que esperan aprobación y quién no tiene ni un día este año (la lista, al final).
- Pulsar a alguien abre su ficha en el Panel, donde se aprueba. Aprobar, pedir o anular repinta la parrilla y el Listado.

## Si una petición cuadra o se pasa (17/11/2026)

Camilo: *«pedí 12 y tengo 9,22… cuando llegue al 24 de diciembre sí me cuadran, por lo que al aprobar debe de decir la predicción también, si me paso o no me paso: si me paso, en rojo y cuántos días; si no, en verde y los días de más»*.

- Cada petición que espera lleva su **previsión**, con la cuenta del simulador como si se aprobara: lo que tendrá **el día que se va** (con lo que genere hasta entonces) y lo que le quedará **al volver**, contando lo que genera durante las vacaciones.
- Decide el «al volver»: **en verde «Sobran X días»** si llega; **en rojo «Se pasa X días»** (y la fila teñida) si no. Debajo, «tendrá N al irse». Pasando el ratón, el detalle.
- Su caso: del 24/12/2026 al 12/01/2027 gasta 11 (el 1 y el 6 de enero no cuentan); al irse tendrá 11,49 y al volver le sobran 1,56: en verde.
- **Aprobar una que se pasa pide confirmación** («Aprobar igualmente»). El aviso a quien aprueba ya dice si se pasa o cuánto le sobra.
- En la ficha, las libranzas van bajo las fechas: la tabla cabe en el Panel sin desplazarse de lado.

## Registrar unas ya disfrutadas (17/11/2026)

Camilo: *«déjame registrar vacaciones de la oficina del pasado, de tal a tal fecha el usuario disfrutó X días, para que así se resten con los que tenga hoy en día… si tengo 9, pero me fui del 20 al 30 de agosto, serían 7 días que disfruté ya que los días sábados y domingos no cuentan»*.

- En la ficha de cada persona («La oficina» → pulsarla), **«Registrar unas ya disfrutadas»**: primer y último día, sus dos días de libranza (por defecto sábado y domingo) y una nota.
- Antes de guardar dice cuántos días gastan (sin libranzas ni festivos) y cómo queda su saldo: del 20 al 30 de agosto de 2026, 7 días.
- Entran **ya aprobadas** y se restan como cualquier otra. Solo quien aprueba, para cualquiera de la oficina (también para sí). Tienen que haber empezado antes de hoy (las que vienen se piden desde el simulador) y desde el 01/01/2026. No se registran encima de otras. A la persona le llega un aviso.
- Si se registran mal, se anulan con motivo como unas aprobadas.

## Las tablas (db/263)

- `usuario.fecha_alta`: desde cuándo trabaja en Telecab. **Se lee y se escribe aparte** de la lectura general del usuario (la del inicio de sesión), como la fecha de nacimiento: si el código llegara antes que la migración, nadie podría entrar. Sin `db/263`, Usuarios lo dice y no deja guardarla.
- `oficina_vacacion`: cada petición, con sus dos días de libranza (`libra_dias`), su estado, quién la pidió, quién la resolvió y por qué. Bajo el libro.

## La API (`/mis-vacaciones/api`)

```
GET  /mis-vacaciones/api/mias                las mías: saldo, meses, vacaciones, reglas, si apruebo
GET  /mis-vacaciones/api/lista               toda la oficina (quien aprueba)
GET  /mis-vacaciones/api/calendario          «Vacaciones por meses»: periodos, festivos, quién no tiene ninguna (quien aprueba)
POST /mis-vacaciones/api/registrar           { usuarioId, desde, hasta, libra, nota }  unas ya disfrutadas (quien aprueba)
GET  /mis-vacaciones/api/personas/:id        las de una persona (quien aprueba, o uno mismo)
POST /mis-vacaciones/api/simular             { desde, hasta, libra: [d, d], usuarioId? }
POST /mis-vacaciones/api/pedir               { desde, hasta, libra, nota }
POST /mis-vacaciones/api/:id/aprobar
POST /mis-vacaciones/api/:id/rechazar        { motivo }
POST /mis-vacaciones/api/:id/retirar
POST /mis-vacaciones/api/:id/anular          { motivo }
POST /usuarios/alta                          { id, fecha }   la fecha de alta (Usuarios y permisos)
```

De toda la oficina, como `/tablero`: no está en el catálogo de permisos y quién ve qué lo decide el servicio.

## Ficheros

```
db/263-vacaciones-oficina.sql                          la fecha de alta y las vacaciones de la oficina
modules/VacacionesOficina/vacacionesOficina.service.js la cuenta (saldoDe, pura), el simulador y pedir/aprobar
modules/VacacionesOficina/vacacionesOficina.repo.js    el SQL
modules/VacacionesOficina/vacacionesOficina.controller.js  /mis-vacaciones
modules/VacacionesOficina/vistas/misVacaciones.ejs     la pantalla
public/assets/js/vistas/VacacionesOficina/misVacaciones.js  «Mías», el simulador y «La oficina»
public/assets/js/vacacionesPorMeses.js                 la parrilla «Vacaciones por meses» (global, también la bitácora)
test/vacaciones-oficina.test.js                        8 pruebas
```

## Los permisos: asuntos propios y teletrabajo (18/11/2026, db/271)

Camilo: *«que también podamos solicitar 2 días de asuntos propios o permisos especiales, como medio día de teletrabajo, todo un día de teletrabajo, etc., y que quede un histórico de esos permisos»*.

En el mismo bloque de «Mis vacaciones» (`/mis-vacaciones`), debajo de las vacaciones, con su propio histórico:

| Qué | Cómo |
|---|---|
| **Asuntos propios** | Un **banco aparte** de **2 días al año natural** (parámetro `oficina.asuntos_propios.al_ano`), desde su alta o desde 2026 si entró antes. Enteros, sin prorratear. Lo que no usa **se acumula**. **No restan vacaciones** (como en los conductores, db/225). |
| **Teletrabajo** | Día completo, o **media mañana** o **media tarde**. **Sin cupo**: se pide, lo aprueba quien lleva Usuarios y permisos, y no consume nada. |

- **Una solicitud son sus días.** Cada día laborable del rango (sin festivos ni fines de semana) es una fila, con el mismo `grupo`. Aprobar, no aprobar o anular es de una vez. El medio día es siempre un solo día.
- **Los días de asuntos propios generan vacaciones** igual que los demás: el saldo de la oficina se calcula por días del calendario del horario, no por días trabajados, así que no hay que tocar nada.
- **El banco se mira al pedir.** Lo que se pasa se deja pedir, en rojo, con los días de más; quien aprueba lo ve antes de aprobar y se le pide confirmación.
- **No se pide un día que ya tiene un permiso que lo ocupe** (las dos mitades de un día sí pueden pedirse por separado) **ni unas vacaciones**.
- **El histórico no se borra.** Se ve lo aprobado, lo no aprobado, lo retirado y lo anulado, con quién lo resolvió y por qué. Quien pidió puede **retirar** el suyo mientras espera; quien aprueba puede **anular** uno aprobado (con motivo).
- **Quien lleva Usuarios y permisos** ve arriba, en el mismo bloque, lo que espera aprobación de toda la oficina, y el número en el menú («Mis vacaciones»).

```
db/271-oficina-permisos.sql                    la tabla (una fila por día, con su grupo) y la auditoría
services/parametros.js                         oficina.asuntos_propios.al_ano (2)
modules/VacacionesOficina/vacacionesOficina.service.js   el banco, las reglas, el histórico y la aprobación (sección de los permisos)
modules/VacacionesOficina/vacacionesOficina.repo.js       el SQL de los permisos
modules/VacacionesOficina/vacacionesOficina.controller.js /mis-vacaciones/api/permisos/*
public/assets/js/vistas/VacacionesOficina/permisosOficina.js   el bloque: el banco, pedir, el histórico y lo que espera aprobación
test/vacaciones-permisos.test.js               4 pruebas: el banco, los días, el flujo completo y el banco que se pasa
```

## Permiso retribuido, permisos pasados y permisos en el mapa (20/11/2026, db/272)

Camilo: *«Que aparezca en el mapa que hicimos de meses los permisos especiales, permisos retribuidos y asuntos propios, a parte de apuntar asuntos propios pasados o permisos especiales/retribuidos pasados para verlo en el tablero también»*.

- **Tipo nuevo, «Permiso retribuido o especial»** (`retribuido`, db/272 amplía la regla de `oficina_permiso.tipo`): matrimonio, nacimiento, fallecimiento, mudanza, médico… Sin banco y sin restar vacaciones, pero **siempre con su motivo** (sin él, el servidor no lo deja pedir ni apuntar). Los especiales y los retribuidos son el mismo tipo.
- **Apuntar un permiso pasado** (`registrarPermiso`, `POST /mis-vacaciones/api/permisos/registrar`): como «Registrar unas ya disfrutadas». Solo quien aprueba; solo lo que ya acabó (antes de hoy) y desde el 01/01/2026; no encima de otro permiso ni de unas vacaciones. Nace **aprobado** y le llega aviso a la persona. Los asuntos propios restan de su banco aunque se pase (ya ocurrió): lo dice `sePasa` y la pantalla lo avisa. Botón «Apuntar un permiso pasado» en el mapa de «La oficina» y en la ficha de cada persona.
- **En «Vacaciones por meses»** salen los **asuntos propios en violeta** y los **permisos retribuidos en verde**, una barra por solicitud (de su primer a su último día; el fin de semana en medio, en gris), con lo pendiente con el borde discontinuo como las vacaciones. **El teletrabajo no sale**: quien teletrabaja no falta. Cuentan en «a la vez» (esa persona falta, y la fila pasa a decir «fuera»), pero no en las cifras de arriba ni en los días de vacaciones de cada persona, ni la sacan de «Sin vacaciones todavía». La pieza global (`vacacionesPorMeses.js`) lo hace con `clase` y `etiqueta` en cada periodo; sin `clase` (la bitácora de los conductores) todo sigue igual.

## 2026 entero ya, y 22 cada 1 de enero desde 2027 (20/11/2026)

Camilo: *«Que a cada uno le salgan las generadas al cierre de 2026, que se vaya descontando con las disfrutadas y se renueven 22 cuando sea 1 de enero de 2027»*. Decidió en el chat: lo que sobre o falte de 2026 **se suma** a los 22; los 22 entran **enteros** el 01/01; quien entra a mitad de año, **la parte proporcional**.

- **2026 se ve entero desde ya**: «Generadas» es lo que habrá generado al cierre del año (1,84 por mes completo desde su alta; el mes del alta, el promedio por día, como siempre). De ahí se van restando las disfrutadas; las programadas, aparte. Quien entró antes de 2026: 22,08 (12 × 1,84).
- **Desde 2027, cada 1 de enero entran 22 de una vez** (parámetro `oficina.vacaciones.dias_ano`, en Parámetros). El año de su alta, la parte proporcional de los días naturales que le quedan al año (alta el 02/07/2027: 22 × 183/365 = 11,03). Lo que sobra o falta se arrastra: es un banco.
- **El simulador y la previsión al aprobar** usan la misma cuenta: en 2026 no hay nada más que generar antes ni durante unas vacaciones, y si cruzan el 1 de enero, ese día suman los 22 del año nuevo (del 24/12/2026 al 12/01/2027, alta el 17/06/2026: al irse 11,89, al volver 22,89).
- **«Mes a mes»** enseña los doce meses de 2026 y, desde 2027, una fila por año («Año 2027: + 22, los 22 del año, el 01/01»). `saldoDe` (`generadasHasta`), con `anual`; el resto del módulo no cambia.
