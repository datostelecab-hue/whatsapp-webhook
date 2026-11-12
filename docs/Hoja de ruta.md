---
tags: [plan, hoja-de-ruta]
actualizado: 2026-11-12
estado: propuesta, espera el visto bueno de Camilo
---

# Hoja de ruta

La hoja de ruta de Ignacio («Roadmap del ERP Telecab — Camilo», Word del 10/11/2026) pide 21 desarrollos en cuatro fases: tablero de tareas, chat, avisos, RR. HH., administración y flota. Esta nota es **el plan para hacerlos**: en qué orden, qué del ERP ya sirve para cada uno y qué hay que montar antes. Al empezar cada ítem se hace su plan detallado (tablas, servicios y pantallas) y se espera el visto bueno, como pide el propio documento.

Camilo, 12/11/2026: «hagámoslo por fases, no empecemos por el chat sin un plan de desarrollo primero».

## Qué cambia respecto al orden del documento

1. **Antes de la fase 0 va una fase de cimientos (fase A).** Las «Convenciones comunes» del documento dan por hechas piezas que el ERP no tiene: días hábiles, parámetros editables, una auditoría única, áreas y superiores, adjuntos para cualquier cosa, tiempo real, notificaciones y pruebas automáticas. Si se montan dentro del chat, el chat crece el doble y lo demás espera.
2. **El chat va el último de la fase 0, no el segundo.** Ningún ítem depende del chat salvo por el servicio de ficheros (lo usa el 15), y ese pasa a los cimientos. El tablero (1) y los avisos (3) sí los usan casi todos. Así RR. HH. no espera al chat, que es lo más grande de toda la hoja de ruta.
3. **Varios ítems ya están medio hechos** y se quedan en ajustes: 13 (combustible), 20 (el inventario del 12/11), 17 (citas del taller), 11 (la atribución de conductor de sanciones) y 12 (recaudación).

## Fase A — Cimientos

Casi nada visible para el usuario, salvo los parámetros en Configuración. Dos o tres tandas, cada una con su nota.

| Pieza | Qué hay hoy | Qué falta |
|---|---|---|
| **Calendario laboral** | `festivo`, nacional y Madrid (db/240) | Barcelona, el horario de oficina de cada sede y **una sola función** para «sumar N días hábiles», «N horas hábiles» y «¿es hábil?». La usan los ítems 1, 4, 5, 6, 7, 10, 14, 16, 17 y 18 |
| **Parámetros** | `config_app` (clave y valor, con quién y cuándo), `nomina_config`, `agreement_parameter` (convenio, con vigencias) | Una tabla de parámetros de negocio con unidad, descripción, módulo e historial (los 5 días, los 100 €, el día 20…) y su pantalla en Configuración |
| **Auditoría** | Cada módulo la suya (`anulado_por` y motivo, `justificante_auditoria`, `ticket_evento`…) | Un registro único: quién, qué, sobre qué, antes y después, cuándo. Lo viejo se queda como está |
| **Áreas y superiores** | `usuario` con rol y permisos por prefijo; ni área ni jefe | El área de cada usuario y su responsable. Lo piden «avisa a su superior» y «tablero del equipo» (1) y «quién asigna a quién» (2) |
| **Adjuntos** | `documento` (Drive, solo de un conductor o un coche) y los PDF de facturas | Un servicio de adjuntos para cualquier cosa (tarea, mensaje, ticket, multa), con vista previa servida por el ERP y tope de tamaño. Los bytes, en Drive como hasta ahora |
| **Tiempo real** | Nada: se pide y se recarga | **SSE** (no WebSocket: es HTTP normal, pasa por Cloudflare y Render sin cambiar nada) con `LISTEN/NOTIFY` de Postgres, para que valga con más de una instancia. Latido cada 25 s y la ruta fuera de la compresión |
| **Notificaciones** | WhatsApp a conductores; nada para la oficina | Notificación del navegador (Web Push con service worker). En el móvil, la web instalada como app (PWA), salvo que se pida app nativa |
| **Pruebas** | No hay pruebas automáticas ([[Comprobadores]]) | El documento pide un test por criterio de aceptación: `node:test` contra la base de pruebas local ([[Entorno de pruebas local]]) con datos inventados, y un comando que las corra |
| **Seguridad** | Revisión del 30/10 con pendientes | Cerrar lo crítico antes de abrir el chat: por él pasarán bajas médicas y nóminas |

## Fase 0 — Base

### 1. Tablero de tareas (L)
Nuevo. Tarea con un responsable y colaboradores, origen enlazado (mensaje, sistema o a mano), estados Pendiente, En curso, Bloqueada (con motivo) y Hecha, semáforo por días hábiles y reasignar con motivo. **Las automáticas se cierran solas**: cada tipo de tarea dice qué la da por cumplida y nadie la cierra a mano. Pantallas: Mi tablero (columnas y arrastrar), Tablero del equipo, vista de lista y el contador en el menú lateral.

### 3. Avisos entre módulos (M)
Hoy hay avisos sueltos: /alertas de Control, el aviso de efectivo sin entregar, los cumpleaños, las citas del taller, los avisos de turnos. Se monta uno solo: `avisos.emitir({ módulo, para, prioridad, enlace })`, el contador sin leer de cada módulo en el menú lateral, el leído y el resuelto con quién y cuándo, y los urgentes como notificación. Los avisos de hoy se pasan después, uno a uno, sin cambiar lo que hacen.

