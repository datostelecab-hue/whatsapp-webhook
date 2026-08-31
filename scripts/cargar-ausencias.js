// ============================================================
// CARGA DE AUSENCIAS desde la columna ESTADO de AGENDA_V2
// ============================================================
//   node scripts/cargar-ausencias.js [carpeta]
//
// La agenda solo dice en qué situación está cada uno HOY, no desde cuándo.
// Igual que con las asignaciones, las ausencias abiertas arrancan hoy: poner
// una fecha pasada sería inventarse cuánto lleva alguien de baja.
//
// El `hasta` queda NULL en todas. Es lo correcto: una baja médica no tiene
// fecha de fin conocida, y las vacaciones que ya están en curso tampoco la
// tienen aquí (la hoja no la guarda). Se cerrarán cuando la persona vuelva.

const path = require('path');
const ExcelJS = require('exceljs');
const db = require('../services/db');
const con = require('../services/repo/conductores');
const { normClave } = require('../services/conductores');

const NL = String.fromCharCode(10);
const DIR = process.argv[2] || 'C:/Users/ricar/Downloads';
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

// Lo que pone la hoja → código del catálogo. 'Activo' y 'Pendiente Asignar'
// NO son ausencias: no generan fila, porque lo normal no se registra.
//
// 'BAJA EMPRESA' está aquí pero NO es una ausencia: es que esa persona ya no
// trabaja aquí. Escribirla como estado —que es lo que se hacía— dejaba a la
// gente a medias: la ficha ponía "Baja en la empresa" y el contrato seguía
// abierto, así que el resto del sistema seguía contando con ella. Ahora esas
// filas causan baja de verdad, con la misma función que el botón de RRHH.
const ESTADO = {
  'BAJA MÉDICA': 'baja_medica', 'BAJA MEDICA': 'baja_medica',
  'VACACIONES': 'vacaciones',
  'PERMISO': 'permiso', 'PERMISO RETRIBUIDO': 'permiso',
  'SUSPENDIDO': 'suspendido',
  'BAJA EMPRESA': 'baja_empresa',
};

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(DIR, 'Trafico 2.0.xlsx'));
  const ws = wb.getWorksheet('AGENDA_V2');
  const cab = (ws.getRow(1).values || []).slice(1).map(v => s(v).toUpperCase());
  const c = n => cab.indexOf(n) + 1;

  const filas = [];
  const sinMapear = new Map();
  ws.eachRow({ includeEmpty: false }, (r, ri) => {
    if (ri < 2) return;
    const nombre = s(r.getCell(c('NOMBRE_APELLIDOS')).value);
    if (!nombre || !/[a-zá-úñ]/i.test(nombre)) return;
    const bruto = s(r.getCell(c('ESTADO')).value);
    if (!bruto) return;
    const cod = ESTADO[bruto.toUpperCase()];
    if (!cod) {
      // 'Activo' y 'Pendiente Asignar' entran aquí a propósito: no son ausencias.
      if (!/activo|pendiente/i.test(bruto)) sinMapear.set(bruto, (sinMapear.get(bruto) || 0) + 1);
      return;
    }
    filas.push({ nombre, idBolt: s(r.getCell(c('ID_BOLT')).value), estado: cod, bruto });
  });

  const porEstado = {};
  filas.forEach(f => { porEstado[f.estado] = (porEstado[f.estado] || 0) + 1; });
  console.log(`  AGENDA_V2: ${filas.length} ausencias`);
  console.log('  ' + Object.entries(porEstado).map(([k, v]) => `${k}=${v}`).join(' · '));
  if (sinMapear.size) console.log('  ⚠️  estados sin mapear: ' +
    [...sinMapear].map(([k, n]) => JSON.stringify(k) + '×' + n).join(' '));

  // Conductores por alias
  const porAlias = new Map();
  for (const r of (await db.consulta('SELECT conductor_id, alias_norm, ambiguo FROM conductor_alias')).rows) {
    if (r.ambiguo) { porAlias.set(r.alias_norm, null); continue; }
    if (!porAlias.has(r.alias_norm)) porAlias.set(r.alias_norm, r.conductor_id);
  }
  const resolver = n => { const k = normClave(n); return k ? porAlias.get(k) ?? null : null; };

  let n = 0, bajas = 0;
  const sinResolver = [];
  const avisos = [];
  await db.transaccion(async cli => {
    const intentar = async (sql, params, alFallar) => {
      await cli.query('SAVEPOINT sp');
      try { const r = await cli.query(sql, params); await cli.query('RELEASE SAVEPOINT sp'); return r; }
      catch (err) { await cli.query('ROLLBACK TO SAVEPOINT sp'); if (alFallar) alFallar(err); return null; }
    };
    for (const f of filas) {
      const id = resolver(f.idBolt || f.nombre);
      if (!id) { sinResolver.push(f.nombre); continue; }
      const nota = 'Migración desde AGENDA_V2 (' + f.bruto + ')';

      // Irse no es una situación: se cierra el contrato, y con él el turno, las
      // libranzas y las asignaciones. Se llama a la misma función que usa RRHH
      // en vez de repetir aquí qué significa una baja.
      if (f.estado === 'baja_empresa') {
        await cli.query('SAVEPOINT sp');
        try {
          await con.darDeBaja(id, { fecha: HOY, motivo: nota }, { cli });
          await cli.query('RELEASE SAVEPOINT sp');
          bajas++;
        } catch (err) {
          await cli.query('ROLLBACK TO SAVEPOINT sp');
          avisos.push(`${f.nombre}: ${err.message.split(NL)[0]}`);
        }
        continue;
      }

      const r = await intentar(
        `INSERT INTO conductor_estado_hist (conductor_id, estado, desde, motivo)
         VALUES ($1,$2,$3,$4)`,
        [id, f.estado, HOY, nota],
        err => avisos.push(`${f.nombre}: ${err.message.split(NL)[0]}`));
      if (r) n++;
    }
  });

  console.log(NL + `══ EN LA BASE ══`);
  console.log(`  ausencias abiertas: ${n}` + (bajas ? ` · ${bajas} baja(s) de empresa` : '')
    + (sinResolver.length ? ` · ${sinResolver.length} sin resolver` : ''));

  const q = await db.consulta(`
    SELECT e.etiqueta, e.fin_previsible, count(h.id) personas
    FROM cat_estado_conductor e
    LEFT JOIN conductor_estado_hist h ON h.estado = e.codigo AND h.hasta IS NULL
    WHERE e.es_ausencia GROUP BY e.etiqueta, e.fin_previsible, e.orden ORDER BY e.orden`);
  q.rows.forEach(r => console.log(
    `  ${r.etiqueta.padEnd(22)} ${String(r.personas).padStart(3)}` +
    (r.fin_previsible ? '   (se cierra sola al volver la fecha)' : '   (se cierra A MANO cuando vuelva)')));

  console.log(NL + '══ Quién está ausente HOY (vista v_conductor_hoy) ══');
  const v = await db.consulta(`
    SELECT estado, count(*) n, max(dias_ausente) mas_dias
    FROM v_conductor_hoy WHERE ausente GROUP BY estado ORDER BY 2 DESC`);
  v.rows.forEach(r => console.log(`  ${r.estado.padEnd(14)} ${String(r.n).padStart(3)} persona(s)`));

  console.log(NL + '══ Los que están de baja PERO conservan su plaza ══');
  const p = await db.consulta(`
    SELECT count(DISTINCT a.conductor_id) n
    FROM asignacion a
    JOIN conductor_estado_hist h ON h.conductor_id = a.conductor_id AND h.hasta IS NULL
    JOIN cat_estado_conductor e ON e.codigo = h.estado
    WHERE a.hasta IS NULL AND e.es_ausencia AND NOT e.libera_plaza`);
  console.log(`  ${p.rows[0].n} conductores ausentes mantienen su asignación`);
  console.log('  (si al darse de baja cerráramos la asignación, perderían su coche)');

  if (avisos.length) {
    console.log(NL + `══ ${avisos.length} avisos ══`);
    avisos.slice(0, 8).forEach(a => console.log('  · ' + a));
  }
  await db.cerrar();
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
