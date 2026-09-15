// ============================================================
// CONVENIO · NÓMINA — el Excel que se manda a la gestoría
// ============================================================
// DOS HOJAS, y la segunda solo si hace falta: la nómina del mes y, aparte, los
// finiquitos de quien causó baja en él.
//
// Van separados porque son dos trámites distintos con dos plazos distintos: la
// nómina se presenta el mes que viene y un finiquito se paga al irse la persona.
// Mezclados en una tabla, el finiquito se cuela como un trabajador más con un
// importe raro, y quien lo revisa no ve por qué.
//
// Si nadie causó baja, la hoja NO se crea. Una hoja vacía en un libro que va a
// la gestoría es una pregunta garantizada por correo.

const ExcelJS = require('exceljs');

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Un hueco vacío NO es un cero: `null` deja la celda en blanco, y un cero dice
// "se calculó y salió cero". En una nómina esa diferencia se discute.
const num = v => (v === null || v === undefined) ? null : Number(v);

const EUROS = '#,##0.00 €';
const CABECERA = { fondo: 'FF2D3748', letra: 'FFFFFFFF' };

/** Cabecera en blanco sobre azul oscuro, que es como la pide la gestoría. */
function rematar(ws) {
  ws.getRow(1).font = { bold: true, color: { argb: CABECERA.letra } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CABECERA.fondo } };
}

const COLS_NOMINA = [
  { header: 'DNI/NIE', key: 'dni', width: 14 },
  { header: 'NAF', key: 'naf', width: 16 },
  { header: 'Trabajador', key: 'nombre', width: 30 },
  { header: 'Propinas', key: 'propinas', width: 12 },
  { header: 'Plus calidad', key: 'plus_calidad', width: 13 },
  { header: 'Bonus', key: 'bonus', width: 12 },
  { header: 'Garantía', key: 'garantia', width: 12 },
  { header: 'H. extra (min)', key: 'extra_min', width: 13 },
  { header: 'H. extra (€)', key: 'extra_eur', width: 12 },
  { header: 'Nocturn. (min)', key: 'nocturnidad_min', width: 14 },
  { header: 'Nocturn. (€)', key: 'nocturnidad_eur', width: 12 },
  { header: 'Descuentos', key: 'descuentos', width: 12 },
  { header: 'TOTAL €', key: 'total', width: 13 },
];

// Los minutos van EN MINUTOS, no en horas decimales: el convenio los cuenta así
// y la gestoría los teclea así. Convertirlos aquí sería obligar a deshacerlo.
const EN_EUROS = ['propinas', 'plus_calidad', 'bonus', 'garantia', 'extra_eur',
  'nocturnidad_eur', 'descuentos', 'total'];
const EN_MINUTOS = ['extra_min', 'nocturnidad_min'];

const COLS_FINIQUITOS = [
  { header: 'DNI/NIE', key: 'dni', width: 14 },
  { header: 'NAF', key: 'naf', width: 16 },
  { header: 'Trabajador', key: 'nombre', width: 30 },
  { header: 'Fecha baja', key: 'fecha_baja', width: 13 },
  { header: 'Tipo', key: 'tipo_baja', width: 16 },
  { header: 'Preaviso', key: 'preaviso', width: 12 },
  { header: 'Finiquito €', key: 'total', width: 13 },
  { header: 'Estado', key: 'estado', width: 12 },
];

const pad = n => String(n).padStart(2, '0');

/**
 * @param {object[]} filas       la nómina del mes
 * @param {object[]} finiquitos  las bajas del mes (puede venir vacío)
 */
async function generar({ anio, mes, filas, finiquitos }) {
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet(`Nómina ${MESES[mes - 1]} ${anio}`);
  ws.columns = COLS_NOMINA;
  rematar(ws);
  filas.forEach(f => ws.addRow({
    dni: f.dni, naf: f.naf, nombre: f.nombre,
    propinas: num(f.propinas), plus_calidad: num(f.plus_calidad), bonus: num(f.bonus),
    garantia: num(f.garantia), extra_min: num(f.extra_min), extra_eur: num(f.extra_eur),
    nocturnidad_min: num(f.nocturnidad_min), nocturnidad_eur: num(f.nocturnidad_eur),
    descuentos: num(f.descuentos), total: num(f.total),
  }));
  EN_EUROS.forEach(k => { ws.getColumn(k).numFmt = EUROS; });
  EN_MINUTOS.forEach(k => { ws.getColumn(k).numFmt = '#,##0'; });

  if (finiquitos.length) {
    const wf = wb.addWorksheet('Finiquitos');
    wf.columns = COLS_FINIQUITOS;
    rematar(wf);
    finiquitos.forEach(f => wf.addRow({
      dni: f.dni, naf: f.naf, nombre: f.nombre,
      fecha_baja: f.fecha_baja ? new Date(f.fecha_baja) : null,
      tipo_baja: f.tipo_baja,
      // Los días avisados sobre los exigidos: "7/15" se lee de un vistazo y
      // dice solo si hubo o no preaviso suficiente.
      preaviso: `${f.dias_preavisados}/${f.preaviso_exigido}`,
      total: num(f.total), estado: f.estado,
    }));
    wf.getColumn('total').numFmt = EUROS;
    wf.getColumn('fecha_baja').numFmt = 'dd/mm/yyyy';
  }

  return {
    bytes: Buffer.from(await wb.xlsx.writeBuffer()),
    nombre: `nomina-gestoria-${anio}-${pad(mes)}.xlsx`,
  };
}

module.exports = { generar, MESES };
