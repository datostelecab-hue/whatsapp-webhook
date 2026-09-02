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
const est = require('./excelEstilo');

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
  const { str: fecha, idx, Y, M, D } = fechaDeClave(key);
  const [tablero, justis] = await Promise.all([tableroControl(), leerPorFecha(fecha)]);

  const bruto = [];
  for (const c of (tablero.conductores || [])) {
    const dia = c.dias && c.dias[key];
    if (!dia) continue;
    const just = justis.get(normClave(c.nombre));
    const horas = dia.horas;   // número o null
    const incluir = dia.debiaSalir || (horas != null && horas > 0) || !!just;
    if (!incluir) continue;
    bruto.push({
      nombre: c.nombre, telefono: c.telefono || '', turno: c.turno || '', horas,
      esNN: c.esNN, libra: !!dia.libra, debiaSalir: !!dia.debiaSalir, just
    });
  }

  // No justificados primero (mayor→menor); justificados al final (también mayor→menor).
  const cmp = (a, b) => (b.horas ?? -1) - (a.horas ?? -1) || a.nombre.localeCompare(b.nombre, 'es');
  const orden = bruto.filter(f => !f.just).sort(cmp).concat(bruto.filter(f => f.just).sort(cmp));

  const filas = orden.map((f, i) => {
    const comun = { nro: i + 1, nombre: f.nombre, telefono: f.telefono, turno: f.turno, horas: f.horas, libra: f.libra, debiaSalir: f.debiaSalir };
    if (f.just) {
      const horasTexto = (f.horas != null && f.horas > 0) ? `${r1(f.horas)} (J)` : 'J';
      return { ...comun, horasTexto, color: 'azul', observacion: f.just.observacion || '', esJ: true };
    }
    const b = banda(f.horas);
    return { ...comun, horasTexto: (f.horas != null ? String(r1(f.horas)) : ''), color: b.color, observacion: b.obs, esJ: false };
  });

  // KM por conductor del NÚCLEO (route/list), para las columnas nuevas del Excel.
  //
  // POR TURNO, no por día natural: cada conductor cuenta lo que hizo EN SU JORNADA
  // en BOLT. El día natural le metía a un conductor de noche la madrugada (00–05),
  // que es del turno de noche de la víspera —de OTRO conductor—, y salían cosas
  // como "0 horas pero 170 km". Con la ventana de su turno, el km es el suyo.
  //
  // En su propio try: si el núcleo no está poblado, el reporte sale igual.
  try {
    const iso = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
    await require('./flotaViva/db').preparar();
    const rutas = require('./flotaViva/rutas');
    const [kmDia, kmNoche] = await Promise.all([
      rutas.kmConectadoDesconectado(iso, 'dia'),
      rutas.kmConectadoDesconectado(iso, 'noche'),
    ]);
    const mapDia = new Map(kmDia.conductores.map(c => [normClave(c.conductor), c]));
    const mapNoche = new Map(kmNoche.conductores.map(c => [normClave(c.conductor), c]));
    const r1km = v => (v == null ? null : Math.round(v * 10) / 10);
    filas.forEach(f => {
      const k = normClave(f.nombre);
      const t = (f.turno || '').trim();
      const d = mapDia.get(k), n = mapNoche.get(k);
      if (t === 'Noche') {
        f.kmBolt = n ? n.enBolt : null;
        f.kmDesc = n ? n.desconectado : null;
      } else if (t === 'TodoTurno') {
        // Cubre día y noche: suma sus dos ventanas.
        f.kmBolt = (d || n) ? r1km((d ? d.enBolt : 0) + (n ? n.enBolt : 0)) : null;
        f.kmDesc = (d || n) ? r1km((d ? d.desconectado : 0) + (n ? n.desconectado : 0)) : null;
      } else {   // Día (o sin turno en la agenda)
        f.kmBolt = d ? d.enBolt : null;
        f.kmDesc = d ? d.desconectado : null;
      }
    });
  } catch (e) {
    console.warn('⚠️  [JUST] KM del núcleo no disponible para el reporte:', e.message);
  }

  return {
    fecha, diaSemana: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][idx],
    dia: Number(key), filas, resumen: resumirFilas(filas)
  };
}

