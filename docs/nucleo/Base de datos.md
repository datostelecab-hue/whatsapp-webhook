---
tags: [nucleo, postgresql, esquema, datos]
fecha: 2026-09-17
estado: en producción
---

# Base de datos

Todo el ERP vive en **PostgreSQL** (15 o superior). Las pantallas no llaman a ninguna API para pintarse: leen de aquí, y aquí lo deja la [[Ingesta]].

La cadena de conexión vive **solo** en la variable de entorno `DATABASE_URL`. [[Flota viva]] tiene además la suya, `FLOTA_VIVA_DB_URL`, que puede apuntar a la misma base. El único sitio donde se abre conexión es `services/db.js` (pool de 10, `DB_POOL_MAX`) y `services/flotaViva/db.js` (pool de 8). Ningún controlador importa el pool.

## Tres convenciones que se repiten en todo el esquema

Están escritas en la cabecera de `db/01-nucleo.sql` y explican la mitad de las decisiones raras:

1. **Nada de presentación.** Ni emojis ni símbolos: los códigos son datos y los iconos los pone la interfaz. Por eso el estado operativo de un coche es `'O'` y no un visto bueno.
2. **Los historiales cierran con `NULL`**, no con un centinela `'9999-12-31'`. La fila abierta se protege con un **índice parcial** (`... WHERE hasta IS NULL`), que sí garantiza que solo haya una. En MySQL había que inventarse la fecha centinela porque un `UNIQUE` con NULL no restringe nada; aquí no hace falta.
3. **El nombre nunca es clave.** Cada persona y cada coche tienen id propio, y los *alias* guardan con qué identificador los conoce cada sistema externo. Cruzar por nombre es lo que fallaba en producción.

## Las familias de tablas

Los `db/*.sql` crean **142 tablas**. No hace falta conocerlas todas: van por familias.

### Núcleo de personas y vehículos — `db/01-nucleo.sql`

Las identidades que todo lo demás referencia.

- Personas: `conductor`, `conductor_periodo_empleo`, `conductor_alias`, `conductor_telefono`, `conductor_externo`.
- Coches: `vehiculo`, `vehiculo_estado_hist`, `vehiculo_base_hist`, `vehiculo_alias`.
- Acceso: `usuario`, `usuario_acceso_log`, `rol`, `rol_modulo`, `cat_modulo` — más `usuario_permiso`, que llegó después en `db/65-usuarios-permisos.sql`.
- Catálogos: `flota` (el `company_id` de [[BOLT]]), `base_zona`, `cat_estado_vehiculo`.

Las dos tablas que hacen el trabajo sucio:

- **`conductor_alias`** — con qué nombre conoce a esta persona cada sistema (`bolt_nombre`, `ss_nombre`, `libranzas`, `mapon_nombre`, `vista_final`, `manual`). Un índice único parcial (`uq_alias_resoluble`) obliga a que un alias **no ambiguo** apunte a una sola persona: eso es lo que hace fiable el cruce. Se compara siempre por `alias_norm` (sin tildes, minúsculas, palabras ordenadas), porque PostgreSQL distingue mayúsculas.
- **`conductor_telefono`** — con `sufijo9` generado (los últimos 9 dígitos) y un único vigente por número: si no, el bot no sabe quién llama.

### Planificación — `db/03-planificacion.sql`

`turno`, `turno_version`, `turno_dia_operativo`, `conductor_turno_hist`, `cat_slot`, `plaza`, `asignacion`, `asignacion_dia`, `patron_libranza` (+ `_dia`), `cat_marca_dia`, `justificante`, `bitacora_dia`. Más tarde se suman `cuadrante`, `vacante` (+ `_plaza`, `_plaza_dia`), `libranza_excepcional`, `plan_relevo`, `evento_operativo`.

### Ausencias — `db/05-ausencias.sql`

`cat_estado_conductor` y `conductor_estado_hist`, con la vista **`v_conductor_hoy`**. La baja no es una situación más: tiene su propia migración (`db/24-baja-no-es-situacion.sql`).

### Lo que viene de fuera: `bolt_*`, `mapon_*`, staging

- `ingesta_descarga` — el JSON **crudo** de cada descarga, para poder auditar o reprocesar.
- `bolt_state_log` (`db/37`) — los cambios de estado. Es la fuente de la jornada.
- `bolt_order` (`db/38`) — las órdenes, con la vista `v_ordenes_conductor`.
- `mapon_zona_evento` (`db/41`) — entradas y salidas de zona.
- `mapon_alerta` (`db/87`) — velocidad, alimentación, batería.
- `ingesta_ejecucion` (`db/12`) + la vista `v_ingesta_estado` — cuándo corrió cada tarea, cuánto tardó y si falló.

### `fv_*` — Flota viva

**No están en `db/`.** Las crea `services/flotaViva/esquema.sql`, que aplica el propio módulo con `db.preparar()` la primera vez que alguien lee o escribe. Nacieron en otra rama y por eso viven aparte; el prefijo `fv_` garantiza que no pisen nada.

`fv_matricula`, `fv_vehiculo`, `fv_conductor`, `fv_cat_situacion`, `fv_estado_bolt`, `fv_tramo`, `fv_vuelta`, `fv_franja`, `fv_corte`, `fv_cat_incidencia`, `fv_incidencia`, `fv_cat_gestion`, `fv_seguimiento`, `fv_ruta`, `fv_odometro`, y la vista **`fv_ahora`**, que es lo que pinta el panel *En directo* de [[Control]]. Ver [[Flota viva]].

