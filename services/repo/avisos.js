// ============================================================
// AVISOS DE TURNOS — el registro de a quién se le mandó el WhatsApp y qué
// ============================================================
// Tres preguntas, tres funciones:
//
//   · huellas()      → qué turnos tiene AHORA cada persona esa semana (la
//                      "huella": día+turno+matrícula, serializado). Se guarda
//                      con cada envío y se recalcula para el semáforo.
//   · registrar()    → apunta un envío (quién, a quién, cuadrante, resultado).
//   · estadoSemana() → por persona: veces avisada, último aviso y si su
//                      cuadrante CAMBIÓ desde entonces (huella actual ≠ avisada).
//   · informeDia()   → el informe diario: cuántas personas, cuántos envíos,
//                      por usuario y el detalle con el numerador por persona.
//
// El estado del CUADRANTE (verde/rojo/gris) lo compone la pantalla del
// planificador con esto: ella sabe qué personas tiene cada cuadrante delante.

const db = require('../db');
const plani = require('./planificador');

/**
 * La huella de la semana de cada conductor: sus tramos (día 1-7, turno, coche)
 * ordenados y serializados. Si CUALQUIER cosa de sus turnos cambia —otro día,
 * otro turno, otra matrícula, ya no sale— la huella cambia, y eso es
 * exactamente "el cuadrante cambió: toca volver a avisar".
 *
 * @returns {{ lunes: string, porConductor: Map<string,string> }}
 */
async function huellas({ dia }) {
  const tab = await plani.tablero({ dia });
  const tramos = new Map();   // id -> ['1D:1234ABC', ...]
  (tab.coches || []).forEach(c => (c.semana || []).forEach((celda, i) => {
    if (!celda || !celda.id) return;
    const id = String(celda.id);
    if (!tramos.has(id)) tramos.set(id, []);
    tramos.get(id).push(`${Math.floor(i / 2) + 1}${i % 2 ? 'N' : 'D'}:${c.matricula || ''}`);
  }));
  const porConductor = new Map();
  for (const [id, lista] of tramos.entries()) porConductor.set(id, lista.sort().join('|'));
  return { lunes: (tab.fechas || [])[0] || plani.lunesDe(dia), porConductor };
}

/** Apunta UN envío (también los fallidos: el informe cuenta lo que pasó). */
async function registrar({ usuarioId, usuario, conductorId, telefono, cuadrante,
                           origen, semanaLunes, huella, resultado, detalle }) {
  await db.consulta(
    `INSERT INTO aviso_turnos
       (usuario_id, usuario, conductor_id, telefono, cuadrante, origen,
        semana_lunes, huella, resultado, detalle)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10)`,
    [usuarioId || null, usuario || null, conductorId, telefono || null,
     cuadrante || null, origen === 'planificador' ? 'planificador' : 'cobertura',
     semanaLunes, String(huella || '').slice(0, 600),
     ['ok', 'error', 'sin-telefono'].includes(resultado) ? resultado : 'ok',
     detalle ? String(detalle).slice(0, 300) : null]);
}

/**
 * El estado de los avisos de UNA semana, por conductor:
 *   { id: { veces, ultimoAt, ultimoPor, avisado, cambiado } }
 * `cambiado` = su huella ACTUAL no es la del último aviso que le llegó (ok).
 * Con esto la pantalla pinta el cuadrante: nadie avisado → gris; todos los
 * que salen avisados y sin cambios → verde; lo demás → rojo.
 */
