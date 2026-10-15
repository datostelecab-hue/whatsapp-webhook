---
tags: [modulo, cumpleanos, control, usuarios, conductores]
aliases: [Cumpleaños, Tarjetas de cumpleaños]
---

# Cumpleaños

Las tarjetas de cumpleaños que salen en las pantallas de **todo el mundo** (15/10/2026). Camilo: *«En el perfil de TODOS (sin excepción) saldrán tarjetas de notificación de los conductores que están cumpliendo años ese día; en Control debe de aparecer su tarjeta como azul, si tiene alertas pues parpadeará azul igualmente. La noti será una ventanita emergente que saldrá automáticamente en la pantalla de todos los usuarios, no se podrá cerrar hasta que manualmente le dé click en la x; si son varias, una sobre otra; que diga si es conductor o si es de oficina… al que sea el cumpleañero el sistema lo felicitará a nombre de Telecab»*.

| Pieza | Dónde |
|---|---|
| Quién cumple hoy | `modules/Cumpleanos/cumpleanos.service.js` (`hoy`, `idsConductoresHoy`, `delDia`) y su repositorio |
| La ruta | `GET /cumpleanos/api/hoy`: libre para cualquiera de dentro (no está en el catálogo de permisos) |
| Las tarjetas | `public/assets/js/cumpleanos.js`, que carga `layout-gestion.ejs` en todas las pantallas de dentro |
| Control | `cockpit.service` marca `cumple` en las filas, y `controlDirecto.ejs` las pinta |
| La fecha de la oficina | `usuario.fecha_nacimiento` (db/204), que cada uno pone en Configuración. Ver [[Usuarios y permisos#La fecha de nacimiento (15/10/2026, db/204)]] |
| Comprobador | `scripts/comprobar-cumpleanos.js` (6 casos) |

## Quién sale

- **Conductores**: los que tienen el contrato abierto, de plantilla propia o de ETT. Su fecha de nacimiento ya estaba en la ficha. El nombre es el de BOLT, como en todo el ERP.
- **Oficina**: los usuarios activos que han puesto su fecha.
- «Hoy» es el **día de calendario en Madrid**, no la jornada operativa: un cumpleaños empieza a medianoche. Se compara solo el día y el mes. **Los del 29 de febrero**, en un año que no es bisiesto, lo celebran el 28.
- Lo que devuelve se guarda **cinco minutos**, porque lo piden todas las pantallas de todo el mundo al cargar. Quien guarda su fecha en Configuración tira esa caché, para verse ya.

## Las tarjetas

Un **mazo** abajo a la derecha (en el móvil, de lado a lado): la de arriba se lee entera y las demás asoman detrás, con «1 de 3». **Solo se cierran con la X**: no hay clic fuera ni tiempo que las cierre. Cerrada una, sale la siguiente. Lo cerrado se apunta en el navegador, por persona y día, para no volver a salir en cada pantalla. Si el navegador no deja apuntar, vuelven a salir, que es lo seguro.

Hay tres tarjetas distintas:

- **Conductor**, con el filo azul: «Cumpleaños de un conductor», el nombre (con «ETT» si lo es) y *«Si hablas hoy con Jaime, felicítale de parte de Telecab»*.
- **Oficina**, con el filo oro: «Cumpleaños en la oficina», el nombre y el rol.
- **La propia**: a quien cumple no le sale «Fulano cumple hoy», le sale *«¡Feliz cumpleaños, Camilo! Todo el equipo te desea un día estupendo»*, con el logo y la firma «De parte de Telecab». Va la primera del mazo.

Ninguna dice el año ni la edad.

## En Control

En **En directo**, la fila de quien cumple hoy va en azul, con la chapa «Cumple hoy» al lado del nombre. Si tiene una alerta sin atender, **late en azul en vez de en rojo**; con una alerta ya atendida se queda en azul quieto. Vale también para los NN. Solo en el directo de hoy: el histórico no marca cumpleaños.

## Lo que no hace (todavía)

**Felicitar al conductor por WhatsApp.** La plantilla `cumpleanos_conductor` (marketing) está preparada para mandarla a revisión: ver [[PLANTILLAS-WHATSAPP#La que falta — LA FELICITACIÓN DE CUMPLEAÑOS (15/10/2026)]]. El código se hace cuando Meta la apruebe.

## Ver también

- [[Usuarios y permisos]] · [[Control]] · [[Componentes de la casa]]
