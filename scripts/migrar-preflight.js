// ============================================================
// PRE-VUELO de la migración — SIN base de datos
// ============================================================
// Predice el resultado del cargador ANTES de tocar la base: como tras el reset los
// conductores serán exactamente PLANTILLA + ETT, se puede cruzar EN MEMORIA quién
// casará (vacaciones por DNI, bajas por NAF, justificantes por teléfono) y avisar de
// los datos sucios. Cero conexión: solo lee migracion.xlsx (+ el TSV de justificantes
// si está). Es el "qué va a pasar" que el --dry real confirmará contra la base.
//
//   node scripts/migrar-preflight.js
//   node scripts/migrar-preflight.js --xlsx <ruta> --just <ruta.tsv>

const path = require('path');
const fs = require('fs');
const L = require('./migrar-plantilla');   // reusa leerXlsx + los parsers (no migra al requerirse)

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const JUST = opt('--just', path.join(__dirname, 'datos', 'justificantes.tsv'));

const txt = v => { if (v == null) return ''; if (typeof v === 'object') v = v.text ?? v.result ?? v; return String(v).trim(); };
const up = s => txt(s).toUpperCase();
const muestra = (arr, n = 6) => arr.slice(0, n).map(x => '     · ' + x).join('\n');
const pct = (a, b) => b ? ` (${Math.round(a / b * 100)}%)` : '';

