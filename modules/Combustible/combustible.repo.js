// ============================================================
// COMBUSTIBLE · LA CAPA DE DATOS
// ============================================================
// Los repostajes que llegan por correo (`repostaje`) y cada pasada por el buzón
// (`repostaje_lectura`), de db/212. Aquí solo hay SQL; qué se guarda y cómo se
// casa lo decide combustible.service.
//
// LAS HORAS. El correo dice la hora de Madrid sin zona («22/10/2026 06:49»), y
// así llega aquí: '2026-10-22T06:49'. Se guarda con
// `($n::timestamp AT TIME ZONE 'Europe/Madrid')`, que la interpreta en Madrid.
// Castearla directa a timestamptz la leería en la zona de la sesión, que en
// producción es UTC: dos horas de más en verano (ver «Trampas conocidas»). Y se
// devuelve ya escrita con to_char, por lo mismo.

const db = require('../../services/db');

const MADRID = `'Europe/Madrid'`;
const LOCAL = col => `to_char(${col} AT TIME ZONE ${MADRID}, 'DD/MM/YYYY HH24:MI')`;
const NOMBRE_FICHA = alias =>
  `COALESCE(NULLIF(btrim(${alias}.nombre_bolt), ''), NULLIF(btrim(${alias}.nombre || ' ' || COALESCE(${alias}.apellidos, '')), ''))`;

// ── LAS PASADAS POR EL BUZÓN ────────────────────────────────────────────────

