// ============================================================
// PRÓXIMAS INCORPORACIONES — lo que se lee de la base (15/10/2026)
// ============================================================
// Quién entra a trabajar mañana (o en los próximos días): gente NUEVA y gente
// que vuelve de VACACIONES. Aquí solo se lee; quién es qué lo decide
// `incorporaciones.service.clasificar`, que es pura y se prueba sin base.
//
// QUIÉN CUBRE QUÉ un día es SIEMPRE f_cobertura, la regla del planificador: si
// esta pantalla lo contara por su cuenta, el día que cambie una de las dos
// Control llamaría a alguien para un coche que el planificador ya le ha quitado.

const db = require('../../services/db');

/**
 * Los contratos que empezaron entre `desde` y `hasta` y siguen vivos ese último
 * día. `baja_anterior` es la del contrato anterior, si lo hubo: si acaba la
 * víspera del alta es un paso de la ETT a propia, y eso no es entrar.
 */
async function altas(desde, hasta) {
  const r = await db.consulta(
    `SELECT p.conductor_id::text AS id, p.tipo, p.ett_nombre, p.jornada_horas,
            to_char(p.alta, 'YYYY-MM-DD') AS alta,
            (SELECT to_char(max(q.baja), 'YYYY-MM-DD') FROM conductor_periodo_empleo q
              WHERE q.conductor_id = p.conductor_id AND q.id <> p.id
                AND q.baja IS NOT NULL AND q.baja < p.alta) AS baja_anterior
       FROM conductor_periodo_empleo p
       JOIN conductor c ON c.id = p.conductor_id AND NOT c.es_centinela
      WHERE p.alta BETWEEN $1::date AND $2::date
        AND (p.baja IS NULL OR p.baja >= $2::date)`, [desde, hasta]);
  return r.rows;
}

/** Las vacaciones que acaban entre `desde` y `hasta`, de quien sigue de alta. */
async function vacaciones(desde, hasta) {
  const r = await db.consulta(
    `SELECT h.conductor_id::text AS id,
            to_char(h.desde, 'YYYY-MM-DD') AS desde, to_char(h.hasta, 'YYYY-MM-DD') AS hasta
       FROM conductor_estado_hist h
       JOIN conductor c ON c.id = h.conductor_id AND NOT c.es_centinela
      WHERE h.estado = 'vacaciones' AND h.hasta BETWEEN $1::date AND $2::date
        AND EXISTS (SELECT 1 FROM conductor_periodo_empleo p
                     WHERE p.conductor_id = h.conductor_id AND (p.baja IS NULL OR p.baja > h.hasta))`,
    [desde, hasta]);
  return r.rows;
}

/** Quién cubre qué cada día, de esas personas: f_cobertura, como el planificador. */
async function cobertura(ids, desde, hasta) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT to_char(f.dia, 'YYYY-MM-DD') AS dia, f.conductor_id::text AS id,
            v.matricula, f.rol, f.orden_ct, t.etiqueta AS turno
       FROM f_cobertura($2::date, $3::date) f
       JOIN vehiculo v ON v.id = f.vehiculo_id
       LEFT JOIN turno t ON t.id = f.turno_id
      WHERE f.conductor_id = ANY($1::bigint[])
      ORDER BY f.dia, v.matricula`, [ids, desde, hasta]);
  return r.rows;
}

/** Sus plazas en el planificador (con el coche), vivas o pasadas. */
async function asignaciones(ids) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT a.conductor_id::text AS id, to_char(a.desde, 'YYYY-MM-DD') AS desde,
            to_char(a.hasta, 'YYYY-MM-DD') AS hasta, v.matricula
       FROM asignacion a
       JOIN plaza p ON p.id = a.plaza_id
       JOIN vehiculo v ON v.id = p.vehiculo_id
      WHERE a.conductor_id = ANY($1::bigint[]) AND a.retirada_at IS NULL`, [ids]);
  return r.rows;
}

/** Cualquier ausencia (vacaciones, baja, permiso, suspensión…) que toque la ventana. */
async function ausencias(ids, desde, hasta) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT h.conductor_id::text AS id, h.estado,
            to_char(h.desde, 'YYYY-MM-DD') AS desde, to_char(h.hasta, 'YYYY-MM-DD') AS hasta
       FROM conductor_estado_hist h
       JOIN cat_estado_conductor ce ON ce.codigo = h.estado
      WHERE h.conductor_id = ANY($1::bigint[]) AND ce.es_ausencia
        AND h.desde <= $3::date AND (h.hasta IS NULL OR h.hasta >= $2::date)`, [ids, desde, hasta]);
  return r.rows;
}

/**
 * Lo que hace falta para llamarle: nombre, teléfono, su jornada de la ficha,
 * si tiene cuenta de BOLT y si la ventana de WhatsApp está abierta (escribió en
 * las últimas 24 h: se le puede contestar con texto sin plantilla).
 */
async function personas(ids) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT c.id::text AS id,
            COALESCE(NULLIF(btrim(c.nombre_bolt), ''), btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre,
            c.nombre AS nombre_ficha, c.apellidos, c.nombre_bolt, c.barrio,
            t.e164 AS telefono,
            (SELECT count(*)::int FROM conductor_externo ce
              WHERE ce.conductor_id = c.id AND ce.sistema = 'bolt') AS cuentas_bolt,
            (SELECT max(w.ultima_entrante_at) FROM whatsapp_chat w
              WHERE t.sufijo9 IS NOT NULL AND right(w.telefono, 9) = t.sufijo9) AS ultima_entrante_at,
            (SELECT tu.etiqueta FROM conductor_turno_hist th JOIN turno tu ON tu.id = th.turno_id
              WHERE th.conductor_id = c.id ORDER BY th.desde DESC LIMIT 1) AS jornada
       FROM conductor c
       LEFT JOIN LATERAL (
         SELECT e164, sufijo9 FROM conductor_telefono
          WHERE conductor_id = c.id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id DESC LIMIT 1) t ON TRUE
      WHERE c.id = ANY($1::bigint[])`, [ids]);
  return r.rows;
}

/** Las llamadas de incorporación desde `desde`, lo último primero. */
async function llamadas(ids, desde, prefijo) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT l.conductor_id::text AS id, l.resultado, l.nota,
            to_char(l.creado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM HH24:MI') AS cuando,
            NULLIF(btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, '')), '') AS quien
       FROM llamada_seguimiento l
       LEFT JOIN usuario u ON u.id = l.usuario_id
      WHERE l.conductor_id = ANY($1::bigint[]) AND l.creado_at >= $2::date
        AND l.resultado LIKE $3
      ORDER BY l.creado_at DESC`, [ids, desde, prefijo + '%']);
  return r.rows;
}

/** El último aviso de turnos por WhatsApp desde `desde` (de aquí o del planificador). */
async function avisosDeTurnos(ids, desde) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT DISTINCT ON (conductor_id) conductor_id::text AS id, resultado, detalle, usuario,
            to_char(enviado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM HH24:MI') AS cuando
       FROM aviso_turnos
      WHERE conductor_id = ANY($1::bigint[]) AND enviado_at >= $2::date
      ORDER BY conductor_id, enviado_at DESC`, [ids, desde]);
  return r.rows;
}

module.exports = { altas, vacaciones, cobertura, asignaciones, ausencias, personas, llamadas, avisosDeTurnos };
