---
tags: [modulo, whatsapp, chat, conductores, comunicacion, plantillas, call-center]
ruta: /whatsapp
codigo: modules/WhatsApp
fecha: 2026-10-07
---

# WhatsApp chat

Camilo, 07/10/2026: *«un chat de WhatsApp del bot donde guarde los mensajes enviados y recibidos, como módulo WhatsApp, para saber qué les envía el WhatsApp y qué nos envían ellos; y si podemos enviarles mensajes de forma libre, lo hacemos, ya que se abren las ventanas gratis de 24 horas»*.

Salió de un caso concreto: aquel día la cuenta estuvo bloqueada por un pago de 12:51 a 17:03. Para saber a quién no le había llegado nada hubo que cruzar a mano los fallos de Meta con los turnos, y para escribirles no había por dónde.

## Qué se ve

- **A la izquierda, las conversaciones**, la más reciente primero:
  - **quién es**: el conductor con su ficha, un usuario del ERP, una cuenta de BOLT (también de Barcelona) o, si nada casa, el nombre que tiene puesto en WhatsApp;
  - **su foto**, la de su ficha (Documentos), si es un conductor y la tiene; si no, sus iniciales. Se sirve desde el módulo (`/whatsapp/api/foto/:id?v=`), así que la ve quien entra en WhatsApp aunque no tenga la llave de Plantilla, y se guarda una semana en el navegador porque una foto nueva es otra dirección. El 07/10 tenían foto 64 de los 215 conductores de alta. **Pulsando la foto de la cabecera se ve en grande** ([[Componentes de la casa|VisorFoto]]), sin ir a su ficha;
  - el último mensaje y su hora;
  - lo que la oficina **no ha leído**;
  - un punto verde si **la ventana de 24 h está abierta**;
  - una mano si **el bot está en pausa** con esa persona.

  Se busca por nombre o por un trozo del teléfono.
- **A la derecha, el chat**:
  - Lo que manda la persona va a la izquierda.
  - A la derecha, lo que le llega, distinguiendo el **bot**, la **oficina** (en el acento, con el nombre de quien escribió) y los avisos (**alerta de Control**, **aviso de velocidad**, **aviso de turnos**, en azul).
  - Cada mensaje enviado lleva su marca: enviado, entregado, leído (en azul) o **no llegó** (en rojo, con el motivo que dio Meta).
  - Los botones que mandó el bot se ven debajo del texto; lo que pulsó la persona, como «Pulsó …».
  - Las ubicaciones se abren en el mapa. Las **fotos** se ven en el chat y, pulsándolas, en grande sin salir de la pantalla, los **audios** y **vídeos** se escuchan ahí mismo y los **documentos** se descargan.
  - Si es un conductor, **sus llamadas** del Call Center y de Control salen entre los mensajes, a su hora, con quién llamó, de qué y qué contestó. Llevan al Call Center.
- **Arriba del chat**: el teléfono, los enlaces a su ficha y a **sus llamadas** si es conductor, hasta cuándo está abierta la ventana, el estado del bot (con **Pausar el bot** o **Devolver al bot**) y **quién la lleva** (con **Me la quedo** o **Cambiar**).
- **Abajo, la caja para escribir**, con la ventana abierta. Intro envía; Mayús + Intro hace un salto de línea. El **rayo** (o «/» al empezar a escribir) abre las **respuestas rápidas**.
- **Con la ventana cerrada, una plantilla**: «Mandar una plantilla» enseña las aprobadas por Meta; al elegir una sale su texto con el nombre de pila ya puesto, una casilla por variable y cómo le va a llegar. Antes de mandarla se confirma, porque **se paga**.
- **Arriba de la lista**: «Todas», «No leídas» (las que tienen algo sin leer; la que está abierta no se cae al leerla, como en WhatsApp), «Mías» (las que lleva quien mira) y «Sin asignar», cada una con su número. Los números cuentan todas las conversaciones, sin mirar el buscador. El lápiz abre una conversación con **cualquier conductor de alta** con teléfono en su ficha, aunque nunca haya escrito: la primera vez es con plantilla.

Abrir una conversación la da por leída. La pantalla se refresca sola: el chat abierto cada 4 segundos y la lista cada 10.

## Las reglas

