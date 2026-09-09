// ============================================================
// CARGAR EL HISTÓRICO DE REVISIONES DEL TALLER
// ============================================================
//   node scripts/cargar-mantenimientos.js scripts/datos/revisiones-oscar-2.tsv
//   node scripts/cargar-mantenimientos.js <fichero> --sustituir --aplicar
//
// Sin --aplicar no escribe nada: enseña lo que haría y para.
//
// El fichero es el que lleva el taller: matrícula y km que marcaba el odómetro
// en la última revisión. La fecha no la trae, y por eso `mantenimiento.fecha`
// admite nulo.
//
// ── --sustituir ──────────────────────────────────────────────────────────────
// El taller manda la lista entera cada vez, no los cambios. Si solo se
// insertara, la cifra vieja seguiría ganando en los coches donde la nueva es
// MENOR (0458MMZ pasó de 95.714 a 70.553), porque "la última revisión" se elige
// por el km más alto. Con --sustituir se anulan las importaciones anteriores
// —no se borran: quedan con su motivo— y manda la lista nueva.
//
// ── Cuando el cuadro de instrumentos se cambió ───────────────────────────────
// Si el odómetro de hoy está MUY por debajo del km de la revisión, no es un
// error: en esa revisión se cambió el cuadro y el contador arrancó de cero
// (9533MMX: la revisión fue a 654.182 y el coche marca 96.494). Para esos, el
// km de la revisión es 0 —que es la verdad en el contador nuevo— y la cifra
// vieja queda escrita en la descripción para no perder el kilometraje real.
//
// Distinto es un odómetro apenas por debajo (1205MJY: 247.322 contra 247.633).
// Ahí no hubo cambio de cuadro: hay una cifra mal. Esas se cargan tal cual y el
// módulo las enseña como "dato imposible", que es justo lo que son.

const path = require('path');
const fs = require('fs');

const db = require(path.join(__dirname, '..', 'services', 'db'));

const APLICAR = process.argv.includes('--aplicar');
const SUSTITUIR = process.argv.includes('--sustituir');
const RUTA = process.argv.slice(2).find(a => !a.startsWith('--'));
// Quién carga esto. No es un adorno: `mantenimiento` exige que una fila anulada
// diga quién la anuló, y un histórico sin autor no se puede auditar.
const USUARIO = Number((process.argv.find(a => a.startsWith('--usuario=')) || '').split('=')[1]) || null;

/** Por debajo de esta parte del km de revisión, el contador se reinició. */
const REINICIO = 0.5;

const MARCA = 'Importado del fichero del taller';

const normMat = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const num = v => Number(v).toLocaleString('es-ES', { useGrouping: 'always', maximumFractionDigits: 0 });

function leer(ruta) {
  const lineas = fs.readFileSync(ruta, 'utf8').split(/[\r\n]+/).filter(l => l.trim());
  const sep = lineas[0].includes('\t') ? '\t' : ';';
  const cab = lineas[0].split(sep).map(x => x.toLowerCase().trim());
  const iMat = cab.findIndex(x => x.includes('matric'));
  const iKm = cab.findIndex(x => x.includes('km'));
  if (iMat < 0 || iKm < 0) throw new Error('El fichero no tiene columna de matrícula y de km en la cabecera');

  const porMat = new Map();
  const vacias = [];
  lineas.slice(1).forEach(l => {
    const c = l.split(sep);
    const mat = normMat(c[iMat]);
    if (!mat) return;
    const km = Number(String(c[iKm] || '').replace(/[.\s]/g, '').replace(',', '.'));
    if (!Number.isFinite(km) || km <= 0) { vacias.push(mat); return; }
    if (!porMat.has(mat)) porMat.set(mat, []);
    porMat.get(mat).push(Math.round(km));
  });
  return { porMat, vacias };
}

