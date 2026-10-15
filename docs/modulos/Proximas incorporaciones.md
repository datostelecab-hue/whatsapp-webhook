---
tags: [modulo, control, planificacion, whatsapp, bot, postgresql]
aliases: [Próximas incorporaciones, Incorporaciones de Control, Quién entra mañana]
---

# Próximas incorporaciones

Pantalla de **Control** (`/control/incorporaciones`) con **quién entra a trabajar mañana** (o hoy, o en los próximos 7 días): gente **NUEVA** y gente que **vuelve de VACACIONES**. Control les llama para confirmar que entran, les manda sus turnos por WhatsApp y, si son nuevos, les explica el bot con un guion.

Camilo, 15/10/2026: *«las personas que entrarán al otro día, ya que ellos tienen que llamar para confirmar que entran … los de control necesitan saber todo: los turnos planificados, tener la opción de enviar la plantilla de los turnos directamente a WhatsApp y ver los turnos que tiene él para poder explicarle … debe decirme si es NUEVO o si es de vacaciones … también recordarles sobre el bot de WhatsApp que abre y cierra puertas, que puede ver sus turnos: es como un instructivo PARA LOS NUEVOS»*. Tenía que ser como [[Citas del taller]], que le gustaba como estaba.

| Pieza | Dónde |
|---|---|
| Pantalla | `modules/Control/vistas/controlIncorporaciones.ejs` (pestaña en `partials/control-nav.ejs`) |
| Rutas | `control.controller.js`: `GET /control/incorporaciones`, `GET /control/api/incorporaciones?ventana=manana\|hoy\|semana`, `POST …/:id/llamada`, `POST …/:id/enviar-turnos` |
| Reglas | `modules/Control/incorporaciones.service.js` (`clasificar`, pura) |
| Consultas | `modules/Control/incorporaciones.repo.js` |
| Turnos y texto del bot | `cobertura.service.proximosDeCadaUno` (Planificación) |
| Comprobador | `node scripts/comprobar-incorporaciones.js` (25 casos, sin base) |

Sin migración: todo se lee de lo que ya hay.

## Quién sale

**No es la lista del planificador.** La de allí ([[Planificacion]], `planificador.repo.proximasIncorporaciones`) es para Tráfico y solo saca a quien vuelve de vacaciones si le han **cambiado de cuadrante**. Control llama a **todos** los que entran, cambien o no. Quién cubre qué un día es siempre `f_cobertura`, la regla del planificador.

- **NUEVO**: un contrato que empezó hace poco (hasta 45 días), y ese día es el **primero en que cubre una plaza**.
  - **De la ETT a propia sin hueco no es entrar**: el contrato anterior acaba la víspera.
  - **Quien vuelve tras una baja de hace tiempo sí es nuevo**, y se dice («Vuelve: estuvo hasta el …»).
  - **Si el día de su alta no tiene ninguna plaza**, sale igual ese día con **«Sin plaza en el planificador»**: Control tiene que saber que alguien entra sin coche.
  - **Si tiene plaza pero su coche libra ese día**, sale el día que de verdad cubra.
- **VACACIONES**: el **primer día que cubre una plaza** después de sus vacaciones. Sirve aunque acabaran unos días antes y libre entre medias.
  - **Si detrás de las vacaciones empezó otra ausencia**, como una baja, no vuelve de vacaciones.
  - **Si al volver no tiene plaza** (y no es que libre ni que siga ausente), sale el día siguiente con «Sin plaza».
  - **Si su coche es otro que el de antes de irse**, se marca («Antes llevaba …»).
- Una persona sale **una vez**, en su primera entrada. Las ventanas son **Mañana** (por omisión), **Hoy** y **Próximos 7 días**.

## Lo que se ve de cada uno

