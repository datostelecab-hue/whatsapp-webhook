---
tags: [estado, pendientes]
actualizado: 2026-10-05
---

# Estado y pendientes

Lo que está abierto **hoy**. Esta nota se actualiza; si algo de aquí ya está hecho, se borra de aquí y se cuenta donde toque.

## Decisiones que esperan a Ricardo

- **Los ocho avisos de km mal mandados.** Salieron con números inflados por el fallo del corte de tramos ([[Corte de tramos]]). Afectan a Alvaro Apezteguia (×3), Macilon Dos Santos (×2), Edison Roman Vera y David A. Ibarra (×2). Falta decidir si se marcan como anulados en el libro o se dejan con una nota.
- **La fuente de km de la alerta de WhatsApp.** La alerta sigue midiendo con el GPS mientras las pantallas ya miden con el odómetro ([[Km por odometro CAN]]), así que puede quedarse un 4 % por debajo de lo que enseña Control. Pasarla al odómetro es un cambio pequeño, pero **sube cuántas veces salta**, y el umbral está calibrado sobre cifras de GPS. Es una decisión de negocio, no técnica.
- **Recaudación y cuentas fantasma.** Si alguien cobró en efectivo con una cuenta prestada, la deuda sigue colgada de la cuenta, no de la persona. Es dinero: lo decide Ricardo.
- **15,5 h fuera de las ventanas de cuenta fantasma de William**, sobre todo el 11/09 (6,8 h) y el 14/09 (6,5 h) en la cuenta de Óscar Javier Alvarez. Caen en el hueco entre sus dos enlaces.


## Mapon suspendido por un pago (05/10/2026)

- **Mapon contesta «Company suspended» desde el 05/10 a las 11:06.** Hay que pagarlo. Mientras tanto, desplegado esto, el bot ficha solo en la base y deshabilita puertas y motor ([[Fichaje]], «Con Mapon caído»). No hace falta tocar nada al volver: se levanta solo con la primera respuesta buena.
- **Los turnos abiertos sin Mapon** se quedan sin conductor en Mapon y sin km. Si se quieren los km de esos turnos, hay que pedirlos a Mapon a mano cuando vuelva.

## WhatsApp: los mensajes que Meta no entrega (05/10/2026)

- **Desplegar y aplicar `db/176`** desde /migraciones: la tabla `whatsapp_envio`. Con el despliegue, el webhook ya pasa a `error` los avisos de velocidad que Meta no entregue, aunque la 176 aún no esté. La tabla solo hace falta para apuntar todos los estados.
- **Falta corregir los avisos del bloqueo**, del 02/10 por la tarde al 05/10 a mediodía: hasta 15 avisos de velocidad que quedaron como `avisado` sin haber llegado. Hace falta saber desde cuándo: buscar en los registros de Render la **primera** aparición de `131042`. Con esa hora sale una migración que los pasa a `error`.

## La letra los primeros días del mes (05/10/2026)

- **Desplegar y aplicar `db/175`** desde /migraciones. Mientras el mes en curso no llega a 5 días, la vista da la letra del mes cerrado ([[Calificacion de conductores]]). Hasta aplicarla, todo sigue en N/E, como antes. Este mes deja de hacer falta el **06/10 a las 05:40**, cuando octubre llega a 5 días; pero vale para todos los meses siguientes.

## Barcelona: coches y cuentas de BOLT (02/10/2026)

- **`db/173` y `db/174` aplicadas** (02/10, 20:00 y 20:14). Los coches de Barcelona están bien en Vehículos: 18, en estado «B». El 3814KYG es de Madrid.
- **Las 28 cuentas de BOLT de Barcelona entraron** con la pasada del padrón de las 20:28, lanzada a mano con el visto bueno de Camilo. Sin cambios en Madrid y sin pantallas tocadas ([[Sedes]]).
- **El bot ya reconoce a los 22 conductores activos de Barcelona** (comprobado número a número). Falta avisarles de que escriban desde el número que tienen en BOLT ([[Fichaje]], «Los conductores de Barcelona en el bot»).
- **Cinco coches para decidir a mano**: 1685KTC, 9549LTP, 6287LBG, 3035LTX y 8512LDS (el porqué de cada uno, en [[Vehiculos]]). Mientras tanto, el 3035LTX y el 8512LDS son de Barcelona en Vehículos, así que los llevan los conductores de Barcelona.