### Auditoría

Dos cosas distintas con el mismo nombre:

- **Auditoría de cambios** (`db/09-auditoria.sql`): `cambio_campo`, más las vistas `v_asignacion_dias` y `v_conductor_doble_plaza`.
- **Auditoría de flota** (`db/84-auditoria-flota.sql`): `auditoria_km`, `auditoria_km_conductor`, `auditoria_repostaje`, `auditoria_dia`. Desde `db/137-auditoria-fuente-km.sql` cada fila dice **con qué vara se midió** (`can` o `gps`); las filas viejas quedan en `NULL` a propósito, porque se calcularon antes de que hubiera odómetro y ponerles `gps` sería inventar. Ver [[Km por odometro CAN]].

### `bi_*` — la capa semántica

`db/61-bi.sql` y `db/62-bi-zona-km.sql`. Son **vistas**, no copias: `bi_dim_fecha`, `bi_dim_conductor`, `bi_dim_vehiculo`, `bi_plantilla_dia`, `bi_conductor_mes`, `bi_vehiculo_dia`, `bi_kpi_mes`, `bi_funnel_candidaturas`, `bi_hecho_incidencias`, `bi_hecho_bitacora`.

Tres son **materializadas** (con índice único, para poder refrescarlas en concurrente): `bi_hecho_horas_dia`, `bi_hecho_ingresos_dia`, `bi_hecho_km_dia`. Más `bi_meta`, que es la única tabla de verdad de la familia.

### El resto, por módulo

Convenio y nómina (`collective_agreement`, `salary_table_row`, `contrato`, `nomina_mes`, `nomina_fila`, `variable_nomina`, `liquidacion`), selección (`candidatura`, `solicitud_ett`, `incorporacion`), taller (`mantenimiento`, `factura_taller`, `odometro_ancla`), ticketera (`ticket`, `ticket_evento`, `ticket_routing`), control (`alerta_control` y sus tres satélites, `llamada_alerta`, `llamada_cc`), fichaje (`fichaje`, `fichaje_correccion`, `fichaje_turno`, `puerta_comando`), recaudación, documentos y bitácora (`bitacora_horas`, `bitacora_sello`).

## Cómo mirar el esquema

Tres formas, de menos a más:

1. **`/explorador`** — un phpMyAdmin de andar por casa, porque Render no trae ninguno (`services/explorador.js`). Leer corre dentro de una transacción marcada `READ ONLY` **por la propia base**: un `DELETE` o un `DROP` escritos ahí no fallan porque un filtro los pille, fallan porque PostgreSQL se niega. Escribir es otra función, que ejecuta, cuenta las filas afectadas y **deshace** antes de preguntar — un `DELETE` sin `WHERE` se delata solo. Hay `statement_timeout` (`EXPLORADOR_TIMEOUT`, 10 s) y tope de 500 filas.
2. **`/migraciones` → «inventario»** — `inventario()` en `services/migraciones.js`: cada tabla con sus columnas, sus índices y su tamaño (`pg_total_relation_size`), más el total de claves foráneas, comprobaciones e índices únicos parciales. Es la radiografía con la que se comprueba una migración.
3. **Los propios `.sql`** — todos llevan cabecera explicando el porqué y `COMMENT ON` en lo que no es obvio. `grep -n "CREATE TABLE" db/*.sql` es más rápido que cualquier pantalla.

Las dos pantallas están detrás de `requiereDesarrollador`.

## Lo que pesa

Tres cosas, y solo tres, mueven la aguja:

| Qué | Cuánto | Qué se hace |
|---|---|---|
| `ingesta_descarga.payload` (el JSON crudo) | **~90–250 MB/día** | se vacía a diario a las 00:00 con `purgar_descargas(INGESTA_CRUDO_DIAS)`, 1 día por defecto, más un `VACUUM` normal |
| `fv_odometro` | **~9 MB/día ≈ 3 GB/año**, ya por encima de **1,3 millones de tramos** | no se borra nada: se amplía el disco cuando toque |
| `fv_tramo` | ~3.300 filas por coche; unas 50.000 en catorce días | no se poda; las consultas van acotadas |

El crudo pesa porque las ventanas **se solapan a propósito** (estados cada 10 min pidiendo 2 h, órdenes cada hora pidiendo 48 h) y el mismo dato se re-guarda docenas de veces. Nadie re-lee ese JSON —la maduración de una orden se **re-descarga** de BOLT— así que vaciarlo pronto es seguro. El dato bueno (`bolt_state_log`, `bolt_order`, `mapon_zona_evento`, `fv_*`) no se toca: son tablas aparte e idempotentes.

`ingesta_ejecucion` es metadato ligero: 7 días, 28 los fallos.

El tamaño de `fv_odometro` es también la razón de que sus consultas lleven cotas fijas sobre la fecha. Sin ese recorte, PostgreSQL materializa la ventana, deja de saber qué fechas lleva y **lee la tabla entera en cada pregunta**: *En directo* pasó de segundos a medio minuto.

Ver también: [[Migraciones]], [[Ingesta]], [[Flota viva]], [[Reglas de la casa]], [[Glosario]].
