// ============================================================
// JUSTIFICANTES — justificar el día a conductores que no hicieron 8 h (letra J)
// ============================================================
// Tráfico, en Control, justifica el día anterior (o hasta 3 días atrás) a un conductor
// que no llegó a horas. Eso:
//   · guarda el justificante (con OBSERVACIÓN obligatoria + ID_BOLT) en la hoja
//     JUSTIFICANTES (base de datos de todas las J's), y
//   · si el conductor tiene fila en VISTA_FINAL, le escribe una "J" azul ese día
//     (los NN, sin fila, se quedan SOLO en JUSTIFICANTES — no se toca VISTA_FINAL).
// La J vale 8 h para el pago, pero NO se tocan los totales del mes: es marca + reporte.
//
// El reporte del día (exportable a Excel) sale de tableroControl() —que ya trae a los NN
// con su teléfono— coloreando SOLO la celda de horas:
//   verde  ≥9  "Muy efectivo" · verde 7.6–8.9 "Efectivo" · amarillo 6.4–7.5 "Poco efectivo"
//   rojo   ≤6.3 "No cumplieron" · azul  los J ("6.4 (J)") con su observación, al final.

const ExcelJS = require('exceljs');
const { tableroControl } = require('./control');
const { normClave } = require('./conductores');
const { marcarJustificante } = require('./vistaFinal');
const { readSheet, writeSheetRaw, appendRows, ensureSheet } = require('./sheets');

const ID = '18LiwQTyzQAzNxtwXzX-HSEhM3HhbggrOmMF56Fprt3g';   // libro GestionConductores
const HOJA = 'JUSTIFICANTES';
const RANGO = `${HOJA}!A:J`;
const TZ = 'Europe/Madrid';

const COL = { fecha: 0, id_bolt: 1, nombre: 2, telefono: 3, turno: 4, horas: 5, observacion: 6, en_vista_final: 7, creado_por: 8, creado: 9 };
const N_COLS = 10;
const CABECERA = ['FECHA', 'ID_BOLT', 'NOMBRE', 'TELEFONO', 'TURNO', 'HORAS', 'OBSERVACION', 'EN_VISTA_FINAL', 'CREADO_POR', 'CREADO'];

const r1 = h => Math.round(h * 10) / 10;

function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