(async () => {
  const { plantilla, bajas, vacaciones, ett } = await L.leerXlsx();
  console.log(`📄 ${plantilla.length} PLANTILLA · ${ett.length} ETT · ${bajas.length} BAJAS · ${vacaciones.length} VACACIONES`);

  // ── Identidad que existirá tras cargar: DNIs, NAFs y teléfonos ──────────────
  const dnis = new Map();      // dni -> primera fila (para detectar duplicados)
  const nafs = new Set();      // naf en dígitos
  const tels = new Set();      // sufijo9
  const dupDni = [];

  const meterDni = (dni, quien, fila, hoja) => {
    const k = up(dni); if (!k) return;
    if (dnis.has(k)) dupDni.push(`${hoja} f${fila}: DNI ${k} repetido (${quien}) — ya está en ${dnis.get(k)}`);
    else dnis.set(k, `${hoja} f${fila} ${quien}`);
  };

  // PLANTILLA (propios): DNI + NAF + teléfono
  const badAltaP = [], sinDniP = [], sinNafP = [], sinTelP = [];
  plantilla.forEach(x => {
    const dni = txt(x.c5), quien = txt(x.c8);
    const alta = L.fecha(x.c33);
    if (!dni) sinDniP.push(`f${x._fila}: ${quien} sin DNI`); else meterDni(dni, quien, x._fila, 'PLANTILLA');
    if (!alta || alta.malo) badAltaP.push(`f${x._fila}: ${quien} alta "${txt(x.c33)}"`);
    const naf = (txt(x.c10) + txt(x.c11) + txt(x.c12)).replace(/[^0-9]/g, '');
    if (naf) nafs.add(naf); else sinNafP.push(`f${x._fila}: ${quien} sin NAF`);
    const s9 = L.sufijo9(x.c28);
    if (s9) tels.add(s9); else sinTelP.push(`f${x._fila}: ${quien} sin teléfono`);
  });

  // ETT: DNI (sin teléfono a propósito)
  const badAltaE = [], sinDniE = [];
  ett.forEach(x => {
    const dni = txt(x.c2), quien = txt(x.c1);
    const alta = L.fecha(x.c3);
    if (!dni) sinDniE.push(`f${x._fila}: ${quien} sin DNI`); else meterDni(dni, quien, x._fila, 'ETT');
    if (!alta || alta.malo) badAltaE.push(`f${x._fila}: ${quien} ingreso "${txt(x.c3)}"`);
  });

  // ── Cruces (lo que casará en el --go) ──────────────────────────────────────
  // VACACIONES por DNI
  const vacOK = [], vacHuerf = [], vacBad = [];
  vacaciones.forEach(x => {
    const dni = up(x.c3), quien = txt(x.c1), d = L.fecha(x.c4), h = L.fecha(x.c5);
    if (!d || d.malo || (h && h.malo)) { vacBad.push(`f${x._fila}: ${quien} fechas "${txt(x.c4)}".."${txt(x.c5)}"`); return; }
    if (!dni) { vacHuerf.push(`f${x._fila}: ${quien} sin DNI`); return; }
    (dnis.has(dni) ? vacOK : vacHuerf).push(`${quien} (${dni})`);
  });

  // BAJAS por NAF
  const bajaOK = [], bajaHuerf = [], bajaBad = [];
  bajas.forEach(x => {
    const naf = txt(x.c3).replace(/[^0-9]/g, ''), quien = txt(x.c4), d = L.fecha(x.c6), h = L.fecha(x.c7);
    if (!d || d.malo || (h && h.malo)) { bajaBad.push(`f${x._fila}: ${quien} fecha "${txt(x.c6)}"`); return; }
    if (!naf) { bajaHuerf.push(`f${x._fila}: ${quien} sin NAF`); return; }
    (nafs.has(naf) ? bajaOK : bajaHuerf).push(`${quien} (${naf})`);
  });

  // JUSTIFICANTES por teléfono (si hay TSV)
  let just = null;
  if (fs.existsSync(JUST)) {
    const lineas = fs.readFileSync(JUST, 'utf8').split(/\r?\n/).filter(l => l.trim());
    const cab = lineas[0].split('\t').map(s => s.trim().toUpperCase());
    const iF = cab.indexOf('FECHA'), iN = cab.indexOf('NOMBRE'), iT = cab.indexOf('TELEFONO'), iO = cab.indexOf('OBSERVACION');
    const ok = [], huerf = [], bad = [], sinTel = [], sinObs = [];
    lineas.slice(1).forEach((l, k) => {
      const c = l.split('\t'), quien = (c[iN] || '').trim(), s9 = L.sufijo9(c[iT]), d = L.fecha(c[iF]);
      if (!d || d.malo) { bad.push(`f${k + 2}: ${quien} fecha "${c[iF]}"`); return; }
      if (!s9) { sinTel.push(`f${k + 2}: ${quien}`); return; }
      if (!(c[iO] || '').trim()) { sinObs.push(`f${k + 2}: ${quien}`); return; }
      (tels.has(s9) ? ok : huerf).push(`${quien} (${s9})`);
    });
    just = { total: lineas.length - 1, ok, huerf, bad, sinTel, sinObs };
  }

  // ── Informe ────────────────────────────────────────────────────────────────
  const bloque = (t, filas, det = {}) => {
    console.log(`\n### ${t}`);
    for (const [k, v] of Object.entries(det)) if (v.length) {
      console.log(`   ⚠️  ${k}: ${v.length}`);
      const s = muestra(v); if (s) console.log(s);
    }
  };

  console.log(`\n================  PRE-VUELO (sin base de datos)  ================`);
  bloque(`PLANTILLA propios: ${plantilla.length}`, {}, {
    'sin DNI': sinDniP, 'alta inválida': badAltaP, 'sin NAF (no casarán sus bajas)': sinNafP, 'sin teléfono (no casarán sus justificantes ni BOLT)': sinTelP,
  });
  bloque(`ETT: ${ett.length}`, {}, { 'sin DNI': sinDniE, 'ingreso inválido': badAltaE });
  bloque(`DNIs duplicados (PLANTILLA∪ETT) — gana el primero, el resto NO se crea`, {}, { 'duplicados': dupDni });
  bloque(`VACACIONES: ${vacaciones.length} → CASAN ${vacOK.length}${pct(vacOK.length, vacaciones.length)}`, {}, {
    'NO casan (DNI no está en plantilla)': vacHuerf, 'fechas basura': vacBad,
  });
  bloque(`BAJAS: ${bajas.length} → CASAN ${bajaOK.length}${pct(bajaOK.length, bajas.length)}`, {}, {
    'NO casan (NAF no está en plantilla)': bajaHuerf, 'fechas basura': bajaBad,
  });
  if (just) bloque(`JUSTIFICANTES: ${just.total} → CASAN ${just.ok.length}${pct(just.ok.length, just.total)}`, {}, {
    'NO casan (teléfono no está en plantilla)': just.huerf, 'sin teléfono': just.sinTel, 'sin observación': just.sinObs, 'fecha basura': just.bad,
  });
  else console.log(`\n### JUSTIFICANTES: (sin TSV en ${JUST} — guárdalos ahí y re-corre el pre-vuelo)`);

  console.log(`\nEsto es la PREDICCIÓN. El --dry/--go real lo confirma contra la base ya cargada.`);
  process.exit(0);
})().catch(e => { console.error('❌ PRE-VUELO:', e.message); process.exit(1); });
