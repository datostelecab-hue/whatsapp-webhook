/**
 * Exporta el planificador al formato "ANEXO" en .xlsx.
 *
 *   Nº | GRUPO (días de libranza) | MATRÍCULA | FIJO DÍA | FIJO NOCHE | CT DÍA | CT NOCHE
 *
 * La organización es POR GRUPOS DE CORRETURNO, como en el anexo original: las
 * matrículas que comparten el/los mismo(s) correturno(s) van juntas en un
 * bloque, y el correturno se escribe UNA sola vez con su celda combinada
 * verticalmente abarcando todas las matrículas que cubre.
 *
 * "Compartir correturno" se resuelve como componentes conexos: si un correturno
 * cubre los coches A y B, y otro cubre B y C, los tres caen en el mismo grupo.
 */

const ExcelJS = require('exceljs');
const { DIAS_SEM } = require('./planificadorV2');

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

function diasLibranza(conductor) {
  if (!conductor || !conductor.libra) return '';
  return conductor.libra.map((v, i) => (v ? DIAS_SEM[i] : null)).filter(Boolean).join('/');
}

function fichaTexto(conductor) {
  if (!conductor) return '';
  const lineas = [conductor.nombre || conductor.id];
  if (conductor.telefono) lineas.push('Tel: ' + conductor.telefono);
  if (conductor.direccion) lineas.push(conductor.direccion);
  return lineas.join('\n');
}

const borde = () => {
  const l = { style: 'thin', color: { argb: BORDE } };
  return { top: l, left: l, bottom: l, right: l };
};

// ---- Union-Find para agrupar coches que comparten correturno ----
function nuevaUF() {
  const padre = new Map();
  const find = x => {
    if (!padre.has(x)) padre.set(x, x);
    while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); }
    return x;
  };
  const union = (a, b) => { padre.set(find(a), find(b)); };
  return { find, union };
}

/**
 * Agrupa los coches por correturno compartido.
 * @returns { grupos: [{ coches:[coche], ctIds:Set }], sueltos: [coche] }
 */
function agruparPorCorreturno(coches) {
  const idsCT = coche =>
    [2, 3, 4, 5].map(s => (coche.personas[s] || {}).id).filter(Boolean);

  const uf = nuevaUF();
  const cochesDeCT = new Map();     // idCorreturno -> [coche]

  coches.forEach(coche => {
    idsCT(coche).forEach(id => {
      if (!cochesDeCT.has(id)) cochesDeCT.set(id, []);
      cochesDeCT.get(id).push(coche);
    });
  });

  // Un correturno une todos los coches donde aparece.
  cochesDeCT.forEach(lista => {
    for (let i = 1; i < lista.length; i++) uf.union(lista[0].idx, lista[i].idx);
  });

  const porRaiz = new Map();
  const sueltos = [];
  coches.forEach(coche => {
    if (!idsCT(coche).length) { sueltos.push(coche); return; }   // sin correturno
    const raiz = uf.find(coche.idx);
    if (!porRaiz.has(raiz)) porRaiz.set(raiz, { coches: [], ctIds: new Set() });
    const g = porRaiz.get(raiz);
    g.coches.push(coche);
    idsCT(coche).forEach(id => g.ctIds.add(id));
  });

  const grupos = [...porRaiz.values()].map(g => ({
    coches: g.coches.sort((a, b) => a.matricula.localeCompare(b.matricula)),
    ctIds: g.ctIds
  }));

  // Los grupos se ordenan por zona y, dentro, por su primera matrícula.
  grupos.sort((a, b) => {
    const za = a.coches[0].zona || 'zzz', zb = b.coches[0].zona || 'zzz';
    return za.localeCompare(zb) || a.coches[0].matricula.localeCompare(b.coches[0].matricula);
  });

  return { grupos, sueltos: sueltos.sort((a, b) => a.matricula.localeCompare(b.matricula)) };
}

