---
tags: [modulo, chat, hoja-de-ruta, item-2]
actualizado: 2026-11-17
---

# Chat interno

**El Slack de la oficina, dentro del ERP** (ítem 2 de la [[Hoja de ruta]]): «reemplazar Slack por un chat dentro del ERP, con sus mismas funciones, para que la comunicación y las tareas vivan en el mismo sistema». Solo para la oficina. Va en cuatro entregas:

- **2a — canales, directos, tiempo real, no leídos, menciones e hilos** (17/11/2026, rama `chat/2a-canales`, db/256).
- **2b — ficheros, reacciones, editar y anular, fijar y guardar, formato, vista previa de enlaces y convertir en tarea** (17/11/2026, en la misma rama, db/257).
- **2c** búsqueda, estado y no molestar. Las notificaciones al dispositivo se adelantaron (17/11/2026: ver abajo).
- **2d — la migración de Slack** (17/11/2026, en `main`, db/259 y db/260): abajo.
- **2e** gestión de canales (archivar, renombrar).

**Se trae Slack** (Camilo, 17/11/2026): «Ya no queremos usarlo y la idea es migrar toda la info allá. Que no avise menciones ni nada hasta después de la migración». Sustituye a lo de «los chats arrancan vacíos», decidido ese mismo día por la mañana.

## Lo que decidió Camilo (17/11/2026)

1. **Los 16 canales públicos de Slack, abiertos a toda la oficina**, también #4-bajas-medicas, #6-nominas, #9-rrhh y #16-efectivo, como pidió Ignacio.
2. **Toda la oficina dentro de todos los públicos** desde el primer día: los ve en su lista y le cuentan los no leídos. Quien llega después entra solo, y lo de antes no le cuenta como no leído.
3. **Crean canales los puestos de Dirección y Desarrollo** (la función de [[Organizacion]] `chat_canales`: CEO, Dirección de operaciones, Dirección de Barcelona y Desarrollo).
4. **Los privados, con quien los pidió**: #datos (Camilo), #martes-10am (Ignacio) y #escalaciones-lorenzo (Lorenzo). Su gente se añade desde el chat.

## Lo que decidió Camilo para la 2b (17/11/2026)

1. **Reacciones: seis emojis fijos**, 👍 ✅ 👀 🙏 😂 ❤️, como un Slack recortado. Son contenido de la gente, no adorno de la interfaz (la regla de «sin emojis» es para la interfaz). En la base van por su código: `ok`, `hecho`, `visto`, `gracias`, `risa`, `corazon`.
2. **Editar y anular lo propio cuando se quiera y sin motivo**, como en Slack. Quien lleva los canales (`chat_canales`) anula lo de otro, **con motivo**, que ve el canal en lugar del mensaje.
3. **Convertir en tarea, como una tarea a mano** del [[Tablero de tareas]]: con responsable, plazo y, si quien la crea no aprueba, la aprobación.
4. **Fijar, cualquiera del canal** (queda quién); **guardar, cada uno lo suyo**.

## Cómo funciona