// ── Resumen del día ─────────────────────────────────────────────────────────
// Se calcula SOBRE LAS FILAS QUE SE IMPRIMEN, para que quien lea el Excel pueda
// sumar a mano y le cuadre. Quien solo libraba no aparece en el reporte (reporteDia
// ya lo deja fuera), y aun así se descarta aquí por si viniera con libranza y coche.
function resumirFilas(filas) {
  const hizo = f => (f.horas ?? 0) > 0;
  const porTurno = {};
  filas.forEach(f => {
    const t = (f.turno || '').trim() || '(sin turno)';
    porTurno[t] = r1((porTurno[t] || 0) + (f.horas ?? 0));
  });
  return {
    salieron: filas.filter(hizo).length,
    // Se les esperaba y no aparecieron. La libranza no cuenta como falta.
    noSalieron: filas.filter(f => !hizo(f) && !f.libra).length,
    cumplieron8: filas.filter(f => (f.horas ?? 0) >= 8).length,
    menos4: filas.filter(f => hizo(f) && f.horas < 4).length,
    justificados: filas.filter(f => f.esJ).length,
    horasDia: porTurno['Día'] || 0,
    horasNoche: porTurno['Noche'] || 0,
    // TodoTurno y los que no tienen turno en la agenda (los NN) van aparte: así las
    // cuatro líneas suman EXACTAMENTE el total y no hay horas escondidas.
    horasTodoTurno: porTurno['TodoTurno'] || 0,
    horasSinTurno: porTurno['(sin turno)'] || 0,
    horasTotal: r1(filas.reduce((s, f) => s + (f.horas ?? 0), 0)),
    personas: filas.length
  };
}

// ── Excel del reporte (colores SOLO en la celda de horas) ───────────────────
// Los colores de la banda son los de siempre —tráfico ya los tiene interiorizados—;
// lo que cambia es el envoltorio: cabecera de la casa con el logo, tabla con bordes
// y, al final, el resumen del día y la leyenda de colores.
const FILL = { verde: 'FF63BE7B', amarillo: 'FFFFEB84', rojo: 'FFF8696B', azul: 'FF5B9BD5', gris: 'FFD9D9D9' };
const CAB_REPORTE = ['Nº', 'Nombre', 'Teléfono', 'Turno', 'Horas', 'Observaciones', 'KM BOLT', 'KM descon.'];
const ANCHOS_REPORTE = [6, 34, 16, 11, 12, 26, 12, 12];
const N_REPORTE = CAB_REPORTE.length;
const ULTIMA_REPORTE = est.colLetra(N_REPORTE);

/** Fila del resumen: concepto a la izquierda (A:D) y valor a la derecha (E:F). */
function lineaResumen(ws, fila, concepto, valor, opciones = {}) {
  const { horas = false, destacar = false, tenue = false } = opciones;
  ws.mergeCells(`A${fila}:D${fila}`);
  ws.mergeCells(`E${fila}:${ULTIMA_REPORTE}${fila}`);
  const c = ws.getCell(`A${fila}`);
  const v = ws.getCell(`E${fila}`);
  c.value = concepto;
  v.value = valor;
  if (horas) v.numFmt = '0.0" h"';
  [c, v].forEach(x => {
    x.border = est.TODOS_BORDES;
    x.font = { size: destacar ? 12 : 11, bold: destacar, color: { argb: tenue ? est.TENUE : est.TEXTO } };
    if (destacar) x.fill = est.relleno('FFFFF4DA');
  });
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  v.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(fila).height = destacar ? 24 : 19;
  return fila + 1;
}