async function empezarLectura({ origen, usuarioId, buzon, modoPruebas }) {
  const r = await db.consulta(
    `INSERT INTO repostaje_lectura (origen, usuario_id, buzon, modo_pruebas)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [origen, usuarioId || null, buzon || null, !!modoPruebas]);
  return r.rows[0].id;
}

async function cerrarLectura(id, c = {}) {
  await db.consulta(
    `UPDATE repostaje_lectura
        SET terminada_at = now(), buzon = COALESCE($2, buzon), desde = $3,
            vistos = $4, candidatos = $5, ya_estaban = $6, nuevos = $7, no_leidos = $8,
            repetidos = $9, releidos = $10, bolt_mirados = $11, fallos = $12,
            error = $13, detalle = $14, recasados = $15, otros = $16, error_tipo = $17, pass_huella = $18
      WHERE id = $1`,
    [id, c.buzon || null, c.desde || null, c.vistos || 0, c.candidatos || 0, c.yaEstaban || 0, c.nuevos || 0,
     c.noLeidos || 0, c.repetidos || 0, c.releidos || 0, c.boltMirados || 0, c.fallos || 0,
     c.error ? String(c.error).slice(0, 2000) : null, c.detalle ? JSON.stringify(c.detalle) : null,
     c.recasados || 0, c.otros || 0, c.errorTipo || null, c.passHuella || null]);
}

const CAMPOS_LECTURA = `
  l.id, l.origen, l.buzon, to_char(l.desde, 'YYYY-MM-DD') AS desde, l.empezada_at, l.terminada_at,
  ${LOCAL('l.empezada_at')} AS empezada_local,
  l.vistos, l.candidatos, l.ya_estaban, l.nuevos, l.no_leidos, l.repetidos, l.releidos, l.recasados, l.otros,
  l.bolt_mirados, l.fallos, l.modo_pruebas, l.error, l.error_tipo, l.pass_huella, l.detalle,
  NULLIF(btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, '')), '') AS usuario`;

/** La última pasada (buena o mala) y la última que entró al buzón. */
async function ultimaLectura() {
  const [ult, buena] = await Promise.all([
    db.consulta(`SELECT ${CAMPOS_LECTURA} FROM repostaje_lectura l LEFT JOIN usuario u ON u.id = l.usuario_id
                  WHERE l.terminada_at IS NOT NULL ORDER BY l.empezada_at DESC LIMIT 1`),
    db.consulta(`SELECT ${CAMPOS_LECTURA} FROM repostaje_lectura l LEFT JOIN usuario u ON u.id = l.usuario_id
                  WHERE l.terminada_at IS NOT NULL AND l.error IS NULL ORDER BY l.empezada_at DESC LIMIT 1`),
  ]);
  return { ultima: ult.rows[0] || null, ultimaBuena: buena.rows[0] || null };
}

/** Las últimas pasadas, para la pantalla. */
async function lecturas(limite = 20) {
  const r = await db.consulta(
    `SELECT ${CAMPOS_LECTURA} FROM repostaje_lectura l LEFT JOIN usuario u ON u.id = l.usuario_id
      ORDER BY l.empezada_at DESC LIMIT $1`, [Math.min(Number(limite) || 20, 200)]);
  return r.rows;
}

/**
 * Se guardan 30 días de pasadas, y 90 las que fallaron. Son 144 al día: sin
 * esto la tabla crece para siempre por decir «nada nuevo».
 */
async function purgarLecturas() {
  const r = await db.consulta(
    `DELETE FROM repostaje_lectura
      WHERE empezada_at < now() - CASE WHEN error IS NULL THEN interval '30 days' ELSE interval '90 days' END`);
  return r.rowCount;
}

// ── LO YA GUARDADO ──────────────────────────────────────────────────────────

/**
 * Los Message-ID y los UID de lo que ya está guardado y llegó desde `desde`:
 * con eso el adaptador ni se baja los cuerpos de lo que ya se leyó. El candado
 * de verdad son los índices únicos; esto es para no pedir lo que ya se tiene.
 */
async function yaGuardados(desde) {
  const r = await db.consulta(
    `SELECT mensaje_id, buzon_carpeta, buzon_uidvalidity, buzon_uid FROM repostaje
      WHERE recibido_at >= ($1::date - 2)::timestamp AT TIME ZONE ${MADRID}`, [desde]);
  return {
    ids: new Set(r.rows.filter(x => x.mensaje_id).map(x => x.mensaje_id)),
    // Los UID son por carpeta: el 15 de INBOX y el 15 de Spam son dos correos.
    uids: new Set(r.rows.filter(x => x.buzon_uid != null).map(x => claveUid(x.buzon_carpeta, x.buzon_uidvalidity, x.buzon_uid))),
  };
}

/** La clave de un correo sin Message-ID: carpeta, UIDVALIDITY y UID. */
const claveUid = (carpeta, uidValidity, uid) => `${carpeta || 'INBOX'}:${uidValidity == null ? '' : uidValidity}:${uid}`;

/** ¿Hay ya un repostaje «leido» igual: mismo proveedor, coche, hora e importe? */
async function mismoRepostaje({ proveedor, matricula, repostajeAt, importe }) {
  if (!matricula || !repostajeAt || importe == null) return null;
  const r = await db.consulta(
    `SELECT id FROM repostaje
      WHERE estado = 'leido' AND proveedor = $1
        AND matricula_norm = upper(regexp_replace($2, '[^A-Za-z0-9]', '', 'g'))
        AND repostaje_at = ($3::timestamp AT TIME ZONE ${MADRID})
        AND importe = $4
      ORDER BY id LIMIT 1`, [proveedor, matricula, repostajeAt, importe]);
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

const COLUMNAS = [
  'proveedor', 'mensaje_id', 'buzon', 'buzon_carpeta', 'buzon_uidvalidity', 'buzon_uid', 'remitente', 'reenviado_por', 'asunto',
  'recibido_at', 'cuerpo_texto', 'cuerpo_partes', 'remitente_verificado', 'firma_detalle',
  'estado', 'motivo', 'avisos', 'repetido_de', 'lector_version',
  'estacion', 'conductor_texto', 'tarjeta_provisional', 'tarjeta_nota', 'matricula', 'km', 'cargo_at', 'repostaje_at',
  'importe_recarga', 'importe', 'devuelto', 'litros', 'carburante', 'ahorro',
  'vehiculo_id', 'sede', 'conductor_id', 'conductor_cuenta_bolt', 'conductor_como',
];
// Las horas del correo vienen sin zona y se leen en Madrid (cabecera).
const HORA_LOCAL = new Set(['cargo_at', 'repostaje_at']);
const marcador = (col, i) => (HORA_LOCAL.has(col) ? `($${i}::timestamp AT TIME ZONE ${MADRID})` : `$${i}`);
// LAS COLUMNAS NOT NULL CON VALOR POR DEFECTO, con su valor aquí. Un INSERT que
// las nombra con NULL no se lleva el DEFAULT: revienta. Un correo «no_leido» no
// sabe si la tarjeta es provisional, y sin esto no se podía guardar.
const valorDe = (x, c) => (c === 'tarjeta_provisional' ? !!x[c]
  : c === 'lector_version' ? Number(x[c]) || 0
    : c === 'buzon_carpeta' ? x[c] || 'INBOX'
      : c === 'cuerpo_partes' ? (x[c] == null ? null : JSON.stringify(x[c]))
        : (x[c] === undefined ? null : x[c]));

/**
 * Guarda un correo. Nunca lo duplica:
 *   → { id, estado }                         guardado (estado puede pasar a 'repetido')
 *   → { id: null, yaEstaba: true }           ese correo ya estaba (Message-ID o UID)
 *
 * Si es «leido» y el mismo repostaje ya está en otro correo, se guarda como
 * «repetido» apuntando a ese. Se mira antes de insertar y, por si dos pasadas
 * coinciden, también si el índice único lo rechaza.
 */
async function guardar(f) {
  const fila = { ...f };
  if (fila.estado === 'leido') {
    const igual = await mismoRepostaje({ proveedor: fila.proveedor, matricula: fila.matricula,
      repostajeAt: fila.repostaje_at, importe: fila.importe });
    if (igual) { fila.estado = 'repetido'; fila.repetido_de = igual; }
  }
  const insertar = async x => db.consulta(
    `INSERT INTO repostaje (${COLUMNAS.join(', ')})
     VALUES (${COLUMNAS.map((c, i) => marcador(c, i + 1)).join(', ')})
     ON CONFLICT DO NOTHING
     RETURNING id, estado`,
    COLUMNAS.map(c => valorDe(x, c)));

  let r = await insertar(fila);
  if (r.rows[0]) return { id: Number(r.rows[0].id), estado: r.rows[0].estado, repetidoDe: fila.repetido_de || null };

  // No entró: o ese correo ya estaba, o el repostaje se coló entre medias.
  const ya = await db.consulta(
    `SELECT id FROM repostaje
      WHERE ($1::text IS NOT NULL AND mensaje_id = $1)
         OR ($3::bigint IS NOT NULL AND buzon = $2 AND buzon_carpeta = $5
             AND buzon_uidvalidity IS NOT DISTINCT FROM $4 AND buzon_uid = $3)
      LIMIT 1`, [fila.mensaje_id || null, fila.buzon, fila.buzon_uid == null ? null : fila.buzon_uid,
      fila.buzon_uidvalidity == null ? null : fila.buzon_uidvalidity, valorDe(fila, 'buzon_carpeta')]);
  if (ya.rows[0]) return { id: null, yaEstaba: true };
  if (fila.estado === 'leido') {
    const igual = await mismoRepostaje({ proveedor: fila.proveedor, matricula: fila.matricula,
      repostajeAt: fila.repostaje_at, importe: fila.importe });
    if (igual) {
      r = await insertar({ ...fila, estado: 'repetido', repetido_de: igual });
      if (r.rows[0]) return { id: Number(r.rows[0].id), estado: 'repetido', repetidoDe: igual };
    }
  }
  return { id: null, yaEstaba: true };
}

/**
 * Pone lo leído en un correo que estaba «no_leido» (o le apunta la versión del
 * lector que tampoco lo entendió, para no volver a intentarlo con la misma).
 * Con los mismos candados: si el repostaje ya está en otro correo, «repetido».
 */
async function releido(id, f) {
  if (f.estado !== 'leido') {
    await db.consulta(
      `UPDATE repostaje SET lector_version = $2, motivo = $3, actualizado_at = now() WHERE id = $1`,
      [id, f.lector_version, f.motivo]);
    return { estado: 'no_leido' };
  }
  const igual = await mismoRepostaje({ proveedor: f.proveedor, matricula: f.matricula, repostajeAt: f.repostaje_at, importe: f.importe });
  const estado = igual && igual !== Number(id) ? 'repetido' : 'leido';
  const cols = ['estado', 'motivo', 'avisos', 'repetido_de', 'lector_version', 'estacion', 'conductor_texto',
    'tarjeta_provisional', 'tarjeta_nota', 'matricula', 'km', 'cargo_at', 'repostaje_at', 'importe_recarga',
    'importe', 'devuelto', 'litros', 'carburante', 'ahorro', 'vehiculo_id', 'sede', 'conductor_id',
    'conductor_cuenta_bolt', 'conductor_como'];
  const x = { ...f, estado, motivo: null, repetido_de: estado === 'repetido' ? igual : null };
  await db.consulta(
    `UPDATE repostaje SET ${cols.map((c, i) => `${c} = ${marcador(c, i + 2)}`).join(', ')}, actualizado_at = now()
      WHERE id = $1`, [id, ...cols.map(c => valorDe(x, c))]);
  return { estado };
}

/**
 * Los «no_leido» que leyó una versión del lector anterior a la de ahora, con sus
 * partes tal cual llegaron (cuerpo_partes): se releen desde ahí, no desde el
 * texto ya convertido.
 */
async function paraReleer(versiones) {
  const r = await db.consulta(
    `SELECT id, proveedor, asunto, cuerpo_texto, cuerpo_partes, remitente_verificado, firma_detalle
       FROM repostaje
      WHERE estado = 'no_leido'
        AND lector_version < COALESCE(($1::jsonb ->> proveedor)::int, 0)
      ORDER BY recibido_at
      LIMIT 200`, [JSON.stringify(versiones || {})]);
  return r.rows;
}

// ── CON QUÉ CASA EN EL ERP ──────────────────────────────────────────────────

/**
 * Los leídos que quizá casen mejor HOY que cuando se guardaron: sin coche, sin
 * sede o con un coche que BOLT no tenía. Barcelona entra por etapas y un coche
 * se da de alta en Vehículos después de repostar: sin volver a mirarlos, se
 * quedaban en ámbar, sin sede y sin BOLT para siempre. Los de un mes: más atrás
 * ya no se da de alta nada que importe.
 */
async function paraRecasar() {
  const r = await db.consulta(
    `SELECT id, matricula, conductor_texto, vehiculo_id, sede, conductor_id, conductor_cuenta_bolt, conductor_como, bolt_estado
       FROM repostaje
      WHERE estado = 'leido'
        AND (vehiculo_id IS NULL OR sede IS NULL OR bolt_estado = 'sin_coche')
        AND repostaje_at > now() - interval '30 days'
      ORDER BY repostaje_at
      LIMIT 200`);
  return r.rows.map(x => ({ ...x, id: Number(x.id), vehiculo_id: x.vehiculo_id ? Number(x.vehiculo_id) : null,
    conductor_id: x.conductor_id ? Number(x.conductor_id) : null }));
}

/** Pone lo casado de nuevo (coche, sede y persona de la tarjeta). */
async function recasado(id, f) {
  await db.consulta(
    `UPDATE repostaje
        SET vehiculo_id = $2, sede = $3, conductor_id = $4, conductor_cuenta_bolt = $5, conductor_como = $6, actualizado_at = now()
      WHERE id = $1`,
    [id, f.vehiculo_id || null, f.sede || null, f.conductor_id || null, f.conductor_cuenta_bolt || null, f.conductor_como || null]);
}

/**
 * El coche de una matrícula y su sede. La sede la dice Vehículos; si el coche no
 * está dado de alta, la empresa de BOLT que lo tiene (las de otras sedes, o las
 * de Madrid de Flota viva). Si nadie lo conoce, sede NULL.
 */
async function cocheDe(matricula) {
  const r = await db.consulta(
    `WITH m AS (SELECT upper(regexp_replace($1, '[^A-Za-z0-9]', '', 'g')) AS norm),
          v AS (SELECT v.id, v.sede FROM vehiculo v, m WHERE v.matricula_norm = m.norm
                 ORDER BY (v.baja_at IS NULL) DESC, v.id DESC LIMIT 1)
     SELECT (SELECT id FROM v) AS vehiculo_id,
            COALESCE(
              (SELECT sede FROM v),
              (SELECT s.sede FROM sede_bolt_vehiculo s, m WHERE s.matricula = m.norm ORDER BY s.visto_at DESC LIMIT 1),
              (SELECT f.sede FROM fv_vehiculo fv JOIN flota f ON f.company_id = fv.flota_id, m
                WHERE upper(regexp_replace(fv.matricula, '[^A-Za-z0-9]', '', 'g')) = m.norm
                ORDER BY fv.visto_at DESC NULLS LAST LIMIT 1)) AS sede`, [matricula]);
  const x = r.rows[0] || {};
  return { vehiculoId: x.vehiculo_id ? Number(x.vehiculo_id) : null, sede: x.sede || null };
}

/**
 * Las personas con las que puede casar el nombre de una tarjeta: cada ficha con
 * su nombre y con su nombre de BOLT, y cada cuenta de BOLT con el suyo y la sede
 * de su empresa (las de Barcelona no tienen ficha: la persona es la cuenta).
 */
async function candidatosNombre() {
  const r = await db.consulta(
    `SELECT c.id AS conductor_id, NULL::text AS cuenta, btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS nombre, NULL::text AS sede
       FROM conductor c WHERE NOT c.es_centinela
     UNION ALL
     SELECT c.id, NULL, btrim(c.nombre_bolt), NULL
       FROM conductor c WHERE NOT c.es_centinela AND btrim(COALESCE(c.nombre_bolt, '')) <> ''
     UNION ALL
     SELECT ce.conductor_id, ce.externo_id, btrim(ce.externo_nombre), f.sede
       FROM conductor_externo ce
       LEFT JOIN flota f ON f.company_id = ce.bolt_company_id
      WHERE ce.sistema = 'bolt' AND btrim(COALESCE(ce.externo_nombre, '')) <> ''`);
  return r.rows.map(x => ({ conductorId: x.conductor_id ? Number(x.conductor_id) : null, cuentaBolt: x.cuenta, nombre: x.nombre, sede: x.sede }));
}

// ── QUIÉN LO LLEVABA EN BOLT A ESA HORA ─────────────────────────────────────

/**
 * Hasta qué hora llega lo que sabemos de BOLT, por sede. Si un repostaje es
 * posterior, aún no se puede decir quién llevaba el coche —y eso no es lo mismo
 * que no lo llevara nadie—: se queda «pendiente» y se vuelve a mirar.
 *
 * Madrid: el último tramo de Flota viva, o la última señal de uno abierto (el
 * motor la renueva en cada vuelta). Otras sedes: el último apunte o la última
 * pasada buena de su ingesta, lo que sea más tarde: de madrugada pasan horas sin
 * un cambio de estado, y eso no es que la ingesta esté parada.
 */
async function frescuraBolt() {
  const r = await db.consulta(
    `SELECT GREATEST((SELECT max(desde) FROM fv_tramo),
                     (SELECT max(senal_at) FROM fv_tramo WHERE hasta IS NULL)) AS madrid,
            GREATEST((SELECT max(ocurrido_at) FROM sede_bolt_state_log),
                     (SELECT max(empezada_at) FROM ingesta_ejecucion
                       WHERE tarea = 'state_logs_otras_sedes' AND ok)) AS otras`);
  const x = r.rows[0] || {};
  return { madrid: x.madrid || null, otras: x.otras || null };
}

/**
 * MADRID: el último tramo de Flota viva de ese coche, con conductor, que empezó
 * antes del repostaje (como `velocidad.repo.quienConducia`). Si el instante cae
 * DENTRO de un tramo conectado, esa persona estaba en la app con el coche; si
 * no, es la última que lo llevó y `segundos` dice hace cuánto. Un tramo abierto
 * llega hasta su última señal, no hasta el infinito.
 *
 * LOS EMPATES. fv_tramo tiene muchos pares con el mismo `desde`: un tramo de
 * 0 segundos y el siguiente, que empieza en el mismo instante (3.284 en 60 días
 * en la copia local, todos de la misma persona). Con `ORDER BY desde` a secas
 * salía a veces el de 0 s, el instante no caía «dentro» y se decía «lo dejó
 * hace 10 min» de quien seguía conectado —justo en el cambio espera→descanso,
 * que es cuando se para a repostar—. Desempata el que llega más lejos.
 */
async function boltMadrid(id) {
  const r = await db.consulta(
    `WITH rep AS (SELECT matricula_norm, repostaje_at FROM repostaje WHERE id = $1),
          veh AS (SELECT fv.uuid FROM fv_vehiculo fv, rep
                   WHERE upper(regexp_replace(fv.matricula, '[^A-Za-z0-9]', '', 'g')) = rep.matricula_norm
                   ORDER BY fv.visto_at DESC NULLS LAST LIMIT 1)
     SELECT (SELECT uuid FROM veh) AS vehiculo_uuid, rep.repostaje_at,
            t.conductor_uuid, t.situacion, COALESCE(cs.conectado, FALSE) AS conectado,
            (t.desde <= rep.repostaje_at AND COALESCE(t.hasta, t.senal_at, t.desde) >= rep.repostaje_at) AS dentro,
            GREATEST(0, EXTRACT(EPOCH FROM (rep.repostaje_at - COALESCE(t.hasta, t.senal_at, t.desde))))::int AS seg_fin,
            GREATEST(0, EXTRACT(EPOCH FROM (rep.repostaje_at - t.desde)))::int AS seg_inicio,
            ce.conductor_id,
            COALESCE(${NOMBRE_FICHA('c')}, NULLIF(btrim(ce.externo_nombre), ''), fc.nombre) AS nombre
       FROM rep
       LEFT JOIN LATERAL (
         SELECT * FROM fv_tramo t
          WHERE t.vehiculo_uuid = (SELECT uuid FROM veh)
            AND t.conductor_uuid IS NOT NULL
            AND t.desde <= rep.repostaje_at
          ORDER BY t.desde DESC, COALESCE(t.hasta, t.senal_at, t.desde) DESC, t.id DESC LIMIT 1) t ON TRUE
       LEFT JOIN fv_cat_situacion cs ON cs.codigo = t.situacion
       LEFT JOIN conductor_externo ce ON ce.sistema = 'bolt' AND ce.externo_id = t.conductor_uuid
       LEFT JOIN conductor c ON c.id = ce.conductor_id
       LEFT JOIN fv_conductor fc ON fc.uuid = t.conductor_uuid`, [id]);
  const x = r.rows[0];
  if (!x) return null;
  const conectado = !!x.dentro && !!x.conectado;
  return {
    enBolt: !!x.vehiculo_uuid, repostajeAt: x.repostaje_at,
    uuid: x.conductor_uuid || null, conductorId: x.conductor_id ? Number(x.conductor_id) : null,
    nombre: x.nombre || null, situacion: x.situacion || null, conectado,
    segundos: conectado ? 0 : (x.dentro ? Number(x.seg_inicio) || 0 : Number(x.seg_fin) || 0),
  };
}

/**
 * OTRAS SEDES (Barcelona, db/181): sus apuntes de BOLT van aparte. El último
 * apunte de ese coche en las 24 horas antes del repostaje dice quién lo tenía;
 * y lo último que hizo esa persona antes del repostaje, si seguía con él
 * conectada (viaje, espera o descanso, con el catálogo de Madrid) o ya no.
 *
 * «Hace cuánto lo dejó» se cuenta desde su último apunte CON ESTE COCHE: si
 * luego se fue a otro, contar desde su último apunte en cualquiera decía «lo
 * dejó hace 5 min (ya con otro coche)» de quien lo soltó hace 20 horas. Y los
 * empates del mismo segundo (458 en la copia local) se desempatan por el orden
 * en que se apuntaron, para que salga siempre el mismo.
 */
async function boltOtraSede(id) {
  const r = await db.consulta(
    `WITH rep AS (SELECT matricula_norm, repostaje_at, sede FROM repostaje WHERE id = $1),
          veh AS (SELECT array_agg(s.uuid) AS uuids FROM sede_bolt_vehiculo s, rep WHERE s.matricula = rep.matricula_norm),
          ult AS (SELECT l.driver_uuid, l.ocurrido_at FROM sede_bolt_state_log l, rep, veh
                   WHERE l.sede = rep.sede
                     AND l.vehiculo_uuid = ANY (veh.uuids)
                     AND l.ocurrido_at <= rep.repostaje_at
                     AND l.ocurrido_at > rep.repostaje_at - interval '24 hours'
                   ORDER BY l.ocurrido_at DESC, l.id DESC LIMIT 1),
          suyo AS (SELECT l.vehiculo_uuid, l.estado, l.ocurrido_at FROM sede_bolt_state_log l, rep, ult
                    WHERE l.driver_uuid = ult.driver_uuid AND l.ocurrido_at <= rep.repostaje_at
                    ORDER BY l.ocurrido_at DESC, l.id DESC LIMIT 1)
     SELECT veh.uuids, rep.repostaje_at,
            ult.driver_uuid,
            -- Con el array en el FROM: «= ANY ((SELECT …))» lo toma por una
            -- subconsulta de filas y compara un texto con un array entero.
            suyo.vehiculo_uuid = ANY (veh.uuids) AS mismo_coche,
            eb.situacion, COALESCE(cs.conectado, FALSE) AS conectado,
            GREATEST(0, EXTRACT(EPOCH FROM (rep.repostaje_at - suyo.ocurrido_at)))::int AS seg,
            GREATEST(0, EXTRACT(EPOCH FROM (rep.repostaje_at - ult.ocurrido_at)))::int AS seg_coche,
            ce.conductor_id,
            COALESCE(NULLIF(btrim(ce.externo_nombre), ''), ${NOMBRE_FICHA('c')}) AS nombre
       FROM rep
       CROSS JOIN veh
       LEFT JOIN ult ON TRUE
       LEFT JOIN suyo ON TRUE
       LEFT JOIN fv_estado_bolt eb ON eb.estado = suyo.estado
       LEFT JOIN fv_cat_situacion cs ON cs.codigo = eb.situacion
       LEFT JOIN conductor_externo ce ON ce.sistema = 'bolt' AND ce.externo_id = ult.driver_uuid
       LEFT JOIN conductor c ON c.id = ce.conductor_id`, [id]);
  const x = r.rows[0];
  if (!x) return null;
  const conectado = !!x.mismo_coche && !!x.conectado;
  return {
    enBolt: !!(x.uuids && x.uuids.length), repostajeAt: x.repostaje_at,
    uuid: x.driver_uuid || null, conductorId: x.conductor_id ? Number(x.conductor_id) : null,
    nombre: x.nombre || null, situacion: x.mismo_coche ? (x.situacion || null) : 'otro_coche', conectado,
    segundos: conectado ? 0 : Number(x.mismo_coche ? x.seg : x.seg_coche) || 0,
  };
}

/** Apunta quién estaba en BOLT con el coche, y si es quien dice la tarjeta. */
async function ponerBolt(id, b) {
  await db.consulta(
    `UPDATE repostaje
        SET bolt_estado = $2, bolt_conductor_uuid = $3, bolt_conductor_id = $4, bolt_nombre = $5,
            bolt_situacion = $6, bolt_antiguedad_min = $7, coincide = $8, bolt_mirado_at = now(), actualizado_at = now()
      WHERE id = $1`,
    [id, b.estado, b.uuid || null, b.conductorId || null, b.nombre ? String(b.nombre).slice(0, 200) : null,
     b.situacion ? String(b.situacion).slice(0, 20) : null, b.antiguedadMin == null ? null : b.antiguedadMin,
     b.coincide == null ? null : !!b.coincide]);
}

/**
 * Los que esperaron tres días a BOLT y BOLT no llegó: se cierran como
 * «sin_datos». Si no, la pantalla seguiría diciendo «se vuelve a mirar sola» de
 * algo que ya no se mira (paraMirarBolt solo mira tres días atrás). Si a los
 * tres días no hay BOLT, el problema es la ingesta, y eso se ve en su panel.
 */
async function cerrarSinBolt() {
  const r = await db.consulta(
    `UPDATE repostaje
        SET bolt_estado = 'sin_datos', bolt_mirado_at = now(), actualizado_at = now()
      WHERE estado = 'leido' AND (bolt_estado = 'pendiente' OR bolt_estado IS NULL)
        AND repostaje_at <= now() - interval '3 days'`);
  return r.rowCount;
}

/**
 * Los leídos a los que les falta lo de BOLT: los que esperaban a que la ingesta
 * llegara a su hora y los que se quedaron sin mirar por un fallo. Solo los de
 * los tres últimos días (los de antes los cierra cerrarSinBolt).
 */
async function paraMirarBolt() {
  const r = await db.consulta(
    `SELECT id, sede, conductor_id, conductor_cuenta_bolt, conductor_texto, tarjeta_provisional
       FROM repostaje
      WHERE estado = 'leido' AND (bolt_estado = 'pendiente' OR bolt_estado IS NULL)
        AND repostaje_at > now() - interval '3 days'
      ORDER BY repostaje_at
      LIMIT 200`);
  return r.rows.map(x => ({ id: Number(x.id), sede: x.sede, conductorId: x.conductor_id ? Number(x.conductor_id) : null,
    cuentaBolt: x.conductor_cuenta_bolt, conductorTexto: x.conductor_texto, provisional: x.tarjeta_provisional }));
}

// ── LAS GASOLINERAS (db/213) ────────────────────────────────────────────────

/** Las gasolineras de la lista, con las coordenadas como número (o null). */
async function gasolineras() {
  const r = await db.consulta(
    `SELECT id, proveedor, nombre, direccion, provincia, sede, lat::float AS lat, lng::float AS lng, precision, observaciones
       FROM gasolinera ORDER BY proveedor, nombre`);
  return r.rows.map(x => ({ ...x, id: Number(x.id) }));
}

/** Los nombres de estación casados a mano: Map('proveedor|clave' → gasolinera_id). */
async function aliasGasolineras() {
  const r = await db.consulta(`SELECT proveedor, estacion_clave, gasolinera_id FROM gasolinera_alias`);
  return new Map(r.rows.map(x => [`${x.proveedor}|${x.estacion_clave}`, Number(x.gasolinera_id)]));
}

/** Pone (o cambia) el alias de un nombre de estación. */
async function ponerAlias({ proveedor, clave, estacion, gasolineraId, usuarioId }) {
  await db.consulta(
    `INSERT INTO gasolinera_alias (proveedor, estacion_clave, estacion, gasolinera_id, usuario_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (proveedor, estacion_clave) DO UPDATE
       SET gasolinera_id = EXCLUDED.gasolinera_id, estacion = EXCLUDED.estacion,
           usuario_id = EXCLUDED.usuario_id, creado_at = now()`,
    [proveedor, clave, estacion ? String(estacion).slice(0, 160) : null, gasolineraId, usuarioId || null]);
}

/** Quita el alias: esos correos vuelven a casarse por el nombre. */
async function quitarAlias({ proveedor, clave }) {
  await db.consulta(`DELETE FROM gasolinera_alias WHERE proveedor = $1 AND estacion_clave = $2`, [proveedor, clave]);
}

const CAMPOS_CASAR = `id, proveedor, estacion, sede, gasolinera_id, gasolinera_como,
  gps_lat::float AS gps_lat, gps_lng::float AS gps_lng, gps_motivo`;
const filaCasar = x => ({ ...x, id: Number(x.id), gasolinera_id: x.gasolinera_id ? Number(x.gasolinera_id) : null });

/**
 * Los leídos a los que les falta la gasolinera, o que no casaron (ninguna o
 * ambigua) en los últimos 60 días: la lista o los alias pueden haber cambiado.
 *
 * PRIMERO LOS QUE NUNCA SE CASARON, y de los más nuevos a los más viejos. Con
 * el orden del más antiguo y el tope de 500, en cuanto hubiera 500 «ninguna»
 * (los de Petroprix, que no tiene gasolineras cargadas, salen todos así) los
 * recién llegados no entraban nunca: salían «aún sin casar» hasta auditarlos, y
 * «Leer el buzón ahora» tampoco los casaba (revisión del 23/10/2026).
 */
async function paraCasarGasolinera() {
  const r = await db.consulta(
    `SELECT ${CAMPOS_CASAR} FROM repostaje
      WHERE estado = 'leido'
        AND (gasolinera_como IS NULL
             OR (gasolinera_como IN ('ninguna', 'ambiguo') AND repostaje_at > now() - interval '60 days'))
      ORDER BY (gasolinera_como IS NULL) DESC, repostaje_at DESC
      LIMIT 500`);
  return r.rows.map(filaCasar);
}

/** Los leídos de un proveedor (para volver a casarlos cuando cambia un alias). */
async function leidosDelProveedor(proveedor) {
  const r = await db.consulta(
    `SELECT ${CAMPOS_CASAR} FROM repostaje WHERE estado = 'leido' AND proveedor = $1 ORDER BY repostaje_at`, [proveedor]);
  return r.rows.map(filaCasar);
}

/** Apunta con qué gasolinera casó y, si ya se sabía dónde estaba el coche, la distancia nueva. */
async function ponerGasolinera(id, g) {
  await db.consulta(
    `UPDATE repostaje
        SET gasolinera_id = $2, gasolinera_como = $3, gasolinera_candidatas = $4,
            gps_distancia_m = CASE WHEN $5::boolean THEN $6::int ELSE gps_distancia_m END,
            gps_motivo = CASE WHEN $5::boolean THEN $7 ELSE gps_motivo END,
            actualizado_at = now()
      WHERE id = $1`,
    [id, g.gasolineraId || null, g.como, g.candidatas && g.candidatas.length ? g.candidatas : null,
     !!g.conDistancia, g.distancia == null ? null : g.distancia, g.motivo ? String(g.motivo).slice(0, 300) : null]);
}

// ── LA AUDITORÍA CON MAPON (db/213) ─────────────────────────────────────────

// Con lo que ya tenía de una vez anterior (GPS, boya y detalle): si en un
// reintento Mapon no contesta a una de las dos preguntas, esa se queda como
// estaba (combustible.auditoria). Y la hora de llegada del correo, para la
// hora que pasa dos veces el día del cambio de hora.
const CAMPOS_AUDITAR = `
  r.id, r.proveedor, r.estacion, r.sede, r.matricula, r.matricula_norm, r.vehiculo_id, r.litros::float AS litros,
  r.repostaje_at, r.recibido_at, r.gasolinera_id, r.gasolinera_como, r.auditoria_estado, r.auditoria_intentos, r.auditoria_at,
  r.gps_lat::float AS gps_lat, r.gps_lng::float AS gps_lng, r.gps_at, r.gps_hasta, r.gps_fuente, r.gps_direccion,
  r.boya_tipo, r.boya_antes::float AS boya_antes, r.boya_despues::float AS boya_despues, r.boya_salto::float AS boya_salto,
  r.boya_techo::float AS boya_techo, r.boya_corregida, r.boya_litros::float AS boya_litros,
  r.boya_error_pct::float AS boya_error_pct, r.boya_motivo, r.auditoria_detalle`;
const filaAuditar = x => ({ ...x, id: Number(x.id), vehiculo_id: x.vehiculo_id ? Number(x.vehiculo_id) : null,
  gasolinera_id: x.gasolinera_id ? Number(x.gasolinera_id) : null, auditoria_intentos: Number(x.auditoria_intentos) || 0 });

/**
 * Los que toca auditar ahora, del más antiguo al más nuevo:
 *   · los que nunca se miraron, pasado `margenMin` desde el repostaje (que
 *     haya lecturas de después);
 *   · los que se quedaron a medias, cuando ya ha pasado su espera, que crece
 *     con cada intento (`esperasMin[intentos]`, la última se repite).
 */
async function paraAuditar({ margenMin, esperasMin, limite }) {
  const r = await db.consulta(
    `SELECT ${CAMPOS_AUDITAR}
       FROM repostaje r
      WHERE r.estado = 'leido'
        AND r.repostaje_at <= now() - make_interval(mins => $1::int)
        AND (r.auditoria_estado = 'pendiente'
             OR (r.auditoria_estado = 'incompleta'
                 AND r.auditoria_at <= now() - make_interval(mins =>
                       ($2::int[])[LEAST(GREATEST(r.auditoria_intentos, 1), array_length($2::int[], 1))])))
      ORDER BY r.repostaje_at
      LIMIT $3`, [margenMin, esperasMin, limite]);
  return r.rows.map(filaAuditar);
}

/** Uno, para auditarlo a mano desde su ficha. */
async function paraAuditarUno(id) {
  const r = await db.consulta(`SELECT ${CAMPOS_AUDITAR}, r.estado FROM repostaje r WHERE r.id = $1`, [id]);
  return r.rows[0] ? filaAuditar(r.rows[0]) : null;
}

/**
 * La unidad de Mapon del coche, como la resuelve el resto del ERP: el enlace
 * de Vehículos (vehiculo_alias) y, si el coche no está dado de alta, la de Flota
 * viva por su matrícula. → { unitId, como } o null.
 */
async function unidadMapon(vehiculoId, matriculaNorm) {
  const r = await db.consulta(
    `SELECT (SELECT a.externo_id FROM vehiculo_alias a
              WHERE a.vehiculo_id = $1 AND a.sistema = 'mapon' AND a.visto_hasta IS NULL
              ORDER BY a.id DESC LIMIT 1) AS alias,
            (SELECT fv.mapon_unit FROM fv_vehiculo fv
              WHERE upper(regexp_replace(fv.matricula, '[^A-Za-z0-9]', '', 'g')) = $2 AND fv.mapon_unit IS NOT NULL
              ORDER BY fv.visto_at DESC NULLS LAST LIMIT 1) AS flota`, [vehiculoId || null, matriculaNorm || '']);
  const x = r.rows[0] || {};
  if (x.alias) return { unitId: String(x.alias), como: 'vehiculos' };
  if (x.flota) return { unitId: String(x.flota), como: 'flota_viva' };
  return null;
}

/** Guarda lo que dio la auditoría de un repostaje (todo de una vez) y suma el intento. */
async function guardarAuditoria(id, a) {
  const n = v => (v === undefined ? null : v);
  const txt = (v, max) => (v == null ? null : String(v).slice(0, max));
  await db.consulta(
    `UPDATE repostaje SET
        gasolinera_id = $2, gasolinera_como = $3, gasolinera_candidatas = $4,
        gps_lat = $5, gps_lng = $6, gps_at = $7, gps_hasta = $8, gps_fuente = $9, gps_direccion = $10,
        gps_distancia_m = $11, gps_cercana_id = $12, gps_cercana_m = $13, gps_motivo = $14,
        boya_tipo = $15, boya_antes = $16, boya_despues = $17, boya_salto = $18, boya_techo = $19,
        boya_corregida = $20, boya_litros = $21, boya_error_pct = $22, boya_motivo = $23,
        auditoria_estado = $24, auditoria_detalle = $25, auditoria_at = now(),
        auditoria_intentos = auditoria_intentos + 1, actualizado_at = now()
      WHERE id = $1`,
    [id, n(a.gasolineraId), a.gasolineraComo || null, a.candidatas && a.candidatas.length ? a.candidatas : null,
     n(a.gpsLat), n(a.gpsLng), a.gpsAt ? new Date(a.gpsAt) : null, a.gpsHasta ? new Date(a.gpsHasta) : null,
     a.gpsFuente || null, txt(a.gpsDireccion, 300),
     n(a.distancia), n(a.cercanaId), n(a.cercanaM), txt(a.gpsMotivo, 300),
     a.boyaTipo || null, n(a.boyaAntes), n(a.boyaDespues), n(a.boyaSalto), n(a.boyaTecho),
     a.boyaCorregida == null ? null : !!a.boyaCorregida, n(a.boyaLitros), n(a.boyaErrorPct), txt(a.boyaMotivo, 300),
     a.estado, a.detalle ? JSON.stringify(a.detalle) : null]);
}

/**
 * Un repostaje cuya auditoría reventó (la base rechazó lo guardado, un fallo
 * fuera de lo de Mapon): se le suma el intento y queda «incompleta», SIN tocar
 * lo medido, con el error en el detalle. Así entra en las esperas y, si sigue
 * así, en el cierre a «sin datos», y no tapa a los demás para siempre.
 */
async function apuntarFallo(id, mensaje) {
  await db.consulta(
    `UPDATE repostaje SET
        auditoria_intentos = auditoria_intentos + 1, auditoria_at = now(), auditoria_estado = 'incompleta',
        auditoria_detalle = jsonb_set(COALESCE(auditoria_detalle, '{}'::jsonb), '{error}', to_jsonb($2::text)),
        actualizado_at = now()
      WHERE id = $1`, [id, String(mensaje || 'error').slice(0, 500)]);
}

/**
 * Los que se quedaron a medias y ya no van a mejorar: pasados `horas` desde el
 * repostaje y con `minIntentos`, o con `maxIntentos` en cualquier caso, se
 * cierran como «sin_datos» con lo que tuvieran.
 */
async function cerrarAuditoriasSinDatos({ horas, minIntentos, maxIntentos }) {
  const r = await db.consulta(
    `UPDATE repostaje SET auditoria_estado = 'sin_datos', actualizado_at = now()
      WHERE estado = 'leido' AND auditoria_estado = 'incompleta'
        AND ((repostaje_at < now() - make_interval(hours => $1::int) AND auditoria_intentos >= $2)
             OR auditoria_intentos >= $3)`, [horas, minIntentos, maxIntentos]);
  return r.rowCount;
}

// ── LO QUE VE LA PANTALLA ───────────────────────────────────────────────────

const CAMPOS_LISTA = `
  r.id, r.proveedor, r.estado, r.motivo, r.avisos, r.repetido_de,
  to_char(COALESCE(r.repostaje_at, r.recibido_at) AT TIME ZONE ${MADRID}, 'YYYY-MM-DD HH24:MI') AS orden,
  ${LOCAL('COALESCE(r.repostaje_at, r.recibido_at)')} AS cuando,
  to_char(COALESCE(r.repostaje_at, r.recibido_at) AT TIME ZONE ${MADRID}, 'YYYY-MM-DD') AS dia,
  r.estacion, r.conductor_texto, r.tarjeta_provisional, r.tarjeta_nota,
  r.matricula, r.matricula_norm, r.km, r.carburante,
  r.importe::float AS importe, r.importe_recarga::float AS importe_recarga, r.devuelto::float AS devuelto,
  r.litros::float AS litros, r.precio_litro::float AS precio_litro, r.ahorro::float AS ahorro,
  r.sede, r.vehiculo_id, r.conductor_id, r.conductor_cuenta_bolt, r.conductor_como,
  ${NOMBRE_FICHA('c')} AS conductor_ficha,
  r.bolt_estado, r.bolt_nombre, r.bolt_conductor_id, r.bolt_situacion, r.bolt_antiguedad_min, r.coincide,
  r.auditoria_estado, r.auditoria_intentos, ${LOCAL('r.auditoria_at')} AS auditoria_local,
  r.gasolinera_id, r.gasolinera_como, g.nombre AS gasolinera_nombre, g.precision AS gasolinera_precision,
  g.lat::float AS gasolinera_lat, g.lng::float AS gasolinera_lng,
  r.gps_distancia_m, r.gps_fuente, r.gps_motivo, r.gps_cercana_m, gc.nombre AS gps_cercana_nombre,
  r.boya_tipo, r.boya_antes::float AS boya_antes, r.boya_despues::float AS boya_despues, r.boya_salto::float AS boya_salto,
  r.boya_litros::float AS boya_litros, r.boya_corregida, r.boya_techo::float AS boya_techo,
  r.boya_error_pct::float AS boya_error_pct, r.boya_motivo`;
// La gasolinera casada y la más cercana a donde estaba el coche (db/213).
const JOIN_GASOLINERAS = `
       LEFT JOIN gasolinera g  ON g.id = r.gasolinera_id
       LEFT JOIN gasolinera gc ON gc.id = r.gps_cercana_id`;

/** Los repostajes entre dos días (de Madrid), del más reciente al más antiguo. */
async function lista({ desde, hasta }) {
  const r = await db.consulta(
    `SELECT ${CAMPOS_LISTA}
       FROM repostaje r
       LEFT JOIN conductor c ON c.id = r.conductor_id${JOIN_GASOLINERAS}
      WHERE COALESCE(r.repostaje_at, r.recibido_at) >= ($1::date::timestamp AT TIME ZONE ${MADRID})
        AND COALESCE(r.repostaje_at, r.recibido_at) <  (($2::date + 1)::timestamp AT TIME ZONE ${MADRID})
      ORDER BY COALESCE(r.repostaje_at, r.recibido_at) DESC, r.id DESC`, [desde, hasta]);
  return r.rows;
}

/** Un repostaje con todo: el correo, lo casado y quién más lo repite. */
async function ficha(id) {
  const r = await db.consulta(
    `SELECT ${CAMPOS_LISTA},
            r.mensaje_id, r.buzon, r.buzon_carpeta, r.remitente, r.reenviado_por, r.asunto, r.cuerpo_texto, r.lector_version,
            r.remitente_verificado, r.firma_detalle,
            ${LOCAL('r.recibido_at')} AS recibido_local, ${LOCAL('r.cargo_at')} AS cargo_local,
            ${LOCAL('r.repostaje_at')} AS repostaje_local, ${LOCAL('r.bolt_mirado_at')} AS bolt_mirado_local,
            r.bolt_conductor_uuid, r.auditoria_at, r.auditoria_detalle,
            v.matricula AS vehiculo_matricula, v.marca_modelo AS vehiculo_modelo,
            ${NOMBRE_FICHA('cb')} AS bolt_ficha,
            (SELECT json_agg(json_build_object('id', o.id, 'cuando', ${LOCAL('o.recibido_at')}, 'remitente', o.remitente,
                                               'reenviado_por', o.reenviado_por) ORDER BY o.id)
               FROM repostaje o WHERE o.repetido_de = r.id) AS repetidos,
            -- La auditoría con Mapon entera (db/213).
            g.direccion AS gasolinera_direccion, g.observaciones AS gasolinera_observaciones,
            r.gps_lat::float AS gps_lat, r.gps_lng::float AS gps_lng, ${LOCAL('r.gps_at')} AS gps_local,
            to_char(r.gps_hasta AT TIME ZONE ${MADRID}, 'HH24:MI') AS gps_hasta_local, r.gps_direccion,
            gc.lat::float AS gps_cercana_lat, gc.lng::float AS gps_cercana_lng,
            (extract(epoch FROM r.repostaje_at) * 1000)::float AS repostaje_ms,
            (SELECT array_agg(o.nombre ORDER BY o.nombre) FROM gasolinera o
              WHERE o.id = ANY (r.gasolinera_candidatas)) AS gasolinera_candidatas_nombres
       FROM repostaje r
       LEFT JOIN conductor c  ON c.id = r.conductor_id
       LEFT JOIN conductor cb ON cb.id = r.bolt_conductor_id
       LEFT JOIN vehiculo v   ON v.id = r.vehiculo_id${JOIN_GASOLINERAS}
      WHERE r.id = $1`, [id]);
  return r.rows[0] || null;
}

module.exports = {
  empezarLectura, cerrarLectura, ultimaLectura, lecturas, purgarLecturas,
  yaGuardados, claveUid, guardar, releido, paraReleer,
  paraRecasar, recasado, cocheDe, candidatosNombre,
  frescuraBolt, boltMadrid, boltOtraSede, ponerBolt, paraMirarBolt, cerrarSinBolt,
  gasolineras, aliasGasolineras, ponerAlias, quitarAlias, paraCasarGasolinera, leidosDelProveedor, ponerGasolinera,
  paraAuditar, paraAuditarUno, unidadMapon, guardarAuditoria, apuntarFallo, cerrarAuditoriasSinDatos,
  lista, ficha,
  // Gancho de prueba (scripts/comprobar-combustible.js): las NOT NULL con valor por defecto.
  _valorDe: valorDe,
};
