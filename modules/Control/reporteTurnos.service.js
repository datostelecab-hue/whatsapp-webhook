// ============================================================
// REPORTE DE HORAS POR TURNO — Excel, con NN
// ============================================================
// El reporte que sacaba el control antiguo: por TURNO, con TODO el que trabajó
// en él, incluidos los NN (los que rodaron sin estar planificados). Sale del
// núcleo (fv_tramo/fv_ruta), no de las hojas.
//
// DESDE EL 06/10/2026 EL TURNO ES SU GENTE, NO UN RELOJ (Camilo: «todos los
// reportes con la misma regla»). Antes era «5-5»: día de 05:00 a 17:00 y noche
// de 17:00 a 05:00. Ahora, la regla de Control y Visibilidad
// (services/flotaViva/repartoTurnos.js):
//   · Día   de 00:00 a 24:00, para la gente de día del cuadrante
//   · Noche de 12:00 a 12:00 del día siguiente, para la de noche
//   · Los NN, por su hora de inicio: antes de las 12:00, día
// Cada segundo de cada persona va a UN turno, así que nadie sale en los dos con
// las mismas horas.
//
//   Salió     = trabajó en su turno y estaba previsto
//   NN        = trabajó pero no estaba en el plan de ese turno
//   No salió  = estaba previsto y no rodó
//
// datos(dia)          → estructura pura (por turno, sus filas + resumen)
// excelTurnos(reporte)→ Buffer del .xlsx (puro: se puede probar sin BD)

const ExcelJS = require('exceljs');
const rutas = require('../../services/flotaViva/rutas');
const reparto = require('../../services/flotaViva/repartoTurnos');
const { salidasHoy, contactos } = require('../Planificacion/tablero.service');
const db = require('../../services/db');

const TZ = 'Europe/Madrid';
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const fmtTel = t => {
  const d = String(t || '').replace(/\D/g, '').slice(-9);
  return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : (t || '');
};

// Puente cuenta de BOLT (uuid) → conductor_id: TODAS las cuentas de cada persona.
// Antes se cruzaba por NOMBRE y una persona con dos cuentas con nombres distintos
// salía dos veces (o ninguna, si el nombre de BOLT no casaba con el de la ficha).
// Y LAS PRESTADAS DE ESE DÍA, después: lo que hizo una cuenta prestada es de
// quien la llevaba, igual que en el reparto de horas.
async function puenteUuidId(dia) {
  const m = new Map();
  const r = await db.consulta(
    `SELECT conductor_id, externo_id FROM conductor_externo
      WHERE sistema = 'bolt' AND conductor_id IS NOT NULL AND externo_id IS NOT NULL`);
  r.rows.forEach(x => m.set(String(x.externo_id), Number(x.conductor_id)));
  const p = await db.consulta(
    `SELECT ce.externo_id, f.conductor_id
       FROM cuenta_fantasma f
       JOIN conductor_externo ce ON ce.id = f.cuenta_id
      WHERE f.anulado_at IS NULL AND ce.externo_id IS NOT NULL
        AND f.desde <= $1::date AND (f.hasta IS NULL OR f.hasta >= $1::date)`, [dia]).catch(() => ({ rows: [] }));
  p.rows.forEach(x => m.set(String(x.externo_id), Number(x.conductor_id)));
  return m;
}

/** El día anterior, 'YYYY-MM-DD'. */
const ayerDe = iso => {
  const [Y, M, D] = iso.split('-').map(Number);
  return new Date(Date.UTC(Y, M - 1, D - 1, 12)).toISOString().slice(0, 10);
};

/**
 * Estructura del reporte (pura, sin Excel).
 *
 *   Salió       trabajó en su turno y estaba previsto
 *   Otro turno  trabajó en este turno pero estaba previsto en el OTRO (el de
 *               noche que empezó antes de las 12:00, que es de día por su hora
 *               de inicio). No es un NN.
 *   NN          trabajó y no estaba en el plan de ninguno de los dos turnos
 *   No salió    estaba previsto y su turno ya acabó (17:00 o 05:00) sin rodar
 *   Pendiente   estaba previsto y su turno aún no ha acabado
 */
