---
tags: [modulo, chat, hoja-de-ruta, item-2]
actualizado: 2026-11-17
---

# Chat interno

**El Slack de la oficina, dentro del ERP** (ítem 2 de la [[Hoja de ruta]]): «reemplazar Slack por un chat dentro del ERP, con sus mismas funciones, para que la comunicación y las tareas vivan en el mismo sistema». Solo para la oficina. Va en cuatro entregas:

- **2a — canales, directos, tiempo real, no leídos, menciones e hilos** (17/11/2026, rama `chat/2a-canales`, db/256): esta nota.
- **2b** adjuntos y vista previa, reacciones, editar y anular, fijar y guardar, formato, vista previa de enlaces y convertir en tarea.
- **2c** búsqueda, estado y no molestar, y notificaciones al móvil.
- **2d** gestión de canales (archivar, renombrar) y la migración de Slack.

## Lo que decidió Camilo (17/11/2026)

1. **Los 16 canales públicos de Slack, abiertos a toda la oficina**, también #4-bajas-medicas, #6-nominas, #9-rrhh y #16-efectivo, como pidió Ignacio.
2. **Toda la oficina dentro de todos los públicos** desde el primer día: los ve en su lista y le cuentan los no leídos. Quien llega después entra solo, y lo de antes no le cuenta como no leído.
3. **Crean canales los puestos de Dirección y Desarrollo** (la función de [[Organizacion]] `chat_canales`: CEO, Dirección de operaciones, Dirección de Barcelona y Desarrollo).
4. **Los privados, con quien los pidió**: #datos (Camilo), #martes-10am (Ignacio) y #escalaciones-lorenzo (Lorenzo). Su gente se añade desde el chat.

## Cómo funciona

- **Canales** públicos (de toda la oficina) y privados (de quien está dentro), y **mensajes directos** de 1 a 1 o de grupo (hasta 9 personas; el mismo grupo es siempre el mismo directo). Un privado o un directo, a quien no está dentro le da un 404: ni sabe que existe.
- **No leídos**: el canal sale en negrita; los **directos sin leer y las menciones** llevan su número. En el menú, la entrada **Chat** va en rojo con los directos y las menciones y, si no hay, en azul con lo que haya sin leer en los canales. Al abrir un canal se marca leído (con la pestaña delante), y una raya «Nuevos» enseña dónde se quedó.
- **Menciones**: al escribir «@» salen las personas (en un privado o un directo, solo las de dentro) y **@canal**, que avisa a todos. En el texto van como `<@id>` y `<!canal>`, así que un nombre cambiado no rompe nada. Un mensaje que te menciona sale resaltado. En un privado, mencionar a quien no está no cuenta: no lo podría leer.
- **Hilos** de un nivel, como Slack: «Responder en un hilo» abre el hilo al lado (Panel); responder a una respuesta es responder al de arriba. Las respuestas no cuentan como no leídas del canal; una mención dentro de un hilo, sí.
- **Al momento**: cada mensaje avisa por el [[Tiempo real]] (canal `chat`) a los del canal y mueve sus [[Contadores]]. Sin tiempo real, la pantalla pregunta cada 15 segundos.
- **Gente de un privado**: la añade cualquiera de dentro (o quien lleva los canales); la saca quien creó el canal o quien lleva los canales; cada uno puede salirse. Salir es una marca, no un borrado.
- **En el móvil**, la lista o la conversación, con un botón para volver.
- **Nada se borra**: los canales y los mensajes están bajo el [[Libro de auditoria]]; editar y anular llegarán en la 2b como anulación con su motivo.

Todo con piezas globales: Panel (hilos y miembros), Dialogo (nuevo canal, directo, añadir), Api, TiempoReal, Contadores y las clases `.tc-chat*` de `telecab.css` (V3).

## Las tablas (db/256)

- `chat_canal`: tipo (público, privado, directo), nombre, tema, descripción, `clave_directo` (los ids de un directo, en orden), archivado.
- `chat_miembro`: quién está y hasta qué mensaje ha leído (`ultimo_leido_id`); salir es `salido_at`.
- `chat_mensaje`: con su hilo (`padre_id`), cuántas respuestas tiene, y las columnas de editar y anular para la 2b.
- `chat_mencion`: a una persona o a todo el canal.

## La API (`/chat/api`)

```
GET  /chat/api/canales                       los suyos, con no leídos y menciones
GET  /chat/api/canales/:id                   uno, con quién está dentro y qué puede hacer
GET  /chat/api/canales/:id/mensajes?antes=|despues=
POST /chat/api/canales/:id/mensajes          { texto, padreId? }
POST /chat/api/canales/:id/leido             { hasta }
POST /chat/api/canales                       { nombre, tipo, tema, descripcion }   (chat_canales)
POST /chat/api/canales/:id/miembros          { usuarioId }    (añadir a un privado)
POST /chat/api/canales/:id/miembros/quitar   { usuarioId }
POST /chat/api/directos                      { usuarios }
GET  /chat/api/mensajes/:id  ·  /chat/api/mensajes/:id/hilo  ·  /chat/api/personas
```

De toda la oficina, como `/tablero`: no está en el catálogo de permisos y cada canal se comprueba en el servicio.

## Ficheros

```
db/256-chat.sql                       las tablas, los 19 canales de Slack y quién crea canales
modules/Chat/chat.service.js          quién ve qué, enviar, menciones, hilos, leídos, contadores
modules/Chat/chat.repo.js             el SQL
modules/Chat/chat.controller.js       /chat y /chat/api
modules/Chat/vistas/chat.ejs          la pantalla
public/assets/js/vistas/Chat/chat.js  la lista, la conversación, los hilos y las menciones
test/chat.test.js                     3 pruebas
```
