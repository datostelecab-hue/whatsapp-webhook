// ============================================================
// MIGRACIÓN COMPLETA — de los Excel a PostgreSQL, de una vez
// ============================================================
//   node scripts/migrar-todo.js [carpeta]           aplica y carga
//   node scripts/migrar-todo.js [carpeta] --desde-cero   vacía primero
//
// Necesita DATABASE_URL. `--desde-cero` exige además MODO_PRUEBAS=1: vaciar la
// base es irreversible y no puede depender de acordarse de mirar a qué apunta
// la variable de entorno.
//
// Es la orden que se ejecuta el día de la migración. Cada paso informa de lo
// suyo y, si uno falla, se para: los siguientes dependen del anterior.

const { spawn } = require('child_process');
const path = require('path');
const db = require('../services/db');
const migra = require('../services/migraciones');

const DIR = process.argv.find(a => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1])
  || 'C:/Users/ricar/Downloads';
const DESDE_CERO = process.argv.includes('--desde-cero');

// Orden obligatorio: cada cargador se apoya en lo que dejó el anterior.
const PASOS = [
  ['cargar-conductores.js', 'Conductores, alias, IDs de BOLT, teléfonos y empleos'],
  ['cargar-vehiculos.js',   'Coches, estados y bases'],
  ['cargar-tablero.js',     'Plazas, asignaciones, turnos y libranzas'],
  ['cargar-ausencias.js',   'Bajas, vacaciones y permisos'],
];

const reloj = ms => (ms / 1000).toFixed(1) + ' s';

function ejecutar(script) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, script), DIR], {
      stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
    });
    let salida = '';
    p.stdout.on('data', d => { salida += d; process.stdout.write('    ' + String(d).replace(/\n(?!$)/g, '\n    ')); });
    p.stderr.on('data', d => process.stderr.write('    ' + d));
    p.on('close', c => c === 0 ? resolve(salida) : reject(new Error(`${script} salió con código ${c}`)));
  });
}

(async () => {
  const t0 = Date.now();
  console.log(`Origen: ${DIR}`);
  const e = await db.estado();
  console.log(`Destino: ${e.bd} (${e.version}) · latencia ${e.latenciaMs} ms\n`);

  if (DESDE_CERO) {
    console.log('── Vaciando la base ──');
    const r = await migra.reiniciar({ confirmar: 'BORRAR TODO' });
    r.aplicadas.forEach(a => console.log(`    ${a.ok ? '✓' : '✗'} ${a.fichero}  ${a.ok ? a.ms + ' ms' : a.error}`));
    if (r.parado) throw new Error('Falló una migración');
  } else {
    console.log('── Aplicando migraciones pendientes ──');
    const r = await migra.aplicar();
    if (!r.aplicadas.length) console.log('    (nada pendiente)');
    r.aplicadas.forEach(a => console.log(`    ${a.ok ? '✓' : '✗'} ${a.fichero}  ${a.ok ? a.ms + ' ms' : a.error}`));
    if (r.parado) throw new Error('Falló una migración');
    if (r.modificadas.length) {
      console.log('    ⚠️  ficheros cambiados DESPUÉS de aplicarse: ' +
        r.modificadas.map(m => m.fichero).join(', '));
    }
  }

  for (const [i, [script, que]] of PASOS.entries()) {
    console.log(`\n── ${i + 1}/${PASOS.length}  ${que} ──`);
    const t = Date.now();
    await ejecutar(script);
    console.log(`    (${reloj(Date.now() - t)})`);
  }

  // ── Cierre: lo que ha quedado ──
  console.log('\n══════════════════════════════════════════');
  const q = await db.consulta(`SELECT
    (SELECT count(*) FROM conductor WHERE NOT es_centinela)            conductores,
    (SELECT count(*) FROM conductor WHERE empleo_vigente)              empleados,
    (SELECT count(*) FROM conductor_alias)                             alias,
    (SELECT count(*) FROM conductor_externo)                           cuentas_externas,
    (SELECT count(*) FROM conductor_telefono)                          telefonos,
    (SELECT count(*) FROM conductor_periodo_empleo)                    empleos,
    (SELECT count(*) FROM vehiculo)                                    coches,
    (SELECT count(*) FROM plaza)                                       plazas,
    (SELECT count(*) FROM asignacion WHERE hasta IS NULL)              asignaciones,
    (SELECT count(*) FROM conductor_estado_hist WHERE hasta IS NULL)   ausencias,
    (SELECT count(*) FROM patron_libranza WHERE hasta IS NULL)         libranzas,
    (SELECT count(*) FROM turno_dia_operativo)                         dias_operativos`);
  Object.entries(q.rows[0]).forEach(([k, v]) => console.log(`  ${k.padEnd(18)} ${String(v).padStart(6)}`));

  const tam = await db.consulta(
    `SELECT pg_size_pretty(pg_database_size(current_database())) t`);
  console.log(`  ${'tamaño'.padEnd(18)} ${tam.rows[0].t.padStart(6)}`);

  // Comprobaciones de que lo cargado tiene sentido
  console.log('\n── Comprobaciones ──');
  const chequeos = [
    ['cada coche tiene sus 6 plazas',
     `SELECT count(*) n FROM (SELECT vehiculo_id FROM plaza WHERE baja_at IS NULL
        GROUP BY vehiculo_id HAVING count(*) <> 6) x`],
    ['ninguna plaza con dos conductores a la vez',
     `SELECT count(*) n FROM (SELECT plaza_id FROM asignacion WHERE hasta IS NULL
        GROUP BY plaza_id HAVING count(*) > 1) x`],
    ['ningún conductor con dos empleos abiertos',
     `SELECT count(*) n FROM (SELECT conductor_id FROM conductor_periodo_empleo
        WHERE baja IS NULL GROUP BY conductor_id HAVING count(*) > 1) x`],
    ['ningún teléfono vigente repetido',
     `SELECT count(*) n FROM (SELECT sufijo9 FROM conductor_telefono
        WHERE vigente_hasta IS NULL GROUP BY sufijo9 HAVING count(*) > 1) x`],
    ['ninguna cuenta de BOLT en dos personas',
     `SELECT count(*) n FROM (SELECT externo_id FROM conductor_externo
        WHERE sistema='bolt' GROUP BY externo_id HAVING count(*) > 1) x`],
  ];
  let mal = 0;
  for (const [que, sql] of chequeos) {
    const n = Number((await db.consulta(sql)).rows[0].n);
    if (n) mal++;
    console.log(`  ${n ? '✗' : '✓'} ${que}${n ? `  → ${n} caso(s)` : ''}`);
  }

  console.log(`\n${mal ? '⚠️  ' + mal + ' comprobación(es) fallida(s)' : '✅ Todo coherente'}` +
              ` · ${reloj(Date.now() - t0)} en total`);
  await db.cerrar();
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error('\n❌ ' + e.message); process.exit(1); });
