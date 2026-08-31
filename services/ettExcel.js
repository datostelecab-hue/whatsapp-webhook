// ============================================================
// EXCEL DE RESPUESTA A LA ETT
// ============================================================
// El mismo contenido que la matriz que se pegaba a mano, pero como .xlsx presentable:
// este fichero se envía por correo a la empresa de trabajo temporal, así que va con
// cabecera de la empresa, las dos mitades bien separadas (lo que mandó la ETT vs. lo
// que respondemos) y cada candidato coloreado según el resultado.
//
// IMPORTANTE: las columnas y su significado son EXACTAMENTE los de la matriz de
// siempre — la ETT las lee tal cual. El color y la leyenda solo refuerzan lo que ya
// dice el texto de la columna FECHA DE ALTA ("No se presentó" / "No pasa la
// entrevista"), para no romper lo que esperan al otro lado.

const ExcelJS = require('exceljs');
const fs = require('fs');

const TZ = 'Europe/Madrid';
// El logo va incrustado en el .xlsx (no enlazado), así que el fichero viaja completo
// por correo. Si algún día no estuviera, la cabecera se genera igual sin él.
// La ruta sale del estilo común para que todos los Excel lleven el MISMO logo.
const { LOGO } = require('./excelEstilo');

// Paleta de la casa (dorado Telecab) en ARGB.
const DARK = 'FF1F2430';
const GOLD = 'FFE8B84B';
const GRIS_BORDE = 'FFD8DCE3';
const GRUPO_ETT = 'FFEDEFF2';
const GRUPO_NOS = 'FFFBEFCF';
const CAB_BG = 'FF394150';

// Un color por resultado: se ve de un vistazo quién entra y quién no.
//
// Son CUATRO. "Pendiente" es pendiente de ASIGNAR —elegido, sin puesto todavía—
// y por eso va en ámbar y no en blanco: es alguien de quien la agencia volverá a
// tener noticias, no una fila sin resolver.
//
// Antes había un quinto, "Presentó", que significaba "entrevistado, pendiente
// de decisión". Se ha ido: quien está entrevistado y sin puesto ES el pendiente
// de asignar, y tener dos nombres para lo mismo solo confundía a quien lo lee.
const ESTILO = {
  'Contratado':     { fill: 'FFE7F6EC', font: 'FF14663A', negrita: true },
  'Pendiente':      { fill: 'FFFFF9E8', font: 'FF8A6100' },
  'No pasa':        { fill: 'FFFDECEC', font: 'FFA32020' },
  'No se presentó': { fill: 'FFF2F3F5', font: 'FF6B7280', cursiva: true }
};

const CABECERAS = ['Fecha Entrevista', 'Hora', 'Jornada', 'Turno', 'Nombre', 'DNI / NIE', 'Teléfono',
  'Dirección', 'C.P.', 'Correo electrónico', 'FECHA DE ALTA', 'JORNADA', 'TURNO', 'ZONA'];
const ANCHOS = [15, 8, 11, 11, 28, 13, 13, 34, 8, 30, 17, 11, 11, 14];
const N_ETT = 10;                      // las 10 primeras columnas las manda la ETT
const N_COLS = CABECERAS.length;
const IZQUIERDA = new Set([5, 8, 10]); // Nombre, Dirección y Correo se leen mejor a la izquierda

const borde = { style: 'thin', color: { argb: GRIS_BORDE } };
const TODOS_BORDES = { top: borde, left: borde, bottom: borde, right: borde };

let _logoOk = null;
const hayLogo = () => (_logoOk === null ? (_logoOk = fs.existsSync(LOGO)) : _logoOk);

const hoyES = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
}).format(new Date());

/** 'dd/mm/aaaa' → Date (para que Excel lo trate como fecha). Si no casa, null. */
function aFecha(s) {
  const m = String(s || '').match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  const a = +(m[3].length === 2 ? '20' + m[3] : m[3]);
  const d = new Date(Date.UTC(a, +m[2] - 1, +m[1]));
  return isNaN(d) ? null : d;
}

function pintarCelda(celda, est, alineacion) {
  celda.border = TODOS_BORDES;
  celda.alignment = { vertical: 'middle', horizontal: alineacion, wrapText: false };
  if (!est) return;
  celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: est.fill } };
  celda.font = { color: { argb: est.font }, bold: !!est.negrita, italic: !!est.cursiva, size: 11 };
}

/**
 * @param {Array} lista candidatos (objetos de services/ett.js)
 * @returns {Promise<Buffer>} el .xlsx listo para adjuntar al correo
 */
