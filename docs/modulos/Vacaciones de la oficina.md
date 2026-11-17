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
- **La oficina** (quien tiene la llave): el [[Componente Listado|Listado]] de todos con su alta, lo generado, lo gastado, lo programado, el saldo y lo que espera; filtros «Con algo por aprobar» y «Sin fecha de alta». Al pulsar a alguien, su ficha en el Panel: sus cifras, «Simular sus vacaciones», y aprobar, no aprobar o anular.

## Las tablas (db/263)

- `usuario.fecha_alta`: desde cuándo trabaja en Telecab. **Se lee y se escribe aparte** de la lectura general del usuario (la del inicio de sesión), como la fecha de nacimiento: si el código llegara antes que la migración, nadie podría entrar. Sin `db/263`, Usuarios lo dice y no deja guardarla.
- `oficina_vacacion`: cada petición, con sus dos días de libranza (`libra_dias`), su estado, quién la pidió, quién la resolvió y por qué. Bajo el libro.

## La API (`/mis-vacaciones/api`)

```
GET  /mis-vacaciones/api/mias                las mías: saldo, meses, vacaciones, reglas, si apruebo
GET  /mis-vacaciones/api/lista               toda la oficina (quien aprueba)
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
test/vacaciones-oficina.test.js                        5 pruebas
```
