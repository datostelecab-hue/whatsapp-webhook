---
tags: [nucleo, adjuntos, almacen, r2, hoja-de-ruta]
actualizado: 2026-11-13
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
- **`disco`**: una carpeta, solo para local y para las pruebas. **En producción sin R2 no hay almacén**: el disco de Render se borra en cada despliegue, así que subir un fichero da el error «falta configurar Cloudflare R2» en vez de guardar algo que se va a perder.

En el [[Entorno de pruebas local]] hace de R2 un S3 de mentira (el contenedor `telecab-s3`, s3mock). En el servidor de pruebas (`MODO_PRUEBAS=1`) las rutas del almacén empiezan por `pruebas/`, así que no se mezclan con las de producción aunque compartan bucket.

## Ponerlo en marcha (lo hace Camilo)

1. **En Cloudflare**, R2 → *Create bucket*. Por ejemplo, `telecab-adjuntos`: sin acceso público, y en Europa (*location hint*).
2. **R2 → Manage API tokens → Create API token**, con permiso *Object Read & Write* solo para ese bucket. Da el *Access Key ID* y el *Secret Access Key*. El secreto se ve una sola vez.
3. **En Render** (el ERP y, si se quiere, el servidor de pruebas), las variables de entorno:

| Variable | Qué es |
|---|---|
| `R2_ACCOUNT_ID` | el *Account ID* de Cloudflare (sale en la página de R2) |
| `R2_ACCESS_KEY_ID` | el del token |
| `R2_SECRET_ACCESS_KEY` | el secreto del token |
| `R2_BUCKET` | `telecab-adjuntos` |

4. **Comprobarlo** en *Sistema → Banco de adjuntos*, solo para el desarrollador. Dice dónde se guarda y deja subir, ver y quitar ficheros de prueba.

Para el servidor de pruebas vale el mismo bucket, porque sus rutas empiezan por `pruebas/`. Uno aparte (`telecab-adjuntos-pruebas`) es más limpio.

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

- **Por trozos:** la subida no se carga entera en memoria. Según llega, se cuenta, se le saca la huella (sha256) y se manda al almacén, a R2 en partes de 8 MB. Si pasa del tope, se corta ahí mismo y no queda ni la fila ni el fichero.
- **El tope** es el parámetro `adjuntos.max_mb` (90 MB; ver [[Parametros]]). No pasa de 95 porque Cloudflare, que va delante del ERP, corta las peticiones de más de 100 MB. Un vídeo más grande pedirá subir directo a R2 con un enlace firmado. La pantalla rechaza el fichero grande antes de subirlo, y el servidor también, mirando `Content-Length` antes de leer nada.
- **Por rangos:** `Range` funciona, así que un vídeo se ve sin bajarlo entero y se puede saltar a cualquier punto. Lleva `ETag` (la huella) y `If-Range`. Varios rangos a la vez se sirven enteros.
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

## Ficheros

```
db/249-adjuntos.sql                       la tabla `adjunto`, bajo el libro
services/almacen.js                       los bytes: R2 o disco
services/adjuntos.js                      los dueños, los tipos, subir, servir, anular
services/repo/adjuntos.js                 el SQL
modules/Adjuntos/                         las rutas de todos y el banco de pruebas
public/assets/js/adjuntos.js              el componente (lista, subir con barra, ver)
test/adjuntos.test.js                     12 pruebas; la de R2 con S3_PRUEBAS
```

## Pendiente

- **La revisión a fondo quedó a medias** (13/11/2026, se apagó el PC). Hay que relanzarla antes de subir la rama. Son cuatro revisores y un escéptico por cada uno:
  - la seguridad al servir y subir;
  - la subida y la descarga por trozos;
  - la pantalla;
  - la migración, las pruebas, la documentación y la configuración de R2.

  Si cambia la base, se corrige la 249, que aún no está publicada.
- Que Camilo cree el bucket y ponga las variables en Render.
- Subir directo a R2 con un enlace firmado para los vídeos de más de 90 MB, cuando llegue el ítem de los siniestros.
- Mudar a esta tabla lo de antes (documentos, tickets, facturas, WhatsApp) al tocar cada módulo.
