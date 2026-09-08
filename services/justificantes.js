// ============================================================
// REPORTE DE HORAS DEL DÍA — el Excel de Control
// ============================================================
// Aquí vive SOLO el Excel: cabecera de la casa, la tabla con el color en la
// celda de horas, el resumen del día y la leyenda.
//
//   verde  >=9  "Muy efectivo" · verde 7,6-8,9 "Efectivo" · amarillo 6,4-7,5
//   "Poco efectivo" · rojo <=6,3 "No cumplieron" · azul los J con su
//   observación, al final. Ámbar en los KM = REVISAR.
//
// Los DATOS los arma repo/reporteHoras, en PostgreSQL de punta a punta. Este
// módulo llevaba además la escritura de las J en la hoja JUSTIFICANTES y en
// VISTA_FINAL; eso se quedó sin uso cuando justificar pasó a la tabla
// `justificante` de PostgreSQL (Control y la bitácora escriben ahí), así que
// se ha quitado: era un segundo almacén de J que ya no leía nadie.

const ExcelJS = require('exceljs');
// El reporte del día se construye ENTERO en PostgreSQL (repo/reporteHoras): la
// lista de gente y las horas salen del mismo sitio y se cruzan por el uuid de
// BOLT. Aquí queda solo el Excel, que es lo que este módulo sabe hacer.
const rep = require('./repo/reporteHoras');
const est = require('./excelEstilo');

const TZ = 'Europe/Madrid';

function ahora() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}

// ── Reporte del día ─────────────────────────────────────────────────
// Vive en repo/reporteHoras: PostgreSQL de punta a punta. Se reexporta desde
// aquí porque es lo que llaman las rutas de Control desde siempre.
const { reporteDia, resumirFilas, banda, fechaDeClave } = rep;

// ── Excel del reporte (colores SOLO en la celda de horas) ───────────────────
// Los colores de la banda son los de siempre —tráfico ya los tiene interiorizados—;
// lo que cambia es el envoltorio: cabecera de la casa con el logo, tabla con bordes
// y, al final, el resumen del día y la leyenda de colores.
const FILL = { verde: 'FF63BE7B', amarillo: 'FFFFEB84', rojo: 'FFF8696B', azul: 'FF5B9BD5', gris: 'FFD9D9D9', revisar: 'FFFFC000' };
const CAB_REPORTE = ['Nº', 'Nombre', 'Teléfono', 'Turno', 'Horas', 'Observaciones', 'Matrícula', 'KM BOLT', 'KM descon.'];
const ANCHOS_REPORTE = [6, 34, 16, 11, 12, 26, 15, 12, 12];
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
    `${r.personas} conductor(es) en el reporte   ·   ${String(r.horasTotal).replace('.', ',')} h en total   ·   generado el ${ahora()}` +
      (reporte.parcial ? '   ·   PARCIAL: la jornada 05→05 sigue en curso' : ''),
    N_REPORTE);

  const filaCab = fila;
  fila = est.cabeceraTabla(ws, fila, CAB_REPORTE);

  reporte.filas.forEach((f, i) => {
    const row = ws.getRow(fila);
    [f.nro, f.nombre, f.telefono, f.turno || '', f.horasTexto, f.observacion,
     f.matricula || '', f.kmBolt == null ? '' : f.kmBolt, f.kmDesc == null ? '' : f.kmDesc].forEach((v, ci) => {
      const c = row.getCell(ci + 1);
      c.value = v;
      c.border = est.TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: ci === 1 ? 'left' : 'center', indent: ci === 1 ? 1 : 0 };
      c.font = { size: 11, color: { argb: est.TEXTO } };
      // Las dos columnas de KM (índices 7 y 8) en formato "0,0 km". La matrícula
      // (índice 6) es texto y no se toca.
      if (ci >= 7 && typeof v === 'number') c.numFmt = '0.0" km"';
      if (i % 2) c.fill = est.relleno('FFFAFBFC');
    });
    // El COLOR va solo en la celda de horas, como siempre.
    const cel = row.getCell(5);
    if (FILL[f.color]) cel.fill = est.relleno(FILL[f.color]);
    cel.font = { size: 11, bold: true, color: { argb: f.color === 'azul' ? 'FFFFFFFF' : 'FF1F2430' } };
    // REVISAR: las dos celdas de KM (8 y 9) en ámbar y negrita, para que salte a la
    // vista que ese km hay que cuadrarlo a mano (fichó con un coche sin traza de Mapon).
    if (f.revisar) {
      [8, 9].forEach(cn => {
        const kc = row.getCell(cn);
        kc.fill = est.relleno(FILL.revisar);
        kc.font = { size: 11, bold: true, color: { argb: 'FF5A4600' } };
        kc.alignment = { vertical: 'middle', horizontal: 'center' };
      });
    }
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
  fila = lineaResumen(ws, fila, 'Justificados con J', r.justificados, { tenue: true });
  if (r.horasJustificadas) fila = lineaResumen(ws, fila, 'Horas justificadas  ·  se SUMAN a las de BOLT', r.horasJustificadas, { horas: true, tenue: true });
  // Los que salieron sin estar en el cuadrante de ese día. Antes ni aparecían
  // en el reporte —salían del cruce por nombre contra la hoja— y sus horas se
  // perdían: es justo la gente por la que hay que preguntar.
  if (r.fueraDelPlan) {
    fila = lineaResumen(ws, fila, 'Salieron FUERA del cuadrante  ·  sin estar planificados', r.fueraDelPlan);
    fila = lineaResumen(ws, fila, 'Horas que hicieron esos', r.horasFueraDelPlan, { horas: true, tenue: true });
  }
  fila++;
  // Son las horas de la JORNADA ENTERA de la gente de cada turno, no las de la
  // franja horaria: el de día que alargó hasta las 20:00 suma todo en "DÍA".
  fila = lineaResumen(ws, fila, 'Horas de los conductores del turno de DÍA  ·  jornada completa', r.horasDia, { horas: true });
  fila = lineaResumen(ws, fila, 'Horas de los conductores del turno de NOCHE  ·  jornada completa', r.horasNoche, { horas: true });
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
    ['azul', 'Justificado (J) — sus horas justificadas se SUMAN a las de BOLT'],
    ['gris', 'Sin dato de horas ese día'],
    ['revisar', 'REVISAR — fichó en BOLT con un coche sin traza de Mapon; lo cuadra Tráfico']
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

module.exports = { fechaDeClave, banda, reporteDia, resumirFilas, excelDia };
