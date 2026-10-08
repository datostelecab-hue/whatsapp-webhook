---
tags: [modulo, taller, vehiculos, control, whatsapp, postgresql]
aliases: [Citas de taller, Citas del taller, Citas de mantenimiento]
---

# Citas del taller

El taller manda un Excel con las citas de mantenimiento de los coches. Se sube en **Mantenimientos** (`/taller`, pestaña «Citas del taller») y cada cita sale con **quién lleva el coche ese día y a esa hora** según el planificador. Dos días antes, el sistema le avisa por WhatsApp. **Control** (`/control/citas-taller`) le llama para que la confirme y apunta lo que diga.

Lo pidió Camilo el 08/10/2026 para usarlo ese mismo día con el Excel real (`MOBILITY.xlsx`, 40 citas del 09/10 al 29/10).

| Pieza | Dónde |
|---|---|
| Reglas: Excel, responsable, aviso, botones, llamadas | `modules/Vehiculos/citas.service.js` |
| Datos | `modules/Vehiculos/citas.repo.js` · tablas `taller_cita` y `taller_cita_seguimiento` (db/187) |
| Pantalla de Mantenimientos | pestaña en `modules/Vehiculos/vistas/taller.ejs` · rutas `/taller/api/citas…` |
| Pantalla de Control | `modules/Control/vistas/controlCitasTaller.ejs` · rutas `/control/citas-taller` y `/control/api/citas-taller…` |
| Lo que pintan igual las dos | `public/assets/js/citasTaller.js` |
| El aviso de dos días antes | cron `0 10-20 * * *` en `app.js` (se apaga con `CITAS_TALLER_AVISOS=off`) |
| Los botones del conductor | `routes/botPuertas.js` → `handleTemplateButton` |
| La plantilla | `cita_taller` en `scripts/crear-plantillas-whatsapp.js` → [[PLANTILLAS-WHATSAPP]] |
| Comprobador | `node scripts/comprobar-citas-taller.js` |

## El Excel

Cuatro columnas, buscadas **por su título** y no por su posición: `MATRICULA`, `VEHICULO`, `CITA TALLER` (el día) y `HORA`. El día y la hora vienen como fecha y hora de Excel, pero también se entienden escritos («10/10/2026», «10:00»). Si una fila no se entiende, **no se importa nada** y se dice qué fila falla y por qué.

- **Una cita es un coche y un día.** Subir el mismo Excel otra vez no duplica nada. Si el taller cambia la hora, se cambia en la misma cita. Si ya se había avisado de la otra hora, **el aviso y la confirmación se borran** para volver a avisar; quedan apuntados en el seguimiento.
- **Solo los coches de Madrid dados de alta en Vehículos.** Lo demás no se cita, y el informe de la subida dice por qué: «No está en el sistema», «No es de Madrid: es de Barcelona» o «Está dado de baja en Vehículos». Con el Excel real fueron el **1888LTJ** y el **0970LJJ**, de Barcelona, y el **7750KYT**, que no está dado de alta.
- **Las de días que ya pasaron no se importan.**
- Las que ya había entre esas fechas y **no vienen** en el Excel nuevo **no se anulan solas**: se listan, por si el taller las ha quitado, y se anulan a mano con «Estado».

## Quién la lleva: el planificador, cada vez

El responsable **no se guarda**: es quien cubre ese coche, ese día y en ese turno en `f_cobertura`, la misma regla que el cuadrante. Se pregunta cada vez que se pinta la cita, porque el cuadrante cambia hasta el último momento.

- **El turno sale de la hora.** De 05:00 a 17:00 es el turno de día; de 17:00 a 05:00, el de noche. Una cita antes de las 05:00 cae en **la noche del día anterior**. Las del taller son de 09:00 a 13:00, así que son del turno de día.
- Si en ese turno hay más de uno, va primero el fijo y después el correturnos.
- **Si nadie lleva el coche a esa hora**, la cita lo dice en ámbar: «que lo coloque Tráfico», con quién lo lleva en el otro turno por si sirve. Con el Excel real pasó en 6 de 37.
- Lo que sí se guarda es **a quién se avisó**. Si después el cuadrante pone a otro, la cita lo avisa: «Se avisó a Pedro: ahora lo lleva Juan. Hay que avisarle a él».

## El aviso

**El sistema avisa solo dos días antes, y solo ese día.** El cron va a las 10:00 y, si a alguno no le llega el aviso (sin teléfono, nadie en el turno, Meta lo rechaza), lo reintenta cada hora hasta las 20:00. Lo de **mañana y hoy no lo manda solo**: Camilo pidió avisarlo a mano. Así nadie recibe dos mensajes el día en que se aprueba la plantilla.

En Mantenimientos, cada cita pendiente tiene:

- **Avisar**: manda ahora la plantilla al responsable (sale en el chat de [[WhatsApp chat|/whatsapp]] como «Cita del taller»).
- **Copiar**: copia el mismo mensaje en texto para pegarlo en su chat. Es el de la plantilla, palabra por palabra; el comprobador vigila que no se separen.
- **Avisado**: se le avisó a mano. Queda quién lo apuntó y cuándo.
- **Estado**: hecha, no se presentó o anulada. Anular y «no se presentó» piden el porqué.

La plantilla `cita_taller` lleva dos botones: **«Confirmo»** y **«No puedo ir»**. Lo que pulse llega al webhook como un botón de plantilla. La cita se encuentra por el mensaje al que contesta (`context.id` = el `aviso_wamid`) o, si no, por la próxima pendiente avisada a ese teléfono. Queda en la cita y se le contesta en el momento. Si el botón no es de ninguna cita, el bot sigue como siempre. Con el bot en pausa por la oficina, los botones se atienden igual.

## Control: llamar y apuntar

`/control/citas-taller` enseña las de **hoy y los dos próximos días**, y también los próximos 7 o todas. Cada cita sale con su responsable: el teléfono para llamar, el chat de WhatsApp y el enlace a su ficha. Al lado van el aviso, lo que contestó y la última llamada.

«Apuntar llamada» pregunta a quién se llamó (el responsable o quien lleva el coche en el otro turno) y qué dijo: **Confirma la cita · No puede ir · No contesta · Buzón de voz · Ya no lleva ese coche**, con una nota. «No puede ir» pide el porqué. Si falta algo, el diálogo vuelve a abrirse con lo que estaba escrito.

- **«No contesta» no pisa una confirmación** que ya había por WhatsApp.
- La llamada entra también en el **historial de llamadas del conductor**, tipo «Taller», con la matrícula y el turno. El Call Center la clasifica en *Vehículo › Taller y revisiones › Limpieza, ITV o revisión programada* (`callcenter.service.DESDE_CONTROL`). Los textos de esos casos («Cita de taller: confirma»…) no se renombran sin tocar los dos sitios.

## Permisos

- Mirar las citas en Mantenimientos: `/taller`.
- Subir el Excel, avisar, «Avisado» y «Estado»: `/taller/apuntar` (el servidor lo comprueba en cada ruta, no solo escondiendo el botón).
- La pantalla de Control y sus llamadas: `/control`.

## Ver también

[[Vehiculos]] · [[Control]] · [[WhatsApp]] · [[PLANTILLAS-WHATSAPP]] · [[Planificacion]] · [[Inspeccion de vehiculos]]
