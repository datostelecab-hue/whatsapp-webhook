// ============================================================
// REPORTE DE LA ETT — SQL: quién es de la ETT y qué le tocaba ese día
// ============================================================
// Solo el censo y lo que estaba planificado. Las horas NO se cuentan aquí: se
// piden a la Bitácora, que es quien las sella.

const db = require('../../services/db');

/**
 * Los conductores de ETT que estaban de alta ese día, con lo que se sabe de
 * ellos: turno, coche asignado ese día, si libraba, y los datos que la ETT pide
 * para identificarlos (DNI y NAF).
 *
 * "De la ETT" es el CONTRATO, no una etiqueta: `conductor_periodo_empleo.tipo`.
 * Y se mira el periodo vigente ESE DÍA, no hoy: quien pasó a plantilla propia
 * ayer sigue siendo de la ETT en el reporte de anteayer.
 */
async function ettDelDia(diaIso) {
  const r = await db.consulta(
    `SELECT c.id AS conductor_id,
            COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                     NULLIF(btrim(COALESCE(c.apellidos || ', ', '') || c.nombre), ''),
                     'Conductor ' || c.id)                       AS nombre,
            NULLIF(btrim(c.nombre_bolt), '')                     AS nombre_bolt,
            c.dni_nie, c.naf,
            e.ett_nombre,
            t.etiqueta                                           AS turno,
            tel.e164                                             AS telefono,
            v.matricula,
            -- ¿Libraba ese día? MISMA REGLA QUE LA PLANTILLA, y en el mismo
            -- orden: primero el patrón puesto a mano, y si no lo hay el que sale
            -- del cuadrante (v_conductor_libranza, db/113: el fijo libra el
            -- descanso de su coche; el CT, los días que no le pusieron).
            -- Escribirla aquí de otra forma sería la segunda versión de la misma
            -- pregunta, y esta se le manda a un tercero.
            COALESCE(EXTRACT(ISODOW FROM $1::date)::int
                       = ANY(COALESCE(lib.dias::int[], cua.dias_libra)), false) AS libra,
            -- La situación de ese día: unas vacaciones explican un cero mejor que
            -- un hueco en blanco, y es lo primero que pregunta la ETT.
            ce.etiqueta                                          AS situacion
       FROM conductor c
       JOIN conductor_periodo_empleo e
              ON e.conductor_id = c.id
             AND e.tipo = 'ett'
             AND e.alta <= $1::date
             AND (e.baja IS NULL OR e.baja >= $1::date)
       LEFT JOIN LATERAL (
         SELECT th.turno_id FROM conductor_turno_hist th
          WHERE th.conductor_id = c.id AND th.desde <= $1::date
            AND (th.hasta IS NULL OR th.hasta >= $1::date)
          ORDER BY th.desde DESC LIMIT 1) tt ON TRUE
       LEFT JOIN turno t ON t.id = tt.turno_id
       LEFT JOIN LATERAL (
         SELECT ct.e164 FROM conductor_telefono ct
          WHERE ct.conductor_id = c.id AND ct.vigente_hasta IS NULL
          ORDER BY ct.principal DESC, ct.id LIMIT 1) tel ON TRUE
       LEFT JOIN LATERAL (
         SELECT ve.matricula
           FROM asignacion a
           JOIN plaza p    ON p.id = a.plaza_id
           JOIN vehiculo ve ON ve.id = p.vehiculo_id
          WHERE a.conductor_id = c.id AND a.desde <= $1::date
            AND (a.hasta IS NULL OR a.hasta >= $1::date)
          ORDER BY a.desde DESC LIMIT 1) v ON TRUE
       LEFT JOIN LATERAL (
         SELECT array_agg(d.dia_semana) AS dias
           FROM patron_libranza pl
           JOIN patron_libranza_dia d ON d.patron_id = pl.id
          WHERE pl.conductor_id = c.id AND pl.desde <= $1::date
            AND (pl.hasta IS NULL OR pl.hasta >= $1::date)) lib ON TRUE
       -- El del cuadrante NO lleva fecha: la vista da el patrón de AHORA. Es la
       -- misma limitación que tiene la Plantilla, y se prefiere eso a inventar
       -- aquí una segunda forma de calcularlo.
       LEFT JOIN v_conductor_libranza cua ON cua.conductor_id = c.id
       LEFT JOIN LATERAL (
         SELECT h.estado FROM conductor_estado_hist h
          WHERE h.conductor_id = c.id AND h.desde <= $1::date
            AND (h.hasta IS NULL OR h.hasta >= $1::date)
          ORDER BY h.desde DESC LIMIT 1) sit ON TRUE
       LEFT JOIN cat_estado_conductor ce ON ce.codigo = sit.estado
      WHERE NOT c.es_centinela
      ORDER BY nombre`, [diaIso]);

  return r.rows.map(x => ({
    conductorId: Number(x.conductor_id),
    nombre: x.nombre,
    nombreBolt: x.nombre_bolt || '',
    dni: x.dni_nie || '',
    naf: x.naf || '',
    ett: x.ett_nombre || '',
    turno: x.turno || '',
    telefono: x.telefono || '',
    matricula: x.matricula || '',
    libra: x.libra === true,
    situacion: x.situacion || '',
  }));
}

module.exports = { ettDelDia };