### 2. Chat interno (XL, en cuatro entregas usables)
- **2a.** Canales públicos y privados, mensajes directos, tiempo real, no leídos, menciones e hilos. Los 19 canales creados con sus miembros.
- **2b.** Adjuntos con vista previa y arrastrar, reacciones, editar y borrar con auditoría, fijar y guardar, formato y vista previa de enlaces. **Convertir en tarea**, con el sello en el mensaje y la respuesta en el hilo al cerrarla.
- **2c.** Búsqueda (texto completo de Postgres en español, sin enseñar nunca un canal privado a quien no es miembro), estado y no molestar, notificaciones en navegador y móvil.
- **2d.** Crear, archivar y renombrar canales, miembros por rol y, si se decide, traer el historial de Slack.

## Fase 1 — RR. HH.

| # | Ítem | Qué hay ya | Notas |
|---|---|---|---|
| 4 | Expedientes de Laura | Justificantes, [[Menos J]], [[Vacaciones]], bajas y [[Sanciones de velocidad]], cada uno en su pantalla | «A confirmar» qué expedientes y columnas. Va primero: el 5 y el 6 crean expedientes |
| 5 | Ticket de sanción de Control | Sanciones de velocidad (Mapon → aviso) y la [[Ticketera]] | Tipo de falta, causa y captura obligatorios; crea el expediente y cuenta 5 días hábiles |
| 6 | Cartas de descuento | [[Administracion]] (descuentos por nómina firmados) e `incidencia_economica` (db/50: DETECTADA → DESCONTADA, sin pantalla) | Leer db/50 antes de crear tablas: ya separa deuda de descuento. Carta en PDF y corte del 25 |
| 7 | Pendientes de nómina del día 20 | [[Nominas]], justificantes (horas presuntas), bajas | Cron el 20 (o el hábil anterior): tareas a cada responsable y aviso a Diana |
| 8 | Tareas al cerrar una baja o un despido | La baja programada de [[Conductores]] (db/191) | Enganchar al cierre. El ERP no sabe si un PIN de Ballenoil está anulado (la pantalla del PIN se quitó): sin esa fuente, esa tarea no puede cerrarse sola |
| 9 | Historial del conductor | La ficha del conductor | Sanciones con el 5; las multas se suman cuando esté el 10 |

## Fase 2 — Administración

| # | Ítem | Qué hay ya | Notas |
|---|---|---|---|
| 13 | Control de combustible | [[Combustible]]: Ballenoil del correo, auditado con Mapon | Casi hecho (S): falta cruzar con turno y servicio, y el conductor de baja → aviso urgente |
| 10 | Multas | `incidencia_economica` ya contempla multas (pendiente de la autoridad) | Alta, plazos hábiles, urgentes, escalado a Angie y evidencia |
| 11 | Sugerencia de conductor | La atribución de las sanciones (tramos de BOLT con su desempate, fichaje y planificador) | Reutilizarla (S–M); dudosa con ninguno o más de un candidato |
| 12 | Caja | Recaudación: presencial, entrega, salidas | Ampliar, no duplicar: quién lo recibió, comprobante, arqueo del lunes con firmas y arqueo mensual |
| 14 | Documentación de vehículos y Bolt | `documento` del coche con caducidad, [[Inspeccion de vehiculos]] con ITV, estados del coche | Tarea a Dayane al subir o renovar; «no apto» no se puede planificar |
| 15 | Reintegros de gasto | Nada | «A confirmar» el tope; entra en nómina como variable |

## Fase 3 — Flota y taller

| # | Ítem | Qué hay ya | Notas |
|---|---|---|---|
| 20 | Aprovisionamiento y recambios | [[Inventario y mantenimientos]] (12/11): existencias, salida a un coche con su coste | Casi hecho (S): falta el valor de las existencias y el coste por coche y mes |
| 21 | Parte diario de flota | Estados del coche (Operativo, En taller, Siniestro…) con historial | Llevar apto, taller, chapa y pintura y stand-by a esos estados; publicar y avisar si no está a la hora |
| 16 | Ticket de taller por fases | Ticketera (área Taller), [[Citas del taller]] | Fases con plazo hábil y motivo de demora. Los conductores no entran al ERP: el ticket les entra por el formulario, el bot o el portal |
| 17 | Mantenimiento programado | Citas del taller (Excel o a mano, WhatsApp dos días antes, llamada en Control) | Mínimo 2 días hábiles; asistió o no asistió → tarea |
| 19 | Seguros | Nada | Pólizas desde la ficha del coche y tarea de renovación |
| 18 | Siniestro | El estado «Siniestro» del coche | 5 horas hábiles desde la apertura de la oficina; negligencia → expediente |

## Lo que tiene que cerrar Ignacio antes de cada fase

- **Antes del ítem 1:** quién puede asignar tareas a quién.
- **Antes del ítem 2:** solo oficina o también conductores; traer el historial de Slack o empezar de cero; si los 19 canales son todos; privacidad de los mensajes directos y cuánto se guardan (lo valida Laura); app o web adaptada en el móvil.
- **Antes de los ítems 4, 8, 15, 19 y 21:** los puntos abiertos de su lista (columnas del tablero de Laura, quién desactiva en Telecab y Bolt, tope de reintegros, días de aviso de una póliza, hora del parte).
