---
tags: [modulo, documentos, drive, archivo, caducidades]
aliases: [Documentos, Almacén de documentos, Archivo documental]
---

# Documentos

El archivo documental de la empresa. Sustituye a tener los papeles en el ordenador de alguien: **el índice vive en PostgreSQL y los bytes en Drive**. Está en `modules/Documentos/`.

```
documentos.controller.js   la API, el OAuth de Drive y las rutas viejas
documentos.service.js      LA PUERTA. Genérica: documentos DE ALGO.
documentos.repo.js         el índice en PostgreSQL + los almacenes
```

**No tiene pantalla propia**: se usa desde la ficha del conductor (Plantilla) y desde la ficha del candidato ([[Seleccion]]).

## Es genérico a propósito

No es "los documentos del conductor": es **"los documentos de algo"**. El ámbito viaja como dato, así que `subir('vehiculo', 12, {…})` y `subir('conductor', 83, {…})` son la misma operación.

Hoy los ámbitos son `conductor` y `vehiculo`, y **los dos funcionan ya**: la tabla `documento` tiene las dos columnas y `cat_tipo_documento` distingue el ámbito de cada tipo. Cuando Vehículos quiera guardar una ficha técnica o un permiso de circulación, no hay que tocar nada aquí. Añadir un ámbito nuevo (proveedor, contrato…) es tocar `AMBITOS` en el servicio y el catálogo de tipos, y nada más.

El ámbito se valida arriba, en el servicio, para que uno mal escrito dé un error **con nombre** —"no existe el ámbito proveedor"— en vez de un "falta de quién es el documento" que no dice dónde mirar. Y un documento es de una persona **o** de un coche, nunca de las dos.

El almacén también se cambia por dentro: `ALMACEN` en el repositorio es un mapa de motores que saben subir, borrar y descargar, hoy solo `drive`. El día que los bytes se muden se añade otro motor y ninguna pantalla se entera.

## Qué arregla el índice

Lo de antes eran archivos sueltos en Drive. Dos cosas cambian:

- **La carpeta se llama con el ID** (`conductor-83`), no con el DNI ni con el nombre. Esa es la corrección de fondo: el nombre cambia y el DNI puede llegar tarde, y cualquiera de las dos cosas partía los documentos de una persona en **dos carpetas** — cuando llegaba el DNI se creaba una segunda y los archivos de la primera quedaban huérfanos.
- **Cada archivo tiene tipo**, y con el tipo vienen las preguntas que importan: a quién le caduca el permiso, a quién le falta el contrato. El catálogo dice además qué caduca, qué es obligatorio y con cuántos días hay que avisar.

**La fecha de caducidad no se exige** (18/09/2026). Antes, un tipo marcado como `caduca` no dejaba subir el papel sin teclearla; la idea era buena —sin fecha no hay aviso de vencimiento— pero el precio lo pagaba quien sube, y las fechas acababan mal tecleadas. Un papel subido sin fecha vale; un papel que nadie sube porque el formulario no le deja, no.

Al subir, **primero los bytes y después el índice**: si el almacén falla, no queda una fila apuntando a nada. La caducidad se resuelve en la consulta, para que ninguna pantalla la calcule por su cuenta.

## La puerta

Desde fuera se entra por `documentos.service`, nunca por `documentos.repo` — ver [[Reglas de la casa]]. Quién entra hoy:

| Quién | A qué |
|---|---|
| Plantilla (`modules/Conductores/plantilla.service.js`) | los documentos de la ficha del conductor |
| Selección (`modules/Seleccion/seleccion.service.js`) | los papeles del candidato y su ficha en PDF |
| su propio controlador | la API genérica |

## La API

| | |
|---|---|
| `GET /documentos/api/tipos/:ambito` | qué se puede subir y qué caduca |
| `GET /documentos/api/de/:ambito/:id` | sus documentos (`?historial=1` incluye los reemplazados) |
| `POST /documentos/api/de/:ambito/:id` | subir uno (base64 en el JSON, hasta 30 MB) |
| `PUT /documentos/api/doc/:id` | corregir fechas o notas sin volver a subir |
| `DELETE /documentos/api/doc/:id` | retirar del índice (`?archivo=1` borra también de Drive) |
| `GET /documentos/api/doc/:id/descargar` | los bytes, respetando los permisos del ERP |
| `GET /documentos/api/vencen` | lo que caduca pronto, de personas y de coches |

