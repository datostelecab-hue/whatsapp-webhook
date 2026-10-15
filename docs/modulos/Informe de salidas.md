---
tags: [modulo, control, pdf, informe, llamadas]
aliases: [Informe de salidas, Informe PDF del histórico, PDF del histórico]
---

# Informe de salidas (PDF del histórico)

Botón **«Informe PDF»** en [[Control]] → `/control/historico` (15/10/2026). Es una hoja para dirección con cómo fue un turno: quién salió, quién avisó de que no saldría, quién faltó sin avisar y qué hizo Control, y qué coches se quedaron sin nadie.

Camilo, 15/10/2026: *«en el reporte del histórico de llamadas que tenemos ahora, necesito un informe en PDF mucho más ejecutivo como el que te acabo de pasar de ejemplo, si puede ser con el formato telecab mucho mejor»*. El ejemplo era un «Informe de salidas · Turno de mañana» que hizo Control a mano. Sobre sacarlo con el turno a medias: *«Está bien que también pueda generar el turno de día ya, para saber cómo va»*. Y se quedó así, sin marcarlo como avance.

| Pieza | Dónde |
|---|---|
| El dibujo y los grupos | `modules/Control/historico.pdf.js` (`resumen`, `frase` y `generar`) |
| El servicio | `control.service.historicoPdf({ dia, turno })` |
| La ruta | `GET /control/historico/pdf?dia=&turno=dia\|noche\|todo` (permiso: el del Histórico) |
| Los coches sin conductor | `historico.service.cochesSinConductor()`, dentro de `parte()` |
| El botón | `controlHistorico.ejs`: `#h-pdf` abre un `Dialogo.formulario` para elegir el turno |
| Comprobador | `scripts/comprobar-historico-pdf.js` (24 casos) |

## Qué cuenta

Sale del **mismo parte del día** que la pantalla y el Excel (`historico.service.parte`), así que los tres cuentan lo mismo. Hay tres opciones: **turno de día** (05:00 a 17:00), **turno de noche** (17:00 a 05:00) o el **día completo**. Quien dobla (TodoTurno) va en los dos turnos.

Cada persona del plan cae en **un solo grupo**:

- **Salieron**: salió, está conectado o está en descanso. Cuenta aunque tuviera un «No saldrá» puesto: si salió, salió.
- **No saldrán**: no salió y tiene «No saldrá», con su motivo, el comentario y quién lo puso.
- **Sin avisar**: no salió y nadie avisó. Debajo va la **última llamada** (hora, agente, caso y nota) o, en rojo, **«Sin llamada de Control»**, y la J si la hay.
- **Aún no les tocaba**: el turno no había empezado al generarlo. Solo sale si hay alguien.

Arriba van **cuatro cifras**: salieron, no saldrán, sin avisar y **coches sin conductor**. Debajo, una barra con el mismo reparto, una frase que lo cuenta y una franja con lo que hizo Control: llamadas a cuántos conductores, alertas atendidas y sin atender, J aprobadas y pendientes, y quién rodó fuera del plan. Luego vienen los nombres: primero lo que hay que explicar y, al final, quién salió (a dos columnas, con hora de la primera conexión y coche) y la tabla de llamadas por agente y de alertas por tipo.

## Las reglas que no se ven

**Un coche sin conductor es una plaza que nadie cubría.** Cuenta así si es operativo, está en el plan y tiene la celda de ese turno vacía. No es el descanso del coche, porque ese día lo cubre su correturnos. Pero la celda del cockpit solo trae el **nombre**, y hay celdas con persona y sin nombre: alguien que ya no está en la plantilla del planificador, como una baja voluntaria del mismo día (pasó el 14/10 con el 9528MMX). Por eso también se mira si alguien del plan de ese turno lleva el coche. Ese mismo caso salía **sin nombre** en el histórico; ahora `parte()` completa el nombre desde la ficha (`historico.repo.nombres`).

**Sin la actividad de BOLT no hay informe.** Si el núcleo no responde, el cockpit pone a todos «pendiente» y el PDF diría «salieron 0, a 57 aún no les tocaba». Pasó en una prueba. Por eso `parte()` dice `hayActividad`, y sin ella el servicio da un error claro que la pantalla enseña en un aviso. Por lo mismo, el botón pide el PDF con `fetch` en vez de `location.href`: si falla, no queda una página en blanco con un JSON.

**Formato de la casa**, como los demás PDF (asistencia, cascada de km, Sankey): pdf-lib dibujado en nativo, cabecera oscura con el logo, filo oro y Helvetica. Las fuentes estándar solo escriben WinAnsi: los acentos, la ñ, el «·» y las comillas entran, pero las flechas, los emojis y los saltos de línea se traducen o se quitan (`L()`). No hay IBM Plex porque haría falta `@pdf-lib/fontkit` y la fuente embebida. A4 vertical, y las listas pasan de página repitiendo el título de la sección «(sigue)».

## Ver también

- [[Control]] (el Histórico y de dónde salen las llamadas) · [[Control Reportes]] (el Excel del mismo histórico)
