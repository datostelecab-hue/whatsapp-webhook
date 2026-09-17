---
tags: [integracion, google, drive, sheets, migracion, documentos]
aliases: [Drive, Sheets, Hojas de cálculo, Adiós a las hojas]
---

# Google Drive y Sheets

Google fue **el sitio donde vivía el ERP entero**: los datos en hojas de cálculo y los papeles en Drive. La dirección de fondo es dejar de leer hojas y leer solo PostgreSQL, y a septiembre de 2026 eso está casi hecho. Drive, en cambio, **se queda**: los bytes de un documento no tienen por qué estar en la base.

Son dos servicios distintos con dos credenciales distintas:

- `services/drive.js` — **OAuth con una cuenta de persona**. Guarda archivos.
- `services/sheets.js` — **cuenta de servicio**. Lee (y cada vez escribe menos) hojas.

## Drive: los bytes de los documentos

**Por qué OAuth y no la cuenta de servicio.** Las cuentas de servicio **no tienen cuota de almacenamiento**, así que no pueden ser dueñas de archivos. Drive se autentica con la cuenta de Google de la empresa: los archivos son suyos y ocupan sus 15 GB. La cuenta de servicio se sigue usando solo para las hojas.

Credenciales, todas en variables de entorno: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` y opcionalmente `GOOGLE_OAUTH_REDIRECT`. El *refresh token* se obtiene **una vez** desde la pantalla `/documentos/auth`, que hace el flujo de consentimiento (`authUrl` + `exchangeCode`). Sin él, Drive dice que no está conectado en vez de fallar de forma rara.

El scope es **`drive.file`**: la aplicación solo ve y gestiona **los archivos que ella misma ha creado**. Es el permiso mínimo y no requiere verificación de Google. No puede leer el Drive de nadie.

### Cómo está organizado

```
DocumentosConductores/          ← la raíz (o la que diga DRIVE_DOCS_FOLDER_ID)
   <clave>/                     ← una carpeta por "algo"
      <archivos>
