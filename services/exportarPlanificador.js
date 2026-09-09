/**
 * Exporta el planificador al formato "ANEXO" en .xlsx.
 *
 *   Nº | GRUPO (días de libranza) | MATRÍCULA | FIJO DÍA | FIJO NOCHE | CT DÍA | CT NOCHE
 *
 * La organización es POR CUADRANTE y en su orden: Cuadrante 2, Cuadrante 3…
 * igual que el planificador en pantalla. Antes se agrupaba por CORRETURNO
 * COMPARTIDO —componentes conexos: si un correturno cubría A y B, y otro B y C,
 * los tres caían en el mismo bloque— y salía un papel imposible de seguir,
 * porque el orden no se parecía en nada al de la pantalla y un coche podía
 * aparecer en un bloque con coches de otro cuadrante.
 *
 * El correturno se sigue combinando verticalmente dentro del bloque cuando
 * cubre varias matrículas del mismo cuadrante, que es lo que hacía legible el
 * anexo; lo que cambia es quién manda en el orden.
 */

const ExcelJS = require('exceljs');
const { contactos } = require('./repo/planificador');   // teléfono + localidad, del núcleo (PostgreSQL)

// Lunes … Domingo (0=lunes, como el índice del Cuadrante).
const DIAS_SEM = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const AZUL = 'FF1F4E79';        // cabecera principal
const AZUL_MEDIO = 'FF2E75B6';  // títulos de grupo
const AMARILLO = 'FFFFFF00';    // turno sin conductor
const BLANCO = 'FFFFFFFF';
const NEGRO = 'FF000000';
const BORDE = 'FF808080';

const relleno = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const centrado = { vertical: 'middle', horizontal: 'center', wrapText: true };

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

// El descanso del COCHE (vehiculo_descanso, en ISODOW 1..7), que es lo que
// manda en f_cobertura desde db/58. La columna GRUPO salía en blanco en todas
// las filas porque leía la libranza del FIJO (patron_libranza), que nadie
// tiene: 0 patrones frente a 132 coches con descanso.
function descansoCoche(coche) {
  return ((coche && coche.descanso) || []).map(d => DIAS_SEM[d - 1]).filter(Boolean).join('/');
}

// Estado del vehículo, para anotar (mini) los coches no operativos que se mantienen
// en el anexo por tener conductores. El bueno ('✓') no se anota.
const MOTIVO_VEH = { S: 'Siniestro', T: 'Transporte', X: 'En taller', R: 'Reservado', B: 'Baja' };

// "08/08/2026" → "8/8" (anotación compacta de Desde/Hasta).
function cortoFecha(s) {
  if (!s) return '';
  const t = String(s).trim();
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return `${+m[1]}/${+m[2]}`;
  m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return `${+m[3]}/${+m[2]}`;
  return t;
}

// Texto plano de una celda, sea string o richText (para comparar/medir vacío).
const celdaTexto = v => v == null ? '' : (v.richText ? v.richText.map(t => t.text).join('') : String(v));

const borde = () => {
  const l = { style: 'thin', color: { argb: BORDE } };
  return { top: l, left: l, bottom: l, right: l };
};

/**
 * Agrupa los coches POR CUADRANTE, en el orden del planificador.
 *
 * El orden es por `cuadranteNum` —el número de la tabla, no el nombre—: por
 * texto, "Cuadrante 10" va antes que "Cuadrante 2".
 *
 * @returns { grupos: [{ nombre, numero, zona, coches, ctIds }], sueltos: [coche] }
 */
function agruparPorCuadrante(coches) {
  const idsCT = coche =>
    [2, 3, 4, 5].map(s => (coche.personas[s] || {}).id).filter(Boolean);

  const porCuadrante = new Map();
  const sueltos = [];
  coches.forEach(coche => {
    if (!coche.cuadranteId) { sueltos.push(coche); return; }
    const k = String(coche.cuadranteId);
    if (!porCuadrante.has(k)) {
      porCuadrante.set(k, {
        nombre: coche.cuadrante || ('Cuadrante ' + (coche.cuadranteNum ?? '?')),
        numero: coche.cuadranteNum == null ? Number.MAX_SAFE_INTEGER : coche.cuadranteNum,
        zona: coche.zona || '',
        coches: [], ctIds: new Set(),
      });
    }
    const g = porCuadrante.get(k);
    g.coches.push(coche);
    if (!g.zona && coche.zona) g.zona = coche.zona;
    idsCT(coche).forEach(id => g.ctIds.add(id));
  });

  const grupos = [...porCuadrante.values()];
  grupos.forEach(g => g.coches.sort((a, b) => a.matricula.localeCompare(b.matricula)));
  grupos.sort((a, b) => a.numero - b.numero || a.nombre.localeCompare(b.nombre));

  return { grupos, sueltos: sueltos.sort((a, b) => a.matricula.localeCompare(b.matricula)) };
}