- **La tarea que nace de un mensaje** enseña el mensaje en su ficha del [[Tablero de tareas]] a quien la puede ver, aunque no esté en el canal (`mensajeDeTarea`, 17/11/2026): quien la aprueba necesita el contexto. Solo ese mensaje: el canal sigue cerrado para quien no está dentro.
- **Los nombres, cortos** (Camilo, 17/11/2026: «el nombre y las iniciales de sus apellidos en el chat y ya»): «Laura B.», «Karen G. L.», sin las partículas («de», «la»…). En todo el chat: autores, menciones, reacciones, miembros, directos, avisos al dispositivo y los autores traídos de Slack sin usuario. Lo hacen `NOMBRE` de `chat.repo.js` (para los usuarios) y `nombreCorto()` de `chat.service.js` (para los nombres de Slack). Fuera del chat, el nombre sigue completo.
- **Canales** públicos (de toda la oficina) y privados (de quien está dentro), y **mensajes directos** de 1 a 1 o de grupo (hasta 9 personas; el mismo grupo es siempre el mismo directo). Un privado o un directo, a quien no está dentro le da un 404: ni sabe que existe.
- **No leídos**: el canal sale en negrita; los **directos sin leer y las menciones** llevan su número. En el menú, la entrada **Chat** va en rojo con los directos y las menciones y, si no hay, en azul con lo que haya sin leer en los canales. Al abrir un canal se marca leído (con la pestaña delante), y una raya «Nuevos» enseña dónde se quedó.
- **Menciones**: al escribir «@» salen las personas (en un privado o un directo, solo las de dentro) y **@canal**, que avisa a todos. En el texto van como `<@id>` y `<!canal>`, así que un nombre cambiado no rompe nada. Un mensaje que te menciona sale resaltado. En un privado, mencionar a quien no está no cuenta: no lo podría leer.
- **Hilos** de un nivel, como Slack: «Responder en un hilo» abre el hilo al lado (Panel); responder a una respuesta es responder al de arriba. Las respuestas no cuentan como no leídas del canal; una mención dentro de un hilo, sí.
- **Al momento**: cada mensaje avisa por el [[Tiempo real]] (canal `chat`) a los del canal y mueve sus [[Contadores]]. Sin tiempo real, la pantalla pregunta cada 15 segundos.
- **Gente de un privado**: la añade cualquiera de dentro (o quien lleva los canales); la saca quien creó el canal o quien lleva los canales; cada uno puede salirse. Salir es una marca, no un borrado.
- **En el móvil**, la lista o la conversación, con un botón para volver.
- **Nada se borra**: los canales y los mensajes están bajo el [[Libro de auditoria]].

### Las notificaciones al dispositivo (17/11/2026)

Camilo: *«además de menciones, todo lo que sea referente al usuario debe de llegarle como noti»*, y decidió qué es eso. Le llega a cada uno, aunque no tenga Telecab abierto:

- un **mensaje directo** (de 1 a 1 o de grupo);
- una **mención** a él, y **@canal** en un canal en el que está;
- una **respuesta en un hilo** que empezó o en el que ha escrito;
- que le **añadan** a un privado o le **saquen**, y que quien lleva los canales le **anule** un mensaje (con el motivo);
- una **reacción** o que le **fijen** un mensaje.

Una por mensaje y persona, la que más le toca (directo > mención > @canal > hilo), y nunca a quien lo escribe. Lleva el nombre de quien escribe y el principio del texto, con los nombres en vez de `<@id>` y **sin DNI, NIE ni cuentas**, porque sale en la pantalla bloqueada. Las de un canal se sustituyen entre sí en vez de amontonarse. **Si esa persona tiene ese canal delante, no sale**, y pulsarla con el chat abierto va al mensaje sin recargar. La de una tarea cerrada desde el tablero llega a quien la creó y a quien escribió en el hilo. Las tareas del tablero ya avisaban por su cuenta. Ver [[Notificaciones al dispositivo]].

### El recorrido, la primera vez

La primera vez que alguien entra en el chat le sale un recorrido de un minuto (Camilo, 17/11/2026): los canales, escribir, la barra de cada mensaje y **el flujo de una tarea**, de convertir el mensaje a la respuesta en su hilo. Se repite con el botón de la ruta, arriba a la izquierda. Ver [[Novedades]].

### Lo de la 2b