Las rutas llevan `de/` y `doc/` **a propósito**: sin ese prefijo, `/api/:ambito/:id` se comería a `/api/archivo/:id` de las rutas viejas —los dos son tres segmentos— y ganaría el que estuviera declarado antes. Es de las cosas que se rompen al reordenar un fichero sin darse cuenta.

**Quién puede llamarlas**: el control de acceso mapea por prefijo más largo, así que todas caen bajo el permiso `/documentos` (hoy: reclutador y administración). Ver [[Usuarios y permisos]]. Ojo con `/api/vencen`: lista lo que caduca **de todo el mundo**, no de una persona.

## Las rutas viejas

`/api/lista`, `/api/subir` y `/api/archivo/:id` **no pasan por el índice**: hablan con Drive directamente y nombran la carpeta con una clave de texto libre (idBolt, DNI o nombre). Ese es justo el fallo que el índice vino a arreglar.

Hoy **no las llama ninguna vista del proyecto**. Se dejan porque una ruta puede llamarla algo que no está en este repositorio —un marcador, un script—, y un 404 sin aviso es peor que una ruta vieja. Se borran en cuanto se confirme.

## El OAuth de Drive

`/documentos/auth` y `/documentos/auth/callback` se usan **una vez**: conectan la cuenta de Google y devuelven el token de refresco para guardarlo en el servidor. Después no hacen falta.