/** Cabecera de sección dentro de la hoja (RESUMEN, LEYENDA…). */
function tituloSeccion(ws, fila, texto) {
  ws.mergeCells(`A${fila}:${ULTIMA_REPORTE}${fila}`);
  const t = ws.getCell(`A${fila}`);
  t.value = texto;
  t.font = { size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = est.relleno(est.CAB_BG);
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  t.border = est.TODOS_BORDES;
  ws.getRow(fila).height = 22;
  return fila + 1;
}

async function excelDia(reporte) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tibus Luxury';
  wb.created = new Date();
  const ws = wb.addWorksheet('Reporte', {
    pageSetup: {
      orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
    }
  });
  ANCHOS_REPORTE.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const r = reporte.resumen || resumirFilas(reporte.filas);
  let fila = est.bandaCabecera(ws, est.registrarLogo(wb),
    `Reporte de horas · ${reporte.diaSemana} ${reporte.fecha}`,
    `${r.personas} conductor(es) en el reporte   ·   ${String(r.horasTotal).replace('.', ',')} h en total   ·   generado el ${ahora()}`,
    N_REPORTE);

  const filaCab = fila;
  fila = est.cabeceraTabla(ws, fila, CAB_REPORTE);

  reporte.filas.forEach((f, i) => {
    const row = ws.getRow(fila);
    [f.nro, f.nombre, f.telefono, f.turno || '', f.horasTexto, f.observacion,
     f.kmBolt == null ? '' : f.kmBolt, f.kmDesc == null ? '' : f.kmDesc].forEach((v, ci) => {
      const c = row.getCell(ci + 1);
      c.value = v;
      c.border = est.TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: ci === 1 ? 'left' : 'center', indent: ci === 1 ? 1 : 0 };
      c.font = { size: 11, color: { argb: est.TEXTO } };
      // Las dos columnas de KM (7 y 8) en formato "0,0 km".
      if (ci >= 6 && typeof v === 'number') c.numFmt = '0.0" km"';
      if (i % 2) c.fill = est.relleno('FFFAFBFC');
    });
    // El COLOR va solo en la celda de horas, como siempre.
    const cel = row.getCell(5);
    if (FILL[f.color]) cel.fill = est.relleno(FILL[f.color]);
    cel.font = { size: 11, bold: true, color: { argb: f.color === 'azul' ? 'FFFFFFFF' : 'FF1F2430' } };
    row.height = 19;
    fila++;
  });

  // Las columnas se congelan bajo la cabecera para no perderlas al bajar por la lista.
  ws.views = [{ state: 'frozen', ySplit: filaCab }];
  ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: fila - 1, column: N_REPORTE } };

  // ── Resumen del día ───────────────────────────────────────────────────────
  fila++;
  fila = tituloSeccion(ws, fila, `RESUMEN DEL ${reporte.diaSemana.toUpperCase()} ${reporte.fecha}`);
  fila = lineaResumen(ws, fila, 'Personas que salieron (con horas registradas)', r.salieron);
  fila = lineaResumen(ws, fila, 'No salieron  ·  sin contar libranzas', r.noSalieron);
  fila = lineaResumen(ws, fila, 'Cumplieron las 8 h (8 h o más)', r.cumplieron8);
  fila = lineaResumen(ws, fila, 'Salieron con menos de 4 h', r.menos4);
  fila = lineaResumen(ws, fila, 'Justificados con J  ·  valen 8 h para el pago', r.justificados, { tenue: true });
  fila++;
  fila = lineaResumen(ws, fila, 'Horas hechas en el turno de DÍA', r.horasDia, { horas: true });
  fila = lineaResumen(ws, fila, 'Horas hechas en el turno de NOCHE', r.horasNoche, { horas: true });
  // Solo se listan si aportan horas: si no, son ruido en el papel.
  if (r.horasTodoTurno) fila = lineaResumen(ws, fila, 'Horas hechas en TodoTurno', r.horasTodoTurno, { horas: true, tenue: true });
  if (r.horasSinTurno) fila = lineaResumen(ws, fila, 'Horas de conductores sin turno en la agenda', r.horasSinTurno, { horas: true, tenue: true });
  fila = lineaResumen(ws, fila, 'HORAS TOTALES DEL DÍA', r.horasTotal, { horas: true, destacar: true });

  // ── Leyenda de colores ────────────────────────────────────────────────────
  fila += 2;
  fila = tituloSeccion(ws, fila, 'LEYENDA DE COLORES');
  [
    ['verde', 'Muy efectivo — 9 h o más'],
    ['verde', 'Efectivo — de 7,6 a 8,9 h'],
    ['amarillo', 'Poco efectivo — de 6,4 a 7,5 h'],
    ['rojo', 'No cumplieron — 6,3 h o menos'],
    ['azul', 'Justificado (J) — cuenta 8 h para el pago'],
    ['gris', 'Sin dato de horas ese día']
  ].forEach(([color, texto]) => {
    ws.mergeCells(`B${fila}:${ULTIMA_REPORTE}${fila}`);
    const chip = ws.getCell(`A${fila}`);
    chip.fill = est.relleno(FILL[color]);
    chip.border = est.TODOS_BORDES;
    const t = ws.getCell(`B${fila}`);
    t.value = texto;
    t.font = { size: 10, color: { argb: est.TEXTO } };
    t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    t.border = est.TODOS_BORDES;
    ws.getRow(fila).height = 18;
    fila++;
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { fechaDeClave, banda, guardar, leerPorFecha, reporteDia, resumirFilas, excelDia, HOJA };