- **Texto libre solo con la ventana abierta** (gratis). Fuera de ella, **solo plantillas**, que Meta cobra una a una (unos céntimos) aunque no contesten. Desde aquí se mandan las que solo piden texto; las que llevan una foto en la cabecera o un botón con un enlace variable no salen. Las que usa el propio sistema (avisos de velocidad, de turnos, alertas) salen al final y lo dicen.
- **Quien escribe se queda la conversación** si no la llevaba nadie: es lo que la pone en sus «Mías». Se le puede dar a otra persona (solo a quien entra en WhatsApp) o a nadie.
- **Las respuestas rápidas son de todos**: las crea, cambia o borra cualquiera que pueda escribir. `{nombre}` se cambia por el nombre de pila de cada persona. Elegir una la pone en la caja, no la envía.
- **Las fotos, audios y documentos se bajan al llegar**, porque Meta solo los guarda 30 días, y se quedan hasta que se borra su mensaje. Lo que pasa de 16 MB (`WHATSAPP_ADJUNTO_MAX_MB`) se pide a Meta al abrirlo, mientras lo tenga. Solo fotos, audio y vídeo se abren en la página; lo demás se descarga.
- **Las llamadas solo las ve quien entra en el Call Center**: son sus datos.
- **Al escribir, el bot se pausa** con esa persona **30 minutos** (`WHATSAPP_PAUSA_BOT_MIN`), y cada mensaje de la oficina alarga la pausa. Así lo que conteste llega aquí y no le salta el bot. **Los botones del turno los atiende siempre.**
- **Dos llaves** (grupo Tráfico): `/whatsapp` para leer y `/whatsapp/escribir` para escribir, mandar plantillas, pausar el bot, asignar y cambiar las respuestas rápidas. Desde el principio lo ven el desarrollador y los superadministradores; a los demás se les da en Usuarios.
- **Se borra a los 180 días** (`WHATSAPP_RETENCION_DIAS`).
- **El historial empieza con db/185**: Meta no da los mensajes anteriores.

> [!bug] La lista salió vacía hasta db/186
> Del 07/10 hasta el despliegue de la segunda fase, los mensajes se guardaban pero su conversación no: la consulta usaba el mismo parámetro con dos tipos y Postgres la rechazaba (ver [[WhatsApp]]). db/186 rehace las conversaciones desde los mensajes; el nombre de WhatsApp de cada uno vuelve con su siguiente mensaje.

## Las piezas

```
modules/WhatsApp/whatsapp.controller.js   las rutas (y si quien entra puede escribir o ver llamadas)
modules/WhatsApp/whatsapp.service.js      la lista, abrir, escribir, la pausa, adjuntos, plantillas, asignar, respuestas
modules/WhatsApp/vistas/whatsapp.ejs      la pantalla
services/repo/whatsappChat.js             guardar y leer (whatsapp_mensaje, whatsapp_chat, whatsapp_adjunto, whatsapp_respuesta_rapida)
services/whatsappChat.js                  las reglas puras: qué es cada mensaje, la ventana, la pausa, plantillas, adjuntos
services/whatsapp.js                      los envíos (que apuntan cada mensaje en el chat), las plantillas de Meta y bajar adjuntos
routes/botPuertas.js                      el webhook: guarda lo que entra, baja el adjunto y respeta la pausa
modules/Control/callcenter.*              las llamadas que salen en el chat, y el enlace de vuelta (?conductor=)
```

Comprobador: `scripts/comprobar-whatsapp-chat.js` (69 casos), sin base ni Meta: las reglas, que cada envío quede apuntado con su origen y el servicio de la segunda fase con la base y Meta sustituidos. Vigila además el cast de `$5` que dejó la lista vacía.

## Segunda fase (db/186, 07/10/2026)

Hecha: fotos, audios y documentos; plantillas con la ventana cerrada (también para empezar una conversación); respuestas rápidas; quién lleva cada conversación; y el enlace con el Call Center en los dos sentidos.

**Para usar las plantillas hace falta tener alguna** que solo pida texto. La oficina no tiene ninguna propia: créala en el WhatsApp Manager de Meta (por ejemplo «Hola {{1}}, te escribimos desde la oficina de Telecab: contéstanos por aquí») y, cuando la aprueben, sale sola en la lista.

Lo que no está: mandar fotos o documentos desde la oficina, y cargar mensajes más antiguos que los 80 últimos de una conversación.

## Ver también

[[WhatsApp]] · [[Control]] (Call Center) · [[Usuarios y permisos]]
