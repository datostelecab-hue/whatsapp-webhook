// ============================================================
// REPORTES — informes para enviar/descargar (RRHH)
// ============================================================
// Primer reporte: HORAS DE AYER de los conductores ETT, para mandárselas a la ETT.
// Cruza la agenda (planificador) con Datos_API (horas por día), igual que Control,
// pero enfocado a los ETT del día anterior. Devuelve datos + genera el Excel.

const ExcelJS = require('exceljs');
const { leerTablero } = require('./planificadorV2');
const { leerHorasDatosApi } = require('./control');
const { normClave } = require('./conductores');

const TZ = 'Europe/Madrid';
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** Fecha de AYER en Madrid: { Y, M, D, idx (Lun=0…Dom=6) }. */
function ayerMadrid() {
  const str = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [Y, M, D] = str.split('-').map(Number);
  const a = new Date(Date.UTC(Y, M - 1, D - 1, 12));
  return { Y: a.getUTCFullYear(), M: a.getUTCMonth() + 1, D: a.getUTCDate(), idx: (a.getUTCDay() + 6) % 7 };
}

/** Reporte de horas de AYER de los conductores ETT. */
async function reporteHorasEttAyer() {
  const { Y, M, D, idx } = ayerMadrid();
  const [tablero, datos] = await Promise.all([leerTablero(), leerHorasDatosApi()]);
  const conductores = (tablero && tablero.conductores) || [];
  const disponible = datos.mes === M && datos.ano === Y;   // Datos_API es del mes de ayer

  const filas = conductores
    .filter(c => /ETT/i.test(c.contrato || '') && (c.idBolt || '').trim())
    .map(c => {
      const clave = normClave(c.idBolt);
      const porDia = clave ? datos.horas.get(clave) : null;
      const horas = (disponible && porDia) ? (porDia[D] ?? 0) : 0;
      const mat = c.asignacion ? c.asignacion[idx] : '';
      return {
        nombre: (c.idBolt || '').trim(),
        turno: c.turno || '',
        contrato: c.contrato || '',
        dni: c.dni || '',
        naf: c.naf || '',
        matricula: (mat && mat !== 'L') ? mat : '',
        libra: !!(c.libra && c.libra[idx]),
        horas,
        telefono: c.telefono || ''
      };
    })
    .sort((a, b) => b.horas - a.horas || a.nombre.localeCompare(b.nombre, 'es'));

  const totalHoras = Math.round(filas.reduce((s, f) => s + (f.horas || 0), 0) * 10) / 10;
  return {
    fecha: `${String(D).padStart(2, '0')}/${String(M).padStart(2, '0')}/${Y}`,
    diaSemana: DIAS[idx],
    disponible, filas, totalHoras
  };
}

/** Excel del reporte de horas ETT → Buffer. */
async function generarExcelEttAyer(reporte) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Horas ETT');
  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = `Horas ETT — ${reporte.diaSemana} ${reporte.fecha}`;
  ws.getCell('A1').font = { bold: true, size: 13 };

  const cab = ['Conductor (BOLT)', 'Turno', 'Contrato', 'DNI/NIE', 'NAF', 'Matrícula', 'Horas', 'Teléfono'];
  ws.getRow(3).values = cab;
  ws.getRow(3).font = { bold: true };
  ws.columns = [{ width: 32 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 12 }, { width: 10 }, { width: 16 }];

  reporte.filas.forEach(f => {
    ws.addRow([
      f.nombre, f.turno, f.contrato, f.dni, f.naf,
      f.matricula || (f.libra ? 'Libra' : ''),
      f.horas != null ? Number(f.horas.toFixed(1)) : '',
      f.telefono
    ]);
  });
  ws.addRow([]);
  const totalRow = ws.addRow(['', '', '', '', '', 'TOTAL', Number(reporte.totalHoras.toFixed(1)), '']);
  totalRow.font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { reporteHorasEttAyer, generarExcelEttAyer };
