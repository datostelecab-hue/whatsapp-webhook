---
tags: [nucleo, adjuntos, almacen, r2, hoja-de-ruta]
actualizado: 2026-11-16
---

# Adjuntos

Desde el 13/11/2026 (db/249) hay **una sola forma de adjuntar un fichero a cualquier cosa**: una tarea, un mensaje del chat, un siniestro, una multa… Es la pieza A6 de la [[Hoja de ruta]]. Antes cada módulo lo hacía a su manera:
- `documento`: solo de un conductor o de un coche, y en Drive;
- `ticket.adjuntos`, dentro de un JSON;
- `whatsapp_adjunto`: los bytes dentro de la base;
- las facturas del taller.

## Dónde van los bytes: Cloudflare R2

Lo decidió Camilo el 13/11/2026. Drive es el Gmail de 15 GB, y cinco años de chat, multas y vídeos de siniestros no caben. R2 cuesta:
- **10 GB gratis**, y después unos **0,015 $ por GB al mes** (100 GB ≈ 1,5 $/mes);
- **nada por descargar**.

R2 habla S3, así que el cliente es el oficial de AWS (`@aws-sdk/client-s3`).

| | |
|---|---|
| Hoy, el 13/11 | 564 MB de documentos en Drive (1.463 ficheros) y 48 MB de WhatsApp en la base, que crecen unos 40 MB al mes |
| Lo que ya estaba | **se queda donde está** (Camilo). Se muda al tocar cada módulo: la tabla dice en qué almacén está cada fichero |

`services/almacen.js` tiene dos almacenes:
- **`r2`**: el de Render.
- **`disco`**: una carpeta, solo para local y para las pruebas. **En Render sin R2 no hay almacén**: su disco se borra en cada despliegue, así que subir un fichero da el error «falta configurar Cloudflare R2» en vez de guardar algo que se va a perder. Se reconoce Render por `RENDER` (la pone Render en todos sus servicios, también en el servidor de pruebas) o por `NODE_ENV=production`.

En el [[Entorno de pruebas local]] hace de R2 un S3 de mentira (el contenedor `telecab-s3`, s3mock). En el servidor de pruebas (`MODO_PRUEBAS=1`) las rutas del almacén empiezan por `pruebas/`.

## Ponerlo en marcha (lo hace Camilo)

1. **En Cloudflare**, R2 → *Create bucket*: `telecab-adjuntos` para producción y `telecab-adjuntos-pruebas` para el servidor de pruebas. Sin acceso público, *Automatic* con *location hint* **Western Europe**. No *Specify jurisdiction → EU*: cambia la dirección (`….eu.r2.cloudflarestorage.com`) y habría que ponerla en `R2_ENDPOINT`. No hace falta CORS ni dominio propio: los ficheros pasan siempre por el ERP.
2. **R2 → Manage API tokens → Create Account API token**, **una clave por bucket**: *Object Read & Write* y *Apply to specific buckets only*, solo el suyo. Da el *Access Key ID* y el *Secret Access Key*. El secreto se ve una sola vez.
3. **En Render**, cada servicio con su bucket y su clave, las variables de entorno:

| Variable | Qué es |
|---|---|
| `R2_ACCOUNT_ID` | el *Account ID* de Cloudflare: 32 letras y números, en la página de R2 (*Account Details*), o lo que va antes de `.r2.cloudflarestorage.com` en el *endpoint* |
| `R2_ACCESS_KEY_ID` | el de la clave |
| `R2_SECRET_ACCESS_KEY` | el secreto de la clave |
| `R2_BUCKET` | `telecab-adjuntos` (`telecab-adjuntos-pruebas` en el servidor de pruebas) |
| `R2_ENDPOINT` | opcional: la dirección entera (`https://<Account ID>.r2.cloudflarestorage.com`). Si está, manda sobre `R2_ACCOUNT_ID` |

4. **Comprobarlo** en *Sistema → Banco de adjuntos*, solo para el desarrollador. Dice dónde se guarda (con la dirección de R2), avisa si una variable no tiene buena pinta, y **«Probar conexión»** escribe, lee y borra una sonda: dice qué paso falla y qué revisar. Después deja subir, ver y quitar ficheros de prueba.

**El servidor de pruebas, nunca con el bucket ni la clave de producción.** El prefijo `pruebas/` solo separa lo que escribe este código; la clave deja leer, sobrescribir y borrar todo el bucket, y en el servidor de pruebas se prueban ramas sin revisar. Por lo mismo, la copia de la base para el servidor de pruebas (`scripts/entorno-pruebas-render/copiar.js`) se lleva la tabla `adjunto` sin filas: las de producción apuntan a ficheros de otro bucket.

