---
tags: [modulo, cumpleanos, control, usuarios, conductores]
aliases: [Cumpleaños, Tarjetas de cumpleaños]
---

# Cumpleaños

Las tarjetas de cumpleaños que salen en las pantallas de **todo el mundo** (15/10/2026). Camilo: *«En el perfil de TODOS (sin excepción) saldrán tarjetas de notificación de los conductores que están cumpliendo años ese día; en Control debe de aparecer su tarjeta como azul, si tiene alertas pues parpadeará azul igualmente. La noti será una ventanita emergente que saldrá automáticamente en la pantalla de todos los usuarios, no se podrá cerrar hasta que manualmente le dé click en la x; si son varias, una sobre otra; que diga si es conductor o si es de oficina… al que sea el cumpleañero el sistema lo felicitará a nombre de Telecab»*.

| Pieza | Dónde |
|---|---|
| Quién cumple hoy | `modules/Cumpleanos/cumpleanos.service.js` (`hoy`, `idsConductoresHoy`, `delDia`) y su repositorio |
| Las rutas | `GET /cumpleanos/api/hoy`, `POST /api/felicitar`, `GET /api/mias` y `POST /api/vistas`: libres para cualquiera de dentro (no están en el catálogo de permisos) |
| Las tarjetas | `public/assets/js/cumpleanos.js`, que carga `layout-gestion.ejs` en todas las pantallas de dentro |
| Control | `cockpit.service` marca `cumple` en las filas, y `controlDirecto.ejs` las pinta |
| La fecha de la oficina | `usuario.fecha_nacimiento` (db/204), que cada uno pone en Configuración. Ver [[Usuarios y permisos#La fecha de nacimiento (15/10/2026, db/204)]] |
| Las felicitaciones | la tabla `felicitacion` (db/205): quién felicita, a quién, por qué cumpleaños y cuándo lo vio |
| Comprobador | `scripts/comprobar-cumpleanos.js` (12 casos) |

## Quién sale

- **Conductores**: los que tienen el contrato abierto, de plantilla propia o de ETT. Su fecha de nacimiento ya estaba en la ficha. El nombre es el de BOLT, como en todo el ERP.
- **Oficina**: los usuarios activos que han puesto su fecha.
- «Hoy» es el **día de calendario en Madrid**, no la jornada operativa: un cumpleaños empieza a medianoche. Se compara solo el día y el mes. **Los del 29 de febrero**, en un año que no es bisiesto, lo celebran el 28.
- Lo que devuelve se guarda **cinco minutos**, porque lo piden todas las pantallas de todo el mundo al cargar. Quien guarda su fecha en Configuración tira esa caché, para verse ya.

## Las tarjetas

Un **mazo** abajo a la derecha (en el móvil, de lado a lado): la de arriba se lee entera y las demás asoman detrás, con «1 de 3». **Solo se cierran con la X**: no hay clic fuera ni tiempo que las cierre. Cerrada una, sale la siguiente. Lo cerrado se apunta en el navegador, por persona y día, para no volver a salir en cada pantalla. Si el navegador no deja apuntar, vuelven a salir, que es lo seguro.

La clave de lo cerrado lleva versión (`telecab:cumple:v2:…`). El 15/10 se subió a `v2` para que las tarjetas de ese día **volvieran a salir a todos**: las habíamos cerrado antes de que existiera el botón de felicitar. Subirla otra vez es la forma de repetirlo.

Hay cuatro tarjetas distintas:

- **Conductor**, con el filo azul: «Cumpleaños de un conductor», el nombre (con «ETT» si lo es) y *«Si hablas hoy con Jaime, felicítale de parte de Telecab»*.
- **Oficina**, con el filo oro: «Cumpleaños en la oficina», el nombre, el rol y el botón **«Felicitar a Karen»** (ver abajo).
- **La propia**: a quien cumple no le sale «Fulano cumple hoy», le sale *«¡Feliz cumpleaños, Camilo! Todo el equipo te desea un día estupendo»*, con el logo y la firma «De parte de Telecab». Va la primera del mazo.

- **Las felicitaciones recibidas**, encima de todas: *«Camilo Bedoya te ha enviado felicitaciones»*, o *«Laura, Camilo e Ignacio te han enviado…»* (con «y 3 más» a partir de cuatro).

Ninguna dice el año ni la edad.

## Felicitar a un compañero (15/10/2026, db/205)

Camilo: *«Cuando sea de oficina, poder mandar felicitaciones tipo "Camilo te ha enviado felicitaciones" y que salgan globos o algo de parte de Camilo en la pantalla de la persona. Hoy cumple por ejemplo Karen, quizá mañana lo vea»*. La idea fue de una compañera.

- **Quién**: cualquiera de dentro, a alguien de **oficina** que cumple **hoy**. No a uno mismo, ni a un conductor (los conductores no entran al ERP; para ellos está el WhatsApp de más abajo). Pulsar dos veces no manda dos: hay una por persona y cumpleaños, y la base lo impide aunque se salte la pantalla.
- **El botón** pasa a «Felicitación enviada» y el texto, a *«Ya has felicitado a Karen: le saldrán globos de tu parte en su pantalla»*. Al volver a entrar sigue así.
- **Se guarda en la base, no en el navegador**, porque quien cumple puede no entrar hasta mañana, y desde otro ordenador. Le salen las que no ha visto de la **última semana**.
- **Lo que ve quien cumple**: la tarjeta con los nombres y **globos** que suben por toda la pantalla, uno por compañero con su nombre de pila colgando y unos cuantos más sin nombre, en los tonos del tema (oro y azul). Duran unos diez segundos, no se pueden tocar y no tapan nada (se puede seguir trabajando). Si la página está con la marca de «Cargando», esperan a que se quite.
- Los globos salen **una vez por felicitación** en ese navegador; la tarjeta trae «Ver los globos otra vez». Con «reducir movimiento» del sistema, ni globos ni ese botón: solo la tarjeta.
- **Sin recargar**: el día que cumple, su pantalla pregunta cada minuto (y al volver a la pestaña) si le ha llegado alguna. Si llega, sale encima del mazo con su globo.
- **Al cerrar** esa tarjeta, quedan **vistas en la base** y no vuelven a salir en ningún ordenador. Va por `sendBeacon`, que no pasa por el `fetch` del layout: cerrar no saca la marca de «Cargando».
- **Sin aplicar `db/205`**: no se rompe nada; no hay felicitaciones, y el botón contesta *«Todavía no se puede felicitar: falta aplicar la migración db/205»*.

## En Control

En **En directo**, la fila de quien cumple hoy va en azul, con la chapa «Cumple hoy» al lado del nombre. Si tiene una alerta sin atender, **late en azul en vez de en rojo**; con una alerta ya atendida se queda en azul quieto. Vale también para los NN. Solo en el directo de hoy: el histórico no marca cumpleaños.

## Lo que no hace (todavía)

**Felicitar al conductor por WhatsApp.** La plantilla `cumpleanos_conductor` (marketing) está preparada para mandarla a revisión: ver [[PLANTILLAS-WHATSAPP#La que falta — LA FELICITACIÓN DE CUMPLEAÑOS (15/10/2026)]]. El código se hace cuando Meta la apruebe.

## Ver también

- [[Usuarios y permisos]] · [[Control]] · [[Componentes de la casa]]
