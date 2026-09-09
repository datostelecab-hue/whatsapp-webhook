// ============================================================
// CARGAR EL HISTÓRICO DE REVISIONES DEL TALLER
// ============================================================
//   node scripts/cargar-mantenimientos.js scripts/datos/revisiones-oscar.tsv
//   node scripts/cargar-mantenimientos.js <fichero> --aplicar
//
// Sin --aplicar no escribe nada: enseña lo que haría y para. El fichero es el
// que lleva el taller: una fila por revisión, con la matrícula y el km que
// marcaba el odómetro. La fecha no la trae, y por eso `mantenimiento.fecha`
// admite nulo.
//
// ── Una fila por coche, no una por línea ─────────────────────────────────────
// El fichero de septiembre de 2026 venía con dos volcados pegados: 42 filas
// para 28 matrículas, y en cinco de ellas los dos volcados NO coinciden
// (1120KTK: 282.445 y 256.918). Meter las dos sería inventarle al coche un
// historial de dos revisiones que nadie ha hecho. Se guarda UNA, la del km más
// alto —la más reciente—, y la otra cifra queda escrita en la descripción para
// que el taller pueda mirarla y decidir.

const path = require('path');
const fs = require('fs');

const db = require(path.join(__dirname, '..', 'services', 'db'));

const APLICAR = process.argv.includes('--aplicar');
const RUTA = process.argv.slice(2).find(a => !a.startsWith('--'));

const normMat = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const num = v => Number(v).toLocaleString('es-ES', { useGrouping: 'always', maximumFractionDigits: 0 });

function leer(ruta) {
  const lineas = fs.readFileSync(ruta, 'utf8').split(/[\r\n]+/).filter(Boolean);
  const sep = lineas[0].includes('\t') ? '\t' : ';';
  const cab = lineas[0].split(sep).map(x => x.toLowerCase().trim());
  const iMat = cab.findIndex(x => x.includes('matric'));
  const iKm = cab.findIndex(x => x.includes('km'));
  if (iMat < 0 || iKm < 0) throw new Error('El fichero no tiene columna de matrícula y de km en la cabecera');

  const porMat = new Map();
  lineas.slice(1).forEach(l => {
    const c = l.split(sep);
    const mat = normMat(c[iMat]);
    const km = Number(String(c[iKm] || '').replace(/[.\s]/g, '').replace(',', '.'));
    if (!mat || !Number.isFinite(km) || km <= 0) return;
    if (!porMat.has(mat)) porMat.set(mat, []);
    porMat.get(mat).push(Math.round(km));
  });
  return porMat;
}

async function main() {
  if (!RUTA) throw new Error('Falta el fichero: node scripts/cargar-mantenimientos.js <fichero> [--aplicar]');
  if (!db.HAY_BD) throw new Error('Falta DATABASE_URL');

  const porMat = leer(RUTA);
  console.log(`\n📋 ${RUTA}: ${porMat.size} matrículas`);

  // La flota, con su odómetro de hoy y lo que ya tenga apuntado.
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
    if (Number(v.ya) > 0) { saltadas.push(`${v.matricula} (ya tiene ${v.ya} apuntada/s)`); continue; }

    const km = Math.max(...kms);
    const otras = [...new Set(kms)].filter(x => x !== km).sort((a, b) => b - a);
    const desc = 'Importado del fichero del taller.' +
      (otras.length ? ` El fichero traía además ${otras.map(num).join(' y ')} km para esta matrícula.` : '');

    const odo = v.odometro == null ? null : Number(v.odometro);
    const desde = odo == null ? null : odo - km;
    nuevas.push({ id: v.id, matricula: v.matricula, km, desc, odo, desde, otras });
  }

  nuevas.sort((a, b) => (b.desde ?? -1) - (a.desde ?? -1));
  console.log(`\n${'Matrícula'.padEnd(10)} ${'Km revisión'.padStart(12)} ${'Odóm. hoy'.padStart(12)} ${'Desde'.padStart(10)}  Aviso`);
  console.log('─'.repeat(74));
  nuevas.forEach(x => {
    const aviso = x.desde == null ? 'sin odómetro todavía'
      : x.desde < 0 ? '❌ el odómetro va por DEBAJO de la revisión'
      : x.desde > 120000 ? '⚠ imposible: revisar el dato'
      : x.desde >= 15000 ? '▲ ya toca revisión' : '';
    console.log(`${x.matricula.padEnd(10)} ${num(x.km).padStart(12)} ` +
      `${(x.odo == null ? '—' : num(x.odo)).padStart(12)} ${(x.desde == null ? '—' : num(x.desde)).padStart(10)}  ${aviso}` +
      (x.otras.length ? `  (el fichero también decía ${x.otras.map(num).join('/')})` : ''));
  });

  console.log(`\nA insertar ...... ${nuevas.length}`);
  console.log(`Ya tenían ....... ${saltadas.length}${saltadas.length ? ': ' + saltadas.join(', ') : ''}`);
  console.log(`Sin coche ....... ${sinCoche.length}${sinCoche.length ? ': ' + sinCoche.join(', ') : ''}`);

  if (!APLICAR) return console.log('\n(ensayo: no se ha escrito nada. Añade --aplicar)');

  // Una transacción: o entra el histórico entero o no entra nada.
  let n = 0;
  await db.transaccion(async cli => {
    for (const x of nuevas) {
      await cli.query(
        `INSERT INTO mantenimiento (vehiculo_id, tipo, km, descripcion) VALUES ($1, 'revision', $2, $3)`,
        [x.id, x.km, x.desc]);
      n++;
    }
  });
  console.log(`\n✅ ${n} revisión(es) guardada(s).`);
}

main()
  .then(() => db.cerrar())
  .catch(e => { console.error('\n❌', e.message); process.exit(1); });
