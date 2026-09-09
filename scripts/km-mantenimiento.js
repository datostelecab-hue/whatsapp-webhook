// ============================================================
// CONTROL DE MANTENIMIENTO POR KM
// ============================================================
//   node scripts/km-mantenimiento.js --flota=scripts/datos/flota-oscar.txt \
//        --revisiones=scripts/datos/revisiones-oscar.tsv --umbral=15000 --csv=salida.csv
//   node scripts/km-mantenimiento.js --verificar=1194LCK          (diagnóstico)
//
// Contesta a: qué coches han pasado del umbral de km DESDE SU ÚLTIMA REVISIÓN.
// Y, para los que no tienen dato de revisión, a qué ritmo van.
//
// ── Los tres números de Mapon, que no son lo mismo ───────────────────────────
//   · can.odom  → EL ODÓMETRO DEL COCHE, el del cuadro, leído del CAN bus. En
//     kilómetros. Solo lo dan los GPS que leen el CAN: 90 de 144 unidades en
//     septiembre de 2026. Es el único bueno para mantenimiento.
//   · mileage   → NO es el odómetro, aunque lo parezca: son los km recorridos
//     DESDE QUE SE INSTALÓ EL DISPOSITIVO. Comprobado el 09/09/2026 contra los
//     km de la última revisión del taller: 25 de 27 coches daban un imposible
//     (5886LBZ: 30.723 contra 629.100 reales). Con can.odom, 26 de 26 cuadran.
//     Sirve para medir recorrido, no para saber por dónde va un coche.
//   · route/list → los km rodados en una ventana. Medido, trayecto a trayecto.
//     Es de donde sale el ritmo mensual.
//
// ── Lo que hace falta y no está ──────────────────────────────────────────────
// Para los coches sin CAN no hay odómetro. Ahí hace falta UN anclaje: el km del
// cuadro en una fecha. A partir de ese anclaje, `mileage` mantiene la cuenta:
//     km real hoy = km del anclaje + (mileage de hoy − mileage del anclaje)
// Una llamada al día para toda la flota, y no caduca.

const path = require('path');
const fs = require('fs');

const mapon = require(path.join(__dirname, '..', 'services', 'mapon'));
const db = require(path.join(__dirname, '..', 'services', 'db'));

const CONC = 3;                  // Mapon admite 5 concurrentes; dejamos hueco al cron
const ZONA = 'Europe/Madrid';
const PLACA = /^[0-9]{4}[A-Z]{3}$/;
const IMPOSIBLE = 120000;        // km desde una revisión por encima de esto = dato malo

// ── Argumentos ───────────────────────────────────────────────────────────────
const args = {};
process.argv.slice(2).forEach(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? '1' : m[2];
});
const DIAS = Math.min(Number(args.dias) || 31, mapon.MAX_DIAS);
const UMBRAL = Number(args.umbral) || 15000;

// useGrouping 'always': en es-ES los números de 4 cifras no llevan punto por
// convención, y en una columna de kilómetros eso descuadra la vista.
const num = (n, dec = 0) => Number(n).toLocaleString('es-ES',
  { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: 'always' });
const fecha = d => new Intl.DateTimeFormat('es-ES', {
  timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
}).format(d);
const normMat = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

async function enParalelo(items, n, fn) {
  const it = items[Symbol.iterator]();
  const runner = async () => { for (let x = it.next(); !x.done; x = it.next()) await fn(x.value); };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, runner));
}

// ── Ficheros del taller ──────────────────────────────────────────────────────
/** Matrículas a las que hay que hacer seguimiento, una por línea. */
function leerFlota(ruta) {
  return new Set(fs.readFileSync(ruta, 'utf8').split(/[\r\n]+/).map(normMat).filter(Boolean));
}

/**
 * Km del odómetro en la última revisión, por matrícula. Acepta TSV o CSV con
 * cabecera: se busca la columna que hable de matrícula y la que hable de km.
 * Si una matrícula sale varias veces se queda el km MÁS ALTO, que es la
 * revisión más reciente. Los puntos de millar se quitan.
 */