- **La barra de cada mensaje** sale al pasar por encima (en el móvil, al tocarlo): reaccionar, responder en un hilo, guardar, fijar, convertir en tarea y, si es tuyo, editar y anular.
- **Editar**: en el sitio, Intro guarda y Escape lo deja como estaba. Sale «(editado)» y lo de antes queda en el libro. Una mención nueva avisa; una que se quita no se des-avisa. Si llega otro mensaje mientras editas, la caja no se pierde.
- **Anular**: el mensaje deja de verse y sale «Mensaje anulado» (si lo anuló quien lleva los canales, con su nombre y el motivo). El texto se queda en la fila y en el libro: **nada se borra**. Un anulado no cuenta como no leído y sus ficheros dejan de servirse.
- **Reacciones**: las seis, con quién puso cada una al pasar por encima. Pulsar la tuya la quita (es una marca con fecha, no un borrado).
- **Fijar**: el mensaje sale con «Fijado por …» y el canal tiene arriba el botón con la chincheta y cuántos hay. Desfijar también queda.
- **Guardar**: el botón de arriba a la izquierda («Guardados») lista lo tuyo de todos los canales que aún puedes ver; de un privado del que has salido, ya no.
- **Ficheros**, como en Slack: con el clip, arrastrándolos encima o pegándolos. **Se suben en cuanto se eligen**, con su progreso en la caja de escribir, a un **borrador** de quien escribe (`chat_borrador`, «<su id>-<al azar>», que solo él ve). **El mensaje no existe hasta que todo está subido**: si se pulsa Enviar antes, espera y sale al terminar; al mandarlo, los ficheros pasan a él en la misma transacción. Así nadie ve un mensaje a medias y sale en su sitio, no más arriba (Camilo, 17/11/2026, al ver un mensaje vacío mientras subía un vídeo). Si uno no sube, se pregunta si mandarlo sin él. A un mensaje ya mandado no se le suben más; un mensaje puede ser solo ficheros. Los que se quitan antes de mandar se anulan. Las fotos salen en miniatura y se abren en grande; el PDF, el vídeo y el audio se ven en la página; lo demás se descarga. Los ve quien ve el mensaje.
- **Formato**, como Slack: `*negrita*`, `_cursiva_`, `~tachado~`, `` `código` ``, bloques entre tres comillas invertidas, `> cita` y listas con `-` o `1.`. Siempre sobre el texto escapado: no se puede colar HTML.
- **La vista previa de un enlace**: del primer enlace del mensaje, el título, la descripción y el sitio. La lee el **servidor** después de mandar (nadie espera) con `services/enlaces.js`, protegido contra SSRF (abajo), una vez por enlace a la semana, y avisa al canal cuando la tiene. Sin imágenes: la CSP de la casa no deja pintar las de fuera.
- **Convertir en tarea**: el mismo formulario que «Nueva tarea» del tablero, con el título y el detalle ya puestos desde el mensaje. La tarjeta es del tipo `mensaje`, con el enlace al mensaje (`/chat?canal=…&mensaje=…`). El mensaje lleva el **sello** con su estado, quién la hace y cuándo vence, que lleva a la tarjeta. Una por mensaje. **Al cerrarla en el tablero, la respuesta sale en el hilo del mensaje**, firmada por Telecab (quien la cierra puede no estar en el canal) y **mencionando a quien la creó**, que así se entera. Es el primer criterio del ítem 1: «una tarea creada desde un mensaje».

> [!warning] Una tarea de un privado o de un directo
> El título y el detalle los escribe quien la crea y los ve quien la hace y quien aprueba, aunque no estén en el canal: es decisión de quien la crea. El enlace al mensaje, a quien no está dentro, le da un 404.

### La vista previa, sin abrir la puerta a la red de dentro (SSRF)

Que el servidor lea una página es justo lo que busca un ataque SSRF: que pida por otro lo que solo él alcanza (la base, el metadato de la nube en 169.254.169.254, un panel en localhost). `services/enlaces.js`:

- solo `http` y `https`, a los puertos 80 y 443, sin usuario ni contraseña en la dirección; ni `localhost`, ni `.local`, ni nombres sin punto;
- cada nombre se resuelve en el propio servidor y **todas** sus direcciones tienen que ser públicas (ni privadas, ni de bucle, ni de enlace local, ni reservadas, ni IPv6 que escondan una de esas); y se conecta **a esa** dirección, con el `lookup` de la propia petición, así que un DNS que cambia de respuesta por el camino (DNS rebinding) no cuela. Probado contra `localtest.me`, que apunta a 127.0.0.1;
- las redirecciones, a mano, como mucho tres, y cada una pasa por lo mismo;
- solo HTML, sin comprimir, con 5 s y 512 KB de tope: se lee hasta `</head>` y se corta.

Todo con piezas globales: Panel (hilos y miembros), Dialogo (nuevo canal, directo, añadir), Api, TiempoReal, Contadores y las clases `.tc-chat*` de `telecab.css` (V3).

## La migración de Slack (2d, db/259 y db/260)

Lo que decidió Camilo (17/11/2026):