async function datos(dia) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : hoyMadrid();
  await require('../../services/flotaViva/db').preparar();

  // Lo esencial va SIN red: si el núcleo o el plan no responden, la ruta
  // contesta 500. Antes se tragaba el error y salía un Excel plausible con todos
  // "No salió" (o todos NN) que alguien se podía creer.
  const [vent, horasRep, plan, planAyer, puente, contac] = await Promise.all([
    rutas.actividadDeVariosTurnos(d, ['diaControl', 'nocheControl']),
    reparto.porPersonaYDia([d]),
    salidasHoy(d),
    salidasHoy(ayerDe(d)).catch(() => ({ turnos: [] })),
    puenteUuidId(d),
    contactos().catch(() => new Map()),
  ]);

  const setDe = (p, codigo) => new Set(
    (((p.turnos || []).find(t => t.codigo === codigo) || {}).conductores || []).map(c => String(c.conductorId)));
  const esp = { dia: setDe(plan, 'dia'), noche: setDe(plan, 'noche') };
  // Quien está previsto en el OTRO turno (para el día, también la noche de ayer).
  const otro = { dia: new Set([...esp.noche, ...setDe(planAyer, 'noche')]), noche: esp.dia };
  // Nombre/teléfono del plan, para los que NO rodaron: hay que llamarlos igual.
  const planInfo = new Map();
  (plan.turnos || []).forEach(t => (t.conductores || []).forEach(c =>
    planInfo.set(String(c.conductorId), { nombre: c.conductor, telefono: c.telefono })));

  // Cuándo empieza a contar cada turno, cuándo deja de contar y cuándo ACABA.
  // Lo último es la hora estándar (17:00 y 05:00): a partir de ahí quien no
  // salió es una ausencia, aunque las horas sigan contando hasta las 24:00 o las
  // 12:00 por si alguien remata tarde.
  const manana = reparto.sumarDias(d, 1);
  const horario = {
    dia:   { cuenta: reparto.instante(d, reparto.INICIO.dia), cierra: reparto.instante(manana, reparto.INICIO.dia),
             acaba: reparto.instante(d, reparto.ENTRA.noche) },
    noche: { cuenta: reparto.instante(d, reparto.INICIO.noche), cierra: reparto.cierreDe(d),
             acaba: reparto.instante(manana, reparto.ENTRA.dia) },
  };

  const construir = (turno, act, espSet, otroSet) => {
    const ahora = Date.now();
    const h = horario[turno];
    const acabado = ahora >= h.acaba;
    // Por PERSONA (conductor_id), fundiendo sus cuentas de BOLT; sin ficha, por
    // uuid. Las horas, las del reparto de ese turno.
    const porPersona = new Map();
    ((act && act.porUuid) || new Map()).forEach(a => {
      const cid = puente.get(a.uuid);
      const k = cid ? 'c' + cid : 'u' + a.uuid;
      if (!porPersona.has(k)) {
        const x = (horasRep.get(k) || new Map()).get(d) || { dia: 0, noche: 0 };
        porPersona.set(k, { id: cid ? String(cid) : null, nombre: a.nombre || '', telefono: a.telefono || '',
          minutos: Math.floor((x[turno] || 0) / 60), matriculas: [] });
      }
      const p = porPersona.get(k);
      if (!p.nombre) p.nombre = a.nombre || '';
      if (!p.telefono) p.telefono = a.telefono || '';
      (a.matriculas || []).forEach(m => { if (!p.matriculas.includes(m)) p.matriculas.push(m); });
    });

    const filas = [];
    const vistosId = new Set();
    // 1) TODO el que rodó en el turno.
    porPersona.forEach(p => {
      const esperado = p.id != null && espSet.has(p.id);
      const deOtroTurno = !esperado && p.id != null && otroSet.has(p.id);
      // Menos de un minuto sin estar previsto es el ruido de un login, no una
      // fila. Y quien pisó la ventana con horas que son del otro turno, tampoco.
      if (p.minutos < 1 && !esperado) return;
      const rodo = p.minutos >= 1;
      const info = (p.id && planInfo.get(p.id)) || {};
      filas.push({
        nombre: p.nombre || info.nombre || ('#' + (p.id || '?')),
        telefono: (p.id && contac.get(p.id) && contac.get(p.id).telefono) || info.telefono || p.telefono || '',
        matriculas: rodo ? p.matriculas : [],
        horas: Math.round(p.minutos / 6) / 10,
        estado: rodo
          ? (esperado ? 'salio' : deOtroTurno ? 'otro_turno' : 'nn')
          : (acabado ? 'no_salio' : 'pendiente'),
        esperado,
      });
      if (p.id != null) vistosId.add(p.id);
    });
    // 2) Previstos que NO rodaron: "No salió" si su turno acabó; si no, pendiente.
    espSet.forEach(id => {
      if (vistosId.has(id)) return;
      const p = planInfo.get(id) || {};
      filas.push({
        nombre: p.nombre || ('#' + id), telefono: p.telefono || '',
        matriculas: [], horas: 0, estado: acabado ? 'no_salio' : 'pendiente', esperado: true,
      });
    });
    // Los que rodaron primero (más horas arriba); los que no salieron, al final.
    filas.sort((a, b) => (b.horas - a.horas) || String(a.nombre).localeCompare(String(b.nombre), 'es'));

    const resumen = {
      trabajaron: filas.filter(f => f.horas > 0).length,
      nn: filas.filter(f => f.estado === 'nn').length,
      otroTurno: filas.filter(f => f.estado === 'otro_turno').length,
      noSalieron: filas.filter(f => f.estado === 'no_salio').length,
      pendientes: filas.filter(f => f.estado === 'pendiente').length,
      previstos: espSet.size,
      horas: Math.round(filas.reduce((s, f) => s + (f.horas || 0), 0) * 10) / 10,
    };
    return { filas, resumen, empezada: ahora >= h.cuenta, terminada: ahora >= h.cierra };
  };

  const dDia = construir('dia', vent.get('diaControl'), esp.dia, otro.dia);
  const dNoche = construir('noche', vent.get('nocheControl'), esp.noche, otro.noche);
  return {
    dia: d, fecha: d.split('-').reverse().join('/'),
    turnos: [
      { codigo: 'dia', etiqueta: 'DÍA', ventana: '00:00 → 24:00', ...dDia },
      { codigo: 'noche', etiqueta: 'NOCHE', ventana: '12:00 → 12:00', ...dNoche },
    ],
  };
}

