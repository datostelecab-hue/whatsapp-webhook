// ============================================================
// REPORTE DE HORAS POR TURNO (5-5) — Excel, con NN
// ============================================================
// El reporte que sacaba el control antiguo: por TURNO con ventana horaria fija
//   · Día   05:00 → 17:00
//   · Noche 17:00 → 05:00 del día siguiente
// y con TODO el que trabajó en esa ventana, incluidos los NN (los que rodaron sin
// estar planificados). Sale del núcleo (fv_tramo/fv_ruta), no de las hojas.
//
//   Salió     = trabajó en su turno y estaba previsto
//   NN        = trabajó pero no estaba en el plan de ese turno
//   No salió  = estaba previsto y no rodó
//
// datos(dia)          → estructura pura (por turno, sus filas + resumen)
// excelTurnos(reporte)→ Buffer del .xlsx (puro: se puede probar sin BD)

const ExcelJS = require('exceljs');
const rutas = require('./flotaViva/rutas');
const { salidasHoy, contactos } = require('./repo/planificador');
const db = require('./db');

const TZ = 'Europe/Madrid';
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// Nombre normalizado para cruzar BOLT (fv_conductor) con el dominio: minúsculas, sin
// acentos, tokens ordenados. Igual criterio que En directo, local para no acoplar.
const normNombre = s => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');

const fmtTel = t => {
  const d = String(t || '').replace(/\D/g, '').slice(-9);
  return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : (t || '');
};

// Puente nombre de BOLT → conductor_id (para teléfono y para saber si estaba previsto).
async function puenteNombreId() {
  const m = new Map();
  const r = await db.consulta(
    `SELECT conductor_id, externo_nombre FROM conductor_externo
      WHERE sistema = 'bolt' AND conductor_id IS NOT NULL AND externo_nombre IS NOT NULL`);
  r.rows.forEach(x => m.set(normNombre(x.externo_nombre), Number(x.conductor_id)));
  return m;
}

/** Estructura del reporte (pura, sin Excel). */
async function datos(dia) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoyMadrid();
  await require('./flotaViva/db').preparar().catch(() => {});

  const [hDia, hNoche, kmDia, kmNoche, plan, contac, puente] = await Promise.all([
    rutas.horasEfectivasPorConductor(d, 'dia').catch(() => new Map()),
    rutas.horasEfectivasPorConductor(d, 'noche').catch(() => new Map()),
    rutas.kmConectadoDesconectado(d, 'dia').catch(() => ({ conductores: [] })),
    rutas.kmConectadoDesconectado(d, 'noche').catch(() => ({ conductores: [] })),
    salidasHoy(d).catch(() => ({ turnos: [] })),
    contactos().catch(() => new Map()),
    puenteNombreId().catch(() => new Map()),
  ]);

  // Previstos por turno (conductor_id) + su nombre/teléfono del plan (para los que
  // NO rodaron: hay que llamarlos igual).
  const esp = { dia: new Set(), noche: new Set() };
  const planInfo = new Map();   // id -> { nombre, telefono }
  (plan.turnos || []).forEach(t => {
    const set = esp[t.codigo];
    (t.conductores || []).forEach(c => {
      if (set) set.add(String(c.conductorId));
      planInfo.set(String(c.conductorId), { nombre: c.conductor, telefono: c.telefono });
    });
  });

  const construir = (horasMap, kmRes, espSet) => {
    const matPorNom = new Map();
    (kmRes.conductores || []).forEach(c => matPorNom.set(normNombre(c.conductor), c));

    const filas = [];
    const vistosId = new Set();
    // 1) TODO el que rodó en la ventana (incluidos NN).
    horasMap.forEach((min, nombre) => {
      if (!nombre || nombre === '(sin conductor)') return;
      const id = puente.get(normNombre(nombre));
      const esperado = id != null && espSet.has(String(id));
      const km = matPorNom.get(normNombre(nombre));
      const horas = Math.round((min / 6)) / 10;   // min → h (1 decimal)
      filas.push({
        nombre,
        telefono: (id != null && contac.get(String(id)) && contac.get(String(id)).telefono) || '',
        matriculas: km ? km.matriculas : [],
        horas,
        estado: horas > 0 ? (esperado ? 'salio' : 'nn') : (esperado ? 'no_salio' : 'nn'),
        esperado,
      });
      if (id != null) vistosId.add(String(id));
    });
    // 2) Previstos que NO rodaron → "No salió" (con su teléfono del plan, para llamar).
    espSet.forEach(id => {
      if (vistosId.has(id)) return;
      const p = planInfo.get(id) || {};
      filas.push({
        nombre: p.nombre || ('#' + id), telefono: p.telefono || '',
        matriculas: [], horas: 0, estado: 'no_salio', esperado: true,
      });
    });
    // Los que rodaron primero (más horas arriba); los que no salieron, al final.
    filas.sort((a, b) => (b.horas - a.horas) || String(a.nombre).localeCompare(String(b.nombre), 'es'));

    const resumen = {
      trabajaron: filas.filter(f => f.horas > 0).length,
      nn: filas.filter(f => f.estado === 'nn' && f.horas > 0).length,
      noSalieron: filas.filter(f => f.estado === 'no_salio').length,
      previstos: espSet.size,
      horas: Math.round(filas.reduce((s, f) => s + (f.horas || 0), 0) * 10) / 10,
    };
    return { filas, resumen };
  };

  const dDia = construir(hDia, kmDia, esp.dia);
  const dNoche = construir(hNoche, kmNoche, esp.noche);
  return {
    dia: d, fecha: d.split('-').reverse().join('/'),
    turnos: [
      { codigo: 'dia', etiqueta: 'DÍA', ventana: '05:00 → 17:00', ...dDia },
      { codigo: 'noche', etiqueta: 'NOCHE', ventana: '17:00 → 05:00', ...dNoche },
    ],
  };
}

