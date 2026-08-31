// ============================================================
// CARGA DEL TABLERO: plazas, asignaciones, turnos y libranzas
// ============================================================
//   node scripts/cargar-tablero.js [carpeta]
//
// Convierte las ~12.800 filas de PLANIFICADOR_V2 en el modelo relacional:
// cada coche tiene 6 PLAZAS (Día, Noche, CT1 Día, CT1 Noche, CT2 Día, CT2 Noche)
// y cada conductor sentado en una de ellas es una ASIGNACIÓN.
//
// FECHA DE INICIO: la hoja no guarda desde cuándo está cada conductor en su
// plaza, solo quién está ahora. Todas las asignaciones arrancan HOY. Inventar
// fechas pasadas sería peor que no tenerlas: falsearía la cobertura histórica
// y las auditorías creerían saber algo que nadie sabe.
//
// El turno del conductor y su patrón de libranza salen de AGENDA_V2, que es la
// que manda en lo operativo.

const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../services/db');
const { normClave } = require('../services/conductores');

const NL = String.fromCharCode(10);
const DIR = process.argv[2] || 'C:/Users/ricar/Downloads';
const LIBRO = 'Trafico 2.0.xlsx';
const HOY = new Date().toISOString().slice(0, 10);

const txt = v => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return txt(v.result);
    return '';
  }
  return String(v);
};
const s = v => txt(v).trim();
const matricula = v => {
  const x = s(v).toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /^[0-9]{4}[A-Z]{3}$/.test(x) ? x : null;
};

