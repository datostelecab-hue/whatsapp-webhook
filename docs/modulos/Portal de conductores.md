---
tags: [portal, conductores, acceso, turnos, calificacion]
aliases: [Portal, conductorestelecab.es, Ficha del conductor]
---

# Portal de conductores

Lo que cada conductor ve de sí mismo desde su móvil, en **conductorestelecab.es**. Lo autorizaron el 19/10/2026, con dominio propio. Camilo: *«la idea es que todavía no vean sus horas, solo turnos y la puntuación que llevan semana tras semana»*.

Vive en `modules/Portal/`. Se prueba en el [[Entorno de pruebas local]] antes de subirlo.

## Otro sitio, el mismo servidor

El portal **no es una sección del ERP**: tiene su propio dominio, sus cookies, su sesión, su hoja de estilos y sus pantallas. Lo sirve el mismo servidor de Render, que decide por el dominio de cada petición:

- `porDominio` va en `app.js` **antes que todo lo del ERP**, incluida su sesión. Si la petición es de un dominio del portal (`PORTAL_HOSTS`), se queda allí: con su página, su 404 o su error. **Nunca llega a una pantalla del ERP.** Sin haber entrado, cualquier dirección manda a `/entrar`.
- Por el dominio del ERP no se llega al portal: `/turnos` o `/entrar` piden el login del ERP.

`PORTAL_HOSTS` vale por omisión `conductorestelecab.es`, `www.conductorestelecab.es` y `conductorestelecab.localhost` (el del entorno local).

## El acceso, sin contraseñas

*«El login es con su DNI y el sistema le enviará un código de verificación al email que fue dado de alta.»*

1. **El DNI o NIE.** Se limpia (sin puntos, guiones ni espacios, en mayúsculas) y se busca entre quien tiene un contrato abierto o que empieza más adelante: el que entra el lunes ya quiere ver sus turnos.
2. **El código.** Seis cifras al email de su ficha, que caducan a los **10 minutos**, admiten **5 intentos** y sirven **una vez**. Pedir otro anula el anterior. En la base solo se guarda su huella (HMAC), nunca el código. La pantalla dice a qué correo fue, tapado (`da•••@telecab.es`, `ocultarEmail`), y debajo, desde el 26/10/2026 (Camilo): *«Si no reconoces este correo, comunícate con RRHH para confirmarlo»*. Así, quien tiene un email viejo o equivocado en su ficha se da cuenta de por qué no le llega.
3. **La sesión.** **No caduca** (desde el 20/11/2026, Camilo: *«que la sesión nunca expire, una vez que haya iniciado sesión, ya no se cierra a menos de que él apriete en salir»*; antes, 30 días desde la última vez que entraba). En la base dura cien años y se renueva con el uso; la cookie, como el navegador no la deja pasar de unos 400 días, se vuelve a poner en cada visita: mientras abra el portal una vez al año, no se le cierra nunca. En la cookie va un testigo aleatorio y en la base su huella (`portal_sesion`). Por eso se puede cerrar desde el servidor: al pulsar «Salir» y, sobre todo, al darle de baja, porque una sesión solo vale mientras la persona puede entrar.

Lo que **no** se dice: si un DNI está o no en la casa. A quien no se encuentra, a quien no tiene email y a quien no tiene contrato se le contesta lo mismo: *«No podemos mandarte el código con ese DNI. Habla con RRHH para que revisen tu DNI y tu email»*. Así el formulario no sirve para averiguar quién trabaja aquí.

**Los límites:** 3 códigos por persona y 10 por IP cada 15 minutos, y 30 búsquedas de DNI por IP y hora (estas, en memoria, porque un DNI que no existe no deja código).

El correo sale por el «Correo para procesos» de siempre ([[Correo]]). El asunto lleva el código, para que se vea en el aviso del móvil.

> [!warning] Sin email no hay acceso
> El 19/10/2026, de 216 conductores de alta, **51 no tenían email** (47 de la ETT) y **23 no tenían DNI**. Esos no pueden entrar hasta que RRHH los complete. Ver [[Estado y pendientes]].

