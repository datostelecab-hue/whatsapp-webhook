---
tags: [plan, hoja-de-ruta]
actualizado: 2026-11-13
estado: en marcha desde el 13/11/2026 — fase A (A1, A2 y A3 en main; A4 y A10 en sus ramas)
---

# Hoja de ruta

La hoja de ruta de Ignacio («Roadmap del ERP Telecab — Camilo», fechada el 10/11/2026; la versión en PDF con sus respuestas llegó el 12/11) pide **22 desarrollos en cinco fases**: la base (tablero de tareas, chat y avisos), RR. HH., administración, flota y taller, y la medición (el informe trimestral por persona). Esta nota es **el plan para hacerlos**: en qué orden, qué del ERP ya sirve para cada uno, qué choca y qué falta decidir. Al empezar cada ítem se hace su plan detallado y se espera el visto bueno, como pide el propio documento.

Camilo, 12/11/2026: «hagámoslo por fases, no empecemos por el chat sin un plan de desarrollo primero». Y el 13/11: «Vamos con el plan de una vez».

Sale de un repaso del repositorio entero, ítem por ítem, en solo lectura, revisado después por dos lectores independientes: uno contra el PDF y otro contra el código.

## Dónde vamos

| Pieza | Estado |
|---|---|
| A1. Pruebas | **Hecha** (13/11/2026): `npm test` y la base sintética. Ver [[Pruebas automáticas]] |
| A2. Calendario laboral | **Hecha** (13/11/2026): `services/calendario.js` y los festivos de la oficina (db/244). Ver [[Calendario laboral]] |
| A3. Parámetros | **Hecha** (13/11/2026): `services/parametros.js`, la pantalla `/parametros` y su historial (db/243). Ver [[Parametros]] |
| A4. Libro de auditoría | **Hecha en la rama `fase-a/a4-auditoria`** (13/11/2026), a falta de probarla en el servidor de pruebas: la tabla `auditoria`, `auditoria_vigilar()` y `services/libro.js` (db/245). Ver [[Libro de auditoria]] |
| A10. Tareas programadas | **Hecha en la rama `fase-a/a10-tareas-programadas`** (13/11/2026, sale de la de A4), a falta de probarla: `services/tareasProgramadas.js` y `tarea_programada_vez` (db/246). Ver [[Tareas programadas]] |
| A5 a A9 | Pendientes |

## Lo que Ignacio cerró en la última versión

- **Todos los ítems están acordados.** Del Word quedaban cinco «a confirmar» (4, 8, 15, 19 y 21).
- **Móvil:** la web adaptada con notificaciones. No se hace app.
- **Las tareas no se asignan libremente** (ítem 1). Nacen de tickets, de tarjetas de los módulos o del chat. Las que necesitan aprobación las aprueba un supervisor (Ángel, William o Ignacio), y el plazo empieza a contar al aprobarlas. *Choca con el propio ítem*: sus datos admiten tareas de origen «manual», y desde el chat cualquiera elige responsable y plazo (ver «Decidir» del ítem 1).
- **Chat** (ítem 2): solo para la oficina. Toda la oficina puede consultar los canales y los mensajes directos son privados. Se guardan los últimos 5 años y se trae de Slack todo el historial que se pueda, con su autor y su fecha.
- **Expedientes de Laura** (ítem 4): doce tipos. Las propuestas de despido las valida Dirección (Ignacio): llegan como tarjeta, crean una ficha de despido y Laura la aplica en 3 días hábiles desde que llega a su panel. Los recursos se responden en 2. El día 25 presenta regularizaciones e indemnizaciones a Diana.
- **Ticket de sanción** (ítem 5): pasa por la aprobación de Ángel, William o Ignacio antes de llegar a Laura, y los 5 días hábiles para comunicarla cuentan desde la aprobación. Una suspensión de empleo y sueldo: Laura desactiva al conductor en Telecab y Bolt y la registra antes del 26.
- **Cartas de descuento** (ítem 6): Laura envía la carta y registra la firma; Diana y Mercedes solo consultan.
- **Al cerrar una baja o un despido** (ítem 8), el mismo día nacen dos tareas:
  - Daiane anula las credenciales y el PIN de combustible, con 1 día de plazo.
  - Desactivar en Telecab y Bolt, el mismo día. Le toca a Diana (baja voluntaria o no superar el periodo de prueba), a Laura (suspensión o despido) o a Víctor (fin de contrato de ETT).

  **La baja voluntaria solo se cierra con la firma electrónica del trabajador.**