## Organización del código (01/10/2026)

- **Hechas las tandas 1 y 2** (arreglos y cierre de la Fase 2) **y el traspaso Selección → Conductores**: ya no queda ningún puente y `comprobar-capas` da 0 incumplimientos. Ver [[ARQUITECTURA]].
- **Desplegar**: el traspaso no lleva migración. Lo que cambia es por dónde entra el código (alta, candidatura, incorporaciones); la traza de 42 casos contra el código de antes salió idéntica.
- **Hecha la tanda 3**: el motor de notificaciones (Hito 6) arreglado y sin enchufar a propósito ([[RRHH]]), los scripts de un solo uso en `scripts/archivo/` y `inventario-exports` en cero.
- **Desplegar**: `services/sheets.js` pide ahora a Google el permiso de **solo lectura**. Tras desplegar, comprobar que la ticketera de RRHH sigue leyendo el formulario (es la única que lee hojas a diario).
- Queda, de prioridad baja: 103 funciones «vivas pero exportadas de más» (se usan dentro de su fichero; quitarlas del `module.exports` solo estrecha la puerta) y los 10 avisos de `comprobar-sql`, que son del comprobador (alias `h` de una subconsulta) o de la migración 44, ya aplicada.

## «No saldrá» y «Traza por Slack» en Control (01/10/2026)

- **Desplegar y aplicar `db/171`** desde /migraciones: la traza por Slack con varios canales. Hasta aplicarla se siguen viendo las trazas que hay, pero marcar una nueva da error. (`db/170` ya está aplicada: 01/10 a las 12:45.)
- **Mirar si `Dialogo.formulario` guardó vacíos entre el 17/09 y el 01/10**: una lista con valor inicial devolvía `''` si nadie la tocaba (ver [[Trampas conocidas]]). Sobre todo los formularios de Plantilla (situación, tipo de contrato, jornada) y el de salidas de Recaudación.

## Calificación 2.1 y los excesos de Edison (01/10/2026)

- **Desplegar y aplicar `db/169`** desde /migraciones: le quita a Edison Roman Vera Farfan los cinco excesos dudosos del 3784LFV del 11/09 (no eran suyos). La letra no espera a la migración: con el despliegue, la siguiente pasada del cron (05:40 o 12:00) rehace septiembre con el modelo 2.1 y suben 12 letras, la suya de C a A.
- **WhatsApp estuvo bloqueado por un pago** (01/10, y otra vez hasta el 05/10 a mediodía, cuando Camilo pagó). Meta aceptaba los mensajes y los daba por fallidos después (error 131042). Ahora el ERP se entera ([[WhatsApp]], «Aceptado no es entregado»).

## El bot del conductor, nuevo (28/09/2026)

- **El 16/10/2026 el botón de lavado desaparece solo** (`LAVADO_HASTA`). Queda quitar el código: `services/lavadoBallenoil.js`, sus dos llamadas en `fichajeBot.js` y `botPuertas.js`, y la migración ya aplicada se queda.
- **Primeros días: mirar el libro** (`fichaje_turno`) — cuántos turnos se cierran como «relevado (no pulsó Entregar coche)» y cuántos se auto-cierran a las 14 h. Si son muchos, hay que insistir con el botón en la comunicación a los conductores. Desde el 29/09 el que escribe la matrícula se queda el coche aunque no le toque: las notas «no tenía ese coche en el cuadrante de hoy» son las que hay que mirar.
- **Se quedó para todos (29/09):** abrir turno con la matrícula es de todo conductor de alta, como se desplegó el 28/09 (Camilo lo confirmó después de preguntar por qué lo tenían todos). El 29/09 por la mañana habían abierto turno 30 personas, y en Mapon queda creada la ficha de conductor de cada uno.

## El ciclo de bloqueo de motor (30/09/2026)

