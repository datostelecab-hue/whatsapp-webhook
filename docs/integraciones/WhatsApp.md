---
tags: [integracion, whatsapp, meta, bot, avisos]
aliases: [Cloud API, Bot de puertas]
---

# WhatsApp

WhatsApp es **el canal con los conductores**. No usan la app de Mapon ni entran al ERP: lo que se les dice y lo que piden pasa por aquí. Son dos cosas distintas montadas sobre el mismo número:

- **Lo que sale**: avisos de turnos, advertencias de velocidad, alertas a los controladores, bienvenida de Ballenoil. Vive en `services/whatsapp.js`.
- **Lo que entra**: el bot (abrir/cerrar puertas, código de lavado, ver turnos, fichar turno). Vive en `routes/botPuertas.js`. El PIN de repostaje de Ballenoil se quitó del bot el 24/09/2026: ya no se usa.

Es la **Cloud API de Meta**, contra `graph.facebook.com`, versión `v25.0`.

## Cómo se manda un mensaje

El token está en la variable de entorno `WHATSAPP_TOKEN` (es permanente, de System User). El `PHONE_NUMBER_ID` del número emisor y el id del WABA están **fijos en el código**, no en el entorno; el del WABA se puede cambiar con `WHATSAPP_WABA_ID`. No son secretos, pero son configuración que debería salir del código.

`limpiarTelefono()` deja el número en solo dígitos y **le añade el 34** si viene con 9 dígitos, que es como está en la agenda. WhatsApp lo exige con prefijo.

Hay cuatro formas de salir:

| Función | Qué manda | Cuándo se puede |
|---|---|---|
| `enviarPlantillaNombre` | plantilla con variable **nombrada** (`parameter_name`) | siempre |
| `enviarPlantillaPosicional` | plantilla con variables `{{1}}`, `{{2}}`… | siempre |
| `enviarTexto` | texto libre | solo dentro de la ventana de 24 h |
| `enviarBotones` | texto + hasta 3 botones de respuesta rápida | solo dentro de la ventana de 24 h |

Todo lo que sale a alguien que **no nos ha escrito en las últimas 24 h** tiene que ir en plantilla aprobada. Los botones se cortan a 20 caracteres y no caben más de tres: lo impone WhatsApp, no el código.

**El baile de idiomas.** Meta responde `#132001 "Template name does not exist in the translation"` cuando la plantilla existe y está aprobada **pero no en el idioma que se le pide**: al crearla se elige "Español" (`es`) o "Español (España)" (`es_ES`) y no son intercambiables. En vez de acertar a mano, `enviarTemplate` prueba `es`, `es_ES`, `es_MX`, `es_AR` y **recuerda el que funcionó** para cada plantilla, así que solo se tantea en el primer envío. El reintento **solo ocurre si el error es de idioma**: cualquier otro (parámetros, número, límite de conversaciones) daría igual con otro código y gastaría envíos.

Hay un apaño parecido con el número de parámetros: si la plantilla de turnos no lleva variables, mandarle una da error `132000`, y entonces se reintenta sin cuerpo y se recuerda. Un fallo de parámetros no llega a enviar mensaje, así que reintentar no duplica.

Para diagnosticar están `listarPlantillas()` —nombre, idioma, estado, categoría, variables y botones exactos tal como los tiene Meta— y `estadoCuenta()`, que dice el escalón de mensajería, la calidad del número, qué empresa posee el WABA y si está verificada. Eso último resuelve el caso típico de "mi empresa está verificada y WhatsApp me sigue limitando": suele ser que el WABA cuelga de otro portfolio distinto del verificado.

## Plantillas

El detalle completo, con los textos exactos y las reglas de Meta, está en [[PLANTILLAS-WHATSAPP]] (`docs/PLANTILLAS-WHATSAPP.md`). Se crean sin teclearlas a mano con `node scripts/crear-plantillas-whatsapp.js --ver` (y `--go` para mandarlas a revisión).

**Aprobadas y en uso:**

