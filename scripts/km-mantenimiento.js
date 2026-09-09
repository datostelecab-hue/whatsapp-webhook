// ============================================================
// CONTROL DE MANTENIMIENTO POR KM — quién ha pasado del umbral
// ============================================================
//   node scripts/km-mantenimiento.js
//   node scripts/km-mantenimiento.js --dias=31 --umbral=15000 --csv=salida.csv
//   node scripts/km-mantenimiento.js --verificar=1194LCK     (diagnóstico)
//
// Responde a una pregunta muy concreta: de los coches que tenemos en Mapon,
// cuáles han rodado más de UMBRAL km en el último mes y por tanto tocan
// revisión.
//
// ── De dónde sale cada número ────────────────────────────────────────────────
//   · Odómetro de HOY       → unit/list.json, campo `mileage`, en METROS. Una
//     sola llamada para toda la flota.
//   · Km del PERIODO        → route/list.json por unidad, sumando los trayectos
//     de tipo `route`. Es lo mismo que ya usa kmEnVentana() en producción.
//   · Odómetro de HACE UN MES → el de hoy MENOS los km del periodo.
//
// Lo último merece explicación. Nosotros no guardamos histórico de odómetros:
// `vehiculo.km_odometro_m` se PISA en cada sincronización (cada 30 min), así que
// no hay ninguna foto de hace un mes que consultar. Mapon sí tiene histórico
// (unit_data/history_point.json y can_period.json), pero esos endpoints no están
// probados contra esta cuenta y dependen del CAN de cada coche; route/list sí
// está probado. Por eso la reconstrucción va por resta, y el odómetro de hace un
// mes es un DERIVADO, no una lectura. Lo que decide la revisión —los km rodados
// en el periodo— es medido, no derivado.
//
// Para comprobar si el histórico de Mapon nos serviría (y dejar de restar), está
// --verificar=MATRICULA: pide el punto histórico de esa unidad a la fecha de
// inicio y enseña la respuesta cruda.
//
// ── Aviso sobre el umbral ────────────────────────────────────────────────────
// Un mantenimiento de verdad se mide desde la ÚLTIMA REVISIÓN, no desde una
// fecha redonda. Mientras no tengamos esa fecha por coche, el mes es la
// referencia que hay. Este script no sustituye a ese dato: lo suple.

const path = require('path');
const fs = require('fs');

const mapon = require(path.join(__dirname, '..', 'services', 'mapon'));
const db = require(path.join(__dirname, '..', 'services', 'db'));

const CONC = 3;                  // Mapon admite 5 concurrentes; dejamos hueco al cron
const ZONA = 'Europe/Madrid';

// ── Argumentos ───────────────────────────────────────────────────────────────
const args = {};
process.argv.slice(2).forEach(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? '1' : m[2];
});
const DIAS = Math.min(Number(args.dias) || 31, mapon.MAX_DIAS);
const UMBRAL = Number(args.umbral) || 15000;

// useGrouping 'always': en es-ES los números de 4 cifras no llevan punto por
// convención, y en una columna de odómetros eso descuadra la vista.
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

// ── Diagnóstico: ¿nos sirve el histórico de Mapon? ───────────────────────────
async function verificarHistorico(matricula, iso) {
  const u = await mapon.unidadPorMatricula(matricula);
  if (!u) return console.error(`No hay unidad en Mapon con matrícula ${matricula}`);
  const url = `https://mapon.com/api/v1/unit_data/history_point.json` +
    `?key=${process.env.MAPON_API_KEY}&unit_id=${u.unitId}&datetime=${encodeURIComponent(iso)}`;
  const r = await fetch(url);
  const j = await r.json();
  console.log(`\nunit_data/history_point.json — ${matricula} (unit ${u.unitId}) a ${iso}:\n`);
  console.log(JSON.stringify(j, null, 2));
}

