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

Al subir, **primero los bytes y después el índice**: si el almacén falla, no queda una fila apuntando a nada. La caducidad se resuelve en la consulta, para que ninguna pantalla la calcule por su cuenta.

## La puerta

Desde fuera se entra por `documentos.service`, nunca por `documentos.repo` — ver [[Reglas de la casa]]. Quién entra hoy:

| Quién | A qué |
|---|---|
| Plantilla (`routes/plantilla.js`) | los documentos de la ficha del conductor |
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

## Lo que falta

El módulo está listo; lo que falta es **cargar los papeles**. La tabla tiene 14 filas de 2 conductores de 218, subidas el 3 y 4 de septiembre de 2026: son las pruebas de la migración. Se notó investigando la suspensión de [[BOLT]] del 12/09, donde no se pudo descartar una caducidad de documentos porque ese conductor —como otros 216— no tiene ninguno cargado.