- **Historial del conductor** (ítem 9): con el acumulado de multas (número e importe) y de sanciones.
- **Multas** (ítem 10): si no se puede identificar al conductor, Daiane la escala a Angie y a Ignacio.
- **ITV** (ítem 14): es de Daiane. A 30 días del vencimiento, aviso y tarea de coordinar con tráfico que el coche vaya a la inspección.
- **Reintegros** (ítem 15):
  - el conductor carga el importe en su ticket;
  - Daiane aprueba o corrige hasta 100 €, y por encima aprueba Ignacio;
  - cada corrección queda registrada;
  - lo aprobado de un conductor se le comunica a Diana desde el módulo.

  Esta versión no menciona el tope mensual del Word.
- **Siniestro** (ítem 18):
  - lo registra Control;
  - Taller adjunta siempre el vídeo y sin él no se cierra;
  - todos sus costes se imputan al siniestro y a la matrícula.
- **Pólizas** (ítem 19): solo las edita Ignacio. A 60 días del vencimiento, tarea de renovación para él.
- **Recambios** (ítem 20): cada factura se imputa a la matrícula y a su tipo (revisión, mantenimiento, avería o siniestro). Habrá planes preventivos por modelo, por km y por tiempo, con una alarma que crea tarea a Óscar.
- **El ítem 21 pasa a ser el estado de la flota en tiempo real**, no un parte diario: lo mantiene el taller, cada cambio queda con usuario y hora, y el ticket de taller lo cambia solo.
- **Ítem 22 nuevo:** informe trimestral de indicadores por persona, con el Q4 2026 como línea base.
- Queda abierto un punto: si los 19 canales son todos. **La lista sale de los canales en los que está Ignacio**: puede faltar alguno, sobre todo privado.

## El orden

1. **Fase A — cimientos.** Las convenciones dan por hechas piezas que el ERP no tiene. Van antes de todo, cada una con su test.
2. **Fase 0 en el orden 1 → 3 → 2.** El tablero y los avisos los usan casi todos. Del chat solo dependen el criterio del ítem 1 «una tarea creada desde un mensaje» (se prueba al acabar la entrega 2b, y en el 1 se deja preparado el origen «mensaje»), el ítem 15 y los adjuntos (que pasan a la fase A).
3. **Fases 1, 2 y 3 respetando la columna «Depende de» del mapa:**
   - **Fase 1:** 4 → 5 → 6 → 7 → 8. El 9 se entrega en dos partes: las sanciones al acabar el 5, y las multas con el 10.
   - **Fase 2:** 10 → 11 → 9 (multas) → 12, 13, 14 y 15. El 11 depende del 10.
   - **Fase 3:** 16 → 17, 20 y 21, y luego 19 → 18. El 17 y el 20 dependen del 16, y el criterio del 21 necesita el ticket de taller.
4. **Fase 4 (ítem 22)** al final, con una línea base realista (ver el ítem).

**Este orden se aparta del documento**, que pide «un ítem por vez, en el orden del mapa»: pone la fase A delante y la fase 0 como 1 → 3 → 2. Lo tiene que aceptar Ignacio.

La seguridad pendiente de la revisión de octubre se cierra **antes del chat y de los módulos con datos sensibles** (4, 5, 9, 10 y 12).

## Fase A — Cimientos

