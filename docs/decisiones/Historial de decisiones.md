---
tags: [decision, historia]
actualizado: 2026-10-01
---

# Historial de decisiones

Las decisiones que explican por qué el sistema es como es. En orden, de la más reciente a la más antigua. Cada una tiene su nota cuando da para más.

## 2026-10-01 · «No saldrá» con motivo y «Traza por Slack», en Control

Seis motivos para el que no va a salir (error de planificación, asuntos propios, baja médica sin justificar, baja médica justificada, herramientas auxiliares, caso específico), con comentario obligatorio. Le quita las alertas de horas porque ya se sabe por qué no sale, lo saca de las campañas y se cuenta por motivo en el Histórico. Y una marca de en qué canal de Slack quedó la traza (todos menos `datos`); el ERP no escribe en Slack. Una vigente de cada por conductor y jornada (db/170). De paso, `Dialogo.formulario` obliga también en los textos y devuelve el valor inicial de una lista, que desde el 17/09 se perdía. → [[Control En directo]] · [[Componentes de la casa]]

## 2026-10-01 · La velocidad solo baja la letra si el aviso fue fiable y se mandó

Calificación 2.1: de los excesos solo cuentan los `avisado`. Los dudosos, simulados y fallidos ya no bajan la letra; en septiembre suben 12 personas, entre ellas Edison Roman Vera Farfan, de C a A, que llevaba cinco excesos dudosos del 3784LFV que no eran suyos. A él se le quitan de su expediente (db/169) sin borrar las filas, que son la marca de «ya procesado». El cron rehace una vez el mes cerrado si se cerró con otro modelo. → [[Calificacion de conductores]] · [[Sanciones de velocidad]]

## 2026-09-30 · Usuarios y permisos, también para Ignacio

El módulo `/usuarios` deja de ser solo del desarrollador: entra también quien tenga la llave `/usuarios`, que es de una sola persona (db/168) y tiene Ignacio. No se le dio el rol de desarrollador porque abre la base de datos y las migraciones. Quien entra por la llave no da el rol de desarrollador ni toca la cuenta del desarrollador. → [[Usuarios y permisos]]

## 2026-09-30 · El BI se refresca de madrugada, no cada hora

El refresco de los hechos del BI (horas, ingresos, km) pasa de cada hora a una vez al día, a las 04:30. `bi_hecho_km_dia` tardaba 27 s de media y hasta 63 s, y en una base de 1 CPU ponía la CPU al 100 % cada hora a y cuarto: lo notó Camilo al abrir el ciclo de bloqueo de motor justo a las 12:15. El BI enseña hasta ayer; lo de hoy, con el botón de refrescar. → [[Base de datos]]

## 2026-09-30 · Sin repaso: el motor solo lo bloquea el conductor al terminar

Se quitó el repaso, que cada diez minutos cortaba todo coche parado de los que habían pasado alguna vez por el fichaje, y el corte del cierre automático. Camilo: «los únicos que bloquearán son los conductores cuando inicien turnos y terminen; el sistema no bloquea nada sino que suelta». El ciclo de cada coche —bloqueado al terminar, suelto al empezar, fuera del ciclo si Tráfico lo suelta para el taller— se ve en un módulo nuevo (db/167, solo permisos). → [[Ciclo de bloqueo de motor]] · [[Fichaje]]

## 2026-09-30 · Nada de lo que manda órdenes toca un coche de Barcelona

El corte de motor, las puertas y el turno ya no tocan un coche de otra sede, pase lo que pase en el libro: el 1888LTJ, de Barcelona, se quedó cortado varios días porque la matrícula de **ejemplo** del bot era la suya y un viaje de prueba lo metió en el repaso. Camilo: «que no toque coches de Barcelona». La sede se mira en la misma puerta por la que sale todo corte (`fichaje.motor`), no solo en el repaso. → [[Fichaje]]

## 2026-09-29 · Aviso: deja al pasajero fuera de la M-30 y no vuelve

Si alguien deja al pasajero **fuera de la M-30** y a los **15 minutos** sigue por allá —cerca, alejándose o dando vueltas, a 1 km o más de la M-30, en espera o en descanso—, el mapa le pone un reloj y sale un WhatsApp a los controladores. Acercarse está bien. Los desconectados no cuentan (eran finales de turno). Un aviso **por pasajero dejado**, no por franja (db/166). → [[Mapa de flota]] · [[Control Alertas]]

