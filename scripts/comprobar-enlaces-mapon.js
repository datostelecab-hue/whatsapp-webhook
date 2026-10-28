// ============================================================
// UNA UNIDAD DE MAPON, UN COCHE — las reglas (db/221 y db/222)
// ============================================================
//   node scripts/comprobar-enlaces-mapon.js
//
// Del 27/10/2026 a las 14:23 al 28/10 no se guardó el odómetro de ningún coche:
// el 1685KTC, dado de alta otra vez como ficha nueva, dejó su unidad de Mapon
// enlazada a dos coches (la ficha vieja, de baja, nunca la soltó) y la
// subconsulta de sincronizarOdometros tumbaba el lote entero. Aquí se prueba,
// contra la copia de verdad, que:
//   · los odómetros se guardan aunque una unidad tenga dos enlaces (el JOIN);
//   · dar de baja un coche suelta su unidad de Mapon;
//   · enlazar una unidad que sigue en un coche de baja se la quita a ese;
//   · enlazarla estando en otro coche VIVO se rechaza con un motivo claro.
//
// HACE FALTA EL ENTORNO LOCAL (Docker telecab-pg en 127.0.0.1:5433), con la
// marca `entorno_local` y las migraciones 221 y 222 aplicadas. La dirección va
// escrita aquí: no puede apuntar a producción. TODO va dentro de una
// transacción que se deshace al acabar: la copia queda como estaba.
process.env.MODO_PRUEBAS = '1';
const path = require('path');
const { Client } = require('pg');

const LOCAL = 'postgresql://telecab:pruebas@127.0.0.1:5433/telecab';

const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