async function exportar(tablero) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  const ws = wb.addWorksheet('ANEXO', { views: [{ state: 'frozen', ySplit: 1 }] });

  const porId = new Map();
  tablero.conductores.forEach(c => { if (c.id) porId.set(c.id, c); });
  const cond = p => (p && p.id ? porId.get(p.id) : null);

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

  const conMatricula = tablero.coches.filter(c => c.matricula);
  const { grupos, sueltos } = agruparPorCorreturno(conMatricula);

  let fila = 2;
  let n = 1;

  const escribirCocheBase = (coche) => {
    const r = ws.getRow(fila);
    const fijoDia = cond(coche.personas[0]);
    const fijoNoche = cond(coche.personas[1]);

    r.getCell(1).value = n++;
    r.getCell(2).value = diasLibranza(fijoDia) || diasLibranza(fijoNoche);
    r.getCell(3).value = coche.matricula;
    r.getCell(4).value = fichaTexto(fijoDia);
    r.getCell(5).value = fichaTexto(fijoNoche);
    // Los correturnos de este coche, por si el bloque no los combina (grupo de 1).
    r.getCell(6).value = [coche.personas[2], coche.personas[4]].map(p => fichaTexto(cond(p))).filter(Boolean).join('\n──\n');
    r.getCell(7).value = [coche.personas[3], coche.personas[5]].map(p => fichaTexto(cond(p))).filter(Boolean).join('\n──\n');

    for (let c = 1; c <= 7; c++) {
      const cel = r.getCell(c);
      cel.alignment = { vertical: 'top', horizontal: c <= 3 ? 'center' : 'left', wrapText: true };
      cel.font = { color: { argb: TEXTO }, size: 10 };
      cel.border = borde();
    }
    r.getCell(3).font = { bold: true, color: { argb: DORADO }, size: 10 };
    fila++;
  };

  let numGrupo = 1;
  grupos.forEach(grupo => {
    const zona = grupo.coches.find(c => c.zona) ? grupo.coches.find(c => c.zona).zona : '';
    const nombresCT = [...grupo.ctIds].map(id => (porId.get(id) || {}).nombre || id).join(' · ');

    // Título del grupo (fila combinada A:G)
    ws.mergeCells(fila, 1, fila, 7);
    const tz = ws.getRow(fila).getCell(1);
    tz.value = `CORRETURNO ${numGrupo++}${zona ? ' · ' + zona.toUpperCase() : ''}${nombresCT ? '   —   ' + nombresCT : ''}`;
    tz.font = { bold: true, color: { argb: DORADO }, size: 11 };
    tz.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DORADO_SUAVE } };
    tz.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(fila).height = 20;
    fila++;

    const filaIni = fila;
    grupo.coches.forEach(escribirCocheBase);
    const filaFin = fila - 1;

    // Combinar verticalmente CT DÍA (col 6) y CT NOCHE (col 7) mientras el
    // texto sea el mismo: es el correturno repetido para varias matrículas.
    combinarIguales(ws, 6, filaIni, filaFin);
    combinarIguales(ws, 7, filaIni, filaFin);
  });

  // Coches sin correturno asignado, al final.
  if (sueltos.length) {
    ws.mergeCells(fila, 1, fila, 7);
    const tz = ws.getRow(fila).getCell(1);
    tz.value = 'SIN CORRETURNO ASIGNADO';
    tz.font = { bold: true, color: { argb: DORADO }, size: 11 };
    tz.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DORADO_SUAVE } };
    tz.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(fila).height = 20;
    fila++;
    sueltos.forEach(escribirCocheBase);
  }

  return wb.xlsx.writeBuffer();
}

/** Combina en vertical las celdas de una columna con idéntico texto (no vacío). */
function combinarIguales(ws, col, ini, fin) {
  let bloqueIni = ini;
  for (let f = ini + 1; f <= fin + 1; f++) {
    const actual = f <= fin ? String(ws.getRow(f).getCell(col).value || '') : null;
    const previo = String(ws.getRow(bloqueIni).getCell(col).value || '');
    if (actual !== previo) {
      if (f - 1 > bloqueIni && previo) {
        ws.mergeCells(bloqueIni, col, f - 1, col);
        ws.getRow(bloqueIni).getCell(col).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      }
      bloqueIni = f;
    }
  }
}

module.exports = { exportar };
