// ============================================================
// VACACIONES — el Excel por meses (12/11/2026)
// ============================================================
// Camilo: «Ponme en bitácora un descargable en excel de las vacaciones por
// meses». Una fila por persona y, por cada mes desde el 01/01/2026, un bloque de
// cuatro columnas: lo que GENERÓ ese mes (0,084 por día, con el tope de 1,85), los
// FESTIVOS trabajados que suman (fuera del tope), lo DISFRUTADO y el SALDO al
// acabar el mes. Al final, el saldo de hoy, lo programado y lo que quedará.
// Los datos los arma vacaciones.service.porMeses: es la misma cuenta que la
// pantalla de Vacaciones, así que lo que dice el Excel es lo que dice la ficha.

const ExcelJS = require('exceljs');
const E = require('../../services/excelEstilo');

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ddmm = iso => (iso ? iso.split('-').reverse().join('/') : '');
const n2 = v => String(v).replace('.', ',');
const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

const ROJO = 'FF991B1B';
const SUAVE = { mesPar: 'FFF7F8FA', tope: 'FFFFF4D6', saldo: 'FFFFF4DA', baja: 'FFF3F4F6' };
const CAMPOS = [
  { titulo: 'Generadas', clave: 'generadas', ancho: 10 },
  { titulo: 'Festivos', clave: 'festivos', ancho: 8 },
  { titulo: 'Disfrutadas', clave: 'disfrutadas', ancho: 10 },
  { titulo: 'Saldo', clave: 'saldoFin', ancho: 9 },
];

/**
 * @param {Object} datos  lo que devuelve vacaciones.service.porMeses()
 * @returns {Promise<Buffer>}
 */
async function porMeses(datos) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = new Date();
  const ws = wb.addWorksheet('Por meses', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const FIJAS = [{ titulo: 'Conductor', ancho: 34 }, { titulo: 'Contrato', ancho: 12 }, { titulo: 'Alta', ancho: 11 }];
  const FINAL = [{ titulo: 'Saldo hoy', ancho: 11 }, { titulo: 'Programadas', ancho: 12 }, { titulo: 'Quedará', ancho: 10 }];
  const nCols = FIJAS.length + datos.meses.length * CAMPOS.length + FINAL.length;
  const anchos = [...FIJAS.map(c => c.ancho), ...datos.meses.flatMap(() => CAMPOS.map(c => c.ancho)), ...FINAL.map(c => c.ancho)];
  anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const conBaja = datos.filas.filter(f => f.deBaja).length;
  let fila = E.bandaCabecera(ws, E.registrarLogo(wb), 'Vacaciones por meses',
    `${datos.filas.length - conBaja} de alta y ${conBaja} que se fueron este año · plantilla propia · generado el ${sello()}`, nCols);

  // La leyenda: cómo sale cada número.
  ws.mergeCells(fila, 1, fila, nCols);
  const ley = ws.getCell(fila, 1);
  ley.value = `Generadas: ${n2(datos.tasa)} días por cada día trabajado más de 4 h, con una J aprobada o de baja médica (cada día de baja), ` +
    `como mucho ${n2(datos.topeMes)} al mes (en ámbar, los meses que llegan al tope). Festivos: +1 por festivo trabajado más de 6 h en su jornada, ` +
    'fuera del tope (los de septiembre para atrás se pagaron en nómina). Disfrutadas: los días de vacaciones que le tocaba trabajar. ' +
    'Saldo: lo que le queda al acabar el mes, con lo de los meses anteriores. Se cuenta desde el 01/01/2026 o desde su alta. ' +
    'Quien se fue, hasta el día de su baja (en gris).';
  ley.font = { size: 9, italic: true, color: { argb: E.TENUE } };
  ley.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(fila).height = 40;
  fila++;

  // DOS FILAS DE CABECERA: el mes encima de sus cuatro columnas.
  const cab1 = ws.getRow(fila), cab2 = ws.getRow(fila + 1);
  const pintaCab = (c, texto) => {
    c.value = texto;
    c.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = E.relleno(E.CAB_BG);
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = E.TODOS_BORDES;
  };
  FIJAS.forEach((c, i) => { ws.mergeCells(fila, i + 1, fila + 1, i + 1); pintaCab(cab1.getCell(i + 1), c.titulo); });
  datos.meses.forEach((m, k) => {
    const col = FIJAS.length + k * CAMPOS.length + 1;
    ws.mergeCells(fila, col, fila, col + CAMPOS.length - 1);
    pintaCab(cab1.getCell(col), `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`);
    CAMPOS.forEach((c, j) => pintaCab(cab2.getCell(col + j), c.titulo));
  });
  const colFinal = FIJAS.length + datos.meses.length * CAMPOS.length + 1;
  FINAL.forEach((c, i) => { ws.mergeCells(fila, colFinal + i, fila + 1, colFinal + i); pintaCab(cab1.getCell(colFinal + i), c.titulo); });
  cab1.height = 20; cab2.height = 18;
  const filaCab = fila + 1;
  fila += 2;

  datos.filas.forEach(p => {
    const r = ws.getRow(fila++);
    const celda = (n, valor, { num, negrita, bg, color, al } = {}) => {
      const c = r.getCell(n);
      c.value = valor;
      c.border = E.TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: al || (num ? 'right' : 'left'), indent: al ? 0 : 1 };
      c.font = { size: 10, bold: !!negrita, color: { argb: color || (p.deBaja ? E.TENUE : E.TEXTO) } };
      if (num) c.numFmt = '0.00;[Red]-0.00;"–"';
      if (bg) c.fill = E.relleno(bg);
    };
    celda(1, p.nombre + (p.deBaja ? ` (baja ${ddmm(p.baja)})` : ''), { bg: p.deBaja ? SUAVE.baja : null });
    celda(2, p.contrato, { al: 'center' });
    celda(3, ddmm(p.alta), { al: 'center' });
    p.meses.forEach((m, k) => {
      const col = FIJAS.length + k * CAMPOS.length + 1;
      const par = k % 2 ? SUAVE.mesPar : null;
      if (!m) { CAMPOS.forEach((_, j) => celda(col + j, null, { bg: par })); return; }
      celda(col, m.generadas, { num: true, bg: m.tope ? SUAVE.tope : par });
      if (m.tope) r.getCell(col).note = `Daría ${n2(m.sinTope)}: se queda en el tope de ${n2(datos.topeMes)} al mes.`;
      celda(col + 1, m.festivos, { num: true, bg: par });
      celda(col + 2, m.disfrutadas ? -m.disfrutadas : 0, { num: true, bg: par });
      celda(col + 3, m.saldoFin, { num: true, negrita: true, bg: par });
    });
    celda(colFinal, p.saldo, { num: true, negrita: true, bg: SUAVE.saldo, color: p.saldo < 0 ? ROJO : null });
    celda(colFinal + 1, p.programadas ? -p.programadas : 0, { num: true });
    celda(colFinal + 2, p.saldoTras, { num: true, color: p.saldoTras < 0 ? ROJO : null });
    r.height = 18;
  });
  if (!datos.filas.length) {
    ws.getRow(fila).getCell(1).value = 'Nadie de plantilla propia con saldo de vacaciones.';
    ws.getRow(fila).getCell(1).font = { size: 10, italic: true, color: { argb: E.TENUE } };
  }

  ws.views = [{ state: 'frozen', ySplit: filaCab, xSplit: 1 }];
  ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: nCols } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { porMeses };
