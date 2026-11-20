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
3. **La sesión.** **30 días desde la última vez que entra.** En la cookie va un testigo aleatorio y en la base su huella (`portal_sesion`). Por eso se puede cerrar desde el servidor: al pulsar «Salir» y, sobre todo, al darle de baja, porque una sesión solo vale mientras la persona puede entrar.

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

Camilo: *«Por el momento, quema mi correo para que todos los códigos de inicio de sesión me lleguen a mí en datostelecab@gmail.com para probar en producción, me han dicho que por el momento ellos no van a usarlo hasta que lo tengamos listo al 100%»* y *«con copia a Ignacio por cada correo»*.

- **Todo código va a datostelecab@gmail.com**, sea de quien sea (también de quien no tiene email en su ficha), **con copia a Ignacio**. El asunto dice de qué ficha es: «[Portal en pruebas] Código de Juan Carlos Pérez (ficha 7): 123456». La pantalla enseña el buzón al que ha ido de verdad (da•••@gmail.com).
- El email de Ignacio **no está en el código**: se lee de su usuario (el 1) al mandar cada código (`copiaDePruebas`). `services/correo.enviarCorreo` admite ahora `cc`.
- **Para abrírselo a los conductores**: poner `PORTAL_CODIGOS_A` vacía en Render (o quitar `CODIGOS_A` de `portal.service.js`); entonces cada código vuelve al email de su ficha y sin copia. El comprobador (`scripts/comprobar-portal.js`) prueba el envío normal; `test/portal-codigos.test.js`, el de pruebas.

## El aspecto

**La V3 y siempre en claro** (20/11/2026, Camilo: *«aplica el rediseño, no quiero que lo vean oscuro»*). Los colores del tema claro de la V3 del ERP ([[Identidad visual]]): azul vivo sobre blanco y gris muy claro, estados saturados, esquinas de 12–16 px, el botón principal con la sombra de su color, lo elegido de la barra teñido, **Plus Jakarta Sans**. Ya **no sigue el modo oscuro del móvil** (antes lo decidía el teléfono, y quien lo tenía en oscuro lo veía negro): `color-scheme: light` y un solo `theme-color`. Sigue en una hoja propia y pequeña (`public/assets/css/portal.css`), **sin Tailwind**: se abre desde el móvil, a veces con poca cobertura. Las letras: A en el acento, B neutra, C en ámbar, D en rojo.

## Mi coche: vincular, puertas y desvincular (20/11/2026)

Camilo: *«Créales el módulo de vincular coche, ahí podrán abrir y cerrar coches, solo luego de vincularse, sino no. Es empezar a migrar el ciclo de motor sacándolo de WhatsApp y dejándolo en su app»*.

- **Pestaña «Coche»** (`/coche`, entre Inicio y Turnos). Sin coche: escribe la **matrícula** y «Vincular coche» (se desbloquea el motor). Con coche: la matrícula como una placa, desde cuándo, **Abrir puertas** / **Cerrar puertas** y **Desvincular vehículo** (bloquea el motor; pide confirmación).
- **Las puertas, solo con un coche vinculado**, y solo el suyo: sin coche vinculado no se manda ninguna orden.
- **No hay una segunda lógica del coche**: `modules/Portal/portal.coche.js` llama a las MISMAS funciones que el bot (`fichaje.iniciar`, `fichaje.estado`, `fichaje.terminar`, `puertasBot.ejecutar`) con el **teléfono vigente de su ficha** (`conductor_telefono`), que es como el bot sabe quién es. Así vincular aquí y desvincular por WhatsApp (o al revés) es el mismo coche, y las reglas del motor no se duplican: nunca cortar con el contacto puesto ni en marcha (no deja desvincular y lo dice), las órdenes de un coche en fila, el coche que pasa de manos (a quien lo tenía se le avisa por WhatsApp, `fichajeBot.avisarAlQueEntrega`), Mapon caído…
- Sin teléfono en la ficha, o sin el uso de coches, se le dice y no se toca nada. Palabras del bot desde el 13/11: «vincular», nunca «turno» ni «fichar».
- **Formularios normales** (sin JavaScript en el móvil): cada acción vuelve a la página del coche con lo que ha pasado arriba, en verde, ámbar o rojo.
- **Lo que aún se queda en WhatsApp**: «Entregar coche», «No tengo yo el coche», el código de lavado y los avisos (la pregunta de las 14 h, el coche que pasa de manos). Pruebas: `test/portal-coche.test.js`.

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