| Pieza | Qué hay | Qué falta |
|---|---|---|
| **A1. Pruebas** | Hecha. Ver [[Pruebas automáticas]] | — |
| **A2. Calendario laboral** | Hecha: `services/calendario.js` (días y horas hábiles, semáforo, «hoy» en Madrid) con los festivos de `festivo` (db/197) y de `festivo_oficina` (db/244: San Isidro y la Almudena). Ver [[Calendario laboral]] | Barcelona (Camilo: más adelante; la tabla ya lleva la sede). **Los festivos de 2027** de la Comunidad y de Madrid capital (el servicio avisa en el log si un año no está cargado). Una pantalla de festivos. Usar el «hoy» común: hoy se calcula en más de 50 sitios con al menos 8 nombres, y en 6 ficheros en UTC (`vigencia.js`, la baja del conductor, el alta de un coche…) |
| **A3. Parámetros** | Hecha: `services/parametros.js`, la pantalla `/parametros` y el historial intocable `parametro_cambio` (db/243). Ver [[Parametros]] | Pasar ahí los números de regla que siguen en el código o en variables de entorno, cuando se toque cada módulo (`DIA_CORTE`, los 2 días del aviso de citas, los 15 y 60 días de taller, la retención del chat de WhatsApp…) |
| **A4. Auditoría** | Hecha: el libro `auditoria` (db/245), que se escribe por disparador en cada tabla puesta bajo él con `auditoria_vigilar()`, y `services/libro.js` para firmar, apuntar lecturas y leer la historia. Ver [[Libro de auditoria]] | El componente que pinta la historia en una ficha (con el ítem 1). Cuánto se guarda y quién lo consulta entero. Lo viejo (`cambio_campo`, `ticket_evento`) se queda como está |
| **A5. Personas y organización** | Rol más llaves por usuario. Solo constan por id Ignacio (1), Víctor (3), Laura (4), Camilo (7) y Daiane (9) | Área y superior de cada usuario, y **responsables por función** con su `usuario.id` (supervisores, multas, caja, ITV, pólizas, taller). **Una matriz por rol con excepciones por persona**: la convención 6 pide la matriz por rol, pero varias reglas son de personas concretas (solo Laura, Ignacio y Fernando; solo Ignacio edita las pólizas; reciben efectivo Daiane, Ignacio y Fernando). Los datos sensibles se comprueban en el servicio, como hace `services/aprobarVacaciones.js` (`exigir`), también para superadmin y desarrollador |
| **A6. Adjuntos** | Cuatro almacenes distintos: `documento` (solo conductor o coche), `ticket.adjuntos` en JSONB, `whatsapp_adjunto` en la base y el adjunto de las facturas. Drive se descarga entero en memoria, sin Range. Casi todas las subidas van en base64 dentro del JSON (Selección usa multer en memoria); ninguna en streaming | **Decidir el almacén** antes del chat: Drive es un Gmail de 15 GB, y 5 años de chat, Slack y vídeos de siniestros no caben. Después, una tabla de adjuntos con cualquier dueño, subida multipart en streaming, descarga con Range y vista previa (PDF en iframe del mismo dominio, imágenes con VisorFoto, vídeo con `<video>`) |
| **A7. Tiempo real** | Nada: se sondea cada 3 s a 5 min | Una ruta SSE fuera de la compresión, con latido cada 25 s, reconexión que pide lo perdido y un cliente común que cae al sondeo. Con una sola instancia basta un bus en memoria; LISTEN/NOTIFY solo si hay más |
| **A8. Notificaciones** | Nada: ni manifest, ni service worker, ni Web Push | Manifest, service worker en `/sw.js` (desde `/assets` no controlaría el ERP), claves VAPID, suscripciones por dispositivo y permiso pedido tras un clic. En iPhone solo funcionan con la web instalada |
| **A9. Contadores del menú** | Tres contadores sueltos: la campana, los cuadros de tickets y la chapa de fichaje. Con el menú contraído solo se ve `#nav-pend-badge` | Un endpoint de recuentos por usuario, una marca por entrada, la suma por grupo y una clase CSS común |
| **A10. Tareas programadas** | Hecha: una vuelta cada diez minutos hace las tareas de negocio que tengan su vez pendiente, una sola vez aunque haya dos procesos y recuperando la que se perdió por una caída (`services/tareasProgramadas.js`, db/246). Ver [[Tareas programadas]] | A quién se avisa si una falla (con el ítem 3). Una pantalla con los intentos. Los crons viejos de `app.js` siguen como estaban |

Orden de lo que queda: A5 → A6 → A7, A8 y A9.

**Desde el 13/11/2026 cada pieza va en su rama** (`fase-a/…`) y Camilo la prueba en el servidor de pruebas de Render (con `MODO_PRUEBAS`) antes de pasarla a `main`.

## Fase 0 — Base

### 1. Tablero de tareas (L)
- **Hay:** la ticketera, con responsable, `asignado_at`, `resuelto_at` y su historial `ticket_evento`. «Aplicar» un ticket de ausencia hace la acción y cierra solo el ticket: es el precedente de tarea automática. Las aprobaciones de J, −J, fichaje y vacaciones sirven de patrón de datos.
- **Falta:**
  - Las tablas: `tarea`, colaboradores, comentarios y un libro de eventos intocable.
  - El circuito de aprobación, con **el aprobador según el tipo de tarjeta**: el trío de supervisores, o Dirección para un despido.
  - El semáforo hábil (A2) y el cron de vencimiento, que avisa al responsable y a su superior.
  - **Reasignar con motivo obligatorio**, con su evento en el libro y un aviso a los dos responsables.
  - El contrato de cierre automático: cada tipo dice qué lo cumple, y la API rechaza el «Hecha» a mano.
  - Enganchar la ticketera en los dos sentidos.
  - Las pantallas: Mi tablero con arrastrar y soltar (no hay ninguna pieza de arrastre), Tablero del equipo y la lista con Listado.
- **Choca:**
  - Los tickets no tienen plazo, su prioridad es texto libre y no existe «Bloqueada».
  - La única asignación es «me hago cargo».
  - Las bandejas cuentan desde un corte: el 24/09/2026 por defecto, ajustable en `config_app.ticketera_desde`.
  - Un circuito de aprobación parecido se quitó el 15/09/2026 porque «añadía un paso» (db/115 y db/116).
  - La bandeja de RRHH lleva bajas médicas: una tarjeta que copie su texto las enseñaría en el tablero del equipo.