## Lo que ve

**Inicio**: su próximo turno (cuándo, día o noche, el coche, de quién lo recibe y a quién se lo entrega, con el teléfono para llamar) y su última nota, con cuánto ha cambiado respecto a la semana anterior.

**El dinero del mes**, en la portada (19/10/2026). Camilo: *«una barra de progreso de la facturación que lleva, dependiendo si es 32 o 40 horas»*, y después: *«los de la ETT exclúyeles esta función ya que ellos no tienen tal cosa. Las propinas y peajes ponlas también, pero recuerda que es a mes vencido esto de los extras. Las propinas y peajes sí deben de poder verlos los de la ETT»*.

- **La barra**: su facturación neta del mes, del día 1 a hoy, contra **el umbral del MBO FAS de su jornada**. Es el mismo número que la nómina (`nominas.umbralFASDe`): **40 h → 4.750 €, 32 h → 3.750 €**, y las demás jornadas, el de 40 h, como en la nómina. Se cambia en la configuración de [[Nominas]] y el portal lo sigue solo. Debajo dice cuánto le falta, o cuánto lo ha pasado.
- **Propinas y peajes** del mes.
- **A mes vencido**: se dice que lo del mes se cobra en la nómina del mes siguiente. Y se enseña el mes pasado, que es lo que entra en la nómina de este mes.
- **La ETT no ve la barra**, porque el MBO es solo de plantilla propia, pero **sí sus propinas y peajes**.
- El dinero es el de la nómina: `v_ordenes_conductor` por **día natural** (`nominas.dineroDe`), no por jornada operativa.