Las credenciales viven **solo** en variables de entorno: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` y, opcionalmente, `GOOGLE_OAUTH_REDIRECT` (si no está, la URI de redirección se deduce de la propia petición, respetando el protocolo que pone el proxy delante).

`GET /documentos/api/estado` dice si la cuenta está conectada: lo pregunta la pantalla de ajustes para saber si puede ofrecer el botón de subir o hay que conectar antes.

## Las fechas del carné (24/09/2026)

La ficha de alta pide la fecha de expedición y la de caducidad del carné, y son las del **documento del permiso**, no de la persona. La regla vive aquí y la usan Selección y Plantilla: `fechasCarne(conductorId)` las da en AAAA-MM-DD para rellenar un formulario, y `prepararFechasCarne(conductorId, { expedicion, caducidad })` las comprueba **sin tocar nada** —formato, que haya carné subido, que no caduque antes de expedirse— y devuelve cómo aplicarlas. Va en dos pasos para que quien guarda un formulario entero pueda decir «esto no vale» antes de haber guardado la otra mitad.

## Carga masiva: subir los papeles de muchos de una vez

Para quien cargue la documentación de la plantilla desde una carpeta (DNI, carnés,
certificados…), con un script y no desde la ficha. Escrito el 01/10/2026, cuando
se empezó esa carga. **Lo que hay que saber antes de subir el primero:**

**1. Se sube por la puerta, nunca a mano.** `documentos.service.subir('conductor',
id, { tipo, nombre, mime, base64, fechaEmision, fechaCaduca, notas }, { usuarioId })`.
Hace las dos cosas en orden —bytes a Drive, índice a la tabla `documento`—, deja la
carpeta en `conductor-<id>` y apunta quién lo subió en la auditoría. Ni `INSERT`
a mano en `documento` ni subir a Drive con otra carpeta: es exactamente el
desorden que este módulo vino a arreglar (ver «Las rutas viejas», abajo).

**2. La persona se reconoce por el DNI, nunca por el nombre.** `conductor.dni_nie`
(comparar en mayúsculas y sin espacios, y fuera los `es_centinela`). El nombre
puede venir escrito de diez formas y dos personas pueden llamarse igual. Lo que no
case por DNI no se sube: va a una lista para que lo mire una persona. Es la regla de
identidad de la casa: ver [[Conductores#La regla de identidad]].

**3. Subir REEMPLAZA.** Si esa persona ya tiene un documento vigente del mismo
tipo, el nuevo lo sustituye: el viejo queda `vigente = FALSE` y el nuevo apunta a él
en `reemplaza_a`. No se pierde, pero deja de ser el que vale. A 01/10/2026 ya hay
**125 documentos** subidos por Selección y desde las fichas (DNI 21, permiso 21,
cuenta 12, vida laboral 12, penales 11, reverso del permiso 11, foto 10, reverso
del DNI 8, ficha de alta 6, VTC 6): **comprobar antes si ya lo tiene** y decidir si se
salta o se sustituye, no pisarlo sin saberlo.

**4. El tipo es un código de `cat_tipo_documento`**, y anverso y reverso son tipos
distintos:

| Código | Qué es | Obligatorio | Caduca |
|---|---|---|---|
| `dni` / `dni_reverso` | DNI o NIE, anverso / reverso | sí / no | sí / no |
| `permiso` / `permiso_reverso` | permiso de conducir, anverso / reverso | sí / no | sí / no |
| `penales` | certificado de delitos sexuales | sí | sí |
| `cuenta` | certificado de cuenta | sí | no |
| `vida_laboral` | vida laboral o certificado de la SS | sí | no |
| `contrato` | contrato firmado | sí | no |
| `alta_ss` | alta en la Seguridad Social | sí | no |
| `vtc` | tarjeta VTC | no | sí |
| `reconocimiento` | reconocimiento médico | no | sí |
| `formacion` | certificado de formación | no | sí |
| `ficha_alta` | ficha de alta | no | no |
| `foto` | **la cara de la persona** (la de su ficha) | no | no |
| `otro_conductor` | otro | no | no |

`foto` no es «una foto de un documento»: es la que sale de avatar en la ficha
(`subirFoto`). Un DNI escaneado en JPG es `dni`, no `foto`. Lo obligatorio es lo que
cuenta la columna «Ficha» de Plantilla como «le falta».

**5. Las fechas son opcionales**, y van como texto `AAAA-MM-DD`. Sin fecha el papel
vale, pero no avisa de su vencimiento. Si se leen de la imagen, que las revise una
persona antes de guardarlas: leídas a ojo salen mal (un carné con 12/12/2024 donde
ponía 12/02/2024). Las del permiso son además las que imprime la ficha de alta
(`fechasCarne`). Y al leer un `DATE` de la base, `to_char`, nunca `toISOString`
(da el día anterior en Madrid; ver [[Trampas conocidas]]).

**6. Credenciales, para lanzarlo fuera de Render:** `DATABASE_URL` y las de Drive
(`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`,
y `DRIVE_DOCS_FOLDER_ID` si está puesta en Render). Sin `DRIVE_DOCS_FOLDER_ID`,
`carpetaRaiz()` busca la carpeta raíz **por nombre** en esa cuenta y, si no la
encuentra, crea otra: con otra cuenta de Google los papeles acabarían en otro Drive.
Las claves se pasan en el comando, no se escriben en ningún fichero.

**7. `MODO_PRUEBAS` NO frena Drive.** El modo pruebas para WhatsApp y las
escrituras de Mapon, pero `drive.subir` no lo mira: un script lanzado «en pruebas»
sube de verdad. El ensayo hay que hacerlo **sin llamar a `subir`**: listar qué se
haría (persona, tipo, si ya lo tiene, qué no casa) y subir solo cuando eso esté
revisado.

**8. Lo que no se commitea:** la carpeta de documentos, las listas con DNI ni los
scripts de la carga. Son datos personales y herramientas de una vez: van fuera del
repositorio (la casa los guarda en «Scripts de análisis», con su README).

## Lo que falta

El módulo está listo; lo que falta es **cargar los papeles** de la plantilla. A 01/10/2026 hay 125 documentos (los de Selección y los subidos desde las fichas) para 219 personas de alta, y la carga desde la carpeta de RRHH está en marcha (ver «Carga masiva», arriba). Se notó investigando la suspensión de [[BOLT]] del 12/09, donde no se pudo descartar una caducidad de documentos porque ese conductor no tenía ninguno cargado.