async function estadoSemana({ dia }) {
  const { lunes, porConductor } = await huellas({ dia });
  const r = await db.consulta(
    `SELECT DISTINCT ON (conductor_id)
            conductor_id, huella, usuario,
            to_char(enviado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM HH24:MI') AS cuando,
            extract(epoch FROM enviado_at)::bigint AS ts,
            count(*) OVER (PARTITION BY conductor_id)::int AS veces
       FROM aviso_turnos
      WHERE semana_lunes = $1::date AND resultado = 'ok'
      ORDER BY conductor_id, enviado_at DESC`, [lunes]);
  const conductores = {};
  r.rows.forEach(x => {
    const id = String(x.conductor_id);
    const actual = porConductor.get(id) || '';
    conductores[id] = {
      veces: x.veces,
      ultimoAt: x.cuando,
      ultimoTs: Number(x.ts) || 0,
      ultimoPor: x.usuario || '',
      avisado: true,
      // Si ya no tiene NINGÚN turno esa semana, también cuenta como cambio:
      // se le avisó de unos turnos que ya no existen.
      cambiado: actual !== x.huella,
    };
  });
  // Quién tiene turnos AHORA esa semana: la pantalla ignora al resto (a quien
  // no sale no se le avisa de nada, ni cuenta para el semáforo).
  return { lunes, conductores, conTurnos: [...porConductor.keys()] };
}

/**
 * El informe de UN día (por defecto hoy): cuántas personas avisadas, cuántos
 * envíos, por usuario, y el detalle por persona con su numerador.
 */
async function informeDia({ dia } = {}) {
  const d = dia || null;   // null → hoy en Madrid (lo resuelve el WHERE)
  const filtroDia = `(a.enviado_at AT TIME ZONE 'Europe/Madrid')::date =
                     COALESCE($1::date, (now() AT TIME ZONE 'Europe/Madrid')::date)`;

  const [tot, porUsuario, detalle] = await Promise.all([
    db.consulta(
      `SELECT count(*) FILTER (WHERE resultado = 'ok')::int                        AS envios,
              count(DISTINCT conductor_id) FILTER (WHERE resultado = 'ok')::int    AS personas,
              count(*) FILTER (WHERE resultado = 'error')::int                     AS errores,
              count(*) FILTER (WHERE resultado = 'sin-telefono')::int              AS sin_telefono
         FROM aviso_turnos a WHERE ${filtroDia}`, [d]),
    db.consulta(
      `SELECT COALESCE(usuario, '(sin usuario)') AS usuario,
              count(*) FILTER (WHERE resultado = 'ok')::int                     AS envios,
              count(DISTINCT conductor_id) FILTER (WHERE resultado = 'ok')::int AS personas
         FROM aviso_turnos a WHERE ${filtroDia}
        GROUP BY 1 ORDER BY envios DESC`, [d]),
    db.consulta(
      `SELECT a.conductor_id,
              COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                       btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre,
              count(*) FILTER (WHERE a.resultado = 'ok')::int  AS veces_hoy,
              max(a.enviado_at) AS ult_ts,
              to_char(max(a.enviado_at) AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS ultima,
              (array_agg(a.usuario ORDER BY a.enviado_at DESC))[1]   AS por,
              (array_agg(a.cuadrante ORDER BY a.enviado_at DESC))[1] AS cuadrante,
              (array_agg(a.resultado ORDER BY a.enviado_at DESC))[1] AS ultimo_resultado,
              -- El numerador: cuántas veces se le ha avisado EN TOTAL de la
              -- semana que le mandaron (la del último aviso del día).
              (SELECT count(*)::int FROM aviso_turnos b
                WHERE b.conductor_id = a.conductor_id AND b.resultado = 'ok'
                  AND b.semana_lunes = (array_agg(a.semana_lunes ORDER BY a.enviado_at DESC))[1]) AS veces_semana
         FROM aviso_turnos a
         JOIN conductor c ON c.id = a.conductor_id
        WHERE ${filtroDia}
        GROUP BY a.conductor_id, c.nombre_bolt, c.nombre, c.apellidos
        ORDER BY ult_ts DESC`, [d]),
  ]);

  return {
    dia: d,
    ...tot.rows[0],
    porUsuario: porUsuario.rows,
    detalle: detalle.rows.map(x => ({
      conductorId: String(x.conductor_id), nombre: x.nombre,
      vecesHoy: x.veces_hoy, vecesSemana: x.veces_semana,
      ultima: x.ultima, por: x.por || '', cuadrante: x.cuadrante || '',
      ultimoResultado: x.ultimo_resultado,
    })),
  };
}

module.exports = { huellas, registrar, estadoSemana, informeDia };