- **Desplegado y con `db/167` aplicada** (30/09, 12:37). El módulo ([[Ciclo de bloqueo de motor]]) lo ven William, Cristopher, Karen, Lorenzo y Angel (los que editan el planificador), además del desarrollador. Esa noche los dos turnos que se cerraron solos a las 14 h (0400MMZ y 9523MMX) llevan ya la nota «el motor no se toca», y desde el 29/09 a las 18:00 no ha salido **ninguna** orden de motor.
- **Hoy nadie tiene el bloqueo encendido.** A Deisy se lo apagó Camilo el 29/09 a las 10:39 y a Lionar William el 28/09 a las 21:22. Para que el ciclo empiece basta con volver a encenderlo persona a persona en el planificador (botón «Bloqueo de motor»): `FICHAJE_BLOQUEO_MOTOR=1` ya está en Render (el turno del 5775KKL del 28/09 dejó la nota «Motor NO bloqueado: sin relé de corte», que solo se escribe con el interruptor puesto).
- **Decisión abierta: los viajes de empresa.** Con el interruptor puesto, un viaje (usuario del ERP con el fichaje encendido) bloquea el coche **siempre** al terminar, sin mirar a nadie. Hay 14 usuarios con viajes encendidos; en la última semana solo hubo uno, la prueba de Camilo con el 1888LTJ. Camilo dijo «los únicos que bloquearán son los conductores»: falta que diga si los viajes dejan de bloquear.
- **El 1888LTJ** (Barcelona): con el despliegue ya no lo toca nada; su última orden es la de William soltándolo el 28/09 a las 13:16.

## «No vuelve a la M-30» (30/09/2026)

- **Sonando desde el 30/09 a las 12:38**, cuando se aplicó `db/166`. Hasta las 17:01 salieron **30 avisos** (22 coches, 22 conductores): unos 7 por hora. Si a los controladores les parecen muchos, el umbral (15 min) se cambia o el aviso se apaga en /alertas.

## Para mañana (21/09/2026)

- **El ticket RH-20260918-10618 de Soufyane El Hadri sigue pendiente**, a propósito. Aplicarlo ya funciona (probado de punta a punta con ese mismo ticket, y deshecho sin dejar rastro), pero **una baja médica la cuentan la bitácora y la nómina**: la aplica Ricardo cuando quiera y con las fechas que quiera. Basta con darle a **Aplicar**.
- **Cristian Jiménez García (id 407) se borró entero de la base** el 21/09, a petición de Ricardo: nunca trabajó y no llegó a estar en BOLT. Se fueron sus 4 días de cuadrante, sus 2 asignaciones (plazas 45 y 471, que quedan libres) y su ficha; en cascada cayeron su empleo, su turno, su teléfono, sus 5 calificaciones, su rendimiento, sus 3 llamadas y **su candidatura ETT de la solicitud 5**, que baja de 4 candidatos a 3. Hay copia de las 20 filas en `Documentos/Claude/Scripts de análisis/copia-conductor-407-cristian-jimenez.json` por si hay que devolver algo.

## El piloto del mapa (21/09/2026)

- **Hay que poner `MAPA_CRON=on` en Render** para que [[Mapa de flota]] refresque cada 30 segundos. Sin esa variable la pantalla funciona igual, pero enseña la última posición que se guardara, no la de ahora. Es lo primero que hay que encender para probarlo, y lo primero que hay que apagar si molesta.
- **El aviso del coche suelto sale en cuanto se encienda `MAPA_CRON=on`**, porque las alertas están en modo `live` y hay 2 destinatarios. Con los datos del 21/09 serían 5 coches x 2 personas = 10 WhatsApps en la primera vuelta, y después como mucho dos por coche y día. Si se quiere el mapa SIN los avisos, se apaga el tipo «Rueda SIN NADIE conectado en BOLT» en /alertas.
- **Los 12 equipos de Mapon que no son coches del ERP** —`1159283703`, `7136LGM`, `9037LJR`, `9133KZF`, `6544LVX`, `6584KZV`, `7909LRJ`, `8750LTR`, `9107LWS`, `1159182322` y dos sin matrícula— ya no se pintan. O se dan de alta o se quitan de la cuenta de Mapon.
- **`6663LCY` lleva 87 días sin hablar y está «Operativo»**; `7603KZY` 9 días y `1204MJY` 3. Son equipos que hay que ir a mirar, no coches perdidos.
- **Los 11 en rojo del 21/09 no son un fallo del mapa.** Cinco son equipos que no casan con ningún coche del ERP —`1159283703`, `7136LGM`, `9037LJR`, `9133KZF` y la segunda unidad del `3031LTV`— y los otros seis son conductores rodando con la aplicación cerrada. El del `0730MMZ` llevaba **15 h desconectado y 47,4 km**. Decidir qué se hace con cada caso es de Operaciones, no del piloto.
- **`3031LTV` sigue con DOS unidades de Mapon**, y en el mapa salen las dos con la misma matrícula. Desde el 28/09 el ERP usa solo una (ver «Coches con algo raro»), pero el mapa pinta unidades, no coches: hasta que la vieja se dé de baja en Mapon, seguirá saliendo.

