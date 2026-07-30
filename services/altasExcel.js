// ============================================================
// EXCEL DE ALTAS — para RRHH (formato "Altas TIBUS LUXURY")
// ============================================================
// Genera un .xlsx con una hoja (nombrada por la fecha del grupo) y una fila por
// ficha, con las columnas que espera la gestoría. La mayoría de campos salen de
// la ficha; empresa/motivo son fijos y la modalidad (CT-100/CT-200) y la fecha
// de alta se derivan.

const ExcelJS = require('exceljs');
const { contratoDe } = require('./fichaAlta');

const HEADERS = [
  'Nombre y apellidos', 'Empresa', 'Fecha de alta', 'Motivo de alta',
  'Modalidad contrato', 'DNI NIE', 'Fecha nacimiento', 'Dirección completa',
  'Código postal', 'Correo electrónico', 'Teléfono', 'Iban bancario',
  'NºSS', 'Nacionalidad'
];
const ANCHOS = [26, 16, 13, 14, 16, 12, 14, 34, 11, 28, 13, 26, 16, 14];

// dd/mm/aaaa (o con hora detrás) → Date a medianoche UTC. null si no casa.
function parseFecha(s) {
  const m = String(s || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
}

// Etiqueta de hoja "dd.mm" desde la fecha elegida.
function etiquetaHoja(s) {
  const m = String(s || '').match(/(\d{1,2})[\/\-.](\d{1,2})/);
  return m ? `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}` : 'Altas';
}

/**
 * Fecha de alta (col C): la de inicio de contrato de la ficha, SALVO que la fecha
 * de alta en BOLT (fecha en que se detectó al conductor en nuestra base) la haya
 * superado; en ese caso manda esa. Si no hay ninguna, cae al fallback (la fecha
 * del grupo elegida por RRHH).
 */
function fechaAltaDe(ficha, fallback) {
  let c = parseFecha(ficha.fecha_inicio);
  const det = parseFecha(ficha.fecha_deteccion);
  if (det && (!c || det > c)) c = det;
  return c || fallback || null;
}

/**
 * @param {Array}  fichas     tickets seleccionados por RRHH
 * @param {string} fechaGrupo fecha elegida (dd/mm/aaaa) → nombre de hoja + fallback col C
 * @returns {Promise<Buffer>} el .xlsx
 */
async function generarAltasExcel(fichas, fechaGrupo) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(etiquetaHoja(fechaGrupo));

  const cab = ws.addRow(HEADERS);
  cab.font = { bold: true };

  const fallback = parseFecha(fechaGrupo);
  (fichas || []).forEach(f => {
    const nombre = `${f.nombre || ''} ${f.apellidos || ''}`.replace(/\s+/g, ' ').trim().toUpperCase();
    const row = ws.addRow([
      nombre,                          // A  Nombre y apellidos
      'TIBUS LUXURY',                  // B  Empresa
      fechaAltaDe(f, fallback),        // C  Fecha de alta
      'Conductor VTC',                 // D  Motivo de alta
      contratoDe(f),                   // E  Modalidad contrato (CT-100 / CT-200)
      f.dni || '',                     // F  DNI/NIE
      parseFecha(f.fecha_nacimiento),  // G  Fecha nacimiento
      f.direccion || '',               // H  Dirección
      f.codigo_postal || '',           // I  Código postal
      f.email || '',                   // J  Correo
      f.id || '',                      // K  Teléfono (clave del ticket)
      f.iban || '',                    // L  IBAN
      f.num_seg_social || '',          // M  NºSS
      f.nacionalidad || ''             // N  Nacionalidad
    ]);
    row.getCell(3).numFmt = 'dd/mm/yyyy';   // Fecha de alta
    row.getCell(7).numFmt = 'dd/mm/yyyy';   // Fecha nacimiento
  });

  ANCHOS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return wb.xlsx.writeBuffer();
}

module.exports = { generarAltasExcel };