| Plantilla | Variables | Quién la usa |
|---|---|---|
| `atencion_hora` | `nombre` (nombrada) | aviso de horas |
| `ballenoil` | `nombre` (nombrada) | bienvenida Ballenoil, con botón "VER PIN" |
| `detalle_turnos` | 1 posicional | aviso de turnos, con botón "Ver mis turnos" |
| `advertencia_limite` | 2 posicionales (nombre, matrícula) | sanciones por exceso de velocidad |

**Pendientes de aprobación — las alertas de [[Control]]:** `alerta_control` (la genérica, sirve para los tres tipos porque el hecho concreto viaja en `{{4}}`) y las tres por tipo: `alerta_rechazo_directo`, `alerta_sin_respuesta`, `alerta_km_parado`. Sin ellas el módulo detecta pero no avisa: había **338 alertas en `sin_destinatarios` desde el 11/09**.

Las cuatro llevan **las mismas cuatro variables posicionales en el mismo orden**: nombre en BOLT, teléfono, horas efectivas de su jornada (05:00 → ahora) y el hecho concreto. Es deliberado: cambiar de la genérica a una por tipo no toca cómo se arman los parámetros. Y si la propia aún no está aprobada, el aviso **no se pierde**: sale por la genérica con su frase larga.

El nombre de cada plantilla se puede cambiar sin tocar código: `PLANTILLA_TURNOS`, `PLANTILLA_ALERTA_CONTROL`, `PLANTILLA_ALERTA_RECHAZO_DIRECTO`, `PLANTILLA_ALERTA_SIN_RESPUESTA`, `PLANTILLA_ALERTA_KM_PARADO`.

**Aprobar la plantilla no enciende las alertas.** Hacen falta tres cosas independientes: la plantilla aprobada, elegir destinatarios en `/alertas/config` (ese permiso nace apagado) y pasar el modo a `live` — en `test` la alerta se registra y no sale nada, con estado `simulada`.

**Categoría.** Meta puede recategorizar una UTILITY como MARKETING por su cuenta, y se cobra distinto. Son avisos internos a empleados, que no encaja del todo en la definición de UTILITY ("una transacción, cuenta o pedido concretos").

## Lo que entra: el webhook y el bot

`app.js` verifica el webhook con `VERIFY_TOKEN` (en el entorno) y `routes/botPuertas.js` recibe los mensajes.

**Enrutado por número.** Lo primero que se mira es el `phone_number_id` del mensaje: lo que llega al número de la boda va a `services/boda.js` (un favor aparte, con su propio módulo de confirmaciones) y el bot de Telecab queda intacto. Un mismo webhook, dos productos.

**Quién puede usar el bot.** Lo decide `services/repo/puertas.quienPuedeAbrir()`: un conductor abre **por estar de alta** con el número con el que se le dio de alta, y la gente de oficina **por tener el permiso `/puertas`**, que se reparte uno a uno. BOLT no entra en esa decisión a propósito. Y cuando no se puede, **se dice qué falta** (`sin_numero`, `no_esta`, `sin_alta`, `bloqueado`, `sin_permiso`, `error`): un "no estás autorizado" a secas manda a la persona a preguntar a tráfico y a tráfico a mirar la hoja, y cada motivo tiene una salida distinta.

**Qué entiende:**