- **Decidir:**
  - qué es una tarea manual (¿solo para uno mismo?) y si la creada desde el chat pasa por aprobación;
  - qué tickets generan tarjeta y con qué plazo por subtipo;
  - quién es el responsable de la tarjeta de un ticket;
  - qué tarjetas piden aprobación;
  - **cuándo** pasan a tarjetas las colas de hoy (J, fichaje, vacaciones): el tablero es el lugar único del trabajo pendiente, así que pasan. La campana son avisos (ítem 3), no tareas.

### 3. Avisos entre módulos (M)
- **Hay:** muchos avisos sueltos que se calculan al momento y no se guardan:
  - la campana, que reparte por rol con cuatro roles fijos;
  - los cuadros de tickets y la chapa de fichaje;
  - la tarjeta de efectivo y los cumpleaños, cuyo «cerrado» vive en el navegador;
  - las alertas de Control y las incorporaciones.

  `incorporacion` y `felicitacion` sí guardan quién lo resolvió o lo vio.
- **Falta:**
  - la tabla de avisos con su leído **por aviso y perfil**, guardando quién lo marcó y cuándo (el aviso sigue «hasta que alguien lo marca como leído o lo resuelve»);
  - el servicio `emitir`, `marcarLeido` y `resolver`, declarado transversal en `comprobar-capas`;
  - los contadores (A9) y los urgentes por notificación (A8);
  - el primer emisor: la cita de taller avisa a Control.
- **Choca:**
  - Los nombres `notificacion`, `/notificaciones`, `aviso_turnos` y `/avisos/efectivo` ya están ocupados.
  - «Perfil» no existe: hay un rol por usuario y llaves por persona.
  - Las alertas de Control son varios cientos al día: a principios de octubre salían 600-700 plantillas, dos por alerta. Hay que medirlo antes de decidir cuáles entran, o ahogarían el contador.
- **Decidir:**
  - qué es «perfil» y quiénes son «todos los perfiles de Control»;
  - si los avisos se resuelven solos;
  - qué avisos de hoy pasan al sistema nuevo y cuándo.

### 2. Chat interno (XL, en cuatro entregas)
- **Hay:**
  - el chat de WhatsApp como patrón: mensajes por id, sondeo, cabeceras seguras de adjuntos y formato de texto;
  - la extensión `unaccent` ya instalada, para la búsqueda en español;
  - los nombres exactos de 14 canales de Slack, en la «Traza por Slack» de Control.

  **No hay ningún acceso a Slack** en el código.
- **Entregas:**
  - **2a:** canales, directos, tiempo real, no leídos, menciones e hilos.
  - **2b:** adjuntos y vista previa, reacciones, editar y anular, fijar y guardar, formato, vista previa de enlaces (protegida contra SSRF) y convertir en tarea. Aquí se prueba el primer criterio del ítem 1.
  - **2c:** búsqueda (tsvector en español con índice GIN, respetando privados y directos), estado y no molestar, y notificaciones.
  - **2d:** gestión de canales y migración de Slack.
- **Choca:**
  - **«Toda la oficina consulta los canales» frente a la convención 6:** #4-bajas-medicas, #6-nominas, #9-rrhh y #16-efectivo son públicos en la lista. Es una objeción a algo que Ignacio ya decidió, y se le plantea a él.
  - «Borrar mensajes propios» frente a «nada se borra»: será una anulación y el texto queda en la auditoría.
  - La purga de 180 días de WhatsApp no se puede copiar.
  - Los autores de Slack que no son usuarios del ERP necesitan un sitio aparte: `usuario` exige contraseña y email único.
  - La «Traza por Slack» de Control apunta a canales que dejarán de existir.
- **Slack:** lo que se puede traer depende del plan.
  - **Free:** enseña 90 días y, desde el 26/08/2024, borra sin vuelta atrás lo de más de un año.
  - **Free y Pro:** exportan solo los canales públicos, con enlaces a los ficheros (en Free, solo los de 90 días).
  - **Privados y directos:** solo con Business+ y solicitud aprobada por el Workspace Owner, o con Enterprise.
  - **Ficheros:** hay que bajarlos uno a uno antes de cerrar Slack.
- **Decidir:**
  - el plan de Slack y su Workspace Owner, y si hay canales sin Ignacio;
  - qué hacer con privados y directos;
  - si «5 años» es un mínimo o un límite;
  - quién crea canales;
  - el almacén (A6).

## Fase 1 — RR. HH.

