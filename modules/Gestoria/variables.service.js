// ============================================================
// LAS VARIABLES DE A3: EL CATÁLOGO Y LAS LÍNEAS DEL MES (módulo 4, db/300)
// ============================================================
// Lo que se escribe en el lienzo de A3NOM (la plantilla «Conceptos» de la
// gestoría: un trabajador por fila, una columna por concepto) de cada mes de
// nómina (del 26 al 25), una línea por persona y concepto, con su origen.
//
// Camilo, 26/11/2026:
//   · VARIABLE DEL MES (/nominas, la del mes de pago; congelada si lo está):
//     el MBO (el mayor de horas extra y FAS) → 066, la nocturnidad → 053, las
//     propinas → 519 y los peajes → 607. Solo plantilla propia: la ETT va en
//     el parte de la agencia.
//   · DESCUENTOS EN NÓMINA (db/298): lo ya descontado al cerrar el mes y lo
//     aprobado o aplazado a él, cada uno con su concepto (753, 758, 751, 754).
//   · A MANO, con motivo: lo demás (dietas, plus de calidad, festivos,
//     regularización…). Lo gestiona quien gestiona la gestoría.
//
// «Preparar desde el ERP» rehace las que salen del ERP (las de a mano no se
// tocan). Cuando las variables del mes ya se marcaron enviadas en el cierre
// (db/299), no se prepara ni se apunta nada: hay que deshacer esa etapa.
//
// El Excel tiene la forma del lienzo: la cabecera en la fila 8 («Código»,
// «Nombre» y la cabecera exacta de cada concepto) y el código de la gestoría
// (el legajo) sin los ceros. Quien no tiene legajo va en otra hoja: A3 no lo
// puede importar. Hasta saber si A3 acepta un .xlsx, se copia al lienzo.
'use strict';

const repo = require('./variables.repo');
const cierreRepo = require('./cierre.repo');
const gestoria = require('./gestoria.service');
const libro = require('../../services/libro');
const contadores = require('../../services/contadores');

