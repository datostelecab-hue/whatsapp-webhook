/**
 * Exporta el planificador al formato "ANEXO" en .xlsx.
 *
 * Reproduce el layout con el que se trabajaba a mano:
 *   Nº | GRUPO (días de libranza) | MATRÍCULA | FIJO DÍA | FIJO NOCHE | CT DÍA | CT NOCHE
 *
 * Cada celda de conductor lleva nombre, teléfono y dirección/zona en varias
 * líneas, igual que el original. Los coches van agrupados por zona, con una
 * fila de título por zona; dentro de cada zona, ordenados por matrícula.
 */

const ExcelJS = require('exceljs');
const { DIAS_SEM } = require('./planificadorV2');

// Colores de la marca (dorado sobre negro cálido del logo).
const NEGRO = 'FF0E1116';
const DORADO = 'FFE8B84B';
const DORADO_SUAVE = 'FF3A3020';
const BORDE = 'FF3A4250';
const TEXTO = 'FFE6E8EC';

const COLUMNAS = [
  { cab: 'Nº', ancho: 5 },
  { cab: 'GRUPO', ancho: 16 },
  { cab: 'MATRÍCULA', ancho: 12 },
  { cab: 'FIJO DÍA', ancho: 30 },
  { cab: 'FIJO NOCHE', ancho: 30 },
  { cab: 'CT DÍA', ancho: 30 },
  { cab: 'CT NOCHE', ancho: 30 }
];

/** "Lun/Mar" a partir de la libranza [7 bool] del fijo. */
function diasLibranza(conductor) {
  if (!conductor || !conductor.libra) return '';
  const dias = conductor.libra.map((v, i) => (v ? DIAS_SEM[i] : null)).filter(Boolean);
  return dias.join('/');
}

/** Bloque de texto de un conductor: nombre + teléfono + dirección. */
function fichaTexto(conductor, extra) {
  if (!conductor) return '';
  const lineas = [conductor.nombre || conductor.id];
  if (conductor.telefono) lineas.push('Tel: ' + conductor.telefono);
  if (conductor.direccion) lineas.push(conductor.direccion);
  if (extra) lineas.push(extra);
  return lineas.join('\n');
}

/**
 * @param {object} tablero  el resultado de leerTablero()
 * @returns {Buffer} el .xlsx listo para descargar
 */
async function exportar(tablero) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = new Date(tablero.generado || Date.now());
  const ws = wb.addWorksheet('ANEXO', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  // Índice de conductores por ID, para sacar teléfono y dirección.
  const porId = new Map();
  tablero.conductores.forEach(c => { if (c.id) porId.set(c.id, c); });
  const nombreDe = p => (p && p.id ? porId.get(p.id) : null);

  // ---- Cabecera ----
  ws.columns = COLUMNAS.map(c => ({ width: c.ancho }));
  const cab = ws.getRow(1);
  COLUMNAS.forEach((c, i) => {
    const cel = cab.getCell(i + 1);
    cel.value = c.cab;
    cel.font = { bold: true, color: { argb: DORADO }, size: 11 };
    cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NEGRO } };
    cel.alignment = { vertical: 'middle', horizontal: 'center' };
    cel.border = borde();
  });
  cab.height = 22;

  // ---- Coches agrupados por zona ----
  const conMatricula = tablero.coches.filter(c => c.matricula);
  const zonas = agruparPorZona(conMatricula);

  let fila = 2;
  let n = 1;

  zonas.forEach(({ zona, coches }) => {
    // Título de zona (fila combinada A:G)
    ws.mergeCells(fila, 1, fila, 7);
    const tz = ws.getRow(fila).getCell(1);
    tz.value = zona.toUpperCase();
    tz.font = { bold: true, color: { argb: DORADO }, size: 11 };
    tz.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DORADO_SUAVE } };
    tz.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(fila).height = 20;
    fila++;

    coches.forEach(coche => {
      const r = ws.getRow(fila);
      const fijoDia = nombreDe(coche.personas[0]);
      const fijoNoche = nombreDe(coche.personas[1]);

      // Los CT de día (CT1+CT2) y de noche se juntan en su columna, cada uno
      // con los días que cubre.
      const ctDia = [coche.personas[2], coche.personas[4]]
        .map(p => textoCT(nombreDe(p), p)).filter(Boolean).join('\n──\n');
      const ctNoche = [coche.personas[3], coche.personas[5]]
        .map(p => textoCT(nombreDe(p), p)).filter(Boolean).join('\n──\n');

      // La columna GRUPO: los días de libranza del fijo (los que cubre el CT).
      const grupo = diasLibranza(fijoDia) || diasLibranza(fijoNoche);

      r.getCell(1).value = n++;
      r.getCell(2).value = grupo;
      r.getCell(3).value = coche.matricula;
      r.getCell(4).value = fichaTexto(fijoDia);
      r.getCell(5).value = fichaTexto(fijoNoche);
      r.getCell(6).value = ctDia;
      r.getCell(7).value = ctNoche;

      for (let c = 1; c <= 7; c++) {
        const cel = r.getCell(c);
        cel.alignment = { vertical: 'top', horizontal: c <= 3 ? 'center' : 'left', wrapText: true };
        cel.font = { color: { argb: TEXTO }, size: 10 };
        cel.border = borde();
      }
      r.getCell(3).font = { bold: true, color: { argb: DORADO }, size: 10 };
      fila++;
    });
  });

  return wb.xlsx.writeBuffer();
}

function textoCT(conductor, persona) {
  if (!conductor) return '';
  const dias = persona && persona.diasTexto ? '\nDías: ' + persona.diasTexto : '';
  return fichaTexto(conductor) + dias;
}

function agruparPorZona(coches) {
  const mapa = new Map();
  coches.forEach(c => {
    const z = c.zona || '(sin zona)';
    if (!mapa.has(z)) mapa.set(z, []);
    mapa.get(z).push(c);
  });
  return [...mapa.entries()]
    .sort((a, b) => {
      if (a[0] === '(sin zona)') return 1;
      if (b[0] === '(sin zona)') return -1;
      return a[0].localeCompare(b[0]);
    })
    .map(([zona, cs]) => ({
      zona,
      coches: cs.sort((a, b) => a.matricula.localeCompare(b.matricula))
    }));
}

function borde() {
  const l = { style: 'thin', color: { argb: BORDE } };
  return { top: l, left: l, bottom: l, right: l };
}

module.exports = { exportar };
