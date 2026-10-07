// ============================================================
// EXCEL DE LA JORNADA SEMANAL — una pestaña por jornada
// ============================================================
// Una pestaña por jornada de contrato (40 h, 32 h...), con la cabecera de la
// casa. Primera columna el nombre y de lunes a domingo; luego el total, la
// diferencia con la jornada y si cumplió. De menor a mayor: los que no
// cumplieron quedan arriba (ver el servicio).
//
// Cada día con algo que contar lleva su NOTA (el globo de Excel): «J aprobada
// de 3 h + 5,2 h en BOLT», «Baja médica: no suma». Así el número de la celda se
// puede leer solo y la explicación está a un clic, sin una columna por cosa.

const ExcelJS = require('exceljs');
const E = require('../../services/excelEstilo');

const sello = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());
const esFecha = iso => iso.split('-').reverse().join('/');
const h1 = n => String(Math.round(n * 10) / 10).replace('.', ',');

// Los colores de las marcas, los de la Bitácora: la J en azul; las ausencias,
// cada una el suyo; el rojo solo para lo que no llega.
const TONO = {
  J: { bg: 'FFDBEAFE', fg: 'FF1E40AF' },
  Jp: { bg: 'FFEFF6FF', fg: 'FF1E40AF' },          // J pendiente: más claro, aún no cuenta
  B: { bg: 'FFEDE9FE', fg: 'FF5B21B6' },
  V: { bg: 'FFCCFBF1', fg: 'FF115E59' },
  P: { bg: 'FFFEF3C7', fg: 'FF92400E' },
  L: { bg: 'FFF3F4F6', fg: 'FF6B7280' },
  fuera: { bg: 'FFF9FAFB', fg: 'FFB0B5BD' },
  futuro: { bg: 'FFF9FAFB', fg: 'FFB0B5BD' },
  si: { bg: 'FFD1FAE5', fg: 'FF065F46' },
  no: { bg: 'FFFEE2E2', fg: 'FF991B1B' },
  curso: { bg: 'FFF3F4F6', fg: 'FF4B5563' },
};
const NOMBRE_MARCA = { B: 'Baja médica', V: 'Vacaciones', P: 'Permiso', L: 'Libranza' };

/** Lo que se escribe en la celda de un día, su color y su nota. */
function pintarDia(x) {
  switch (x.tipo) {
    case 'horas':
      return { valor: x.horas, num: true, rojo: x.horas === 0 };
    case 'J': {
      const pend = x.j.estado !== 'aprobada';
      const nota = pend
        ? `J pendiente de aprobar: ${h1(x.j.horas)} h que todavía NO cuentan.${x.bolt ? ` En BOLT: ${h1(x.bolt)} h.` : ''}`
        : `J aprobada: ${h1(x.j.horas)} h${x.bolt ? ` + ${h1(x.bolt)} h en BOLT` : ''} = ${h1(x.horas)} h.`;
      return { valor: x.horas, num: true, tono: pend ? TONO.Jp : TONO.J, nota: nota + (x.j.obs ? `\n${x.j.obs}` : '') };
    }
    case 'B': case 'V': case 'P': case 'L':
      return {
        valor: x.tipo, tono: TONO[x.tipo],
        nota: `${NOMBRE_MARCA[x.tipo]}: no suma horas.${x.bolt ? ` (En BOLT hizo ${h1(x.bolt)} h ese día.)` : ''}`,
      };
    case 'fuera':
      return { valor: '—', tono: TONO.fuera, nota: `Fuera de su contrato de plantilla propia: no cuenta.${x.bolt ? ` (En BOLT: ${h1(x.bolt)} h.)` : ''}` };
    case 'futuro':
      return { valor: '', tono: TONO.futuro };
    default:   // ausencia: le tocaba y no salió
      return { valor: 0, num: true, rojo: true, nota: 'Sin horas en BOLT ni justificante.' };
  }
}

