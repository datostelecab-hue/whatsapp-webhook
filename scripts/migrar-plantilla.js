// ============================================================
// MIGRACIÓN DE LA PLANTILLA REAL — de migracion.xlsx (+ justificantes) a PostgreSQL
// ============================================================
// Carga la plantilla de verdad en las tablas de dominio (conductor, periodos,
// estados, teléfonos) REUTILIZANDO las funciones validadas del repo — no inserts
// crudos, salvo los estados históricos (rangos con desde/hasta que la app solo
// crea "abiertos"). Todo por conductor_id; el enlace a BOLT se rehace por teléfono.
//
// ARRANCA EN SECO: sin --go NO escribe nada, solo parsea, cruza y reporta (cuántos
// entran, cuántos no casan, filas con fechas basura, solapes...). Así se valida el
// resultado ANTES de tocar producción.
//
//   node scripts/migrar-plantilla.js                 # DRY: solo informe
//   node scripts/migrar-plantilla.js --go            # ESCRIBE de verdad
//   node scripts/migrar-plantilla.js --xlsx <ruta> --just <ruta.tsv>
//
// El reset (borrar dominio, conservar el núcleo) va aparte: NO lo hace este script.

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const db = require('../services/db');
const con = require('../services/repo/conductores');
const alta = require('../services/repo/alta');
const repoJust = require('../services/repo/justificantes');

// ── Argumentos ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const GO = args.includes('--go');
const opt = (n, def) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const XLSX = opt('--xlsx', 'C:/Users/ricar/Downloads/migracion.xlsx');
const JUST = opt('--just', path.join(__dirname, 'datos', 'justificantes.tsv'));
const QUIEN = { usuarioId: null, rol: 'superadmin' };   // la migración corre con permisos totales

// ── Parsers robustos (los datos vienen sucios) ───────────────────────────────
const txt = v => { if (v == null) return ''; if (typeof v === 'object') v = v.text ?? v.result ?? v; return String(v).trim(); };

// Fecha → 'AAAA-MM-DD' o null. Acepta: Date de JS, "Thu Apr 21 2022 ...", "dd/mm/aaaa".
// Descarta basura: "00/00/0000", años imposibles (< 2000 o > 2100), fechas no válidas.
function fecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return iso(v);
  const s = txt(v);
  if (!s || /^0{2}\/0{2}\/0{4}$/.test(s)) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);   // dd/mm/aaaa
  if (m) {
    let [, d, mo, y] = m; y = Number(y); if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, Number(mo) - 1, Number(d)));
    return valida(dt) && dt.getUTCDate() === Number(d) ? iso(dt) : { malo: s };
  }
  const dt = new Date(s);                                 // "Thu Apr 21 2022 ..."
  return valida(dt) ? iso(dt) : { malo: s };
}
const iso = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
// Rango 1920–2100: cubre fechas de nacimiento y descarta basura como el año "0206".
const valida = d => d instanceof Date && !isNaN(d) && d.getUTCFullYear() >= 1920 && d.getUTCFullYear() <= 2100;

// Horas "3,2" → 3.2 · "" → null · "0" → 0
function horas(v) {
  const s = txt(v).replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "APELLIDOS, Nombre" → { apellidos, nombre }. Sin coma: todo va a nombre.
function nombreApellidos(s) {
  s = txt(s);
  const i = s.indexOf(',');
  if (i < 0) return { nombre: s, apellidos: null };
  return { apellidos: s.slice(0, i).trim(), nombre: s.slice(i + 1).trim() };
}

// Sufijo de 9 dígitos (como cruza el bot y toda la app). null si no llega a 9.
function sufijo9(v) { const d = txt(v).replace(/[^0-9]/g, ''); return d.length >= 9 ? d.slice(-9) : null; }
// Teléfono en algo parecido a E.164 para guardar (deja el + si venía).
function telE164(v) { const s = txt(v).replace(/[^0-9+]/g, ''); return s.replace(/\D/g, '').length >= 9 ? s : null; }
// NAF a solo dígitos, para comparar.
const nafDigitos = v => txt(v).replace(/[^0-9]/g, '') || null;

// ── Lectura del Excel ────────────────────────────────────────────────────────
async function leerXlsx() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const filas = (hoja, hdr) => {
    const ws = wb.getWorksheet(hoja);
    if (!ws) throw new Error(`No existe la hoja "${hoja}" en ${XLSX}`);
    const out = [];
    for (let r = hdr + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r); const o = { _fila: r }; let vacia = true;
      for (let c = 1; c <= ws.columnCount; c++) { const v = row.getCell(c).value; o['c' + c] = v; if (txt(v)) vacia = false; }
      if (!vacia) out.push(o);
    }
    return out;
  };
  return {
    plantilla: filas('PLANTILLA', 3),
    bajas: filas('BAJAS MEDICAS', 1),
    vacaciones: filas('VACACIONES', 1),
    ett: filas('PLANTILLA ETT', 1),
  };
}