### 4. Expedientes de Laura (L)
- **Hay:**
  - las situaciones del conductor con sus tramos (vacaciones, permiso, asuntos propios, baja médica, suspendido…);
  - las acciones de Plantilla que el tablero llamaría: cambiar situación y poner el alta médica;
  - la ausencia, que recuerda su ticket;
  - la llave de una sola persona de vacaciones, como modelo de «solo Laura, Ignacio y Fernando»;
  - del convenio:
    - `regularizacion` se usa en el cierre de /convenio, en minutos;
    - `incidencia_economica` y `liquidacion` se leen en /convenio, pero nadie escribe en ellas;
    - `disciplinary_rule` no tiene ni uso ni datos.
- **Falta:**
  - el expediente y su catálogo con los plazos (parámetros de A3);
  - la ficha de despido que nace de la propuesta validada por Ignacio;
  - los tipos que no existen: recurso, accidente de trabajo, despido, regularización e indemnización en dinero, sanción y carta.
- **Choca:**
  - «Expediente» y «sanción» ya significan otra cosa en el ERP.
  - Borrar una ausencia la elimina de verdad.
  - Una sola situación por día: pasar a baja médica reemplaza el tramo.
  - «Regularización» es hoy un ajuste de minutos.
  - **El criterio del 4 dice que el ticket de sanción aparece «enviado», y la regla del 5 que entra al aprobarse:** el test del 4 partirá de un ticket aprobado (confirmarlo con Ignacio).
- **Decidir:** qué es «ausencia» como expediente; el plazo de los tipos sin número; qué son regularización e indemnización en dinero y dónde se aplican; si incluye a la oficina; si se cargan los abiertos de hoy.

### 5. Ticket de sanción (M)
- **Hay:**
  - la situación «suspendido» y el estado de la cuenta de BOLT, que se refresca cada hora;
  - el catálogo de faltas del convenio (art. 39, sin uso).
- **Choca:**
  - **La API de BOLT es de solo lectura:** desactivar en Bolt siempre es manual.
  - `/sanciones` ya es la pantalla de velocidad.
- **Decidir:** la lista cerrada de faltas; el rechazo con motivo; **por qué medio se comunica la sanción y qué registro lo prueba**.

### 6. Cartas de descuento (L)
- **Hay:**
  - `incidencia_economica` (db/50), que separa la deuda del descuento;
  - el movimiento `nomina` de recaudación;
  - pdf-lib para la carta.
- **Falta:**
  - la carta con su tarea a Laura (4 días hábiles);
  - la fecha límite visible: el corte del 25 menos 4 días hábiles (A2 y A3);
  - el paso automático a la nómina de Diana;
  - la vista de solo consulta para Diana y Mercedes.
- **Choca:**
  - db/50 exige la autorización de Dirección; el ítem dice que basta la firma.
  - **/nominas no tiene por dónde entrar un descuento.**
  - El periodo de la base va del 26 al 25 (`DIA_CORTE = 26` es su primer día: no hay choque con «la nómina del 25»), pero las variables van por mes natural, y el corte está en el código.
  - El movimiento de recaudación se teclea a mano, así que habría dos registros del mismo descuento.
  - Quitar sueldo como castigo es multa de haber.
- **Decidir:** los motivos; si se reutiliza db/50 sin la autorización; qué es «la nómina de Diana»; si la firma es en papel escaneado o electrónica.

### 7. Pendientes de nómina del día 20 (M)
- **Hay:**
  - las horas no justificadas y las J pendientes que ya calcula /nominas;
  - las bajas por aplicar;
  - el «hábil anterior» al 20, en A2.
- **Falta:** el cron con su idempotencia (A10), una tarea por pendiente para su responsable y **un aviso a Diana por cada uno**.
- **Choca:**
  - No existe «baja validada».
  - Las ventanas no coinciden: mes natural, 26 a 25 y jornada de 05:00 a 05:00.
- **Decidir:** qué es una baja sin validar; qué horas sin justificar y en qué ventana; quién responde de las horas sin justificar. Las cartas y las bajas son de Laura.

### 8. Tareas al cerrar una baja o un despido (L)
- **Hay:**
  - `darDeBaja` y la baja programada (db/191), los dos puntos donde enganchar;
  - el portal y el bot, que ya dejan fuera al que se va;
  - el bloqueo de usuarios;
  - el estado de BOLT, que puede cerrar solo la tarea de Bolt cuando la cuenta pase a desactivada;
  - los cuatro tipos de baja del CHECK de `liquidacion` (db/52, sin escritura).