## 2026-09-29 · Quien escribe la matrícula se queda el coche

Si el coche figura con otra persona, su turno se cierra como relevado **aunque no pulsara «Entregar coche» y aunque al que entra no le toque ese coche**: el que empieza en una matrícula es el nuevo responsable. Se anota lo que falte (el botón, el cuadrante) y al otro se le avisa. El motor no se corta en el relevo; si al que lo tenía se le bloquearía, antes el coche tiene que estar parado y apagado. Y abrir turno sigue siendo de **todo conductor de alta**, como se desplegó el 28/09. → [[Fichaje]]

## 2026-09-28 · Una matrícula, un equipo de Mapon

Los coches con dos equipos en Mapon usan **solo el que da GPS, CAN y corte de motor**, y el mismo en todo el ERP: fichaje, km, odómetro, mapa y Vehículos (`mapon.elegirEquipo`). A igualdad se queda el que ya se usaba, para que no bailen. Antes cada parte cogía uno distinto y el 5886LBZ medía con un equipo sin GPS ni CAN. La unidad vieja se sigue teniendo que dar de baja en Mapon. → [[Mapon]] · [[Trampas conocidas]]

## 2026-09-28 · El bot del conductor, ordenado

Todo conductor de alta sigue el mismo camino: saludo con su nombre de pila → escribe la matrícula → **empieza su turno** (se le desbloquea el motor) → siempre los mismos botones: *Abrir puertas · Cerrar puertas · Entregar coche* y *Código de lavado · Ver mis turnos · Terminar turno*. «Voy al relevo» pasa a llamarse **Entregar coche** (se pulsa al salir hacia el compañero: desde ahí se cuentan los km de la entrega). El bloqueo de motor al terminar sigue encendiéndose persona a persona. **No se usa la palabra «fichaje» con el conductor**: esto es custodia del coche, no registro de jornada, y llamarlo igual invitaría a confundirlos. → [[Fichaje]] · [[WhatsApp]]

## 2026-09-28 · Los turnos, de hoy a 7 días

«Ver mis turnos», la pestaña «Por conductor» de Cobertura (semana actual) y el aviso de los cuadrantes enseñan **de hoy al mismo día de la semana que viene**, no la semana de lunes a domingo: lo que ya pasó no interesa. Los relevos van con fecha. → [[Planificacion]]

## 2026-09-28 · Los códigos de lavado de Ballenoil vuelven, hasta el 15/10

La última tanda de bonos (566, vencen el 17/10) entra por db/164 y el botón vuelve al bot; desde el 16/10 deja de salir solo. El PIN de repostaje no vuelve. → [[WhatsApp]]

## 2026-09-27 · La casa pasa a ser corporativa

Un solo acento (el oro del logo) para lo que se pulsa o está elegido; superficies lisas sin cristal, resplandor ni degradados; IBM Plex Sans; y ningún emoji en pantalla. Los temas comparten superficies y cambian solo el acento. El ámbar de las vistas pasa a ser **aviso**. El vídeo de 4,9 MB de la marca se sustituye por un SVG que sigue al tema, y la carga es esa marca animada en CSS (se descartó HyperFrames: daría otro vídeo, de pago y con colores fijos). → [[Identidad visual]]

## 2026-09-25 · Recaudación: la apertura se corrige anulando, no pisando

La caja daba −540,05 € sin que faltara dinero: la apertura restaba 884,40 € de dos entregas del Excel con fecha futura que Ignacio anuló después. db/163 anula la apertura vieja y apunta otra de 25.509,87 €; la caja queda en +344,35 €. Un importe de dinero no se sobrescribe: se anula con motivo y se apunta de nuevo. → [[Administracion]]

## 2026-09-25 · Recaudación: los descuentos de nómina de septiembre

El Excel de recaudación por nómina de septiembre (hoja «Cierre») entra como 67 movimientos de nómina firmados por Ignacio Cafferata, el responsable. Por migración, una sola vez; lo que esté mal se anula con su motivo. → [[Administracion]]

## 2026-09-25 · Los tickets cuentan desde el 24/09/2026

Cambio de planes sobre el «solo este mes»: las bandejas y la barra traen solo lo pedido desde el 24/09/2026, un corte fijo (no una ventana que se mueve, para que lo pendiente no desaparezca solo). Se puede mover con el ajuste `ticketera_desde`. → [[Ticketera]]

