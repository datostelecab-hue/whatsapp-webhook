---
tags: [nucleo, contadores, menu, hoja-de-ruta]
actualizado: 2026-11-16
---

# Contadores

Desde el 16/11/2026 **todos los números del menú y de la barra salen de un mismo sitio**. Es la pieza A9 de la [[Hoja de ruta]]. Antes había tres contadores sueltos, cada uno con su petición y su reloj:
- la campana, cada 2 minutos;
- los cuadros de tickets, cada 2 minutos;
- la chapa de correcciones de fichaje, cada 5 minutos.

Con el menú plegado, solo se veía el de Pendientes.

## Cómo se usa desde un módulo

```js
// 1. El módulo registra su FUENTE: los números de quien mira.
const contadores = require('../../services/contadores');
contadores.registrarFuente('vacaciones', {
  async contar(quien) {                 // quien = { id, rol, permisos }
    if (!puedeAprobar(quien)) return {};
    const n = await cuantasPorAprobar();
    return { 'vacaciones.porAprobar': { n, titulo: `${n} por aprobar` } };   // o solo el número
  },
});

// 2. Cuando cambia, lo avisa: las pantallas lo vuelven a pedir al momento.
contadores.cambio('vacaciones');                  // a todos
contadores.cambio('vacaciones', { para: [42] });  // solo a esos
```

```html
<!-- 3. Su marca, en la entrada del menú (`contador` en layout-gestion) o donde sea: -->
<span class="tc-contador tc-contador-menu" data-contador="vacaciones.porAprobar" hidden></span>
```

- **`permisos`** es la lista de llaves de esa persona, o `null` si su rol lo ve todo. Cada fuente decide con eso qué cuenta: **nadie recibe el número de algo que no puede abrir**.
- **`tono: 'info'`** lo pinta en azul (algo que mirar, sin prisa). Sin tono, en rojo (algo por hacer).
- **`titulo`** sale al pasar el ratón.
- **Una fuente que falla o tarda más de 4 s no tapa a las demás:** se queda fuera esa vez, y se apunta en el log.

En una entrada del menú basta con `contador: 'la.clave'` en `layout-gestion.ejs`; la marca la pone el layout.

## Lo que hace solo

- **Una sola petición** (`GET /contadores/api`) trae todos los números de quien mira, y `public/assets/js/contadores.js` los pinta en cada `data-contador`.
- **Con 0 se esconde**; con más de 99 dice «99+».
- **Una marca puede sumar varias claves**, separadas por espacios (16/11/2026, ítem 3): la campana lleva `data-contador="avisos.sin_leer pendientes"`. Va en azul solo si todas lo son.
- **Cada grupo del menú suma los de sus entradas** (`data-contador-grupo`). Así, con el grupo cerrado se ve que dentro hay algo. Va en rojo si alguno de dentro lo es; si no, en azul.
- **Con el menú plegado**, cada contador va sobre la esquina de su icono: el de cada entrada suelta y la suma de cada grupo.
- **Se refrescan al momento** cuando una fuente avisa de un cambio, por el [[Tiempo real]] (canal `contadores`). Si no avisa, cada 2 minutos con la pestaña a la vista y al volver a ella.
- **Lo contado se recuerda 10 s por persona:** con cinco pestañas abiertas y un aviso, se cuenta una vez y no cinco. Un cambio lo olvida.
- **Tras avisar de un cambio, cada pestaña espera entre 0,3 y 1,5 s al azar** antes de pedir: si hay veinte abiertas, no piden en el mismo milisegundo.

`Contadores.alCambiar(fn)` es para quien pinta los suyos a su manera: los cuadros de tickets enseñan el 0 y se ponen en oro. `Contadores.refrescar()`, tras hacer algo que cambia un número.

## Las fuentes de hoy

| Fuente | Claves | Dónde se ven | Cuándo avisa |
|---|---|---|---|
| `pendientes` (`routes/notificaciones.js`) | `pendientes` | La entrada «Pendientes» y la campana. El mismo total de siempre, según el rol | Al crear un ticket de soporte o cambiar su estado. Lo demás de la campana (selección, plantilla, vacantes), en el refresco de 2 min |
| `tickets` (`modules/Ticketera/ticketera.controller.js`) | `tickets.RRHH`, sus partes (`tickets.RRHH.nomina`…) y `tickets.RRHH.otros`; `tickets.ADMIN`, `.TRAFICO`, `.TALLER`, `.OPERACIONES` | Los cuadros de la barra de arriba, solo las bandejas que puede abrir | Al entrar tickets nuevos, al cambiar el estado, al reclasificar y al aplicar |
| `fichaje` (`modules/Fichaje/fichaje.service.js`) | `fichaje.correcciones` (azul) | La entrada «Fichar jornada», solo para quien tiene la llave de aprobar | Al pedir, retirar o resolver una corrección |

Los avisos se ponen en lo que **exporta** cada servicio (`avisaTras`): así no se olvida en ninguna ruta.

**La lista de la campana se pide al abrirla**, y así sale al día. Antes se pedía cada 2 minutos aunque nadie la abriera. El número es el contador `pendientes`.

## Ficheros

```
services/contadores.js                        las fuentes, recuentos, cambio
modules/Contadores/contadores.controller.js   GET /contadores/api
public/assets/js/contadores.js                el componente (en layout-gestion)
public/assets/css/telecab.css                 .tc-contador (y --info, -menu, -campana)
test/contadores.test.js                       7 pruebas
```

## Pendiente

- Los contadores de cada módulo al tocarlo. Por ejemplo, vacaciones por aprobar (Laura), justificantes pendientes y alertas de control. Con ellos, la suma de los grupos se verá de verdad.
- Quitar `/bandejas/api/pendientes`, que ya no la usa la barra (se dejó por si alguien la llama a mano).
- Que el aviso de un cambio vaya solo a quien le afecta (`para`) en las fuentes que lo sepan.