(async () => {
  const cli = new Client(LOCAL);
  await cli.connect();
  const marca = await cli.query(`SELECT to_regclass('entorno_local') IS NOT NULL AS ok`);
  if (!marca.rows[0].ok) { console.error('Esta base no lleva la marca entorno_local: no se prueba aquí.'); process.exit(1); }
  const q = async (sql, p) => (await cli.query(sql, p)).rows;
  const indice = await q(`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_valias_mapon_vigente'`);
  if (!indice.length) { console.error('Falta la migración 222 en la copia local: aplícala con el corredor.'); process.exit(1); }

  await cli.query('BEGIN');
  try {
    const consulta = (sql, p) => cli.query(sql, p);
    sustituir('services/db', { consulta, transaccion: async fn => fn(cli), HAY_BD: true });
    const repo = require('../modules/Vehiculos/vehiculos.repo');
    const vigentes = async unidad => (await q(
      `SELECT a.vehiculo_id::int AS v FROM vehiculo_alias a
        WHERE a.sistema = 'mapon' AND a.externo_id = $1 AND a.visto_hasta IS NULL ORDER BY 1`, [String(unidad)])).map(x => x.v);

    // ── 1. El caso del 27/10: la unidad con dos enlaces ────────────────────
    // Se vuelve a abrir el enlace viejo del 1685KTC SIN el índice (dentro de la
    // transacción), como estaba en producción.
    // Un enlace cerrado de un coche de baja cuya unidad está hoy en un coche
    // vivo (en la copia, la ficha 36 del 1685KTC con la 932733).
    const [viejo] = await q(`SELECT a.id, a.externo_id FROM vehiculo_alias a JOIN vehiculo v ON v.id = a.vehiculo_id
                              WHERE a.sistema = 'mapon' AND v.baja_at IS NOT NULL AND a.visto_hasta IS NOT NULL
                                AND EXISTS (SELECT 1 FROM vehiculo_alias b JOIN vehiculo w ON w.id = b.vehiculo_id
                                             WHERE b.sistema = 'mapon' AND b.externo_id = a.externo_id
                                               AND b.visto_hasta IS NULL AND w.baja_at IS NULL)
                              ORDER BY a.visto_hasta DESC LIMIT 1`);
    if (!viejo) throw new Error('La copia no tiene una unidad que haya pasado de un coche de baja a uno vivo');
    await cli.query('SAVEPOINT caso');
    await cli.query('DROP INDEX uq_valias_mapon_vigente');
    await cli.query('UPDATE vehiculo_alias SET visto_hasta = NULL WHERE id = $1', [viejo.id]);
    const dos = await vigentes(viejo.externo_id);
    await cli.query('SAVEPOINT viejo');
    let antes = 'no falló';
    try {
      await cli.query(`SELECT (SELECT vehiculo_id FROM vehiculo_alias WHERE sistema = 'mapon' AND externo_id = $1 AND visto_hasta IS NULL)`, [viejo.externo_id]);
    } catch (e) { antes = e.message; }
    await cli.query('ROLLBACK TO SAVEPOINT viejo');
    igual('Así estaba: una unidad con dos coches y la subconsulta de antes fallaba',
      [dos.length >= 2, /more than one row/.test(antes)], [true, true]);
    const vivo = (await q(`SELECT a.vehiculo_id::int AS v FROM vehiculo_alias a JOIN vehiculo v ON v.id = a.vehiculo_id
                            WHERE a.sistema = 'mapon' AND a.externo_id = $1 AND a.visto_hasta IS NULL AND v.baja_at IS NULL`, [viejo.externo_id]))[0];
    const r = await repo.sincronizarOdometros(new Map([[viejo.externo_id, { odometroCanM: 123456789, odometroM: 4242000 }]]));
    const [km] = await q(`SELECT km_odometro_m::bigint AS km FROM vehiculo WHERE id = $1`, [vivo ? vivo.v : 0]);
    igual('Ahora los odómetros se guardan igual: el coche vivo recibe su km', [r.actualizados, km && Number(km.km)], [1, 123456789]);
    const [deBaja] = await q(`SELECT km_odometro_m::bigint AS km FROM vehiculo v JOIN vehiculo_alias a ON a.vehiculo_id = v.id WHERE a.id = $1`, [viejo.id]);
    igual('…y el de baja no se toca', deBaja.km === null || Number(deBaja.km) !== 123456789, true);
    igual('…y la foto de km del día se escribe', r.fotos > 0, true);
    await cli.query('ROLLBACK TO SAVEPOINT caso');

    // ── 2. Dar de baja suelta la unidad de Mapon ───────────────────────────
    const [conUnidad] = await q(`SELECT v.id::int AS id, a.externo_id FROM vehiculo v JOIN vehiculo_alias a ON a.vehiculo_id = v.id
                                  WHERE v.baja_at IS NULL AND a.sistema = 'mapon' AND a.visto_hasta IS NULL ORDER BY v.id LIMIT 1`);
    await cli.query('SAVEPOINT baja');
    await repo.darDeBaja(conUnidad.id, 7);
    igual('Al dar de baja un coche, su unidad de Mapon queda libre', await vigentes(conUnidad.externo_id), []);
    await cli.query('ROLLBACK TO SAVEPOINT baja');

    // ── 3. Enlazar una unidad que sigue en un coche de baja ────────────────
    // Un coche de baja «a la antigua» (sin soltar la unidad) y otro vivo sin
    // unidad que ahora la lleva según Mapon.
    const sinUnidad = await q(`SELECT v.id::int AS id, v.matricula FROM vehiculo v
                                WHERE v.baja_at IS NULL AND NOT EXISTS (SELECT 1 FROM vehiculo_alias a
                                  WHERE a.vehiculo_id = v.id AND a.sistema = 'mapon' AND a.visto_hasta IS NULL)
                                ORDER BY v.id LIMIT 2`);
    const [a, b] = await q(`SELECT v.id::int AS id, a.externo_id FROM vehiculo v JOIN vehiculo_alias a ON a.vehiculo_id = v.id
                             WHERE v.baja_at IS NULL AND a.sistema = 'mapon' AND a.visto_hasta IS NULL ORDER BY v.id LIMIT 2`);
    if (sinUnidad.length < 2 || !a || !b) throw new Error('La copia no tiene coches para el caso 3 y 4');
    await cli.query('SAVEPOINT traspaso');
    await cli.query('UPDATE vehiculo SET baja_at = now() WHERE id = $1', [a.id]);
    const e1 = await repo.enlazarMapon(new Map([[a.externo_id, { matricula: sinUnidad[0].matricula }]]));
    igual('La unidad de un coche de baja pasa al coche que la lleva ahora', [e1.nuevos, e1.rechazados.length, await vigentes(a.externo_id)], [1, 0, [sinUnidad[0].id]]);
    await cli.query('ROLLBACK TO SAVEPOINT traspaso');

    // ── 4. Enlazar una unidad que está en otro coche VIVO ──────────────────
    await cli.query('SAVEPOINT choque');
    const e2 = await repo.enlazarMapon(new Map([[b.externo_id, { matricula: sinUnidad[1].matricula }]]));
    igual('Si está en otro coche vivo se rechaza, con el motivo y sin tocar el otro',
      [e2.nuevos, e2.rechazados.length, /ya está enlazada a otro coche vivo/.test(e2.rechazados[0] || ''), await vigentes(b.externo_id)],
      [0, 1, true, [b.id]]);
    await cli.query('ROLLBACK TO SAVEPOINT choque');
  } finally {
    await cli.query('ROLLBACK').catch(() => {});
    await cli.end();
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien. La copia local queda como estaba.');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
