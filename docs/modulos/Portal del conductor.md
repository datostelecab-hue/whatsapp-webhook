---
tags: [modulo, conductores, portal, acceso, seguridad, dominios]
ruta: / (por el dominio de los conductores)
codigo: modules/PortalConductor
fecha: 2026-10-09
---

# Portal del conductor

Camilo, 09/10/2026: *«una parte de la aplicación para que los conductores también puedan entrar, pero solamente a ver información básica de ellos. Empezamos con el login, que será por su número de teléfono, y la contraseña será el DNI/NIE. Voy a pedir un dominio para ellos para que no tengamos el mismo login, y la aplicación redirige según el dominio de la petición; también pediré uno para nosotros y así dividir la app»*.

Esta es **la primera parte: entrar y salir**. La portada solo dice quién eres (nombre y teléfono); la información llega en las partes siguientes.

| Pieza | Dónde |
|---|---|
| Qué aplicación atiende cada dominio | `services/dominios.js` |
| Las rutas y el reparto por dominio (`porDominio`) | `modules/PortalConductor/portal.controller.js` |
| El login, la sesión y sus reglas | `modules/PortalConductor/portal.service.js` |
| Datos (ficha, teléfono, accesos) | `modules/PortalConductor/portal.repo.js` · tabla `conductor_acceso` (db/189) |
| Pantallas (para el móvil) | `modules/PortalConductor/vistas/` (`layout-conductor`, `conductor-entrar`, `conductor-inicio`, `conductor-404`) |
| Comprobador | `node scripts/comprobar-portal-conductor.js` |

## Un dominio para cada uno

Es la misma aplicación en Render; **el dominio de la petición decide qué se ve** (`services/dominios.js`). Se configura con dos variables de entorno, que admiten varios dominios separados por comas:

- **`DOMINIO_CONDUCTORES`**: por ese dominio **solo existe el portal**. Lo atiende entero y todo lo demás da 404: ni el ERP, ni la sesión de la oficina, ni el webhook de WhatsApp. En `app.js` va antes que todo eso a propósito.
- **`DOMINIO_GESTION`**: el del ERP. Si está puesta, quien abra el ERP por otra dirección (la de `onrender.com`) **se va a la suya** con un 302. Solo se redirige a quien navega con el navegador. El webhook de Meta (`/?hub.mode=…`, `POST /`), la comprobación de salud de Render y las API siguen entrando por donde entraban.

**Sin ninguna puesta, todo sigue como antes**: el ERP en cualquier dirección y el portal en ninguna. Para probarlo en local sin dominio, el navegador manda `conductores.localhost` a la propia máquina: `DOMINIO_CONDUCTORES=conductores.localhost` y se abre `http://conductores.localhost:PUERTO`.

Para ponerlo en marcha: los dos dominios en Render (Settings → Custom Domains), el DNS de cada uno apuntando a Render y las dos variables de entorno.

## Entrar: teléfono y DNI/NIE

- **Quién entra**: quien tiene ese **teléfono vigente** en su ficha, **contrato en vigor** (`empleo_vigente`) y ese **DNI/NIE**. El 09/10 eran **199 de los 216 en activo**; los otros 17 no tienen el documento en su ficha y no pueden entrar hasta que RRHH lo ponga.
- El teléfono se busca por sus **nueve últimas cifras** (`conductor_telefono.sufijo9`): da igual escribirlo con +34 o con espacios. Los teléfonos vigentes no se repiten entre activos.
- El documento se compara **sin mirar mayúsculas, espacios, puntos ni guiones** («x-1234567-l» vale por «X1234567L»), en tiempo constante.
- **El error es siempre el mismo** («El teléfono o el DNI/NIE no son correctos»): no dice si el teléfono existe.
- **Ocho fallos seguidos frenan quince minutos** ese teléfono y esa IP (`services/limiteIntentos`, el mismo freno que el login de la oficina).
- «Recordarme en este móvil» deja la sesión **30 días**; sin marcar, 12 horas.

> [!warning] Un DNI no es un secreto
> Está en el contrato, en la ficha de alta y en papeles que pasan por la oficina. Quien sepa el teléfono y el DNI de un compañero puede entrar como él. Por eso cada intento queda apuntado en `conductor_acceso` (db/189), bueno o malo, con su IP y su navegador: muchos fallos contra un mismo conductor, o entradas desde un sitio raro, se ven ahí. Del teléfono intentado solo se guardan las 4 últimas cifras, y solo cuando no es de nadie. Hoy el portal solo enseña lo suyo y no deja cambiar nada. **Antes de enseñar algo más sensible** (nóminas, documentos), conviene un segundo paso: un código por WhatsApp, o que cada uno ponga su contraseña la primera vez.

## La sesión, aparte de la de la oficina

- Otra cookie (`telecab_conductor`), firmada con **otra clave** derivada de `SESSION_SECRET`, y el token dice para qué es (`para: 'conductor'`). Una sesión de conductor **no vale en el ERP, ni al revés**, aunque algún día compartieran dominio. El comprobador lo prueba presentando la cookie del conductor como si fuera la de la oficina.
- **Se corta sola**: en cada petición se mira, con un minuto de caché, que siga con contrato. A quien se da de baja se le acaba el acceso aunque su cookie dure 30 días.
- Las cookies no llevan dominio, así que cada una vive solo en el suyo.

## Ver también

[[Conductores]] · [[Usuarios y permisos]] · [[Seguridad]] · [[WhatsApp]]