const CLAVE_VER = '/gestoria';
const CLAVE_GESTIONAR = '/gestoria/gestionar';
const ORIGENES_CONCEPTO = {
  variable_mbo: { etiqueta: 'Variable: MBO (el mayor de horas extra y FAS)', campo: f => Math.max(Number(f.mboFAS) || 0, Number(f.mboHsExt) || 0),
    detalle: f => ((Number(f.mboHsExt) || 0) > (Number(f.mboFAS) || 0) ? 'MBO por horas extra' : 'MBO FAS') },
  variable_nocturnidad: { etiqueta: 'Variable: nocturnidad', campo: f => Number(f.nocturnas) || 0, detalle: () => 'Nocturnidad' },
  variable_propinas: { etiqueta: 'Variable: propinas', campo: f => Number(f.propinas) || 0, detalle: () => 'Propinas' },
  variable_peajes: { etiqueta: 'Variable: peajes', campo: f => Number(f.peajes) || 0, detalle: () => 'Peajes' },
  descuento: { etiqueta: 'Descuentos en nómina' },
  manual: { etiqueta: 'A mano' },
};
const ORIGENES_LINEA = {
  variable: { etiqueta: 'Variable del mes', tono: 'gold' },
  descuento: { etiqueta: 'Descuento', tono: 'red' },
  manual: { etiqueta: 'A mano', tono: 'muted' },
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesDe = p => `${MESES[Number(p.slice(5, 7)) - 1]} de ${p.slice(0, 4)}`;
const esPeriodo = p => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ''));
const anterior = p => { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const siguiente = p => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const r2 = n => Math.round(n * 100) / 100;
const error = (msg, status = 400) => Object.assign(new Error(msg), { status });
const exigir = async (quien, clave) => { if (!await gestoria.puede(quien, clave)) throw error('No tienes permiso para esto', 403); };
const legajoSinCeros = l => (l && /^\d+$/.test(l) ? Number(l) : l || '');

async function exigirTabla() { if (!await repo.hayTabla()) throw error('Falta aplicar la migración 300'); }

/** Si las variables del mes ya se mandaron (cierre, db/299), no se toca nada. */
async function exigirAbierto(cli, periodo) {
  if (!await cierreRepo.hayTabla(cli)) return;
  const vivas = await cierreRepo.vivas(cli, periodo);
  if (vivas.has('variables')) {
    throw error(`Las variables de ${mesDe(periodo)} ya están marcadas como enviadas a la gestoría. Para cambiarlas, deshaz esa etapa en «Cierre del mes».`, 409);
  }
}

// ── El catálogo ──────────────────────────────────────────────────────────────
async function catalogo(quien) {
  await exigir(quien, CLAVE_VER);
  await exigirTabla();
  return { conceptos: await repo.conceptos(), origenes: ORIGENES_CONCEPTO, puedeGestionar: await gestoria.puede(quien, CLAVE_GESTIONAR) };
}

/** Crea o cambia un concepto. `nuevo` = darlo de alta. */
async function guardarConcepto(b = {}, quien) {
  await exigir(quien, CLAVE_GESTIONAR);
  await exigirTabla();
  const codigo = String(b.codigo || '').trim();
  if (!/^\d{1,4}$/.test(codigo)) throw error('El código de A3 son cifras, como 066');
  const nombre = String(b.nombre || '').trim();
  if (nombre.length < 2) throw error('Falta el nombre del concepto');
  const cabecera = String(b.cabecera || '').trim() || `${codigo} - ${nombre.slice(0, 8).toUpperCase()} (I)`;
  if (!cabecera.startsWith(codigo)) throw error('La cabecera del lienzo empieza por el código, como «066 - PACTO PR (I)»');
  const tipo = b.tipo === 'deduccion' ? 'deduccion' : 'devengo';
  const origen = ORIGENES_CONCEPTO[b.origen] ? b.origen : 'manual';
  const orden = Number.isInteger(Number(b.orden)) ? Number(b.orden) : 100;
  const activo = b.activo !== false && b.activo !== 'no';
  const todos = await repo.conceptos();
  const ya = todos.find(c => c.codigo === codigo);
  if (b.nuevo && ya) throw error(`El concepto ${codigo} ya existe`, 409);
  if (!b.nuevo && !ya) throw error(`El concepto ${codigo} no existe`, 404);
  if (origen.startsWith('variable_')) {
    const otro = todos.find(c => c.origen === origen && c.codigo !== codigo);
    if (otro) throw error(`«${ORIGENES_CONCEPTO[origen].etiqueta}» ya va al ${otro.codigo}. Cámbialo allí primero.`, 409);
  }
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · variables', accion: 'cambio',
    motivo: `${b.nuevo ? 'Nuevo concepto' : 'Concepto'} ${codigo} ${nombre}` }, cli =>
    repo.guardarConcepto(cli, { codigo, nombre, cabecera, tipo, origen, orden, activo }, !!b.nuevo));
  return { ok: true, conceptos: await repo.conceptos() };
}

// ── Las líneas ───────────────────────────────────────────────────────────────
/** Lo que sale del ERP para un mes: la variable (propia) y los descuentos. */
async function calcularDelErp(periodo, cli = null) {
  const conceptos = await repo.conceptos(cli);
  const porOrigen = Object.fromEntries(conceptos.filter(c => c.activo && c.origen.startsWith('variable_')).map(c => [c.origen, c.codigo]));
  const existe = new Set(conceptos.map(c => c.codigo));
  const lineas = [];
  const avisos = [];
  const [y, m] = periodo.split('-').map(Number);
  const nominas = require('../Nominas/nominas.service');
  const variable = await nominas.cargar(m, y);
  const filas = ((variable && variable.resultado && variable.resultado.filas) || []).filter(f => !f.ett && f.conductorId);
  for (const [origen, def] of Object.entries(ORIGENES_CONCEPTO)) {
    if (!def.campo) continue;
    const codigo = porOrigen[origen];
    if (!codigo) { avisos.push(`«${def.etiqueta}» no va a ningún concepto activo del catálogo: no sale.`); continue; }
    for (const f of filas) {
      const importe = r2(def.campo(f));
      if (importe > 0) lineas.push({ conductorId: String(f.conductorId), concepto: codigo, importe, origen: 'variable', detalle: def.detalle(f) });
    }
  }
  for (const d of await repo.descuentosDelMes(cli, periodo)) {
    if (!existe.has(d.concepto)) { avisos.push(`Hay descuentos con el concepto ${d.concepto}, que no está en el catálogo: no salen.`); continue; }
    lineas.push({ conductorId: d.conductor_id, concepto: d.concepto, importe: r2(d.importe), origen: 'descuento',
      detalle: d.n === 1 ? '1 descuento' : `${d.n} descuentos` });
  }
  return { lineas, avisos: [...new Set(avisos)], fuente: variable ? variable.fuente : null };
}