// Fecha para una "clave de día" de Control: 0=Hoy, 1=Ayer, 2=Hace 2, 3=Hace 3.
function fechaDeClave(key) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [Y, M, D] = s.split('-').map(Number);
  const f = new Date(Date.UTC(Y, M - 1, D - Number(key || 0), 12));
  const y = f.getUTCFullYear(), m = f.getUTCMonth() + 1, d = f.getUTCDate();
  return { Y: y, M: m, D: d, str: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`, idx: (f.getUTCDay() + 6) % 7 };
}

// Banda de color + observación automática para los NO justificados.
function banda(h) {
  if (h == null) return { color: 'gris', obs: '' };
  if (h >= 9) return { color: 'verde', obs: 'Muy efectivo' };
  if (h >= 7.6) return { color: 'verde', obs: 'Efectivo' };
  if (h >= 6.4) return { color: 'amarillo', obs: 'Poco efectivo' };
  return { color: 'rojo', obs: 'No cumplieron' };
}

async function ensureHoja() {
  await ensureSheet(ID, HOJA);
  const filas = await readSheet(ID, `${HOJA}!A1:J1`);
  if (!filas.length || !(filas[0] || []).length) await writeSheetRaw(ID, `${HOJA}!A1`, [CABECERA]);
}

async function leerTodos() {
  await ensureHoja();
  const filas = await readSheet(ID, RANGO);
  const lista = [];
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i] || [];
    if (!(f[COL.fecha] || '').toString().trim()) continue;
    const o = { _fila: i + 1 };
    for (const [k, ci] of Object.entries(COL)) o[k] = (f[ci] == null ? '' : f[ci]).toString().trim();
    lista.push(o);
  }
  return lista;
}

// Justificantes de una fecha → Map(clave(id_bolt) -> justificante).
async function leerPorFecha(fechaStr) {
  const m = new Map();
  for (const j of await leerTodos()) if (j.fecha === fechaStr) m.set(normClave(j.id_bolt), j);
  return m;
}

// Guarda (o actualiza) un justificante y, si el conductor tiene fila, marca la J azul.
async function guardar({ fecha, idBolt, nombre, telefono, turno, horas, observacion, creadoPor }) {
  observacion = (observacion || '').toString().trim();
  if (!observacion) throw new Error('La observación es obligatoria para justificar');
  idBolt = (idBolt || nombre || '').toString().trim();
  if (!idBolt) throw new Error('Falta el conductor');
  if (!fecha) throw new Error('Falta la fecha');
  await ensureHoja();

  const filas = await readSheet(ID, RANGO);
  const k = normClave(idBolt);
  let fila = -1;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i] || [];
    if ((f[COL.fecha] || '') === fecha && normClave(f[COL.id_bolt] || '') === k) { fila = i + 1; break; }
  }

  // Escribe la J en VISTA_FINAL si tiene fila (los NN devuelven escrito:false).
  let enVF = false;
  try { const r = await marcarJustificante(idBolt, fecha); enVF = !!(r && r.escrito); }
  catch (e) { console.warn('⚠️ [JUST] VISTA_FINAL:', e.message); }

  const row = [fecha, idBolt, (nombre || idBolt), (telefono || ''), (turno || ''),
  (horas == null || horas === '' ? '' : horas), observacion, enVF ? 'sí' : 'no', (creadoPor || ''), ahora()];
  if (fila > 0) await writeSheetRaw(ID, `${HOJA}!A${fila}:J${fila}`, [row]);
  else await appendRows(ID, RANGO, [row]);
  return { ok: true, enVistaFinal: enVF };
}

// ── Reporte del día (key 1=Ayer, 2=Hace 2, 3=Hace 3) ────────────────────────
async function reporteDia(key) {
  const { str: fecha, idx } = fechaDeClave(key);
  const [tablero, justis] = await Promise.all([tableroControl(), leerPorFecha(fecha)]);

  const bruto = [];
  for (const c of (tablero.conductores || [])) {
    const dia = c.dias && c.dias[key];
    if (!dia) continue;
    const just = justis.get(normClave(c.nombre));
    const horas = dia.horas;   // número o null
    const incluir = dia.debiaSalir || (horas != null && horas > 0) || !!just;
    if (!incluir) continue;
    bruto.push({ nombre: c.nombre, telefono: c.telefono || '', turno: c.turno || '', horas, esNN: c.esNN, just });
  }

  // No justificados primero (mayor→menor); justificados al final (también mayor→menor).
  const cmp = (a, b) => (b.horas ?? -1) - (a.horas ?? -1) || a.nombre.localeCompare(b.nombre, 'es');
  const orden = bruto.filter(f => !f.just).sort(cmp).concat(bruto.filter(f => f.just).sort(cmp));

  const filas = orden.map((f, i) => {
    if (f.just) {
      const horasTexto = (f.horas != null && f.horas > 0) ? `${r1(f.horas)} (J)` : 'J';
      return { nro: i + 1, nombre: f.nombre, telefono: f.telefono, turno: f.turno, horas: f.horas, horasTexto, color: 'azul', observacion: f.just.observacion || '', esJ: true };
    }
    const b = banda(f.horas);
    return { nro: i + 1, nombre: f.nombre, telefono: f.telefono, turno: f.turno, horas: f.horas, horasTexto: (f.horas != null ? String(r1(f.horas)) : ''), color: b.color, observacion: b.obs, esJ: false };
  });

  return { fecha, diaSemana: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][idx], dia: Number(key), filas };
}

// ── Excel del reporte (colores SOLO en la celda de horas) ───────────────────
async function excelDia(reporte) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reporte');
  const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const FILL = { verde: 'FF63BE7B', amarillo: 'FFFFEB84', rojo: 'FFF8696B', azul: 'FF5B9BD5', gris: 'FFD9D9D9' };

  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = `Reporte de horas — ${reporte.diaSemana} ${reporte.fecha}`;
  ws.getCell('A1').font = { bold: true, size: 13 };

  ws.getRow(3).values = ['Nº', 'Nombre', 'Teléfono', 'Turno', 'Horas', 'Observaciones'];
  ws.getRow(3).font = { bold: true };
  ws.columns = [{ width: 6 }, { width: 34 }, { width: 16 }, { width: 10 }, { width: 12 }, { width: 22 }];

  reporte.filas.forEach(f => {
    const row = ws.addRow([f.nro, f.nombre, f.telefono, f.turno || '', f.horasTexto, f.observacion]);
    const cel = row.getCell(5);
    if (FILL[f.color]) cel.fill = relleno(FILL[f.color]);
    cel.alignment = { horizontal: 'center' };
    if (f.esJ) cel.font = { bold: true };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { fechaDeClave, banda, guardar, leerPorFecha, reporteDia, excelDia, HOJA };