- **Choca:**
  - El motivo de baja es texto libre.
  - Una suspensión no pasa por `darDeBaja`.
  - **El PIN de Ballenoil está en `conductor.pin_ballenoil` (db/124), sin pantalla desde el 24/09/2026 y sin estado «anulado»:** sin él, la tarea del PIN no puede cerrarse sola.
  - **No hay firma electrónica**, y el portal deja de admitir al trabajador al día siguiente de la baja.
- **Decidir:**
  - la lista cerrada de motivos;
  - qué es «cerrar» en una baja programada: el día que se apunta o la fecha efectiva;
  - qué credenciales se anulan;
  - dónde marca Daiane el PIN anulado;
  - **qué firma electrónica**: simple, con código por email o por el portal, o un proveedor de firma avanzada.

### 9. Historial del conductor (M, en dos partes)
- **Hay:** la ficha 360, con el hueco «Multas y sanciones de tráfico» reservado, y la regla de reincidencia del convenio.
- **Entregas:** las sanciones (y su acumulado) al acabar el 5; las multas (número e importe) con el 10.
- **Choca:** toda la ficha sale con la llave `/plantilla`, sin permiso por bloque; hoy «sanción» en la ficha son los excesos de velocidad (no entran: el ítem habla de las sanciones del 5 y las multas del 10).
- **Decidir:** quién lo ve; si el acumulado es de siempre o por ventana.

## Fase 2 — Administración

### 10. Multas (L) y 11. Sugerencia de conductor (M)
- **Hay:**
  - tres formas de «matrícula + hora → conductor»:
    - Sanciones: BOLT, y resuelve la cuenta prestada.
    - Combustible: BOLT más el bot, pero sin la cuenta prestada.
    - Citas: el cuadrante con `f_cobertura`.
  - el lector IMAP de combustible (no baja adjuntos).
- **Falta:**
  - la tabla de multas;
  - **una sola función que devuelva todos los candidatos con su evidencia**, cruzando el turno asignado y el servicio de Bolt (hoy todas se quedan con uno). Si sale más de uno o ninguno, la multa es **dudosa**;
  - las reglas de plazo hábil (A2 y A3): urgente si quedan menos de 5 días hábiles al subirla, con 24 horas hábiles de respuesta; aviso a 10 días hábiles; identificarla al menos 5 días hábiles antes;
  - la escalada a Angie e Ignacio y el responsable por descarte, con la evidencia guardada.
- **Choca:**
  - db/50 imputa la multa a quien declara la autoridad, después; el ítem pide identificar antes.
  - Dar de baja un coche cierra sus plazas y se pierde su turno pasado: una multa tardía se queda sin candidato.
- **Decidir:** qué es «el titular del coche en ese turno» (el fijo, el planificado o la cuenta de BOLT); qué es «cambio de turno»; cuántos meses atrás; si el bot entra como evidencia extra. Que Daiane las sube a mano lo dice el ítem; leer el buzón sería una mejora que proponer.

### 12. Caja (M)
- **Hay:**
  - recaudación completa, con anulación con motivo;
  - `cuadre()` y `comprobar()` como saldo del ERP;
  - el recibo en pantalla y la caja de Barcelona aparte.
- **Choca:**
  - `usuario_id` es quien apunta, no quien recibió.
  - Cualquiera con la llave puede cobrar.
  - No hay doble firma.
  - «Atesorado» y «disponible» no existen.
- **Decidir:** qué son atesorado y disponible; el comprobante (papel, PDF o portal; WhatsApp cuesta); la diferencia mínima; si entra Barcelona.

### 13. Control de combustible (S)
- **Hay casi todo:** la carga del correo, la tarjeta casada con la persona, BOLT y bot a esa hora, y la distancia y la boya con Mapon.
- **Falta:**
  - las tres reglas del ítem: en servicio en otro lugar, fuera de turno y conductor de baja a la fecha de la carga;
  - el aviso a Ignacio, que es urgente si el conductor está de baja.

  Solo Ballenoil; Petroprix sería una ampliación.
- **Decidir:** el umbral de distancia; si los avisos que no son urgentes se agrupan.

### 14. Documentación de vehículos y Bolt (L)
- **Hay:**
  - `documento` del coche con vigencia y sus tipos (ITV, seguro, permiso, VTC…), con la API pero **sin pantalla**;
  - el planificador, que pinta el coche fuera de cobertura.
- **Falta:** el registro de «subido a Bolt» (quién lo pidió, cuándo), la regla de no marcar subido un caducado, la tarea a Daiane, la de la ITV a 30 días y una sola fuente de la ITV.
- **Choca:**
  - La ITV está en tres sitios con dos umbrales: la ficha del coche y el documento a 30 días, la inspección a 60.
  - **El planificador deja asignar un coche no operativo:** el criterio pide que «no apto» (todo lo que no es apto, con los estados del ítem 21) no se pueda asignar, y eso cambia lo que ya funciona (convención 2).
  - La caducidad no es obligatoria al subir.
  - Los coches siguen activos en Bolt en taller o siniestro: el taller no genera tarea de Bolt.
- **Decidir:** qué documentos van a Bolt; la fuente única de la ITV.

### 15. Reintegros (L)
- **Hay:**
  - el subtipo `REINTEGRO_GASTOS` y su bandeja de Administración;
  - el patrón de importe original, corregido y motivo.
- **Choca:**
  - El conductor pide por el Formulario de Google, así que «sin adjunto no se envía» se configura en Google, no en el ERP.
  - Ninguna nómina tiene sitio para un reintegro.
- **Decidir:** el canal del conductor; si es un suplido para la gestoría; si los de ETT pueden pedirlo; confirmar con Ignacio que ya no hay tope mensual.

## Fase 3 — Flota y taller

### 16. Ticket de taller por fases (L)
- **Hay:**
  - el ticket del área Taller, que llega del Formulario;
  - las citas del taller, con el WhatsApp dos días antes, la llamada de Control y los estados hecha y no presentado;
  - el coche de sustitución en el planificador.
- **Choca:**
  - **El conductor solo abre ticket por el Formulario:** ni el bot ni el portal lo hacen.
  - Un texto editable por WhatsApp solo sale dentro de la ventana de 24 h.
  - No hay grupos de WhatsApp.
- **Decidir:**
  - el canal del conductor;
  - **el stand-by**: la regla dice que «avisa» a William y a tráfico, y el criterio que crea una tarea para William. Se propone tarea para William y aviso a tráfico, a confirmar.

### 17. Mantenimiento programado (M)
- **Hay:** las citas del taller, que entran por el Excel del taller o a mano («Nueva cita»).
- **Falta:**
  - el mínimo de 2 días hábiles (A2 y A3), entre por donde entre;
  - el aviso a Planificación, que avisa al conductor planificado, y a Control, que marca si el coche asistió;
  - la tarea a Óscar si no asistió.
- **Choca:** hoy se aceptan citas para hoy o mañana, y el aviso de dos días es natural y va directo al conductor por WhatsApp. Mantener ese WhatsApp sería un cambio sobre la especificación: hay que proponerlo.

### 20. Recambios (L)
- **Hay:**
  - el inventario del 12/11, con el valor de las existencias (al último precio);
  - la salida a un coche con su coste;
  - las facturas por matrícula;
  - la revisión por km con el odómetro CAN.
- **Falta:**
  - el tipo de imputación (revisión y avería ya son tipos de mantenimiento, de los 12 que hay; faltan «mantenimiento» como imputación y «siniestro»);
  - **un catálogo de modelos** (hoy texto libre);
  - planes por km y por tiempo, y el cron de alarmas con tarea a Óscar;
  - una sola fuente del coste por coche y mes.
- **Choca:**
  - El semáforo cuenta solo lo apuntado a mano (decisión del 12/11).
  - Las facturas a mano no crean mantenimiento.
  - En septiembre, 54 de las 144 unidades de Mapon no daban odómetro CAN; para ellas está el ancla manual. Hay que medir cuántos coches vivos siguen sin CAN y sin ancla: para ellos solo vale la alarma por tiempo.

### 21. Estado de la flota en tiempo real (M)
- **Hay:** el catálogo de estados, el historial con usuario y la puerta única `vigencia`.
- **Choca:**
  - **El historial guarda solo el día:** dos cambios el mismo día pisan el primero.
  - **El día se toma en UTC** (en `vigencia.js` y en la baja del conductor): de 00:00 a 01:00 en invierno, y hasta las 02:00 en verano, apunta el día anterior. Afecta a toda vigencia sin fecha explícita.
  - El ítem dice que lo mantiene el taller y hoy lo cambian también Tráfico y cualquiera con `/vehiculos`: quitarles ese permiso cambia lo que ya funciona.
  - Los coches de Barcelona se dieron de alta en «B» (Baja) para que no entren en el cuadrante de Madrid.
  - «Estado de la flota» ya es una hoja del Excel de Mantenimientos.
- **Decidir:** cómo pasan los estados de hoy a apto, en taller, chapa y pintura y stand-by.

### 19. Seguros (M) y 18. Siniestro (L)
- **Hay:**
  - `vehiculo.aseguradora` y `seguro_caduca`, y el tipo de documento póliza;
  - el estado «Siniestro» del coche;
  - el motivo «Siniestro» en el Call Center;
  - `vehiculo_id` en los mantenimientos, en las líneas de factura y en los movimientos de inventario.
- **Falta:**
  - la póliza con los coches que cubre (una póliza con N coches vale para la de flota y la de un coche);
  - el siniestro con sus campos obligatorios;
  - **el plazo de 5 horas hábiles para abrir el parte** (ya resuelto en A2: el siniestro del sábado empieza a contar el lunes al abrir);
  - la marca de negligencia que crea el expediente de Laura;
  - el vídeo a cargo de Taller (A6);
  - `siniestro_id` en las líneas de factura, los mantenimientos y los movimientos.
- **Choca:**
  - El seguro lo edita cualquiera con `/vehiculos` y avisa a 30 días.
  - No existe «guardia».
- **Decidir:** qué vídeo es y cuánto pesa; quién es la guardia.

## Fase 4 — Medición

### 22. Informe trimestral por persona (XL)
- **Hay datos del Q4 2026 completo:** tickets de todas las áreas, aplicación de ausencias, correcciones de fichaje y apuntes de caja.
- **Hay datos parciales:** el libro de J (completo desde el 30/10), las citas del taller (desde el 08/10) y el estado del coche (sin hora).
- **No hay datos**, porque su módulo no existe: tarjetas, cartas, nómina del 20 y del 25, multas, arqueos, taller por fases, asistencia y estado con hora.
- **Choca:**
  - **El Q4 2026 como línea base solo es posible para los indicadores con datos de hoy.**
  - No hay fichas de puesto en el ERP.
  - Víctor y Daiane entran con buzones de puesto, así que el indicador mediría el buzón.
  - Hay registros que se pisan o se borran en cascada.
- **Decidir:**
  - las fichas de puesto con cada indicador, su fórmula y su meta;
  - el evaluador y la segunda firma de cada persona;
  - una línea base mixta: Q4 2026 donde haya datos y el primer trimestre completo de cada módulo para el resto.

## Lo que vale para todos los ítems

- **Cada módulo nuevo se puede medir:** guarda la fecha límite ya calculada, la fecha de cumplimiento, el responsable con `usuario_id`, el motivo de demora y un enlace por id. Si no, el ítem 22 no tiene de dónde sacar sus indicadores.
- **Los plazos con el calendario y los números con los parámetros:** `services/calendario.js` y `services/parametros.js`, nunca a mano.
- **Toda tabla nueva bajo el libro:** `SELECT auditoria_vigilar('…')` en su migración, y las escrituras firmadas con `libro.conFirma`.
- **Nada se borra:** lo nuevo se anula con motivo y su historia no cae en cascada. Hoy hay 49 `DELETE FROM` en el código y muchas claves `ON DELETE CASCADE`; no se copian.
- **Vocabulario ocupado:** expediente, sanción, `notificacion`, aviso, MBO, meta y «Estado de la flota» ya significan otra cosa. Lo nuevo lleva otros nombres o se aclara en el [[Glosario]].
- **Sedes:** la flota vigilada es Madrid y Barcelona tiene sus tablas. Cada ítem dice si incluye Barcelona.
- **Las reglas de la casa siguen:** nonce de la CSP en cada script, `comprobar-vistas` y `comprobar-capas`, y tareas y avisos como servicios transversales.

## Decisiones pendientes

**De Camilo:**
1. ~~El orden~~: aprobado el 13/11/2026 (falta que lo acepte Ignacio, arriba).
2. ~~Rama y PR por ítem~~: **por ramas desde el 13/11/2026** (Camilo: «Vamos a hacerlo por ramas entonces»). Cada rama terminada se prueba en el servidor de pruebas de Render antes de pasar a `main`.
3. ~~La base de pruebas sintética~~: hecha. **Las pruebas no corren en Render** (allí no hay Docker): se pasan en local antes de subir.
4. Seguridad antes del chat y de los datos sensibles.

**De Ignacio, cuanto antes:**
- **El plan de Slack y quién es su Workspace Owner.** Si es Free, cada día se borra lo que cumple un año. Y si hay canales en los que no está él.
- Los usuarios del ERP de Fernando, Ángel, William, Diana, Mercedes y Óscar, si Angie es externa, y las áreas y los superiores.
- El almacén de ficheros: seguir en Drive con más espacio o cambiar.
- La objeción de la convención 6: #4-bajas-medicas, #6-nominas, #9-rrhh y #16-efectivo abiertos a toda la oficina.
- Que acepte el orden de arriba.
- Las fichas de puesto para el ítem 22.

Ya decidido el 13/11/2026 (Camilo): horario de la oficina de Madrid de lunes a viernes de 09:00 a 18:00; los festivos de Madrid capital, sí; Barcelona, más adelante; los parámetros, con llave propia para Ignacio y el desarrollador.

Lo demás se cierra al empezar cada ítem: es la lista «Decidir» de cada uno.