/** Rehace las líneas del ERP de un mes. Las de a mano se quedan. */
async function preparar({ periodo } = {}, quien) {
  await exigir(quien, CLAVE_GESTIONAR);
  if (!esPeriodo(periodo)) throw error('Elige el mes');
  await exigirTabla();
  await exigirAbierto(null, periodo);
  const { lineas, avisos, fuente } = await calcularDelErp(periodo);
  const r = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · variables', accion: 'cambio',
    motivo: `Variables de ${mesDe(periodo)} preparadas desde el ERP` }, async cli => {
    await exigirAbierto(cli, periodo);
    const quitadas = await repo.borrarAutomaticas(cli, periodo);
    for (const l of lineas) await repo.insertar(cli, { ...l, periodo, creadoPor: quien.usuarioId });
    return { quitadas };
  });
  contadores.cambio('gestoria_cierre');
  const total = t => r2(lineas.filter(l => l.origen === t).reduce((s, l) => s + l.importe, 0));
  return { ok: true, periodo, mes: mesDe(periodo), lineas: lineas.length, antes: r.quitadas, avisos,
    variable: total('variable'), descuentos: total('descuento'),
    congelada: fuente === 'congelada',
    personas: new Set(lineas.map(l => l.conductorId)).size };
}

/** Una línea a mano: persona, concepto, importe (con signo si hace falta) y motivo. */
async function apuntar(b = {}, quien) {
  await exigir(quien, CLAVE_GESTIONAR);
  await exigirTabla();
  const periodo = String(b.periodo || '');
  if (!esPeriodo(periodo)) throw error('Elige el mes');
  const conductorId = Number(b.conductorId);
  if (!Number.isInteger(conductorId) || conductorId <= 0) throw error('Elige a la persona');
  const concepto = (await repo.conceptos()).find(c => c.codigo === String(b.concepto || ''));
  if (!concepto) throw error('Elige el concepto');
  if (!concepto.activo) throw error(`El concepto ${concepto.codigo} está desactivado en el catálogo`);
  const importe = r2(Number(String(b.importe == null ? '' : b.importe).replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));
  if (!Number.isFinite(importe) || importe === 0) throw error('El importe no puede ser cero');
  if (Math.abs(importe) > 100000) throw error('¿Más de 100.000 €? Revisa la cifra');
  const motivo = String(b.motivo || '').trim();
  if (motivo.length < 3) throw error('Di por qué: es lo que verá quien revise la nómina');
  const id = await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · variables', accion: 'alta',
    motivo: `Línea a mano de ${mesDe(periodo)}: ${concepto.codigo} ${importe} €` }, async cli => {
    await exigirAbierto(cli, periodo);
    return repo.insertar(cli, { periodo, conductorId, concepto: concepto.codigo, importe, origen: 'manual', motivo: motivo.slice(0, 2000), creadoPor: quien.usuarioId });
  });
  contadores.cambio('gestoria_cierre');
  return { ok: true, id };
}

/** Anular una línea a mano, con motivo. Las del ERP se rehacen al preparar. */
async function anular(id, b = {}, quien) {
  await exigir(quien, CLAVE_GESTIONAR);
  await exigirTabla();
  const l = await repo.porId(String(id));
  if (!l) throw error('No existe esa línea', 404);
  if (l.origen !== 'manual') throw error('Las líneas que salen del ERP no se anulan: se rehacen con «Preparar desde el ERP»');
  const motivo = String(b.motivo || '').trim();
  if (motivo.length < 3) throw error('Di por qué se anula');
  await libro.conFirma({ usuarioId: quien.usuarioId, origen: 'gestoria · variables', accion: 'baja',
    motivo: `Línea a mano anulada: ${l.concepto} ${l.importe} € de ${l.nombre}. ${motivo}` }, async cli => {
    await exigirAbierto(cli, l.periodo);
    if (!await repo.anular(cli, l.id, { motivo: motivo.slice(0, 2000), usuarioId: quien.usuarioId })) throw error('Esa línea ya estaba anulada', 409);
  });
  return { ok: true };
}

