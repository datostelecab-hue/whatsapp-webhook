// ============================================================
// LA LIBRANZA EXCEPCIONAL ENTRE SEMANAS DISTINTAS (db/223)
// ============================================================
//   node scripts/comprobar-libranza-excepcional.js
//
// Camilo, 28/10/2026: «quita la restricción de la libranza excepcional, que
// sea de diferentes semanas». Se prueba contra la copia de verdad que un fijo
// puede librar un día de ESTA semana y trabajar a cambio uno que libra la
// SEMANA QUE VIENE, y que f_cobertura lo pinta así: fuera el día que libra y
// dentro el que trabaja. Los dos días iguales siguen sin poder ser.
//
// HACE FALTA EL ENTORNO LOCAL (Docker telecab-pg en 127.0.0.1:5433) con la marca
// `entorno_local` y la 223 aplicada. TODO va dentro de una transacción que se
// deshace al acabar: la copia queda como estaba.
process.env.MODO_PRUEBAS = '1';
const path = require('path');
const { Client } = require('pg');

const LOCAL = 'postgresql://telecab:pruebas@127.0.0.1:5433/telecab';

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

(async () => {
  const cli = new Client(LOCAL);
  await cli.connect();
  const q = async (sql, p) => (await cli.query(sql, p)).rows;
  if (!(await q(`SELECT to_regclass('entorno_local') IS NOT NULL AS ok`))[0].ok) {
    console.error('Esta base no lleva la marca entorno_local: no se prueba aquí.'); process.exit(1);
  }
  if ((await q(`SELECT 1 FROM pg_constraint WHERE conname = 'ck_lexc_semana'`)).length) {
    console.error('Falta la migración 223 en la copia local: aplícala con el corredor.'); process.exit(1);
  }

  await cli.query('BEGIN');
  try {
    const f = require.resolve(path.join(__dirname, '..', 'services', 'db'));
    require.cache[f] = { id: f, filename: f, loaded: true,
      exports: { consulta: (s, p) => cli.query(s, p), transaccion: async fn => fn(cli), HAY_BD: true } };
    const plan = require('../modules/Planificacion/planificador.repo');

    // Las dos semanas: la que viene y la siguiente (sin cambios de nadie todavía).
    const [{ lunes }] = await q(`SELECT to_char(date_trunc('week', current_date + 7)::date, 'YYYY-MM-DD') AS lunes`);
    const presencia = await q(
      `SELECT c.conductor_id::int AS id, to_char(c.dia, 'YYYY-MM-DD') AS dia
         FROM f_cobertura($1::date, $1::date + 13, TRUE) c WHERE c.rol = 'FIJO'`, [lunes]);
    const dias = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(lunes + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10);
    });
    const porConductor = new Map();
    presencia.forEach(x => { if (!porConductor.has(x.id)) porConductor.set(x.id, new Set()); porConductor.get(x.id).add(x.dia); });

    // Un fijo con un patrón claro: el mismo día de la semana libre las dos
    // semanas (su libranza) y trabajando al menos cuatro días de la primera.
    let caso = null;
    for (const [id, set] of porConductor) {
      const trabaja1 = dias.slice(0, 7).filter(d => set.has(d));
      if (trabaja1.length < 4) continue;
      const libre = [0, 1, 2, 3, 4, 5, 6].find(k => !set.has(dias[k]) && !set.has(dias[k + 7]));
      if (libre == null) continue;
      caso = { id, libra: trabaja1[0], trabaja: dias[libre + 7] };
      break;
    }
    if (!caso) throw new Error('La copia no tiene un fijo con patrón claro para probar');

    const r = await plan.crearLibranzaExcepcional({ conductorId: caso.id, diaTrabaja: caso.trabaja, diaLibra: caso.libra, motivo: 'prueba' });
    igual('Se puede guardar un cambio con los dos días en semanas distintas', !!r.id, true);
    const despues = new Set((await q(
      `SELECT to_char(c.dia, 'YYYY-MM-DD') AS dia FROM f_cobertura($1::date, $1::date + 13, TRUE) c
        WHERE c.conductor_id = $2`, [lunes, caso.id])).map(x => x.dia));
    igual('El día que libra (esta semana) ya no sale en el cuadrante', despues.has(caso.libra), false);
    igual('El día que trabaja (la semana siguiente) sí sale', despues.has(caso.trabaja), true);

    let mismo = null;
    try { await plan.crearLibranzaExcepcional({ conductorId: caso.id, diaTrabaja: dias[3], diaLibra: dias[3] }); }
    catch (e) { mismo = e.message; }
    igual('Los dos días iguales siguen sin poder ser', /no pueden ser el mismo/.test(mismo || ''), true);
  } finally {
    await cli.query('ROLLBACK').catch(() => {});
    await cli.end();
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien. La copia local queda como estaba.');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