// Etiqueta de la hoja → número de plaza (cat_slot)
const SLOT = {
  'DÍA': 0, 'DIA': 0,
  'NOCHE': 1,
  'CT1 DÍA': 2, 'CT1 DIA': 2,
  'CT1 NOCHE': 3,
  'CT2 DÍA': 4, 'CT2 DIA': 4,
  'CT2 NOCHE': 5,
};
// Turno de la agenda → código del catálogo
const TURNO = { 'DÍA': 'dia', 'DIA': 'dia', 'NOCHE': 'noche', 'TODOTURNO': 'todoturno' };
// DIAS_TRABAJA viene como letras sueltas separadas por espacio: "X J", "S D".
// X es MIERCOLES (para no confundirlo con Martes). No confundir esta columna
// con TURNOS_LIBRES_COCHE, que es la de al lado y usa otro formato.
const DIAS = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 7 };

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(DIR, LIBRO));

  // ── 1) El tablero ──
  const ws = wb.getWorksheet('PLANIFICADOR_V2');
  const CAB = 8;
  const cab = (ws.getRow(CAB).values || []).slice(1).map(v => s(v).toUpperCase());
  const c = n => cab.indexOf(n) + 1;
  const iTurno = c('TURNO'), iMat = c('MATRICULA'), iBolt = c('ID_BOLT'), iDias = c('DIAS_TRABAJA');
  const iDesde = c('DESDE');

  const ocupaciones = [];           // { matricula, slot, idBolt, dias[] }
  const slotsRaros = new Map();
  ws.eachRow({ includeEmpty: false }, (r, ri) => {
    if (ri <= CAB) return;
    const m = matricula(r.getCell(iMat).value);
    if (!m) return;
    const et = s(r.getCell(iTurno).value).toUpperCase();
    const slot = SLOT[et];
    if (slot === undefined) { if (et) slotsRaros.set(et, (slotsRaros.get(et) || 0) + 1); return; }
    const idBolt = s(r.getCell(iBolt).value);
    // DIAS_TRABAJA solo tiene sentido en los correturnos.
    const dias = iDias ? s(r.getCell(iDias).value) : '';
    // La hoja SOLO trae DESDE en 18 filas. Donde la hay se respeta; donde no,
    // arranca hoy: inventar una fecha pasada falsearia la cobertura historica.
    const bruto = iDesde ? s(r.getCell(iDesde).value) : '';
    const desde = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(bruto) ? bruto.slice(0, 10) : null;
    ocupaciones.push({ matricula: m, slot, idBolt, dias, desde });
  });
  const conConductor = ocupaciones.filter(o => o.idBolt).length;
  console.log(`  PLANIFICADOR_V2: ${ocupaciones.length} plazas · ${conConductor} ocupadas`);
  if (slotsRaros.size) console.log('  ⚠️  etiquetas de turno no reconocidas: ' +
    [...slotsRaros].map(([k, n]) => JSON.stringify(k) + '×' + n).join(' '));

  // ── 2) Turno y libranzas desde AGENDA_V2 ──
  const wsA = wb.getWorksheet('AGENDA_V2');
  const cabA = (wsA.getRow(1).values || []).slice(1).map(v => s(v).toUpperCase());
  const cA = n => cabA.indexOf(n) + 1;
  const agenda = [];
  wsA.eachRow({ includeEmpty: false }, (r, ri) => {
    if (ri < 2) return;
    const nombre = s(r.getCell(cA('NOMBRE_APELLIDOS')).value);
    if (!nombre || !/[a-zá-úñ]/i.test(nombre)) return;
    const libra = [];
    for (const [ab, n] of Object.entries({ LUN: 1, MAR: 2, MIE: 3, JUE: 4, VIE: 5, SAB: 6, DOM: 7 })) {
      const col = cA('LIB_' + ab);
      if (col && /^(si|sí|s|true|1|x|l)$/i.test(s(r.getCell(col).value))) libra.push(n);
    }
    agenda.push({
      nombre, idBolt: s(r.getCell(cA('ID_BOLT')).value),
      turno: TURNO[s(r.getCell(cA('TURNO')).value).toUpperCase()] || null,
      libra,
    });
  });
  console.log(`  AGENDA_V2: ${agenda.length} conductores · ` +
    `${agenda.filter(a => a.turno).length} con turno · ${agenda.filter(a => a.libra.length).length} con libranza`);

  // ── 3) Índices de la base ──
  const vehiculos = new Map((await db.consulta(
    'SELECT id, matricula_norm FROM vehiculo WHERE baja_at IS NULL')).rows.map(r => [r.matricula_norm, r.id]));
  const turnos = new Map((await db.consulta('SELECT id, codigo FROM turno')).rows.map(r => [r.codigo, r.id]));

  // Conductores por alias normalizado: es justo para lo que existe esa tabla.
  const porAlias = new Map();
  for (const r of (await db.consulta(
    'SELECT conductor_id, alias_norm, ambiguo FROM conductor_alias')).rows) {
    if (r.ambiguo) { porAlias.set(r.alias_norm, null); continue; }   // ambiguo: no se resuelve
    if (!porAlias.has(r.alias_norm)) porAlias.set(r.alias_norm, r.conductor_id);
  }
  const resolver = nombre => {
    const k = normClave(nombre);
    return k ? porAlias.get(k) ?? null : null;
  };
  console.log(`  en la base: ${vehiculos.size} coches · ${porAlias.size} alias de conductor`);

  // ── 4) A la base ──
  let nPlazas = 0, nAsig = 0, conFechaReal = 0, nAsigDia = 0, nTurnos = 0, nPatrones = 0, nPatDia = 0;
  const avisos = [];
  const sinResolver = new Set();

  await db.transaccion(async cli => {
    const intentar = async (sql, params, alFallar) => {
      await cli.query('SAVEPOINT sp');
      try { const r = await cli.query(sql, params); await cli.query('RELEASE SAVEPOINT sp'); return r; }
      catch (err) { await cli.query('ROLLBACK TO SAVEPOINT sp'); if (alFallar) alFallar(err); return null; }
    };

    // 4a) Las 6 plazas de cada coche
    const idPlaza = new Map();     // 'matricula|slot' -> id
    for (const [matNorm, vehId] of vehiculos) {
      for (let slot = 0; slot < 6; slot++) {
        const r = await intentar(
          `INSERT INTO plaza (vehiculo_id, slot, orden_pantalla) VALUES ($1,$2,$3) RETURNING id`,
          [vehId, slot, slot], () => {});
        if (r) { idPlaza.set(matNorm + '|' + slot, r.rows[0].id); nPlazas++; }
      }
    }

    // 4b) Asignaciones
    for (const o of ocupaciones) {
      if (!o.idBolt) continue;
      const plazaId = idPlaza.get(o.matricula + '|' + o.slot);
      if (!plazaId) { avisos.push(`Plaza inexistente: ${o.matricula} slot ${o.slot}`); continue; }
      const condId = resolver(o.idBolt);
      if (!condId) { sinResolver.add(o.idBolt); continue; }

      const r = await intentar(
        `INSERT INTO asignacion (plaza_id, conductor_id, desde, desde_declarado) VALUES ($1,$2,$3,$4) RETURNING id`,
        [plazaId, condId, o.desde || HOY, o.desde],
        err => avisos.push(`Asignacion rechazada (${o.matricula} slot ${o.slot}): ${err.message.split(NL)[0]}`));
      if (!r) continue;
      nAsig++;
      if (o.desde) conFechaReal++;

      // Días del correturno: '(D) Sáb · (N) Dom' → 6, 7
      if (o.slot >= 2 && o.dias) {
        const nums = [...new Set(
          o.dias.toUpperCase().split(/[^A-Z]+/).filter(Boolean)
            .map(x => DIAS[x]).filter(Boolean))];
        for (const n of nums) {
          const d = await intentar(
            `INSERT INTO asignacion_dia (asignacion_id, dia_semana) VALUES ($1,$2)`,
            [r.rows[0].id, n], () => {});
          if (d) nAsigDia++;
        }
        if (!nums.length) avisos.push(`Dias no entendidos (${o.matricula}): ${JSON.stringify(o.dias)}`);
      }
    }

    // 4c) Turno operativo y patrón de libranza
    for (const a of agenda) {
      const condId = resolver(a.idBolt || a.nombre);
      if (!condId) { sinResolver.add(a.idBolt || a.nombre); continue; }

      if (a.turno && turnos.has(a.turno)) {
        const t = await intentar(
          `INSERT INTO conductor_turno_hist (conductor_id, turno_id, desde, origen)
           VALUES ($1,$2,$3,'migracion')`,
          [condId, turnos.get(a.turno), HOY], () => {});
        if (t) nTurnos++;
      }

      if (a.libra.length) {
        const p = await intentar(
          `INSERT INTO patron_libranza (conductor_id, desde) VALUES ($1,$2) RETURNING id`,
          [condId, HOY], () => {});
        if (p) {
          nPatrones++;
          for (const d of a.libra) {
            const x = await intentar(
              `INSERT INTO patron_libranza_dia (patron_id, dia_semana) VALUES ($1,$2)`,
              [p.rows[0].id, d], () => {});
            if (x) nPatDia++;
          }
        }
      }
    }
  });

  console.log(NL + '══ EN LA BASE ══');
  console.log(`  plazas ${nPlazas} · asignaciones ${nAsig} · días de correturno ${nAsigDia}`);
  console.log(`  ${conFechaReal} con fecha real de la hoja · ${nAsig - conFechaReal} arrancan hoy (${HOY})`);
  console.log(`  turnos ${nTurnos} · patrones de libranza ${nPatrones} (${nPatDia} días)`);

  const q = await db.consulta(`
    SELECT t.etiqueta AS turno, s.rol,
           count(p.id) plazas, count(a.id) ocupadas
    FROM cat_slot s JOIN turno t ON t.id = s.turno_id
    LEFT JOIN plaza p ON p.slot = s.slot AND p.baja_at IS NULL
    LEFT JOIN asignacion a ON a.plaza_id = p.id AND a.hasta IS NULL
    GROUP BY t.etiqueta, s.rol, s.slot ORDER BY s.slot`);
  console.log('');
  q.rows.forEach(r => console.log(
    `  ${(r.turno + ' ' + r.rol).padEnd(14)} ${String(r.ocupadas).padStart(3)} de ${r.plazas}`));

  if (sinResolver.size) {
    console.log(NL + `══ ${sinResolver.size} nombres del tablero que NO cruzan con ningún conductor ══`);
    [...sinResolver].slice(0, 15).forEach(n => console.log('  · ' + n));
    if (sinResolver.size > 15) console.log(`  … y ${sinResolver.size - 15} más`);
  }
  if (avisos.length) {
    console.log(NL + `══ ${avisos.length} avisos ══`);
    avisos.slice(0, 10).forEach(a => console.log('  · ' + a));
  }
  await db.cerrar();
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