async function main() {
  if (!RUTA) throw new Error('Falta el fichero: node scripts/cargar-mantenimientos.js <fichero> [--sustituir] [--aplicar]');
  if (!db.HAY_BD) throw new Error('Falta DATABASE_URL');
  if (APLICAR && !USUARIO) throw new Error('Falta --usuario=<id>: el histórico tiene que decir quién lo cargó');

  const { porMat, vacias } = leer(RUTA);
  console.log(`\n📋 ${RUTA}: ${porMat.size} matrículas con km` +
    (vacias.length ? ` · ${vacias.length} sin km: ${vacias.join(', ')}` : ''));

  const veh = new Map((await db.consulta(`
    SELECT v.id, v.matricula, v.matricula_norm, o.km AS odometro,
           (SELECT count(*) FROM mantenimiento m
             WHERE m.vehiculo_id = v.id AND m.tipo = 'revision' AND m.anulado_at IS NULL) AS ya
      FROM vehiculo v LEFT JOIN v_vehiculo_odometro o ON o.vehiculo_id = v.id
     WHERE v.baja_at IS NULL`)).rows.map(r => [r.matricula_norm, r]));

  const nuevas = [], saltadas = [], sinCoche = [];
  for (const [mat, kms] of porMat) {
    const v = veh.get(mat);
    if (!v) { sinCoche.push(mat); continue; }
    if (Number(v.ya) > 0 && !SUSTITUIR) { saltadas.push(`${v.matricula} (ya tiene ${v.ya})`); continue; }

    const leido = Math.max(...kms);
    const otras = [...new Set(kms)].filter(x => x !== leido).sort((a, b) => b - a);
    const odo = v.odometro == null ? null : Number(v.odometro);

    const reiniciado = odo != null && odo < leido * REINICIO;
    const km = reiniciado ? 0 : leido;
    const desde = odo == null ? null : odo - km;

    let desc = `${MARCA} (lista completa).`;
    if (reiniciado) {
      desc = `${MARCA}. En esta revisión se cambió el cuadro de instrumentos: el odómetro ` +
        `marcaba ${num(leido)} km y el contador nuevo arrancó de cero. El kilometraje real del ` +
        `coche es ${num(leido)} más lo que marque el contador.`;
    }
    if (otras.length) desc += ` El fichero traía además ${otras.map(num).join(' y ')} km.`;

    nuevas.push({ id: v.id, matricula: v.matricula, km, leido, desc, odo, desde, reiniciado, otras });
  }

  const reinicios = nuevas.filter(x => x.reiniciado);
  const raros = nuevas.filter(x => !x.reiniciado && x.desde != null && x.desde < 0);
  const tocan = nuevas.filter(x => x.desde != null && x.desde >= 15000).sort((a, b) => b.desde - a.desde);

  if (reinicios.length) {
    console.log(`\n🔄 CUADRO CAMBIADO — el contador arrancó de cero (${reinicios.length})`);
    reinicios.forEach(x => console.log(
      `   ${x.matricula.padEnd(9)} revisión a ${num(x.leido).padStart(9)} · el contador marca ${num(x.odo)} → ` +
      `se guarda 0 y lleva ${num(x.odo)} km desde entonces`));
  }
  if (raros.length) {
    console.log(`\n⚠️  CIFRAS QUE SE CONTRADICEN (${raros.length}) — se cargan y el módulo las marcará`);
    raros.forEach(x => console.log(
      `   ${x.matricula.padEnd(9)} revisión a ${num(x.km).padStart(9)} · el coche marca ${num(x.odo).padStart(9)} · ` +
      `faltan ${num(-x.desde)} km para llegar`));
  }
  if (tocan.length) {
    console.log(`\n▲ TOCAN REVISIÓN con estos datos (${tocan.length})`);
    tocan.forEach(x => console.log(`   ${x.matricula.padEnd(9)} ${num(x.desde).padStart(9)} km desde la revisión`));
  }

  const sinOdo = nuevas.filter(x => x.odo == null);
  console.log(`\nA guardar ....... ${nuevas.length}`);
  console.log(`Sin odómetro .... ${sinOdo.length}${sinOdo.length ? ': ' + sinOdo.map(x => x.matricula).join(', ') : ''}`);
  console.log(`Ya tenían ....... ${saltadas.length}${saltadas.length ? ': ' + saltadas.join(', ') : ''}`);
  console.log(`Sin coche ....... ${sinCoche.length}${sinCoche.length ? ': ' + sinCoche.join(', ') : ''}`);

  if (!APLICAR) return console.log('\n(ensayo: no se ha escrito nada. Añade --aplicar)');

  // Una transacción: o entra el histórico entero o no entra nada.
  let anuladas = 0, puestas = 0;
  await db.transaccion(async cli => {
    if (SUSTITUIR) {
      const a = await cli.query(`
        UPDATE mantenimiento
           SET anulado_at = now(), anulado_por = $1,
               anulado_motivo = 'Sustituida por la lista completa del taller'
         WHERE tipo = 'revision' AND anulado_at IS NULL AND descripcion LIKE $2
        RETURNING id`, [USUARIO, MARCA + '%']);
      anuladas = a.rowCount;
    }
    for (const x of nuevas) {
      await cli.query(
        `INSERT INTO mantenimiento (vehiculo_id, tipo, km, descripcion, usuario_id)
         VALUES ($1, 'revision', $2, $3, $4)`,
        [x.id, x.km, x.desc, USUARIO]);
      puestas++;
    }
  });
  console.log(`\n✅ ${anuladas} anulada(s) · ${puestas} guardada(s).`);
}

main()
  .then(() => db.cerrar())
  .catch(e => { console.error('\n❌', e.message); process.exit(1); });