- **Quién**: nombre, NUEVO o VACACIONES, teléfono (pulsable), jornada, contrato (ETT o propia, horas) y zona.
- **Primer día**: el coche y el puesto (fijo o correturnos), o «Sin plaza».
- **A tener en cuenta**:
  - **«Sin cuenta de BOLT»**: sin ella no puede trabajar.
  - **Si ha escrito al bot en las últimas 24 h**: la ventana de WhatsApp está abierta y se le puede contestar sin plantilla.
- **Turnos por WhatsApp**: si se le mandaron, cuándo y quién (el último aviso, de aquí o del planificador). **Llamada**: la última y cuántas van.

Las tarjetas de arriba cuentan cuántos entran, cuántos son nuevos y cuántos vuelven de vacaciones. También cuántos están **sin confirmar** y cuántos están **sin plaza o sin BOLT**.

## Los botones

- **Guion.**
  - **Para los nuevos**, la llamada en diez pasos: presentarse y confirmar el día, el turno y el coche; su cuenta de BOLT; el WhatsApp de Telecab (guardar el número); «Ver mis turnos» (también escribiendo «¿qué turno tengo?»); escribir la matrícula al llegar; los botones del turno; **Entregar coche** justo antes de salir hacia el compañero; **Terminar turno** con el coche aparcado y apagado; qué hacer si falla; y apuntar la llamada.
  - **Para los que vuelven**, uno corto, y si cambia de coche, se dice.
  - **Está escrito con las palabras del bot** (`services/fichajeBot.js`) y sin «fichar» ni «fichaje», que con el conductor no se dicen.
- **Sus turnos.** El texto **exacto** que verá al pulsar «Ver mis turnos» (`turnos.service.mensajeProximos`, de hoy a 7 días, con relevos y teléfonos), con las negritas de WhatsApp.
- **Enviar turnos.** La plantilla de turnos del planificador (`detalle_turnos`, con su botón), a esa persona (`cobertura.service.enviarAUno`, semana 0). Queda en el mismo libro de avisos (`aviso_turnos`, origen `cobertura`, con quién lo mandó). Se paga como plantilla.
- **Apuntar llamada.** Las respuestas posibles:
  - Confirma que entra.
  - Entra otro día, con nota obligatoria: qué día.
  - No va a entrar, con nota obligatoria: por qué.
  - No contesta, o buzón de voz.

  Va a `llamada_seguimiento`, tipo `trafico`, con el caso «Incorporación: …» y «Entra el dd/mm/aaaa» en la nota. El Call Center ([[Control]]) la clasifica como **Asistencia → Conexión → Revisión de asistencia / confirmación de turno** (`DESDE_CONTROL.trafico`).
- **Historial.** Todas sus llamadas, de Control y del Call Center (`partials/historial-llamadas`).

## El vídeo del bot (15/10/2026)

**«Vídeo del bot»** le manda el reel de cómo funciona el WhatsApp del coche (1:12): matrícula, puertas, entregar y terminar el turno, y el bloqueo del motor. Va por `modules/WhatsApp/whatsapp.service.enviarVideo`, el mismo que usa el chat; ver [[WhatsApp#Vídeos (15/10/2026)]].

- **Solo con la ventana de WhatsApp abierta**, es decir, si ha escrito al WhatsApp de Telecab en las últimas 24 h.
  - **Si está cerrada**, el botón no lo intenta y explica cómo abrirla: mandarle primero sus turnos y que pulse «Ver mis turnos», o que escriba «hola» al bot. Después se recarga la lista.
  - **A un nuevo casi nunca se le abre sola**, porque no nos ha escrito antes. Por eso el guion lo pone después de los turnos.
- **La columna «WhatsApp»** dice cuándo se le mandaron los turnos y cuándo el vídeo (el último vídeo que salió bien a su teléfono, de `whatsapp_mensaje`).

Relacionado: [[Control]] · [[Citas del taller]] · [[Planificacion]] · [[WhatsApp]] · [[WhatsApp chat]]
