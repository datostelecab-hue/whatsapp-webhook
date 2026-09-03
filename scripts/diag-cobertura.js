// ============================================================
// DIAGNÓSTICO — por qué f_cobertura (quién trabaja hoy) sale vacía
// ============================================================
// USO (desde la raíz del repo), pegando tu URL EXTERNA de Render entre comillas:
//   node scripts/diag-cobertura.js "postgresql://...tu-url..."
// Solo LEE. No toca nada.

const { Client } = require('pg');

const urlArg = process.argv.slice(2).find(a => /^postgres(ql)?:\/\//i.test(a));
const url = urlArg || process.env.DATABASE_URL;

(async () => {
  if (!url) { console.error('❌ Falta la URL. Pásala entre comillas como argumento.'); process.exit(1); }
  const esExterna = /\.render\.com|amazonaws|\.rds\./i.test(url);
  const cli = new Client({ connectionString: url, ssl: esExterna ? { rejectUnauthorized: false } : false });
  await cli.connect();
  try {
    const q = async (etq, sql) => {
      try { const r = await cli.query(sql); return { etq, filas: r.rows }; }
      catch (e) { return { etq, error: e.message }; }
    };

    const bloques = [
      await q('resumen', `SELECT
          (SELECT count(*) FROM f_cobertura(CURRENT_DATE, CURRENT_DATE))                             AS cobertura_hoy,
          (SELECT count(*) FROM asignacion WHERE desde <= CURRENT_DATE AND (hasta IS NULL OR hasta >= CURRENT_DATE)) AS asig_activas_hoy,
          (SELECT count(*) FROM asignacion)                                                          AS asig_total,
          (SELECT count(*) FROM asignacion_dia)                                                      AS asig_dia_filas,
          (SELECT count(*) FROM vehiculo_descanso_dia)                                               AS descanso_dias,
          (SELECT count(*) FROM patron_libranza)                                                     AS patrones_libranza,
          (SELECT min(desde)::text FROM asignacion)                                                  AS asig_desde_min,
          (SELECT max(desde)::text FROM asignacion)                                                  AS asig_desde_max,
          (SELECT count(*) FROM asignacion WHERE hasta IS NOT NULL AND hasta < CURRENT_DATE)         AS asig_ya_cerradas,
          EXTRACT(ISODOW FROM CURRENT_DATE)::int                                                     AS hoy_isodow,
          CURRENT_DATE::text                                                                         AS hoy`),
      await q('dia_semana_valores', `SELECT dia_semana, count(*) AS n FROM asignacion_dia GROUP BY 1 ORDER BY 1`),
      await q('cuantos_ausentes_hoy', `SELECT count(DISTINCT h.conductor_id) AS ausentes_hoy
          FROM conductor_estado_hist h JOIN cat_estado_conductor ce ON ce.codigo = h.estado
         WHERE ce.es_ausencia AND h.desde <= CURRENT_DATE AND (h.hasta IS NULL OR h.hasta >= CURRENT_DATE)`),
      await q('descanso_hoy', `SELECT count(*) AS coches_en_descanso_hoy
          FROM vehiculo_descanso vd JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
         WHERE vd.desde <= CURRENT_DATE AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)
           AND vdd.dia_semana = EXTRACT(ISODOW FROM CURRENT_DATE)::smallint`),
      await q('muestra_cobertura', `SELECT rol, count(*) AS n FROM f_cobertura(CURRENT_DATE, CURRENT_DATE) GROUP BY rol`),
    ];

    console.log('\n================ DIAGNÓSTICO COBERTURA ================\n');
    bloques.forEach(b => {
      console.log('### ' + b.etq);
      if (b.error) console.log('   ERROR: ' + b.error);
      else if (!b.filas.length) console.log('   (sin filas)');
      else b.filas.forEach(f => console.log('   ' + JSON.stringify(f)));
      console.log('');
    });
  } finally { await cli.end().catch(() => {}); }
})();
