---
tags: [modulo, chat, hoja-de-ruta, item-2]
actualizado: 2026-11-17
---

# Chat interno

**El Slack de la oficina, dentro del ERP** (ítem 2 de la [[Hoja de ruta]]): «reemplazar Slack por un chat dentro del ERP, con sus mismas funciones, para que la comunicación y las tareas vivan en el mismo sistema». Solo para la oficina. Va en cuatro entregas:

- **2a — canales, directos, tiempo real, no leídos, menciones e hilos** (17/11/2026, rama `chat/2a-canales`, db/256).
- **2b — ficheros, reacciones, editar y anular, fijar y guardar, formato, vista previa de enlaces y convertir en tarea** (17/11/2026, en la misma rama, db/257).
- **2c** búsqueda, estado y no molestar, y notificaciones al móvil.
- **2d** gestión de canales (archivar, renombrar).

**Los chats arrancan vacíos** (Camilo, 17/11/2026): no se trae el historial de Slack. Los canales nacen con su nombre de siempre y sin mensajes.

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

- **Canales** públicos (de toda la oficina) y privados (de quien está dentro), y **mensajes directos** de 1 a 1 o de grupo (hasta 9 personas; el mismo grupo es siempre el mismo directo). Un privado o un directo, a quien no está dentro le da un 404: ni sabe que existe.
- **No leídos**: el canal sale en negrita; los **directos sin leer y las menciones** llevan su número. En el menú, la entrada **Chat** va en rojo con los directos y las menciones y, si no hay, en azul con lo que haya sin leer en los canales. Al abrir un canal se marca leído (con la pestaña delante), y una raya «Nuevos» enseña dónde se quedó.
- **Menciones**: al escribir «@» salen las personas (en un privado o un directo, solo las de dentro) y **@canal**, que avisa a todos. En el texto van como `<@id>` y `<!canal>`, así que un nombre cambiado no rompe nada. Un mensaje que te menciona sale resaltado. En un privado, mencionar a quien no está no cuenta: no lo podría leer.
- **Hilos** de un nivel, como Slack: «Responder en un hilo» abre el hilo al lado (Panel); responder a una respuesta es responder al de arriba. Las respuestas no cuentan como no leídas del canal; una mención dentro de un hilo, sí.
- **Al momento**: cada mensaje avisa por el [[Tiempo real]] (canal `chat`) a los del canal y mueve sus [[Contadores]]. Sin tiempo real, la pantalla pregunta cada 15 segundos.
- **Gente de un privado**: la añade cualquiera de dentro (o quien lleva los canales); la saca quien creó el canal o quien lleva los canales; cada uno puede salirse. Salir es una marca, no un borrado.
- **En el móvil**, la lista o la conversación, con un botón para volver.
- **Nada se borra**: los canales y los mensajes están bajo el [[Libro de auditoria]].

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

## Las tablas (db/256 y db/257)

- `chat_canal`: tipo (público, privado, directo), nombre, tema, descripción, `clave_directo` (los ids de un directo, en orden), archivado.
- `chat_miembro`: quién está y hasta qué mensaje ha leído (`ultimo_leido_id`); salir es `salido_at`.
- `chat_mensaje`: con su hilo (`padre_id`), cuántas respuestas tiene, editado y anulado (con quién y por qué; lo propio dice «Lo anuló quien lo escribió»). Desde la 2b, `con_adjuntos` (el texto puede ir vacío), `enlace_url` (el primer enlace) y `evento` (`tarea_cerrada`: lo puso el sistema).
- `chat_mencion`: a una persona o a todo el canal.
- `chat_reaccion` (2b): mensaje, persona y una de las seis; quitarla es `quitada_at`.
- `chat_fijado` (2b): lo fijado en cada canal, con quién y cuándo; desfijar es `quitado_at`. Bajo el libro.
- `chat_guardado` (2b): lo de cada uno; quitarlo es `quitado_at`.
- `chat_enlace` (2b): la vista previa de cada enlace (título, descripción, sitio) y si se pudo leer.

## La API (`/chat/api`)

```
GET  /chat/api/canales                       los suyos, con no leídos y menciones
GET  /chat/api/canales/:id                   uno, con quién está dentro y qué puede hacer
GET  /chat/api/canales/:id/mensajes?antes=|despues=
POST /chat/api/canales/:id/mensajes          { texto, padreId?, borrador? }   (borrador: donde subió ya sus ficheros)
GET  /chat/api/canales/:id/fijados           lo fijado en el canal
POST /chat/api/canales/:id/leido             { hasta }
POST /chat/api/canales                       { nombre, tipo, tema, descripcion }   (chat_canales)
POST /chat/api/canales/:id/miembros          { usuarioId }    (añadir a un privado)
POST /chat/api/canales/:id/miembros/quitar   { usuarioId }
POST /chat/api/directos                      { usuarios }
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

## Ficheros

```
db/256-chat.sql                       las tablas, los 19 canales de Slack y quién crea canales
db/257-chat-2b.sql                    reacciones, fijados, guardados, vistas previas y los mensajes de solo ficheros
services/enlaces.js                   la vista previa de un enlace, protegida contra SSRF (pieza de la casa)
modules/Chat/chat.service.js          quién ve qué, enviar, menciones, hilos, leídos, contadores
modules/Chat/chat.repo.js             el SQL
modules/Chat/chat.controller.js       /chat y /chat/api
modules/Chat/vistas/chat.ejs          la pantalla
public/assets/js/vistas/Chat/chat.js  la lista, la conversación, los hilos y las menciones
test/chat.test.js                     3 pruebas (2a)
test/chat-2b.test.js                  6 pruebas (2b)
```