```

> [!warning] La carpeta NO debe llamarse con el nombre ni con el DNI
> El montaje anterior nombraba la carpeta con el DNI o, si no había, con el **nombre**. Cuando llegaba el DNI se creaba una segunda carpeta y los archivos de la primera quedaban huérfanos. Ahora la clave es el **ID**, que no cambia nunca.

Y nadie sabía qué era cada archivo. Hoy **el índice está en PostgreSQL y los bytes en Drive**: la base guarda qué es cada documento, de quién, cuándo caduca y quién lo subió; Drive guarda el archivo detrás de `almacen` + `externo_id`. Con el tipo vienen las preguntas que importan: a quién le caduca el permiso, a quién le falta el contrato. El día que los bytes se muden a otro sitio se añade otro almacén y el resto del sistema no se entera.

Las operaciones son cuatro —`subir`, `listar`, `borrar`, `descargar`— y dos detalles que evitan basura:

- **`subir` con `fileId` sobrescribe** el archivo existente y mantiene su id y su enlace. Si ese archivo ya no está (alguien lo borró a mano), crea uno nuevo. Así no se acumulan duplicados.
- **`borrar` comprueba que el archivo cuelga de la carpeta raíz** antes de tocarlo. Es una salvaguarda: un id equivocado no puede borrar algo de otro sitio del Drive.

### Quién sube a Drive

| Módulo | Qué guarda |
|---|---|
| `modules/Documentos/` | la puerta general del archivo documental: `subir('conductor', 83, …)` y `subir('vehiculo', 12, …)` son la misma operación, el ámbito viaja como dato |
| `modules/Seleccion/seleccion.service.js` | la ficha de alta en PDF del candidato (devuelve también los bytes: el PDF acaba de generarse, bajarlo otra vez de Drive es un viaje de más) |
| `modules/Vehiculos/facturas.service.js` | facturas de taller, **una carpeta por mes**; el nombre lo pone el sistema (`proveedor número`) para que dos escaneos llamados "escaneo.pdf" no se machaquen, y la extensión es la que traiga el fichero — llamar `.pdf` a un JPG hace que no abra. Si Drive falla **no se toca la factura**: mejor una factura sin PDF que una apuntando a un archivo que no existe |
| `routes/soporte.js` | adjuntos de los tickets de soporte, en carpeta con nombre provisional porque el código del ticket lo da la base **después** de subir los ficheros |

## Sheets: lo que queda de las hojas

Se autentica con una **cuenta de servicio** cuyo JSON completo vive en la variable de entorno `GOOGLE_CREDENTIALS`. La cuenta de servicio es editora de los libros que aún se tocan.

**La cuota es el problema.** Google permite **60 peticiones por minuto y usuario**, y al agotarse falla *todo* lo que lee Sheets — hasta el login, cuando el login vivía ahí. Por eso:

- Toda llamada pasa por `conReintento()`, con espera creciente de 1,5 s · 3 s · 6 s. Un pico puntual (un backfill, varios paneles a la vez) se absorbe en vez de tumbar el ERP.
- `readMany` / `writeMany` agrupan varios rangos en **un solo viaje**. Es lo que sustituyó a los ~1.000 `setValue` del Apps Script.
- `ensureGrid` **cachea el tamaño de cada pestaña**: pedir los metadatos en cada escritura multiplicaba las llamadas.

Dos trampas propias de Sheets que están resueltas en el código:

- **`values.update` no amplía la rejilla.** Escribir más filas de las que tiene la hoja (1.000 por defecto) falla con *"exceeds grid limits"*: hay que crecerla antes con `ensureGrid`.
- **`USER_ENTERED` interpreta lo que escribes.** `'2026-09-17'` se convierte en fecha con formato local y ya no vuelve como texto. Para las cabeceras que son claves existe `writeSheetRaw`, que manda `RAW` y sobrevive al ida y vuelta. Al leer pasa lo mismo al revés: `valueRenderOption: UNFORMATTED_VALUE` devuelve los números como números, sin depender del idioma de la hoja.

Todas las **escrituras** pasan además por `services/modoPruebas.js`: en modo pruebas se bloquean y se devuelve la misma forma que devolvería una escritura real (con ceros y una marca), porque devolver `undefined` hacía que los llamantes escribieran "undefined celdas" en el log y pareciera un fallo.

## Qué ya salió de las hojas

| Antes, en una hoja | Ahora, en PostgreSQL | Desde |
|---|---|---|
| `CONFIG` (correo de procesos, destinatarios) | `config_app` | 15/09/2026 |
| `CONDUCTORES_BOLT` (el padrón) | `conductor_externo` | 15/09/2026 |
| `TICKETS_IT` | ticketera unificada | rescate único |
| bitácora, justificantes, planificador | tablas propias | 08/09/2026 |
| usuarios, permisos y login | `usuario` y permisos por usuario | — |
| horas, turnos, ausencias, núcleo | el núcleo migrado | — |

Dos motivos pesaron más que el resto, y el segundo más que el primero: **de la configuración colgaba el correo** —`services/correo.js` la lee cada vez que manda algo, así que enviar un correo pasaba por Google y si Sheets tardaba no salía el correo— y **ahí dentro hay una contraseña**, cifrada, sí, pero una hoja se comparte con un clic y no deja rastro de quién la abrió. Ver [[Correo]].

### Los rescates que se hacen solos

Ninguna de esas mudanzas tuvo script de migración. **La primera lectura que encuentra la tabla vacía se trae lo que haya en la hoja, lo guarda y lo apunta en `config_app` para no repetirlo.** Se hace así porque los valores solo se pueden leer desde donde hay credenciales de Google —el servidor—, y pedirle a alguien que lance una migración a mano es pedirle que se acuerde.

Y si la hoja no contesta **no pasa nada y no se marca como hecho**: se reintenta en la siguiente lectura. Eso es lo normal fuera del servidor y no es un error.

El rescate del padrón tiene una regla extra: las fechas solo se corrigen **hacia atrás**. Si la base dice una fecha más temprana que la hoja, la de la base es la buena. La hoja solo sabe más en una dirección. Ver [[BOLT]].

## Qué sigue leyendo hojas

Cinco ficheros, y solo dos de verdad:

| Fichero | Para qué | ¿Se va? |
|---|---|---|
| `modules/Ticketera/formulario.js` | **las respuestas del Google Form** de la ticketera de RRHH | no: el formulario *es* Google |
| `services/boda.js` | la lista de invitados del módulo de la boda (favor aparte del ERP) | no |
| `services/configApp.js` | rescate único de `CONFIG` | sí, ya hecho |
| `services/conductoresBolt.js` | rescate único de las fechas de alta en BOLT | sí, ya hecho |
| `modules/Ticketera/rescateIT.js` | rescate único de `TICKETS_IT` | sí, ya hecho |

**El Google Form merece una nota.** Las cabeceras de la hoja de respuestas **son las preguntas**, y las preguntas se reescriben: "DNI" se convierte en "Indica tu DNI o NIE (con la letra)" el día que alguien la aclara. El Apps Script las tenía clavadas en una constante, así que retocar el formulario dejaba una columna sin leer **en silencio**. Ahora se buscan por trozo de texto y —esto es lo que de verdad lo arregla— **lo que no case con ningún campo conocido no se pierde**: se añade a la descripción como «Pregunta: respuesta», así que una pregunta nueva aparece en el ticket desde el primer día sin tocar una línea.

Y el **nombre de la pestaña no se escribe fijo**: se le pregunta al libro qué pestañas tiene y se elige por orden (la que fije `config_app`, una que empiece por `BBDD`, una que empiece por `Form_Responses`). No es precaución teórica — el primer intento buscó «BBDD», la pestaña se llamaba «BBDD Tickets», Google contestó *"Unable to parse range"* y las cinco bandejas salieron en rojo. Ver [[Trampas conocidas]].

## Lo que esto significa para el resto

Las pantallas ya no dependen de Google para nada que no sea un archivo. La [[Ingesta]] deja los datos en PostgreSQL y [[Control]], [[Flota viva]] y la [[Auditoria de flota]] leen de ahí. Si Sheets se cae hoy, lo único que se nota es que no entran tickets nuevos del formulario. Ver [[Glosario]].