> **«write EPROTO … ssl3_read_bytes … handshake failure … SSL alert number 40»** (16/11/2026, primera subida en el servidor de pruebas). Es Cloudflare cortando la conexión porque la dirección no es de ninguna cuenta: `R2_ACCOUNT_ID` tenía otra cosa. Ahora el ERP lo dice en español («Cloudflare no reconoce la dirección de R2: revisa R2_ACCOUNT_ID…»), quita los espacios y saltos de línea que se cuelan al pegar, y el banco avisa antes de probar si el Account ID no son 32 letras y números o si es igual que el Access Key ID.

## Cómo se usa desde un módulo

```js
// 1. El módulo dueño se registra UNA vez (al cargarse), y dice quién ve y quién adjunta:
adjuntos.registrarDueno('siniestro', {
  etiqueta: 'Siniestro',
  ver: async (quien, id) => …,        // quien = { id, rol }
  adjuntar: async (quien, id) => …,
  anular: async (quien, id) => …,      // opcional: si no, el de adjuntar
});
```

```html
<!-- 2. La pantalla: el componente de la casa -->
<script src="<%= est('/assets/js/adjuntos.js') %>"></script>
<script nonce="…">Adjuntos.montar(document.querySelector('#adjuntos'), { tipo: 'siniestro', dueno: 42, puedeQuitar: true });</script>
```

- **El permiso lo decide el dueño, no el rol:** ni el superadmin ve los adjuntos de algo que su módulo no le deja ver. Por eso `/adjuntos` no está en el catálogo de permisos: entra cualquiera con sesión, y cada fichero se comprueba.
- **Las rutas son las mismas para todos** (`modules/Adjuntos`):
  - `POST /adjuntos/api/:tipo/:dueno` sube un fichero;
  - `GET /adjuntos/api/:tipo/:dueno` da la lista;
  - `POST /adjuntos/api/:id/anular` lo quita, con motivo;
  - `GET /adjuntos/:id/fichero` lo sirve.

## Las reglas

- **Por trozos:** la subida no se carga entera en memoria. Según llega, se cuenta, se le saca la huella (sha256) y se manda al almacén, a R2 en partes de 5 MB (el mínimo de S3) y de una en una: unos 10-15 MB de memoria por subida. Si pasa del tope, se corta ahí mismo, se aborta la subida por partes y no queda ni la fila ni el fichero.
- **Como mucho cuatro subidas a la vez** en todo el servidor; la quinta recibe «Ahora mismo se están subiendo otros ficheros. Prueba otra vez en un momento» (503). Diez vídeos a la vez llevaban la instancia de Render al límite de memoria.
- **Una subida lenta tiene 15 minutos.** Node corta a los 5 minutos de serie la petición cuyo cuerpo no ha llegado entero (`requestTimeout`), y 90 MB desde un 4G flojo tardan 6-12. En `app.js`: `servidor.requestTimeout = 15 * 60 * 1000`.
- **Si el navegador se va, se suelta R2.** Al cerrar un vídeo nada más abrirlo, al arrastrar su barra o al pasar fotos deprisa, la petición se cancela, a veces antes de que R2 conteste. Se aborta la espera (`AbortSignal`) y lo que llegue se tira. Antes la conexión con R2 se quedaba colgada para siempre, y con 50 así se paraba R2 entero, también las subidas. Además, ninguna conexión con R2 pasa de 2 minutos sin moverse un byte.
- **El tope** es el parámetro `adjuntos.max_mb` (90 MB; ver [[Parametros]]). No pasa de 95 porque Cloudflare, que va delante del ERP, corta las peticiones de más de 100 MB. Un vídeo más grande pedirá subir directo a R2 con un enlace firmado. La pantalla rechaza el fichero grande antes de subirlo, y el servidor también, mirando `Content-Length` antes de leer nada.
- **Por rangos:** `Range` funciona, así que un vídeo se ve sin bajarlo entero y se puede saltar a cualquier punto. Lleva `ETag` (la huella) y `If-Range`. Varios rangos a la vez se sirven enteros.
- **El navegador pregunta cada vez** (`Cache-Control: private, no-cache`): puede guardar el fichero, pero antes de usarlo pregunta con la huella y aquí se mira el permiso antes del 304. Con `max-age` de 24 h, en un PC compartido otro usuario (o el mismo tras cerrar sesión, o con el adjunto ya anulado) lo veía desde el historial sin que el servidor se enterara.
- **Lo que se abre en la página:** solo fotos (jpg, png, gif, webp), PDF, vídeo (mp4, webm, mov) y audio.
  - **Lo demás se descarga siempre**, como `application/octet-stream`: un HTML o un SVG subido con otro nombre no corre nunca en nuestro dominio.
  - El tipo que manda el navegador solo se cree si es uno de esos; si no, sale de la extensión.
  - Cada fichero va con `nosniff` y una CSP sin scripts.
  - **El PDF va sin `sandbox`**, porque el visor de Chrome no abre un PDF aislado, y solo se deja enmarcar en nuestras páginas (`frame-ancestors 'self'`).
