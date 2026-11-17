---
tags: [modulo, avisos, hoja-de-ruta, item-3]
actualizado: 2026-11-16
---

# Avisos entre módulos

**Cuando un módulo genera algo que afecta a otro, avisa al área que le toca, y el aviso se queda hasta que alguien lo resuelve** (ítem 3 de la [[Hoja de ruta]], 16/11/2026, rama `avisos/3-avisos`, db/254). Se ven en **la campana**.

## Lo que decidió Camilo (16/11/2026)

1. **El destino es un área de Organización** (Dirección, RR. HH., Administración, Planificación, Control, Taller, Sistemas): «todos los perfiles de Control» son la gente del área Control y su responsable. Un aviso puede ir además a una persona concreta. *No* es la llave del módulo: la de /control la tienen 15 personas, casi toda la oficina.
2. **Leído, cada uno el suyo; resuelto, de todos.** El número de cada uno baja cuando lo lee él. Cuando alguien lo resuelve, desaparece para toda el área y queda quién lo resolvió, cuándo y en qué quedó.
3. **Se resuelve solo si se puede** (la cita se hizo, la J se aprobó); si no, a mano con una nota. Un aviso con hora (una cita) **caduca** al pasar.
4. **La campana pasa a ser la bandeja de avisos**: arriba los avisos, debajo los pendientes de hoy, como estaban. El número sale también en la entrada del módulo en el menú, y los urgentes llegan al móvil.

Y lo que se dejó fuera a propósito: **las alertas de Control no entran** (unas 375 al día; ahogarían el contador y siguen en /alertas); **cumpleaños y efectivo** se quedan como están.

> [!important] Hay que rellenar las áreas
> Los avisos van a la gente de cada área, y las áreas las pone Ignacio en [[Organizacion|/organizacion]]. **Mientras un área no tenga a nadie, sus avisos le llegan a quien reparte las tareas** (`tareas_asigna`, Ignacio): no se pierden, y se ve que falta gente en ella.

## La campana

- **Arriba, los avisos** de su área y los suyos: los sin leer en negrita y con su punto, los urgentes con el filo rojo. Cada uno con su icono, el área («Control» o «Para ti»), hace cuánto y hasta cuándo sirve.
  - **El título** lleva a su pantalla y lo da por leído.
  - **«Leído»** lo marca (solo a quien lo pulsa). **«Marcar todo como leído»**, todos.
  - **«Resuelto»** pide en qué quedó y lo quita para todos.
- **Debajo, los pendientes de hoy** (`/notificaciones`), igual que antes: se calculan al momento y desaparecen solos.
- **El número de la campana suma los dos**: `data-contador="avisos.sin_leer pendientes"` (los [[Contadores]] ya suman varias claves).
- **Al momento**: si llega un aviso con la campana abierta, se repinta (canal `avisos` del [[Tiempo real]]).

## El primer aviso: las citas del taller avisan a Control

`modules/Vehiculos/avisosCitas.js`. Cada **cita pendiente de un coche de Madrid** (las de Barcelona son solo agenda) es un aviso al **área Control**: «Cita del taller: 1234ABC — El jueves 20 de noviembre a las 09:30. Llama a quien lleve el coche para confirmarla», con el enlace a /control/citas-taller. Su número sale en **Taller → Mantenimientos** del menú (la hoja de ruta: «Control ve el contador en el módulo de taller»).

Se cierra solo cuando:

- **Control llama** y apunta lo que dijo (queda a nombre de quien llamó);
- **el conductor la confirma** por WhatsApp;
- **la cita cambia de estado** (hecha, no se presentó, anulada);
- **pasa su hora**: caduca.

## Cómo avisa un módulo

Dos formas, en `services/avisos.js`:

```js
const avisos = require('../../services/avisos');
avisos.registrarTipo('j_rechazada', { etiqueta: 'J rechazada', modulo: 'control', icono: 'fa-file-circle-xmark', area: 'control' });

// 1. Cuando pasa algo, y cuando se resuelve:
await avisos.emitir({ tipo: 'j_rechazada', origenId: j.id, titulo: '…', texto: '…', enlace: '/justificantes?…', urgente: false });
await avisos.resolverPorOrigen({ tipo: 'j_rechazada', origenId: j.id, nota: 'Se llamó', autorId });

// 2. Que se repase solo (como las citas): el tipo dice qué está pendiente y cómo acabó lo demás.
avisos.registrarTipo('cita_taller', { …, abiertos: async () => [...], comoAcabaron: async ids => new Map(...) });
await avisos.pedir('cita_taller');   // tras cada cambio en el módulo (no lanza nunca)
```

- **Un aviso por cosa de origen y tipo en toda su vida**: emitirlo dos veces no lo duplica y, si alguien lo resolvió a mano, el repaso no lo vuelve a sacar.
- **`modulo`** decide en qué entrada del menú sale su número: en `views/layout-gestion.ejs`, la entrada lleva `contador: 'avisos.<modulo>'`.
- **`urgente: true`**: además, notificación al móvil ([[Notificaciones al dispositivo]]) a todos los que lo reciben.
- **El repaso de cada día** (tarea programada `avisos.repaso`, 05:10): pasa a «caducado» lo que pasó su hora y repasa los tipos que lo hacen solos.

## Las tablas (db/254)

- **`aviso`**: tipo, módulo, origen, título, texto, enlace, urgente, destino (área y/o persona), hasta cuándo sirve, quién lo emitió y su final (resuelto, caducado o anulado; quién, cuándo, si lo cerró su módulo y la nota). Bajo el [[Libro de auditoria]].
- **`aviso_lectura`**: quién leyó cada aviso y cuándo, cada uno el suyo. Un disparador impide cambiarla o borrarla.

Los nombres `notificacion` (requerimientos legales al conductor), `aviso_turnos` (el WhatsApp de turnos) y `/avisos/efectivo` (la tarjeta de caja) ya estaban cogidos.

## La API (`/avisos/api`)

```
GET  /avisos/api/mios             → { avisos, sinLeer }
POST /avisos/api/leidos           { ids? }   (sin ids: todos los suyos)
POST /avisos/api/:id/resolver     { nota }
```

De todos los que tienen sesión, como `/contadores`: cada uno ve, lee y resuelve los suyos.

## Lo que queda para más adelante

Pasar uno a uno los avisos de hoy que tenga sentido: los documentos que caducan (hay una consulta sin pantalla), las incorporaciones de Control, la J rechazada que pide volver a llamar… Cada uno es un `registrarTipo` y su enganche.

## Ficheros

```
db/254-avisos.sql                      las tablas
services/avisos.js                     los tipos, emitir, resolver, la bandeja, los números, el repaso
services/repo/avisos.js                el SQL
services/organizacion.js               deArea, areasDeAvisos: quién recibe lo de un área
modules/Avisos/avisos.controller.js    /avisos/api
modules/Vehiculos/avisosCitas.js       las citas del taller avisan a Control
public/assets/js/layout/pendientes.js  la campana
test/avisos.test.js                    3 pruebas, una por decisión
```

Relacionado: [[Contadores]] · [[Tiempo real]] · [[Notificaciones al dispositivo]] · [[Organizacion]] · [[Tablero de tareas]]