// ── Flota nuestra (opcional: solo si hay DATABASE_URL) ───────────────────────
async function leerFlota() {
  if (!db.HAY_BD) return null;
  const r = await db.consulta(`
    SELECT v.id, v.matricula, v.marca_modelo, v.estado_operativo,
           e.etiqueta AS estado_etiqueta, v.baja_at,
           v.km_odometro_m, to_char(v.km_odometro_at, 'YYYY-MM-DD HH24:MI') AS odometro_at,
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
  const fromTs = Math.floor(ini.getTime() / 1000);
  const tillTs = Math.floor(fin.getTime() / 1000);

  if (args.verificar) {
    await verificarHistorico(args.verificar, ini.toISOString().replace(/\.\d+Z$/, 'Z'));
    return;
  }

  console.log(`\n📏 CONTROL DE MANTENIMIENTO POR KM`);
  console.log(`   Periodo: ${fecha(ini)} → ${fecha(fin)}  (${DIAS} días)`);
  console.log(`   Umbral de revisión: ${num(UMBRAL)} km\n`);

  const unidades = await mapon.unidades();
  if (!unidades.size) throw new Error('Mapon no devolvió ninguna unidad');
  console.log(`   ${unidades.size} unidades en Mapon. Pidiendo el recorrido de cada una…`);

  const flota = await leerFlota();
  const porMatricula = new Map();
  const porUnit = new Map();
  (flota || []).forEach(v => {
    porMatricula.set(normMat(v.matricula), v);
    if (v.unit_id) porUnit.set(String(v.unit_id), v);
  });

  const filas = [];
  let hechas = 0;
  await enParalelo([...unidades.entries()], CONC, async ([unitId, u]) => {
    let km = null, trayectos = null, error = null;
    try {
      const r = await mapon.kmEnVentana({ unitId, fromTs, tillTs });
      km = r.km; trayectos = r.trayectos;
    } catch (e) {
      error = e.message;
    }
    const nuestro = porUnit.get(String(unitId)) || porMatricula.get(normMat(u.matricula)) || null;
    const odoHoy = Number.isFinite(u.odometroM) && u.odometroM > 0 ? u.odometroM / 1000 : null;
    // Un odómetro menor que los km del propio mes es imposible: o está puesto a
    // mano en Mapon, o se reseteó. No se inventa la resta: se marca.
    const antes = odoHoy != null && km != null ? odoHoy - km : null;
    filas.push({
      unitId,
      matricula: u.matricula,
      vehiculo: u.vehiculo,
      estadoMapon: u.estado,
      ultimoDato: u.ultimoDato,
      km, trayectos, error,
      odoHoy,
      odoAntes: antes != null && antes >= 0 ? antes : null,
      odoIncoherente: antes != null && antes < 0,
      enFlota: !!nuestro,
      enlazado: porUnit.has(String(unitId)),
      estadoNuestro: nuestro ? (nuestro.estado_etiqueta || nuestro.estado_operativo) : null,
      baja: nuestro ? !!nuestro.baja_at : false,
      modeloNuestro: nuestro ? nuestro.marca_modelo : null,
    });
    if (++hechas % 25 === 0) console.log(`   … ${hechas}/${unidades.size}`);
  });

  filas.sort((a, b) => (b.km ?? -1) - (a.km ?? -1));

  const conDato = filas.filter(f => f.km != null);
  const pasan = conDato.filter(f => f.km >= UMBRAL);
  const fallidas = filas.filter(f => f.error);

  // ── Tabla ──────────────────────────────────────────────────────────────────
  const cab = ['', 'Matrícula', 'Vehículo', 'Km del mes', 'Km/día', 'Odóm. hoy', 'Hace 1 mes', 'Estado'];
  const anchos = [3, 10, 24, 11, 7, 11, 11, 18];
  const linea = c => c.map((x, i) => (i >= 3 && i <= 6 ? String(x).padStart(anchos[i]) : String(x).padEnd(anchos[i]))).join(' ');
  console.log('\n' + linea(cab));
  console.log('─'.repeat(anchos.reduce((a, b) => a + b + 1, 0)));

  filas.forEach((f, i) => {
    const marca = f.km != null && f.km >= UMBRAL ? '▲' : ' ';
    // Sin BD no se sabe si el coche es nuestro: la columna se deja en blanco.
    // Poner "no en flota" sin haber mirado sería afirmar lo que no se ha visto.
    const estado = [
      !flota ? '' : f.enFlota ? (f.baja ? 'BAJA' : (f.estadoNuestro || '')) : 'no en flota',
      f.estadoMapon === 'nodata' || f.estadoMapon === 'nogps' ? `(${f.estadoMapon})` : '',
    ].filter(Boolean).join(' ');
    console.log(linea([
      marca, f.matricula, (f.modeloNuestro || f.vehiculo || '').slice(0, 24),
      f.km == null ? '—' : num(f.km),
      f.km == null ? '—' : num(f.km / DIAS),
      f.odoHoy == null ? '—' : num(f.odoHoy),
      f.odoAntes == null ? '—' : num(f.odoAntes),
      estado,
    ]));
    if (i === pasan.length - 1 && pasan.length) console.log('─'.repeat(anchos.reduce((a, b) => a + b + 1, 0)) + '  ↑ pasan del umbral');
  });

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log(`\n📊 RESUMEN`);
  console.log(`   Unidades en Mapon .................. ${unidades.size}`);
  console.log(`   Con recorrido leído ................ ${conDato.length}`);
  console.log(`   ▲ Pasan de ${num(UMBRAL)} km ............... ${pasan.length}`);
  if (conDato.length) {
    const total = conDato.reduce((a, f) => a + f.km, 0);
    console.log(`   Km rodados por toda la flota ....... ${num(total)} (media ${num(total / conDato.length)} por coche)`);
  }
  if (flota) {
    // "Sin Mapon" y "sin enlazar" no son lo mismo: el segundo SÍ tiene GPS, solo
    // le falta la fila en vehiculo_alias. Mezclarlos manda a buscar un GPS que
    // ya está puesto.
    const enMapon = new Set([...unidades.values()].map(u => normMat(u.matricula)));
    const alta = flota.filter(v => !v.baja_at && !v.unit_id);
    const sinEnlace = alta.filter(v => enMapon.has(normMat(v.matricula)));
    const sinGps = alta.filter(v => !enMapon.has(normMat(v.matricula)));
    const fueraDeFlota = filas.filter(f => !f.enFlota);
    const lista = a => a.length ? ': ' + a.map(x => x.matricula).join(', ') : '';
    console.log(`   De alta sin GPS en Mapon ........... ${sinGps.length}${lista(sinGps)}`);
    console.log(`   En Mapon pero sin enlazar .......... ${sinEnlace.length}${lista(sinEnlace)}`);
    console.log(`   Unidades Mapon que no son flota .... ${fueraDeFlota.length}${lista(fueraDeFlota)}`);
  } else {
    console.log(`   (sin DATABASE_URL: no se ha cruzado con nuestra flota)`);
  }
  if (fallidas.length) {
    console.log(`\n⚠️  ${fallidas.length} unidad(es) sin recorrido:`);
    fallidas.forEach(f => console.log(`   · ${f.matricula} — ${f.error}`));
  }
  // ── Identidad: sin esto, un listado de km no se puede llevar al taller ──────
  // La matrícula española de hoy son 4 cifras y 3 letras. Lo que no encaje ahí
  // es un coche que Mapon no sabe nombrar: o va con el número del dispositivo,
  // o con el bastidor, o con un guion.
  const PLACA = /^[0-9]{4}[A-Z]{3}$/;
  const sinPlaca = filas.filter(f => !PLACA.test(normMat(f.matricula)));
  const rodando = sinPlaca.filter(f => (f.km || 0) > 0);
  if (sinPlaca.length) {
    console.log(`\n⚠️  ${sinPlaca.length} unidad(es) sin matrícula española en Mapon` +
      (rodando.length
        ? `, y ${rodando.length} de ellas ${rodando.length === 1 ? 'HA RODADO' : 'HAN RODADO'} este mes:`
        : ' (ninguna ha rodado: parecen equipos sin instalar)'));
    rodando.sort((a, b) => b.km - a.km).forEach(f =>
      console.log(`   · unit ${f.unitId} «${f.matricula}» — ${num(f.km)} km este mes` +
        (f.odoHoy != null ? `, odómetro ${num(f.odoHoy)}` : '')));
  }

  // Dos unidades con la misma matrícula = un GPS viejo sin dar de baja, o una
  // matrícula mal escrita. Los km de ese coche están repartidos entre las dos.
  const porPlaca = new Map();
  filas.forEach(f => {
    const k = normMat(f.matricula);
    if (!PLACA.test(k)) return;
    if (!porPlaca.has(k)) porPlaca.set(k, []);
    porPlaca.get(k).push(f);
  });
  const dobles = [...porPlaca.entries()].filter(([, v]) => v.length > 1);
  if (dobles.length) {
    console.log(`\n⚠️  ${dobles.length} matrícula(s) en DOS unidades de Mapon (sus km salen partidos):`);
    dobles.forEach(([k, v]) => console.log(`   · ${k} → ` +
      v.map(f => `unit ${f.unitId} (${num(f.km ?? 0)} km, odóm. ${f.odoHoy == null ? '—' : num(f.odoHoy)})`).join(' vs ')));
  }

  const raros = filas.filter(f => f.odoIncoherente);
  if (raros.length) {
    console.log(`\n⚠️  ${raros.length} unidad(es) con el odómetro por debajo de sus propios km del mes ` +
      `(está puesto a mano en Mapon o se reseteó): ` +
      raros.map(f => `${f.matricula} (odóm. ${num(f.odoHoy)} < ${num(f.km)} km)`).join(', '));
  }
  const sinOdo = filas.filter(f => f.odoHoy == null);
  if (sinOdo.length) {
    console.log(`\n⚠️  ${sinOdo.length} unidad(es) sin odómetro en Mapon (los km del mes sí valen): ` +
      sinOdo.map(f => f.matricula).join(', '));
  }

  // ── CSV ────────────────────────────────────────────────────────────────────
  if (args.csv) {
    const esN = n => (n == null ? '' : String(n).replace('.', ','));
    const filasCsv = [
      ['Matricula', 'Vehiculo', 'Unit ID', 'Km periodo', 'Km/dia', 'Odometro hoy', 'Odometro hace 1 mes', 'Trayectos', 'Estado Mapon', 'Ultima senal', 'En flota', 'Estado nuestro', 'Revision'].join(';'),
      ...filas.map(f => [
        f.matricula, (f.modeloNuestro || f.vehiculo || ''), f.unitId,
        esN(f.km), esN(f.km == null ? null : Math.round(f.km / DIAS * 10) / 10),
        esN(f.odoHoy == null ? null : Math.round(f.odoHoy)),
        esN(f.odoAntes == null ? null : Math.round(f.odoAntes)),
        f.trayectos ?? '', f.estadoMapon || '', f.ultimoDato || '',
        f.enFlota ? 'si' : 'no', f.baja ? 'BAJA' : (f.estadoNuestro || ''),
        f.km != null && f.km >= UMBRAL ? 'SI' : '',
      ].join(';')),
    ].join('\n');
    fs.writeFileSync(args.csv, '﻿' + filasCsv, 'utf8');
    console.log(`\n💾 ${args.csv}`);
  }
}

main()
  .then(() => db.HAY_BD ? db.cerrar() : null)
  .catch(e => { console.error('\n❌', e.message); process.exit(1); });