// ── Excel ─────────────────────────────────────────────────────────────────────
const AZUL = 'FF1F4E79', CAB_DIA = 'FFFDF0D2', CAB_NOCHE = 'FFDCE7FA';
const VERDE = 'FF16A34A', AMBAR = 'FFB45309', ROJO = 'FFC00000', NEGRO = 'FF1F2937';
const CABECERAS = ['Nº', 'Conductor', 'Teléfono', 'Matrícula(s)', 'Horas', 'Estado'];
const ANCHOS = [5, 30, 15, 20, 9, 12];
const ETIQ_ESTADO = { salio: 'Salió', nn: 'NN (sin plan)', no_salio: 'No salió' };
const COLOR_ESTADO = { salio: VERDE, nn: AMBAR, no_salio: ROJO };

const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const borde = () => { const l = { style: 'thin', color: { argb: 'FFD1D5DB' } }; return { top: l, left: l, bottom: l, right: l }; };

function bloque(ws, fila, turno) {
  const ultima = 'F';
  ws.mergeCells(`A${fila}:${ultima}${fila}`);
  const tt = ws.getCell(`A${fila}`);
  tt.value = `${turno.codigo === 'noche' ? '🌙' : '☀️'}  TURNO DE ${turno.etiqueta}  ·  ${turno.ventana}  ·  ${turno.resumen.trabajaron} rodaron`;
  tt.font = { size: 11, bold: true, color: { argb: AZUL } };
  tt.fill = relleno(turno.codigo === 'noche' ? CAB_NOCHE : CAB_DIA);
  tt.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  tt.border = borde();
  ws.getRow(fila).height = 22;
  fila++;

  const cab = ws.getRow(fila);
  CABECERAS.forEach((c, i) => {
    const cel = cab.getCell(i + 1);
    cel.value = c; cel.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cel.fill = relleno(AZUL); cel.alignment = { vertical: 'middle', horizontal: i === 1 ? 'left' : 'center', indent: i === 1 ? 1 : 0 };
    cel.border = borde();
  });
  fila++;

  if (!turno.filas.length) {
    ws.mergeCells(`A${fila}:${ultima}${fila}`);
    const v = ws.getCell(`A${fila}`);
    v.value = 'Nadie en este turno.'; v.font = { italic: true, color: { argb: 'FF9AA1AC' } };
    v.alignment = { vertical: 'middle', horizontal: 'center' }; v.border = borde();
    return fila + 2;
  }

  turno.filas.forEach((f, i) => {
    const r = ws.getRow(fila);
    const vals = [i + 1, f.nombre, fmtTel(f.telefono), (f.matriculas || []).join(' · '),
      f.horas != null ? Number(f.horas) : '', ETIQ_ESTADO[f.estado] || ''];
    vals.forEach((v, ci) => {
      const cel = r.getCell(ci + 1);
      cel.value = v; cel.border = borde();
      cel.alignment = { vertical: 'middle', horizontal: ci === 1 ? 'left' : 'center', indent: ci === 1 ? 1 : 0 };
      cel.font = { size: 11, color: { argb: NEGRO }, bold: ci === 4 };
      if (i % 2) cel.fill = relleno('FFFAFBFC');
    });
    r.getCell(6).font = { size: 11, bold: true, color: { argb: COLOR_ESTADO[f.estado] || NEGRO } };
    if (f.estado === 'no_salio') r.getCell(2).font = { size: 11, color: { argb: ROJO } };
    r.height = 18;
    fila++;
  });

  // Resumen del turno.
  const rs = turno.resumen;
  ws.mergeCells(`A${fila}:${ultima}${fila}`);
  const res = ws.getCell(`A${fila}`);
  res.value = `Rodaron ${rs.trabajaron}  ·  NN ${rs.nn}  ·  No salieron ${rs.noSalieron}  ·  Previstos ${rs.previstos}  ·  ${rs.horas} h`;
  res.font = { size: 10, italic: true, color: { argb: NEGRO } };
  res.alignment = { horizontal: 'right', indent: 1 }; res.border = borde();
  return fila + 2;
}

async function excelTurnos(reporte) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tibus Luxury';
  const ws = wb.addWorksheet('Reporte por turnos', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ANCHOS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  ws.mergeCells('A1:F1');
  const tit = ws.getCell('A1');
  tit.value = `Reporte por turnos (5-5)  ·  ${reporte.fecha}`;
  tit.font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  tit.fill = relleno(AZUL); tit.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 26;

  let fila = 3;
  reporte.turnos.forEach(t => { fila = bloque(ws, fila, t); });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { datos, excelTurnos };
