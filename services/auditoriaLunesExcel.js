// ============================================================
// EXCEL DE LA AUDITORÍA DE LOS LUNES
// ============================================================
// Cuatro hojas, y cada una contesta una pregunta:
//
//   1. Resumen        — cuánto se cae cada lunes y por qué, en cuatro filas.
//   2. Por conductor  — persona a persona, los cuatro lunes con horas y motivo.
//   3. Por matrícula  — el mismo lunes visto desde el coche: plaza de día y de
//                       noche, quién la tenía y si el coche llegó a rodar.
//   4. Faltas y J     — la lista plana con la que se llama por teléfono.
//
// El color es el que se lee primero: verde salió, rojo no salió, ámbar
// justificado, azul ausencia, violeta hueco de planificación, gris no exigible.
// Es la misma escala en las tres hojas para no tener que aprenderse dos.

const ExcelJS = require('exceljs');
const E = require('./excelEstilo');

const esFecha = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const cortoDia = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

// Un estado, un tono y una palabra. Lo que se ve de un vistazo antes de leer nada.
const TONO = {
  salio: { bg: 'FFD1FAE5', fg: 'FF065F46', txt: 'Sí' },
  no_salio: { bg: 'FFFEE2E2', fg: 'FF991B1B', txt: 'NO' },
  justificado: { bg: 'FFFEF3C7', fg: 'FF92400E', txt: 'J' },
  ausencia: { bg: 'FFDBEAFE', fg: 'FF1E40AF', txt: 'Ausente' },
  sin_bolt: { bg: 'FFFFEDD5', fg: 'FF9A3412', txt: '?' },
  sin_plan: { bg: 'FFEDE9FE', fg: 'FF5B21B6', txt: 'Sin plan' },
  no_exigible: { bg: 'FFF3F4F6', fg: 'FF6B7280', txt: '—' },
};
const tonoDe = c => TONO[c && c.estado] || null;

/**
 * Una hoja: banda, cabecera de tabla, filas y filtro. `cols` es la definición
 * declarativa —título, ancho, cómo se saca el valor y de qué color va—.
 */
function hoja(wb, idLogo, nombre, titulo, subtitulo, cols, filas, vacio) {
  const ws = wb.addWorksheet(nombre);
  ws.columns = cols.map(c => ({ width: c.ancho }));
  const filaCab = E.bandaCabecera(ws, idLogo, titulo, subtitulo, cols.length);
  let f = E.cabeceraTabla(ws, filaCab, cols.map(c => c.titulo));
  ws.views = [{ state: 'frozen', xSplit: cols.filter(c => c.fija).length, ySplit: filaCab }];

  filas.forEach(d => {
    const r = ws.getRow(f++);
    cols.forEach((c, i) => {
      const cel = r.getCell(i + 1);
      const v = c.valor(d);
      cel.value = v === undefined ? '' : v;
      cel.border = E.TODOS_BORDES;
      cel.font = { size: 10, color: { argb: E.TEXTO } };
      cel.alignment = { vertical: 'middle', horizontal: c.al || 'left' };
      if (c.formato) cel.numFmt = c.formato;
      const t = c.tono && c.tono(d);
      if (t) { cel.fill = E.relleno(t.bg); cel.font = { size: 10, bold: !!c.fuerte, color: { argb: t.fg } }; }
    });
    r.height = 17;
  });

  if (!filas.length) {
    const c = ws.getRow(f).getCell(1);
    c.value = vacio || 'Sin datos.';
    c.font = { size: 10, italic: true, color: { argb: E.TENUE } };
  } else {
    ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };
  }
  return ws;
}

// Las tres columnas que se repiten por cada lunes: si salió, cuántas horas y por qué.
function bloqueLunes(dia) {
  return [
    {
      titulo: `${cortoDia(dia)} · ¿Salió?`, ancho: 10, al: 'center', fuerte: true,
      valor: d => (tonoDe(d.dias[dia]) || {}).txt || '',
      tono: d => tonoDe(d.dias[dia]),
    },
    {
      titulo: `${cortoDia(dia)} · h`, ancho: 7, al: 'center', formato: '0.0',
      valor: d => (d.dias[dia].horas == null ? '' : d.dias[dia].horas),
    },
    { titulo: `${cortoDia(dia)} · motivo`, ancho: 30, valor: d => d.dias[dia].motivo || '' },
  ];
}