- **Cómo se ve** (`Adjuntos.ver`):
  - la foto, en el [[Componentes de la casa|VisorFoto]];
  - el PDF, en un marco dentro de la página;
  - el vídeo y el audio, con su reproductor;
  - lo demás se descarga.
- **Nada se borra:** quitar es anular con motivo. El fichero se queda en el almacén y la fila aquí; deja de listarse y de servirse.
- **Bajo el [[Libro de auditoria]]** desde que nace la tabla: el alta y la anulación, con quién y por qué.
- **La ruta en el almacén no lleva nombres ni DNI:** `adjuntos/AAAA/MM/<al azar>`. El nombre del fichero va en la fila.
- **Los nombres con tildes:** busboy lee el nombre del fichero como latin1 si no se le dice; va con `defParamCharset: 'utf8'`. Se vio en el banco con «vídeo».
- **Los nombres no engañan:** fuera los de control y los invisibles de formato. Con U+202E, «foto‮gpj.exe» se leía en la lista «fotoexe.jpg», con el icono de foto.
- **Los errores:** los nuestros (con su estado) se enseñan; uno que no esperábamos (de PostgreSQL, de la red) va al log y la pantalla dice «ha fallado algo en el servidor», sin el mensaje de la base. Un id imposible (texto, o más allá de bigint) es un 404.
- **En la pantalla:** con la sesión caducada, subir o descargar llevan al login como cualquier petición de `Api` (la descarga pregunta antes con un HEAD); mientras carga dice «Cargando…» y no sube nada hasta saber el tope; el motivo de quitar pide al menos 3 letras sin cerrar la ventana (`minimo` de `Dialogo.formulario`); y el foco no se pierde al quitar.

## La revisión a fondo (16/11/2026)

Cuatro revisores (seguridad, subida y descarga por trozos, pantalla, y migración con pruebas y documentación) con un escéptico cada uno: 19 hallazgos confirmados, todos arreglados en la misma rama. El más serio: la descarga cancelada antes de que R2 contestara dejaba la conexión colgada para siempre. Están en las reglas de arriba, y cada uno tiene su prueba en `test/adjuntos.test.js`:
- ver, adjuntar y quitar como tres permisos;
- el tope que corta según llega, y el aborto de la subida por partes en R2;
- el If-Range bueno, la CSP del PDF y la ruta de producción sin `pruebas/`;
- el formulario mal cerrado, el fallo que no enseña la base y el navegador que se va;
- las cuatro subidas a la vez.

## Ficheros

```
db/249-adjuntos.sql                       la tabla `adjunto`, bajo el libro
services/almacen.js                       los bytes: R2 o disco
services/adjuntos.js                      los dueños, los tipos, subir, servir, anular
services/repo/adjuntos.js                 el SQL
modules/Adjuntos/                         las rutas de todos y el banco de pruebas
public/assets/js/adjuntos.js              el componente (lista, subir con barra, ver)
test/adjuntos.test.js                     22 pruebas; la de R2 con S3_PRUEBAS
```

## Pendiente

- **La 249 ya está aplicada** (en el servidor de pruebas y en las bases locales). Un arreglo de base va en una migración nueva (db/250 o la que toque), **nunca editando la 249**: el corredor no la vuelve a ejecutar y el panel la marca como modificada.
- El bucket y la clave de producción, cuando A6 pase a `main`. El de pruebas está creado desde el 16/11/2026.
- Subir directo a R2 con un enlace firmado para los vídeos de más de 90 MB, cuando llegue el ítem de los siniestros.
- Mudar a esta tabla lo de antes (documentos, tickets, facturas, WhatsApp) al tocar cada módulo.