function leerRevisiones(ruta) {
  const lineas = fs.readFileSync(ruta, 'utf8').split(/[\r\n]+/).filter(Boolean);
  const sep = lineas[0].includes('\t') ? '\t' : ';';
  const cab = lineas[0].split(sep).map(x => x.toLowerCase().trim());
  const iMat = cab.findIndex(x => x.includes('matric'));
  const iKm = cab.findIndex(x => x.includes('km'));
  if (iMat < 0 || iKm < 0) throw new Error(`${ruta}: no encuentro columna de matrícula y de km en la cabecera`);
  const out = new Map();
  lineas.slice(1).forEach(l => {
    const c = l.split(sep);
    const mat = normMat(c[iMat]);
    const km = Number(String(c[iKm] || '').replace(/[.\s]/g, '').replace(',', '.'));
    if (!mat || !Number.isFinite(km) || km <= 0) return;
    const prev = out.get(mat);
    out.set(mat, prev == null ? km : Math.max(prev, km));
  });
  return out;
}

// ── Diagnóstico: ¿nos sirve el histórico de Mapon? ───────────────────────────
async function verificarHistorico(matricula, iso) {
  const u = await mapon.unidadPorMatricula(matricula);
  if (!u) return console.error(`No hay unidad en Mapon con matrícula ${matricula}`);
  const url = `https://mapon.com/api/v1/unit_data/history_point.json` +
    `?key=${process.env.MAPON_API_KEY}&unit_id=${u.unitId}&datetime=${encodeURIComponent(iso)}`;
  const j = await (await fetch(url)).json();
  console.log(`\nunit_data/history_point.json — ${matricula} (unit ${u.unitId}) a ${iso}:\n`);
  console.log(JSON.stringify(j, null, 2));
}

// ── Flota nuestra (opcional: solo si hay DATABASE_URL) ───────────────────────
async function leerFlotaBD() {
  if (!db.HAY_BD) return null;
  const r = await db.consulta(`
    SELECT v.id, v.matricula, v.marca_modelo, v.estado_operativo,
           e.etiqueta AS estado_etiqueta, v.baja_at,
           (SELECT al.externo_id FROM vehiculo_alias al
             WHERE al.vehiculo_id = v.id AND al.sistema = 'mapon' AND al.visto_hasta IS NULL
             LIMIT 1) AS unit_id
      FROM vehiculo v
      LEFT JOIN cat_estado_vehiculo e ON e.codigo = v.estado_operativo
     ORDER BY v.matricula`);
  return r.rows;
}