## Cabos sueltos del alta (18/09/2026)

- **32 fichas en «Listo para RRHH»** de antes del cambio. Su bandeja sigue funcionando; la duda es si se marcan como alta en bloque o se dejan vaciar a mano.
- **El tramo de Ballenoil ya no existe** (24/09/2026): RRHH tramita y la ficha queda de alta directamente. El Excel de altas (`services/altasExcel.js`) sigue en la bandeja de RRHH mientras queden fichas viejas (39 el 24/09); cuando se vacíe, se puede retirar.
- **El PIN de Ballenoil se quitó del todo** (24/09/2026): del bot, de Administración y del alta. **Los códigos de lavado vuelven al bot hasta el 15/10/2026** con la última tanda (28/09). Ver [[Historial de decisiones]].

## Fuera del ERP: lo que hay que crear en otro sitio (18/09/2026)

- **El setup de «fuera de zona» de «Zona Notificación», en Mapon.** La geocerca existe (id 3029835) pero **no hay ningún setup que dispare cuando un coche sale de ella**: del 11 al 18/09 no saltó ni una. El código del ERP ya la trata, así que el aviso empezará a sonar solo en cuanto se cree el setup desde la app de Mapon. El de «Zona Madrid» sí está vivo. → [[Control Alertas]]
- **Las plantillas `zona_notificacion` y `zona_madrid` en Meta.** Mientras no estén aprobadas, los avisos salen por la plantilla genérica con su frase larga; no se pierde ninguno.

## Pendientes técnicos

- **Credenciales escritas en el código.** Casi todo está bien puesto en variables de entorno, pero quedan dos cosas:
  - `services/bolt.js` lleva el `client_id` y el `client_secret` de OAuth de BOLT **en texto plano**. Es la única credencial del sistema fuera del entorno, y está en el historial de git: sacarla al entorno **y rotarla**, porque quitarla del fichero no la borra del historial.
  - `services/puertasBot.js` (antes en `routes/botPuertas.js`) lleva la URL del despliegue de Apps Script que **abre y cierra los coches**. No es una clave, pero un despliegue publicado de Apps Script no pide autenticación: quien tenga la URL acciona puertas.
- **Rotar la clave de Mapon y la cuenta de servicio de Google.** Están en el entorno, como debe ser, pero han circulado.
- **Revisión de seguridad (del laboratorio, 18/09/2026).** Puntos a verificar/endurecer que salieron al auditar el sistema en el lab aislado; el detalle y cómo se prueba cada uno están en [[Seguridad]]:
  - **IDOR en `/documentos/api/doc/:id`** — comprobar la propiedad/ámbito **por registro** en `documentos.service`, no solo el permiso de módulo. Si no, cambiar el número del id lee papeles de otros.
  - **`SESSION_SECRET` obligatorio y largo** — la sesión es una cookie firmada con el rol dentro; sin un secreto fuerte y estable en el entorno, se puede falsificar. Nunca el efímero por defecto.
  - **CSRF** — los POST que cambian estado se aceptan solo por la cookie; falta token CSRF por sesión y `SameSite` en la cookie de sesión.
  - **Firma del webhook del bot de puertas** — verificar `X-Hub-Signature-256` (HMAC con el APP_SECRET de Meta) en cada POST antes de accionar `open_doors`/`close_doors`.
  - **Punto ciego de `comprobar-sql`** — repasar a mano los SQL con interpolación `${...}` de datos de usuario (el comprobador no los ve); todo valor va como `$1`.
  - **`/mi-red` sin clave de permiso** — cualquier usuario logueado ve la topología de red interna; ponerle clave de desarrollador.
  - **Rutas viejas de subida** (`/api/subir`, `/api/archivo/:id`) — arman la carpeta con texto libre (path traversal); retirarlas (ya marcadas «para borrar»).