/** Para la pestaña: las líneas de los últimos meses (el filtro elige el mes). */
async function lista(quien) {
  await exigir(quien, CLAVE_VER);
  const base = { origenes: ORIGENES_LINEA, puedeGestionar: await gestoria.puede(quien, CLAVE_GESTIONAR) };
  if (!await repo.hayTabla()) return { filas: [], sinTabla: true, ...base };
  const cierre = require('./cierre.service');
  const actual = await cierre.periodoDe(require('../../services/calendario').hoy());
  const meses = [siguiente(actual), actual, anterior(actual), anterior(anterior(actual))];
  const filas = (await repo.lista(meses)).map(f => ({ ...f, mes: mesDe(f.periodo) }));
  return { filas, ...base, meses: meses.map(p => ({ periodo: p, mes: mesDe(p) })), actual, mesActual: mesDe(actual), conceptos: await repo.conceptos() };
}

async function ficha(id, quien) {
  await exigir(quien, CLAVE_VER);
  const l = await repo.porId(String(id));
  if (!l) throw error('No existe esa línea', 404);
  return { ...l, mes: mesDe(l.periodo) };
}

/** Las personas para una línea a mano: de alta, o que se fueron hace poco. */
async function personas(quien) {
  await exigir(quien, CLAVE_VER);
  const db = require('../../services/db');
  const pruebas = require('../../services/repo/fichaDePruebas');
  const r = await db.consulta(
    `SELECT c.id::text AS id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.legajo
       FROM conductor c
      WHERE NOT c.es_centinela${await pruebas.fuera('c')} AND (c.empleo_vigente OR EXISTS (
              SELECT 1 FROM conductor_periodo_empleo e WHERE e.conductor_id = c.id AND e.baja >= CURRENT_DATE - 120))
      ORDER BY 2`);
  return { personas: r.rows };
}

/** El Excel con la forma del lienzo de A3. */
async function excel(periodo, quien) {
  await exigir(quien, CLAVE_VER);
  if (!esPeriodo(periodo)) throw error('Elige el mes');
  await exigirTabla();
  const ExcelJS = require('exceljs');
  const [lineas, conceptos] = await Promise.all([repo.delMes(null, periodo), repo.conceptos()]);
  const usados = new Set(lineas.map(l => l.concepto));
  const columnas = conceptos.filter(c => c.activo || usados.has(c.codigo));
  const personas = new Map();
  for (const l of lineas) {
    const p = personas.get(l.conductor_id) || { nombre: l.nombre, legajo: l.legajo, importes: {} };
    p.importes[l.concepto] = r2((p.importes[l.concepto] || 0) + l.importe);
    personas.set(l.conductor_id, p);
  }
  const todas = [...personas.values()].sort((a, b) => String(a.legajo || 'zzz').localeCompare(String(b.legajo || 'zzz')) || a.nombre.localeCompare(b.nombre));
  const conLegajo = todas.filter(p => p.legajo);
  const sinLegajo = todas.filter(p => !p.legajo);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Conceptos');
  ws.getCell('B2').value = `Variables de la nómina de ${mesDe(periodo)}`;
  ws.getCell('B2').font = { bold: true, size: 13 };
  ws.getCell('B3').value = 'Preparado en el ERP de Telecab para copiar al lienzo de A3NOM (la cabecera, en la fila 8, como en el lienzo).';
  ws.getCell('B4').value = `${conLegajo.length} trabajadores con código${sinLegajo.length ? ` · ${sinLegajo.length} sin código, en la hoja «Sin código»` : ''}`;
  const cab = ws.getRow(8);
  ['Código', 'Nombre', ...columnas.map(c => c.cabecera)].forEach((t, i) => { cab.getCell(i + 2).value = t; });
  cab.font = { bold: true };
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F2' } };
  conLegajo.forEach((p, k) => {
    const row = ws.getRow(9 + k);
    row.getCell(2).value = legajoSinCeros(p.legajo);
    row.getCell(3).value = p.nombre;
    columnas.forEach((c, i) => { if (p.importes[c.codigo] != null) row.getCell(4 + i).value = p.importes[c.codigo]; });
  });
  const fin = 9 + conLegajo.length;
  const tot = ws.getRow(fin + 1);
  tot.getCell(3).value = 'TOTAL';
  tot.font = { bold: true };
  columnas.forEach((c, i) => {
    const col = ws.getColumn(4 + i).letter;
    if (conLegajo.length) tot.getCell(4 + i).value = { formula: `SUM(${col}9:${col}${fin - 1})` };
  });
  ws.getColumn(2).width = 10;
  ws.getColumn(3).width = 38;
  columnas.forEach((c, i) => { ws.getColumn(4 + i).width = 14; ws.getColumn(4 + i).numFmt = '#,##0.00'; });
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 8 }];

  if (sinLegajo.length) {
    const s = wb.addWorksheet('Sin código');
    s.addRow(['Sin código de la gestoría (legajo): A3 no los puede importar hasta que lo tengan']).font = { bold: true };
    s.addRow([]);
    s.addRow(['Nombre', ...columnas.map(c => c.cabecera)]).font = { bold: true };
    sinLegajo.forEach(p => s.addRow([p.nombre, ...columnas.map(c => (p.importes[c.codigo] != null ? p.importes[c.codigo] : null))]));
    s.getColumn(1).width = 38;
    columnas.forEach((c, i) => { s.getColumn(2 + i).width = 14; s.getColumn(2 + i).numFmt = '#,##0.00'; });
  }

  const det = wb.addWorksheet('Detalle');
  det.addRow(['Código', 'Nombre', 'Concepto', 'Importe', 'Origen', 'Detalle o motivo']).font = { bold: true };
  lineas.forEach(l => det.addRow([legajoSinCeros(l.legajo), l.nombre, `${l.concepto} ${l.concepto_nombre}`, l.importe, ORIGENES_LINEA[l.origen].etiqueta, l.motivo || l.detalle || '']));
  [10, 38, 32, 12, 18, 60].forEach((w, i) => { det.getColumn(i + 1).width = w; });
  det.getColumn(4).numFmt = '#,##0.00';

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), nombre: `Variables A3 ${mesDe(periodo)}.xlsx` };
}