1. **Mensaje a mensaje, sin integrar Slack en el ERP**: «no necesito integrar slack sino migrarlo y dejar de usarlo, que lo haga mensaje a mensaje». Primero se había hecho con un token y una app de Slack (la primera versión de la 2d, `db58ddd`); se quitó ese mismo día. **El ERP no habla con Slack**: ni token ni app.
2. **Los 19 canales del chat y el privado #efectivo**, que no estaba y se crea. Los demás canales de Slack no se traen.
3. **Los mensajes directos de Ignacio**, como directos del chat entre él y cada persona. Los de bots (Google Drive, jibble, Miro, Slack) y el suyo consigo mismo, no.
4. **La gente de cada privado** («que en escalaciones-lorenzo estén los que faltan en el ERP»): entran sus miembros de Slack que tienen usuario; la simulación dice quién entra y quién no tiene usuario. Los públicos ya tienen a toda la oficina.

**Cómo se lee Slack** (fuera del ERP y fuera del repo: tiene datos de personas). En `Documents/Claude/Scripts de análisis/slack-migracion/`:

- Agentes (Haiku) leen Slack con el **conector de Slack de Claude** (la cuenta de Ignacio): cada página de cada conversación, cada hilo, quién puso cada reacción, los miembros de los privados, los perfiles que hagan falta y cada fichero. **No reescriben nada**: lo que devuelve el conector queda tal cual en el registro de cada agente (y los ficheros, en disco).
- `reconstruir.js` rehace desde ahí cada mensaje (texto exacto, autor con su correo, marca de tiempo, hilo, reacciones, ficheros) y **comprueba que no falte nada**: las páginas encadenadas hasta el final, cada hilo con todas sus respuestas, cada reacción con su gente, cada fichero. Lo que falta lo deja como lista de llamadas (`pendientes.json`); `lotes.js` la reparte en lotes para otros agentes, y se repite hasta que no falte nada.
- La salida: `salida/exportacion.json` (los mensajes) y `salida/ficheros/` (cada uno como `<id de Slack>__<nombre>`). Lo que pasa de 10 MB no lo da el conector y queda en `salida/a-mano.txt` para bajarlo de Slack a mano con ese mismo nombre.

**Cómo se trae**, en `/chat/slack` (solo el desarrollador), en tres pasos:

1. **Subir la exportación** (el JSON; se queda en memoria hasta que el servidor se reinicie).
2. **Simular** dice, por conversación, adónde va, cuántos mensajes, respuestas y ficheros trae y cuántos son nuevos, o por qué no se trae; y en cada privado, quién entra. **No escribe ningún mensaje**; sí apunta **quién es quién**: cada persona de Slack con su usuario del ERP, por el correo y, si no casa, por el nombre. Lo que salió por el nombre se comprueba en la pestaña «Quién es quién» y se corrige pulsando la fila; lo puesto a mano no lo cambia otra simulación. **Migrar** lo trae: cada mensaje con su **fecha** y su **autor** (si no tiene usuario del ERP, con su nombre de Slack: `autor_externo`); los hilos, como hilos; las reacciones de las seis del chat (las demás se cuentan y no se traen); las menciones a `<@id>` o «@Nombre»; @here, @channel y @everyone, a @canal; los enlaces, a su dirección; los `:emojis:`, a su carácter; lo reenviado, «Reenviado de …». Un mensaje borrado que tenía hilo sale como «(Mensaje borrado en Slack)». De cada fichero se apunta de qué mensaje es (`chat_slack_fichero`, db/260).
3. **Subir los ficheros**: se elige la carpeta `ficheros` y se sube, uno a uno y tal cual, cada uno que falte; va a R2 como los del chat, a su mensaje. Si alguno falla, se vuelve a elegir la carpeta y solo se sube lo que falta.

- **No avisa de nada**: lo traído (`slack_ts`) no cuenta como no leído ni como mención pendiente, no saca la línea de «Nuevos» y no manda notificaciones. Al acabar, solo se avisa a las pantallas abiertas para que se recarguen. En la conversación lleva una marca discreta, «Slack».
- **Se puede repetir sin duplicar** (mismo canal y marca de Slack), con una exportación más nueva: sirve para traer lo que se siga escribiendo hasta el cambio.