// ── Excel ─────────────────────────────────────────────────────────────────────
const AZUL = 'FF1F4E79', CAB_DIA = 'FFFDF0D2', CAB_NOCHE = 'FFDCE7FA';
const VERDE = 'FF16A34A', AMBAR = 'FFB45309', ROJO = 'FFC00000', NEGRO = 'FF1F2937';
const CABECERAS = ['Nº', 'Conductor', 'Teléfono', 'Matrícula(s)', 'Horas', 'Estado'];
const ANCHOS = [5, 30, 15, 20, 9, 12];
const GRIS = 'FF6B7280';
const ETIQ_ESTADO = { salio: 'Salió', nn: 'NN (sin plan)', otro_turno: 'Otro turno', no_salio: 'Ausencia', pendiente: 'Pendiente' };
const COLOR_ESTADO = { salio: VERDE, nn: AMBAR, otro_turno: GRIS, no_salio: ROJO, pendiente: GRIS };

const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const borde = () => { const l = { style: 'thin', color: { argb: 'FFD1D5DB' } }; return { top: l, left: l, bottom: l, right: l }; };

function bloque(ws, fila, turno) {
  const ultima = 'F';
  ws.mergeCells(`A${fila}:${ultima}${fila}`);
  const tt = ws.getCell(`A${fila}`);
  // Si la ventana no ha cerrado, se dice en el título: los "pendientes" no son faltas.
  const estadoVentana = !turno.empezada ? '  ·  SIN EMPEZAR' : (!turno.terminada ? '  ·  EN CURSO' : '');
  tt.value = `${turno.codigo === 'noche' ? '🌙' : '☀️'}  TURNO DE ${turno.etiqueta}  ·  ${turno.ventana}  ·  ${turno.resumen.trabajaron} rodaron${estadoVentana}`;
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
  res.value = `Rodaron ${rs.trabajaron}  ·  NN ${rs.nn}` +
    (rs.otroTurno ? `  ·  De otro turno ${rs.otroTurno}` : '') +
    (rs.pendientes ? `  ·  Pendientes ${rs.pendientes}` : `  ·  No salieron ${rs.noSalieron}`) +
    `  ·  Previstos ${rs.previstos}  ·  ${rs.horas} h`;
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
  tit.value = `Reporte por turnos  ·  ${reporte.fecha}  ·  día de 00:00 a 24:00 y noche de 12:00 a 12:00, por el turno de cada conductor`;
  tit.font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  tit.fill = relleno(AZUL); tit.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 26;

  let fila = 3;
  reporte.turnos.forEach(t => { fila = bloque(ws, fila, t); });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { datos, excelTurnos };