// ── Principal ────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.MAPON_API_KEY) {
    console.error('Falta MAPON_API_KEY. Sin ella Mapon no contesta nada.');
    process.exit(1);
  }

  const fin = new Date();
  const ini = new Date(fin.getTime() - DIAS * 86400 * 1000);

  if (args.verificar) {
    return verificarHistorico(args.verificar, ini.toISOString().replace(/\.\d+Z$/, 'Z'));
  }

  const SEG = args.flota ? leerFlota(args.flota) : null;
  const REV = args.revisiones ? leerRevisiones(args.revisiones) : new Map();

  console.log(`\n📏 CONTROL DE MANTENIMIENTO POR KM`);
  console.log(`   Umbral de revisión: ${num(UMBRAL)} km`);
  console.log(`   Ritmo medido entre ${fecha(ini)} y ${fecha(fin)} (${DIAS} días)`);
  if (SEG) console.log(`   Seguimiento: ${SEG.size} matrículas de ${args.flota}`);
  if (REV.size) console.log(`   Revisiones: ${REV.size} matrículas de ${args.revisiones}`);

  const unidades = await mapon.unidades();
  if (!unidades.size) throw new Error('Mapon no devolvió ninguna unidad');
  console.log(`\n   ${unidades.size} unidades en Mapon. Pidiendo el recorrido de cada una…`);

  const bd = await leerFlotaBD();
  const bdPorMat = new Map(), bdPorUnit = new Map();
  (bd || []).forEach(v => {
    bdPorMat.set(normMat(v.matricula), v);
    if (v.unit_id) bdPorUnit.set(String(v.unit_id), v);
  });

  const filas = [];
  let hechas = 0;
  await enParalelo([...unidades.entries()], CONC, async ([unitId, u]) => {
    let km = null, error = null;
    try {
      km = (await mapon.kmEnVentana({
        unitId,
        fromTs: Math.floor(ini.getTime() / 1000),
        tillTs: Math.floor(fin.getTime() / 1000),
      })).km;
    } catch (e) {
      error = e.message;
    }
    const mat = normMat(u.matricula);
    const nuestro = bdPorUnit.get(String(unitId)) || bdPorMat.get(mat) || null;
    const odom = u.odometroCanM != null ? u.odometroCanM / 1000 : null;
    const kmRev = REV.has(mat) ? REV.get(mat) : null;
    const desde = odom != null && kmRev != null ? odom - kmRev : null;
    filas.push({
      unitId, mat,
      matricula: u.matricula,
      vehiculo: (nuestro && nuestro.marca_modelo) || u.vehiculo || '',
      estadoMapon: u.estado,
      gps: u.odometroM != null ? u.odometroM / 1000 : null,
      km, error, odom, kmRev, desde,
      // Un odómetro por debajo del km de su propia revisión es imposible; y
      // 120.000 km desde la última revisión tampoco se los ha hecho nadie.
      revSospechosa: desde != null && (desde < 0 || desde > IMPOSIBLE),
      enSeguimiento: !SEG || SEG.has(mat),
      enBD: !!nuestro,
      estadoNuestro: nuestro ? (nuestro.estado_etiqueta || nuestro.estado_operativo) : null,
      baja: nuestro ? !!nuestro.baja_at : false,
    });
    if (++hechas % 25 === 0) console.log(`   … ${hechas}/${unidades.size}`);
  });

  // Con lista de seguimiento la tabla se queda con esos coches Y con las
  // unidades que Mapon no sabe nombrar Y han rodado: una de ellas puede ser
  // justo el coche de la lista que "no aparece". Un equipo sin nombre y sin
  // moverse no es ningún coche, es un GPS en un cajón.
  const visibles = SEG
    ? filas.filter(f => f.enSeguimiento || (!PLACA.test(f.mat) && (f.km || 0) > 0))
    : filas;

  const conRev = visibles.filter(f => f.desde != null && !f.revSospechosa);
  const sinRev = visibles.filter(f => f.desde == null || f.revSospechosa);
  const tocan = conRev.filter(f => f.desde >= UMBRAL).sort((a, b) => b.desde - a.desde);

  // ── A. Con dato de revisión: la respuesta firme ────────────────────────────
  const anchos = [3, 10, 22, 12, 12, 14, 9];
  const linea = c => c.map((x, i) => (i >= 3 && i <= 5 ? String(x).padStart(anchos[i]) : String(x).padEnd(anchos[i]))).join(' ');
  const raya = () => console.log('─'.repeat(anchos.reduce((a, b) => a + b + 1, 0)));

  console.log(`\n\n════ A. CON DATO DE ÚLTIMA REVISIÓN (${conRev.length}) ════\n`);
  console.log(linea(['', 'Matrícula', 'Vehículo', 'Últ. revis.', 'Odóm. hoy', 'Desde revis.', 'Km/mes']));
  raya();
  conRev.sort((a, b) => b.desde - a.desde).forEach((f, i) => {
    console.log(linea([
      f.desde >= UMBRAL ? '▲' : ' ', f.matricula, f.vehiculo.slice(0, 22),
      num(f.kmRev), num(f.odom), num(f.desde), f.km == null ? '—' : num(f.km),
    ]));
    if (i === tocan.length - 1 && tocan.length) { raya(); console.log('  ↑ pasan del umbral: entran a revisión'); }
  });

  // ── B. Sin dato de revisión: lo que falta por saber ────────────────────────
  console.log(`\n\n════ B. SIN DATO DE REVISIÓN FIABLE (${sinRev.length}) ════`);
  console.log(`Aquí no se puede decir si toca revisión: falta el km de la última.`);
  console.log(`La columna "Odóm. hoy" es a lo que hay que restarle ese dato.\n`);
  console.log(linea(['', 'Matrícula', 'Vehículo', 'Últ. revis.', 'Odóm. hoy', 'Km/mes', 'Aviso']));
  raya();
  sinRev.sort((a, b) => (b.km ?? -1) - (a.km ?? -1)).forEach(f => {
    const notas = [
      f.revSospechosa ? '⚠ revisión imposible' : '',
      f.odom == null ? 'sin CAN' : '',
      SEG && !f.enSeguimiento ? 'fuera de lista' : '',
      f.estadoMapon === 'nodata' || f.estadoMapon === 'nogps' ? `(${f.estadoMapon})` : '',
      bd ? (f.enBD ? (f.baja ? 'BAJA' : '') : 'no en flota') : '',
    ].filter(Boolean).join(' · ');
    console.log(linea([
      ' ', f.matricula, f.vehiculo.slice(0, 22),
      f.kmRev == null ? '—' : num(f.kmRev),
      f.odom == null ? '—' : num(f.odom),
      f.km == null ? '—' : num(f.km),
      notas,
    ]));
  });

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log(`\n\n📊 RESUMEN`);
  console.log(`   Unidades en Mapon .................. ${unidades.size}`);
  if (SEG) {
    const vistas = new Set(filas.map(f => f.mat));
    const faltan = [...SEG].filter(m => !vistas.has(m)).sort();
    console.log(`   De la lista de seguimiento ......... ${SEG.size}, Mapon ve ${SEG.size - faltan.length}`);
    console.log(`   De la lista SIN unidad en Mapon .... ${faltan.length}${faltan.length ? ': ' + faltan.join(', ') : ''}`);
  }
  const sinCan = visibles.filter(f => f.odom == null && PLACA.test(f.mat));
  console.log(`   Con odómetro real (CAN) ............ ${visibles.filter(f => f.odom != null).length}`);
  console.log(`   SIN odómetro real .................. ${sinCan.length}${sinCan.length ? ': ' + sinCan.map(f => f.matricula).join(', ') : ''}`);
  console.log(`   Con km de su última revisión ....... ${visibles.filter(f => f.kmRev != null).length}`);
  console.log(`   ▲ TOCAN REVISIÓN ................... ${tocan.length}${tocan.length ? ': ' + tocan.map(f => f.matricula).join(', ') : ''}`);

  const sospechosas = visibles.filter(f => f.revSospechosa);
  if (sospechosas.length) {
    console.log(`\n⚠️  ${sospechosas.length} dato(s) de revisión que no pueden ser:`);
    sospechosas.forEach(f => console.log(`   · ${f.matricula}: revisión a ${num(f.kmRev)}, odómetro hoy ${num(f.odom)} → ${num(f.desde)} km desde entonces`));
  }

  const sinPlaca = filas.filter(f => !PLACA.test(f.mat) && (f.km || 0) > 0);
  if (sinPlaca.length) {
    console.log(`\n⚠️  ${sinPlaca.length} unidad(es) que ruedan SIN matrícula española en Mapon:`);
    sinPlaca.sort((a, b) => b.km - a.km).forEach(f =>
      console.log(`   · unit ${f.unitId} «${f.matricula}» — ${num(f.km)} km este mes` +
        (f.odom != null ? `, odómetro ${num(f.odom)}` : ', sin odómetro')));
  }

  const porPlaca = new Map();
  filas.forEach(f => { if (PLACA.test(f.mat)) { if (!porPlaca.has(f.mat)) porPlaca.set(f.mat, []); porPlaca.get(f.mat).push(f); } });
  const dobles = [...porPlaca.entries()].filter(([, v]) => v.length > 1);
  if (dobles.length) {
    console.log(`\n⚠️  ${dobles.length} matrícula(s) en DOS unidades de Mapon (sus km salen partidos):`);
    dobles.forEach(([k, v]) => console.log(`   · ${k} → ` +
      v.map(f => `unit ${f.unitId} (${num(f.km ?? 0)} km/mes)`).join(' vs ')));
  }

  const fallidas = visibles.filter(f => f.error);
  if (fallidas.length) {
    console.log(`\n⚠️  ${fallidas.length} unidad(es) sin recorrido:`);
    fallidas.forEach(f => console.log(`   · ${f.matricula} — ${f.error}`));
  }

  // ── CSV ────────────────────────────────────────────────────────────────────
  if (args.csv) {
    const esN = n => (n == null ? '' : String(Math.round(n * 10) / 10).replace('.', ','));
    const texto = [
      ['Matricula', 'Vehiculo', 'Unit ID', 'Km ultima revision', 'Odometro hoy (CAN)',
        'Km desde revision', 'Km ultimo mes', 'Km/dia', 'Km GPS desde instalacion',
        'Estado Mapon', 'En lista', 'Toca revision', 'Aviso'].join(';'),
      ...visibles.map(f => [
        f.matricula, f.vehiculo, f.unitId,
        esN(f.kmRev), esN(f.odom), f.revSospechosa ? '' : esN(f.desde),
        esN(f.km), esN(f.km == null ? null : f.km / DIAS), esN(f.gps),
        f.estadoMapon || '', f.enSeguimiento ? 'si' : 'no',
        f.desde != null && !f.revSospechosa && f.desde >= UMBRAL ? 'SI' : '',
        f.revSospechosa ? 'dato de revision imposible' : (f.odom == null ? 'sin odometro CAN' : ''),
      ].join(';')),
    ].join('\n');
    fs.writeFileSync(args.csv, '﻿' + texto, 'utf8');
    console.log(`\n💾 ${args.csv}`);
  }
}

main()
  .then(() => (db.HAY_BD ? db.cerrar() : null))
  .catch(e => { console.error('\n❌', e.message); process.exit(1); });