/** El bloque de texto que explica de dónde sale cada cosa. Va en el Resumen. */
function notas(ws, fila, lineas, nCols) {
  lineas.forEach((t, i) => {
    ws.mergeCells(fila + i, 1, fila + i, nCols);
    const c = ws.getCell(fila + i, 1);
    c.value = t;
    c.font = { size: 10, bold: i === 0, color: { argb: i === 0 ? E.TEXTO : E.TENUE } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
    ws.getRow(fila + i).height = i === 0 ? 20 : 16;
  });
  return fila + lineas.length + 1;
}

/**
 * @param {Object} r  lo que devuelve services/repo/auditoriaLunes.informe()
 * @returns {Promise<Buffer>}
 */
async function generar(r) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = new Date();
  const logo = E.registrarLogo(wb);
  const periodo = r.dias.map(esFecha).join(' · ');
  const pie = `generado el ${r.generado}`;
  const t = r.totales;

  // ── 1 · Resumen ───────────────────────────────────────────────────────────
  const COLS_RES = [
    { titulo: 'Lunes', ancho: 13, al: 'center', valor: d => esFecha(d.dia) },
    { titulo: 'Le tocaba a', ancho: 12, al: 'center', valor: d => d.exigibles },
    { titulo: 'Salieron', ancho: 10, al: 'center', fuerte: true, valor: d => d.salidas,
      tono: () => TONO.salio },
    { titulo: 'No salieron', ancho: 12, al: 'center', fuerte: true, valor: d => d.faltas,
      tono: d => (d.faltas ? TONO.no_salio : null) },
    { titulo: 'Con J', ancho: 8, al: 'center', valor: d => d.justificados,
      tono: d => (d.justificados ? TONO.justificado : null) },
    { titulo: 'Ausentes', ancho: 10, al: 'center', valor: d => d.ausentes,
      tono: d => (d.ausentes ? TONO.ausencia : null) },
    { titulo: 'Aún no de alta', ancho: 14, al: 'center', valor: d => d.noExigibles,
      tono: d => (d.noExigibles ? TONO.no_exigible : null) },
    { titulo: '% que salió', ancho: 12, al: 'center', formato: '0%',
      valor: d => (d.exigibles ? d.salidas / d.exigibles : '') },
    { titulo: 'Horas del lunes', ancho: 15, al: 'center', formato: '0.0', valor: d => d.horas },
    { titulo: 'Media h/quien salió', ancho: 18, al: 'center', formato: '0.0',
      valor: d => (d.salidas ? Math.round((d.horas / d.salidas) * 10) / 10 : '') },
    { titulo: 'Plazas del lunes', ancho: 15, al: 'center', valor: d => d.plazas },
    { titulo: 'Plazas que rodaron', ancho: 17, al: 'center', valor: d => d.plazasCubiertas },
    { titulo: 'Plazas sin nadie', ancho: 15, al: 'center', fuerte: true, valor: d => d.plazasSinPlan,
      tono: d => (d.plazasSinPlan ? TONO.sin_plan : null) },
  ];
  const wsR = hoja(wb, logo, 'Resumen', 'Auditoría de los lunes',
    `${periodo} · ${t.conductores} conductores con plaza de lunes · ${t.cochesOperativos} coches operativos ` +
    `· ${t.plazasLunes} plazas de lunes · ${pie}`,
    COLS_RES, r.porLunes);

  let f = wsR.rowCount + 2;
  f = notas(wsR, f, [
    'Cómo se lee',
    '· Verde «Sí» salió · rojo «NO» no salió y no hay nada que lo explique · ámbar «J» tiene justificante · ' +
    'azul «Ausente» vacaciones, baja médica o permiso · violeta «Sin plan» la plaza no tenía a nadie asignado · ' +
    'gris «—» ese lunes aún no estaba de alta.',
    '· Las horas son las EFECTIVAS de BOLT (viaje + espera) de la jornada operativa 05:00 → 05:00, las mismas ' +
    'que sella la bitácora. Un turno de noche que empieza el lunes a las 17:00 y acaba el martes a las 05:00 ' +
    'cuenta entero en el lunes.',
  ], COLS_RES.length);

  f = notas(wsR, f, [
    'Quién entra en el reporte',
    '· Solo quien tiene plaza y le toca LUNES: los fijos de un coche que descansa L-M no salen nunca un lunes ' +
    'y quedan fuera; en su lugar entra el correturnos (CT) que cubre ese coche los lunes.',
    '· Los de baja en la empresa no entran. Un lunes anterior a la fecha de alta no se le exige a nadie: ' +
    'quien entró el martes pasado solo tiene un lunes que contar.',
  ], COLS_RES.length);

  f = notas(wsR, f, [
    'De dónde sale el plan',
    '· En la base de datos no hay planificación anterior al 3 de septiembre de 2026. El cuadrante que se ' +
    'aplica a los cuatro lunes es el ACTUAL —matrícula, turno y descansos de hoy— proyectado hacia atrás, que ' +
    'es lo que ha habido las últimas semanas.',
    `· ${t.conPlan} de las ${t.plazasLunes} plazas de lunes tienen a alguien asignado; el resto son huecos del ` +
    'planificador y salen marcados en violeta en la hoja «Por matrícula».',
  ], COLS_RES.length);

  // ── 2 · Por conductor ─────────────────────────────────────────────────────
  const COLS_COND = [
    { titulo: '#', ancho: 5, al: 'center', fija: true, valor: d => d._n },
    { titulo: 'Conductor', ancho: 32, fija: true, valor: d => d.nombre },
    { titulo: 'Teléfono', ancho: 14, valor: d => d.telefono },
    { titulo: 'Contrato', ancho: 10, al: 'center', valor: d => (d.contrato === 'ett' ? 'ETT' : 'Propia') },
    { titulo: 'Matrícula', ancho: 20, al: 'center', valor: d => d.matriculas },
    { titulo: 'Turno', ancho: 12, al: 'center', valor: d => d.turnos },
    { titulo: 'Plaza', ancho: 8, al: 'center', valor: d => (d.rol === 'CT' ? 'CT' : 'Fijo') },
    { titulo: 'Descansa', ancho: 10, al: 'center', valor: d => d.descansos || '—' },
    { titulo: 'Estado coche', ancho: 13, al: 'center', valor: d => d.estadoCoche },
    { titulo: 'Alta', ancho: 11, al: 'center', valor: d => esFecha(d.alta) },
    { titulo: 'Estado hoy', ancho: 15, al: 'center', valor: d => d.estadoHoy },
    ...r.dias.flatMap(bloqueLunes),
    { titulo: 'Lunes que le tocaban', ancho: 12, al: 'center', valor: d => d.exigibles },
    { titulo: 'Salió', ancho: 8, al: 'center', fuerte: true, valor: d => d.salidas, tono: () => TONO.salio },
    { titulo: 'No salió', ancho: 9, al: 'center', fuerte: true, valor: d => d.faltas,
      tono: d => (d.faltas ? TONO.no_salio : null) },
    { titulo: 'Con J', ancho: 7, al: 'center', valor: d => d.justificados,
      tono: d => (d.justificados ? TONO.justificado : null) },
    { titulo: 'Ausencias', ancho: 10, al: 'center', valor: d => d.ausentes,
      tono: d => (d.ausentes ? TONO.ausencia : null) },
    { titulo: 'Horas de los lunes', ancho: 13, al: 'center', formato: '0.0', valor: d => d.horas },
    { titulo: 'Media por lunes salido', ancho: 13, al: 'center', formato: '0.0', valor: d => d.media },
    { titulo: '% cumplimiento', ancho: 13, al: 'center', formato: '0%',
      valor: d => (d.cumple == null ? '' : d.cumple / 100) },
  ];
  r.conductores.forEach((c, i) => { c._n = i + 1; });
  hoja(wb, logo, 'Por conductor', 'Los lunes, conductor a conductor',
    `${periodo} · ${r.conductores.length} personas con plaza de lunes · ordenado por quien más lunes falló ` +
    `y menos horas hizo · ${pie}`,
    COLS_COND, r.conductores, 'Nadie con plaza de lunes.');

  // ── 3 · Por matrícula ─────────────────────────────────────────────────────
  const COLS_VEH = [
    { titulo: 'Matrícula', ancho: 11, al: 'center', fija: true, valor: d => d.matricula },
    { titulo: 'Turno', ancho: 8, al: 'center', fija: true, valor: d => d.turno },
    { titulo: 'Modelo', ancho: 22, valor: d => d.modelo },
    { titulo: 'Estado del coche', ancho: 15, al: 'center', valor: d => d.estadoCoche,
      tono: d => (d.operativo ? null : TONO.sin_bolt) },
    { titulo: 'Descansa', ancho: 10, al: 'center', valor: d => d.descansos || '—' },
    { titulo: 'Quién la tiene', ancho: 32, valor: d => d.conductor || '(nadie)',
      tono: d => (d.conductor ? null : TONO.sin_plan) },
    { titulo: 'Teléfono', ancho: 14, valor: d => d.telefono },
    { titulo: 'Plaza', ancho: 8, al: 'center', valor: d => (d.rol === 'CT' ? 'CT' : d.rol ? 'Fijo' : '—') },
    ...r.dias.flatMap(bloqueLunes),
    { titulo: 'Lunes que rodó', ancho: 12, al: 'center', fuerte: true, valor: d => d.salidas,
      tono: d => (d.salidas ? TONO.salio : TONO.no_salio) },
    { titulo: 'Horas de los lunes', ancho: 13, al: 'center', formato: '0.0', valor: d => d.horas },
  ];
  // Los operativos primero —son los 71 que deberían estar rodando—, y dentro de
  // ellos los que más lunes se quedaron parados arriba del todo.
  const coches = [...r.coches].sort((a, b) =>
    (Number(b.operativo) - Number(a.operativo)) || (a.salidas - b.salidas) ||
    a.matricula.localeCompare(b.matricula) || a.turno.localeCompare(b.turno));
  hoja(wb, logo, 'Por matrícula', 'Los lunes, coche a coche',
    `${periodo} · ${t.cochesOperativos} coches operativos y ${t.coches - t.cochesOperativos} no operativos, ` +
    `cada uno con su plaza de día y de noche · los que menos rodaron, arriba · ${pie}`,
    COLS_VEH, coches, 'Ningún coche con plaza viva.');

  // ── 4 · Faltas y justificantes ────────────────────────────────────────────
  const COLS_DET = [
    { titulo: 'Lunes', ancho: 12, al: 'center', valor: d => esFecha(d.dia) },
    { titulo: 'Conductor', ancho: 32, valor: d => d.nombre },
    { titulo: 'Teléfono', ancho: 14, valor: d => d.telefono },
    { titulo: 'Matrícula', ancho: 20, al: 'center', valor: d => d.matricula },
    { titulo: 'Turno', ancho: 12, al: 'center', valor: d => d.turno },
    { titulo: 'Plaza', ancho: 8, al: 'center', valor: d => (d.rol === 'CT' ? 'CT' : 'Fijo') },
    { titulo: 'Qué pasó', ancho: 12, al: 'center', fuerte: true,
      valor: d => (TONO[d.estado] || {}).txt || '', tono: d => TONO[d.estado] || null },
    { titulo: 'Horas en BOLT', ancho: 13, al: 'center', formato: '0.0',
      valor: d => (d.horasBolt == null ? '' : d.horasBolt) },
    { titulo: 'Horas de la J', ancho: 13, al: 'center', formato: '0.0',
      valor: d => (d.horasJ == null ? '' : d.horasJ) },
    { titulo: 'Tipo de J', ancho: 12, al: 'center', valor: d => d.tipoJ || '' },
    { titulo: 'Motivo', ancho: 48, valor: d => d.motivo || '' },
    { titulo: 'Observación de la J', ancho: 48, valor: d => d.observacion || '' },
  ];
  hoja(wb, logo, 'Faltas y J', 'Todo lo que no fue un lunes normal',
    `${periodo} · ${r.detalle.length} casos · faltas, justificantes con sus horas, ausencias y las rarezas ` +
    `(quien rodó constando de vacaciones) · ${pie}`,
    COLS_DET, r.detalle, 'Ni una falta: los cuatro lunes salieron todos.');

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar };
