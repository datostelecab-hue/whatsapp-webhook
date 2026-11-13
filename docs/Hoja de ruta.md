---
tags: [plan, hoja-de-ruta]
actualizado: 2026-11-13
estado: en marcha desde el 13/11/2026 — fase A (A1 hecha)
---

# Hoja de ruta

La hoja de ruta de Ignacio («Roadmap del ERP Telecab — Camilo», la versión en PDF con sus respuestas, del 12/11/2026) pide **22 desarrollos en cinco fases**: la base (tablero de tareas, chat y avisos), RR. HH., administración, flota y taller, y la medición (el informe trimestral por persona). Esta nota es **el plan para hacerlos**: en qué orden, qué del ERP ya sirve para cada uno, qué choca y qué falta decidir. Al empezar cada ítem se hace su plan detallado y se espera el visto bueno, como pide el propio documento.

Camilo, 12/11/2026: «hagámoslo por fases, no empecemos por el chat sin un plan de desarrollo primero». Y el 13/11: «Vamos con el plan de una vez».

**Dónde vamos:**

| Pieza | Estado |
|---|---|
| A1. Pruebas | Hecha (13/11/2026): `npm test` y la base sintética. Ver [[Pruebas automáticas]] |
| A2 a A10 | Pendientes |

Sale de un repaso del repositorio entero, ítem por ítem, en solo lectura. Cada afirmación de abajo está comprobada en el código o en su migración.

## Lo que Ignacio cerró en la última versión

- **Todos los ítems están acordados.** Del Word quedaban cinco «a confirmar» (4, 8, 15, 19 y 21).
- **Móvil:** la web adaptada con notificaciones. No se hace app.
- **Las tareas no se asignan libremente** (ítem 1). Nacen de tickets, de tarjetas de los módulos o del chat. Las que necesitan aprobación las aprueba un supervisor (Ángel, William o Ignacio), y el plazo empieza a contar al aprobarlas.
- **Chat** (ítem 2): solo para la oficina. Toda la oficina puede consultar los canales y los mensajes directos son privados. Se guardan los últimos 5 años y se trae de Slack todo el historial que se pueda, con su autor y su fecha.
- **Expedientes de Laura** (ítem 4): doce tipos. Despido en 3 días hábiles desde que llega a su panel, recurso en 2, y el día 25 presenta regularizaciones e indemnizaciones a Diana.
- **Ticket de sanción** (ítem 5): pasa por la aprobación de Ángel, William o Ignacio antes de llegar a Laura. Una suspensión de empleo y sueldo se registra antes del 26.
- **Al cerrar una baja** (ítem 8): Daiane anula las credenciales y el PIN de combustible en 1 día. Desactivar en Telecab y Bolt le toca a Diana (baja voluntaria o no superar el periodo de prueba), a Laura (suspensión o despido) o a Víctor (fin de contrato de ETT). **La baja voluntaria solo se cierra con la firma electrónica del trabajador.**
- **ITV** (ítem 14): es de Daiane, con aviso a 30 días. **Reintegros** (ítem 15): Daiane aprueba o corrige hasta 100 €; se quita el tope mensual. **Pólizas** (ítem 19): aviso a 60 días.
- **Siniestro** (ítem 18): lo registra Control, no se cierra sin el vídeo y todos sus costes se imputan al siniestro y a la matrícula.
- **Recambios** (ítem 20): cada factura se imputa a revisión, mantenimiento, avería o siniestro. Planes preventivos por modelo, por km y por tiempo, con alarma que crea tarea a Óscar.
- **El ítem 21 pasa a ser el estado de la flota en tiempo real**, no un parte diario: lo mantiene el taller y el ticket de taller lo cambia solo.
- **Ítem 22 nuevo:** informe trimestral de indicadores por persona, con el Q4 2026 como línea base.
- Queda abierto un punto: si los 19 canales son todos.

## El orden

1. **Fase A — cimientos.** Las convenciones del documento dan por hechas piezas que el ERP no tiene. Van antes de todo, cada una con su test.
2. **Fase 0 en el orden 1 → 3 → 2.** Ningún ítem depende del chat salvo por los adjuntos, y esos pasan a la fase A. El tablero y los avisos los usan casi todos.
3. **Fases 1, 2 y 3** en el orden del mapa, y dentro de cada una primero lo que ya está medio hecho (13, 11, 17, 20 y 21).
4. **Fase 4 (ítem 22)** al final, con una línea base realista (ver el ítem).

La seguridad pendiente de la revisión de octubre se cierra **antes del chat y de los módulos con datos sensibles** (4, 5, 9, 10 y 12).

## Fase A — Cimientos

| Pieza | Qué hay | Qué falta |
|---|---|---|
| **A1. Pruebas** | 52 comprobadores `scripts/comprobar-*.js`, el candado contra producción y `MODO_PRUEBAS` | `npm test` con `node:test` y **una base de pruebas vacía y sintética** en el mismo Docker, creada con el corredor de migraciones. La base local de hoy es una copia de producción con datos reales, y la convención 11 lo prohíbe. Hace falta un reloj inyectable para probar plazos con fechas fijas |
| **A2. Calendario laboral** | `festivo` (db/197): nacional y Comunidad de Madrid de 2025 y 2026. `f_sumar_dias_laborables` (db/42) salta findes pero no festivos, y nadie la usa | Barcelona, festivos locales si se decide, 2027 en adelante y horario de oficina por sede. **Un solo servicio**: `esHabil`, `sumarDiasHabiles`, `diaHabilAnterior`, `diasHabilesEntre` y `sumarHorasHabiles`. Una pantalla para los festivos. Y una sola fuente del «hoy», que ahora se redefine en 31 ficheros |
| **A3. Parámetros** | Cinco almacenes: `config_app`, `nomina_config`, `visibilidad_config`, `alerta_control_config` y `agreement_parameter` (este con vigencias) | Una tabla de parámetros de negocio con unidad, descripción, módulo y **vigencia con historial** (el modelo de `agreement_parameter`), su servicio con valor por defecto y su pantalla en Configuración. Sembrar los números de la hoja de ruta |
| **A4. Auditoría** | `cambio_campo` (genérica, desde el código) y `justificante_auditoria` (db/228: por disparador e intocable) | Un libro único para lo nuevo **al estilo de db/228**: quién, acción, sobre qué, antes y después, motivo y origen. Debe guardar también las lecturas de avisos. `cambio_campo` no sirve tal cual: no falla si falla y convierte fechas con `toISOString` |
| **A5. Personas y organización** | Rol más llaves por usuario. Solo constan por id Ignacio (1), Víctor (3), Laura (4), Camilo (7) y Daiane (9) | Área y superior de cada usuario, y **responsables por función** con su `usuario.id` (supervisores, multas, caja, ITV, pólizas, taller). Datos sensibles comprobados en el servicio, como hace `aprobarVacaciones`, también para superadmin y desarrollador |
| **A6. Adjuntos** | Cuatro almacenes distintos: `documento` (solo conductor o coche), `ticket.adjuntos` en JSONB, `whatsapp_adjunto` en la base y el adjunto de las facturas. Drive se descarga entero en memoria, sin Range; las subidas van en base64 | **Decidir el almacén** antes del chat: Drive es un Gmail de 15 GB, y 5 años de chat, Slack y vídeos de siniestros no caben. Después, una tabla de adjuntos con cualquier dueño, subida multipart en streaming, descarga con Range y vista previa (PDF en iframe del mismo dominio, imágenes con VisorFoto, vídeo con `<video>`) |
| **A7. Tiempo real** | Nada: se sondea cada 4 s a 2 min | Una ruta SSE fuera de la compresión, con latido cada 25 s, reconexión que pide lo perdido y un cliente común que cae al sondeo. Con una sola instancia basta un bus en memoria; LISTEN/NOTIFY solo si hay más |
| **A8. Notificaciones** | Nada: ni manifest, ni service worker, ni Web Push | Manifest, service worker en `/sw.js` (desde `/assets` no controlaría el ERP), claves VAPID, suscripciones por dispositivo y permiso pedido tras un clic. En iPhone solo funcionan con la web instalada |
| **A9. Contadores del menú** | Tres contadores sueltos: la campana, los cuadros de tickets y la chapa de fichaje. Con el menú contraído solo se ve `#nav-pend-badge` | Un endpoint de recuentos por usuario, una marca por entrada, la suma por grupo y una clase CSS común |
| **A10. Tareas programadas** | ~25 crons en `app.js` con `programar()`, que en pruebas no arrancan | Tabla de ejecuciones y una clave de idempotencia por tarea y periodo: en cada despliegue conviven dos procesos un rato |

Orden dentro de la fase: A1 → A2, A3, A4 y A10 → A5 → A6 → A7, A8 y A9.

## Fase 0 — Base

### 1. Tablero de tareas (L)
- **Hay:** la ticketera, con responsable, `asignado_at`, `resuelto_at` y su historial `ticket_evento`. «Aplicar» un ticket de ausencia hace la acción y cierra solo el ticket: es el precedente de tarea automática. Las aprobaciones de J, −J, fichaje y vacaciones sirven de patrón de datos.
- **Falta:** las tablas `tarea`, colaboradores, comentarios y un libro de eventos intocable. También:
  - el circuito de aprobación por supervisor;
  - el semáforo hábil y el cron de vencimiento;
  - el contrato de cierre automático (cada tipo dice qué lo cumple, y la API rechaza el «Hecha» a mano);
  - enganchar la ticketera en los dos sentidos;
  - Mi tablero con arrastrar y soltar (no hay ninguna pieza de arrastre), Tablero del equipo y la lista con Listado.
- **Choca:**
  - Los tickets no tienen plazo, su prioridad es texto libre y no existe «Bloqueada».
  - La única asignación es «me hago cargo».
  - Las bandejas solo cuentan desde el 24/09/2026.
  - Un circuito de aprobación parecido se quitó en octubre porque «añadía un paso» (db/115 y db/116).
  - La bandeja de RRHH lleva bajas médicas: una tarjeta que copie su texto las enseñaría en el tablero del equipo.
- **Decidir:**
  - qué tickets generan tarjeta y con qué plazo por subtipo;
  - quién es el responsable de la tarjeta de un ticket;
  - qué tarjetas piden aprobación;
  - si las colas de hoy (J, fichaje, vacaciones) pasan a tarjetas;
  - si Mi tablero sustituye a Pendientes y a la campana.

### 3. Avisos entre módulos (M)
- **Hay:** muchos avisos sueltos que se calculan al momento y no se guardan: la campana (reparto por rol con cuatro roles fijos), los cuadros de tickets, la chapa de fichaje, la tarjeta de efectivo y los cumpleaños (su «cerrado» vive en el navegador), las alertas de Control y las incorporaciones. `incorporacion` y `felicitacion` sí guardan quién lo resolvió o lo vio.
- **Falta:**
  - las tablas de aviso y de lecturas por usuario;
  - el servicio `emitir`, `marcarLeido` y `resolver`, declarado transversal en `comprobar-capas`;
  - los contadores (A9);
  - los urgentes por notificación (A8);
  - el primer emisor: la cita de taller avisa a Control.
- **Choca:**
  - Los nombres `notificacion`, `/notificaciones`, `aviso_turnos` y `/avisos/efectivo` ya están ocupados.
  - «Perfil» no existe: hay un rol por usuario y llaves por persona.
  - Las alertas de Control son unas 600-700 al día y ahogarían el contador.
- **Decidir:** qué es «perfil» y quiénes son «todos los perfiles de Control»; si el leído es por persona o por perfil; si los avisos se resuelven solos; qué avisos de hoy pasan al sistema nuevo y cuándo.

### 2. Chat interno (XL, en cuatro entregas)
- **Hay:** el chat de WhatsApp como patrón: mensajes por id, sondeo, cabeceras seguras de adjuntos y formato de texto. La extensión `unaccent` ya instalada, para la búsqueda en español. Los nombres exactos de 14 canales de Slack en la «Traza por Slack» de Control. **No hay ningún acceso a Slack** en el código.
- **Entregas:**
  - **2a:** canales, directos, tiempo real, no leídos, menciones e hilos.
  - **2b:** adjuntos y vista previa, reacciones, editar y anular, fijar y guardar, formato, vista previa de enlaces (protegida contra SSRF) y convertir en tarea.
  - **2c:** búsqueda (tsvector en español con índice GIN, respetando privados y directos), estado y no molestar, y notificaciones.
  - **2d:** gestión de canales y migración de Slack.
- **Choca:**
  - «Toda la oficina consulta los canales» frente a la convención 6: #4-bajas-medicas, #6-nominas, #9-rrhh y #16-efectivo son públicos en la lista.
  - «Borrar mensajes propios» frente a «nada se borra»: será una anulación, y el texto queda en la auditoría.
  - La purga de 180 días de WhatsApp no se puede copiar.
  - Los autores de Slack que no son usuarios del ERP necesitan un sitio aparte: `usuario` exige contraseña y email único.
  - La «Traza por Slack» de Control apunta a canales que dejarán de existir.
- **Slack:** lo que se puede traer depende del plan.
  - **Free:** enseña 90 días y, desde el 26/08/2024, borra sin vuelta atrás lo de más de un año.
  - **Free y Pro:** exportan solo los canales públicos, con enlaces a los ficheros (en Free, solo los de 90 días).
  - **Privados y directos:** solo con Business+ y solicitud aprobada por el Workspace Owner, o con Enterprise.
  - **Ficheros:** hay que bajarlos uno a uno antes de cerrar Slack.
- **Decidir:**
  - el plan de Slack y su Workspace Owner;
  - qué hacer con privados y directos;
  - si los cuatro canales sensibles pasan a privados (lo valida Laura);
  - si «5 años» es un mínimo o un límite;
  - quién crea canales;
  - el almacén (A6).

## Fase 1 — RR. HH.

### 4. Expedientes de Laura (L)
- **Hay:**
  - las situaciones del conductor con sus tramos (vacaciones, permiso, asuntos propios, baja médica, suspendido…);
  - las acciones de Plantilla que el tablero llamaría: cambiar situación y poner el alta médica;
  - la ausencia, que recuerda su ticket;
  - la llave de una sola persona de vacaciones como modelo de «solo Laura, Ignacio y Fernando»;
  - en el esquema y sin uso: `incidencia_economica`, `liquidacion`, `regularizacion` y `disciplinary_rule`.
- **Falta:** el expediente y su catálogo con plazos, y los tipos que no existen: recurso, accidente de trabajo, despido, regularización e indemnización en dinero, sanción y carta.
- **Choca:**
  - «Expediente» y «sanción» ya significan otra cosa en el ERP.
  - Borrar una ausencia la elimina de verdad.
  - Una sola situación por día: pasar a baja médica reemplaza el tramo.
  - «Regularización» es hoy un ajuste de minutos.
- **Decidir:** qué es «ausencia» como expediente; el plazo de los tipos sin número; qué son regularización e indemnización y dónde se aplican; si incluye a la oficina; si se cargan los abiertos de hoy.

### 5. Ticket de sanción (M)
- **Hay:**
  - la situación «suspendido» y el estado de la cuenta de BOLT, que se refresca cada hora;
  - el catálogo de faltas del convenio (art. 39, sin uso).
- **Choca:**
  - **La API de BOLT es de solo lectura:** desactivar en Bolt siempre es manual.
  - `/sanciones` ya es la pantalla de velocidad.
  - El corte del 26 está en el código.
- **Decidir:** la lista cerrada de faltas; si basta un supervisor; el rechazo con motivo; cómo se comunica la sanción y qué cierra el plazo de 5 días.

### 6. Cartas de descuento (L)
- **Hay:**
  - `incidencia_economica` (db/50), que separa la deuda del descuento;
  - el movimiento `nomina` de recaudación;
  - pdf-lib para la carta.
- **Choca:**
  - db/50 exige la autorización de Dirección; el ítem dice que basta la firma.
  - **/nominas no tiene por dónde entrar un descuento.**
  - «Nómina del 25» frente a `DIA_CORTE = 26`.
  - El movimiento de recaudación se teclea a mano, así que habría dos registros del mismo descuento.
  - Quitar sueldo como castigo es multa de haber.
- **Decidir:** los motivos; si se reutiliza db/50 sin la autorización; qué es «la nómina de Diana»; la fecha exacta del corte; si la firma es en papel escaneado o electrónica.

### 7. Pendientes de nómina del día 20 (M)
- **Hay:**
  - las horas no justificadas y las J pendientes que ya calcula /nominas;
  - las bajas por aplicar.
- **Choca:**
  - No existe «baja validada».
  - Las ventanas no coinciden: mes natural, 26→25 y jornada 05→05.
- **Decidir:** qué es una baja sin validar; qué horas sin justificar y en qué ventana; el responsable de cada tipo.

### 8. Tareas al cerrar una baja o un despido (L)
- **Hay:**
  - `darDeBaja` y la baja programada (db/191), los dos puntos donde enganchar;
  - el portal y el bot, que ya dejan fuera al que se va;
  - el bloqueo de usuarios;
  - el estado de BOLT, que puede cerrar solo la tarea de Bolt cuando la cuenta pase a desactivada;
  - el catálogo de tipos de baja en `liquidacion` (db/52, sin uso).
- **Choca:**
  - El motivo de baja es texto libre.
  - Una suspensión no pasa por `darDeBaja`.
  - **El PIN de Ballenoil está en `conductor.pin_ballenoil` (db/124), sin pantalla desde el 24/09/2026 y sin estado «anulado»:** sin él, la tarea del PIN no puede cerrarse sola.
  - **No hay firma electrónica**, y el portal deja de admitir al trabajador al día siguiente de la baja.
- **Decidir:**
  - la lista cerrada de motivos;
  - cuándo nacen las tareas;
  - qué credenciales se anulan;
  - dónde marca Daiane el PIN anulado;
  - **qué firma electrónica**: simple, con código por email o por el portal, o un proveedor de firma avanzada.

### 9. Historial del conductor (M)
- **Hay:** la ficha 360, con el hueco «Multas y sanciones de tráfico» reservado, y la regla de reincidencia del convenio.
- **Choca:** toda la ficha sale con la llave `/plantilla`, sin permiso por bloque; hoy «sanción» en la ficha son los excesos de velocidad.
- **Decidir:** quién lo ve, si cuentan los avisos de velocidad y las −J, y si el acumulado es de siempre o por ventana.

## Fase 2 — Administración

### 13. Control de combustible (S)
- **Hay casi todo:** la carga del correo, la tarjeta casada con la persona, BOLT y bot a esa hora, y la distancia y la boya con Mapon.
- **Falta:** el turno planificado, el conductor de baja a la fecha de la carga y los avisos.
- **Decidir:** qué carga es «rara», si se avisa una por una o en resumen, y si entra Petroprix.

### 10. Multas (L) y 11. Sugerencia de conductor (M)
- **Hay:**
  - tres formas de «matrícula + hora → conductor»:
    - Sanciones: BOLT, y resuelve la cuenta prestada.
    - Combustible: BOLT más el bot, pero sin la cuenta prestada.
    - Citas: el cuadrante con `f_cobertura`.
  - el lector IMAP de combustible (no baja adjuntos).
- **Falta:**
  - la tabla de multas;
  - una sola función que devuelva **todos** los candidatos con su evidencia (hoy todas se quedan con uno);
  - la regla de dudoso;
  - las reglas de plazo hábil.
- **Choca:**
  - db/50 imputa la multa a quien declara la autoridad, después; el ítem pide identificar antes.
  - Dar de baja un coche cierra sus plazas y se pierde su turno pasado: una multa tardía se queda sin candidato.
- **Decidir:** si manda el cuadrante, el bot o BOLT cuando no coinciden; qué es «cambio de turno»; cuántos meses atrás; si las multas se suben a mano o se lee el buzón.

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

### 14. Documentación de vehículos y Bolt (L)
- **Hay:**
  - `documento` del coche con vigencia y sus tipos (ITV, seguro, permiso, VTC…), con la API pero **sin pantalla**;
  - el planificador, que pinta el coche fuera de cobertura.
- **Choca:**
  - La ITV está en tres sitios con tres umbrales.
  - «No apto» no es un estado.
  - El planificador deja asignar un coche no operativo: bloquearlo cambia lo que funciona.
  - La caducidad no es obligatoria al subir.
- **Decidir:** qué documentos van a Bolt; la fuente única de la ITV; qué estados son «no apto»; si el bloqueo es total o con motivo.

### 15. Reintegros (L)
- **Hay:**
  - el subtipo `REINTEGRO_GASTOS` y su bandeja de Administración;
  - el patrón de importe original, corregido y motivo.
- **Choca:**
  - El conductor pide por el Formulario de Google, así que «sin adjunto no se envía» se configura en Google, no en el ERP.
  - Ninguna nómina tiene sitio para un reintegro.
- **Decidir:** el canal del conductor; si es un suplido para la gestoría; si los de ETT pueden pedirlo.

## Fase 3 — Flota y taller

### 20. Recambios (L)
- **Hay:**
  - el inventario del 12/11 con el valor de las existencias (al último precio);
  - la salida a un coche con su coste;
  - las facturas por matrícula;
  - la revisión por km con el odómetro CAN.
- **Falta:**
  - los cuatro tipos de imputación (no casan con las 12 categorías de pieza y no hay «siniestro»);
  - **un catálogo de modelos** (hoy texto libre);
  - planes por km y por tiempo;
  - el cron de alarmas;
  - una sola fuente del coste.
- **Choca:**
  - El semáforo cuenta solo lo apuntado a mano (decisión del 12/11).
  - Las facturas a mano no crean mantenimiento.
  - En septiembre, 54 de 144 coches no tenían odómetro (ni CAN ni ancla): para ellos solo vale la alarma por tiempo.

### 21. Estado de la flota en tiempo real (M)
- **Hay:** el catálogo de estados, el historial con usuario y la puerta única `vigencia`.
- **Choca:**
  - **El historial guarda solo el día:** dos cambios el mismo día pisan el primero.
  - La fecha se toma con `toISOString`, así que de 00:00 a 02:00 apunta el día anterior.
  - Cambian el estado Tráfico y cualquiera con `/vehiculos`.
  - En Barcelona todos los coches están en «B».
  - «Estado de la flota» ya es una pestaña de Mantenimientos.
- **Decidir:** cómo pasan los estados de hoy a apto, en taller, chapa y pintura y stand-by; quién puede cambiarlos.

### 16. Ticket de taller por fases (L) y 17. Mantenimiento programado (M)
- **Hay:**
  - el ticket del área Taller desde el Formulario;
  - las citas del taller con el WhatsApp dos días antes, la llamada de Control y los estados hecha y no presentado;
  - el coche de sustitución en el planificador.
- **Choca:**
  - **El conductor solo abre ticket por el Formulario**: ni el bot ni el portal lo hacen.
  - Un texto editable por WhatsApp solo sale dentro de la ventana de 24 h.
  - No hay grupos de WhatsApp.
  - Hoy se aceptan citas para hoy o mañana y llegan por el Excel del taller.
  - El aviso de dos días es natural y va directo al conductor, no a Planificación.
- **Decidir:** el canal del conductor; si el Excel también respeta los 2 días hábiles; si el WhatsApp al conductor se mantiene; quién marca asistió.

### 19. Seguros (M) y 18. Siniestro (L)
- **Hay:**
  - `vehiculo.aseguradora` y `seguro_caduca`, y el tipo de documento póliza;
  - el estado «Siniestro» del coche;
  - el motivo «Siniestro» en el Call Center;
  - `vehiculo_id` en mantenimientos, facturas e inventario.
- **Falta:**
  - la póliza con los coches que cubre;
  - el siniestro con sus campos obligatorios;
  - `siniestro_id` en los costes;
  - el vídeo grande (A6).
- **Choca:**
  - El seguro lo edita cualquiera con `/vehiculos` y avisa a 30 días.
  - No existe «guardia» ni horario de oficina.
- **Decidir:** si las pólizas son de flota o por coche; qué vídeo es y cuánto pesa; quién es la guardia.

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
- **Nada se borra:** lo nuevo se anula con motivo y su historia no cae en cascada. Hoy hay 49 `DELETE FROM` en el código y muchas claves `ON DELETE CASCADE`; no se copian.
- **Vocabulario ocupado:** expediente, sanción, `notificacion`, aviso, MBO, meta y «Estado de la flota» ya significan otra cosa. Lo nuevo lleva otros nombres o se aclara en el [[Glosario]].
- **Sedes:** la flota vigilada es Madrid y Barcelona tiene sus tablas. Cada ítem dice si incluye Barcelona.
- **Las reglas de la casa siguen:** nonce de la CSP en cada script, `comprobar-vistas` y `comprobar-capas`, y tareas y avisos como servicios transversales.

## Decisiones pendientes

**De Camilo:**
1. ~~El orden de arriba~~: aprobado el 13/11/2026.
2. Rama y PR por ítem, como pide el documento, o `main`. **Mientras no diga otra cosa, `main`**, como hasta ahora.
3. ~~La base de pruebas sintética~~: hecha. **Las pruebas no corren en Render** (allí no hay Docker): se pasan en local antes de subir.
4. Seguridad antes del chat y de los datos sensibles.
5. «Permisos por rol»: mantener las llaves por usuario y sembrarlas por rol, o pasar a una matriz por rol.

**De Ignacio, cuanto antes:**
- **El plan de Slack y quién es su Workspace Owner.** Si es Free, cada día se borra lo que cumple un año.
- Los usuarios del ERP de Fernando, Ángel, William, Diana, Mercedes y Óscar, si Angie es externa, y las áreas y los superiores.
- El horario de oficina de Madrid y Barcelona, y si entran los festivos locales.
- El almacén de ficheros: seguir en Drive con más espacio o cambiar.
- Si #4-bajas-medicas, #6-nominas, #9-rrhh y #16-efectivo siguen abiertos a toda la oficina.
- Las fichas de puesto para el ítem 22.

Lo demás se cierra al empezar cada ítem: es la lista «Decidir» de cada uno.
