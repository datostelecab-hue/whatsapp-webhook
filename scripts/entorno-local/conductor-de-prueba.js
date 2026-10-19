// ============================================================
// ENTORNO LOCAL · UN CONDUCTOR DE PRUEBA PARA EL PORTAL
// ============================================================
//   node scripts/entorno-local/conductor-de-prueba.js [id_de_ficha]
//
// Pone a un conductor de la COPIA LOCAL un DNI y un email de prueba, para
// entrar al portal (http://conductorestelecab.localhost:3100) sin escribir el
// DNI de nadie de verdad. El código llega al buzón falso (http://localhost:8025).
//
// Sin id, elige a quien más semanas con nota tenga y turnos de hoy a 7 días.
// Solo funciona contra la base local (lleva la marca de refrescar.js); la
// próxima copia de producción lo deja todo como estaba.

const { Client } = require('pg');

const LOCAL = 'postgresql://telecab:pruebas@127.0.0.1:5433/telecab';
const DNI_PRUEBA = 'PRUEBA0001';
const EMAIL_PRUEBA = 'conductor.prueba@telecab.local';

(async () => {
  const c = new Client({ connectionString: LOCAL });
  await c.connect();
  try {
    await c.query('SELECT 1 FROM entorno_local LIMIT 1');
  } catch (_) {
    console.error('Esta base no lleva la marca de copia local: no toco nada.');
    process.exit(1);
  }

  let id = Number(process.argv[2]) || null;
  if (!id) {
    const r = await c.query(`
      SELECT p.conductor_id AS id
        FROM conductor_puntuacion_semana p
        JOIN conductor c ON c.id = p.conductor_id AND NOT c.es_centinela
       WHERE p.letra <> 'N/E'
         AND EXISTS (SELECT 1 FROM conductor_periodo_empleo e WHERE e.conductor_id = c.id AND e.baja IS NULL)
         AND EXISTS (SELECT 1 FROM f_cobertura((now() AT TIME ZONE 'Europe/Madrid')::date,
                                               (now() AT TIME ZONE 'Europe/Madrid')::date + 7) f
                      WHERE f.conductor_id = c.id)
       GROUP BY p.conductor_id
       ORDER BY count(*) DESC, p.conductor_id
       LIMIT 1`);
    if (!r.rows.length) { console.error('No encuentro a nadie con notas y turnos. ¿Está sellada la puntuación semanal?'); process.exit(1); }
    id = Number(r.rows[0].id);
  }

  // Nadie más puede llevar el DNI de prueba.
  await c.query(`UPDATE conductor SET dni_nie = NULL WHERE dni_nie = $1 AND id <> $2`, [DNI_PRUEBA, id]);
  const r = await c.query(
    `UPDATE conductor SET dni_nie = $2, email = $3 WHERE id = $1
     RETURNING id, btrim(nombre || ' ' || COALESCE(apellidos, '')) AS nombre`, [id, DNI_PRUEBA, EMAIL_PRUEBA]);
  if (!r.rows.length) { console.error(`No existe la ficha ${id}.`); process.exit(1); }
  console.log(`Ficha ${r.rows[0].id} (${r.rows[0].nombre}) lista para el portal.`);
  console.log(`  DNI de prueba:   ${DNI_PRUEBA}`);
  console.log(`  Email de prueba: ${EMAIL_PRUEBA} (los correos se ven en http://localhost:8025)`);
  await c.end();
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