function hoja(wb, idLogo, datos, g) {
  const titulo = g.jornada == null ? 'Sin jornada' : `${g.jornada} horas`;
  const ws = wb.addWorksheet(titulo);
  const cols = [
    { titulo: 'Nombre', ancho: 34 },
    ...datos.cabeceras.map(t => ({ titulo: t, ancho: 10 })),
    { titulo: 'Total', ancho: 9 },
    { titulo: 'Diferencia', ancho: 11 },
    { titulo: '¿Cumple?', ancho: 10 },
    { titulo: 'Observaciones', ancho: 58 },
  ];
  ws.columns = cols.map(c => ({ width: c.ancho }));

  const semana = `Del lunes ${esFecha(datos.lunes)} al domingo ${esFecha(datos.domingo)}`;
  const cuenta = g.jornada == null
    ? `${g.filas.length} ${g.filas.length === 1 ? 'persona' : 'personas'} sin la jornada en el contrato`
    : `${g.filas.length} personas · ${g.cumplen} cumplieron · ${g.noCumplen} no cumplieron`;
  let f = E.bandaCabecera(ws, idLogo,
    `Jornada semanal · ${titulo}${datos.cerrada ? '' : ' · PARCIAL'}`,
    `${semana} · plantilla propia · ${cuenta} · de menor a mayor · generado el ${sello()}` +
    (datos.cerrada ? '' : ' · LA SEMANA NO HA CERRADO: la noche del domingo cuenta hasta las 12:00 del lunes'),
    cols.length);

  // La leyenda, en la fila de respiro que deja la banda.
  ws.mergeCells(3, 1, 3, cols.length);
  const ley = ws.getCell(3, 1);
  ley.value = 'Horas de BOLT por la regla del turno (como la Bitácora) · J = justificante: sus horas se SUMAN a las de BOLT ' +
    '(solo si está aprobado; la pendiente, en azul claro, no cuenta) · B = baja médica, V = vacaciones, P = permiso, ' +
    'L = libranza: no suman · 0 en rojo = no salió · — = fuera de su contrato · pasa el ratón por un día para ver el detalle';
  ley.font = { size: 9, italic: true, color: { argb: E.TENUE } };
  ley.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  ws.getRow(3).height = 26;

  const filaCab = f;
  f = E.cabeceraTabla(ws, f, cols.map(c => c.titulo));
  // Se congelan los títulos y el nombre: con la semana a lo ancho, al bajar o ir
  // a la derecha no se pierde de quién es la fila.
  ws.views = [{ state: 'frozen', ySplit: filaCab, xSplit: 1 }];

  g.filas.forEach(p => {
    const r = ws.getRow(f++);
    const celda = (n, valor, { num, tono, rojo, nota, negrita, al } = {}) => {
      const c = r.getCell(n);
      c.value = valor;
      c.border = E.TODOS_BORDES;
      c.alignment = { vertical: 'middle', horizontal: al || (n === 1 || n === cols.length ? 'left' : 'center'), wrapText: n === cols.length };
      c.font = { size: 10, bold: !!negrita, color: { argb: rojo ? 'FFB91C1C' : E.TEXTO } };
      if (num) c.numFmt = '0.0';
      if (tono) { c.fill = E.relleno(tono.bg); c.font = { size: 10, bold: true, color: { argb: tono.fg } }; }
      if (nota) c.note = nota;
    };
    celda(1, p.nombre);
    p.celdas.forEach((x, k) => { const d = pintarDia(x); celda(2 + k, d.valor, d); });
    const tonoTotal = p.estado === 'Sí' ? TONO.si : p.estado === 'No' ? TONO.no : p.estado === 'En curso' ? TONO.curso : null;
    celda(9, p.total, { num: true, tono: tonoTotal, negrita: true });
    const dif = r.getCell(10);
    celda(10, p.diferencia, { num: true, rojo: p.diferencia != null && p.diferencia < 0 });
    dif.numFmt = '+0.0;-0.0;0.0';
    celda(11, p.estado, { tono: tonoTotal });
    celda(12, p.obs);
    r.height = p.obs.length > 70 ? 30 : 18;
  });

  if (!g.filas.length) {
    ws.getRow(f).getCell(1).value = 'Nadie con esta jornada esa semana.';
    ws.getRow(f).getCell(1).font = { size: 10, italic: true, color: { argb: E.TENUE } };
  }
  ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };
}

/**
 * @param {Object} datos  lo que devuelve jornadaSemanal.service.informe()
 * @returns {Promise<Buffer>}
 */
async function generar(datos) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Telecab';
  wb.created = new Date();
  const logo = E.registrarLogo(wb);
  datos.grupos.forEach(g => hoja(wb, logo, datos, g));
  if (!datos.grupos.length) {
    const ws = wb.addWorksheet('Sin datos');
    ws.getCell('A1').value = `Nadie de plantilla propia del ${esFecha(datos.lunes)} al ${esFecha(datos.domingo)}.`;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generar };
