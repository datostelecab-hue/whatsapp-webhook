---
tags: [modulo, rrhh, portal, correo, postgresql]
aliases: [Comunicados, Comunicados a la plantilla, Lo he leído]
---

# Comunicados

`/comunicados` (módulos 6 y 9 del [[Plan RRHH y nominas]], db/305, 26/11/2026). El encargo: *«comunicaciones con acuse: normativa interna, nuevos códigos de descuento y similares. Envío masivo a toda la plantilla o a un grupo, con seguimiento de quién ha firmado y recordatorios automáticos»*; y en la prueba de aceptación, *«un envío masivo muestra en tiempo real quién ha firmado y quién no»*.

| Pieza | Dónde |
|---|---|
| Servicio y reglas | `modules/RRHH/comunicados.service.js` |
| SQL | `modules/RRHH/comunicados.repo.js` |
| Rutas de la oficina | `modules/RRHH/comunicados.controller.js` (`/comunicados`) |
| Pantalla | `modules/RRHH/vistas/comunicados.ejs` + `public/assets/js/vistas/RRHH/comunicados.js` |
| Portal | `/comunicados`, `/comunicados/:id` y `POST /comunicados/:id/leido` en `modules/Portal/portal.controller.js`; vistas `portalComunicados.ejs` y `portalComunicado.ejs`; tarjeta en el inicio |
| Prueba | `test/comunicados.test.js` |

## Lo que decidió Camilo (26/11/2026)

- **El acuse es el «Lo he leído» del [[Portal de conductores]]**, no una firma de YouTrust: queda el día, la hora, la IP y el navegador de su sesión (entró con su DNI y un código a su correo). Gratis y para 250 personas a la vez. Lo que necesite valor legal sigue yendo por [[Firmas]].
- **Se avisa por correo y en el portal.** Nada de WhatsApp: desde el 01/10 Meta cobra cada plantilla.
- **Recordatorios**: por correo, cada **2 días hábiles** desde el último, **3 como mucho**; después queda como «sin leer» y decide Diana.
- **Lo prepara Diana y lo aprueba otra persona** (Ignacio). Quien lo preparó no lo aprueba.

## Cómo va

1. **Borrador**: título, texto (los saltos de línea se respetan) y a quién va: **toda la plantilla de alta**, **la propia**, **los de ETT** o **unas personas**. Se corrige mientras es borrador.
2. **Por aprobar**: «Pedir que se apruebe» hace nacer la tarjeta `comunicado_aprobar` a quien tiene la llave de aprobar (que no sea quien lo preparó). Se puede **devolver al borrador** con nota.
3. **Enviado**: al aprobarlo se hace la **foto de a quién va** (la plantilla de alta de su alcance en ese momento, sin la ficha de pruebas: `comunicado_destinatario`) y salen los correos **en segundo plano**, uno a uno, cada uno apuntado (o su error). Quien no tiene correo lo ve igual al entrar en el portal.
4. **Anulado** (con motivo): uno ya enviado solo lo anula quien aprueba, y desaparece del portal.

- **En el portal**: arriba del inicio, la tarjeta «Tienes N comunicados sin leer»; cada uno se abre (queda «lo abrió») y al final **«Lo he leído»**, un formulario sin JavaScript. Después se ve «Confirmaste que lo has leído el …». El correo lleva el enlace directo `/comunicados/ID`.
- **El seguimiento**: en el panel de cada comunicado, cuántos lo han leído, cuántos faltan y el %, y la lista de quien falta (con su correo, si lo abrió y los recordatorios). **Se refresca solo cada 20 segundos** mientras está abierto.
- **Los recordatorios**: tarea `comunicados.recordar`, cada día hábil a las 09:00, desde el 27/11/2026.
- **En el expediente** del conductor (ficha de Plantilla), la sección «Comunicados recibidos» con la llave `/comunicados`.

## Llaves

| Llave | Quién (db/305) | Qué |
|---|---|---|
| `/comunicados` | Diana, Ignacio | mirar los comunicados y su seguimiento |
| `/comunicados/preparar` | Diana | redactarlos, corregirlos y pedir que se aprueben |
| `/comunicados/aprobar` | Ignacio | aprobarlos (salen), devolverlos o anularlos |

Todas `manual`: se dan persona a persona en Usuarios.

## El PDF y el SMS certificado a quien no lo lee (db/310, 27/11/2026)

Camilo: el PDF *«en el portal; el correo avisa»*, y el SMS *«cuando Diana lo decida»*.

- **El documento**: en el panel del comunicado, el recuadro «Documento (PDF…)» (adjunto del dueño `comunicado`). Se sube y se quita **solo mientras es borrador**: lo que se aprobó es lo que se mandó.
- **En el portal**, debajo del texto, «Abrir norma.pdf» (`/comunicados/:id/documento/:adjunto`). Solo se sirve a quien se le mandó ese comunicado, con las cabeceras seguras de [[Adjuntos]] y sin caché. La primera vez que lo abre queda `pdf_at`, y la oficina lo ve en el seguimiento («abrió el PDF …»).
- **El correo no lleva el PDF**: dice «Lleva un documento: ábrelo en tu portal…» (también en los recordatorios). Abrirlo desde el correo no dejaría constancia.
- **«SMS certificado a quien falta (N)»**, en un comunicado enviado, para quien tiene la llave `/sms/enviar`. Prepara en [[SMS certificado]] un borrador:
  - va solo a los que aún no lo han leído, con la plantilla corta «Comunicado sin leer» (≤ 160 caracteres: 9 créditos) y el PDF del comunicado;
  - no sale hasta que Diana lo manda desde /sms;
  - un segundo clic abre el mismo borrador.

## Lo que falta
- Los envíos de los módulos 3 y 7 (cartas de sanción, finiquitos) siguen por [[Firmas]].
- Al mandar a toda la plantilla salen unos 250 correos seguidos por el SMTP de la casa: si el proveedor pone un tope por hora, los que fallen quedan con su error en la lista.

Relacionado: [[Firmas]] · [[Portal de conductores]] · [[Plan RRHH y nominas]]