**Efectivo** (19/10/2026): lo que tiene por entregar, en la portada, y una pestaña con todo su histórico desde junio, quincena a quincena. Cada quincena enseña lo que traía de antes, lo que cobró en efectivo según BOLT, cada entrega con su fecha y lo que le quedó. Arriba, lo cobrado, lo entregado y el cambio o las devoluciones que se le dieron, que con lo de antes suman el pendiente. Sale de la ficha de Recaudación tal cual (`recaudacion.extractoDe`), sin notas internas ni anulados; ver [[Administracion#Lo que ve el conductor en su portal (19/10/2026)]]. La ETT también lo ve: el efectivo es de todos.

**En dos columnas desde el 20/11/2026** (Camilo: *«un desglose más de ingresos y egresos: en una columna lo que ha recibido durante los meses y en otra las veces que ha venido a dejar dinero, algo más limpio y no tan complicado para ellos»*). Arriba, **Por entregar** en grande y la cuenta debajo (**Recibiste − Entregaste**; si traía algo de antes de junio, se dice). Debajo, dos columnas: **Recibiste**, una fila por mes con lo cobrado en efectivo en BOLT (con la corrección de la oficina, si la hubo) más el dinero que se le dio (cambio, devoluciones), y **Entregaste**, una fila por cada vez que dejó dinero (en mano, de su nómina, transferencia con su ID, gasto devuelto). Se quitó el desplegable por quincenas con «+» y «−». Lo agrupa `portal.service.efectivo` (`enDosColumnas`) sobre el mismo extracto: las cifras siguen siendo las de la ventanilla, al céntimo. Prueba: `test/portal-efectivo.test.js`.

**Turnos**: de hoy a 7 días, lo mismo que le contesta el bot a «Ver mis turnos». Sale de `cobertura.service.proximosDe`, que guarda un minuto la ventana de toda la flota, porque es la misma para todos. Si hay un evento en marcha, se avisa de que esos días los turnos son temporales. Cuando recibe el coche y se lo devuelve a la misma persona en relevo directo (las parejas fijas), se dice en una línea: *«Compartes el coche con…»*.

**Puntuación**: la nota de cada semana, que es la de [[Calificacion de conductores#La puntuación de cada semana, para el portal de conductores (19/10/2026, db/210)|la puntuación semanal sellada]]:

- la última, con sus tres partes **en puntos**: horas, utilización y velocidad, más los excesos que le cuentan (ya se le avisaron por WhatsApp);
- una barra por semana, desde septiembre;
- las anteriores, plegadas;
- y cómo se calcula.

**Ni horas ni porcentajes**: el promedio y la utilización se quedan en el ERP.

## Los códigos, a un solo buzón mientras se prueba (20/11/2026)

**Apagado el mismo 20/11/2026**, ya probado: *«Desactiva lo del correo para mí, que vaya al correo de la persona del DNI/NIE que pide el código»*. Cada código vuelve al email de su ficha, sin copia, y quien no tiene email no recibe código (como antes). Lo de abajo queda para volver a probar: se enciende con `PORTAL_CODIGOS_A` en Render.

Camilo: *«Por el momento, quema mi correo para que todos los códigos de inicio de sesión me lleguen a mí en datostelecab@gmail.com para probar en producción, me han dicho que por el momento ellos no van a usarlo hasta que lo tengamos listo al 100%»* y *«con copia a Ignacio por cada correo»*.

- **Todo código va a datostelecab@gmail.com**, sea de quien sea (también de quien no tiene email en su ficha), **con copia a Ignacio**. El asunto dice de qué ficha es: «[Portal en pruebas] Código de Juan Carlos Pérez (ficha 7): 123456». La pantalla enseña el buzón al que ha ido de verdad (da•••@gmail.com).
- La dirección de la copia **no está en el código** (el repositorio es público): va en la variable **`PORTAL_CODIGOS_CC`** de Render, con la que dio Camilo; sin ella, el email del usuario de Ignacio (el 1), leído al mandar cada código (`copiaDePruebas`). `services/correo.enviarCorreo` admite ahora `cc`.
- **Encenderlo**: `PORTAL_CODIGOS_A` con el buzón en Render (y `PORTAL_CODIGOS_CC` para la copia). Sin ella, cada código va al email de su ficha y sin copia. El comprobador (`scripts/comprobar-portal.js`) prueba el envío normal; `test/portal-codigos.test.js`, el de pruebas.

## El aspecto

**La V3 y siempre en claro** (20/11/2026, Camilo: *«aplica el rediseño, no quiero que lo vean oscuro»*). Los colores del tema claro de la V3 del ERP ([[Identidad visual]]): azul vivo sobre blanco y gris muy claro, estados saturados, esquinas de 12–16 px, el botón principal con la sombra de su color, lo elegido de la barra teñido, **Plus Jakarta Sans**. Ya **no sigue el modo oscuro del móvil** (antes lo decidía el teléfono, y quien lo tenía en oscuro lo veía negro): `color-scheme: light` y un solo `theme-color`. Sigue en una hoja propia y pequeña (`public/assets/css/portal.css`), **sin Tailwind**: se abre desde el móvil, a veces con poca cobertura. Las letras: A en el acento, B neutra, C en ámbar, D en rojo.

**El acceso, rediseñado** (20/11/2026, Camilo: *«haz mejor el login, qué soso»*): arriba, a sangre, la foto del Corolla de noche en Madrid (la del acceso del ERP, `public/assets/acceso/portada-900.webp`, 69 KB) con la marca en blanco y el titular «Tu Telecab, en el móvil»; encima del final de la foto, la tarjeta con los dos pasos (1 Tu DNI → 2 El código) y el formulario; debajo, lo que hay dentro (turnos, coche, efectivo y nota). Sin la cabecera de siempre (el armazón la quita cuando la página trae `paso`). Sin animación de entrada: con la página en segundo plano se quedaba invisible.

## Mi coche: vincular, puertas y desvincular (20/11/2026)

Camilo: *«Créales el módulo de vincular coche, ahí podrán abrir y cerrar coches, solo luego de vincularse, sino no. Es empezar a migrar el ciclo de motor sacándolo de WhatsApp y dejándolo en su app»*.

- **Pestaña «Coche»** (`/coche`, entre Inicio y Turnos). Sin coche: escribe la **matrícula** y «Vincular coche» (se desbloquea el motor). Con coche: la matrícula como una placa, desde cuándo, **Abrir puertas** / **Cerrar puertas** y **Desvincular vehículo** (bloquea el motor; pide confirmación).
- **Las puertas, solo con un coche vinculado**, y solo el suyo: sin coche vinculado no se manda ninguna orden.
- **No hay una segunda lógica del coche**: `modules/Portal/portal.coche.js` llama a las MISMAS funciones que el bot (`fichaje.iniciar`, `fichaje.estado`, `fichaje.terminar`, `puertasBot.ejecutar`) con el **teléfono vigente de su ficha** (`conductor_telefono`), que es como el bot sabe quién es. Así vincular aquí y desvincular por WhatsApp (o al revés) es el mismo coche, y las reglas del motor no se duplican: nunca cortar con el contacto puesto ni en marcha (no deja desvincular y lo dice), las órdenes de un coche en fila, el coche que pasa de manos (a quien lo tenía se le avisa por WhatsApp, `fichajeBot.avisarAlQueEntrega`), Mapon caído…
- Sin teléfono en la ficha, o sin el uso de coches, se le dice y no se toca nada. Palabras del bot desde el 13/11: «vincular», nunca «turno» ni «fichar».
- **Formularios normales** (sin JavaScript en el móvil): cada acción vuelve a la página del coche con lo que ha pasado arriba, en verde, ámbar o rojo.
- **Lo que aún se queda en WhatsApp**: «Entregar coche», «No tengo yo el coche», el código de lavado y los avisos (la pregunta de las 14 h, el coche que pasa de manos). Pruebas: `test/portal-coche.test.js`.

## Mi coche: ubicación en vivo y las cinco fotos (23/11/2026)

Camilo: *«en el apartado del coche que le toca, tiene que poner "Ver ubicación en vivo". Que le aparezca el estado tal cual, si está rodando, si está parado y bloqueado, si está fichado por alguien, etc. Pero que pueda ver dónde está»*. Y: *«cuando termine el turno, el sistema le pedirá 5 fotos (…) las fotos tendrán que ser obligatorias para cerrar el turno, ojo, es una transición, así que todavía se puede terminar el turno por WhatsApp sin pedir fotos, pero en la app tiene que ser obligatorio»*.

- **El coche que le toca**: el que tiene vinculado; si no, el de hoy en su planificación (`portal.coche.matriculaDeHoy`).
- **Ver ubicación en vivo**: el botón abre el mapa (MapLibre + OpenFreeMap, como el mapa de flota) y el estado, refrescados cada 15 s mientras está abierto (`GET /coche/vivo`). Sale de `modules/Mapa` (`frente`, caché de 5 s): rodando (con su velocidad) o parado, **parado y bloqueado** si el motor está cortado, **quién lo tiene vinculado** (solo el nombre de pila; nunca un teléfono), si está conectado a BOLT y en qué, y si el coche no está operativo. En el móvil el mapa se mueve con dos dedos (un dedo baja la página).
- **Las cinco fotos al desvincular**, obligatorias en el portal: **Lateral conductor, Frontal, Lateral copiloto, Parte trasera y Asientos pasajeros** (nombres de Camilo, 24/11/2026). Cada una con su **imagen de referencia** de cómo va la foto, en vez de un número: en la casilla, arriba en la cámara y en la tira de abajo (`public/assets/portal/guia/*.webp`; las cuatro del coche sobre el mismo fondo negro, recortadas de las fotos que pasó Camilo, con la matrícula de la trasera difuminada; la de los asientos, tal cual). Sin las cinco no se desvincula (y se dice cuáles faltan). En el móvil se aligeran antes de subir (1600 px, JPEG); como mucho 20 MB cada una. Se guardan en **R2** como adjuntos del turno (`turno_fotos`, dueño = la fila de `fichaje_turno`), **después** de desvincular: si R2 falla, el coche ya está desvinculado y se dice («avisa a Tráfico»).
- **El pack** (23/11/2026, Camilo: *«un solo botón para subir 5 fotos, sin tener que salir una por una (…) como un "pack"»*): **«Hacer las 5 fotos»** abre la cámara de la app a pantalla completa (`getUserMedia`, la trasera) y guía las cinco seguidas («1 de 5 · Lateral de tu puerta»…); cada foto va a su casilla, se ve en la tira de abajo y se repite tocándola; con las cinco, «Listo». Ya salen ligeras (1600 px, JPEG). Sin cámara desde el navegador o sin permiso, se dice y quedan las cinco casillas de siempre (que también abren la cámara del móvil, una a una).
- **Cómo dejaron el coche**: las fotos del último turno cerrado de ese coche, para quien lo tiene hoy (`GET /coche/foto/:id`, solo si la foto es de su coche de hoy). Si ese turno se cerró por WhatsApp (que aún no pide fotos), *«Próximamente aquí estarán las fotos con las que se dejó el coche»*.
- **WhatsApp sigue igual**: «Desvincular vehículo» del bot no pide fotos, a propósito (transición).
- Pruebas: `test/portal-fotos.test.js`.

## El inicio, un resumen que lleva a cada sitio (23-24/11/2026)

Camilo: *«que el inicio sea un resumen de lo que hay, al darle tap o click a la pantalla sí lo lleve allí, con iconos de referencia modernos y buenos»*.

- **Cada tarjeta entera lleva a su sección**: el título es un enlace estirado sobre la tarjeta (`::after`); los teléfonos de dentro siguen pulsables (con más zona de toque). Pieza `vistas/portalTarjeta.ejs` (abre el `<section>`; quien la usa pone el contenido y lo cierra: cada `</section>` lleva la nota «cierra portalTarjeta»).
- **Iconos en una sola pieza**: `vistas/portalIcono.ejs`, que usan la barra de abajo y las tarjetas (en una pastilla teñida del acento).
- **«Tu coche»** (`vistas/portalInicioCoche.ejs`): **la primera** si tiene un coche vinculado (es lo que va a usar), y después del próximo turno si no. Si pulsó «Entregar coche», lo dice en ámbar («sigue a tu nombre hasta que tu compañero lo vincule»). Sale de `portal.coche.estado`; si falla, el inicio sale sin ella.
- **«Vinculado desde»**, igual en el inicio y en Coche (24/11/2026): de hoy, «desde las 06:02»; de otro día, «desde el 22/11 a las 23:40» (`portal.coche.momento`).
- **El toque en iPhone**: `public/assets/js/portal/toque.js`, un escuchador de toques vacío para que Safari aplique `:active` (la tarjeta se hunde un poco al pulsarla).
- La de la facturación no lleva a ningún sitio (no hay página): lleva icono, pero no pulsa.
- Revisado por un agente el 23/11 y aplicado lo suyo. Probado en local a 320 × 568, 375 y 390 px: sin desbordes ni errores. Prueba: `test/portal-inicio.test.js`.

## El conductor de pruebas (24/11/2026, db/280)

Camilo: *«Crea un usuario de prueba que se pueda abrir siempre en producción simulando ser un conductor, que tenga datos sacados de un conductor al azar para que sea más realista, pero que sí pueda asignarse a un coche, abrir puertas, cerrar, desbloquear el vehículo, etc, esa la usaré yo para pruebas, hasta para las fotos»*.

- **db/280** crea una ficha con el **nombre y apellidos de un conductor al azar** de plantilla propia, con «(PRUEBAS)» detrás (así se reconoce en Plantilla, en el mapa y en Mapon, que pone su nombre en el coche), un **contrato abierto** desde el día que se aplica (propia, 40 h) y el **bloqueo de motor encendido**, y le copia las **notas semanales** de ese conductor. Nada más de él. Sale como una ficha más (lo eligió Camilo): en Plantilla, nómina y vacaciones.
- **El teléfono, el email y el documento NO van en la migración** (el repositorio es público). Los pone Camilo en Plantilla, en la ficha «… (PRUEBAS)»: su teléfono (con él se vincula el coche y le llegan los avisos de WhatsApp), el email al que llega el código y, como «número de documento», **ese mismo teléfono**: es lo que escribe para entrar al portal (el portal acepta de 5 a 20 letras o cifras).
- Con eso hace lo de un conductor de verdad, en coches de verdad: vincular (suelta el motor), abrir y cerrar, desvincular con las cinco fotos (corta el motor).

## Lo que queda para lanzarlo (24/11/2026)

- **El dominio ya funciona**: https://conductorestelecab.es abre «Entrar».
- **52 conductores en activo no pueden entrar**: les falta el email o el DNI (49 son de ETT; 3 de plantilla propia). Es trabajo de RRHH: sin email no les llega el código.
- **Mirarlo en un iPhone de verdad** (el toque de las tarjetas) antes de anunciarlo.
- **El vídeo explicativo** para los conductores: al final, cuando se lance (Camilo, 23/11). Con voz generada y montaje en local, como los vídeos anteriores.
- **Aún se queda en WhatsApp** (a propósito, en transición): «Entregar coche», «No tengo yo el coche», el código de lavado y los avisos (la pregunta de las 14 h, el coche que pasa de manos).

## Para subirlo a producción

1. Desplegar y aplicar **db/210** (la puntuación semanal) y **db/211** (el acceso) desde `/migraciones`.
2. En Render, en el servicio de producción **whatsapp-webhook** (`whatsapp-webhook-g7wa.onrender.com`; el de pruebas está suspendido y no se usa), *Settings → Custom Domains*: añadir `erptelecab.es` y `conductorestelecab.es`. Render añade solo el `www` de cada uno y lo manda a la raíz.
3. DNS, hecho el 26/10/2026 en el panel de DonDominio (manage.panel247.com → el dominio → Zona DNS), en los dos dominios: la raíz es un **ANAME → whatsapp-webhook-g7wa.onrender.com** (el panel no deja cambiar el tipo, y Render acepta ANAME; resuelve a 216.24.57.16 y .18, sin IPv6) y `www` **CNAME → whatsapp-webhook-g7wa.onrender.com**. Antes los dos iban a parkingsrv0.dondominio.com. El resto de registros (correo, ftp, el comodín `*` al aparcamiento) no se tocó, y el Parking sigue habilitado: ya no recibe nada de la raíz ni del `www`.
4. Cuando https://erptelecab.es ya abra con candado: `DOMINIO_ERP=erptelecab.es` en Render. Desde ahí, quien abra la dirección de Render en el navegador acaba en erptelecab.es con la misma ruta (`services/dominioErp.js`). **El webhook de Meta no cambia**: los mensajes del bot (POST /), la verificación (GET /?hub.mode=…) y los vídeos que Meta baja de /assets se siguen contestando en la dirección de Render; solo se redirige un GET o HEAD que pide una página. Redirección temporal (302): quitando la variable se deshace al momento. La sesión de cada uno es de su dirección, así que la primera vez en erptelecab.es hay que volver a entrar.
5. Drive: si `GOOGLE_OAUTH_REDIRECT` está puesta en Render, sigue funcionando igual. Si no, la vuelta se deduce de la dirección y hay que dar de alta `https://erptelecab.es/documentos/auth/callback` en Google Cloud antes de reconectar.
6. Opcional: `PORTAL_SECRETO` en Render. Sin ella, las huellas de los códigos usan `SESSION_SECRET`.

## Tablas

- `portal_codigo` (db/211): cada código mandado, con su huella, el email al que fue, la caducidad, los intentos y la IP.
- `portal_sesion` (db/211): cada sesión, con la huella del testigo, el último uso, la caducidad y el navegador.
- `conductor_puntuacion_semana` (db/210): la nota de cada semana. Ver [[Calificacion de conductores]].

Comprobador: `scripts/comprobar-portal.js`.