## 2026-09-25 · RRHH partido en la barra, solo en pantalla grande

En pantallas de 1.536 px o más, el cuadro de RRHH se parte en Casos de nómina, Casos de baja médica, Vacaciones y Permisos, cada uno abriendo la bandeja filtrada; por debajo sigue siendo uno. Lo que no cae en ninguno va a «Otros de RRHH», que solo aparece si tiene algo. → [[Ticketera]]

## 2026-09-25 · Inspección: gato y llave de ruedas, sin botiquín

Dos elementos más en la inspección de vehículos y uno menos. El botiquín se apaga en el catálogo en vez de borrarse (la historia lo tiene apuntado) y deja de leerse también en las inspecciones de antes. → [[Inspeccion de vehiculos]]

## 2026-09-25 · Los tickets de cada departamento, arriba y solo los del mes

Las cinco bandejas de tickets salen del menú lateral y pasan a la barra de arriba, un cuadro por departamento con sus pendientes del mes. Las bandejas traen solo lo pedido este mes (por la fecha del formulario): lo anterior es, casi todo, de la hoja vieja, y se queda en la base sin salir. El formulario de «Operaciones 1.0» se lee cada 10 min por la ingesta —la tarea estaba mal anidada y no corría; entraban por un cron de 2 h— y solo las filas nuevas, sin escribir nada en su hoja. → [[Ticketera]]

## 2026-09-25 · Una sola foto del ahora para el mapa y Control

Qué hace cada coche y cada conductor en BOLT ahora mismo se calcula **una vez** (`services/flotaViva/ahora.js`) y lo leen todos: el mapa, En directo, el panel de Flota viva y el aviso de sueltos. Se rehace solo cuando la ingesta o el motor avisan de que ha entrado algo, y nunca dos a la vez. Control refresca ese ahora cada 10 s, como el mapa, sin recalcular el cockpit. Y dos apuntes en el mismo segundo se desempatan con una regla sacada de los datos (gana busy sobre waiting_orders), la misma en la foto y en el motor; la auditoría de km sigue con la suya, que no acusa. → [[El ahora de la flota]]

## 2026-09-25 · Cada uno pide corregir su fichaje, y aprueba una sola persona

Quien ficha puede pedir que se corrija lo suyo —una hora, o una jornada que no fichó—, sin llave aparte: viene con el fichaje. Es una **petición**: el fichaje no cambia hasta que se aprueba, y un rechazo lleva su porqué. Aprobar (y también corregir a mano y confirmar horas) es de **una sola persona**, la de la llave `/fichaje/revisar`: la base no deja que la tengan dos, y ni superadmin ni desarrollador aprueban por su rol. Quien aprueba se aprueba también lo suyo. → [[Fichaje]]

## 2026-09-24 · Ballenoil sale del ERP entero

Ya no se trabaja con Ballenoil: se reposta en **Petroprix**, que no necesita nada de los conductores. Se quitan el **PIN de repostaje** (del bot, de la pantalla de Administración y de la parada «Pendiente de alta en Ballenoil»: RRHH tramita y la ficha queda de alta) y los **códigos de lavado** (el botón del bot, el importador y su cron). La pantalla `/administracion` se va con ellos y lleva a sus tickets; **la llave `/administracion` se queda**, porque por el prefijo es la que cierra `/administracion/tickets`. Las columnas `pin_ballenoil` / `obs_ballenoil` y la tabla `ballenoil_codigo` se quedan en la base por lo ya escrito. → [[Seleccion]] · [[WhatsApp]]

## 2026-09-24 · El fichaje de coche se enciende persona a persona

Iniciar turno suelta el motor y terminarlo lo bloquea, pero ya no para una lista de teléfonos en una variable de entorno: se enciende a cada conductor desde el planificador y a cada persona de la empresa desde `/usuarios`. Un coche solo se bloquea si todos los que lo llevan fichan; si no, se queda libre. → [[Fichaje]]

## 2026-09-18 · El alta se cierra en Selección, no en RRHH

Quien completa los datos y genera la ficha **ya está dado de alta**: el contrato está abierto, el turno puesto y BOLT enlazado. Las paradas de «Listo para RRHH» y «Pendiente de Ballenoil» no añadían nada que la persona necesitara para trabajar, y Ballenoil sale del recorrido. Lo que le falta a partir de ahí es un coche, así que el planificador recibe el aviso siempre —con vacante para aceptar o rechazar, sin vacante hasta que se le dé una plaza. → [[Seleccion]] · [[Planificacion]]