async function exportar(tablero) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  const ws = wb.addWorksheet('ANEXO', { views: [{ state: 'frozen', ySplit: 1 }] });

  const porId = new Map();
  tablero.conductores.forEach(c => { if (c.id) porId.set(c.id, c); });
  const cond = p => (p && p.id ? porId.get(p.id) : null);

  // Teléfono y localidad del núcleo (PostgreSQL), por id de conductor.
  const contac = await contactos().catch(() => new Map());

  ws.columns = COLUMNAS.map(c => ({ width: c.ancho }));
  const cab = ws.getRow(1);
  COLUMNAS.forEach((c, i) => {
    const cel = cab.getCell(i + 1);
    cel.value = c.cab;
    cel.font = { bold: true, color: { argb: BLANCO }, size: 11 };
    cel.fill = relleno(AZUL);
    cel.alignment = centrado;
    cel.border = borde();
  });
  cab.height = 24;

  // Solo coches con estado bueno (operativo). Los de estado distinto entran únicamente
  // si tienen conductores asignados (se anota su estado bajo la matrícula).
  const tieneConductores = c => (c.personas || []).some(p => p.id);
  const conMatricula = tablero.coches.filter(c => c.matricula && (c.operativo || tieneConductores(c)));
  const { grupos, sueltos } = agruparPorCuadrante(conMatricula);

  let fila = 2;
  let n = 1;

  // Ficha de una plaza como tramos de texto: nombre (10), teléfono (9), zona/localidad
  // (8), marca ETT (8 ámbar) y, si el titular está ausente, su ausencia (8 rojo). Al
  // final, la ventana Desde/Hasta del relevo (8 cursiva ámbar).
  const AMBAR = 'FF9C5A00';
  const ROJO = 'FFC00000';
  const fichaRuns = (p) => {
    const c = cond(p);
    const runs = [];
    if (p && p.id) {
      const info = contac.get(String(p.id)) || {};
      const nombre = (c && c.nombre) || p.id;
      const tel = info.telefono || (c && c.telefono) || '';
      runs.push({ text: nombre, font: { size: 10, color: { argb: NEGRO } } });
      if (tel) runs.push({ text: '\nTel: ' + tel, font: { size: 9, color: { argb: NEGRO } } });
      if (info.zona) runs.push({ text: '\nZona: ' + info.zona, font: { size: 8, color: { argb: NEGRO } } });
      if (c && c.esEtt) runs.push({ text: '\nETT' + (c.ettNombre ? ' · ' + c.ettNombre : ''), font: { size: 8, bold: true, color: { argb: AMBAR } } });
      // El titular sigue en su plaza aunque hoy esté ausente (vacaciones, baja…): se
      // anota, no se borra. La cobertura del día es otra pantalla.
      if (c && c.ausente) {
        runs.push({ text: '\n' + (c.estado || 'Ausente') + (c.vuelveEl ? ' hasta ' + cortoFecha(c.vuelveEl) : ''), font: { size: 8, italic: true, color: { argb: ROJO } } });
      }
    }
    // La ventana del relevo. asignacion.desde SIEMPRE tiene valor, así que
    // "desde d/m" en cada plaza no distinguía un relevo temporal de un titular
    // con años de casa: solo se anota cuando hay "hasta", que es lo que hace
    // que sea un relevo. (Un "desde reciente" no sirve: tras la migración del
    // 26/08 todas las asignaciones son recientes.)
    const vent = [];
    if (p && p.hasta) {
      if (p.desde) vent.push('desde ' + cortoFecha(p.desde));
      vent.push('hasta ' + cortoFecha(p.hasta));
    }
    if (vent.length) runs.push({ text: (runs.length ? '\n' : '') + vent.join(' · '), font: { size: 8, italic: true, color: { argb: AMBAR } } });
    return runs;
  };
  const wrap = runs => runs.length ? { richText: runs } : '';
  const sepRun = { text: '\n──\n', font: { size: 8, color: { argb: BORDE } } };
  const juntar = (...listas) => {
    const out = [];
    listas.filter(l => l.length).forEach((l, i) => { if (i) out.push(sepRun); out.push(...l); });
    return out;
  };

  const escribirCocheBase = (coche) => {
    const r = ws.getRow(fila);
    const fijoDia = cond(coche.personas[0]);
    const fijoNoche = cond(coche.personas[1]);

    r.getCell(1).value = n++;
    r.getCell(2).value = descansoCoche(coche) || diasLibranza(fijoDia) || diasLibranza(fijoNoche);
    // Matrícula: si el coche NO está operativo (pero tiene conductores), se anota su
    // estado super pequeño, en rojo, debajo de la matrícula.
    r.getCell(3).value = coche.operativo
      ? coche.matricula
      : { richText: [
          { text: coche.matricula, font: { bold: true, size: 10, color: { argb: NEGRO } } },
          { text: '\n' + (MOTIVO_VEH[coche.estadoVeh] || 'no operativo'), font: { size: 8, italic: true, color: { argb: 'FFC00000' } } }
        ] };
    r.getCell(4).value = wrap(fichaRuns(coche.personas[0]));
    r.getCell(5).value = wrap(fichaRuns(coche.personas[1]));
    // Los correturnos de este coche, por si el bloque no los combina (grupo de 1).
    r.getCell(6).value = wrap(juntar(fichaRuns(coche.personas[2]), fichaRuns(coche.personas[4])));
    r.getCell(7).value = wrap(juntar(fichaRuns(coche.personas[3]), fichaRuns(coche.personas[5])));

    for (let c = 1; c <= 7; c++) {
      const cel = r.getCell(c);
      cel.alignment = centrado;
      cel.border = borde();
      // Las celdas con richText ya llevan su fuente por tramo; el resto, fuente base.
      if (!(cel.value && cel.value.richText)) cel.font = { color: { argb: NEGRO }, size: 10 };
      // Columnas de turno sin conductor → amarillo (plazas por cubrir).
      const esTurno = c >= 4;
      const vacio = !celdaTexto(cel.value).trim();
      cel.fill = relleno(esTurno && vacio ? AMARILLO : BLANCO);
    }
    if (coche.operativo) r.getCell(3).font = { bold: true, color: { argb: NEGRO }, size: 10 };
    fila++;
  };

  grupos.forEach(grupo => {
    const nCoches = grupo.coches.length;
    // Título del bloque: el cuadrante, su zona y cuántos coches lleva. Los
    // nombres de los correturnos ya no van aquí —se repetían con la columna
    // que los pinta— y hacían el título ilegible en cuadrantes grandes.
    escribirTitulo(ws, fila,
      `${grupo.nombre.toUpperCase()}${grupo.zona ? ' · ' + grupo.zona.toUpperCase() : ''}` +
      `   —   ${nCoches} ${nCoches === 1 ? 'coche' : 'coches'}`);
    fila++;

    const filaIni = fila;
    grupo.coches.forEach(escribirCocheBase);
    const filaFin = fila - 1;

    // Combinar verticalmente CT DÍA (col 6) y CT NOCHE (col 7) mientras el
    // texto sea el mismo: es el correturno repetido para varias matrículas.
    combinarIguales(ws, 6, filaIni, filaFin);
    combinarIguales(ws, 7, filaIni, filaFin);
  });

  // Los coches que no están en ningún cuadrante, al final del todo.
  if (sueltos.length) {
    escribirTitulo(ws, fila, 'SIN CUADRANTE ASIGNADO');
    fila++;
    sueltos.forEach(escribirCocheBase);
  }

  return wb.xlsx.writeBuffer();
}

/** Fila-título de grupo: combinada A:G, azul con texto blanco, centrado. */
function escribirTitulo(ws, fila, texto) {
  ws.mergeCells(fila, 1, fila, 7);
  const cel = ws.getRow(fila).getCell(1);
  cel.value = texto;
  cel.font = { bold: true, color: { argb: BLANCO }, size: 11 };
  cel.fill = relleno(AZUL_MEDIO);
  cel.alignment = centrado;
  cel.border = borde();
  ws.getRow(fila).height = 20;
}

/** Combina en vertical las celdas de una columna con idéntico texto (no vacío). */
function combinarIguales(ws, col, ini, fin) {
  let bloqueIni = ini;
  for (let f = ini + 1; f <= fin + 1; f++) {
    const actual = f <= fin ? celdaTexto(ws.getRow(f).getCell(col).value) : null;
    const previo = celdaTexto(ws.getRow(bloqueIni).getCell(col).value);
    if (actual !== previo) {
      if (f - 1 > bloqueIni && previo) {
        ws.mergeCells(bloqueIni, col, f - 1, col);
        ws.getRow(bloqueIni).getCell(col).alignment = centrado;
      }
      bloqueIni = f;
    }
  }
}

module.exports = { exportar };