**El chat ordena por fecha** desde la 2d, no por el número del mensaje: lo traído entra después (con números más altos) pero es de antes, y tiene que salir en su sitio.

**Ojo con el plazo**: el Slack de Telecab empezó el 03/09/2026. Si es el plan gratuito, enseña solo 90 días, y desde el **02/12/2026** lo más viejo deja de verse. Hay que migrar antes.

## El botón de GIF, con KLIPY (18/11/2026)

Camilo: *«¿el chat puede enviar GIF?»* (ya se podía: adjuntando el `.gif`, que sale animado) y *«ponle el botón de GIF con Tenor»*. **La API de Tenor ya no existe**: Google la apagó el 30/06/2026 (desde enero no daba claves) y se rompieron los selectores de GIF de WhatsApp, Discord, X… Camilo eligió **KLIPY**, adonde se fueron muchas.

- **El botón «GIF»**, al lado del clip, en la caja de abajo y en la del hilo. Abre encima un buscador (sin escribir, los más vistos) con la rejilla; al pulsar uno, sale al momento en su propio mensaje. Firma «GIF de KLIPY».
- **Buscar** (`GET /chat/api/gifs?q=&pagina=`) lo hace el servidor (`modules/Chat/gifs.service.js`): la clave no sale de él, las mismas búsquedas se guardan 10 minutos y a KLIPY va una huella de la persona, no su id. Contenido `rating=pg` (`KLIPY_RATING` para cambiarlo).
- **Mandar** (`POST /chat/api/canales/:id/gif { gifId, padreId }`): solo un GIF que el servidor acaba de enseñar (se recuerdan una hora); no se descarga lo que diga el navegador. Se trae de KLIPY y se guarda como **adjunto del mensaje** (R2), igual que un fichero subido: el historial no depende de KLIPY. Con Tenor, al cerrar, se rompieron los GIF de medio internet.
- **La clave**: `KLIPY_API_KEY` en Render, la saca Camilo en el panel de KLIPY (partner panel). Sin ella, el buscador dice que falta. La de prueba de KLIPY permite unas 100 búsquedas por minuto; la de producción se pide en su panel.
- La respuesta de KLIPY se lee con cuidado (`file` con los tamaños `md`, `sm`, `hd`, `xs` y los formatos `gif`, `webp`): su documentación no se pudo leer entera al hacerlo. Lo que no trae un GIF https se salta.

## Notificaciones Telecab (db/265, 18/11/2026)

Camilo: *«que le llegue al chat de Óscar… pero el chat de Telecab, que se llame "Notificaciones Telecab"»*. Un canal **privado**, `notificaciones-telecab`, que en la lista y en la notificación del móvil se llama **«Notificaciones Telecab»**. Ahí escribe el ERP solo: `chat.avisoDelSistema({ para, texto })` crea el canal la primera vez, mete a esas personas, escribe sin autor (firma «Telecab») con el evento **`aviso`** y las menciona, así que les llega como cualquier mención. Lo estrenan las ruedas: [[Inventario y mantenimientos]].

## Ocultar, grupos, archivar y «eliminar» (db/274, 23/11/2026)

Camilo: *«en los chats me deja crear grupos, pero no me deja luego eliminarlos o quitar gente de los grupos creados»* y *«que se "borren" los chats, pero que nunca se borre de la base de datos, que se guarden siempre como "Mensajes eliminados"»*. Todo sale del botón **⋯ (Opciones del chat)** de la cabecera, o del de la gente: el panel «Quién está dentro» lleva abajo las opciones.

