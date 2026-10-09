---
tags: [decision, historia]
actualizado: 2026-10-08
---

# Historial de decisiones

Las decisiones que explican por qué el sistema es como es. En orden, de la más reciente a la más antigua. Cada una tiene su nota cuando da para más.

## 2026-10-09 · Las vacaciones las aprueba una sola persona: Laura Blanco

«El departamento de Laura será el único que apruebe vacaciones; el resto puede verlas pero no aprobarlas». Aprobar unas vacaciones es ponerlas en la ficha por cualquier camino, y hay siete: aplicar, cerrar o sacar de su bandeja un ticket de vacaciones, y en Plantilla cambiar la situación a vacaciones o añadir, corregir o borrar un tramo. En todas, el servidor exige la llave `/vacaciones/aprobar`. Es de una sola persona, como la de los fichajes (db/189), y no se da por rol: ni el superadmin ni el desarrollador aprueban. El resto ve todo y puede apuntar la vuelta al trabajo. → [[Ticketera#Las vacaciones las aprueba una sola persona (09/10/2026)]]

## 2026-10-09 · Lo que no cabe en una casilla se dice antes de guardar

Mercedes vio en Selección el error de PostgreSQL en inglés, sin saber qué casilla era: una pieza de la dirección (número, escalera, piso, puerta o código postal) admite 10 caracteres. No se amplían las columnas, porque `direccion` es una columna calculada con ellas. Lo que se hace es comprobar el largo antes de guardar, con el nombre de la casilla y lo que cabe, y poner el tope en el formulario para que no deje escribir más. → [[Conductores#Lo que cabe en cada casilla (09/10/2026)]]

## 2026-10-08 · El estado del coche, siempre con su historial

El 0715MMZ estaba «En taller», pero su ficha decía en el historial «Operativo desde el 10/09, hasta ahora». El desplegable de estado del planificador cambiaba solo `vehiculo.estado_operativo` y no `vehiculo_estado_hist`. Había 20 coches descuadrados (11 de Madrid y 8 de Barcelona que db/76 dejó en «Baja»). El planificador ahora pasa por `vigencia`, como la ficha de Vehículos, también para la zona. **db/188** cuadra los 20, con el estado del coche vigente **desde el día en que se aplica**: la fecha real del cambio no quedó en ningún sitio y no se inventa. Un comprobador vigila que nadie vuelva a escribir el estado sin su historial. → [[Vehiculos#El estado del coche vive en dos sitios, y van juntos]]

## 2026-10-08 · «Cita puesta para revisión» en el estado de la flota

En Mantenimientos, cada coche con cita del taller pendiente lo dice en su fila, con el día, la hora y quién lo lleva según el planificador. Las tarjetas «Tocan revisión» y «A punto» cuentan cuántos ya tienen cita. Al cruzarlo salió que las tarjetas contaban también los coches de Barcelona y la tabla no (17 frente a 15). Ahora cuentan los mismos coches que la tabla, solo los de Madrid, como el resto de Mantenimientos desde el 24/09. → [[Citas del taller#En el estado de la flota: «Cita puesta para revisión»]]

## 2026-10-08 · Las citas del taller: el responsable lo dice el planificador, y el aviso sale dos días antes

El taller manda un Excel con las citas de mantenimiento (matrícula, día y hora) y había que usarlo ese mismo día. Se sube en Mantenimientos. **El responsable de cada cita no se guarda**: es quien lleva el coche ese día y a esa hora en `f_cobertura`, la misma regla que el cuadrante. Se pregunta cada vez porque el cuadrante cambia hasta el último momento. Lo que sí se guarda es a quién se avisó, y si después lo lleva otro, la cita lo dice. **El sistema avisa solo dos días antes**, con la plantilla `cita_taller` y sus botones «Confirmo» / «No puedo ir». Lo de mañana y hoy, a mano, como pidió Camilo. Control llama desde `/control/citas-taller`, y la llamada entra en el historial del conductor como «Taller». **Solo se citan coches de Madrid vivos en Vehículos**: el resto se lista con su motivo (el 1888LTJ, de Barcelona, «el sistema debe decir que no está registrado en Madrid o en el sistema»). Una cita es un coche y un día. Si el taller cambia la hora, cambia la misma cita, y si ya se había avisado de la otra hora, toca volver a avisar. → [[Citas del taller]]

## 2026-10-07 · Barcelona: las horas semanales de cada conductor

En los reportes de Barcelona hay un Excel semanal: cada conductor, de lunes a domingo, con sus horas efectivas en BOLT (su turno de día más su turno de noche, la regla del reporte diario), el total, los días trabajados y la media. Va de menor a mayor, un 0 en rojo marca que tenía plaza y no salió, y se puede sacar la semana en curso. La semana se elige con el calendario de la casa: primero puse una lista de semanas y Camilo pidió el selector de fechas. → [[Barcelona]]

## 2026-10-07 · El chat de WhatsApp: todo guardado, y escribir gratis con la ventana abierta

Lo que escribían los conductores al bot no se guardaba en ningún sitio. Tras el bloqueo por pago de ese día hubo que cruzar a mano los fallos de Meta con los turnos para saber a quién no le había llegado nada, y no había forma de escribirles. Desde db/185 cada mensaje que entra o sale por el número queda guardado, con su origen: el bot, la oficina, una alerta, un aviso de velocidad o de turnos. El módulo /whatsapp lo enseña como un chat y deja escribir **solo con la ventana de 24 h abierta**, que es gratis. Al escribir, **el bot se pausa** 30 minutos con esa persona para no contestar por encima de la oficina, pero **los botones del turno los sigue atendiendo**. Se borra a los 180 días. Fotos, audios, plantillas de pago y asignar conversaciones quedan para una segunda fase. → [[WhatsApp chat]] · [[WhatsApp]]

## 2026-10-07 · Un estado más del coche: Policía

En la ficha del coche (Vehículos → Editar), además de Operativo, En taller, Siniestro…, ya se puede poner **Policía**: el coche lo tiene la policía y no se puede usar. Es una fila del catálogo (db/184, código `P`). Se comporta como En taller o Siniestro: no operativo y fuera de la cobertura, así que el planificador avisa de que sus conductores se han quedado sin coche y Control lo señala si se mueve. Sale en azul. → [[Vehiculos]]

## 2026-10-07 · La pantalla de acceso, sobre Madrid o Barcelona

Camilo quería un acceso «más corporativo» y «como una landing», y trajo una referencia («login así»): una foto a toda la pantalla, un saludo grande a la izquierda y el formulario a la derecha, encima de la foto. La imagen la hicimos nosotros en SVG y va con la sede: Madrid con las Cuatro Torres y la autovía, y Barcelona con la Sagrada Família, la Torre Glòries y el mar. Al elegir la sede en el formulario, la imagen cambia con un fundido. La pantalla va siempre en oscuro y conserva el acento del tema de cada uno. Ese mismo día hubo, durante unas horas, una versión sin foto (la carretera del logo con el pin como punto de fuga), que esta sustituyó. → [[Identidad visual#La pantalla de acceso]]

## 2026-10-07 · Barcelona en el ERP: se elige en el login, con su planificador y sus horas

«En el login ahora va a aparecer Barcelona o Madrid.» Barcelona no tiene fichas, altas ni libranzas: sus conductores son sus cuentas de BOLT y sus matrículas, los coches de su empresa de BOLT. Tiene un **planificador** (cada uno en una matrícula, de día o de noche, **fijo hasta que se cambia**, que es lo que eligió Camilo), un **reporte de horas** y su **Visibilidad**. Cualquier usuario puede entrar a Barcelona. Sus horas, sus coches y sus pedidos van en **tablas suyas** (db/181, db/182), no en las de Madrid: si entraran en Flota viva o en `bolt_order`, sus conductores saldrían como NN en Control y en la Bitácora, y su dinero se sumaría a la Visibilidad de Madrid. Las horas se cuentan con **la misma regla que Madrid** (`repartoTurnos`, con el plan de Barcelona): la plaza de día cuenta de 00:00 a 24:00 y la de noche de 12:00 a 12:00. Quien tenía plaza y no hizo ni un minuto, **No salió**. → [[Barcelona]] · [[Sedes]]

## 2026-10-07 · Las alertas de Control dejan de mandar WhatsApp

«Desactiva completamente esos avisos, no los necesitamos ya.» Cada alerta era una plantilla de WhatsApp a los dos controladores, y Meta cobra cada plantilla entregada desde el 01/07/2025. Eran unas 600-700 al día, casi todas de «no vuelve a la M-30» y de «rueda suelto»: unos 30 € en dos días. Ese día la cuenta se bloqueó por el pago. `db/180` pasa el modo a `test`: las alertas se siguen viendo en pantalla, pero no sale ningún WhatsApp. Se vuelven a encender desde *Ajustes*, sin migración. Los avisos de velocidad y el de turnos a los conductores no se tocan. → [[Control Alertas]]

## 2026-10-07 · Informe de jornada semanal (Control · Reportes)

Un Excel de semana en semana, **solo de la plantilla propia**, con una pestaña por jornada de contrato (40 h, 32 h…). Lleva el nombre, de lunes a domingo, el total y si cumplió. Va de menor a mayor, así que los que no cumplieron quedan arriba. Las horas salen de la rejilla de la Bitácora, para que cuadren con ella. La J suma sus horas a las de BOLT, pero solo aprobada, que es la regla de la Bitácora. La baja médica no suma, pero deja su «B» en el día; las vacaciones (V) y los permisos (P), igual. La jornada a cumplir no se rebaja por esos días. Quien no tiene la jornada en el contrato va a una pestaña aparte, sin juzgar. → [[Control Reportes#Jornada semanal · ¿cumplió sus horas? (07/10/2026)]]

## 2026-10-06 · Todos los reportes con la regla del turno, y la nota de las faltas

«Todos los reportes que usen la misma regla a partir de ahora.» El Reporte de horas, el Reporte por turnos (deja de ser «5-5»), la Bitácora y la tarjeta «Ayer · jornada» cuentan ya por el turno de cada conductor. La jornada de una persona el día D es su turno de día más su turno de noche, y el día no se cierra hasta las 12:00 del siguiente. Por eso la Bitácora se vuelve a sellar a las 12:00, antes del promedio y la calificación. De la Bitácora cuelgan las faltas, la auditoría de lunes y el reporte de la ETT, así que la siguen sin tocarlos. Lo sellado antes del 06/10 no se reescribe: esos días siguen con la jornada 05→05. De paso, el reporte de faltas («los más reincidentes») ya no pone la nota de la escala vieja («S», que ya no existe): saca la nota y el promedio de la calificación A–D. → [[Jornada y turnos#Las horas de cada turno, por conductor (06/10/2026)]] · [[Control Reportes]]

## 2026-10-06 · Las horas de cada turno, por conductor (Control y Visibilidad)

Había gente de día que entraba antes de las 05:00 y esas horas no contaban. Ahora, en Control y en Visibilidad, el turno de día cuenta de 00:00 a 24:00 y el de noche de 12:00 a 12:00 del día siguiente, siempre según el turno de cada conductor en el cuadrante. Los NN van por su hora de inicio: antes de las 12:00, día. Como las dos ventanas se solapan, cada minuto se le da a un solo turno: el planificado si cae en su ventana, y lo demás por sesiones (`services/flotaViva/repartoTurnos.js`, con su comprobador). «No terminará» y «En riesgo» siguen cerrando a las 17:00 y a las 05:00: es el estándar. La jornada (05→05), la Bitácora y el Reporte de horas no cambian. → [[Jornada y turnos#Las horas de cada turno, por conductor (06/10/2026)]]

## 2026-10-06 · Control: filtro «En riesgo», sin alerta

Un tercer filtro en Control · En directo con quien está parado (desconectado o en descanso) sin sus 8 h y aún llega si vuelve ya. Arriba van los de menos margen. No añade ningún aviso a la fila: Camilo lo pidió «sin alerta, solo un filtro». Cuando a alguien se le acaba el margen, pasa solo a «No terminará la jornada». → [[Control En directo#El filtro «En riesgo» (06/10/2026)]]

## 2026-10-06 · Control: filtro «No terminará la jornada»

Un botón en Control · En directo que deja solo a quien está conectado y, aunque siga hasta el final, no llega a su jornada, con el número al lado. El aviso conserva su código (`no_llegara`, que comparte con «No llegará» y usan el call center y el histórico) y lleva una `variante` para poder filtrarlo. → [[Control En directo#El filtro «No terminará la jornada» (06/10/2026)]]

## 2026-10-06 · Próximas incorporaciones en el planificador

Una tarjeta en la columna lateral con quien va a entrar en un coche de hoy en adelante. Salen la gente nueva y quien vuelve de vacaciones o de baja médica, esta solo si le cambiaron de cuadrante mientras estaba fuera. Cada nombre dice si es nuevo o vuelve; al pincharlo, su número, puesto, cuadrante, base y fecha, y «Ver su cuadrante» lleva hasta él. «Antes» es su última plaza anterior a la nueva, no la de la víspera de irse: con la víspera, quien volvía a lo suyo salía como cambiado. → [[Planificacion#Qué cuenta cada tarjeta, y de dónde lo saca]]

## 2026-10-06 · «Extras» para los activos, y la jornada dentro de «Editar datos»

En la ficha de quien sigue de alta, el botón «Jornada» se fue dentro de «Editar datos» (apartado Contrato, guardado como novación por su camino de siempre). En su sitio está **«Extras»**: se eligen uno o varios meses, de julio de 2026 al mes en curso, y se baja un solo Excel con el mismo formato día a día que el finiquito. → [[Conductores#Extras (06/10/2026)]] · [[Nominas#Día a día (06/10/2026)]]

## 2026-10-06 · Las extras de quien se va, día a día

El Excel «Extras pendientes» de la ficha de alguien de baja lleva una pestaña por mes con cada día: horas, J, nocturnidad, propinas, peajes y facturación. Sale de las mismas consultas que la nómina, pedidas para esa persona, y debajo del total va la fila de la nómina para comprobar que coinciden. El MBO y el descuento por utilización no se reparten por días: se deciden con el mes entero. De paso se corrigieron dos líneas del resumen: el MBO que salía 0 cuando ganaba el de facturación, y unas horas que decían estar descontadas sin estarlo. → [[Nominas#Día a día (06/10/2026)]]

## 2026-10-05 · El planificador por bases, ordenado como un iceberg

Los cuadrantes salían por número, y eso no ayudaba a decidir a quién poner en cada coche. Ahora el planificador empieza por las cinco bases (Alcobendas, Alcorcón, Canillejas, Getafe, Usera) y enseña todos los cuadrantes base a base (desde el 06/10; el primer día había que pinchar una base). Dentro de cada base van de mejor a peor: completos, luego con plazas vacías, luego sin nadie. Dentro de cada escalón, los que ruedan antes que los del taller, y más horas instaladas primero. Al abrir una base, las tarjetas cuentan solo esa.

Las horas instaladas son, turno a turno, la calificación de quien cubre el turno; el N/E cuenta la mediana de la flota. Camilo eligió esa medida y lo del taller al fondo de su escalón. Hay dos vistas: horizontal (la tabla) y vertical (una tarjeta por coche). → [[Planificacion#Las bases y el iceberg (05/10/2026)]]

## 2026-10-05 · Con Mapon caído, el turno se ficha en nuestra base

Mapon suspendió la cuenta por un pago pendiente y el bot dejó de abrir turnos: el padrón de unidades se quedaba vacío y en caché, y todo eran «No encuentro la matrícula». Ahora `mapon.js` sabe si Mapon está caído, porque mira cada respuesta y lo levanta con la primera buena. Mientras lo esté:
- el turno se abre con el coche de Vehículos y solo en nuestro libro;
- las puertas y el motor no se tocan;
- al conductor se le dice que es un proveedor externo.

Cada mensaje de error del bot termina en «comunícate con Tráfico». → [[Fichaje]] · [[Mapon]]

## 2026-10-05 · Aceptado no es entregado

El bot dejó de contestar porque Meta bloqueó la cuenta por un pago pendiente (131042). Meta aceptaba los mensajes y los daba por fallidos después, en un aviso que el webhook tiraba. Por eso los avisos de velocidad seguían como `avisado` y bajaban la letra a quien no se enteró. Ahora el webhook apunta cada estado que manda Meta (`whatsapp_envio`, db/176) y pasa a `error` el aviso de velocidad cuyo mensaje falló. → [[WhatsApp]]

## 2026-10-05 · Los primeros días del mes, la letra del mes cerrado

La calificación va por mes natural y pide 5 días, así que del 1 al 5 de cada mes toda la flota salía N/E: la vista daba el periodo más reciente y el N/E del mes nuevo tapaba la letra del mes cerrado. Ahora, mientras el mes en curso no llega a 5 días, la vista da la del mes cerrado (db/175), y los chips lo rotulan («Es la letra de septiembre…»). Es lo que la documentación ya decía que pasaba. El 05/10 recuperaron su letra 190 personas. → [[Calificacion de conductores]]

## 2026-10-02 · Barcelona en el bot: cada uno, los coches de su sede

Los conductores de Barcelona abren turno y abren y cierran coches por el bot sin tener ficha: los reconoce su cuenta activa de BOLT de la empresa de Barcelona. La regla de las sedes pasa de «un coche de otra sede no se toca» a «el coche tiene que ser de la sede de quien lo coge».
- Su motor ni se corta ni se suelta: se lleva desde Mapon.
- No les salen «Ver mis turnos» ni «Código de lavado»: allí aún no hay planificador ni Ballenoil.
- La oficina con `/puertas` abre los coches de las dos sedes (lo eligió Camilo).
- Los viajes de la empresa siguen siendo de Madrid.

→ [[Fichaje]] · [[Sedes]]

## 2026-10-02 · Las cuentas de BOLT de Barcelona, solo en la base

El bot de WhatsApp va a tener que reconocer a los conductores de Barcelona, y de ellos no hay fichas. La empresa de BOLT de Barcelona entra en `flota` con su sede y el padrón la lee **en la misma vuelta** que las de Madrid, guardando de qué empresa es cada cuenta (db/174). Las horas no se traen, y ninguna pantalla de Madrid ofrece esas cuentas para enlazar: las vistas y las tres consultas que enseñan cuentas sin dueño las dejan fuera. Son dos listas en `CONFIG_BOLT`, porque la de siempre la recorren las horas, los coches y el mapa. → [[Sedes]] · [[BOLT]]

## 2026-10-02 · Los coches de Barcelona, cruzados con BOLT y Mapon

Primero BOLT, luego el sistema y por último Mapon. Vuelven tres «bajas» que eran traslados, entran ocho coches de BOLT Barcelona que no estaban y el 3814KYG pasa a Madrid (db/173). Cinco se quedan para una persona: las fuentes no se ponen de acuerdo. Un coche de Barcelona va en estado «B» para no entrar en el cuadrante de Madrid. → [[Vehiculos]]

## 2026-10-02 · El desarrollador abre puertas por serlo

`/puertas` es una llave manual que no trae ningún rol, y el bot le contestaba a Camilo «tu usuario no tiene permiso». Como con «Usuarios y permisos», el desarrollador entra por su rol; el superadmin, no. → [[WhatsApp]] · [[Usuarios y permisos]]

## 2026-10-01 · Organización, tanda 3: lo que se deja, lo que se archiva y lo que sobra

El motor de notificaciones del convenio (Hito 6) se queda sin enchufar, pero ya no falla: pedía `template_code` a una tabla que lo llama `code`. Los 13 scripts de un solo uso de la migración (y el SQL del reset) van a `scripts/archivo/`, y siguen funcionando. De los 30 exports sin uso, 15 se quitan, uno se enchufa (la lista de jornadas que la ficha de Plantilla llevaba copiada a mano), 7 se quedan con su porqué en la lista nueva de `inventario-exports` y 8 son ganchos de prueba. El ERP deja de poder escribir en Google Sheets: `sheets.js` queda en tres lecturas y con permiso de solo lectura. → [[Comprobadores]] · [[RRHH]]

## 2026-10-01 · El traspaso Selección → Conductores, por la capa de servicio

Selección creaba y daba de alta a la persona entrando en los repositorios de Conductores, Documentos y la propia Selección por los 4 últimos puentes. Ahora lo que coordina está en servicios (`candidaturas.service`, `conductores.service` con `realizarAlta`), las incorporaciones son de Selección, y el paso a propia recibe la comprobación de papeles de quien llama. Sin puentes y con 0 incumplimientos de capas. Una traza de 42 casos contra el código de antes salió idéntica. → [[ARQUITECTURA]]

## 2026-10-01 · Organización, tanda 2: se cierra la Fase 2

Fuera 22 de los 26 puentes y los ficheros muertos (padrón de BOLT sobre la hoja, el layout oscuro de julio, `config/bolt.js` vacío y dos lienzos de Obsidian). Los 4 que quedan tapan que el traspaso Selección → Conductores entra en repositorios de otro módulo: se quitarán cuando ese traspaso pase a la capa de servicio. El layout por defecto pasa a ser el de gestión. → [[ARQUITECTURA]]

## 2026-10-01 · Organización, tanda 1: lo que estaba roto sin que se viera

Del análisis de huérfanos salieron cosas rotas sin avisar: tres PDF sin logo desde la mudanza a `modules/`, cuatro pruebas que no arrancaban o fallaban por haberse quedado atrás (no por el código) y `comprobar-ingesta` acusando a dos ficheros que solo importaban una regla pura de Mapon. Arreglado todo; las dos llamadas reales a Mapon que faltaban (zonas y ciclo de bloqueo) quedan apuntadas con su motivo. Las 26 pruebas y comprobadores sin base pasan. → [[Comprobadores]] · [[Trampas conocidas]]

## 2026-10-01 · La traza por Slack, en varios canales

La marca de Slack de cada conductor pasa a llevar una lista de canales (db/171) en vez de uno, y `Dialogo.formulario` gana la selección múltiple (`multiple: true`) para todas las pantallas. → [[Control En directo]] · [[Componentes de la casa]]

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