- Una **matrícula** → busca el coche en Mapon y abre el menú de botones. El filtro es `/^(?=.*\d)[A-Za-z0-9]{6,8}$/`: exige al menos un dígito porque con `{4,8}` a secas *"hola"* era una matrícula válida — Ignacio saludó al bot y le contestó «Matrícula "HOLA" no encontrada» sin saludarle siquiera. Lo mismo pasaba con "buenas", "gracias" o "vale".
- **Abrir / cerrar puertas** → ejecuta `open_doors` / `close_doors`. Esto **no va por la API de Mapon**, va por un Apps Script intermedio.
- **Código de lavado** (`codigosBallenoil`), con el instructivo de Ballenoil. El **PIN de repostaje** se quitó el 24/09/2026 porque ya no se usa: si alguien pulsa el botón «VER PIN» de una bienvenida vieja, se le dice eso y se le deja el menú.
- **Ver turnos** → el cuadrante de la semana en texto libre. Volver del teléfono a la persona es el reto: se prueban todas las identidades conocidas normalizadas, porque con igualdad literal fallaba con tildes, apellidos cambiados de orden o teléfonos que no están en BOLT.
- **Fichaje de turno** (`services/fichajeBot.js`), que enlaza conductor ↔ coche en Mapon. Va **antes** de la comprobación de acceso porque quien lo prueba puede no estar en la agenda, y solo actúa para los teléfonos de `FICHAJE_TELEFONOS`: para cualquier otro número devuelve `false` y el bot sigue como siempre.

Los botones llegan de dos formas distintas y hay que tratarlas aparte: los de un mensaje interactivo son `type: interactive` con `button_reply.id`, y los de una **plantilla** (quick reply) llegan como `type: button` con `button.text`/`payload`.

> [!danger] Riesgo abierto: la URL del Apps Script
> La URL de despliegue del Apps Script que abre y cierra los coches está **escrita en `routes/botPuertas.js`**. Un despliegue de Apps Script publicado no lleva autenticación propia: quien tenga esa URL puede accionar puertas. Pendiente de sacar a variable de entorno.

## Qué se registra

Nada sale sin dejar rastro, y el rastro se escribe **salga bien o mal**:

| Tabla | Qué guarda |
|---|---|
| `puerta_comando` | teléfono, conductor, matrícula, unidad, comando, si funcionó, la respuesta del error y los ms que tardó |
| `alerta_control_envio` | una fila por destinatario y alerta: usuario, teléfono, ok, si era simulado y el error recortado a 300 caracteres |
| avisos de turnos (`avisos.repo`) | a quién, cuándo y con qué resultado; `sin-telefono` se apunta como dato para RRHH, **no** como error de envío |
| libro de sanciones | estados `avisado`, `simulado`, `sin_conductor`, `dudoso`, `error` |

El registro de puertas **no se espera**: que falle apuntarlo no puede dejar a nadie sin abrir el coche.

**La regla de las alertas: un mensaje por alerta.** El mismo conductor puede levantar las tres en la misma franja —son tres avisos distintos— pero cada una suena una vez. Eso **no se resuelve con un `if`**, se resuelve con el índice único de la tabla: aunque dos revisiones se crucen, la base solo deja entrar la primera y solo se manda WhatsApp por la fila que de verdad se insertó. Ver [[Trampas conocidas]].

**Ritmo de envío.** En los bulk se dejan **1,2 segundos entre mensajes** (~50/min, por debajo de los límites de Meta). Un envío a 200 personas son cuatro minutos, y por eso va en segundo plano y no colgado de la petición HTTP.

**Modos test/live.** Sanciones (`SANCIONES_MODO`) y alertas de control tienen modo de pruebas: se registra todo y no sale nada. En sanciones hay además una regla de silencio: un aviso por algo que pasó hace diez días no avisa de nada —el conductor ya no se acuerda de ese trayecto— así que no se manda, pero el exceso **sí queda contado**, que es lo que alimenta la calificación.

## Quién manda WhatsApp

| Fichero | Qué manda |
|---|---|
| `modules/Planificacion/cobertura.service.js` | el aviso de turnos de la semana |
| `modules/Operaciones/sanciones.service.js` | la advertencia por exceso de velocidad |
| `modules/Control/alertas.repo.js` | las alertas de franja a los controladores |
| `routes/administracion.js` | la bienvenida de Ballenoil |
| `services/fichajeBot.js` | la conversación de fichaje de turno |

Ninguno de ellos llama a [[BOLT]] ni a [[Mapon]] para decidir: lo que necesitan ya está en PostgreSQL, puesto por la [[Ingesta]]. Lo único que sale fuera es el WhatsApp, que es el trabajo.