- **Ocultar conversación** (directos): sale de tu lista, solo de la tuya. Vuelve sola si alguien escribe después (`oculto_hasta_id`: el último mensaje que había) o si la abres otra vez desde «Mensaje directo».
- **Grupos (directos de 3 o más)**: quien está dentro añade gente (hasta 9); **sacar a alguien**, quien lo creó o quien lleva los canales; **salir**, cualquiera. Un grupo al que se le cambia la gente deja de ser «el directo de esas personas»: su clave pasa a `g<id>`, y con las mismas personas se empieza otro. Un directo de 1 a 1 sigue sin sumar ni sacar a nadie.
- **Archivar canal** (`archivado_at`, que ya existía): quien lo creó o quien lleva los canales. Sale aparte en la lista, en «Archivados», y se lee pero no se escribe. Se puede sacar del archivo.
- **Eliminar chat**: desaparece para todos, pero **nada se borra**. Es una marca (`eliminado_at`, `eliminado_por`), queda en el libro y el directo suelta su clave (`e<id>`). Lo eliminan: un canal, quien lo creó o quien lleva los canales; un 1 a 1, cualquiera de los dos; un grupo, quien lo creó o quien lleva los canales.
- **«Mensajes eliminados»**: solo el **rol desarrollador** (lo eligió Claude por prudencia; Camilo puede cambiarlo). Sección plegable al final de la lista; cada chat se abre de solo lectura con quién lo eliminó y cuándo.
- Hasta aplicar db/274 el chat sigue como antes (`repo.con274`); ocultar y eliminar avisan de que falta la migración.

### Las fotos: zoom y descarga (23/11/2026)

Camilo: *«hacer zoom a las imágenes y descargarlas directamente del chat»*. Es el visor global (`public/assets/js/visorFoto.js`), así que vale en todas las pantallas que lo usan: rueda (hacia donde apunta el ratón), doble clic o clic (2,5×), pellizco en el móvil, botones − / % / + y teclas `+ − 0`; con la foto acercada, se arrastra. **Descargar**, con la descarga de [[Adjuntos]] (avisa si la sesión ha caducado).

## Las tablas (db/256, db/257, db/259 y db/260)

- `chat_canal`: tipo (público, privado, directo), nombre, tema, descripción, `clave_directo` (los ids de un directo, en orden), archivado.
- `chat_miembro`: quién está y hasta qué mensaje ha leído (`ultimo_leido_id`); salir es `salido_at`.
- `chat_mensaje`: con su hilo (`padre_id`), cuántas respuestas tiene, editado y anulado (con quién y por qué; lo propio dice «Lo anuló quien lo escribió»). Desde la 2b, `con_adjuntos` (el texto puede ir vacío), `enlace_url` (el primer enlace) y `evento` (`tarea_cerrada`: lo puso el sistema).
- `chat_mencion`: a una persona o a todo el canal.
- `chat_reaccion` (2b): mensaje, persona y una de las seis; quitarla es `quitada_at`.
- `chat_fijado` (2b): lo fijado en cada canal, con quién y cuándo; desfijar es `quitado_at`. Bajo el libro.
- `chat_guardado` (2b): lo de cada uno; quitarlo es `quitado_at`.
- `chat_enlace` (2b): la vista previa de cada enlace (título, descripción, sitio) y si se pudo leer.
- De Slack (2d): `chat_canal.slack_id` y `chat_mensaje.slack_canal`, `slack_ts` (únicos juntos: lo que impide duplicar) y `autor_externo` (el nombre de Slack de quien no es usuario del ERP).
- `chat_slack_usuario` (2d): cada persona de Slack, su usuario del ERP y cómo se decidió (`email`, `nombre` o `a mano`). Bajo el libro.
- `chat_slack_fichero` (2d, db/260): cada fichero de un mensaje traído (su id de Slack) y su adjunto cuando se sube. Bajo el libro.

## La API (`/chat/api`)