/**
 * RELLENAR EL LIENZO DE A3 (26/11/2026): el .xls que manda la gestoría, tal
 * cual, con las líneas del mes escritas en sus celdas (lienzoXls.js: sin
 * rehacer el fichero; comprobado contra el de noviembre celda a celda en
 * Excel). Cada línea va a la fila de su código (el legajo sin ceros) y a la
 * columna de su concepto. Lo que no cabe se dice: quien no está en el lienzo,
 * el concepto que el lienzo no trae, quien no tiene código. Una cifra que ya
 * estaba en el lienzo se sustituye, y se dice cuál era.
 */
async function lienzo({ periodo, base64, nombre } = {}, quien) {
  await exigir(quien, CLAVE_GESTIONAR);
  if (!esPeriodo(periodo)) throw error('Elige el mes');
  await exigirTabla();
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) throw error('Falta el lienzo de la gestoría (.xls)');
  const lineas = await repo.delMes(null, periodo);
  if (!lineas.length) throw error(`No hay variables de ${mesDe(periodo)}: prepáralas primero`);
  const sinCodigo = [...new Map(lineas.filter(l => !l.legajo).map(l => [l.conductor_id, l.nombre])).values()];
  const conCodigo = lineas.filter(l => l.legajo);
  const r = require('./lienzoXls').rellenarLienzo(buffer, conCodigo.map(l => ({ codigo: l.legajo, concepto: l.concepto, importe: l.importe })));
  const nombreDe = new Map(conCodigo.map(l => [String(l.legajo).replace(/^0+/, ''), l.nombre]));
  const base = String(nombre || 'lienzo.xls').replace(/\.xls$/i, '');
  return {
    mes: mesDe(periodo), nombre: `${base} (variables ${mesDe(periodo)}).xls`,
    base64: r.buffer.toString('base64'),
    escritas: r.escritas, trabajadores: r.trabajadores, cifrado: r.cifrado,
    sustituidas: r.ocupadas.map(o => ({ ...o, nombre: nombreDe.get(o.codigo) || o.nombre })),
    noEnElLienzo: r.sinFila.map(c => ({ codigo: c, nombre: nombreDe.get(c) || '' })),
    conceptosQueNoTrae: r.sinColumna, sinCodigo, sinEscribir: r.faltan,
  };
}

module.exports = { ORIGENES_CONCEPTO, ORIGENES_LINEA, catalogo, guardarConcepto, calcularDelErp, preparar, apuntar, anular, lista, ficha, personas, excel, lienzo };
