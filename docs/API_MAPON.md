# API de Mapon — referencia para el ERP

> Mapa de https://mapon.com/api (v1) hecho en agosto 2026, orientado a esta flota
> (~144 turismos VTC con GPS Mapon, conductores identificados vía Bolt, no en Mapon).
> Lo que ya usamos vive en `services/mapon.js`: `alert/list.json`, `unit/list.json`
> y `alert/list_setups.json`.

## Generales

- Base: `https://mapon.com/api/v1/` — clave por parámetro `key` (vive en `MAPON_API_KEY`, solo en Render).
- **5 peticiones concurrentes** por cuenta (error 1011). El poller de sanciones ya consume; cualquier barrido de flota debe ir con cola de concurrencia ≤4.
- Fechas siempre **ISO 8601 UTC** (`2026-08-11T12:00:00Z`); Madrid = UTC+1/+2.
- Errores: `{"error":{"code":<int>,"msg":"..."}}`. Códigos ≥1000 globales (1004 = sin clave), 1–999 propios de cada acción.
- Ventana máxima de **31 días** en casi todos los históricos (route/list, alert/list, fuel/*, can_period, informes…).
- Formatos `.json` y `.xml`; métodos GET/POST/DELETE. SDK oficial solo PHP.
- **No hay webhooks genéricos**: el único push es Data Forwarding (abajo).

## Lo que funciona con el GPS que ya tenemos (sin hardware extra)

### Unidades — `unit/*`, `unit_groups/*`
- `unit/list.json`: foto en vivo de toda la flota en UNA llamada (sin paginación): `number` (matrícula), lat/lng, `speed`, `mileage` (¡metros!), `state` (driving/standing/nodata/nogps/service), `last_update`, `fuel_type`. `include=` fuel, fuel_tank, can (odómetro/engine_hours), ignition, supply_voltage, device (IMEI/SIM), relays, ev_values (eléctricos), technical_details. `in_objects` y `saved_values` solo con una única unidad.
- `unit/edit.json`: editar ficha (matrícula, odómetro, `service_till`…). `label` está deprecated: usar make/model.
- `unit_groups/save.json` con `disable_edit=1`: grupos gestionados solo por el ERP.
- **`unit_commands/*` — LA VÍA BUENA para actuar sobre el coche.** Confirmada por soporte de Mapon (correo de Omar Naboulsi a operaciones@msplus.es, 18/08/2026) cuando `unit/change_relay` seguía dando 1006. Son dos métodos:
  - **`unit_commands/get_available.json`** — `GET`, parámetros `key` y `unit_id`. Devuelve **el catálogo de comandos que admite esa unidad**. Los nombres los define cada instalación: **no se adivinan, se preguntan**.
  - **`unit_commands/execute.json`** — `POST`, parámetros `key`, `unit_id` y `command`. El `command` debe ser uno de los que devuelve el método anterior.
  - En el ERP: `mapon.comandosDisponibles(unitId)`, `mapon.ejecutarComando({unitId, command})` y `mapon.ejecutarComandoSeguro(...)`, que valida contra el catálogo antes de mandar nada. Diagnóstico: `/operaciones/fichaje/diagnostico?matricula=XXXX&comandos=1` para ver el catálogo y `&ejecutar=<nombre>` para lanzarlo (no lo hace si el coche está en marcha).
  - 🚨 **PROBADO EN LA FLOTA (18/08/2026) — NO SIRVE PARA EL BLOQUEO DE MOTOR.** Unidad `893954` (9001LWJ, Toyota Corolla) devuelve exactamente: `close_doors`, `open_doors`, `open_trunk`, `hazard_lights`, `open_windows`, `close_windows`. Son órdenes de *connected car* de fábrica (carrocería y confort); **ninguna inmoviliza el vehículo**. Soporte nos mandó aquí, pero el corte de motor NO vive en esta API: vive en el **relé físico**, que solo se maneja con `unit/change_relay` — el que sigue dando 1006. Hay que volver a pedirles permiso para ESE método, nombrándolo explícitamente.
  - 🚨 **Y ADEMÁS NO LLEGAN AL COCHE.** Probado el 18/08/2026 en la unidad `893922` (1194LCK, Hyundai Ioniq, parado): `unit_commands/execute.json` con `open_windows` responde `{"status":"ok"}` y **las ventanillas no se abren**. Ese `ok` es un acuse de recibo de Mapon, no una confirmación de ejecución en el vehículo. Mismo resultado en dos marcas distintas (Toyota y Hyundai), así que no es cosa de un coche. Hipótesis: hace falta que el vehículo tenga activo el servicio conectado del fabricante, que es una suscripción aparte de Mapon. **Conclusión: esta API no sirve para nada operativo hoy.**
  - ⚠️ **Aviso de seguridad:** esta API permite abrir puertas y ventanillas de los coches en remoto. Quien tenga la API key puede hacerlo en toda la flota. Tratarla como una credencial sensible.

- **`unit/change_relay.json` — corte de motor (vía antigua, bloqueada).** `POST`, parámetros: `key`, `unit_id`, `relay_id`, `relay_state` (bool 0/1). **Verificado en la flota (agosto 2026):** los coches SÍ llevan relé — `relay_id: 1`, `type: engine_block`, título "Bloqueo Motor", `enabled: 1`, `inverted: 0`, `control_while_moving: 0`. Semántica comprobada en coche real: **0 = motor libre, 1 = motor bloqueado**.
  - ⚠️ **Requiere permisos especiales que solo concede el soporte de Mapon.** Literal de la doc: *"special access rights are required to use this endpoint. Contact the support team to grant access"*. Sin ellos responde el error **global 1006 "Method not available"** (los errores propios del método son del 1 al 7). No se arregla en los ajustes de la API key.
  - La respuesta `status: ok` **solo confirma que la orden salió**. Para saber si el relé cambió de verdad hay que releer `unit/list.json` con `include=relays` (lo hace `cambiarReleConfirmado`).
  - Error propio 7: *"Can not block engine while vehicle is driving"*.
- ⚠️ **`include` con varios valores va como ARRAY** (`include[]=relays&include[]=ignition`). Separados por comas Mapon los ignora en silencio y devuelve la unidad SIN esos bloques — parece "no tiene relés" cuando en realidad no se pidieron bien.

### Histórico — `unit_data/*`, `route/*`
- `route/list.json`: viajes y paradas por unidad (inicio/fin, km, duración, direcciones). `include=decoded_route,speed` (una unidad) = traza punto a punto lat/lng+hora+velocidad → reconstrucción forense de un trayecto. `include=behaviour_data` = frenazos/acelerones/giros bruscos por ruta.
- `unit_data/ignitions.json`: encendidos/apagados por rango → jornada real, uso fuera de turno.
- `unit_data/can_period.json` / `can_point.json`: series CAN (odómetro, fuel_level, total_fuel, RPM).
- `unit_data/history_point.json`: estado en un instante concreto (km al inicio/fin de turno).
- `unit_data/debug_info.json`: salud de la telemetría (GPS caído, CAN mudo).
- ❌ `drivingtime`/`driving_time_extended`/`nexogen`: requieren **tacógrafo** — no aplica.

### Alertas — `alert/*` (lo que aún no usamos)
- `alert/list.json` admite `include=id,location,address`: **id propio de alerta** (mejor dedupe que unit+hora+tipo) y dirección del exceso.
- `alert/store_setup.json` / `delete_setup.json`: crear/editar setups **por API** (tipo, umbral, horario `days`+`time_hour_from/to`, unidades). Permite: alta automática del setup de velocidad al entrar un coche nuevo, alertas `moving` solo en franjas sin turno, `no_power`/`supply_voltage` anti-manipulación del GPS, `in_object` en geocercas.
- `alert/setup_types.json` / `setup_fields.json`: tipos disponibles según permisos de la clave.
- ❌ `sosbutton`: requiere botón físico.

### Geocercas y tracking — `object/*`, `tracking/*`
- `object/save.json`: crear zonas (cochera, talleres, T1–T4, Atocha/Chamartín, IFEMA) desde el ERP; `object/list.json` con `updated_from` para sincronización incremental.
- `tracking/create.json`: **links de seguimiento en vivo temporales** (from/till) de uno o varios coches — para relevos, grúa, incidencias. `tracking/list.json`+`delete.json` para auditar/revocar. `restrict_routes_period` limita qué histórico se ve.

### Conductores — `driver/*`, `driver_behaviour/*`
- `driver_behaviour/report_units.json`: informe de conducción **por vehículo** (ventana ≤31 días, `per_page` hasta 1000): harsh_braking/acceleration/cornering, speeding (km y tiempo), excessive_idling, nota A–G. Sin conductores en Mapon, el corte por vehículo+turno lo hace el ERP con el planificador.
- `driver/create.json` + `driver/update.json` (param `unit`) + `associate_external_driver.json`: espejo de plantilla y asignación coche-conductor si algún día queremos que Mapon sepa quién conduce.
- ⚠️ Driver Behaviour puede ser add-on del plan: confirmar con Mapon que está activo antes de programar.

### Combustible — `fuel/*`, `fuel_check/*`
- `fuel/summary.json` (repostado, consumido, media), `fuel/changes.json` (subidas = repostajes, caídas bruscas = posibles robos), `fuel/data.json` (serie de nivel). Ventana 31 días.
- ⚠️ **Depende de la fuente de nivel**: sin varillas aforadoras, la fiabilidad la da el CAN del coche; en turismos suele ser suficiente para repostajes, menos fino para robos pequeños.
- `fuel_check/*`: registrar repostajes/tarjetas a mano (conciliación tickets vs depósito).

### Push (lo más interesante a futuro) — `data_forward/*`
- `data_forward/save.json`: Mapon **empuja datos a un endpoint HTTP nuestro** (el webhook de Render), por packs: #1 Position, #3 Ignition, #21 Object Entered/Exited, #22 Behaviour Event, #26 Odometer, #16–18 altas/bajas de vehículos, #27/28 Crash (si el GPS lo soporta).
- Cola por endpoint: TTL **12 h** y máx **100.000** elementos — si nuestro webhook cae más de eso, se pierden packs. Diseñar con reconciliación por polling de respaldo.
- Sustituiría el polling del cron de sanciones (hoy `alert/list` no entra en data_forward: las alertas seguirían por polling, pero posición/ignición/zonas sí irían push).

## Lo que NO aplica a esta flota

- **Tachograph** (DDD, tarjetas): turismos sin tacógrafo.
- **Reefer** (frigoríficos), **BLE tags** (balizas), **Route Planning** (reparto última milla), **Tell Tale** (FMS de camión).
  (**unit_commands**: sí responde para nuestras unidades —no devuelve `[]`, como yo había supuesto—, pero solo con órdenes de carrocería del coche conectado. Para el bloqueo de motor no vale. Ver arriba.)
- **Messaging**: mensajería con la app de Mapon — nuestros conductores no la usan (ya está el bot de WhatsApp).
- **Vehicle Inspections** y **Vehicle PIN Auth**: solo si se contrata/activa el módulo y los conductores usaran la app de Mapon.

## Grupos menores (por completitud)

`company/get.json` (zona horaria/moneda de la cuenta — leerla una vez), `user/*` (usuarios de plataforma), `preset/*` (permisos; determinan qué ve la API key), `company_clients/*`, `menu/list.json`, `tasks/*`, `custom_targets/*`, `customlayers/*` (capas visuales de POIs en el mapa de Mapon).