## 2026-09-18 · Los papeles se pegan, y sus fechas no se teclean

Un documento se sube desde el explorador, arrastrándolo o pegando el pantallazo con el ratón encima de su línea. Y ya no se piden emisión ni caducidad: eran dos fechas por papel tecleadas con la imagen delante y salían mal —en un alta real el carné decía 12/12/2024 donde el papel ponía 12/02/2024—. El reverso del DNI y del carné dejan de ser obligatorios; el frente no. → [[Documentos]] · [[Seleccion]]

## 2026-09-17 · Los km salen del odómetro del coche

Se deja de medir con la estimación del GPS y se pasa al cuentakilómetros del cuadro. El GPS se quedaba un 4 % corto en la flota y **mucho más** en coches sueltos: el 0454MMZ marcaba 45 km contra 518 reales. Los coches sin CAN siguen con GPS y lo dicen en pantalla. → [[Km por odometro CAN]]

## 2026-09-17 · El corte de tramos vale para todos, cerrados incluidos

Tres intentos hasta acertar. Un tramo «desconectado» puede durar días y le colgaba al último conductor todos los km que el coche hiciera después. → [[Corte de tramos]]

## 2026-09-17 · Un trayecto se reparte por donde pasa, no cuenta entero donde empieza

Un trayecto de 249 km y siete horas que arrancó a las 04:45 —un cuarto de hora antes de abrir la jornada— metía la mañana entera en el día anterior. A Carlos Borelli le quedaban 52 km en 8,2 h de trabajo. Eran 330 trayectos y 22.302 km mal colocados en diez días. Ahora los metros se prorratean por el solape con la ventana.

## 2026-09-16 · Cuentas fantasma

A quien le suspenden la cuenta de BOLT se le presta otra para que pueda salir a trabajar. El sistema permite **enlazar** esa cuenta a la persona por un rango de fechas: sus horas y sus km son suyos, la bitácora dice «horas de cuenta fantasma» y Control enseña su nombre real con el aviso. Solo lo pueden hacer dos personas y **cada acción queda auditada** con fecha, hora, IP y dispositivo. → [[Conductores]]

## 2026-09-16 · El bloqueo de motor ya funciona

Mapon concedió el permiso y se probó en un coche real: la orden llega en dos segundos y con el corte puesto no arranca. **Regla de oro: nunca cortar con el contacto puesto** — el coche arranca y anda, pero ya no se deja apagar. Por eso el fichaje no deja terminar turno con el contacto puesto. → [[Fichaje]]

## 2026-09-15 · La calificación cuenta por mes y desde el alta

Libranzas, bajas, vacaciones y permisos valen 8 h para que no hundan la media; los días con horas en BOLT valen lo que hicieron; y los días que tocaba salir y no se salió **sin justificar valen 0**. Quien no tiene ni trabajo ni plan no cuenta. → [[Calificacion de conductores]]

## 2026-09 · Adiós a las hojas

El sistema deja de leer Google Sheets y lee solo PostgreSQL. Las hojas quedan como destino de informes, no como fuente. → [[Base de datos]] · [[Google Drive y Sheets]]

## 2026-09 · Una sola puerta de entrada

BOLT y Mapon entran por **una** función cada cinco minutos y escriben en PostgreSQL; las pantallas leen de ahí y no llaman a las APIs. Una llamada de flota alimenta a todo el mundo. → [[Ingesta]] · [[Flota viva]]

## 2026-09 · La jornada es 05:00 → 05:00

El día natural no sirve para esta flota: parte los turnos de noche por la mitad. Todo lo que cuenta horas o kilómetros usa la jornada operativa. → [[Jornada y turnos]]

## 2026-08 · Un módulo por negocio

El código se reparte en módulos con sus capas (controlador → servicio → repositorio) y desde fuera se entra por el `.service`. Hay comprobadores que lo vigilan. → [[Arquitectura]] · [[Reglas de la casa]] · [[Comprobadores]]

## 2026-08 · Migración desde cero

Se arranca de un único fichero de RRHH, la identidad la manda el **DNI** y el enlace con BOLT se hace por teléfono. Los teléfonos duplicados del Excel se comieron a cinco personas en la migración: por eso hay que leer el informe de errores. → [[Base de datos]]

Relacionado: [[INDICE]] · [[Estado y pendientes]]