async function generarExcelETT(lista) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tibus Luxury';
  wb.created = new Date();
  const ws = wb.addWorksheet('Candidatos ETT', {
    views: [{ state: 'frozen', ySplit: 5 }],                       // cabecera siempre visible
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
  });

  ANCHOS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const ultima = String.fromCharCode(64 + N_COLS);   // 14 → 'N'

  // ── Fila 1: banda oscura con el logo y el título ──
  ws.mergeCells(`A1:${ultima}1`);
  const t = ws.getCell('A1');
  t.value = '                 TIBUS LUXURY · Respuesta a candidatos ETT';
  t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: GOLD } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  // El texto se sangra para dejarle sitio al logo, que va flotando sobre la banda.
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: hayLogo() ? 6 : 1 };
  ws.getRow(1).height = 46;

  if (hayLogo()) {
    const img = wb.addImage({ filename: LOGO, extension: 'png' });
    ws.addImage(img, {
      tl: { col: 0.18, row: 0.14 },     // pegado a la izquierda, centrado en la banda
      ext: { width: 44, height: 44 },
      editAs: 'absolute'
    });
  }

  // ── Fila 2: resumen ──
  const n = e => lista.filter(c => c.estado === e).length;
  ws.mergeCells(`A2:${ultima}2`);
  const s = ws.getCell('A2');
  // Los cuatro, incluidos los pendientes: son los que obligan a un segundo
  // envío, así que la agencia tiene que verlos contados desde arriba.
  s.value = `${lista.length} candidato(s)  ·  ${n('Contratado')} contratado(s)  ·  ` +
            `${n('Pendiente')} pendiente(s) de asignar  ·  ${n('No pasa')} no pasa(n)  ·  ` +
            `${n('No se presentó')} no se presentó  ·  Generado el ${hoyES()}`;
  s.font = { size: 10, color: { argb: 'FF6B7280' } };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FA' } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  ws.getRow(3).height = 6;   // respiro

  // ── Fila 4: de quién es cada mitad de la tabla ──
  ws.mergeCells(`A4:${String.fromCharCode(64 + N_ETT)}4`);
  ws.mergeCells(`${String.fromCharCode(65 + N_ETT)}4:${ultima}4`);
  const gA = ws.getCell('A4'), gB = ws.getCell(`${String.fromCharCode(65 + N_ETT)}4`);
  gA.value = 'DATOS FACILITADOS POR LA ETT';
  gB.value = 'RESPUESTA DE TIBUS LUXURY';
  [[gA, GRUPO_ETT], [gB, GRUPO_NOS]].forEach(([c, bg]) => {
    c.font = { size: 10, bold: true, color: { argb: 'FF374151' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = TODOS_BORDES;
  });
  ws.getRow(4).height = 20;

  // ── Fila 5: cabeceras ──
  const cab = ws.getRow(5);
  CABECERAS.forEach((h, i) => {
    const c = cab.getCell(i + 1);
    c.value = h;
    c.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CAB_BG } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = TODOS_BORDES;
  });
  cab.height = 26;

  // ── Datos ──
  lista.forEach(c => {
    // El resultado va en FECHA DE ALTA, igual que en la matriz de siempre.
    let alta = c.fecha_alta, jor = c.jornada, tur = c.turno, zon = c.zona;
    if (c.estado === 'No se presentó') { alta = 'No se presentó'; jor = tur = zon = ''; }
    else if (c.estado === 'No pasa') { alta = 'No pasa la entrevista'; jor = tur = zon = ''; }

    const fEntrevista = aFecha(c.fecha_entrevista);
    const fAlta = aFecha(alta);
    const fila = ws.addRow([
      fEntrevista || c.fecha_entrevista || '', c.hora_entrevista || '', c.jornada_ett || '', c.turno_ett || '',
      c.nombre || '', c.dni || '', c.telefono || '', c.direccion || '', c.cp || '', c.correo || '',
      fAlta || alta || '', jor || '', tur || '', zon || ''
    ]);
    const est = ESTILO[c.estado] || ESTILO.Pendiente;
    for (let i = 1; i <= N_COLS; i++) {
      pintarCelda(fila.getCell(i), est, IZQUIERDA.has(i) ? 'left' : 'center');
    }
    if (fEntrevista) fila.getCell(1).numFmt = 'dd/mm/yyyy';
    if (fAlta) fila.getCell(11).numFmt = 'dd/mm/yyyy';
    fila.getCell(11).font = { ...fila.getCell(11).font, bold: true };   // la fecha de alta es LO que espera la ETT
    fila.height = 18;
  });

  const ultimaFila = ws.rowCount;
  if (lista.length) {
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: ultimaFila, column: N_COLS } };
  }

  // ── Leyenda ──
  const inicioLeyenda = ultimaFila + 2;
  ws.getCell(`A${inicioLeyenda}`).value = 'Leyenda';
  ws.getCell(`A${inicioLeyenda}`).font = { size: 10, bold: true, color: { argb: 'FF374151' } };
  [['Contratado', 'Se incorpora: fecha de alta, jornada, turno y zona a la derecha'],
   ['Pendiente', 'Seleccionado, pendiente de asignarle puesto'],
   ['No pasa', 'No supera la entrevista'],
   ['No se presentó', 'No acudió a la entrevista']
  ].forEach(([estado, texto], i) => {
    const f = inicioLeyenda + 1 + i;
    const c1 = ws.getCell(`A${f}`), c2 = ws.getCell(`B${f}`);
    c1.value = estado;
    const est = ESTILO[estado];
    c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: est.fill } };
    c1.font = { size: 10, color: { argb: est.font }, bold: !!est.negrita, italic: !!est.cursiva };
    c1.alignment = { horizontal: 'center', vertical: 'middle' };
    c1.border = TODOS_BORDES;
    ws.mergeCells(`B${f}:E${f}`);
    c2.value = texto;
    c2.font = { size: 10, color: { argb: 'FF6B7280' } };
    c2.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  });

  return wb.xlsx.writeBuffer();
}

/** Nombre de fichero con la fecha, para que no se pisen en el correo. */
function nombreFichero() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return `Candidatos_ETT_Tibus_Luxury_${p}.xlsx`;
}

module.exports = { generarExcelETT, nombreFichero };