// TSV de justificantes (el que pega Tráfico): cabecera + filas por TAB.
function leerJustificantes() {
  if (!fs.existsSync(JUST)) { console.warn(`⚠️  No encuentro el TSV de justificantes en ${JUST} (fase omitida)`); return null; }
  const lineas = fs.readFileSync(JUST, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const cab = lineas[0].split('\t').map(x => x.trim().toUpperCase());
  const idx = n => cab.indexOf(n);
  const iF = idx('FECHA'), iN = idx('NOMBRE'), iT = idx('TELEFONO'), iH = idx('HORAS'), iO = idx('OBSERVACION');
  return lineas.slice(1).map((l, k) => {
    const c = l.split('\t');
    return { _fila: k + 2, fecha: c[iF], nombre: (c[iN] || '').trim(), telefono: c[iT], horas: c[iH], observacion: (c[iO] || '').trim() };
  });
}

// ── Cruces contra la base ────────────────────────────────────────────────────
const idPorDni = async dni => (await db.consulta(
  `SELECT id FROM conductor WHERE upper(btrim(dni_nie)) = upper(btrim($1)) LIMIT 1`, [dni])).rows[0]?.id || null;
const idPorNaf = async naf => (await db.consulta(
  `SELECT id FROM conductor WHERE regexp_replace(naf,'[^0-9]','','g') = $1 LIMIT 1`, [naf])).rows[0]?.id || null;
const idPorTel = async s9 => (await db.consulta(
  `SELECT conductor_id FROM conductor_telefono WHERE sufijo9 = $1 ORDER BY (vigente_hasta IS NULL) DESC LIMIT 1`, [s9])).rows[0]?.conductor_id || null;

// Inserta un estado histórico (rango cerrado o abierto). Devuelve 'ok'|'solape'|'error'.
async function insertarEstado(conductorId, estado, desde, hasta) {
  try {
    await db.consulta(
      `INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta)
       VALUES ($1,$2,$3::date,$4::date)`, [conductorId, estado, desde, hasta]);
    return 'ok';
  } catch (e) {
    return /exclus|overlap|solap/i.test(e.message) ? 'solape' : ('error: ' + e.message);
  }
}

// ── Informe ──────────────────────────────────────────────────────────────────
const R = {};   // fase -> { ok, saltados:[], noCasan:[], solapes:[], errores:[] }
const rep = f => (R[f] = R[f] || { ok: 0, saltados: [], noCasan: [], solapes: [], errores: [] });
const linea = (m, x) => `f${x._fila}: ${m}`;

// ── FASE 1: conductores propios ──────────────────────────────────────────────
async function faseConductores(rows, esEtt) {
  const r = rep(esEtt ? 'ETT' : 'PROPIOS');
  for (const x of rows) {
    const dni = esEtt ? txt(x.c2) : txt(x.c5);
    const nomRaw = esEtt ? txt(x.c1) : txt(x.c8);
    const { nombre, apellidos } = nombreApellidos(nomRaw);
    const altaF = fecha(esEtt ? x.c3 : x.c33);
    const bajaF = fecha(esEtt ? x.c4 : x.c34);
    const estadoEtt = esEtt ? txt(x.c5).toUpperCase() : '';
    if (!nombre) { r.saltados.push(linea('sin nombre', x)); continue; }
    if (!altaF || altaF.malo) { r.saltados.push(linea(`alta inválida "${txt(esEtt ? x.c3 : x.c33)}"`, x)); continue; }

    const ficha = esEtt
      ? { nombre, apellidos, dni_nie: dni || null }
      : {
        nombre, apellidos, dni_nie: dni || null,
        dni_tipo: /N\.?I\.?E/i.test(txt(x.c4)) ? 'NIE' : 'DNI',
        fecha_nacimiento: dateOrNull(x.c9), sexo: txt(x.c13) || null, estado_civil: txt(x.c14) || null,
        naf_provincia: txt(x.c10) || null, naf_numero: txt(x.c11) || null, naf_control: txt(x.c12) || null,
        via_tipo: txt(x.c17) || null, via_nombre: txt(x.c18) || null, via_numero: txt(x.c19) || null,
        escalera: txt(x.c20) || null, piso: txt(x.c21) || null, puerta: txt(x.c22) || null,
        localidad: txt(x.c23) || null, codigo_postal: txt(x.c24) || null, provincia: txt(x.c25) || null,
        legajo: txt(x.c2) || null, email: txt(x.c29) || null,
      };
    const tel = esEtt ? null : telE164(x.c28);
    // ETT que "SIGUE TRABAJANDO" no lleva baja; el resto sí si viene fecha.
    const cierra = bajaF && !bajaF.malo && !(esEtt && /SIGUE/.test(estadoEtt)) ? bajaF : null;

    if (!GO) { r.ok++; continue; }
    try {
      const { id } = await con.crear({
        ...ficha, telefono: tel || undefined,
        tipo: esEtt ? 'ett' : 'propia', ettNombre: esEtt ? (process.env.ETT_NOMBRE || 'ETT') : undefined,
        alta: altaF, antiguedad: esEtt ? null : (dateOrNull(x.c41) || null),
        jornadaHoras: esEtt ? null : jornadaDe(txt(x.c36)),
      }, QUIEN);
      if (cierra) await con.darDeBaja(id, { fecha: cierra, motivo: 'Migración inicial' }, QUIEN);
      r.ok++;
    } catch (e) {
      (/(ya es de|ya tiene|ya está)/i.test(e.message) ? r.noCasan : r.errores).push(linea(`${nomRaw}: ${e.message}`, x));
    }
  }
}
const dateOrNull = v => { const f = fecha(v); return f && !f.malo ? f : null; };
const jornadaDe = c => /PARCIAL/i.test(c) ? 32 : /COMPLETO|COMPLETA|INDEFINIDO/i.test(c) ? 40 : null;

// ── FASE 2: estados (vacaciones por DNI, baja médica por NAF) ─────────────────
async function faseEstados(rows, tipo) {
  const r = rep(tipo === 'vacaciones' ? 'VACACIONES' : 'BAJAS');
  for (const x of rows) {
    const desde = tipo === 'vacaciones' ? fecha(x.c4) : fecha(x.c6);
    const hasta = tipo === 'vacaciones' ? fecha(x.c5) : fecha(x.c7);   // baja médica: hasta puede faltar (abierta)
    const clave = tipo === 'vacaciones' ? txt(x.c3) : nafDigitos(x.c3);
    const quien = tipo === 'vacaciones' ? txt(x.c1) : txt(x.c4);
    if (!desde || desde.malo) { r.saltados.push(linea(`desde inválido "${txt(tipo === 'vacaciones' ? x.c4 : x.c6)}"`, x)); continue; }
    if (hasta && hasta.malo) { r.saltados.push(linea(`hasta inválido "${txt(tipo === 'vacaciones' ? x.c5 : x.c7)}" (${quien})`, x)); continue; }
    if (!clave) { r.saltados.push(linea(`sin ${tipo === 'vacaciones' ? 'DNI' : 'NAF'} (${quien})`, x)); continue; }

    if (!GO) { r.ok++; continue; }
    const id = tipo === 'vacaciones' ? await idPorDni(clave) : await idPorNaf(clave);
    if (!id) { r.noCasan.push(linea(`no casa ${quien} (${clave})`, x)); continue; }
    const res = await insertarEstado(id, tipo === 'vacaciones' ? 'vacaciones' : 'baja_medica', desde, hasta || null);
    if (res === 'ok') r.ok++;
    else if (res === 'solape') r.solapes.push(linea(`${quien} ${desde}..${hasta || '—'}`, x));
    else r.errores.push(linea(`${quien}: ${res}`, x));
  }
}

// ── FASE 3: justificantes (por teléfono) ─────────────────────────────────────
async function faseJustificantes(rows) {
  const r = rep('JUSTIFICANTES');
  for (const x of rows) {
    const dia = fecha(x.fecha);
    const s9 = sufijo9(x.telefono);
    if (!dia || dia.malo) { r.saltados.push(linea(`fecha inválida "${x.fecha}" (${x.nombre})`, x)); continue; }
    if (!s9) { r.saltados.push(linea(`sin teléfono (${x.nombre})`, x)); continue; }   // p.ej. Iskren Petrov***
    if (!x.observacion) { r.saltados.push(linea(`sin observación (${x.nombre})`, x)); continue; }
    if (!GO) { r.ok++; continue; }
    const id = await idPorTel(s9);
    if (!id) { r.noCasan.push(linea(`no casa ${x.nombre} (${s9})`, x)); continue; }
    try {
      await repoJust.guardarPorId({ conductorId: id, diaIso: dia, horas: horas(x.horas) ?? '', observacion: x.observacion, usuarioId: null });
      r.ok++;
    } catch (e) { r.errores.push(linea(`${x.nombre}: ${e.message}`, x)); }
  }
}

// ── FASE 4: re-enlace BOLT por teléfono ──────────────────────────────────────
async function faseBolt() {
  const r = rep('BOLT');
  if (!GO) { const n = (await db.consulta(`SELECT count(*)::int c FROM conductor_telefono WHERE vigente_hasta IS NULL`)).rows[0].c; r.ok = n; return; }
  const tels = (await db.consulta(
    `SELECT DISTINCT ON (t.conductor_id) t.conductor_id, t.e164
       FROM conductor_telefono t WHERE t.vigente_hasta IS NULL ORDER BY t.conductor_id`)).rows;
  for (const t of tels) {
    try {
      const info = await alta.porTelefono(t.e164);
      if (info.bolt && !info.bolt.enlazadaCon) { await con.enlazarBolt(t.conductor_id, info.bolt.cuentaId, QUIEN); r.ok++; }
    } catch (e) { r.errores.push(`conductor ${t.conductor_id}: ${e.message}`); }
  }
}

// ── Informe final ────────────────────────────────────────────────────────────
function informe() {
  console.log(`\n================  ${GO ? 'MIGRACIÓN (ESCRITA)' : 'SIMULACRO (DRY — nada escrito)'}  ================`);
  for (const [fase, d] of Object.entries(R)) {
    console.log(`\n### ${fase}: ${d.ok} ${GO ? 'cargados' : 'listos'}` +
      `${d.noCasan.length ? ` · ${d.noCasan.length} NO CASAN` : ''}` +
      `${d.solapes.length ? ` · ${d.solapes.length} solapes` : ''}` +
      `${d.saltados.length ? ` · ${d.saltados.length} saltados` : ''}` +
      `${d.errores.length ? ` · ${d.errores.length} errores` : ''}`);
    const muestra = (t, arr) => { if (arr.length) console.log(`   ${t} (muestra):\n` + arr.slice(0, 8).map(s => '     · ' + s).join('\n')); };
    muestra('NO CASAN', d.noCasan); muestra('SOLAPES', d.solapes); muestra('SALTADOS', d.saltados); muestra('ERRORES', d.errores);
  }
  console.log(GO ? '\n✅ Migración escrita.' : '\n(DRY) Revisa lo de arriba. Cuando cuadre: --go');
}

module.exports = { fecha, horas, nombreApellidos, sufijo9, telE164, nafDigitos, jornadaDe, leerXlsx };

// Requerido como módulo (para tests) NO migra; solo al ejecutarlo directamente.
if (require.main === module) (async () => {
  if (!db.HAY_BD) throw new Error('Sin DATABASE_URL: este script necesita la base.');
  console.log(`📄 Excel: ${XLSX}\n📄 Justificantes: ${JUST}\n${GO ? '⚠️  MODO --go: ESCRIBE EN LA BASE' : '🧪 DRY: no escribe nada'}`);
  const { plantilla, bajas, vacaciones, ett } = await leerXlsx();
  const justis = leerJustificantes();
  console.log(`   PLANTILLA ${plantilla.length} · ETT ${ett.length} · BAJAS ${bajas.length} · VACACIONES ${vacaciones.length} · JUSTIF ${justis ? justis.length : 0}`);

  await faseConductores(plantilla, false);
  await faseConductores(ett, true);
  await faseEstados(vacaciones, 'vacaciones');
  await faseEstados(bajas, 'baja_medica');
  if (justis) await faseJustificantes(justis);
  await faseBolt();

  informe();
  process.exit(0);
})().catch(e => { console.error('❌ MIGRACIÓN:', e.message); process.exit(1); });