```
GET  /chat/api/canales                       los suyos, con no leídos y menciones
GET  /chat/api/canales/:id                   uno, con quién está dentro y qué puede hacer
GET  /chat/api/canales/:id/mensajes?antes=|despues=
POST /chat/api/canales/:id/mensajes          { texto, padreId?, borrador? }   (borrador: donde subió ya sus ficheros)
GET  /chat/api/canales/:id/fijados           lo fijado en el canal
POST /chat/api/canales/:id/leido             { hasta }
POST /chat/api/canales                       { nombre, tipo, tema, descripcion }   (chat_canales)
POST /chat/api/canales/:id/miembros          { usuarioId }    (añadir a un privado o a un grupo)
POST /chat/api/canales/:id/miembros/quitar   { usuarioId }
POST /chat/api/directos                      { usuarios }
POST /chat/api/canales/:id/ocultar           { ocultar }      (directos; solo de su lista; db/274)
POST /chat/api/canales/:id/archivar          { archivar }     (canales; quien lo creó o quien lleva los canales)
POST /chat/api/canales/:id/eliminar                           (marca, nunca borra)
GET  /chat/api/eliminados                                     «Mensajes eliminados» (rol desarrollador)
GET  /chat/api/mensajes/:id  ·  /chat/api/mensajes/:id/hilo  ·  /chat/api/personas
GET  /chat/api/guardados                     lo que guardó quien mira
POST /chat/api/mensajes/:id/editar           { texto }        (solo su autor)
POST /chat/api/mensajes/:id/anular           { motivo? }      (lo propio, sin motivo; lo de otro, quien lleva los canales)
POST /chat/api/mensajes/:id/reaccion         { emoji }        la pone o la quita
POST /chat/api/mensajes/:id/fijar            { fijar }
POST /chat/api/mensajes/:id/guardar          { guardar }
POST /chat/api/mensajes/:id/tarea            { titulo, descripcion, responsableId, plazoDias, venceEl }
```

Los ficheros se suben por la ruta de siempre de [[Adjuntos]], al borrador (`/adjuntos/api/chat_borrador/<borrador>`). El chat se registra como dos dueños: `chat_borrador` (solo quien escribe) y `chat_mensaje` (lo ve quien ve el mensaje; lo quita su autor o quien lleva los canales; no admite subidas).

De toda la oficina, como `/tablero`: no está en el catálogo de permisos y cada canal se comprueba en el servicio.

La migración de Slack, **solo el desarrollador** (`sesion.requiereDesarrollador`):

```
GET  /chat/slack                     la pantalla
GET  /chat/slack/api/estado          la exportación subida, lo que esté en marcha (con su informe) y los ficheros (total y por subir)
POST /chat/slack/api/exportacion     el JSON de la exportación (hasta 50 MB; se salta el parser de 2 MB de app.js)
GET  /chat/slack/api/personas        quién es quién, y los usuarios del ERP para elegir
POST /chat/slack/api/personas        { slackId, usuarioId }   corregir a mano (null: con su nombre de Slack)
POST /chat/slack/api/simular         en segundo plano; una a la vez
POST /chat/slack/api/migrar          en segundo plano; se puede repetir
GET  /chat/slack/api/ficheros        los que faltan por subir
POST /chat/slack/api/ficheros/:id    el fichero tal cual (application/octet-stream), a su mensaje; si ya estaba, nada
```

## Ficheros

```
db/256-chat.sql                       las tablas, los 19 canales de Slack y quién crea canales
db/257-chat-2b.sql                    reacciones, fijados, guardados, vistas previas y los mensajes de solo ficheros
db/259-chat-slack.sql                 de dónde viene cada canal y mensaje de Slack, quién es quién, y el orden por fecha
db/260-chat-slack-ficheros.sql        de qué mensaje es cada fichero de Slack y si ya se subió
services/enlaces.js                   la vista previa de un enlace, protegida contra SSRF (pieza de la casa)
modules/Chat/chat.service.js          quién ve qué, enviar, menciones, hilos, leídos, contadores
modules/Chat/chat.repo.js             el SQL
modules/Chat/chat.controller.js       /chat, /chat/api y /chat/slack
modules/Chat/slack.service.js         la migración de Slack: la exportación, quién es quién, el texto, simular, migrar y los ficheros
modules/Chat/slack.repo.js            su SQL
modules/Chat/vistas/chatSlack.ejs     la pantalla de la migración
public/assets/js/vistas/Chat/slack.js el estado, «Qué se trae» y «Quién es quién»
modules/Chat/vistas/chat.ejs          la pantalla
public/assets/js/vistas/Chat/chat.js  la lista, la conversación, los hilos y las menciones
test/chat.test.js                     3 pruebas (2a)
test/chat-2b.test.js                  6 pruebas (2b)
test/chat-slack.test.js               5 pruebas (2d, con una exportación de mentira)
```