- **Promover la CSP de recursos a obligatoria.** Hoy va en `Report-Only` (no bloquea, solo avisa en consola) porque la CDN de Tailwind exige `unsafe-inline`/`unsafe-eval`. El camino: compilar Tailwind en el build, quitar la CDN, y entonces hacer la política obligatoria con `nonce`. → [[Seguridad]]
- **`/control/historico` va lento**: unos 26 s de base, más 12 s desde que los km salen del odómetro. Es la pantalla lenta de la casa desde antes; se arregla igual que se arregló En directo (mirar el plan de la consulta, no adivinar).
- **¿Es fija la IP de la oficina?** El reconocimiento de «dentro / fuera de la empresa» usa una IP concreta. Si el operador la cambia, todo el mundo pasa a salir «fuera». Si es dinámica, hay que dejar el prefijo en vez de la IP entera.
- **El móvil sale «fuera» estando en la WiFi de la empresa.** Sin resolver. La forma de salir de dudas es abrir `/mi-red` desde el propio teléfono conectado a la WiFi y mirar qué IP llega.

## Coches con algo raro

- **Ruedan sin que nadie esté conectado en BOLT**: 7550KYT, 3784LFV (949 km, y en Barcelona), 0970LJJ, 5646MDM. El aviso de Control los saca; falta preguntar qué hacen.
- **Tres matrículas con dos equipos en Mapon** (28/09/2026). El ERP ya usa solo el bueno ([[Mapon]] → «Una matrícula, un equipo»); lo que queda es **dar de baja en Mapon la unidad que sobra**: **898080** (5886LBZ), **898092** (5912LBZ) y **885388** (3031LTV). Hasta entonces las puertas del bot, que van por el Apps Script, pueden seguir cogiendo la vieja.
  - Tras desplegar, el motor cambia `fv_vehiculo.mapon_unit` del 5886LBZ y del 5912LBZ en la primera vuelta. El enlace de Vehículos (y con él el odómetro del cuadro: 664.544 y 523.672 km) entra con la sincronización diaria, o antes con **«Sincronizar con Mapon»** en /vehiculos.
  - El odómetro CAN de esos dos coches no se ingirió nunca (se leía el equipo sin CAN): `fv_odometro` los tiene desde el cambio en adelante. Si hace falta el pasado, es una ingesta de `ingestarOdometro({desde, hasta})` sobre esas dos unidades.
- **5775KKL no tiene corte de motor configurado**: sus tres relés en Mapon son `basic`, deshabilitados y sin título. Los otros 23 Ioniq sí lo tienen (p. ej. 0261MFX, unit 893940: salida 1 `engine_block` «Bloqueo Motor»). **No se puede arreglar desde el ERP**, porque la API no configura relés: hay que pedir a soporte de Mapon que confirme si el relé está instalado en la salida 1 de la unit 893945 y que la configure igual que la 893940, o, si no está, que lo monte el instalador. Después, probarlo parado y con el contacto quitado.
- **3414JXB, 5909LBZ y 9985LBC (Ford Mondeo) no tienen ni un relé en Mapon**: sus equipos no enseñan salidas. Ahí no basta con configurar, hace falta instalar.
- **0744MMZ** y **8475KWG** no tienen rastro en Mapon: sus km salen de BOLT y las filas van marcadas.
- **0491KPM** no está dado de alta en la flota.
- **Factura 1204MJY-13195** sin cargar.

## Lo que está en marcha y conviene no olvidar

- **Iniciar y terminar turno por WhatsApp** — en marcha para todos los conductores desde el 28/09/2026 ([[Fichaje]]). Es la solución de fondo a la atribución de kilómetros; falta que la auditoría de km lea el libro de turnos (y los km de «Entregar coche») para señalar personas en vez de matrículas ([[Corte de tramos]]).
- **BI** (`/bi`): se pule cuando el sistema tenga más datos. No se toca por ahora.

Relacionado: [[INDICE]] · [[Historial de decisiones]]
